// State adapter for PhET Quantum Wave Interference. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import ExperimentConstants from '../experiment/ExperimentConstants.js';
import { DetectionModeValues } from '../experiment/model/DetectionMode.js';
import type ExperimentModel from '../experiment/model/ExperimentModel.js';
import SceneModel from '../experiment/model/SceneModel.js';
import { SlitConfigurationValues } from '../experiment/model/SlitConfiguration.js';
import Snapshot from '../experiment/model/Snapshot.js';
import type ExperimentScreenView from '../experiment/view/ExperimentScreenView.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';
import { decodeBytes, encodeBytes } from './binaryState.js';

function finite( input: unknown, min: number, max: number, integer = false ) {
  if ( typeof input !== 'number' || !Number.isFinite( input ) || input < min || input > max ||
       integer && !Number.isSafeInteger( input ) ) {
    throw new Error( 'Invalid Quantum Wave Interference measurement.' );
  }
  return input;
}
function encodeHits( points: readonly Vector2[] ): string {
  const bytes = new Uint8Array( points.length * 16 );
  const view = new DataView( bytes.buffer );
  points.forEach( ( point, index ) => {
    view.setFloat64( index * 16, point.x, true );
    view.setFloat64( index * 16 + 8, point.y, true );
  } );
  return encodeBytes( bytes );
}

function hits( input: unknown ) {
  const bytes = decodeBytes( input, ExperimentConstants.MAX_HITS * 16 );
  if ( bytes.length % 16 ) { throw new Error( 'Invalid detector hits.' ); }
  const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
  const points = [];
  for ( let index = 0; index < bytes.length; index += 16 ) {
    points.push( new Vector2(
      finite( view.getFloat64( index, true ), -1, 1 ),
      finite( view.getFloat64( index + 8, true ), -1, 1 )
    ) );
  }
  return points;
}

