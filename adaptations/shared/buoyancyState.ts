// Buoyancy WebWriter state. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import BuoyancyBasicsExploreModel from '../../../density-buoyancy-common/js/buoyancy-basics/model/BuoyancyBasicsExploreModel.js';
import BuoyancyExploreModel from '../../../density-buoyancy-common/js/buoyancy/model/BuoyancyExploreModel.js';
import BuoyancyLabModel from '../../../density-buoyancy-common/js/buoyancy/model/BuoyancyLabModel.js';
import BuoyancyApplicationsModel from '../../../density-buoyancy-common/js/buoyancy/model/applications/BuoyancyApplicationsModel.js';
import type BuoyancyShapeModel from '../../../density-buoyancy-common/js/buoyancy/model/shapes/BuoyancyShapeModel.js';
import BuoyancyShapesModel from '../../../density-buoyancy-common/js/buoyancy/model/shapes/BuoyancyShapesModel.js';
import type DisplayProperties from '../../../density-buoyancy-common/js/buoyancy/view/DisplayProperties.js';
import CompareBlockSetModel from '../../../density-buoyancy-common/js/common/model/CompareBlockSetModel.js';
import type Cuboid from '../../../density-buoyancy-common/js/common/model/Cuboid.js';
import DensityBuoyancyCommonPreferences, { supportsPercentageSubmergedVisible } from '../../../density-buoyancy-common/js/common/model/DensityBuoyancyCommonPreferences.js';
import DensityIntroModel from '../../../density-buoyancy-common/js/density/model/DensityIntroModel.js';
import DensityMysteryModel, { MysteryBlockSet } from '../../../density-buoyancy-common/js/density/model/DensityMysteryModel.js';
import Color from '../../../scenery/js/util/Color.js';
import ColorProperty from '../../../scenery/js/util/ColorProperty.js';
import type DensityBuoyancyModel from '../../../density-buoyancy-common/js/common/model/DensityBuoyancyModel.js';
import type MappedWrappedProperty from '../../../density-buoyancy-common/js/common/model/MappedWrappedProperty.js';
import type { MappedWrappedObject } from '../../../density-buoyancy-common/js/common/model/MappedWrappedProperty.js';
import type Mass from '../../../density-buoyancy-common/js/common/model/Mass.js';
import PhysicsEngine from '../../../density-buoyancy-common/js/common/model/PhysicsEngine.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

type StatePart = {
  read: () => unknown;
  prepare: ( input: unknown ) => () => void;
};

function fieldsPart( fields: Parameters<typeof readFields>[ 0 ] ): StatePart {
  return { read: () => readFields( fields ), prepare: input => prepareFields( fields, input ) };
}

function wrapped<T extends MappedWrappedObject>( property: MappedWrappedProperty<T> ): StatePart {
  const selection = {
    selection: field( property, value => property.availableValues.indexOf( value ),
      value => typeof value === 'number' && Number.isInteger( value ) ? property.availableValues[ value ] : undefined )
  };
  const custom = { custom: number( property.customValue.valueProperty ) };
  return {
    read: () => ( { ...readFields( selection ), ...readFields( custom ) } ),
    prepare: input => {
      const applySelection = prepareFields( selection, input );
      const applyCustom = prepareFields( custom, input );
      return () => {
        applySelection();
        // Updating a custom slider normally selects the custom material. Keep the saved selection.
        property.lockCount++;
        try {
          applyCustom();
        }
        finally {
          property.lockCount--;
        }
      };
    }
  };
}

function cubeState( cube: Cuboid ): StatePart {
  const material = wrapped( cube.materialProperty );
  const size = fieldsPart( { volume: number( cube.volumeProperty ) } );
  return {
    read: () => ( { material: material.read(), size: size.read() } ),
    prepare: input => {
      const state = object( input );
      const applyMaterial = material.prepare( state.material );
      const applySize = size.prepare( state.size );
      return () => {
        applyMaterial();
        applySize();
      };
    }
  };
}

function shapeState( shape: BuoyancyShapeModel ): StatePart {
  return fieldsPart( {
    shape: enumeration( shape.shapeNameProperty ),
    width: number( shape.horizontalRatioProperty, false, value => value >= 0 && value <= 1 ),
    height: number( shape.verticalRatioProperty, false, value => value >= 0 && value <= 1 )
  } );
}

function finiteTuple( input: unknown, length: number, limit: number ): number[] {
  if ( !Array.isArray( input ) || input.length !== length ||
       !input.every( value => Number.isFinite( value ) && Math.abs( value ) <= limit ) ) {
    throw new Error( 'Invalid buoyancy body state.' );
  }
  return input;
}

