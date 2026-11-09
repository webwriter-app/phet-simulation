// Greenhouse Effect WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type PhetioObject from '../../../tandem/js/PhetioObject.js';
import GreenhouseEffectConstants from '../common/GreenhouseEffectConstants.js';
import ConcentrationModel from '../common/model/ConcentrationModel.js';
import EMEnergyPacket from '../common/model/EMEnergyPacket.js';
import EnergyDirection from '../common/model/EnergyDirection.js';
import type EnergyRateTracker from '../common/model/EnergyRateTracker.js';
import GreenhouseEffectPreferences from '../common/model/GreenhouseEffectPreferences.js';
import Photon, { ShowState } from '../common/model/Photon.js';
import type PhotonCollection from '../common/model/PhotonCollection.js';
import LayerModelModel from '../layer-model/model/LayerModelModel.js';
import PhotonsModel from '../photons/model/PhotonsModel.js';
import type Wave from '../waves/model/Wave.js';
import WaveAttenuator from '../waves/model/WaveAttenuator.js';
import WaveIntensityChange from '../waves/model/WaveIntensityChange.js';
import WavesModel from '../waves/model/WavesModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields, vector } from './stateFields.js';

const wavelengths = [ GreenhouseEffectConstants.VISIBLE_WAVELENGTH, GreenhouseEffectConstants.INFRARED_WAVELENGTH ];

function scalar( input: unknown, min: number, max: number ): number {
  if ( typeof input !== 'number' || !Number.isFinite( input ) || input < min || input > max ) {
    throw new Error( 'Invalid greenhouse model quantity.' );
  }
  return input;
}

function coordinates( point: Vector2 ): number[] {
  return [ point.x, point.y ];
}

function point( input: unknown, limit = 1e9 ): Vector2 {
  if ( !Array.isArray( input ) || input.length !== 2 ) { throw new Error( 'Invalid greenhouse model point.' ); }
  return new Vector2( scalar( input[ 0 ], -limit, limit ), scalar( input[ 1 ], -limit, limit ) );
}

function list( input: unknown, limit: number ): unknown[] {
  if ( !Array.isArray( input ) || input.length > limit ) { throw new Error( 'Invalid greenhouse model collection.' ); }
  return input;
}

function wavelength( input: unknown ): number {
  if ( typeof input !== 'number' || !wavelengths.includes( input ) ) { throw new Error( 'Invalid radiation wavelength.' ); }
  return input;
}

