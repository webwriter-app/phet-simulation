// Number Line Distance WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import type AbstractNLDBaseModel from '../common/model/AbstractNLDBaseModel.js';
import DistanceRepresentation from '../common/model/DistanceRepresentation.js';
import NLDPreferences from '../common/model/NLDPreferences.js';
import NLDConstants from '../common/NLDConstants.js';
import type NLDExploreModel from '../explore/model/NLDExploreModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { groupedState, lineFields, pointControllerState } from './numberLineState.js';
import { boolean, field, object, prepareFields, readFields } from './stateFields.js';

function sceneState( model: AbstractNLDBaseModel, generic = false ) {
  const fields = {
    ...lineFields( model.numberLine, generic ? NLDConstants.GENERIC_NUMBER_LINE_RANGES : undefined ),
    distanceLabels: boolean( model.distanceLabelsVisibleProperty ),
    distanceDescription: boolean( model.distanceDescriptionVisibleProperty ),
    representation: field( model.distanceRepresentationProperty, value => String( value ), input =>
      DistanceRepresentation.VALUES.find( value => String( value ) === input ) ),
    swapped: boolean( model.isPrimaryControllerSwappedProperty )
  };
  return groupedState( fields, {
    controllers: pointControllerState( model.pointControllers, controller => model[ 'putPointControllerInBox' ]( controller ) )
  } );
}

export default function installWebWriter( sim: Sim ): void {
  const preferences = { terminology: field( NLDPreferences.terminologyProperty, value => value, value =>
    value === 'directedDistance' || value === 'displacement' ? value : undefined ) };
  installSimulationBridge( sim, () => {
    const [ explore, generic ] = sim.simScreens;
    const model = explore.model as NLDExploreModel;
    const scenes = {
      distance: model.distanceSceneModel,
      temperature: model.temperatureSceneModel,
      elevation: model.elevationSceneModel
    };
    const entries = Object.entries( scenes );
    const exploreFields = { scene: field( model.selectedSceneModelProperty, value =>
      entries.find( ( [ , scene ] ) => scene === value )![ 0 ], input =>
      entries.find( ( [ key ] ) => key === input )?.[ 1 ] ) };
    const states = entries.map( ( [ key, scene ] ) => [ key, sceneState( scene ) ] as const );
    const genericState = sceneState( generic.model as AbstractNLDBaseModel, true );
    return {
      bridge: 'webwriter-number-line-distance/v1',
      build: 'number-line-distance@1.2.0-dev.1-webwriter.1',
      readPreferences: () => readFields( preferences ),
      preparePreferences: input => prepareFields( preferences, input ),
      screens: [ {
        id: 'explore', screen: explore,
        read: () => ( { ...readFields( exploreFields ), scenes: Object.fromEntries( states.map( ( [ key, state ] ) => [ key, state.read() ] ) ) } ),
        prepare: input => {
          const state = object( input );
          const savedScenes = object( state.scenes );
          const apply = prepareFields( exploreFields, state );
          const restore = states.map( ( [ key, adapter ] ) => adapter.prepare( savedScenes[ key ] ) );
          return () => {
            explore.view.interruptSubtreeInput();
            restore.forEach( restore => restore() );
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
