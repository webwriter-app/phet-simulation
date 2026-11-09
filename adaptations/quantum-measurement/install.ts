// State adapter for PhET Quantum Measurement. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import type BlochSphereModel from '../bloch-sphere/model/BlochSphereModel.js';
import type AveragingCounterNumberProperty from '../common/model/AveragingCounterNumberProperty.js';
import Photon from '../photons/model/Photon.js';
import type PhotonsExperimentSceneModel from '../photons/model/PhotonsExperimentSceneModel.js';
import type PhotonsModel from '../photons/model/PhotonsModel.js';
import type PhotonsExperimentSceneView from '../photons/view/PhotonsExperimentSceneView.js';
import type PhotonsScreenView from '../photons/view/PhotonsScreenView.js';
import { ParticleWithSpin } from '../spin/model/ParticleWithSpin.js';
import type SpinModel from '../spin/model/SpinModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { coinsState, quantumPreferences } from './quantumCoinsState.js';
import { boolean, enumeration, number, object, prepareFields, readFields } from './stateFields.js';

function list( input: unknown, maximum: number, length?: number ): unknown[] {
  if ( !Array.isArray( input ) || input.length > maximum || length !== undefined && input.length !== length ) {
    throw new Error( 'Invalid Quantum Measurement collection.' );
  }
  return input;
}
function numeric( input: unknown, min: number, max: number, integer = false ) {
  if ( typeof input !== 'number' || !Number.isFinite( input ) || input < min || input > max || integer && !Number.isSafeInteger( input ) ) {
    throw new Error( 'Invalid Quantum Measurement number.' );
  }
  return input;
}
function flag( input: unknown ) {
  if ( typeof input !== 'boolean' ) { throw new Error( 'Invalid Quantum Measurement flag.' ); }
  return input;
}
function point( value: Vector2 ) { return [ value.x, value.y ]; }
function readPoint( input: unknown, max = 100 ) {
  const [ x, y ] = list( input, 2, 2 );
  return new Vector2( numeric( x, -max, max ), numeric( y, -max, max ) );
}

function bindCounter( counter: AveragingCounterNumberProperty ) {
  const value = number( counter, false, value => value >= 0 );
  return {
    read: () => ( {
      value: value.read(),
      current: counter[ 'currentDetectionCount' ],
      elapsed: counter[ 'timeSinceLastCountSample' ],
      history: counter[ 'detectionSampleHistory' ].map( sample => [ sample.duration, sample.count ] )
    } ),
    prepare: ( input: unknown ) => {
      const data = object( input );
      const apply = value.prepare( data.value, 'count rate' );
      const current = numeric( data.current, 0, Number.MAX_SAFE_INTEGER, true );
      const elapsed = numeric( data.elapsed, 0, counter[ 'countSamplePeriod' ] );
      const history = list( data.history, 1 + Math.ceil( counter[ 'totalAveragingPeriod' ] / counter[ 'countSamplePeriod' ] ) ).map( input => {
        const [ duration, count ] = list( input, 2, 2 );
        return { duration: numeric( duration, counter[ 'countSamplePeriod' ], 10 ), count: numeric( count, 0, Number.MAX_SAFE_INTEGER, true ) };
      } );
      return () => {
        counter[ 'currentDetectionCount' ] = current;
        counter[ 'timeSinceLastCountSample' ] = elapsed;
        counter[ 'detectionSampleHistory' ] = history;
        apply();
      };
    }
  };
}

