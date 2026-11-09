// Number Line Integers WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import NLIConstants from '../common/NLIConstants.js';
import type ElevationSceneModel from '../explore/model/ElevationSceneModel.js';
import type NLIExploreModel from '../explore/model/NLIExploreModel.js';
import NLIScene from '../explore/model/NLIScene.js';
import type SceneModel from '../explore/model/SceneModel.js';
import type TemperatureSceneModel from '../explore/model/TemperatureSceneModel.js';
import NLIGenericModel from '../generic/model/NLIGenericModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { groupedState, lineFields, pointControllerState } from './numberLineState.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

function sceneFields( model: SceneModel ) {
  return {
    numberLine: boolean( model.showNumberLineProperty ),
    labels: boolean( model.numberLineLabelsVisibleProperty ),
    absoluteValues: boolean( model.numberLineAbsoluteValueIndicatorsVisibleProperty )
  };
}

function areaState( model: TemperatureSceneModel | ElevationSceneModel ) {
  const controllers = model.permanentPointControllers;
  return {
    read: () => controllers.map( controller => ( {
      position: [ controller.positionProperty.value.x, controller.positionProperty.value.y ],
      value: controller.numberLinePoints[ 0 ]?.valueProperty.value ?? null
    } ) ),
    prepare: ( input: unknown ) => {
      if ( !Array.isArray( input ) || input.length !== controllers.length ) {
        throw new Error( 'Invalid Number Line Integers area.' );
      }
      const values = input.map( item => {
        const state = object( item );
        if ( !Array.isArray( state.position ) || state.position.length !== 2 || !state.position.every( Number.isFinite ) ||
             ( state.value !== null && ( typeof state.value !== 'number' || !Number.isFinite( state.value ) ) ) ) {
          throw new Error( 'Invalid Number Line Integers marker.' );
        }
        return { position: new Vector2( state.position[ 0 ], state.position[ 1 ] ), value: state.value };
      } );
      return () => {
        controllers.forEach( controller => {
          controller.stopAnimation();
          if ( 'overElevationAreaProperty' in controller ) {
            const elevation = model as ElevationSceneModel;
            controller.goToPosition( elevation.elevatableItemsBoxBounds.center );
            elevation[ 'putPointControllerInBox' ]( controller );
          }
          else {
            const temperature = model as TemperatureSceneModel;
            controller.goToPosition( temperature.thermometerBoxBounds.center );
            temperature[ 'putPointControllerInBox' ]( controller );
          };
        } );
        controllers.forEach( ( controller, index ) => {
          const { position, value } = values[ index ];
          if ( value === null ) { return; }
          controller.isDraggingProperty.value = true;
          controller.proposePosition( position );
          controller.isDraggingProperty.value = false;
          if ( 'overElevationAreaProperty' in controller && controller.numberLinePoints[ 0 ] ) {
            controller.numberLinePoints[ 0 ].valueProperty.value = value;
          }
        } );
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const [ explore, generic ] = sim.simScreens;
    const model = explore.model as NLIExploreModel;
    const elevation = groupedState( sceneFields( model.elevationSceneModel ), { markers: areaState( model.elevationSceneModel ) } );
    const temperatureModel = model.temperatureSceneModel;
    const temperature = groupedState( {
      ...sceneFields( temperatureModel ),
      month: number( temperatureModel.monthProperty, true, value => value >= 1 && value <= 12 ),
      units: field( temperatureModel.temperatureUnitsProperty, value => String( value ), input =>
        NLIConstants.TEMPERATURE_UNITS.VALUES.find( value => String( value ) === input ) )
    }, { markers: areaState( temperatureModel ) } );
    const bankModel = model.bankSceneModel;
    const bank = groupedState( {
      ...sceneFields( bankModel ),
      showComparison: boolean( bankModel.showComparisonAccountProperty ),
      primaryBalance: number( bankModel.primaryAccount.balanceProperty, true ),
      comparisonBalance: number( bankModel.comparisonAccount.balanceProperty, true )
    }, {} );
    const scenes = Object.entries( { elevation, temperature, bank } );
    const exploreFields = { scene: field( model.selectedSceneProperty, value => String( value ), input =>
      NLIScene.VALUES.find( value => String( value ) === input ) ) };
    const genericModel = generic.model as NLIGenericModel;
    const genericState = groupedState( lineFields( genericModel.numberLine, NLIGenericModel.NUMBER_LINE_RANGES ), {
      controllers: pointControllerState( genericModel.pointControllers, controller => genericModel[ 'putPointControllerInBox' ]( controller ) )
    } );
    return {
      bridge: 'webwriter-number-line-integers/v1',
      build: 'number-line-integers@1.3.0-dev.0-webwriter.1',
      screens: [ {
        id: 'explore', screen: explore,
        read: () => ( { ...readFields( exploreFields ), scenes: Object.fromEntries( scenes.map( ( [ key, state ] ) => [ key, state.read() ] ) ) } ),
        prepare: input => {
          const state = object( input );
          const values = object( state.scenes );
          const apply = prepareFields( exploreFields, state );
          const restores = scenes.map( ( [ key, adapter ] ) => adapter.prepare( values[ key ] ) );
          return () => {
            explore.view.interruptSubtreeInput();
            restores.forEach( restore => restore() );
            apply();
          };
        }
      }, {
        id: 'generic', screen: generic, read: genericState.read,
        prepare: input => {
          const apply = genericState.prepare( input );
          return () => { generic.view.interruptSubtreeInput(); apply(); };
        }
      } ]
    };
  } );
}