function bodyState( mass: Mass ): StatePart {
  return {
    read: () => {
      const velocity = PhysicsEngine.bodyGetVelocity( mass.body );
      return {
        transform: [ mass.matrix.m02(), mass.matrix.m12(), mass.matrix.rotation ],
        velocity: [ velocity.x, velocity.y ]
      };
    },
    prepare: input => {
      const state = object( input );
      const [ x, y, angle ] = finiteTuple( state.transform, 3, 20 );
      const [ vx, vy ] = finiteTuple( state.velocity, 2, 100 );
      return () => {
        mass.matrix.setToTranslationRotation( x, y, angle );
        mass.writeData();
        PhysicsEngine.bodySetVelocity( mass.body, new Vector2( vx, vy ) );
        PhysicsEngine.bodySynchronizePrevious( mass.body );
        mass.updateStepInformation();
      };
    }
  };
}

function applicationState( model: BuoyancyApplicationsModel ): StatePart {
  const bottleMaterial = wrapped( model.bottle.materialInsideProperty );
  const block = cubeState( model.block );
  const fields = fieldsPart( {
    mode: field( model.applicationModeProperty, value => value,
      value => value === 'boat' || value === 'bottle' ? value : undefined ),
    bottleFill: number( model.bottle.materialInsideVolumeProperty, false,
      value => model.bottle.materialInsideVolumeRange.contains( value ) ),
    boatDisplacement: number( model.boat.maxVolumeDisplacedProperty ),
    boatFluid: number( model.boat.basin.fluidVolumeProperty, false, value => value >= 0 && value <= 1 )
  } );
  return {
    read: () => ( {
      controls: fields.read(),
      bottleMaterial: bottleMaterial.read(),
      block: block.read(),
      submerged: model.boat.isFullySubmerged,
      verticalMotion: [ model.boat.verticalVelocity, model.boat.verticalAcceleration ]
    } ),
    prepare: input => {
      const state = object( input );
      const applyFields = fields.prepare( state.controls );
      const applyMaterial = bottleMaterial.prepare( state.bottleMaterial );
      const applyBlock = block.prepare( state.block );
      const { submerged } = state;
      if ( typeof submerged !== 'boolean' ) { throw new Error( 'Invalid buoyancy boat state.' ); }
      const [ velocity, acceleration ] = finiteTuple( state.verticalMotion, 2, 1000 );
      return () => {
        applyFields();
        applyMaterial();
        applyBlock();
        model.boat.isFullySubmerged = submerged;
        model.boat.verticalVelocity = velocity;
        model.boat.verticalAcceleration = acceleration;
      };
    }
  };
}

