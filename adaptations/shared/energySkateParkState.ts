// Energy Skate Park WebWriter state. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import EnergySkateParkDataSample from '../../../energy-skate-park/js/common/model/EnergySkateParkDataSample.js';
import type EnergySkateParkModel from '../../../energy-skate-park/js/common/model/EnergySkateParkModel.js';
import EnergySkateParkSaveSampleModel from '../../../energy-skate-park/js/common/model/EnergySkateParkSaveSampleModel.js';
import EnergySkateParkTrackSetModel from '../../../energy-skate-park/js/common/model/EnergySkateParkTrackSetModel.js';
import type Skater from '../../../energy-skate-park/js/common/model/Skater.js';
import SkaterState from '../../../energy-skate-park/js/common/model/SkaterState.js';
import type Track from '../../../energy-skate-park/js/common/model/Track.js';
import GraphsModel from '../../../energy-skate-park/js/graphs/model/GraphsModel.js';
import MeasureModel from '../../../energy-skate-park/js/measure/model/MeasureModel.js';
import EnergySkateParkPlaygroundModel from '../../../energy-skate-park/js/playground/model/EnergySkateParkPlaygroundModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields, vector } from './stateFields.js';

const MAX_SAMPLES = 1200;

function scalar( value: unknown, min = -1e8, max = 1e8 ): number {
  if ( typeof value !== 'number' || !Number.isFinite( value ) || value < min || value > max ) {
    throw new Error( 'Invalid skate park number.' );
  }
  return value;
}

function flag( value: unknown ): boolean {
  if ( typeof value !== 'boolean' ) { throw new Error( 'Invalid skate park setting.' ); }
  return value;
}

function coordinates( point: Vector2 ): number[] {
  return [ point.x, point.y ];
}

function point( input: unknown ): Vector2 {
  if ( !Array.isArray( input ) || input.length !== 2 ) { throw new Error( 'Invalid skate park point.' ); }
  return new Vector2( scalar( input[ 0 ], -1e5, 1e5 ), scalar( input[ 1 ], -1e5, 1e5 ) );
}

function trackIndex( input: unknown, count: number ): number | null {
  if ( input === null ) { return null; }
  if ( typeof input !== 'number' || !Number.isInteger( input ) || input < 0 || input >= count ) {
    throw new Error( 'Unknown skate park track.' );
  }
  return input;
}

function readTrackIndex( track: Track | null, tracks: Track[] ): number | null {
  return track && tracks.includes( track ) ? tracks.indexOf( track ) : null;
}

function readTracks( tracks: Track[] ) {
  return tracks.map( track => ( {
    physical: track.physicalProperty.value,
    slopeToGround: track.slopeToGround,
    points: track.controlPoints.map( control => coordinates( control.sourcePositionProperty.value ) )
  } ) );
}

function prepareTracks( model: EnergySkateParkModel, input: unknown ) {
  const dynamic = model instanceof EnergySkateParkPlaygroundModel;
  if ( !Array.isArray( input ) || input.length > 30 || ( !dynamic && input.length !== model.tracks.length ) ) {
    throw new Error( 'Invalid skate park track count.' );
  }
  const tracks = input.map( ( entry, index ) => {
    const state = object( entry );
    if ( !Array.isArray( state.points ) || state.points.length < 2 || state.points.length > 30 ||
         ( !dynamic && state.points.length !== model.tracks[ index ].controlPoints.length ) ) {
      throw new Error( 'Invalid track control points.' );
    }
    return { points: state.points.map( point ), physical: flag( state.physical ), slopeToGround: flag( state.slopeToGround ) };
  } );
  return {
    counts: tracks.map( track => track.points.length ),
    apply: () => {
      if ( dynamic ) { model.clearTracks(); }
      tracks.forEach( ( state, i ) => {
        let track = model.tracks[ i ];
        if ( dynamic ) {
          const controlPoints = state.points.map( position => model.controlPointGroup.createNextElement( position.x, position.y, {} ) );
          track = model.trackGroup.createNextElement( controlPoints, { draggable: true, configurable: true, splittable: true, attachable: true } );
          model.tracks.add( track );
        }
        else {
          track.controlPoints.forEach( ( control, i ) => { control.sourcePositionProperty.value = state.points[ i ]; } );
        }
        track.physicalProperty.value = state.physical;
        track.slopeToGround = state.slopeToGround;
        track.updateSplines();
        track.updateEmitter.emit();
      } );
      model.trackChangedEmitter.emit();
    }
  };
}

function readSkater( state: SkaterState, tracks: Track[] ) {
  return {
    position: [ state.positionX, state.positionY ],
    velocity: [ state.velocityX, state.velocityY ],
    track: readTrackIndex( state.track, tracks ),
    angle: ( state as unknown as { angle: number } ).angle,
    gravity: state.gravity,
    mass: state.mass,
    referenceHeight: state.referenceHeight,
    thermalEnergy: state.thermalEnergy,
    top: state.isOnTopSideOfTrack,
    parameter: state.parametricPosition,
    parameterSpeed: state.parametricSpeed
  };
}

