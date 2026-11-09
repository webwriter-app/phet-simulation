// Concentration WebWriter adapter. Distributed under GPL-3.0.
import type ConcentrationModel from '../../../beers-law-lab/js/concentration/model/ConcentrationModel.js';
import type SoluteParticleGroup from '../../../beers-law-lab/js/concentration/model/SoluteParticleGroup.js';
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import installSimulationBridge from './installSimulationBridge.js';
import { enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

function coordinates( vector: Vector2 ): number[] {
  return [ vector.x, vector.y ];
}

function point( value: unknown, limit: number ): Vector2 {
  if ( !Array.isArray( value ) || value.length !== 2 ||
       !value.every( coordinate => Number.isFinite( coordinate ) && Math.abs( coordinate ) <= limit ) ) {
    throw new Error( 'Invalid solute particle motion.' );
  }
  return new Vector2( value[ 0 ], value[ 1 ] );
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as ConcentrationModel;
    const particles = model.shakerParticles;
    const group = ( particles as unknown as { particleGroup: SoluteParticleGroup } ).particleGroup;
    const fields = {
      solute: field( model.soluteProperty, solute => solute.tandemName,
        name => model.solutes.find( solute => solute.tandemName === name ) ),
      form: enumeration( model.soluteFormProperty ),
      volume: number( model.solution.volumeProperty ),
      moles: number( model.solution.soluteMolesProperty ),
      shaker: vector( model.shaker.positionProperty ),
      probe: vector( model.concentrationMeter.probe.positionProperty ),
      probeJumpIndex: number( model.concentrationProbeJumpPositionIndexProperty, true,
        index => index >= 0 && index < model.concentrationProbeJumpPositions.length )
    };

    return {
      bridge: 'webwriter-concentration/v1',
      build: 'concentration@1.9.0-dev.0-webwriter.1',
      screens: [ {
        id: 'concentration',
        screen,
        isPlaying: () => particles.numberOfParticles > 0 ||
          model.solventFaucet.flowRateProperty.value > 0 || model.drainFaucet.flowRateProperty.value > 0 ||
          model.dropper.flowRateProperty.value > 0 || model.evaporator.evaporationRateProperty.value > 0,
        read: () => ( {
          solution: readFields( fields ),
          particles: particles.getParticlesReference().map( particle => ( {
            solute: particle.solute.tandemName,
            position: coordinates( particle.positionProperty.value ),
            orientation: particle.orientation,
            velocity: coordinates( particle.velocity ),
            acceleration: coordinates( particle.acceleration )
          } ) )
        } ),
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( fields, state.solution );
          if ( !Array.isArray( state.particles ) || state.particles.length > 1000 ) {
            throw new Error( 'Invalid solute particle count.' );
          }
          const restoredParticles = state.particles.map( input => {
            const state = object( input );
            const solute = model.solutes.find( solute => solute.tandemName === state.solute );
            const { orientation } = state;
            if ( !solute || typeof orientation !== 'number' || !Number.isFinite( orientation ) || Math.abs( orientation ) > 2 * Math.PI ) {
              throw new Error( 'Invalid solute particle.' );
            }
            return { solute, orientation, position: point( state.position, 1e4 ),
              velocity: point( state.velocity, 1e5 ), acceleration: point( state.acceleration, 1e5 ) };
          } );
          return () => {
            screen.view.interruptSubtreeInput();
            model.reset();
            apply();
            restoredParticles.forEach( ( { solute, orientation, position, velocity, acceleration } ) => {
              group.createNextElement( solute, position, orientation, velocity, acceleration );
            } );
            model.solution.updateIsSaturatedProperty();
          };
        }
      } ]
    };
  } );
}
