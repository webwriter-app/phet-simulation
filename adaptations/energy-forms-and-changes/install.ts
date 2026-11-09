// Energy Forms and Changes WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Beaker from '../common/model/Beaker.js';
import type EnergyChunkGroup from '../common/model/EnergyChunkGroup.js';
import { EnergyTypeValues } from '../common/model/EnergyType.js';
import type TemperatureAndColorSensor from '../common/model/TemperatureAndColorSensor.js';
import type EFACIntroModel from '../intro/model/EFACIntroModel.js';
import type SystemsModel from '../systems/model/SystemsModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields, vector } from './stateFields.js';

function scalar( input: unknown, limit: number ): number {
  if ( typeof input !== 'number' || !Number.isFinite( input ) || Math.abs( input ) > limit ) {
    throw new Error( 'Invalid energy model value.' );
  }
  return input;
}

function thermometerFields( sensor: TemperatureAndColorSensor ) {
  return { active: boolean( sensor.activeProperty ), position: vector( sensor.positionProperty ) };
}

function beakerFields( beaker: Beaker ) {
  return {
    energy: number( beaker.energyProperty, false, value => value >= 0 && value <= 1e8 ),
    fluid: number( beaker.fluidProportionProperty )
  };
}

function introState( screen: AnyScreen ) {
  const model = screen.model as EFACIntroModel;
  const containers = [ ...model.blockGroup.getArray(), ...model.beakerGroup.getArray() ];
  const surfaces = [ ...containers, model.leftBurner, model.rightBurner ].map( modelElement => modelElement?.topSurface ?? null );
  const chunkGroup = ( model as unknown as { energyChunkGroup: EnergyChunkGroup } ).energyChunkGroup;
  const controls = {
    energySymbols: boolean( model.energyChunksVisibleProperty ),
    linkHeaters: boolean( model.linkedHeatersProperty ),
    speed: enumeration( model.timeSpeedProperty ),
    leftBurner: number( model.leftBurner.heatCoolLevelProperty ),
    ...( model.twoBurners ? { rightBurner: number( model.rightBurner.heatCoolLevelProperty ) } : {} )
  };
  const playback = { playing: boolean( model.isPlayingProperty ) };
  const items = containers.map( container => ( {
    position: vector( container.positionProperty ),
    verticalVelocity: number( container.verticalVelocityProperty ),
    energy: number( container.energyProperty, false, value => value >= 0 && value <= 1e8 ),
    ...( 'fluidProportionProperty' in container ? { fluid: number( container.fluidProportionProperty ) } : {} )
  } ) );
  const thermometers = model.thermometers.map( thermometerFields );

  return {
    isPlaying: () => model.isPlayingProperty.value,
    read: () => ( {
      controls: readFields( controls ),
      playback: readFields( playback ),
      thermometers: thermometers.map( readFields ),
      items: items.map( ( fields, i ) => {
        const container = containers[ i ];
        return {
          ...readFields( fields ),
          support: container.supportingSurface ? surfaces.indexOf( container.supportingSurface ) : null,
          energySlices: container.slices.map( slice => slice.energyChunkList.map( chunk => [
            chunk.energyTypeProperty.value, chunk.positionProperty.value.x, chunk.positionProperty.value.y, chunk.velocity.x, chunk.velocity.y
          ] ) )
        };
      } )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state.controls );
      const applyPlayback = prepareFields( playback, state.playback );
      if ( !Array.isArray( state.items ) || state.items.length !== items.length ||
           !Array.isArray( state.thermometers ) || state.thermometers.length !== thermometers.length ) {
        throw new Error( 'Invalid energy model object count.' );
      }
      const itemInputs = state.items;
      const thermometerInputs = state.thermometers;
      const applyThermometers = thermometers.map( ( fields, i ) => prepareFields( fields, thermometerInputs[ i ] ) );
      const restoredItems = items.map( ( fields, i ) => {
        const entry = object( itemInputs[ i ] );
        const apply = prepareFields( fields, entry );
        const { support } = entry;
        if ( support !== null && ( typeof support !== 'number' || !Number.isInteger( support ) || support === i || !surfaces[ support ] ) ) {
          throw new Error( 'Invalid thermal object support.' );
        }
        const container = containers[ i ];
        if ( !Array.isArray( entry.energySlices ) || entry.energySlices.length !== container.slices.length ) {
          throw new Error( 'Invalid thermal object slices.' );
        }
        const slices = entry.energySlices.map( input => {
          if ( !Array.isArray( input ) || input.length > 500 ) { throw new Error( 'Invalid energy symbol count.' ); }
          return input.map( chunk => {
            if ( !Array.isArray( chunk ) || chunk.length !== 5 || !EnergyTypeValues.includes( chunk[ 0 ] ) ) {
              throw new Error( 'Invalid energy symbol.' );
            }
            return {
              type: chunk[ 0 ] as typeof EnergyTypeValues[number],
              position: new Vector2( scalar( chunk[ 1 ], 10 ), scalar( chunk[ 2 ], 10 ) ),
              velocity: new Vector2( scalar( chunk[ 3 ], 100 ), scalar( chunk[ 4 ], 100 ) )
            };
          } );
        } );
        return { apply, support: support as number | null, slices };
      } );
      const occupied = new Set<number>();
      restoredItems.forEach( ( item, i ) => {
        if ( item.support !== null ) {
          if ( occupied.has( item.support ) ) { throw new Error( 'Multiple objects on one support.' ); }
          occupied.add( item.support );
        }
        const chain = new Set( [ i ] );
        for ( let below = item.support; below !== null && below < restoredItems.length; below = restoredItems[ below ].support ) {
          if ( chain.has( below ) ) { throw new Error( 'Circular thermal object stack.' ); }
          chain.add( below );
        }
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        model.reset();
        model.isPlayingProperty.value = false;
        applyControls();
        restoredItems.forEach( ( item, i ) => {
          item.apply();
          const container = containers[ i ];
          container.temperatureProperty.value = container.getTemperature();
        } );
        restoredItems.forEach( ( { support, slices }, i ) => {
          const container = containers[ i ];
          if ( support !== null ) {
            const surface = surfaces[ support ]!;
            container.setSupportingSurface( surface );
            surface.elementOnSurfaceProperty.value = container;
          }
          container.slices.forEach( ( slice, j ) => {
            slice.energyChunkList.forEach( chunk => chunkGroup.disposeElement( chunk ) );
            slice.energyChunkList.clear();
            slices[ j ].forEach( ( { type, position, velocity } ) => {
              slice.addEnergyChunk( chunkGroup.createNextElement( type, position, velocity, model.energyChunksVisibleProperty ) );
            } );
          } );
        } );
        model.thermometers.forEach( ( sensor, i ) => {
          sensor.userControlledProperty!.value = true;
          applyThermometers[ i ]();
          sensor.userControlledProperty!.value = false;
          sensor.step();
        } );
        applyPlayback();
      };
    }
  };
}

function systemsState( screen: AnyScreen ) {
  const model = screen.model as SystemsModel;
  const carousels = [ model.energySourcesCarousel, model.energyConvertersCarousel, model.energyUsersCarousel ];
  const generator = model.generator as unknown as { wheelRotationalVelocityProperty: { value: number } };
  const fan = model.fan as unknown as {
    angularVelocityProperty: { value: number };
    internalEnergyFromEnergyChunksProperty: { value: number };
    targetVelocityProperty: { value: number };
  };
  const selections = {
    source: enumeration( model.energySourcesCarousel.targetElementNameProperty ),
    converter: enumeration( model.energyConvertersCarousel.targetElementNameProperty ),
    user: enumeration( model.energyUsersCarousel.targetElementNameProperty )
  };
  const controls = {
    energySymbols: boolean( model.energyChunksVisibleProperty ),
    crankAngle: number( model.biker.crankAngleProperty ),
    rearWheelAngle: number( model.biker.rearWheelAngleProperty ),
    targetCrankSpeed: number( model.biker.targetCrankAngularVelocityProperty ),
    crankSpeed: number( model.biker.crankAngularVelocityProperty ),
    fuel: number( model.biker.energyChunksRemainingProperty, true, value => value >= 0 ),
    waterFlow: number( model.faucetAndWater.flowProportionProperty ),
    cloudiness: number( model.sun.cloudinessProportionProperty ),
    kettleHeat: number( model.teaKettle.heatProportionProperty ),
    kettleOutput: number( model.teaKettle.energyProductionRateProperty ),
    generatorWheel: number( model.generator.wheelRotationalAngleProperty ),
    generatorSpeed: number( generator.wheelRotationalVelocityProperty ),
    heaterHeat: number( model.beakerHeater.heatProportionProperty ),
    incandescentBrightness: number( model.incandescentBulb.litProportionProperty ),
    fluorescentBrightness: number( model.fluorescentBulb.litProportionProperty ),
    fanBlade: number( model.fan.bladePositionProperty ),
    fanSpeed: number( fan.angularVelocityProperty ),
    fanTarget: number( fan.targetVelocityProperty ),
    fanEnergy: number( fan.internalEnergyFromEnergyChunksProperty )
  };
  const beaker = beakerFields( model.beakerHeater.beaker );
  const thermometer = thermometerFields( model.beakerHeater.thermometer );
  const playback = { playing: boolean( model.isPlayingProperty ) };
  return {
    isPlaying: () => model.isPlayingProperty.value || carousels.some( carousel => carousel.animationInProgressProperty.value ),
    read: () => ( {
      selections: readFields( selections ),
      controls: readFields( controls ),
      beaker: readFields( beaker ),
      thermometer: readFields( thermometer ),
      playback: readFields( playback )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applySelections = prepareFields( selections, state.selections );
      const applyControls = prepareFields( controls, state.controls );
      const applyBeaker = prepareFields( beaker, state.beaker );
      const applyThermometer = prepareFields( thermometer, state.thermometer );
      const applyPlayback = prepareFields( playback, state.playback );
      return () => {
        screen.view.interruptSubtreeInput();
        model.reset();
        model.isPlayingProperty.value = false;
        applySelections();
        // Complete the equipment transition before restoring fields that activation can reset.
        carousels.forEach( carousel => carousel.step( 1 ) );
        applyControls();
        applyBeaker();
        applyThermometer();
        model.beakerHeater.beaker.temperatureProperty.value = model.beakerHeater.beaker.getTemperature();
        model.beakerHeater.thermometer.step();
        applyPlayback();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-energy-forms-and-changes/v1',
    build: 'energy-forms-and-changes@1.5.0-dev.5-webwriter.1',
    screens: sim.simScreens.map( ( screen, i ) => i === 0 ?
      { id: 'intro', screen, ...introState( screen ) } : { id: 'systems', screen, ...systemsState( screen ) } )
  } ) );
}
