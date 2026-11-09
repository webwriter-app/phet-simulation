// Gas Properties and Gases Intro state bindings. Distributed under GPL-3.0.
import type { AnyScreen } from '../Screen.js';
import { writableIsSettingPhetioStateProperty } from '../../../tandem/js/isSettingPhetioStateProperty.js';
import type BaseModel from '../../../gas-properties/js/common/model/BaseModel.js';
import CollisionCounter from '../../../gas-properties/js/common/model/CollisionCounter.js';
import GasPropertiesPreferences from '../../../gas-properties/js/common/model/GasPropertiesPreferences.js';
import HeavyParticle from '../../../gas-properties/js/common/model/HeavyParticle.js';
import type IdealGasLawModel from '../../../gas-properties/js/common/model/IdealGasLawModel.js';
import LightParticle from '../../../gas-properties/js/common/model/LightParticle.js';
import type Particle from '../../../gas-properties/js/common/model/Particle.js';
import DiffusionModel from '../../../gas-properties/js/diffusion/model/DiffusionModel.js';
import DiffusionParticle1 from '../../../gas-properties/js/diffusion/model/DiffusionParticle1.js';
import DiffusionParticle2 from '../../../gas-properties/js/diffusion/model/DiffusionParticle2.js';
import DiffusionSettings from '../../../gas-properties/js/diffusion/model/DiffusionSettings.js';
import type ParticleFlowRateModel from '../../../gas-properties/js/diffusion/model/ParticleFlowRateModel.js';
import type DiffusionScreenView from '../../../gas-properties/js/diffusion/view/DiffusionScreenView.js';
import EnergyModel from '../../../gas-properties/js/energy/model/EnergyModel.js';
import type EnergyScreenView from '../../../gas-properties/js/energy/view/EnergyScreenView.js';
import ExploreModel from '../../../gas-properties/js/explore/model/ExploreModel.js';
import type ExploreScreenView from '../../../gas-properties/js/explore/view/ExploreScreenView.js';
import type IdealScreenView from '../../../gas-properties/js/ideal/view/IdealScreenView.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

type Kinematics = { x: number; y: number; previousX: number; previousY: number; vx: number; vy: number };

export const gasPreferences = { pressureNoise: boolean( GasPropertiesPreferences.pressureNoiseProperty ) };

function readParticles( particles: Particle[] ) {
  return particles.map( ( { x, y, previousX, previousY, vx, vy } ) => [ x, y, previousX, previousY, vx, vy ] );
}

function prepareParticles( input: unknown, max: number ): Kinematics[] {
  if ( !Array.isArray( input ) || input.length > max ) { throw new Error( 'Invalid gas particle count.' ); }
  return input.map( particle => {
    if ( !Array.isArray( particle ) || particle.length !== 6 ||
         !particle.every( value => typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) <= 1e6 ) ) {
      throw new Error( 'Invalid gas particle trajectory.' );
    }
    const [ x, y, previousX, previousY, vx, vy ] = particle;
    return { x, y, previousX, previousY, vx, vy };
  } );
}

function nullableNumber( property: { value: number | null }, valid: ( value: number ) => boolean ) {
  return field( property, value => value, value => value === null ? null :
    typeof value === 'number' && Number.isFinite( value ) && valid( value ) ? value : undefined );
}

function baseFields( model: BaseModel ) {
  const stopwatch = model.stopwatch;
  return {
    timeSpeed: enumeration( model.timeSpeedProperty ),
    stopwatchVisible: boolean( stopwatch.isVisibleProperty ),
    stopwatchPosition: vector( stopwatch.positionProperty ),
    stopwatchRunning: boolean( stopwatch.isRunningProperty ),
    stopwatchTime: number( stopwatch.timeProperty ),
    playing: boolean( model.isPlayingProperty )
  };
}

