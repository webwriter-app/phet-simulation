// Rutherford Scattering WebWriter state adapter. Distributed under GPL-3.0.
import Matrix3 from '../../../dot/js/Matrix3.js';
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import AlphaParticle from '../common/model/AlphaParticle.js';
import type RSBaseModel from '../common/model/RSBaseModel.js';
import RSConstants from '../common/RSConstants.js';
import type RSBaseScreenView from '../common/view/RSBaseScreenView.js';
import RutherfordAtomModel from '../rutherfordatom/model/RutherfordAtomModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

function finite( value: unknown, minimum = -1e9, maximum = 1e9 ): value is number {
  return typeof value === 'number' && Number.isFinite( value ) && value >= minimum && value <= maximum;
}

function point( input: unknown ): Vector2 {
  if ( !Array.isArray( input ) || input.length !== 2 || !input.every( value => finite( value ) ) ) {
    throw new Error( 'Invalid alpha particle position.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}

function coordinates( point: Vector2 ) {
  return [ point.x, point.y ];
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-rutherford-scattering/v1',
    build: 'rutherford-scattering@1.2.0-dev.4-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => {
      const model = screen.model as RSBaseModel;
      const view = screen.view as RSBaseScreenView;
      const rutherford = model instanceof RutherfordAtomModel ? model : null;
      const fields = {
        running: boolean( model.runningProperty ),
        gun: boolean( model.gun.onProperty ),
        energy: number( model.alphaParticleEnergyProperty, false, value =>
          finite( value, RSConstants.MIN_ALPHA_ENERGY, RSConstants.MAX_ALPHA_ENERGY ) ),
        protons: number( model.protonCountProperty, true, value =>
          finite( value, RSConstants.MIN_PROTON_COUNT, RSConstants.MAX_PROTON_COUNT ) ),
        neutrons: number( model.neutronCountProperty, true, value =>
          finite( value, RSConstants.MIN_NEUTRON_COUNT, RSConstants.MAX_NEUTRON_COUNT ) ),
        traces: boolean( view.showAlphaTraceProperty ),
        ...( rutherford ? { scene: field( rutherford.sceneProperty, value => value,
          input => input === 'atom' || input === 'nucleus' ? input : undefined ) } : {} )
      };
      return {
        id: index === 0 ? 'rutherford-atom' : 'plum-pudding-atom',
        screen,
        isPlaying: () => model.runningProperty.value && ( model.gun.onProperty.value || model.particles.length > 0 ),
        read: () => {
          const space = model.getVisibleSpace();
          return {
            ...readFields( fields ),
            gunElapsed: model.gun.onProperty.value ? model.gun[ 'dtSinceGunFired' ] : 0,
            particles: model.particles.map( particle => ( {
              speed: particle.speedProperty.value,
              defaultSpeed: particle.defaultSpeedProperty.value,
              orientation: particle.orientationProperty.value,
              position: coordinates( particle.positionProperty.value ),
              initial: coordinates( particle.initialPosition ),
              trace: particle.positions.slice( view.showAlphaTraceProperty.value ? -3000 : -2 ).map( coordinates ),
              atom: particle.atom ? space.atoms.indexOf( particle.atom ) : null,
              preparedAtom: particle.preparedAtom ? space.atoms.indexOf( particle.preparedAtom ) : null,
              rotation: particle.rotationAngle,
              preparedRotation: particle.preparedRotationAngle
            } ) )
          };
        },
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( fields, state );
          const { particles, gunElapsed } = state;
          if ( !Array.isArray( particles ) || particles.length > 5000 || !finite( gunElapsed, 0 ) ) {
            throw new Error( 'Invalid alpha particle stream.' );
          }
          const space = rutherford ? ( state.scene === 'atom' ? rutherford.atomSpace : rutherford.nucleusSpace ) : model.atomSpaces[ 0 ];
          const saved = particles.map( entry => {
            const { speed, defaultSpeed, orientation, position, initial, trace, atom, preparedAtom, rotation, preparedRotation } = object( entry );
            const validAtom = ( index: unknown ) => index === null ||
              typeof index === 'number' && Number.isInteger( index ) && !!space.atoms[ index ];
            if ( !finite( speed, 0 ) || !finite( defaultSpeed, 0 ) || !finite( orientation ) ||
                 !validAtom( atom ) || !validAtom( preparedAtom ) || !finite( rotation ) ||
                 ( preparedAtom === null ? preparedRotation !== null : !finite( preparedRotation ) ) ||
                 !Array.isArray( trace ) || trace.length < 1 || trace.length > 3000 ) {
              throw new Error( 'Invalid alpha particle trajectory.' );
            }
            return {
              speed, defaultSpeed, orientation, position: point( position ), initial: point( initial ),
              trace: trace.map( point ), rotation, preparedRotation: preparedRotation as number | null,
              atom: atom === null ? null : space.atoms[ atom as number ],
              preparedAtom: preparedAtom === null ? null : space.atoms[ preparedAtom as number ]
            };
          } );
          return () => {
            view.interruptSubtreeInput();
            model.removeAllParticles();
            apply();
            model.gun[ 'dtSinceGunFired' ] = gunElapsed;
            saved.forEach( state => {
              const particle = new AlphaParticle( { speed: state.speed, defaultSpeed: state.defaultSpeed,
                orientation: state.orientation, position: state.position } );
              model.addParticle( particle );
              particle.positions.splice( 0, particle.positions.length, ...state.trace );
              particle.preparedAtom = state.preparedAtom;
              particle.preparedRotationAngle = state.preparedRotation;
              if ( state.preparedAtom && state.preparedRotation !== null ) {
                particle.preparedBoundingBox = state.preparedAtom.boundingRect.transformed(
                  Matrix3.rotationAroundPoint( state.preparedRotation, state.preparedAtom.position ) );
              }
              if ( state.atom ) {
                space[ 'removeParticleFromEmptySpace' ]( particle );
                state.atom.addParticle( particle );
                particle.atom = state.atom;
                particle.boundingBox = state.atom.boundingRect.transformed( Matrix3.rotationAroundPoint( state.rotation, state.atom.position ) );
                particle.rotationAngle = state.rotation;
              }
              particle.initialPosition = state.initial;
            } );
            model.stepEmitter.emit( model.manualStepDt );
          };
        }
      };
    } )
  } ) );
}