function photonScene( scene: PhotonsExperimentSceneModel, view: PhotonsExperimentSceneView ) {
  const laser = scene.laser;
  const detectors = [ scene.verticalPolarizationDetector, scene.horizontalPolarizationDetector ];
  const rates = detectors.map( detector => bindCounter( detector.detectionRateProperty ) );
  const fields = {
    mode: enumeration( scene.photonBehaviorModeProperty ),
    emission: number( laser.emissionRateProperty ),
    polarization: enumeration( laser.presetPolarizationDirectionProperty ),
    angle: number( laser.customPolarizationAngleProperty ),
    probabilityOpen: boolean( scene.probabilityExpandedProperty ),
    decimals: boolean( view[ 'decimalValuesVisibleProperty' ] ),
    timeSpeed: enumeration( scene.timeSpeedProperty ),
    vertical: number( detectors[ 0 ].detectionCountProperty, true ),
    horizontal: number( detectors[ 1 ].detectionCountProperty, true ),
    playing: boolean( scene.isPlayingProperty )
  };
  return {
    read: () => ( {
      ...readFields( fields ),
      accumulator: laser[ 'fractionalEmissionAccumulator' ],
      rates: rates.map( rate => rate.read() ),
      photons: scene.photonCollection.photons.map( photon => ( {
        angle: photon.polarizationAngle,
        paths: photon.possibleMotionStates.map( path => ( {
          position: point( path.position ), direction: point( path.direction ), probability: path.probability
        } ) )
      } ) )
    } ),
    prepare: ( input: unknown ) => {
      const data = object( input );
      const apply = prepareFields( fields, data );
      const accumulator = numeric( data.accumulator, 0, 1 );
      const savedRates = list( data.rates, rates.length, rates.length );
      const applyRates = rates.map( ( rate, i ) => rate.prepare( savedRates[ i ] ) );
      const photons = list( data.photons, 10000 ).map( input => {
        const saved = object( input );
        const angle = numeric( saved.angle, -360, 360 );
        const paths = list( saved.paths, 2 ).map( input => {
          const data = object( input );
          const direction = readPoint( data.direction, 1 );
          if ( Math.abs( direction.x ) + Math.abs( direction.y ) !== 1 ||
               ( direction.x !== 0 && direction.y !== 0 ) ) { throw new Error( 'Invalid photon path direction.' ); }
          return { direction, position: readPoint( data.position ), probability: numeric( data.probability, 0, 1 ) };
        } );
        if ( !paths.length || Math.abs( paths.reduce( ( sum, path ) => sum + path.probability, 0 ) - 1 ) > 1e-8 ) {
          throw new Error( 'Invalid photon probabilities.' );
        }
        const photon = new Photon( angle, paths[ 0 ].position, paths[ 0 ].direction );
        if ( paths.length === 2 ) { photon.addMotionState( paths[ 1 ].position, paths[ 1 ].direction, paths[ 1 ].probability ); }
        return photon;
      } );
      return () => {
        scene.isPlayingProperty.value = false;
        apply();
        laser[ 'fractionalEmissionAccumulator' ] = accumulator;
        applyRates.forEach( apply => apply() );
        scene.photonCollection.clear();
        photons.forEach( photon => scene.photonCollection.addPhoton( photon ) );
      };
    }
  };
}

function photonsState( screen: AnyScreen ) {
  const model = screen.model as PhotonsModel;
  const view = screen.view as PhotonsScreenView;
  const scenes = [
    photonScene( model.singlePhotonSceneModel, view[ 'singlePhotonExperimentSceneView' ] ),
    photonScene( model.manyPhotonsExperimentSceneModel, view[ 'manyPhotonsExperimentSceneView' ] )
  ];
  const fields = { mode: enumeration( model.experimentModeProperty ) };
  return {
    id: 'photons',
    screen,
    isPlaying: () => [ model.singlePhotonSceneModel, model.manyPhotonsExperimentSceneModel ].some( scene =>
      scene.isPlayingProperty.value && ( scene.laser.emissionRateProperty.value > 0 || scene.photonCollection.photons.length > 0 ) ),
    read: () => ( { ...readFields( fields ), scenes: scenes.map( scene => scene.read() ) } ),
    prepare: ( input: unknown ) => {
      const data = object( input );
      const apply = prepareFields( fields, data );
      const saved = list( data.scenes, scenes.length, scenes.length );
      const restore = scenes.map( ( scene, i ) => scene.prepare( saved[ i ] ) );
      return () => { view.interruptSubtreeInput(); apply(); restore.forEach( apply => apply() ); };
    }
  };
}

function readSpinParticle( particle: ParticleWithSpin ) {
  return {
    lifetime: particle.lifetime, position: point( particle.position ), velocity: point( particle.velocity ),
    spin: particle.spinVectors.map( point ), up: particle.isSpinUp.slice(), completed: particle.stageCompleted.slice(),
    start: point( particle.startPosition ), end: point( particle.endPosition ), offset: point( particle[ 'offset' ] )
  };
}
function prepareSpinParticle( input: unknown ) {
  const data = object( input );
  const start = readPoint( data.start );
  const end = readPoint( data.end );
  const velocity = readPoint( data.velocity, 10 );
  if ( start.equals( end ) ) { throw new Error( 'Invalid spin particle path.' ); }
  const particle = new ParticleWithSpin(
    numeric( data.lifetime, 0, 10 ), readPoint( data.position ), velocity,
    list( data.spin, 3, 3 ).map( value => readPoint( value, 1 ) ),
    list( data.up, 3, 3 ).map( flag ), list( data.completed, 3, 3 ).map( flag ),
    start, end, readPoint( data.offset, 1 )
  );
  particle.velocity = velocity;
  return particle;
}

