// Under Pressure WebWriter state adapter. Distributed under GPL-3.0.
import type UnderPressureModel from '../../../fluid-pressure-and-flow/js/under-pressure/model/UnderPressureModel.js';
import type ChamberPoolModel from '../../../fluid-pressure-and-flow/js/under-pressure/model/ChamberPoolModel.js';
import type MysteryPoolModel from '../../../fluid-pressure-and-flow/js/under-pressure/model/MysteryPoolModel.js';
import type TrapezoidPoolModel from '../../../fluid-pressure-and-flow/js/under-pressure/model/TrapezoidPoolModel.js';
import type SquarePoolModel from '../../../fluid-pressure-and-flow/js/under-pressure/model/SquarePoolModel.js';
import type Sim from '../../../joist/js/Sim.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

const sceneNames = [ 'square', 'trapezoid', 'chamber', 'mystery' ];
const unitsNames = [ 'metric', 'english', 'atmosphere' ];
const mysteryChoices = [ 'fluidDensity', 'gravity' ];

function poolFields( pool: SquarePoolModel | TrapezoidPoolModel | MysteryPoolModel ) {
  return {
    volume: number( pool.volumeProperty, false, value => value >= 0 && value <= pool.maxVolume ),
    input: number( pool.inputFaucet.flowRateProperty, false, value => value >= 0 && value <= pool.inputFaucet.maxFlowRate ),
    output: number( pool.outputFaucet.flowRateProperty, false, value => value >= 0 && value <= pool.outputFaucet.maxFlowRate )
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as UnderPressureModel;
    const { square, trapezoid, chamber, mystery } = model.sceneModels as {
      square: SquarePoolModel;
      trapezoid: TrapezoidPoolModel;
      chamber: ChamberPoolModel;
      mystery: MysteryPoolModel;
    };
    const pools = [ square, trapezoid, mystery ];
    const poolBindings = pools.map( poolFields );
    const fields = {
      atmosphere: boolean( model.isAtmosphereProperty ),
      ruler: boolean( model.isRulerVisibleProperty ),
      grid: boolean( model.isGridVisibleProperty ),
      units: field( model.measureUnitsProperty, String, input => unitsNames.find( value => value === input ) ),
      rulerPosition: vector( model.rulerPositionProperty ),
      gravityExpanded: boolean( model.gravityControlExpandedProperty ),
      densityExpanded: boolean( model.fluidDensityControlExpandedProperty ),
      mysteryChoice: field( model.mysteryChoiceProperty, String, input => mysteryChoices.find( value => value === input ) ),
      mysteryDensity: number( mystery.customFluidDensityProperty, true, value => value >= 0 && value < mystery.fluidDensityChoices.length ),
      mysteryGravity: number( mystery.customGravityProperty, true, value => value >= 0 && value < mystery.gravityChoices.length ),
      displacement: number( chamber.leftDisplacementProperty, false, value => value >= 0 && value <= 50 )
    };
    const massFields = chamber.masses.map( mass => ( { position: vector( mass.positionProperty ) } ) );
    const sensors = model.barometers.map( sensor => ( { position: vector( sensor.positionProperty ) } ) );
    let gravity = model.gravityProperty.value;
    let density = model.fluidDensityProperty.value;
    model.gravityProperty.lazyLink( value => {
      if ( model.currentSceneProperty.value !== 'mystery' ) { gravity = value; }
    } );
    model.fluidDensityProperty.lazyLink( value => {
      if ( model.currentSceneProperty.value !== 'mystery' ) { density = value; }
    } );
    return {
      bridge: 'webwriter-under-pressure/v1',
      build: 'under-pressure@1.2.0-dev.0-webwriter.1',
      screens: [ {
        id: 'under-pressure',
        screen,
        isPlaying: () => {
          const pool = model.currentSceneModelProperty.value;
          return pool === chamber ? chamber.leftDisplacementProperty.value > 1e-6 && chamber.stack.length === 0 ||
            chamber.masses.some( mass => mass.isFalling || Math.abs( mass.velocity ) > 0.05 ) :
            pool.inputFaucet.flowRateProperty.value > 0 || pool.outputFaucet.flowRateProperty.value > 0;
        },
        read: () => ( {
          ...readFields( fields ),
          scene: model.currentSceneProperty.value,
          gravity,
          density,
          pools: poolBindings.map( readFields ),
          sensors: sensors.map( readFields ),
          stack: chamber.stack.map( mass => chamber.masses.indexOf( mass ) ),
          masses: chamber.masses.map( ( mass, index ) => ( {
            ...readFields( massFields[ index ] ),
            velocity: mass.velocity,
            falling: mass.isFalling
          } ) )
        } ),
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( fields, state );
          const { scene, gravity: savedGravity, density: savedDensity, pools, sensors: savedSensors, stack, masses } = state;
          if ( typeof scene !== 'string' || !sceneNames.includes( scene ) ||
               typeof savedGravity !== 'number' || !model.gravityRange.contains( savedGravity ) ||
               typeof savedDensity !== 'number' || !model.fluidDensityRange.contains( savedDensity ) ||
               !Array.isArray( pools ) || pools.length !== poolBindings.length ||
               !Array.isArray( savedSensors ) || savedSensors.length !== sensors.length ||
               !Array.isArray( masses ) || masses.length !== chamber.masses.length ||
               !Array.isArray( stack ) || new Set( stack ).size !== stack.length ||
               !stack.every( index => Number.isInteger( index ) && chamber.masses[ index ] ) ) {
            throw new Error( 'Invalid pressure scene.' );
          }
          const applyPools = poolBindings.map( ( fields, index ) => prepareFields( fields, pools[ index ] ) );
          const applySensors = sensors.map( ( fields, index ) => prepareFields( fields, savedSensors[ index ] ) );
          const applyMasses = masses.map( ( input, index ) => {
            const state = object( input );
            const applyPosition = prepareFields( massFields[ index ], state );
            const { velocity, falling } = state;
            if ( typeof velocity !== 'number' || !Number.isFinite( velocity ) || Math.abs( velocity ) > 1000 ||
                 typeof falling !== 'boolean' ) { throw new Error( 'Invalid chamber mass.' ); }
            return () => {
              const mass = chamber.masses[ index ];
              mass.isDraggingProperty.value = false;
              applyPosition();
              mass.velocity = velocity;
              mass.isFalling = falling;
            };
          } );
          return () => {
            screen.view.interruptSubtreeInput();
            model.currentSceneProperty.value = 'square';
            apply();
            gravity = model.gravityProperty.value = savedGravity;
            density = model.fluidDensityProperty.value = savedDensity;
            applyPools.forEach( apply => apply() );
            chamber.stack.clear();
            stack.forEach( index => chamber.stack.push( chamber.masses[ index ] ) );
            applyMasses.forEach( apply => apply() );
            model.currentSceneProperty.value = scene;
            model.currentVolumeProperty.value = model.currentSceneModelProperty.value.volumeProperty.value;
            applySensors.forEach( apply => apply() );
          };
        }
      } ]
    };
  } );
}
