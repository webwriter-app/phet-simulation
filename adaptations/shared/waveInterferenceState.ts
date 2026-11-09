// Wave Interference family WebWriter bindings. Distributed under GPL-3.0.
import type Property from '../../../axon/js/Property.js';
import type Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type EventTimer from '../../../phet-core/js/EventTimer.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import LightScene from '../../../wave-interference/js/common/model/LightScene.js';
import type Scene from '../../../wave-interference/js/common/model/Scene.js';
import SoundScene from '../../../wave-interference/js/common/model/SoundScene.js';
import WaterDrop from '../../../wave-interference/js/common/model/WaterDrop.js';
import WaterScene from '../../../wave-interference/js/common/model/WaterScene.js';
import type WaveMeterNode from '../../../wave-interference/js/common/view/WaveMeterNode.js';
import WaveMeterProbeNode from '../../../wave-interference/js/common/view/WaveMeterProbeNode.js';
import type WavesModel from '../../../wave-interference/js/waves/model/WavesModel.js';
import type WavesScreenView from '../../../wave-interference/js/waves/view/WavesScreenView.js';
import latticeState from './latticeState.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

function finite( value: unknown, min = -Infinity, max = Infinity ): number {
  if ( typeof value !== 'number' || !Number.isFinite( value ) || value < min || value > max ) {
    throw new Error( 'Invalid wave value.' );
  }
  return value;
}

function checkedBoolean( value: unknown ): boolean {
  if ( typeof value !== 'boolean' ) { throw new Error( 'Invalid wave flag.' ); }
  return value;
}

