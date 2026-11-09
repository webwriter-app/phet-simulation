// John Travoltage WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import Vector2 from '../../../dot/js/Vector2.js';
import { writableIsSettingPhetioStateProperty } from '../../../tandem/js/isSettingPhetioStateProperty.js';
import JohnTravoltageModel from '../john-travoltage/model/JohnTravoltageModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, number, object, prepareFields, readFields } from './stateFields.js';

function point( input: unknown, limit: number ) {
  if ( !Array.isArray( input ) || input.length !== 2 || !input.every( coordinate =>
    typeof coordinate === 'number' && Number.isFinite( coordinate ) && Math.abs( coordinate ) <= limit ) ) {
    throw new Error( 'Invalid electron position or velocity.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as JohnTravoltageModel;
    const fields = {
      armAngle: number( model.arm.angleProperty ),
      legAngle: number( model.leg.angleProperty ),
      armCue: boolean( model.arm.borderVisibleProperty ),
      legCue: boolean( model.leg.borderVisibleProperty ),
      spark: boolean( model.sparkVisibleProperty )
    };
    const segmentIndex = ( segment: ( typeof model.forceLines )[number] | null ) => segment ? model.forceLines.indexOf( segment ) : null;
    const segmentAt = ( index: unknown ) => {
      if ( index === null ) { return null; }
      if ( typeof index !== 'number' || !Number.isInteger( index ) || !model.forceLines[ index ] ) {
        throw new Error( 'Invalid electron discharge path.' );
      }
      return model.forceLines[ index ];
    };
    return {
      bridge: 'webwriter-john-travoltage/v1',
      build: 'john-travoltage@1.7.0-dev.1-webwriter.1',
      screens: [ {
        id: 'john-travoltage',
        screen,
        isPlaying: () => model.electronGroup.count > 0 || model.sparkVisibleProperty.value,
        read: () => ( {
          ...readFields( fields ),
          sparkDistance: model.sparkCreationDistToKnob ?? null,
          lastDischarge: model.numberOfElectronsDischarged,
          electrons: model.electronGroup.getArray().map( electron => ( {
            position: [ electron.positionProperty.value.x, electron.positionProperty.value.y ],
            velocity: [ electron.velocity.x, electron.velocity.y ],
            exiting: electron.exiting,
            segment: segmentIndex( electron.segment ),
            lastSegment: segmentIndex( electron.lastSegment )
          } ) )
        } ),
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( fields, state );
          const { electrons, sparkDistance, lastDischarge } = state;
          if ( !Array.isArray( electrons ) || electrons.length > JohnTravoltageModel.MAX_ELECTRONS ||
               ( sparkDistance !== null && ( typeof sparkDistance !== 'number' || !Number.isFinite( sparkDistance ) ||
                                             sparkDistance < 0 || sparkDistance > 1000 ) ) ||
               typeof lastDischarge !== 'number' || !Number.isInteger( lastDischarge ) || lastDischarge < 0 ||
               lastDischarge > JohnTravoltageModel.MAX_ELECTRONS ) {
            throw new Error( 'Invalid static discharge.' );
          }
          const restore = electrons.map( input => {
            const state = object( input );
            if ( typeof state.exiting !== 'boolean' ) { throw new Error( 'Invalid electron discharge state.' ); }
            return {
              position: point( state.position, 2000 ),
              velocity: point( state.velocity, 600 ),
              exiting: state.exiting,
              segment: segmentAt( state.segment ),
              lastSegment: segmentAt( state.lastSegment )
            };
          } );
          return () => {
            screen.view.interruptSubtreeInput();
            const setting = writableIsSettingPhetioStateProperty.value;
            writableIsSettingPhetioStateProperty.value = true;
            try {
              model.reset();
              model.electronsToRemove.length = 0;
              restore.forEach( saved => {
                const electron = model.electronGroup.createNextElement();
                electron.positionProperty.value = saved.position;
                electron.velocity.set( saved.velocity );
                electron.exiting = saved.exiting;
                electron.segment = saved.segment;
                electron.lastSegment = saved.lastSegment;
              } );
              apply();
              model.sparkCreationDistToKnob = sparkDistance ?? undefined;
              model.legAngleAtPreviousStep = model.leg.angleProperty.value;
              model.numberOfElectronsDischarged = lastDischarge;
              if ( state.spark ) { model.dischargeStartedEmitter.emit(); }
            }
            finally {
              writableIsSettingPhetioStateProperty.value = setting;
            }
          };
        }
      } ]
    };
  } );
}