function photonsState( collection: PhotonCollection ) {
  const controls = { showAll: boolean( collection.showAllSimulatedPhotonsInViewProperty ) };
  return {
    read: () => ( {
      ...readFields( controls ),
      photons: collection.photons.map( photon => ( {
        position: coordinates( photon.position ),
        previous: coordinates( photon.previousPosition ),
        velocity: coordinates( photon.velocity ),
        wavelength: photon.wavelength,
        show: photon.showState.name
      } ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( controls, state );
      const photons = list( state.photons, 4000 ).map( input => {
        const photon = object( input );
        const show = ShowState.enumeration.values.find( state => state.name === photon.show );
        if ( !show ) { throw new Error( 'Invalid photon visibility.' ); }
        return new Photon( point( photon.position ), wavelength( photon.wavelength ), {
          previousPosition: point( photon.previous ), initialVelocity: point( photon.velocity ), showState: show
        } );
      } );
      return () => {
        apply();
        collection.photons.clear();
        collection.photons.addAll( photons );
      };
    }
  };
}

function wavesState( model: WavesModel ) {
  const reflection = model as unknown as { cloudReflectedWavesMap: Map<Wave, Wave>; glacierReflectedWavesMap: Map<Wave, Wave> };
  const attenuators = ( wave: Wave ) => ( wave as unknown as { modelObjectToAttenuatorMap: Map<PhetioObject, WaveAttenuator> } ).modelObjectToAttenuatorMap;
  const elements = [ ...model.atmosphereLayers, model.cloud, model.groundLayer ];
  const readReference = ( value: PhetioObject | null ) => value === null ? null : elements.indexOf( value as typeof elements[number] );
  const restoreReference = ( input: unknown ) => {
    if ( input === null ) { return null; }
    const index = scalar( input, 0, elements.length - 1 );
    if ( !Number.isInteger( index ) || !elements[ index ] ) { throw new Error( 'Unknown wave interaction surface.' ); }
    return elements[ index ];
  };

  return {
    read: () => {
      const waves = model.waveGroup.getArray();
      const waveMap = ( map: Map<Wave, Wave> ) => [ ...map ].map( ( [ source, reflected ] ) =>
        [ waves.indexOf( source ), waves.indexOf( reflected ) ] ).filter( pair => pair.every( index => index >= 0 ) );
      return {
        waves: waves.map( wave => ( {
          wavelength: wave.wavelength,
          origin: coordinates( wave.origin ),
          direction: coordinates( wave.propagationDirection ),
          start: coordinates( wave.startPoint ),
          limit: ( wave as unknown as { propagationLimit: number } ).propagationLimit,
          length: wave.length,
          phase: wave.phaseOffsetAtOrigin,
          sourced: wave.isSourced,
          intensity: wave.intensityAtStart,
          changes: wave.intensityChanges.map( change => [ change.postChangeIntensity, change.distanceFromStart, readReference( change.anchoredTo ) ] ),
          attenuators: [ ...attenuators( wave ) ].map( ( [ element, effect ] ) =>
            [ readReference( element ), effect.attenuation, effect.distanceFromStart ] )
        } ) ),
        cloudReflections: waveMap( reflection.cloudReflectedWavesMap ),
        glacierReflections: waveMap( reflection.glacierReflectedWavesMap ),
        interactions: model.waveAtmosphereInteractions.map( interaction => [
          elements.indexOf( interaction.atmosphereLayer as typeof elements[number] ),
          waves.indexOf( interaction.sourceWave ), waves.indexOf( interaction.emittedWave )
        ] ).filter( row => row.every( index => index >= 0 ) )
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const waves = list( state.waves, 500 ).map( input => {
        const wave = object( input );
        const origin = point( wave.origin );
        const direction = point( wave.direction, 1 );
        const limit = scalar( wave.limit, -1e9, 1e9 );
        if ( Math.abs( direction.magnitude - 1 ) > 1e-6 || typeof wave.sourced !== 'boolean' ||
             Math.sign( direction.y ) !== Math.sign( limit - origin.y ) || limit === origin.y ) {
          throw new Error( 'Invalid light wave direction.' );
        }
        const start = point( wave.start );
        const length = scalar( wave.length, 0, 1e9 );
        const phase = scalar( wave.phase, -1e12, 1e12 );
        const intensity = scalar( wave.intensity, 0, 1 );
        const waveWavelength = wavelength( wave.wavelength );
        const { sourced } = wave;
        const changes = list( wave.changes, 100 ).map( input => {
          if ( !Array.isArray( input ) || input.length !== 3 ) { throw new Error( 'Invalid wave intensity change.' ); }
          return new WaveIntensityChange( scalar( input[ 0 ], 0, 1 ), scalar( input[ 1 ], -1e9, 1e9 ), restoreReference( input[ 2 ] ) );
        } );
        const effects = list( wave.attenuators, elements.length ).map( input => {
          if ( !Array.isArray( input ) || input.length !== 3 ) { throw new Error( 'Invalid wave attenuator.' ); }
          const element = restoreReference( input[ 0 ] );
          if ( !element ) { throw new Error( 'Missing wave attenuator surface.' ); }
          return [ element, new WaveAttenuator( scalar( input[ 1 ], 0, 1 ), scalar( input[ 2 ], -1e9, 1e9 ) ) ] as const;
        } );
        return () => {
          const result = model.waveGroup.createNextElement( waveWavelength, origin, direction, limit, {
            initialPhaseOffset: phase, intensityAtStart: intensity
          } );
          result.startPoint.set( start );
          result.length = length;
          result.isSourced = sourced;
          result.intensityChanges = changes;
          effects.forEach( ( [ element, effect ] ) => attenuators( result ).set( element, effect ) );
          return result;
        };
      } );
      const waveIndex = ( input: unknown ) => {
        const value = scalar( input, 0, waves.length - 1 );
        if ( !Number.isInteger( value ) ) { throw new Error( 'Invalid wave index.' ); }
        return value;
      };
      const reflectionPairs = ( input: unknown ) => list( input, waves.length ).map( pair => {
        if ( !Array.isArray( pair ) || pair.length !== 2 ) { throw new Error( 'Invalid wave reflection.' ); }
        return [ waveIndex( pair[ 0 ] ), waveIndex( pair[ 1 ] ) ];
      } );
      const clouds = reflectionPairs( state.cloudReflections );
      const glaciers = reflectionPairs( state.glacierReflections );
      const interactions = list( state.interactions, waves.length * model.atmosphereLayers.length ).map( entry => {
        if ( !Array.isArray( entry ) || entry.length !== 3 || !Number.isInteger( entry[ 0 ] ) || !model.atmosphereLayers[ entry[ 0 ] ] ) {
          throw new Error( 'Invalid wave interaction layer.' );
        }
        return { atmosphereLayer: model.atmosphereLayers[ entry[ 0 ] ], source: waveIndex( entry[ 1 ] ), emitted: waveIndex( entry[ 2 ] ) };
      } );
      return () => {
        const restored = waves.map( create => create() );
        clouds.forEach( ( [ from, to ] ) => reflection.cloudReflectedWavesMap.set( restored[ from ], restored[ to ] ) );
        glaciers.forEach( ( [ from, to ] ) => reflection.glacierReflectedWavesMap.set( restored[ from ], restored[ to ] ) );
        model.waveAtmosphereInteractions.addAll( interactions.map( ( { atmosphereLayer, source, emitted } ) =>
          ( { atmosphereLayer, sourceWave: restored[ source ], emittedWave: restored[ emitted ] } ) ) );
        model.wavesChangedEmitter.emit();
      };
    }
  };
}

function trackerState( tracker: EnergyRateTracker ) {
  const internals = tracker as unknown as { energyInfoQueue: { energy: number; dt: number }[] };
  const fields = { rate: number( tracker.energyRateProperty ) };
  return {
    read: () => ( { ...readFields( fields ), queue: internals.energyInfoQueue.map( entry => [ entry.energy, entry.dt ] ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const queue = list( state.queue, 2000 ).map( input => {
        if ( !Array.isArray( input ) || input.length !== 2 ) { throw new Error( 'Invalid energy sample.' ); }
        return { energy: scalar( input[ 0 ], 0, 1e40 ), dt: scalar( input[ 1 ], Number.MIN_VALUE, 10 ) };
      } );
      return () => {
        internals.energyInfoQueue.splice( 0, internals.energyInfoQueue.length, ...queue );
        apply();
      };
    }
  };
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as WavesModel | PhotonsModel | LayerModelModel;
  const internals = model as unknown as { emEnergyPackets: EMEnergyPacket[]; modelSteppingTime: number };
  const controls = {
    sunlight: boolean( model.sunEnergySource.isShiningProperty ),
    sunlightOutput: number( model.sunEnergySource.proportionateOutputRateProperty ),
    temperatureUnits: enumeration( model.temperatureUnitsProperty ),
    temperatureGlow: boolean( model.surfaceTemperatureVisibleProperty ),
    energyBalanceVisible: boolean( model.energyBalanceVisibleProperty ),
    energyBalance: boolean( model.inRadiativeBalanceProperty ),
    netEnergy: number( model.netInflowOfEnergyProperty ),
    fluxMeterVisible: boolean( model.fluxMeterVisibleProperty ),
    albedo: number( model.groundLayer.albedoProperty ),
    speed: enumeration( model.timeSpeedProperty ),
    ...( model.fluxMeter ? {
      meterPosition: vector( model.fluxMeter.wireMeterAttachmentPositionProperty ),
      sensorAltitude: number( model.fluxMeter.fluxSensor.altitudeProperty ),
      meterZoom: number( model.fluxMeter.zoomFactorProperty )
    } : {} ),
    ...( model instanceof ConcentrationModel ? {
      concentrationMode: enumeration( model.concentrationControlModeProperty ),
      date: enumeration( model.dateProperty ),
      concentration: number( model.manuallyControlledConcentrationProperty ),
      clouds: boolean( model.cloudEnabledInManualConcentrationModeProperty )
    } : {} ),
    ...( model instanceof LayerModelModel ? {
      layers: number( model.numberOfActiveAtmosphereLayersProperty, true ),
      absorbance: number( model.layersInfraredAbsorbanceProperty )
    } : {} )
  };
  const playback = { playing: boolean( model.isPlayingProperty ) };
  const layers = [ model.groundLayer, ...model.atmosphereLayers ].map( layer => ( {
    temperature: number( layer.temperatureProperty, false, value => value >= 0 && value <= 10000 ),
    showTemperature: boolean( layer.showTemperatureProperty ),
    equilibrium: boolean( layer.atEquilibriumProperty )
  } ) );
  const sensor = model.fluxMeter?.fluxSensor;
  const trackers = [
    model.sunEnergySource.outputEnergyRateTracker,
    model.outerSpace.incomingUpwardMovingEnergyRateTracker,
    ...( sensor ? [ sensor.visibleLightDownEnergyRateTracker, sensor.visibleLightUpEnergyRateTracker,
      sensor.infraredLightDownEnergyRateTracker, sensor.infraredLightUpEnergyRateTracker ] : [] )
  ].map( trackerState );
  const radiation = model instanceof WavesModel ? wavesState( model ) : photonsState( model.photonCollection );
  return {
    isPlaying: () => model.isPlayingProperty.value && ( model.sunEnergySource.isShiningProperty.value || internals.emEnergyPackets.length > 0 ),
    read: () => ( {
      controls: readFields( controls ),
      playback: readFields( playback ),
      elapsed: model.totalElapsedTime,
      steppingTime: internals.modelSteppingTime,
      layers: layers.map( readFields ),
      trackers: trackers.map( tracker => tracker.read() ),
      radiation: radiation.read(),
      packets: internals.emEnergyPackets.map( packet => [ packet.wavelength, packet.energy, packet.altitude, packet.previousAltitude, packet.direction.name ] )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( controls, state.controls );
      const applyPlayback = prepareFields( playback, state.playback );
      const elapsed = scalar( state.elapsed, 0, 1e12 );
      const steppingTime = scalar( state.steppingTime, 0, 1 );
      const layerInputs = list( state.layers, layers.length );
      const trackerInputs = list( state.trackers, trackers.length );
      if ( layerInputs.length !== layers.length || trackerInputs.length !== trackers.length ) {
        throw new Error( 'Invalid greenhouse layer or instrument count.' );
      }
      const applyLayers = layers.map( ( layer, i ) => prepareFields( layer, layerInputs[ i ] ) );
      const applyTrackers = trackers.map( ( tracker, i ) => tracker.prepare( trackerInputs[ i ] ) );
      const applyRadiation = radiation.prepare( state.radiation );
      const packets = list( state.packets, 10000 ).map( input => {
        if ( !Array.isArray( input ) || input.length !== 5 ) { throw new Error( 'Invalid energy packet.' ); }
        const direction = EnergyDirection.enumeration.values.find( direction => direction.name === input[ 4 ] );
        if ( !direction ) { throw new Error( 'Invalid energy packet direction.' ); }
        const packet = new EMEnergyPacket( wavelength( input[ 0 ] ), scalar( input[ 1 ], 0, 1e40 ), scalar( input[ 2 ], -1e9, 1e9 ), direction );
        packet.previousAltitude = scalar( input[ 3 ], -1e9, 1e9 );
        return packet;
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        model.reset();
        model.isPlayingProperty.value = false;
        apply();
        applyLayers.forEach( restore => restore() );
        applyTrackers.forEach( restore => restore() );
        internals.emEnergyPackets.splice( 0, internals.emEnergyPackets.length, ...packets );
        model.totalElapsedTime = elapsed;
        internals.modelSteppingTime = steppingTime;
        applyRadiation();
        applyPlayback();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'waves', 'photons', 'layer-model' ];
  const preferences = {
    defaultTemperatureUnits: enumeration( GreenhouseEffectPreferences.defaultTemperatureUnitsProperty ),
    cueingArrows: boolean( GreenhouseEffectPreferences.cueingArrowsEnabledProperty )
  };
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-greenhouse-effect/v1',
    build: 'greenhouse-effect@1.4.0-dev.0-webwriter.1',
    readPreferences: () => readFields( preferences ),
    preparePreferences: input => prepareFields( preferences, input ),
    screens: sim.simScreens.map( ( screen, i ) => ( { id: ids[ i ], screen, ...screenState( screen ) } ) )
  } ) );
}