function spinState( screen: AnyScreen ) {
  const model = screen.model as SpinModel;
  const source = model.particleSourceModel;
  const blockers = [ ...model[ 'blockingModeMap' ].values() ].map( enumeration );
  const collections = [ model.singleParticlesCollection, model.multipleParticlesCollection ];
  const counters = model.sternGerlachs.flatMap( apparatus => [ bindCounter( apparatus.upCounterProperty ), bindCounter( apparatus.downCounterProperty ) ] );
  const orientations = model.sternGerlachs.map( apparatus => boolean( apparatus.isZOrientedProperty ) );
  const fields = {
    experiment: enumeration( model.experimentProperty ),
    source: enumeration( source.sourceModeProperty ),
    initialSpin: enumeration( source.spinStateProperty ),
    amount: number( source.particleAmountProperty ),
    alphaSquared: number( model.alphaSquaredProperty ),
    expectedPercentage: boolean( model.expectedPercentageVisibleProperty )
  };
  return {
    id: 'spin',
    screen,
    isPlaying: () => source.isContinuousModeProperty.value && source.particleAmountProperty.value > 0 ||
      collections.some( collection => collection.particles.length > 0 ),
    read: () => ( {
      ...readFields( fields ),
      blockers: blockers.map( binding => binding.read() ),
      orientations: orientations.map( binding => binding.read() ),
      counters: counters.map( counter => counter.read() ),
      devices: model.measurementDevices.map( device => point( device.spinStateProperty.value ) ),
      particles: collections.map( collection => collection.particles.map( readSpinParticle ) ),
      accumulator: model.multipleParticlesCollection[ 'fractionalEmissionAccumulator' ]
    } ),
    prepare: ( input: unknown ) => {
      const data = object( input );
      const apply = prepareFields( fields, data );
      const savedBlockers = list( data.blockers, blockers.length, blockers.length );
      const applyBlockers = blockers.map( ( binding, i ) => binding.prepare( savedBlockers[ i ], 'blocker' ) );
      const savedOrientations = list( data.orientations, orientations.length, orientations.length );
      const applyOrientations = orientations.map( ( binding, i ) => binding.prepare( savedOrientations[ i ], 'orientation' ) );
      const savedCounters = list( data.counters, counters.length, counters.length );
      const applyCounters = counters.map( ( counter, i ) => counter.prepare( savedCounters[ i ] ) );
      const devices = list( data.devices, model.measurementDevices.length, model.measurementDevices.length ).map( value => readPoint( value, 1 ) );
      const savedParticles = list( data.particles, collections.length, collections.length );
      const particles = collections.map( ( collection, i ) =>
        list( savedParticles[ i ], collection[ 'maxParticles' ] ).map( prepareSpinParticle ) );
      const accumulator = numeric( data.accumulator, 0, 1 );
      return () => {
        screen.view.interruptSubtreeInput();
        applyBlockers.forEach( apply => apply() );
        apply();
        applyOrientations.forEach( apply => apply() );
        applyCounters.forEach( apply => apply() );
        model.measurementDevices.forEach( ( device, i ) => { device.spinStateProperty.value = devices[ i ]; } );
        collections.forEach( ( collection, i ) => {
          collection.clear();
          collection.particles.push( ...particles[ i ] );
        } );
        model.multipleParticlesCollection[ 'fractionalEmissionAccumulator' ] = accumulator;
      };
    }
  };
}

function blochState( screen: AnyScreen ) {
  const model = screen.model as BlochSphereModel;
  const spheres = [ model.preparationBlochSphere, model.singleMeasurementBlochSphere, ...model.multipleMeasurementBlochSpheres ];
  const directions = spheres.map( sphere => ( { polar: number( sphere.polarAngleProperty ), azimuth: number( sphere.azimuthalAngleProperty ) } ) );
  const controls = {
    spin: enumeration( model.spinStateProperty ),
    basis: enumeration( model.equationBasisProperty ),
    axis: enumeration( model.measurementAxisProperty ),
    single: boolean( model.isSingleMeasurementModeProperty ),
    magneticField: boolean( model.magneticFieldEnabledProperty ),
    strength: number( model.magneticFieldStrengthProperty ),
    delay: number( model.measurementDelayProperty )
  };
  const observation = {
    state: enumeration( model.measurementStateProperty ),
    elapsed: number( model.timeElapsedProperty ),
    up: number( model.upMeasurementCountProperty, true ),
    down: number( model.downMeasurementCountProperty, true )
  };
  return {
    id: 'bloch-sphere',
    screen,
    isPlaying: () => model.magneticFieldEnabledProperty.value &&
      ( model.singleMeasurementBlochSphere.rotatingSpeedProperty.value !== 0 || String( model.measurementStateProperty.value ) === 'TIMING_OBSERVATION' ),
    read: () => ( { ...readFields( controls ), ...readFields( observation ), spheres: directions.map( readFields ) } ),
    prepare: ( input: unknown ) => {
      const data = object( input );
      const apply = prepareFields( controls, data );
      const applyObservation = prepareFields( observation, data );
      const saved = list( data.spheres, directions.length, directions.length );
      const restore = directions.map( ( direction, i ) => prepareFields( direction, saved[ i ] ) );
      return () => {
        screen.view.interruptSubtreeInput();
        apply();
        restore.forEach( apply => apply() );
        applyObservation();
      };
    }
  };
}

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => {
    const preferences = quantumPreferences( true );
    return {
      bridge: 'webwriter-quantum-measurement/v1',
      build: 'quantum-measurement@1.1.0-dev.0-webwriter.1',
      screens: [ coinsState( sim.simScreens[ 0 ] ), photonsState( sim.simScreens[ 1 ] ),
        spinState( sim.simScreens[ 2 ] ), blochState( sim.simScreens[ 3 ] ) ],
      readPreferences: () => readFields( preferences ),
      preparePreferences: input => prepareFields( preferences, input )
    };
  } );
}
