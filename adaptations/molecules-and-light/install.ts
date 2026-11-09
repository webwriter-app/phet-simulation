// State adapter for PhET Molecules and Light. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type MicroPhoton from '../../../greenhouse-effect/js/micro/model/MicroPhoton.js';
import type Molecule from '../../../greenhouse-effect/js/micro/model/Molecule.js';
import PhotonHoldStrategy from '../../../greenhouse-effect/js/micro/model/PhotonHoldStrategy.js';
import PhotonTarget from '../../../greenhouse-effect/js/micro/model/PhotonTarget.js';
import type Sim from '../../../joist/js/Sim.js';
import type MoleculesAndLightModel from '../molecules-and-light/model/MoleculesAndLightModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, object, prepareFields, readFields } from './stateFields.js';

function finite( input: unknown, min: number, max: number ): number {
  if ( typeof input !== 'number' || !Number.isFinite( input ) || input < min || input > max ) {
    throw new Error( 'Invalid Molecules and Light motion.' );
  }
  return input;
}

function point( input: unknown, limit: number ) {
  if ( !Array.isArray( input ) || input.length !== 2 ) { throw new Error( 'Invalid molecule coordinates.' ); }
  return new Vector2( finite( input[ 0 ], -limit, limit ), finite( input[ 1 ], -limit, limit ) );
}

function readPoint( vector: Vector2 ) { return [ vector.x, vector.y ]; }