function mysteryState( model: DensityMysteryModel ): StatePart {
  const blocks = model.blockSetToMassesMap.get( MysteryBlockSet.RANDOM )!;
  const blockParts = blocks.map( block => {
    const state = cubeState( block );
    const color = block.materialProperty.customMaterial.colorProperty;
    if ( !( color instanceof ColorProperty ) ) { throw new Error( 'Missing mystery block color control.' ); }
    return {
      read: () => ( {
        block: state.read(),
        color: [ color.value.red, color.value.green, color.value.blue, color.value.alpha ]
      } ),
      prepare: ( input: unknown ) => {
        const entry = object( input );
        const apply = state.prepare( entry.block );
        const [ red, green, blue, alpha ] = finiteTuple( entry.color, 4, 255 );
        if ( red < 0 || green < 0 || blue < 0 || alpha < 0 || alpha > 1 ) { throw new Error( 'Invalid mystery block color.' ); }
        const restoredColor = new Color( red, green, blue, alpha );
        return () => {
          apply();
          color.value = restoredColor;
        };
      }
    };
  } );
  return {
    read: () => blockParts.map( block => block.read() ),
    prepare: input => {
      if ( !Array.isArray( input ) || input.length !== blockParts.length ) {
        throw new Error( 'Invalid density mystery block count.' );
      }
      const actions = blockParts.map( ( block, i ) => block.prepare( input[ i ] ) );
      return () => actions.forEach( apply => apply() );
    }
  };
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as DensityBuoyancyModel;
  // The model owns a fixed collection of masses, including blocks and shapes hidden by the current mode.
  const masses = ( model as unknown as { availableMasses: Mass[] } ).availableMasses;
  const display = ( screen.view as unknown as { displayProperties: DisplayProperties } ).displayProperties;
  const fields = {
    gravityForce: boolean( display.gravityForceVisibleProperty ),
    buoyancyForce: boolean( display.buoyancyForceVisibleProperty ),
    contactForce: boolean( display.contactForceVisibleProperty ),
    forceValues: boolean( display.forceValuesVisibleProperty ),
    massValues: boolean( display.massValuesVisibleProperty ),
    depthLines: boolean( display.depthLinesVisibleProperty ),
    vectorZoom: number( display.vectorZoomLevelProperty, true ),
    ...( model.pool.scale ? { scaleHeight: number( model.pool.scale.heightProperty, false, value => value >= 0 && value <= 1 ) } : {} ),
    ...( model instanceof BuoyancyExploreModel || model instanceof BuoyancyBasicsExploreModel || model instanceof BuoyancyShapesModel || model instanceof DensityIntroModel ?
      { mode: enumeration( model.modeProperty ) } : {} ),
    ...( model instanceof CompareBlockSetModel ? {
      blockSet: enumeration( model.blockSetProperty ),
      commonMass: number( model.massProperty ),
      commonVolume: number( model.volumeProperty ),
      commonDensity: number( model.densityProperty )
    } : {} ),
    ...( model instanceof DensityMysteryModel ? { blockSet: enumeration( model.blockSetProperty ) } : {} )
  };
  const parts: Record<string, StatePart> = {
    controls: fieldsPart( fields ),
    gravity: wrapped( model.gravityProperty ),
    fluid: wrapped( model.pool.fluidMaterialProperty ),
    ...( model instanceof BuoyancyExploreModel || model instanceof BuoyancyBasicsExploreModel || model instanceof DensityIntroModel ?
      { blockA: cubeState( model.blockA ), blockB: cubeState( model.blockB ) } : {} ),
    ...( model instanceof BuoyancyLabModel ? { block: cubeState( model.block ) } : {} ),
    ...( model instanceof BuoyancyShapesModel ? {
      shapeMaterial: wrapped( model.materialProperty ),
      shapeA: shapeState( model.objectA ),
      shapeB: shapeState( model.objectB )
    } : {} ),
    ...( model instanceof BuoyancyApplicationsModel ? { application: applicationState( model ) } : {} ),
    ...( model instanceof DensityMysteryModel ? { randomBlocks: mysteryState( model ) } : {} )
  };
  const pool = fieldsPart( {
    fluidVolume: number( model.pool.fluidVolumeProperty, false, value => value >= 0 && value <= 1 )
  } );
  const bodies = masses.map( bodyState );
  return {
    isPlaying: () => model.visibleMasses.some( mass => PhysicsEngine.bodyGetVelocity( mass.body ).magnitude > 0.01 ) ||
      model instanceof BuoyancyApplicationsModel && Math.abs( model.boat.verticalVelocity ) > 0.01,
    read: () => ( {
      settings: Object.fromEntries( Object.entries( parts ).map( ( [ name, part ] ) => [ name, part.read() ] ) ),
      pool: pool.read(),
      bodies: bodies.map( body => body.read() )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const settings = object( state.settings );
      const applySettings = Object.entries( parts ).map( ( [ name, part ] ) => part.prepare( settings[ name ] ) );
      const applyPool = pool.prepare( state.pool );
      if ( !Array.isArray( state.bodies ) || state.bodies.length !== bodies.length ) {
        throw new Error( 'Invalid buoyancy body count.' );
      }
      const bodyInputs = state.bodies;
      const applyBodies = bodies.map( ( body, i ) => body.prepare( bodyInputs[ i ] ) );
      return () => {
        screen.view.interruptSubtreeInput();
        applySettings.forEach( apply => apply() );
        applyPool();
        applyBodies.forEach( apply => apply() );
      };
    }
  };
}

export default function installBuoyancyState( sim: Sim, id: string, version: string, screenIds: string[] ): void {
  const preferences = {
    volumeUnits: enumeration( DensityBuoyancyCommonPreferences.volumeUnitsProperty ),
    ...( supportsPercentageSubmergedVisible ? {
      percentSubmergedVisible: boolean( DensityBuoyancyCommonPreferences.percentSubmergedVisibleProperty )
    } : {} )
  };
  installSimulationBridge( sim, () => ( {
    bridge: `webwriter-${id}/v1`,
    build: `${id}@${version}-webwriter.1`,
    readPreferences: () => readFields( preferences ),
    preparePreferences: input => prepareFields( preferences, input ),
    screens: sim.simScreens.map( ( screen, i ) => ( { id: screenIds[ i ], screen, ...screenState( screen ) } ) )
  } ) );
}