function prepareSkater( input: unknown, model: EnergySkateParkModel, count: number ) {
  const state = object( input );
  const position = point( state.position );
  const velocity = point( state.velocity );
  const track = trackIndex( state.track, count );
  const gravityRange = model.skater.gravityMagnitudeProperty.range;
  const heightRange = model.skater.referenceHeightProperty.range;
  const massRange = model.skater.massRange;
  const data = {
    positionX: position.x, positionY: position.y, velocityX: velocity.x, velocityY: velocity.y,
    angle: scalar( state.angle ),
    gravity: scalar( state.gravity, -gravityRange.max, -gravityRange.min ),
    mass: scalar( state.mass, massRange.min, massRange.max ),
    referenceHeight: scalar( state.referenceHeight, heightRange.min, heightRange.max ),
    thermalEnergy: scalar( state.thermalEnergy, 0 ),
    isOnTopSideOfTrack: flag( state.top ),
    parametricPosition: scalar( state.parameter, -10, 10 ),
    parametricSpeed: scalar( state.parameterSpeed ),
    userControlled: false
  };
  return ( tracks: Track[] ) => SkaterState.fromPlainObject( { ...data, track: track === null ? null : tracks[ track ] } );
}

function skaterReturnState( skater: Skater ) {
  // These properties jointly describe the release point used by Return Skater.
  const source = skater as unknown as {
    startingUProperty: { value: number };
    startingUpProperty: { value: boolean };
    startingAngleProperty: { value: number };
    startingTrackControlPointSources?: Vector2[];
  };
  const fields = {
    position: vector( skater.startingPositionProperty ),
    parameter: number( source.startingUProperty ),
    top: boolean( source.startingUpProperty ),
    angle: number( source.startingAngleProperty ),
    direction: enumeration( skater.directionProperty )
  };
  return {
    read: ( tracks: Track[] ) => ( {
      ...readFields( fields ),
      track: readTrackIndex( skater.startingTrackProperty.value, tracks ),
      sourcePoints: source.startingTrackControlPointSources?.map( coordinates ) ?? []
    } ),
    prepare: ( input: unknown, count: number ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const track = trackIndex( state.track, count );
      if ( !Array.isArray( state.sourcePoints ) || state.sourcePoints.length > 30 ) {
        throw new Error( 'Invalid skater return track.' );
      }
      const points = state.sourcePoints.map( point );
      return ( tracks: Track[] ) => {
        apply();
        skater.startingTrackProperty.value = track === null ? null : tracks[ track ];
        source.startingTrackControlPointSources = points;
      };
    }
  };
}

