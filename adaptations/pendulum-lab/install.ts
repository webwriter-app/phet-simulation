// Pendulum Lab WebWriter adapter. Distributed under GPL-3.0.
import Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Body from '../common/model/Body.js';
import Pendulum from '../common/model/Pendulum.js';
import PendulumLabModel from '../common/model/PendulumLabModel.js';
import EnergyModel from '../energy/model/EnergyModel.js';
import LabModel from '../lab/model/LabModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

const screenIds = [ 'intro', 'energy', 'lab' ];
const bodies = new Map( [
  [ 'moon', Body.MOON ], [ 'earth', Body.EARTH ], [ 'jupiter', Body.JUPITER ],
  [ 'planet-x', Body.PLANET_X ], [ 'custom', Body.CUSTOM ]
] );

function pendulumState( pendulum: Pendulum ) {
  const fields = {
    length: number( pendulum.lengthProperty, false, value => pendulum.lengthRange.contains( value ) ),
    mass: number( pendulum.massProperty, false, value => pendulum.massRange.contains( value ) ),
    angle: number( pendulum.angleProperty, false, value => Math.abs( value ) <= Math.PI ),
    angularVelocity: number( pendulum.angularVelocityProperty ),
    thermalEnergy: number( pendulum.thermalEnergyProperty ),
    tickVisible: boolean( pendulum.isTickVisibleProperty )
  };
  const trace = pendulum.periodTrace;
  const traceVisibility = { visible: boolean( trace.isVisibleProperty ) };
  const traceFields = {
    time: number( trace.elapsedTimeProperty ),
    points: number( trace.numberOfPointsProperty, true, value => value >= 0 && value <= 4 )
  };

  return {
    read: () => ( {
      ...readFields( fields ),
      trace: {
        ...readFields( traceVisibility ),
        ...readFields( traceFields ),
        counterClockwise: trace.counterClockwise,
        firstAngle: trace.firstAngle,
        secondAngle: trace.secondAngle
      }
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const traceState = object( state.trace );
      const applyTraceVisibility = prepareFields( traceVisibility, traceState );
      const applyTrace = prepareFields( traceFields, traceState );
      const { counterClockwise, firstAngle, secondAngle } = traceState;
      const validAngle = ( angle: unknown ) => angle === null || typeof angle === 'number' && Math.abs( angle ) <= Math.PI;
      if ( ( counterClockwise !== null && typeof counterClockwise !== 'boolean' ) ||
           !validAngle( firstAngle ) || !validAngle( secondAngle ) ) {
        throw new Error( 'Invalid pendulum period trace.' );
      }
      return {
        apply: () => {
          apply();
          pendulum.updateDerivedVariables( false );
        },
        applyTrace: () => {
          trace.resetPathPoints();
          // Visibility changes clear the trace, so set visibility before its points.
          applyTraceVisibility();
          trace.counterClockwise = counterClockwise;
          trace.firstAngle = firstAngle as number | null;
          trace.secondAngle = secondAngle as number | null;
          applyTrace();
        }
      };
    }
  };
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as PendulumLabModel;
  const pendula = model.pendula.map( pendulumState );
  const controls = {
    body: field( model.bodyProperty, body => [ ...bodies ].find( ( [ , value ] ) => value === body )![ 0 ],
      value => typeof value === 'string' ? bodies.get( value ) : undefined ),
    customGravity: number( model.customGravityProperty, false, value => model.gravityRange.contains( value ) ),
    friction: number( model.frictionProperty, false, value => model.frictionRange.contains( value ) ),
    timeSpeed: number( model.timeSpeedProperty, false, value => value === 1 || value === 1 / 8 ),
    numberOfPendula: number( model.numberOfPendulaProperty, true, value => value === 1 || value === 2 ),
    periodTraceVisible: boolean( model.isPeriodTraceVisibleProperty ),
    ...( model instanceof EnergyModel ? {
      energyExpanded: boolean( model.isEnergyBoxExpandedProperty ),
      energyZoom: number( model.energyZoomProperty, false, value => value > 0 ),
      energyPendulum: field( model.activeEnergyPendulumProperty, value => model.pendula.indexOf( value ),
        value => value === 0 || value === 1 ? model.pendula[ value ] : undefined )
    } : {} ),
    ...( model instanceof LabModel ? {
      velocityVisible: boolean( model.isVelocityVisibleProperty ),
      accelerationVisible: boolean( model.isAccelerationVisibleProperty )
    } : {} )
  };
  const ruler = {
    visible: boolean( model.ruler.isVisibleProperty ),
    position: vector( model.ruler.positionProperty )
  };
  const stopwatch = {
    visible: boolean( model.stopwatch.isVisibleProperty ),
    position: vector( model.stopwatch.positionProperty ),
    time: number( model.stopwatch.timeProperty ),
    running: boolean( model.stopwatch.isRunningProperty )
  };
  const timer = model instanceof LabModel ? model.periodTimer : null;
  const timerFields = timer && {
    pendulum: number( timer.activePendulumIndexProperty, true, value => value === 0 || value === 1 ),
    position: vector( timer.positionProperty ),
    running: boolean( timer.isRunningProperty )
  };
  const timerTime = timer && { time: number( timer.elapsedTimeProperty, false, value => value >= 0 ) };
  const playback = { playing: boolean( model.isPlayingProperty ) };

  return {
    isPlaying: () => model.isPlayingProperty.value &&
                     ( model.stopwatch.isRunningProperty.value ||
                       model.pendula.slice( 0, model.numberOfPendulaProperty.value ).some( pendulum =>
                         pendulum.angleProperty.value !== 0 || pendulum.angularVelocityProperty.value !== 0 ) ),
    read: () => ( {
      ...readFields( playback ),
      controls: readFields( controls ),
      pendula: pendula.map( pendulum => pendulum.read() ),
      ruler: readFields( ruler ),
      stopwatch: readFields( stopwatch ),
      ...( timerFields && timerTime ? { periodTimer: { ...readFields( timerFields ), ...readFields( timerTime ) } } : {} )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      if ( !Array.isArray( state.pendula ) || state.pendula.length !== pendula.length ) {
        throw new Error( 'Invalid pendulum count.' );
      }
      const pendulumStates = state.pendula;
      const applyPendula = pendula.map( ( pendulum, index ) => pendulum.prepare( pendulumStates[ index ] ) );
      const applyControls = prepareFields( controls, state.controls );
      const applyRuler = prepareFields( ruler, state.ruler );
      const applyStopwatch = prepareFields( stopwatch, state.stopwatch );
      const applyTimer = timerFields && prepareFields( timerFields, state.periodTimer );
      const applyTimerTime = timerTime && prepareFields( timerTime, state.periodTimer );
      const applyPlayback = prepareFields( playback, state );
      return () => {
        screen.view.interruptSubtreeInput();
        model.isPlayingProperty.value = false;
        if ( timer ) {
          timer.isRunningProperty.value = false;
        }
        applyControls();
        // Body selection has listeners of its own. Restore the custom gravity after them.
        if ( model.bodyProperty.value === Body.CUSTOM ) {
          model.gravityProperty.value = model.customGravityProperty.value;
        }
        applyPendula.forEach( pendulum => pendulum.apply() );
        applyRuler();
        applyStopwatch();
        applyTimer?.();
        applyPendula.forEach( pendulum => pendulum.applyTrace() );
        applyTimerTime?.();
        applyPlayback();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-pendulum-lab/v1',
    build: 'pendulum-lab@1.1.0-dev.5-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( {
      id: screenIds[ index ], screen, ...screenState( screen )
    } ) )
  } ) );
}
