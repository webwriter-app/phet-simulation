// Wave on a String WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import { writableIsSettingPhetioStateProperty } from '../../../tandem/js/isSettingPhetioStateProperty.js';
import WOASModel from '../wave-on-a-string/model/WOASModel.js';
import { FRAME_DURATION, NUMBER_OF_BEADS } from '../wave-on-a-string/WOASConstants.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields, vector } from './stateFields.js';

function prepareWave( input: unknown ) {
  const state = object( input );
  const samples = ( value: unknown ) => {
    if ( !Array.isArray( value ) || value.length !== NUMBER_OF_BEADS || !value.every( Number.isFinite ) ) {
      throw new Error( 'Invalid Wave on a String samples.' );
    }
    return value;
  };
  const finite = ( value: unknown, min: number, max = Infinity ) => {
    if ( typeof value !== 'number' || !Number.isFinite( value ) || value < min || value > max ) {
      throw new Error( 'Invalid Wave on a String phase.' );
    }
    return value;
  };
  if ( typeof state._pulsePending !== 'boolean' || ( state._pulseSign !== 1 && state._pulseSign !== -1 ) ) {
    throw new Error( 'Invalid Wave on a String pulse.' );
  }
  return {
    _yDraw: samples( state._yDraw ),
    _yNow: samples( state._yNow ),
    _yLast: samples( state._yLast ),
    _yNext: samples( state._yNext ),
    _lastDt: finite( state._lastDt, 0 ),
    _pulsePending: state._pulsePending,
    _pulseSign: state._pulseSign,
    _nextLeftY: finite( state._nextLeftY, -Infinity ),
    _stepDt: finite( state._stepDt, 0, FRAME_DURATION ),
    _timeElapsed: finite( state._timeElapsed, 0 )
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const [ screen ] = sim.simScreens;
    const model = screen.model as WOASModel;
    const stopwatch = model.stopwatch;
    const fields = {
      mode: enumeration( model.waveModeProperty ),
      end: enumeration( model.stringEndTypeProperty ),
      speed: enumeration( model.timeSpeedProperty ),
      playing: boolean( model.isPlayingProperty ),
      rulers: boolean( model.rulersVisibleProperty ),
      referenceLine: boolean( model.referenceLineVisibleProperty ),
      horizontalRuler: vector( model.horizontalRulerPositionProperty ),
      verticalRuler: vector( model.verticalRulerPositionProperty ),
      referenceLinePosition: vector( model.referenceLinePositionProperty ),
      tension: number( model.tensionProperty ),
      damping: number( model.dampingProperty ),
      frequency: number( model.frequencyProperty ),
      pulseWidth: number( model.pulseWidthProperty ),
      amplitude: number( model.amplitudeProperty ),
      angle: number( model.angleProperty ),
      pulseActive: boolean( model.isPulseActiveProperty ),
      stringStill: boolean( model.isStringStillProperty ),
      stopwatchVisible: boolean( stopwatch.isVisibleProperty ),
      stopwatchPosition: vector( stopwatch.positionProperty ),
      stopwatchTime: number( stopwatch.timeProperty ),
      stopwatchRunning: boolean( stopwatch.isRunningProperty )
    };
    return {
      bridge: 'webwriter-wave-on-a-string/v1',
      build: 'wave-on-a-string@1.3.0-dev.0-webwriter.1',
      screens: [ {
        id: 'wave-on-a-string', screen,
        isPlaying: () => model.isPlayingProperty.value && ( !model.isStringStillProperty.value ||
          model.stopwatch.isRunningProperty.value || model[ 'pulsePendingProperty' ].value ||
          model.isPulseActiveProperty.value || String( model.waveModeProperty.value ) === 'OSCILLATE' ),
        read: () => ( {
          ...readFields( fields ),
          wave: WOASModel.WOASModelIO.toStateObject( model )
        } ),
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( fields, state );
          const wave = prepareWave( state.wave );
          return () => {
            screen.view.interruptSubtreeInput();
            const settingState = writableIsSettingPhetioStateProperty.value;
            writableIsSettingPhetioStateProperty.value = true;
            try {
              apply();
              WOASModel.WOASModelIO.applyState( model, wave );
              model.isStringStillProperty.value = state.stringStill as boolean;
            }
            finally {
              writableIsSettingPhetioStateProperty.value = settingState;
            }
          };
        }
      } ]
    };
  } );
}