function sampleState( model: EnergySkateParkSaveSampleModel ) {
  const timing = model as unknown as { timeSinceSampleSave: number; sampleFadeDecay: number };
  const fields = {
    path: boolean( model.pathVisibleProperty ),
    time: number( model.sampleTimeProperty, false, value => value >= 0 )
  };
  return {
    read: ( tracks: Track[] ) => ( {
      ...readFields( fields ),
      sinceLast: timing.timeSinceSampleSave,
      samples: model.dataSamples.slice( -MAX_SAMPLES ).map( sample => ( {
        time: sample.time,
        skater: readSkater( sample.skaterState, tracks ),
        friction: sample.friction,
        sticking: sample.stickingToTrack,
        referenceHeight: sample.referenceHeight,
        points: sample.trackControlPointPositions.map( coordinates ),
        opacity: sample.opacityProperty.value,
        fading: ( sample as unknown as { _initiateRemove: boolean } )._initiateRemove
      } ) )
    } ),
    prepare: ( input: unknown, counts: number[] ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const sinceLast = scalar( state.sinceLast, 0 );
      if ( !Array.isArray( state.samples ) || state.samples.length > MAX_SAMPLES ) {
        throw new Error( 'Invalid skate park data samples.' );
      }
      const samples = state.samples.map( input => {
        const sample = object( input );
        const skater = prepareSkater( sample.skater, model, counts.length );
        const track = trackIndex( object( sample.skater ).track, counts.length );
        if ( !Array.isArray( sample.points ) || sample.points.length > 30 ||
             ( track !== null && sample.points.length !== counts[ track ] ) ) {
          throw new Error( 'Invalid sampled track positions.' );
        }
        const points = sample.points.map( point );
        const frictionRange = model.frictionProperty.range;
        const friction = scalar( sample.friction, frictionRange.min, frictionRange.max );
        const time = scalar( sample.time, 0 );
        const referenceHeight = scalar( sample.referenceHeight );
        const sticking = flag( sample.sticking );
        const fading = flag( sample.fading );
        const opacity = scalar( sample.opacity, 0, 1 );
        return ( tracks: Track[] ) => {
          const entry = new EnergySkateParkDataSample( skater( tracks ), friction, time, sticking, timing.sampleFadeDecay );
          entry.setNewReferenceHeight( referenceHeight );
          entry.trackControlPointPositions.splice( 0, entry.trackControlPointPositions.length, ...points );
          entry.opacityProperty.value = opacity;
          if ( fading ) { entry.initiateRemove(); }
          return entry;
        };
      } );
      return ( tracks: Track[] ) => {
        model.clearEnergyData();
        applyFields();
        timing.timeSinceSampleSave = sinceLast;
        model.dataSamples.addAll( samples.map( sample => sample( tracks ) ) );
      };
    }
  };
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as EnergySkateParkModel;
  const skater = model.skater;
  const returning = skaterReturnState( skater );
  const samples = model instanceof EnergySkateParkSaveSampleModel ? sampleState( model ) : null;
  const controls = {
    pieChart: boolean( model.pieChartVisibleProperty ),
    barGraph: boolean( model.barGraphVisibleProperty ),
    barScale: number( model.barGraphScaleProperty, false, value => value > 0 ),
    grid: boolean( model.gridVisibleProperty ),
    speedometer: boolean( model.speedometerVisibleProperty ),
    speedValue: boolean( model.speedValueVisibleProperty ),
    referenceHeight: boolean( model.referenceHeightVisibleProperty ),
    measuringTape: boolean( model.measuringTapeVisibleProperty ),
    tapeBase: vector( model.measuringTapeBasePositionProperty ),
    tapeTip: vector( model.measuringTapeTipPositionProperty ),
    friction: number( model.frictionProperty ),
    sticking: boolean( model.isStickingToTrackProperty ),
    speed: enumeration( model.timeSpeedProperty ),
    ...( model instanceof EnergySkateParkTrackSetModel ? { scene: enumeration( model.sceneProperty ) } : {} ),
    ...( model instanceof MeasureModel ? {
      sensorProbe: vector( model.sensorProbePositionProperty ),
      sensorBody: vector( model.sensorBodyPositionProperty )
    } : {} ),
    ...( model instanceof GraphsModel ? {
      kinetic: boolean( model.kineticEnergyDataVisibleProperty ),
      potential: boolean( model.potentialEnergyDataVisibleProperty ),
      thermal: boolean( model.thermalEnergyDataVisibleProperty ),
      total: boolean( model.totalEnergyDataVisibleProperty ),
      graphZoom: number( model.energyGraphZoomIndexProperty, true ),
      independentVariable: enumeration( model.independentVariableProperty ),
      graphExpanded: boolean( model.energyGraphExpandedProperty )
    } : {} )
  };
  const stopwatch = {
    position: vector( model.stopwatch.positionProperty ),
    visible: boolean( model.stopwatch.isVisibleProperty ),
    running: boolean( model.stopwatch.isRunningProperty ),
    time: number( model.stopwatch.timeProperty, false, value => value >= 0 )
  };
  const playback = { playing: boolean( model.isPlayingProperty ) };

  return {
    isPlaying: () => model.isPlayingProperty.value &&
      ( skater.positionProperty.value.y > 0 || skater.velocityProperty.value.magnitude > 0 || model.stopwatch.isRunningProperty.value ),
    read: () => ( {
      controls: readFields( controls ),
      playback: readFields( playback ),
      stopwatch: readFields( stopwatch ),
      tracks: readTracks( model.tracks ),
      skater: readSkater( new SkaterState( skater ), model.tracks ),
      returnSkater: returning.read( model.tracks ),
      samples: samples?.read( model.tracks ) ?? null
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state.controls );
      const applyPlayback = prepareFields( playback, state.playback );
      const applyStopwatch = prepareFields( stopwatch, state.stopwatch );
      const tracks = prepareTracks( model, state.tracks );
      const applyReturn = returning.prepare( state.returnSkater, tracks.counts.length );
      const skaterState = prepareSkater( state.skater, model, tracks.counts.length );
      const applySamples = samples?.prepare( state.samples, tracks.counts );
      return () => {
        screen.view.interruptSubtreeInput();
        model.isPlayingProperty.value = false;
        applyControls();
        tracks.apply();
        applyStopwatch();
        skaterState( model.tracks ).setToSkater( skater );
        applyReturn( model.tracks );
        applySamples?.( model.tracks );
        skater.updatedEmitter.emit();
        applyPlayback();
      };
    }
  };
}

export default function installEnergySkateParkState( sim: Sim, id: string, version: string, ids: string[] ): void {
  installSimulationBridge( sim, () => {
    const model = sim.simScreens[ 0 ].model as EnergySkateParkModel;
    const preferences = {
      accelerationUnits: enumeration( model.preferencesModel.accelerationUnitsProperty ),
      showPatterns: boolean( model.preferencesModel.showPatternsProperty )
    };
    return {
      bridge: `webwriter-${id}/v1`,
      build: `${id}@${version}-webwriter.1`,
      readPreferences: () => readFields( preferences ),
      preparePreferences: input => prepareFields( preferences, input ),
      screens: sim.simScreens.map( ( screen, i ) => ( { id: ids[ i ], screen, ...screenState( screen ) } ) )
    };
  } );
}