function waterState( scene: WaterScene ) {
  // A drop carries the frequency selected at launch in its absorption callback. Keep it with the drop so a later
  // slider adjustment does not change the frequency of drops already in flight.
  const frequencies = new WeakMap<WaterDrop, number>();
  const launch = scene[ 'launchWaterDrop' ].bind( scene );
  scene[ 'launchWaterDrop' ] = ( button, oscillator, sign ) => {
    const previous = scene.waterDrops.length;
    launch( button, oscillator, sign );
    if ( scene.waterDrops.length > previous ) {
      frequencies.set( scene.waterDrops[ previous ], scene.desiredFrequencyProperty.value );
    }
  };
  return {
    read: () => ( {
      lastDropTime: scene[ 'lastDropTime' ],
      drops: scene.waterDrops.map( drop => ( {
        y: drop.y, absorbed: drop.absorbed, amplitude: drop.amplitude,
        startsOscillation: drop.startsOscillation, separation: drop.sourceSeparation, sign: drop.sign,
        frequency: frequencies.get( drop ) ?? scene.desiredFrequencyProperty.value
      } ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      if ( !Array.isArray( state.drops ) || state.drops.length > 250 ) { throw new Error( 'Invalid falling water drops.' ); }
      const last = state.lastDropTime === null ? null : finite( state.lastDropTime, 0 );
      const drops = state.drops.map( input => {
        const drop = object( input );
        const amplitude = finite( drop.amplitude, scene.amplitudeProperty.range.min, scene.amplitudeProperty.range.max );
        const frequency = finite( drop.frequency, scene.frequencyProperty.range.min, scene.frequencyProperty.range.max );
        const startsOscillation = checkedBoolean( drop.startsOscillation );
        const separation = finite( drop.separation, 0, scene.desiredSourceSeparationProperty.range.max );
        const y = finite( drop.y, 0, 100 );
        const absorbed = checkedBoolean( drop.absorbed );
        if ( drop.sign !== 1 && drop.sign !== -1 ) { throw new Error( 'Invalid water source.' ); }
        const sign = drop.sign;
        return () => {
          const pulse = String( scene.disturbanceTypeProperty.value ) === 'PULSE';
          const restored = new WaterDrop( amplitude, startsOscillation, separation, sign, () => {
            if ( pulse && scene.pulseFiringProperty.value ) { return; }
            scene.amplitudeProperty.value = amplitude;
            scene.frequencyProperty.value = frequency;
            if ( scene.numberOfSources === 2 ) { scene.sourceSeparationProperty.value = separation; }
            scene.resetPhase();
            if ( pulse ) { scene.startPulse(); }
            else {
              const oscillator = sign === 1 ? scene.continuousWave1OscillatingProperty : scene.continuousWave2OscillatingProperty;
              oscillator.value = startsOscillation;
            }
          } );
          restored.y = y;
          restored.absorbed = absorbed;
          frequencies.set( restored, frequency );
          scene.waterDrops.push( restored );
        };
      } );
      return () => {
        scene.removeAllDrops();
        scene[ 'lastDropTime' ] = last;
        drops.forEach( restore => restore() );
        scene[ 'updateIsAboutToFire' ]();
      };
    }
  };
}

function soundState( scene: SoundScene ) {
  const particles = scene.soundParticles;
  return {
    read: () => particles.map( particle => [
      particle.x, particle.y, particle[ 'initialX' ], particle[ 'initialY' ], particle[ 'vx' ], particle[ 'vy' ]
    ] ),
    prepare: ( input: unknown ) => {
      if ( !Array.isArray( input ) || input.length !== particles.length ) { throw new Error( 'Invalid sound particles.' ); }
      const values = input.map( entry => {
        if ( !Array.isArray( entry ) || entry.length !== 6 ) { throw new Error( 'Invalid sound particle.' ); }
        const [ x, y, initialX, initialY, vx, vy ] = entry.map( value => finite( value ) );
        return { x, y, initialX, initialY, vx, vy };
      } );
      return () => particles.forEach( ( particle, index ) => Object.assign( particle, values[ index ] ) );
    }
  };
}

function intensityState( scene: LightScene ) {
  const sample = scene.intensitySample;
  const size = scene.lattice.height - 2 * scene.lattice.dampY;
  return {
    read: () => sample.history.map( row => row.every( value => value === 0 ) ? null : row ),
    prepare: ( input: unknown ) => {
      if ( !Array.isArray( input ) || input.length < 1 || input.length > 90 ) {
        throw new Error( 'Invalid light intensity history.' );
      }
      const rows = input.map( row => {
        if ( row === null ) { return Array<number>( size ).fill( 0 ); }
        if ( !Array.isArray( row ) || row.length !== size || !row.every( Number.isFinite ) ) {
          throw new Error( 'Invalid light intensity samples.' );
        }
        return row.slice();
      } );
      return () => {
        sample.history.splice( 0, sample.history.length, ...rows );
        sample.changedEmitter.emit();
      };
    }
  };
}

function sceneState( scene: Scene ) {
  const fields: Parameters<typeof readFields>[ 0 ] = {
    disturbance: enumeration( scene.disturbanceTypeProperty ),
    frequency: number( scene.frequencyProperty ),
    amplitude: number( scene.amplitudeProperty ),
    separation: number( scene.sourceSeparationProperty ),
    slitWidth: number( scene.slitWidthProperty ),
    slitSeparation: number( scene.slitSeparationProperty ),
    barrierPosition: vector( scene.barrierPositionProperty ),
    source1: boolean( scene.button1PressedProperty ),
    source2: boolean( scene.button2PressedProperty ),
    oscillating1: boolean( scene.continuousWave1OscillatingProperty ),
    oscillating2: boolean( scene.continuousWave2OscillatingProperty ),
    oscillator1: number( scene.oscillator1Property ),
    oscillator2: number( scene.oscillator2Property ),
    pulseFiring: boolean( scene.pulseFiringProperty ),
    time: number( scene.timeProperty, false, value => value >= 0 )
  };
  const barrier = ( scene as Scene & { barrierTypeProperty?: Property<unknown> } ).barrierTypeProperty;
  if ( barrier ) { fields.barrier = enumeration( barrier ); }
  if ( scene instanceof WaterScene ) {
    fields.desiredAmplitude = number( scene.desiredAmplitudeProperty );
    fields.desiredFrequency = number( scene.desiredFrequencyProperty );
    fields.desiredSeparation = number( scene.desiredSourceSeparationProperty );
  }
  if ( scene instanceof SoundScene ) {
    fields.soundView = enumeration( scene.soundViewTypeProperty );
    fields.tone = boolean( scene.isTonePlayingProperty );
  }
  if ( scene instanceof LightScene ) { fields.lightSound = boolean( scene.soundEffectEnabledProperty ); }

  const lattice = latticeState( scene.lattice );
  const water = scene instanceof WaterScene ? waterState( scene ) : null;
  const sound = scene instanceof SoundScene ? soundState( scene ) : null;
  const intensity = scene instanceof LightScene ? intensityState( scene ) : null;
  const masks = [ scene[ 'temporalMask1' ], scene[ 'temporalMask2' ] ];
  return {
    read: () => ( {
      controls: readFields( fields ),
      phase: scene.phase,
      pulseStart: scene[ 'pulseStartTime' ],
      pulseJustCompleted: scene[ 'pulseJustCompleted' ],
      step: scene[ 'stepIndex' ],
      skipPlaneSteps: scene[ 'stepsToSkipForPlaneWaveSources' ],
      planePhase: scene[ 'planeWavePhase' ] ?? null,
      planePressTime: scene[ 'button1PressTime' ] ?? null,
      muted: scene.muted,
      maskDeltas: masks.map( mask => mask[ 'deltas' ].map( delta => ( { ...delta } ) ) ),
      lattice: lattice.read(),
      water: water?.read() ?? null,
      particles: sound?.read() ?? null,
      intensity: intensity?.read() ?? null
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state.controls );
      const restoreLattice = lattice.prepare( state.lattice );
      const restoreWater = water?.prepare( state.water );
      const restoreSound = sound?.prepare( state.particles );
      const restoreIntensity = intensity?.prepare( state.intensity );
      const phase = finite( state.phase );
      const pulseStart = finite( state.pulseStart, 0 );
      const pulseJustCompleted = checkedBoolean( state.pulseJustCompleted );
      const step = finite( state.step, 0 );
      const skip = finite( state.skipPlaneSteps, 0, 2 );
      const planePhase = state.planePhase === null ? null : finite( state.planePhase );
      const pressTime = state.planePressTime === null ? null : finite( state.planePressTime );
      const muted = checkedBoolean( state.muted );
      if ( !Number.isSafeInteger( step ) || !Number.isInteger( skip ) ||
           !Array.isArray( state.maskDeltas ) || state.maskDeltas.length !== masks.length ) {
        throw new Error( 'Invalid wave timing.' );
      }
      const deltas = state.maskDeltas.map( series => {
        if ( !Array.isArray( series ) || series.length > 11 ) { throw new Error( 'Invalid wave source history.' ); }
        return series.map( input => {
          const delta = object( input );
          const numberOfSteps = finite( delta.numberOfSteps, 0, step );
          const verticalLatticeCoordinate = finite( delta.verticalLatticeCoordinate, 0, scene.lattice.height - 1 );
          if ( !Number.isInteger( numberOfSteps ) || !Number.isInteger( verticalLatticeCoordinate ) ) {
            throw new Error( 'Invalid wave source record.' );
          }
          return { numberOfSteps, verticalLatticeCoordinate, isSourceOn: checkedBoolean( delta.isSourceOn ) };
        } );
      } );
      return () => {
        scene.pulseFiringProperty.value = false;
        scene.button1PressedProperty.value = false;
        scene.button2PressedProperty.value = false;
        apply();
        scene.phase = phase;
        scene[ 'pulseStartTime' ] = pulseStart;
        scene[ 'pulseJustCompleted' ] = pulseJustCompleted;
        scene[ 'stepIndex' ] = step;
        scene[ 'stepsToSkipForPlaneWaveSources' ] = skip;
        if ( planePhase !== null ) { scene[ 'planeWavePhase' ] = planePhase; }
        if ( pressTime !== null ) { scene[ 'button1PressTime' ] = pressTime; }
        scene.muted = muted;
        masks.forEach( ( mask, index ) => { mask[ 'deltas' ] = deltas[ index ]; } );
        restoreWater?.();
        restoreSound?.();
        restoreLattice();
        restoreIntensity?.();
      };
    }
  };
}

type Writable<T> = { value: T };
type RuntimeWavesModel = WavesModel & {
  viewpointProperty: Property<unknown>;
  timeSpeedProperty: Property<unknown>;
  showWavesProperty: Writable<boolean>;
  showGraphProperty: Writable<boolean>;
  showScreenProperty: Writable<boolean>;
  showIntensityGraphProperty: Writable<boolean>;
  isRunningProperty: Writable<boolean>;
  isMeasuringTapeInPlayAreaProperty: Writable<boolean>;
  isWaveMeterInPlayAreaProperty: Writable<boolean>;
  rotationAmountProperty: Writable<number>;
  measuringTapeBasePositionProperty: Writable<Vector2>;
  measuringTapeTipPositionProperty: Writable<Vector2>;
  eventTimer: EventTimer;
};

function translation( node: Node ) {
  return vector( {
    get value() { return node.translation; },
    set value( position ) { node.translation = position; }
  } );
}

export function wavesState( screen: AnyScreen ) {
  const model = screen.model as RuntimeWavesModel;
  const view = screen.view as WavesScreenView & { waveMeterNode: WaveMeterNode & { backgroundNode: Node; synchronizeProbePositions: boolean } };
  const meter = view.waveMeterNode;
  const fields: Parameters<typeof readFields>[ 0 ] = {
    medium: field( model.sceneProperty, value => model.scenes.indexOf( value ), input =>
      typeof input === 'number' && Number.isInteger( input ) ? model.scenes[ input ] : undefined ),
    viewpoint: enumeration( model.viewpointProperty ),
    rotation: number( model.rotationAmountProperty, false, value => value >= 0 && value <= 1 ),
    speed: enumeration( model.timeSpeedProperty ),
    showWaves: boolean( model.showWavesProperty ),
    showGraph: boolean( model.showGraphProperty ),
    showScreen: boolean( model.showScreenProperty ),
    showIntensity: boolean( model.showIntensityGraphProperty ),
    running: boolean( model.isRunningProperty ),
    tapeVisible: boolean( model.isMeasuringTapeInPlayAreaProperty ),
    tapeBase: vector( model.measuringTapeBasePositionProperty ),
    tapeTip: vector( model.measuringTapeTipPositionProperty ),
    meterVisible: boolean( model.isWaveMeterInPlayAreaProperty ),
    meterPosition: translation( meter.backgroundNode ),
    meterProbesTogether: boolean( {
      get value() { return meter.synchronizeProbePositions; },
      set value( value ) { meter.synchronizeProbePositions = value; }
    } ),
    stopwatchVisible: boolean( model.stopwatch.isVisibleProperty ),
    stopwatchPosition: vector( model.stopwatch.positionProperty ),
    stopwatchTime: number( model.stopwatch.timeProperty ),
    stopwatchRunning: boolean( model.stopwatch.isRunningProperty )
  };
  meter.children.filter( node => node instanceof WaveMeterProbeNode ).forEach( ( node, index ) => {
    fields[ `probe${index}` ] = translation( node );
  } );
  const scenes = model.scenes.map( sceneState );
  const timer = model.eventTimer;
  return {
    isPlaying: () => model.isRunningProperty.value || ( model.rotationAmountProperty.value > 0 && model.rotationAmountProperty.value < 1 ),
    read: () => ( {
      controls: readFields( fields ),
      timer: [ timer[ 'period' ], timer[ 'timeBeforeNextEvent' ] ],
      scenes: scenes.map( item => item.read() )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      if ( !Array.isArray( state.scenes ) || state.scenes.length !== scenes.length ||
           !Array.isArray( state.timer ) || state.timer.length !== 2 ) {
        throw new Error( 'Invalid Waves screen.' );
      }
      const period = finite( state.timer[ 0 ], Number.MIN_VALUE, 1 );
      const remaining = finite( state.timer[ 1 ], Number.MIN_VALUE, period );
      const apply = prepareFields( fields, state.controls );
      const restores = state.scenes.map( ( item, index ) => scenes[ index ].prepare( item ) );
      return () => {
        screen.view.interruptSubtreeInput();
        meter.reset();
        apply();
        timer[ 'period' ] = period;
        timer[ 'timeBeforeNextEvent' ] = remaining;
        restores.forEach( restore => restore() );
      };
    }
  };
}
