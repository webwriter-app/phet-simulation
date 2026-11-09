// State adapter for PhET Neuron. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import VSlider from '../../../sun/js/VSlider.js';
import AxonMembraneState from '../neuron/model/AxonMembraneState.js';
import DelayBuffer from '../neuron/model/DelayBuffer.js';
import type NeuronClockModelAdapter from '../neuron/model/NeuronClockModelAdapter.js';
import type MembraneChannel from '../neuron/model/MembraneChannel.js';
import type Particle from '../neuron/model/Particle.js';
import type NeuronModelState from '../neuron/model/NeuronModelState.js';
import ParticleFactory from '../neuron/model/ParticleFactory.js';
import ParticleType from '../neuron/model/ParticleType.js';
import SlowBrownianMotionStrategy from '../neuron/model/SlowBrownianMotionStrategy.js';
import SodiumDualGatedChannel from '../neuron/model/SodiumDualGatedChannel.js';
import TimedFadeAwayStrategy from '../neuron/model/TimedFadeAwayStrategy.js';
import TravelingActionPotentialState from '../neuron/model/TravelingActionPotentialState.js';
import DataPoint from '../neuron/recordandplayback/DataPoint.js';
import MembranePotentialChart from '../neuron/view/chart/MembranePotentialChart.js';
import ZoomControl from '../neuron/view/ZoomControl.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields } from './stateFields.js';

const coefficients = [ 'ah', 'h', 'bh', 'am', 'm', 'bm', 'an', 'n', 'bn', 'v', 'timeSinceActionPotential' ] as const;
const conductance = [ 'n4', 'm3h', 'elapsedTime', 'timeRemainder' ] as const;
const concentration = [ 'sodiumInteriorConcentration', 'sodiumExteriorConcentration',
  'potassiumInteriorConcentration', 'potassiumExteriorConcentration' ] as const;
const gateStates = [ 'IDLE', 'OPENING', 'BECOMING_INACTIVE', 'INACTIVATED', 'RESETTING' ];
const types = [ ParticleType.SODIUM_ION, ParticleType.POTASSIUM_ION ];

function list( input: unknown, max: number, length?: number ): unknown[] {
  if ( !Array.isArray( input ) || input.length > max || length !== undefined && input.length !== length ) {
    throw new Error( 'Invalid Neuron list.' );
  }
  return input;
}
function finite( input: unknown, min = -1e12, max = 1e12 ) {
  if ( typeof input !== 'number' || !Number.isFinite( input ) || input < min || input > max ) {
    throw new Error( 'Invalid Neuron measurement.' );
  }
  return input;
}
function integer( input: unknown, min: number, max: number ) {
  const value = finite( input, min, max );
  if ( !Number.isInteger( value ) ) { throw new Error( 'Invalid Neuron index.' ); }
  return value;
}
function flag( input: unknown ) {
  if ( typeof input !== 'boolean' ) { throw new Error( 'Invalid Neuron flag.' ); }
  return input;
}
function timer( input: unknown ) { return input === null ? Infinity : finite( input ); }
function readTimer( value: number ) { return Number.isFinite( value ) ? value : null; }