function bindScene( scene: SceneModel ) {
  const snapshotHits = new WeakMap<Snapshot, string>();
  const encodeSnapshot = ( snapshot: Snapshot ) => {
    if ( !snapshotHits.has( snapshot ) ) {
      snapshotHits.set( snapshot, encodeHits( snapshot.hits ) );
    }
    return snapshotHits.get( snapshot )!;
  };
  const fields = {
    ...( scene.sourceType === 'photons' ? { wavelength: number( scene.wavelengthProperty ) } : { velocity: number( scene.velocityProperty ) } ),
    emitting: boolean( scene.isEmittingProperty ),
    intensity: number( scene.intensityProperty ),
    slitSeparation: number( scene.slitSeparationProperty ),
    screenDistance: number( scene.screenDistanceProperty ),
    slits: enumeration( scene.slitSettingProperty ),
    detection: enumeration( scene.detectionModeProperty ),
    brightness: number( scene.screenBrightnessProperty )
  };
  return {
    read: () => ( {
      ...readFields( fields ),
      totalHits: scene.totalHitsProperty.value,
      detectorHits: scene.detectorHitsProperty.value,
      hits: encodeHits( scene.hits ),
      accumulator: scene[ 'hitAccumulator' ],
      nextSnapshot: scene[ 'nextSnapshotNumber' ],
      snapshots: scene.snapshotsProperty.value.map( snapshot => ( {
        number: snapshot.snapshotNumber, hits: encodeSnapshot( snapshot ), detection: snapshot.detectionMode,
        wavelength: snapshot.wavelength, slitSeparation: snapshot.slitSeparation, screenDistance: snapshot.screenDistance,
        effectiveWavelength: snapshot.effectiveWavelength, slits: snapshot.slitSetting,
        emitting: snapshot.isEmitting, brightness: snapshot.brightness, intensity: snapshot.intensity
      } ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const points = hits( state.hits );
      const accumulator = finite( state.accumulator, 0, 1 );
      const totalHits = finite( state.totalHits, points.length, Number.MAX_SAFE_INTEGER, true );
      const detectorHits = finite( state.detectorHits, 0, points.length, true );
      const nextSnapshot = finite( state.nextSnapshot, 1, Number.MAX_SAFE_INTEGER, true );
      if ( accumulator >= 1 || points.length !== Math.min( totalHits, ExperimentConstants.MAX_HITS ) ||
           detectorHits > 0 && state.slits !== 'leftDetector' && state.slits !== 'rightDetector' ||
           !Array.isArray( state.snapshots ) || state.snapshots.length > SceneModel.MAX_SNAPSHOTS ) {
        throw new Error( 'Invalid Quantum Wave Interference detector state.' );
      }
      let previous = 0;
      const snapshots = state.snapshots.map( item => {
        const data = object( item );
        const number = finite( data.number, previous + 1, nextSnapshot - 1, true );
        previous = number;
        const detectionMode = DetectionModeValues.find( value => value === data.detection );
        const slitSetting = SlitConfigurationValues.find( value => value === data.slits );
        if ( !detectionMode || !slitSetting || typeof data.emitting !== 'boolean' ) { throw new Error( 'Invalid detector snapshot options.' ); }
        return new Snapshot( number, hits( data.hits ), {
          detectionMode,
          sourceType: scene.sourceType,
          wavelength: finite( data.wavelength, 0, scene.wavelengthProperty.range.max ),
          slitSeparation: finite( data.slitSeparation, scene.slitSeparationRange.min, scene.slitSeparationRange.max ),
          screenDistance: finite( data.screenDistance, scene.screenDistanceRange.min, scene.screenDistanceRange.max ),
          effectiveWavelength: finite( data.effectiveWavelength, Number.MIN_VALUE, 1 ),
          slitSetting,
          isEmitting: data.emitting,
          brightness: finite( data.brightness, 0, SceneModel.SCREEN_BRIGHTNESS_MAX ),
          intensity: finite( data.intensity, 0, 1 )
        } );
      } );
      return () => {
        apply();
        scene.clearScreen();
        scene.hits.push( ...points );
        scene.totalHitsProperty.value = totalHits;
        scene.detectorHitsProperty.value = detectorHits;
        scene[ 'hitAccumulator' ] = accumulator;
        scene.snapshotsProperty.value = snapshots;
        scene[ 'nextSnapshotNumber' ] = nextSnapshot;
        scene.hitsChangedEmitter.emit();
      };
    }
  };
}

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as ExperimentModel;
    const view = screen.view as ExperimentScreenView;
    const stopwatch = model.stopwatch;
    const scenes = model.scenes.map( scene => [ scene.sourceType, bindScene( scene ) ] as const );
    const fields = {
      source: field( model.sceneProperty, value => value.sourceType, input => model.scenes.find( scene => scene.sourceType === input ) ),
      timeSpeed: enumeration( model.timeSpeedProperty ),
      ruler: boolean( model.isRulerVisibleProperty ),
      rulerPosition: vector( model.rulerPositionProperty ),
      stopwatch: boolean( stopwatch.isVisibleProperty ),
      stopwatchPosition: vector( stopwatch.positionProperty ),
      stopwatchTime: number( stopwatch.timeProperty ),
      stopwatchRunning: boolean( stopwatch.isRunningProperty ),
      graph: boolean( view[ 'graphExpandedProperty' ] )
    };
    const playing = boolean( model.isPlayingProperty );
    return {
      bridge: 'webwriter-quantum-wave-interference/v1',
      build: 'quantum-wave-interference@1.0.0-dev.0-webwriter.1',
      screens: [ {
        id: 'experiment',
        screen,
        isPlaying: () => model.isPlayingProperty.value && ( stopwatch.isRunningProperty.value ||
          model.sceneProperty.value.isEmittingProperty.value && model.sceneProperty.value.intensityProperty.value > 0 ),
        read: () => ( { ...readFields( fields ), playing: playing.read(),
          scenes: Object.fromEntries( scenes.map( ( [ id, binding ] ) => [ id, binding.read() ] ) ) } ),
        prepare: ( input: unknown ) => {
          const data = object( input );
          const sceneStates = object( data.scenes );
          const restore = scenes.map( ( [ id, binding ] ) => binding.prepare( sceneStates[ id ] ) );
          const apply = prepareFields( fields, data );
          const applyPlaying = playing.prepare( data.playing, 'playing' );
          return () => {
            view.interruptSubtreeInput();
            model.isPlayingProperty.value = false;
            apply();
            restore.forEach( apply => apply() );
            applyPlaying();
          };
        }
      } ]
    };
  } );
}