function moleculeFields( molecule: Molecule ) {
  return {
    excited: boolean( molecule.highElectronicEnergyStateProperty ),
    vibrating: boolean( molecule.vibratingProperty ),
    rotating: boolean( molecule.rotatingProperty ),
    clockwise: boolean( molecule.rotationDirectionClockwiseProperty )
  };
}

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as MoleculesAndLightModel;
    const wavelengths = model.photonWavelengthProperty.validValues!;
    const fields = {
      target: enumeration( model.photonTargetProperty ),
      wavelength: field( model.photonWavelengthProperty, value => value, input => wavelengths.find( value => input === value ) ),
      emitter: boolean( model.photonEmitterOnProperty ),
      speed: enumeration( model.timeSpeedProperty )
    };
    return {
      bridge: 'webwriter-molecules-and-light/v1',
      build: 'molecules-and-light@1.6.0-dev.8-webwriter.1',
      screens: [ {
        id: 'molecules',
        screen,
        isPlaying: () => model.runningProperty.value && ( model.photonEmitterOnProperty.value || model.photonGroup.count > 0 ||
          model.activeMolecules.some( molecule => molecule.isPhotonAbsorbed() || molecule.velocity.magnitude > 0 ) ),
        read: () => {
          const photons = model.photonGroup.getArrayCopy();
          return {
            ...readFields( fields ),
            playing: model.runningProperty.value,
            countdown: Number.isFinite( model[ 'photonEmissionCountdownTimer' ] ) ? model[ 'photonEmissionCountdownTimer' ] : null,
            photons: photons.map( photon => ( {
              wavelength: photon.wavelength,
              position: readPoint( photon.positionProperty.value ),
              velocity: [ photon.vx, photon.vy ]
            } ) ),
            molecules: model.activeMolecules.map( molecule => {
              const active = molecule.activePhotonAbsorptionStrategy;
              const wavelength = wavelengths.find( value => molecule.getPhotonAbsorptionStrategyForWavelength( value ) === active );
              return {
                ...readFields( moleculeFields( molecule ) ),
                position: readPoint( molecule.centerOfGravityProperty.value ),
                velocity: readPoint( molecule.velocity ),
                rotation: molecule.currentRotationRadians,
                vibration: molecule.currentVibrationRadiansProperty.value,
                hysteresis: molecule[ 'absorptionHysteresisCountdownTime' ],
                strategy: wavelength === undefined ? null : {
                  wavelength,
                  heldTime: active[ 'photonHoldCountdownTime' ]
                },
                passing: molecule[ 'passThroughPhotonList' ].map( photon => photons.indexOf( photon ) ).filter( index => index >= 0 )
              };
            } )
          };
        },
        prepare: ( input: unknown ) => {
          const state = object( input );
          const apply = prepareFields( fields, state );
          const applyPlaying = boolean( model.runningProperty ).prepare( state.playing, 'playing' );
          const countdown = state.countdown === null ? Infinity : finite( state.countdown, -1, 10 );
          const fragments = state.target === String( PhotonTarget.SINGLE_NO2_MOLECULE ) ||
                            state.target === String( PhotonTarget.SINGLE_O3_MOLECULE );
          if ( !Array.isArray( state.photons ) || state.photons.length > 128 || !Array.isArray( state.molecules ) ||
               ( state.molecules.length !== 1 && !( fragments && state.molecules.length === 2 ) ) ) {
            throw new Error( 'Invalid Molecules and Light particles.' );
          }
          const photons = state.photons.map( input => {
            const photon = object( input );
            const wavelength = wavelengths.find( value => value === photon.wavelength );
            if ( wavelength === undefined ) { throw new Error( 'Invalid photon wavelength.' ); }
            return { wavelength, position: point( photon.position, 1e6 ), velocity: point( photon.velocity, 1e6 ) };
          } );
          const moleculeCount = state.molecules.length;
          const molecules = state.molecules.map( input => {
            const saved = object( input );
            const data = {
              position: point( saved.position, 1e10 ),
              velocity: point( saved.velocity, 1e6 ),
              rotation: finite( saved.rotation, -10, 10 ),
              vibration: finite( saved.vibration, 0, 1e12 ),
              hysteresis: finite( saved.hysteresis, -1, 10 )
            };
            const flags = {
              excited: saved.excited,
              vibrating: saved.vibrating,
              rotating: saved.rotating,
              clockwise: saved.clockwise
            };
            if ( Object.values( flags ).some( value => typeof value !== 'boolean' ) ||
                 !Array.isArray( saved.passing ) || saved.passing.length > photons.length ||
                 !saved.passing.every( index => Number.isInteger( index ) && index >= 0 && index < photons.length ) ||
                 new Set( saved.passing ).size !== saved.passing.length ) {
              throw new Error( 'Invalid Molecules and Light molecule.' );
            }
            const strategy = saved.strategy === null ? null : object( saved.strategy );
            const wavelength = strategy ? wavelengths.find( value => value === strategy.wavelength ) : null;
            if ( wavelength === undefined || strategy && moleculeCount === 2 ) {
              throw new Error( 'Invalid molecule absorption strategy.' );
            }
            const heldTime = strategy ? finite( strategy.heldTime, -1, 2 ) : 0;
            return { data, flags, passing: saved.passing as number[], wavelength, heldTime };
          } );
          // Strategy compatibility depends on the selected molecule. For each wavelength PhET only installs the
          // strategies listed here, using the same target values as the model's selector.
          const target = PhotonTarget.enumeration.values.find( value => String( value ) === state.target )!;
          const reactive = new Map( [
            [ PhotonTarget.SINGLE_CO_MOLECULE, [ 0, 1 ] ],
            [ PhotonTarget.SINGLE_N2_MOLECULE, [] ],
            [ PhotonTarget.SINGLE_O2_MOLECULE, [] ],
            [ PhotonTarget.SINGLE_CO2_MOLECULE, [ 1 ] ],
            [ PhotonTarget.SINGLE_CH4_MOLECULE, [ 1 ] ],
            [ PhotonTarget.SINGLE_H2O_MOLECULE, [ 0, 1 ] ],
            [ PhotonTarget.SINGLE_NO2_MOLECULE, [ 0, 1, 2, 3 ] ],
            [ PhotonTarget.SINGLE_O3_MOLECULE, [ 0, 1, 3 ] ]
          ] );
          if ( molecules.some( molecule => molecule.wavelength !== null && !reactive.get( target )?.includes( wavelengths.indexOf( molecule.wavelength ) ) ) ) {
            throw new Error( 'Photon wavelength cannot be absorbed by this molecule.' );
          }
          return () => {
            screen.view.interruptSubtreeInput();
            model.runningProperty.value = false;
            apply();
            model.restoreActiveMolecule();
            if ( molecules.length === 2 ) { model.activeMolecules.get( 0 ).breakApart(); }
            model.resetPhotons();
            const restoredPhotons: MicroPhoton[] = photons.map( data => {
              const photon = model.photonGroup.createNextElement( data.wavelength, data.position );
              photon.setVelocity( data.velocity.x, data.velocity.y );
              return photon;
            } );
            molecules.forEach( ( { data, flags, passing, wavelength, heldTime }, index ) => {
              const molecule = model.activeMolecules.get( index );
              prepareFields( moleculeFields( molecule ), flags )();
              molecule.velocity.set( data.velocity );
              molecule.setCenterOfGravityPosVec( data.position );
              molecule.setRotation( data.rotation );
              molecule.setVibration( data.vibration );
              molecule[ 'absorptionHysteresisCountdownTime' ] = data.hysteresis;
              if ( wavelength !== null ) {
                const strategy = molecule.getPhotonAbsorptionStrategyForWavelength( wavelength )!;
                strategy[ 'isPhotonAbsorbed' ] = true;
                strategy[ 'photonHoldCountdownTime' ] = heldTime;
                if ( strategy instanceof PhotonHoldStrategy ) { strategy[ 'absorbedWavelength' ] = wavelength; }
                molecule.activePhotonAbsorptionStrategy = strategy;
              }
              passing.forEach( index => molecule.markPhotonForPassThrough( restoredPhotons[ index ] ) );
            } );
            model[ 'photonEmissionCountdownTimer' ] = countdown;
            applyPlaying();
          };
        }
      } ]
    };
  } );
}