function readBuffer( buffer: DelayBuffer ) {
  return {
    filling: buffer.filling, uniform: buffer.allDeltaTimesEqual, delta: buffer.previousDeltaTime,
    count: buffer.countAtThisDeltaTime, head: buffer.head, tail: buffer.tail,
    elements: buffer.delayElements.map( entry => [ entry.value, entry.deltaTime ] )
  };
}
function prepareBuffer( input: unknown, length: number ) {
  const data = object( input );
  const buffer = new DelayBuffer( length, 1 );
  buffer.filling = flag( data.filling );
  buffer.allDeltaTimesEqual = flag( data.uniform );
  buffer.previousDeltaTime = finite( data.delta );
  buffer.countAtThisDeltaTime = integer( data.count, 0, 1e9 );
  buffer.head = integer( data.head, 0, length - 1 );
  buffer.tail = integer( data.tail, 0, length - 1 );
  list( data.elements, length, length ).forEach( ( entry, i ) => {
    const [ value, delta ] = list( entry, 2, 2 );
    buffer.delayElements[ i ].setValueAndTime( finite( value ), finite( delta, 0 ) );
  } );
  return buffer;
}
function readParticle( particle: ReturnType<NeuronModelState['getPlaybackParticleMementos']>[number] ) {
  return [ types.indexOf( particle.getParticleType() ), particle.getPositionX(), particle.getPositionY(), particle.getOpacity() ];
}
function prepareParticle( input: unknown ) {
  const [ type, x, y, opacity ] = list( input, 4, 4 );
  return { type: types[ integer( type, 0, types.length - 1 ) ], x: finite( x, -1e5, 1e5 ),
    y: finite( y, -1e5, 1e5 ), opacity: finite( opacity, 0, 1 ) };
}

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const clock = screen.model as NeuronClockModelAdapter;
    const model = clock.model;
    const hh = model.hodgkinHuxleyModel;
    const chart = screen.view.children.find( child => child instanceof MembranePotentialChart ) as MembranePotentialChart;
    const zoom = screen.view.children.find( child => child instanceof ZoomControl )?.children.find( child => child instanceof VSlider );
    if ( !( zoom instanceof VSlider ) || !chart ) { throw new Error( 'Missing Neuron view controls.' ); }
    const fields = {
      potentialChart: boolean( model.potentialChartVisibleProperty ),
      charges: boolean( model.chargesShownProperty ),
      concentration: boolean( model.concentrationReadoutVisibleProperty ),
      allIons: boolean( model.allIonsSimulatedProperty ),
      speed: enumeration( clock.timeSpeedProperty ),
      zoom: number( ( zoom as unknown as { _valueProperty: { value: number } } )._valueProperty, false, value => value >= 0.7 && value <= 6 )
    };
    const channels = model.membraneChannels.slice() as MembraneChannel[];
    const readFrame = ( frame: NeuronModelState ) => {
      const travel = frame.getAxonMembraneState().getTravelingActionPotentialState();
      const state = frame.getHodgkinHuxleyModelState();
      return {
        travel: travel ? [ readTimer( travel.getTravelTimeCountdownTimer() ), readTimer( travel.getLingerCountdownTimer() ) ] : null,
        kinetics: coefficients.map( key => readTimer( state[ key ] ) ),
        membrane: frame.getMembranePotential(),
        concentrations: [ frame.getSodiumInteriorConcentration(), frame.getSodiumExteriorConcentration(),
          frame.getPotassiumInteriorConcentration(), frame.getPotassiumExteriorConcentration() ],
        channels: channels.map( channel => {
          const values = frame.getMembraneChannelStateMap().get( channel );
          return [ values.openness, values.inactivationAmount, readTimer( values.captureCountdownTimer ),
            ...( channel instanceof SodiumDualGatedChannel ? [
              values.previousNormalizedConductance, gateStates.indexOf( values.gateState ), readTimer( values.stateTransitionTimer )
            ] : [] ) ];
        } ),
        particles: frame.getPlaybackParticleMementos().map( readParticle )
      };
    };
    const prepareFrame = ( input: unknown, buffers: [ DelayBuffer, DelayBuffer ] ) => {
      const data = object( input );
      const travel = data.travel === null ? null : list( data.travel, 2, 2 );
      const kinetics = list( data.kinetics, coefficients.length, coefficients.length );
      const values = Object.fromEntries( coefficients.map( ( key, i ) =>
        [ key, key === 'timeSinceActionPotential' ? timer( kinetics[ i ] ) : finite( kinetics[ i ] ) ] ) );
      const concentrations = list( data.concentrations, 4, 4 ).map( value => finite( value, 0 ) );
      const membrane = finite( data.membrane, -1e3, 1e3 );
      const channelStates = list( data.channels, channels.length, channels.length ).map( ( input, i ) => {
        const gated = channels[ i ] instanceof SodiumDualGatedChannel;
        const [ openness, inactivationAmount, capture, normalized, gate, transition ] = list( input, gated ? 6 : 3, gated ? 6 : 3 );
        return {
          type: channels[ i ].getChannelType(),
          openness: finite( openness, 0, 1 ), inactivationAmount: finite( inactivationAmount, 0, 1 ),
          captureCountdownTimer: timer( capture ),
          ...( gated ? {
            previousNormalizedConductance: finite( normalized ),
            gateState: gateStates[ integer( gate, 0, gateStates.length - 1 ) ],
            stateTransitionTimer: timer( transition )
          } : {} )
        };
      } );
      const particles = list( data.particles, 2048 ).map( prepareParticle );
      const tap = travel ? new TravelingActionPotentialState( timer( travel[ 0 ] ), timer( travel[ 1 ] ) ) : null;
      const axon = new AxonMembraneState( tap );
      const mementos = particles.map( data => {
        const particle = ParticleFactory.createParticle( data.type as unknown as Parameters<typeof ParticleFactory.createParticle>[0] );
        particle.setPosition( data.x, data.y );
        particle.setOpacity( data.opacity );
        return particle.getPlaybackMemento();
      } );
      const state = {
        getAxonMembraneState: () => axon,
        getHodgkinHuxleyModelState: () => ( { ...values, m3hDelayBuffer: buffers[ 0 ].getCopy(), n4DelayBuffer: buffers[ 1 ].getCopy() } ),
        getMembraneChannelStateMap: () => ( { get: ( channel: MembraneChannel ) => channelStates[ channels.indexOf( channel ) ] } ),
        getMembranePotential: () => membrane,
        getSodiumInteriorConcentration: () => concentrations[ 0 ],
        getSodiumExteriorConcentration: () => concentrations[ 1 ],
        getPotassiumInteriorConcentration: () => concentrations[ 2 ],
        getPotassiumExteriorConcentration: () => concentrations[ 3 ],
        getPlaybackParticleMementos: () => mementos
      };
      return { state, concentrations, particles };
    };
    return {
      bridge: 'webwriter-neuron/v1',
      build: 'neuron@1.2.0-dev.0-webwriter.1',
      screens: [ {
        id: 'neuron',
        screen,
        isPlaying: () => clock.playingProperty.value && ( model.isRecord() || model.isPlayback() || model.isActionPotentialInProgress() ),
        read: () => {
          const history = model.recordHistory.slice() as DataPoint[];
          const display = model.isPlayback() ? model.neuronModelPlaybackStateProperty.value : model.getState();
          return {
            ...readFields( fields ),
            playing: clock.playingProperty.value,
            modelPlaying: model.playingProperty.value,
            mode: model.isPlayback() ? 'playback' : model.isRecord() ? 'record' : 'live',
            time: model.getTime(),
            residual: clock.residualTime,
            stimulus: model.stimulusPulseInitiatedProperty.value,
            lockout: model.stimulusLockoutProperty.value,
            frame: readFrame( display || model.getState() ),
            buffers: [ readBuffer( hh.m3hDelayBuffer ), readBuffer( hh.n4DelayBuffer ) ],
            conductance: conductance.map( key => hh[ key ] ),
            history: history.map( point => [ point.getTime(), readFrame( point.getState() as NeuronModelState ) ] ),
            background: model.backgroundParticles.map( ( particle: Particle ) => readParticle( particle.getPlaybackMemento() ) ),
            transient: ( model.isPlayback() ? model.transientParticlesBackup : model.transientParticles )
              .map( ( particle: Particle ) => readParticle( particle.getPlaybackMemento() ) ),
            chart: {
              start: chart.timeIndexOfFirstDataPt,
              timer: chart.updateCountdownTimer,
              full: chart.chartIsFull === true,
              points: Array.from( { length: chart.dataSeries.getLength() }, ( _, i ) => {
                const point = chart.dataSeries.getDataPoint( i );
                return [ point.x, point.y ];
              } )
            }
          };
        },
        prepare: ( input: unknown ) => {
          const data = object( input );
          const apply = prepareFields( fields, data );
          const playing = flag( data.playing );
          const modelPlaying = flag( data.modelPlaying );
          const stimulus = flag( data.stimulus );
          const lockout = flag( data.lockout );
          const time = finite( data.time, 0 );
          const residual = finite( data.residual, 0, 1 );
          if ( data.mode !== 'live' && data.mode !== 'record' && data.mode !== 'playback' ) {
            throw new Error( 'Invalid Neuron mode.' );
          }
          const bufferData = list( data.buffers, 2, 2 );
          const buffers: [ DelayBuffer, DelayBuffer ] = [
            prepareBuffer( bufferData[ 0 ], hh.m3hDelayBuffer.numEntries ),
            prepareBuffer( bufferData[ 1 ], hh.n4DelayBuffer.numEntries )
          ];
          const liveConductance = list( data.conductance, conductance.length, conductance.length ).map( value => finite( value ) );
          const frame = prepareFrame( data.frame, buffers );
          let previous = -1;
          const history = list( data.history, 50000 ).map( entry => {
            const [ at, saved ] = list( entry, 2, 2 );
            previous = finite( at, Math.max( 0, previous ) );
            return new DataPoint( previous, prepareFrame( saved, buffers ).state );
          } );
          if ( data.mode === 'playback' && history.length === 0 ) { throw new Error( 'Missing Neuron playback history.' ); }
          const background = list( data.background, 2048 ).map( prepareParticle );
          const transient = list( data.transient, 2048 ).map( prepareParticle );
          const chartData = object( data.chart );
          const chartStart = finite( chartData.start, 0 );
          const chartTimer = finite( chartData.timer );
          const chartFull = flag( chartData.full );
          const points = list( chartData.points, 10000 ).map( input => {
            const [ x, y ] = list( input, 2, 2 );
            return [ finite( x, 0, 25 ), finite( y, -1e3, 1e3 ) ];
          } );
          return () => {
            screen.view.interruptSubtreeInput();
            clock.reset();
            clock.playingProperty.value = false;
            apply();
            model.stimulusPulseInitiatedProperty.value = stimulus;
            model.recordHistory.clear();
            history.forEach( point => model.addRecordedPoint( point ) );
            model.removeAllParticles();
            background.forEach( data => {
              const particle = model.createBackgroundParticle( data.type );
              particle.setPosition( data.x, data.y );
              particle.setOpacity( data.opacity );
              particle.setMotionStrategy( new SlowBrownianMotionStrategy( data.x, data.y ) );
            } );
            transient.forEach( data => {
              const particle = model.createTransientParticle( data.type, null );
              particle.setPosition( data.x, data.y );
              particle.setOpacity( data.opacity );
              particle.setFadeStrategy( new TimedFadeAwayStrategy( 0.0008 ) );
            } );
            model.setMode( data.mode === 'playback' ? model.playbackMode : data.mode === 'record' ? model.recordMode : model.liveMode );
            model.setTime( time );
            model.setPlaybackState( frame.state );
            hh.m3hDelayBuffer = buffers[ 0 ];
            hh.n4DelayBuffer = buffers[ 1 ];
            conductance.forEach( ( key, i ) => { hh[ key ] = liveConductance[ i ]; } );
            concentration.forEach( ( key, i ) => { model[ key ] = frame.concentrations[ i ]; } );
            if ( !model.isPlayback() ) { model.playbackParticles.clear(); }
            model.stimulusLockoutProperty.value = lockout;
            chart.dataSeries.clear();
            points.forEach( ( [ x, y ] ) => chart.dataSeries.addXYDataPoint( x, y ) );
            chart.timeIndexOfFirstDataPt = chartStart;
            chart.updateCountdownTimer = chartTimer;
            chart.chartIsFull = chartFull;
            chart.mostRecentXValue = points.at( -1 )?.[ 0 ] ?? 0;
            chart.mostRecentYValue = points.at( -1 )?.[ 1 ] ?? 0;
            chart.updateChartCursor();
            clock.residualTime = residual;
            model.setPlaying( modelPlaying );
            model.particlesMoved.emit();
            clock.playingProperty.value = playing;
          };
        }
      } ]
    };
  } );
}
