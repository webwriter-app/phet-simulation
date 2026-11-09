// Sound Waves WebWriter state adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import PressureModel from '../air-pressure/PressureModel.js';
import type SoundWavesModel from '../common/model/SoundWavesModel.js';
import IntroModel from '../intro/IntroModel.js';
import MeasureModel from '../measure/MeasureModel.js';
import ReflectionModel from '../reflection/ReflectionModel.js';
import TwoSourceModel from '../two-sources/TwoSourceModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import latticeState from './latticeState.js';
import { boolean, enumeration, number, object, prepareFields, readFields, vector } from './stateFields.js';

const screenIds = [ 'single-source', 'measure', 'two-sources', 'reflection', 'air-pressure' ];

function finite( value: unknown, min: number, max = Number.MAX_SAFE_INTEGER ): value is number {
  return typeof value === 'number' && Number.isFinite( value ) && value >= min && value <= max;
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-sound-waves/v1',
    build: 'sound-waves@1.2.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => {
      const model = screen.model as SoundWavesModel;
      const timer = model[ 'eventTimer' ];
      const lattice = latticeState( model.lattice );
      const fields = {
        playing: boolean( model.isRunningProperty ),
        audio: boolean( model.isAudioEnabledProperty ),
        frequency: number( model.frequencyProperty ),
        amplitude: number( model.amplitudeProperty ),
        time: number( model[ 'timeProperty' ], false, value => value >= 0 ),
        oscillator: number( model.oscillatorProperty ),
        pulse: boolean( model.isPulseFiringProperty ),
        ...( model instanceof IntroModel || model instanceof PressureModel ? {
          audioSource: enumeration( model.audioControlSettingProperty ),
          listener: vector( model.listenerPositionProperty )
        } : {} ),
        ...( model instanceof PressureModel ? { pressure: number( model.pressureProperty ) } : {} ),
        ...( model instanceof TwoSourceModel ? {
          listener: vector( model.listenerPositionProperty ),
          speaker: vector( model.speaker2PositionProperty )
        } : {} ),
        ...( model instanceof ReflectionModel ? {
          soundMode: enumeration( model.soundModeProperty ),
          wall: number( model.wallPositionXProperty ),
          wallAngle: number( model.wallAngleProperty )
        } : {} ),
        ...( model instanceof MeasureModel ? {
          ruler: vector( model.rulerPositionProperty ),
          stopwatch: number( model.stopwatch.timeProperty ),
          stopwatchVisible: boolean( model.stopwatch.isVisibleProperty ),
          stopwatchRunning: boolean( model.stopwatch.isRunningProperty ),
          stopwatchPosition: vector( model.stopwatch.positionProperty )
        } : {} )
      };
      return {
        id: screenIds[ index ],
        screen,
        isPlaying: () => model.isRunningProperty.value,
        read: () => ( {
          ...readFields( fields ),
          lattice: lattice.read(),
          phase: model[ 'phase' ],
          steps: model[ 'stepIndex' ],
          pulseStart: model[ 'pulseStartTime' ],
          timerRemaining: timer[ 'timeBeforeNextEvent' ]
        } ),
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( fields, state );
          const applyLattice = lattice.prepare( state.lattice );
          const { phase, steps, pulseStart, timerRemaining } = state;
          if ( !finite( phase, -Number.MAX_SAFE_INTEGER ) || !finite( steps, 0 ) || !Number.isInteger( steps ) ||
               ( pulseStart !== null && !finite( pulseStart, 0 ) ) ||
               !finite( timerRemaining, 0, timer[ 'period' ] ) ) {
            throw new Error( 'Invalid sound wave timing.' );
          }
          return () => {
            screen.view.interruptSubtreeInput();
            apply();
            model[ 'phase' ] = phase;
            model[ 'stepIndex' ] = steps;
            model[ 'pulseStartTime' ] = pulseStart;
            timer[ 'timeBeforeNextEvent' ] = timerRemaining;
            applyLattice();
          };
        }
      };
    } )
  } ) );
}