function idealState( screen: AnyScreen ) {
  const model = screen.model as IdealGasLawModel;
  const view = screen.view as IdealScreenView | ExploreScreenView | EnergyScreenView;
  const props = view[ 'viewProperties' ];
  const { container, particleSystem: system, temperatureModel, pressureModel } = model;
  const fields = {
    holdConstant: enumeration( model.holdConstantProperty ),
    heatCool: number( model.heatCoolAmountProperty ),
    width: number( container.widthProperty ),
    targetWidth: number( container[ 'desiredWidthProperty' ], false, value => container.widthProperty.range.contains( value ) ),
    previousLeft: number( container[ 'previousLeftProperty' ] ),
    wallVelocity: number( container._leftWallAverageVelocityXProperty ),
    lidOn: boolean( container[ '_lidIsOnProperty' ] ),
    lidWidth: number( container.lidWidthProperty ),
    collisionsEnabled: boolean( system.collisionsEnabledProperty ),
    temperatureUnits: enumeration( temperatureModel.unitsProperty ),
    temperature: nullableNumber( temperatureModel.temperatureKelvinProperty, value => value > 0 ),
    injectionEnabled: boolean( temperatureModel.setInjectionTemperatureEnabledProperty ),
    injectionTemperature: number( temperatureModel.injectionTemperatureProperty ),
    pressureUnits: enumeration( pressureModel.unitsProperty ),
    pressure: number( pressureModel.pressureKilopascalsProperty, false, value => value >= 0 ),
    pressureWithNoise: number( pressureModel.pressureKilopascalsNoiseProperty, false, value => value >= 0 ),
    pressureSampleTime: number( pressureModel[ 'dtAccumulatorProperty' ], false, value => value >= 0 ),
    widthVisible: boolean( props.widthVisibleProperty ),
    particlesExpanded: boolean( props.particlesExpandedProperty ),
    particleType: enumeration( props.particleTypeProperty ),
    ...( model instanceof EnergyModel ? {
      histogramZoom: number( model.histogramsModel.zoomLevelIndexProperty, true ),
      averageSpeedExpanded: boolean( ( view as EnergyScreenView )[ 'viewProperties' ].averageSpeedExpandedProperty ),
      speedExpanded: boolean( ( view as EnergyScreenView )[ 'viewProperties' ].speedExpandedProperty ),
      kineticEnergyExpanded: boolean( ( view as EnergyScreenView )[ 'viewProperties' ].kineticEnergyExpandedProperty ),
      injectionTemperatureExpanded: boolean( ( view as EnergyScreenView )[ 'viewProperties' ].injectionTemperatureExpandedProperty )
    } : {} ),
    ...( model instanceof ExploreModel ? {
      wallVelocityVisible: boolean( ( view as ExploreScreenView )[ 'viewProperties' ].wallVelocityVisibleProperty )
    } : {} )
  };
  const counter = model.collisionCounter;
  const counterFields = counter && {
    position: vector( counter.positionProperty ),
    visible: boolean( counter.visibleProperty ),
    period: number( counter.samplePeriodProperty, true, value => CollisionCounter.SAMPLE_PERIODS.includes( value ) ),
    running: boolean( counter.isRunningProperty ),
    count: number( counter.numberOfCollisionsProperty, true, value => value >= 0 ),
    time: number( counter[ 'timeRunningProperty' ], false, value => value >= 0 )
  };
  const base = baseFields( model );
  return {
    isPlaying: () => model.isPlayingProperty.value && ( system.numberOfParticlesProperty.value > 0 ||
      system.heavyParticlesOutside.length > 0 || system.lightParticlesOutside.length > 0 ||
      model.stopwatch.isRunningProperty.value || counter?.isRunningProperty.value === true ||
      container.widthProperty.value !== container[ 'desiredWidthProperty' ].value ),
    read: () => ( {
      ...readFields( fields ),
      ...readFields( base ),
      counter: counterFields && readFields( counterFields ),
      heavy: readParticles( system.heavyParticles ),
      light: readParticles( system.lightParticles ),
      heavyOutside: readParticles( system.heavyParticlesOutside ),
      lightOutside: readParticles( system.lightParticlesOutside )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const applyBase = prepareFields( base, state );
      const applyCounter = counterFields && prepareFields( counterFields, state.counter );
      const heavy = prepareParticles( state.heavy, system.numberOfHeavyParticlesProperty.range.max );
      const light = prepareParticles( state.light, system.numberOfLightParticlesProperty.range.max );
      const heavyOutside = prepareParticles( state.heavyOutside, 5000 );
      const lightOutside = prepareParticles( state.lightOutside, 5000 );
      const maxLid = ( state.width as number ) - container.openingRightInset + container.wallThickness;
      const hold = state.holdConstant;
      if ( ( counterFields === null && state.counter !== null ) ||
           ( state.lidWidth as number ) < container.getMinLidWidth() ||
           ( state.lidOn && ( state.lidWidth as number ) > maxLid ) ||
           ( state.temperature === null ) !== ( heavy.length + light.length === 0 ) ||
           ( ( hold === 'temperature' || hold === 'pressureV' || hold === 'pressureT' ) && heavy.length + light.length === 0 ) ||
           ( hold === 'temperature' && ( !state.lidOn || state.lidWidth !== maxLid ) ) ||
           ( ( hold === 'pressureV' || hold === 'pressureT' ) && state.pressure === 0 ) ) {
        throw new Error( 'Inconsistent ideal gas state.' );
      }
      return () => {
        view.interruptSubtreeInput();
        model.reset();
        model.isPlayingProperty.value = false;
        writableIsSettingPhetioStateProperty.value = true;
        try {
          system.heavyParticles.push( ...heavy.map( particle => new HeavyParticle( particle ) ) );
          system.lightParticles.push( ...light.map( particle => new LightParticle( particle ) ) );
          system.heavyParticlesOutside.push( ...heavyOutside.map( particle => new HeavyParticle( particle ) ) );
          system.lightParticlesOutside.push( ...lightOutside.map( particle => new LightParticle( particle ) ) );
          system.numberOfHeavyParticlesProperty.value = heavy.length;
          system.numberOfLightParticlesProperty.value = light.length;
          applyFields();
          applyCounter?.();
          applyBase();
        }
        finally {
          writableIsSettingPhetioStateProperty.value = false;
        }
        if ( model instanceof EnergyModel ) {
          model.histogramsModel[ 'sample' ]();
          model.histogramsModel[ 'updateBinCounts' ]();
          model.averageSpeedModel[ 'sample' ]();
          model.averageSpeedModel[ 'update' ]();
        }
      };
    }
  };
}

function flowState( flow: ParticleFlowRateModel ) {
  const left = flow[ 'leftCounts' ];
  const right = flow[ 'rightCounts' ];
  const steps = flow[ 'dts' ];
  return {
    read: () => steps.map( ( dt, index ) => [ dt, left[ index ], right[ index ] ] ),
    prepare: ( input: unknown, particleCount: number ) => {
      if ( !Array.isArray( input ) || input.length > 300 || !input.every( sample =>
        Array.isArray( sample ) && sample.length === 3 && typeof sample[ 0 ] === 'number' &&
        Number.isFinite( sample[ 0 ] ) && sample[ 0 ] > 0 &&
        sample.slice( 1 ).every( count => Number.isInteger( count ) && count >= 0 && count <= particleCount ) ) ) {
        throw new Error( 'Invalid diffusion flow samples.' );
      }
      const sum = ( values: number[] ) => values.reduce( ( total, value ) => total + value, 0 );
      return () => {
        flow.reset();
        input.forEach( ( [ dt, leftCount, rightCount ] ) => {
          steps.push( dt );
          left.push( leftCount );
          right.push( rightCount );
        } );
        if ( steps.length ) {
          const elapsed = sum( steps );
          flow.leftFlowRateProperty.value = sum( left ) / elapsed;
          flow.rightFlowRateProperty.value = sum( right ) / elapsed;
        }
      };
    }
  };
}

function diffusionState( screen: AnyScreen ) {
  const model = screen.model as DiffusionModel;
  const view = screen.view as DiffusionScreenView;
  const props = view[ 'viewProperties' ];
  const system = model.particleSystem;
  const settings = [ system.particle1Settings, system.particle2Settings ].map( settings => ( {
    mass: number( settings.massProperty, true, value => value % DiffusionSettings.DELTAS.mass === 0 ),
    radius: number( settings.radiusProperty, true, value => value % DiffusionSettings.DELTAS.radius === 0 ),
    temperature: number( settings.initialTemperatureProperty, true, value => value % DiffusionSettings.DELTAS.initialTemperature === 0 )
  } ) );
  const arrays = [ system.particles1, system.particles2 ];
  const flows = [ flowState( system.particle1FlowRateModel ), flowState( system.particle2FlowRateModel ) ];
  const fields = {
    divider: boolean( model.container.isDividedProperty ),
    dataExpanded: boolean( props.dataExpandedProperty ),
    flowRate: boolean( props.particleFlowRateVisibleProperty ),
    centerOfMass: boolean( props.centerOfMassVisibleProperty ),
    scaleVisible: boolean( props.scaleVisibleProperty )
  };
  const base = baseFields( model );
  return {
    isPlaying: () => model.isPlayingProperty.value && ( system.numberOfParticlesProperty.value > 0 || model.stopwatch.isRunningProperty.value ),
    read: () => ( {
      ...readFields( fields ),
      ...readFields( base ),
      populations: arrays.map( ( particles, index ) => ( {
        ...readFields( settings[ index ] ),
        particles: readParticles( particles ),
        flow: flows[ index ].read()
      } ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const applyBase = prepareFields( base, state );
      const { populations } = state;
      if ( !Array.isArray( populations ) || populations.length !== arrays.length ) {
        throw new Error( 'Invalid number of diffusion particle types.' );
      }
      const restore = populations.map( ( input, index ) => {
        const population = object( input );
        const applySettings = prepareFields( settings[ index ], population );
        const properties = index === 0 ? system.particle1Settings : system.particle2Settings;
        const count = properties.numberOfParticlesProperty;
        const particles = prepareParticles( population.particles, count.range.max );
        if ( particles.length % DiffusionSettings.DELTAS.numberOfParticles !== 0 ) {
          throw new Error( 'Invalid diffusion population size.' );
        }
        const applyFlow = flows[ index ].prepare( population.flow, count.range.max );
        return () => {
          applySettings();
          const Ctor = index === 0 ? DiffusionParticle1 : DiffusionParticle2;
          const target: Particle[] = arrays[ index ];
          particles.forEach( particle => target.push( new Ctor( {
            ...particle, mass: properties.massProperty.value, radius: properties.radiusProperty.value
          } ) ) );
          count.value = particles.length;
          applyFlow();
        };
      } );
      return () => {
        view.interruptSubtreeInput();
        model.reset();
        model.isPlayingProperty.value = false;
        writableIsSettingPhetioStateProperty.value = true;
        try {
          applyFields();
          restore.forEach( apply => apply() );
          system.updateCenterOfMass();
          model.leftData.update();
          model.rightData.update();
          applyBase();
        }
        finally {
          writableIsSettingPhetioStateProperty.value = false;
        }
      };
    }
  };
}

export default function gasState( screen: AnyScreen ) {
  return screen.model instanceof DiffusionModel ? diffusionState( screen ) : idealState( screen );
}
