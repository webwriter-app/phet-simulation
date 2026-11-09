// Vector Addition family state bindings. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../Screen.js';
import type Vector from '../../../vector-addition/js/common/model/Vector.js';
import type VectorAdditionModel from '../../../vector-addition/js/common/model/VectorAdditionModel.js';
import VectorAdditionPreferences from '../../../vector-addition/js/common/model/VectorAdditionPreferences.js';
import type VectorAdditionScene from '../../../vector-addition/js/common/model/VectorAdditionScene.js';
import type ExploreViewProperties from '../../../vector-addition/js/common/view/ExploreViewProperties.js';
import type VectorAdditionViewProperties from '../../../vector-addition/js/common/view/VectorAdditionViewProperties.js';
import EquationsScene from '../../../vector-addition/js/equations/model/EquationsScene.js';
import EquationsVector from '../../../vector-addition/js/equations/model/EquationsVector.js';
import type EquationsViewProperties from '../../../vector-addition/js/equations/view/EquationsViewProperties.js';
import type LabViewProperties from '../../../vector-addition/js/lab/view/LabViewProperties.js';
import { boolean, enumeration, number, object, prepareFields, readFields, vector } from './stateFields.js';

export const vectorAdditionPreferences = {
  angleConvention: enumeration( VectorAdditionPreferences.instance.angleConventionProperty )
};

type ViewProperties = VectorAdditionViewProperties & Partial<ExploreViewProperties & EquationsViewProperties & LabViewProperties>;

function point( input: unknown ): Vector2 {
  if ( !Array.isArray( input ) || input.length !== 2 ||
       !input.every( value => typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) <= 10000 ) ) {
    throw new Error( 'Invalid vector coordinates.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}

function vectorFields( item: Vector ) {
  return {
    tail: vector( item.tailPositionProperty ),
    ...( item instanceof EquationsVector ? {
      baseTail: vector( item.baseVector.tailPositionProperty ),
      baseComponents: vector( item.baseVector.xyComponentsProperty ),
      coefficient: number( item.coefficientProperty )
    } : {
      components: vector( item.xyComponentsProperty )
    } )
  };
}

function sceneState( scene: VectorAdditionScene ) {
  const graph = scene.graph;
  const baseBounds = graph[ '_boundsProperty' ].initialValue;
  const all = scene.vectorSets.flatMap( set => [ ...set.allVectors, set.resultantVector,
    ...( scene instanceof EquationsScene ? scene.vectorSet.baseVectors : [] ) ] );
  const equation: Parameters<typeof readFields>[0] = scene instanceof EquationsScene ? { equation: enumeration( scene.equationTypeProperty ) } : {};
  return {
    read: () => ( {
      ...readFields( equation ),
      origin: [ baseBounds.minX - graph.bounds.minX, baseBounds.minY - graph.bounds.minY ],
      selected: all.indexOf( scene.selectedVectorProperty.value! ),
      sets: scene.vectorSets.map( set => ( {
        resultant: [ set.resultantVector.tailPositionProperty.value.x, set.resultantVector.tailPositionProperty.value.y ],
        vectors: set.activeVectors.filter( item => item.isOnGraphProperty.value ).map( item => ( {
          index: set.allVectors.indexOf( item ),
          ...readFields( vectorFields( item ) )
        } ) )
      } ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const { selected, sets } = state;
      const origin = point( state.origin );
      const applyEquation = prepareFields( equation, state );
      if ( !Number.isInteger( origin.x ) || !Number.isInteger( origin.y ) || !baseBounds.containsPoint( origin ) ||
           !Array.isArray( sets ) || sets.length !== scene.vectorSets.length ||
           typeof selected !== 'number' || !Number.isInteger( selected ) || selected < -1 || selected >= all.length ) {
        throw new Error( 'Invalid vector scene.' );
      }
      const selection = all[ selected ] ?? null;
      const availableSelections = new Set<Vector>();
      const restoreSets = scene.vectorSets.map( ( set, setIndex ) => {
        const { vectors, resultant } = object( sets[ setIndex ] );
        const resultantTail = point( resultant );
        if ( !Array.isArray( vectors ) || vectors.length > set.allVectors.length ||
             ( scene instanceof EquationsScene && vectors.length !== set.allVectors.length ) ) {
          throw new Error( 'Invalid graph vectors.' );
        }
        availableSelections.add( set.resultantVector );
        const restore = vectors.map( entry => {
          const state = object( entry );
          const index = state.index;
          const item = typeof index === 'number' && Number.isInteger( index ) && set.allVectors[ index ];
          if ( !item || availableSelections.has( item ) ) { throw new Error( 'Invalid graph vector.' ); }
          availableSelections.add( item );
          if ( item instanceof EquationsVector ) { availableSelections.add( item.baseVector ); }
          const apply = prepareFields( vectorFields( item ), state );
          return () => {
            if ( item.isRemovableFromGraph ) {
              set.activeVectors.push( item );
              item.isOnGraphProperty.value = true;
            }
            apply();
          };
        } );
        return () => {
          restore.forEach( apply => apply() );
          set.resultantVector.tailPositionProperty.value = resultantTail;
        };
      } );
      if ( selection && !availableSelections.has( selection ) ) { throw new Error( 'The selected vector is unavailable.' ); }
      return () => {
        scene.reset();
        graph.moveOriginToPoint( origin );
        applyEquation();
        restoreSets.forEach( apply => apply() );
        scene.selectedVectorProperty.value = selection;
      };
    }
  };
}

export function vectorAdditionState( screen: AnyScreen ) {
  const model = screen.model as VectorAdditionModel<VectorAdditionScene>;
  const view = screen.view as typeof screen.view & { viewProperties: ViewProperties };
  const options = view.viewProperties;
  const fields = {
    components: enumeration( model.componentVectorStyleProperty ),
    values: boolean( options.valuesVisibleProperty ),
    angles: boolean( options.anglesVisibleProperty ),
    grid: boolean( options.gridVisibleProperty ),
    valuesExpanded: boolean( options.vectorValuesAccordionBoxExpandedProperty ),
    ...( options.sumVisibleProperty ? { sum: boolean( options.sumVisibleProperty ) } : {} ),
    ...( options.sum1VisibleProperty && options.sum2VisibleProperty ? {
      sumOne: boolean( options.sum1VisibleProperty ),
      sumTwo: boolean( options.sum2VisibleProperty )
    } : {} ),
    ...( options.equationAccordionBoxExpandedProperty && options.resultantVectorVisibleProperty &&
         options.baseVectorsAccordionBoxExpandedProperty && options.baseVectorsVisibleProperty ? {
      equationExpanded: boolean( options.equationAccordionBoxExpandedProperty ),
      resultant: boolean( options.resultantVectorVisibleProperty ),
      baseExpanded: boolean( options.baseVectorsAccordionBoxExpandedProperty ),
      baseVisible: boolean( options.baseVectorsVisibleProperty )
    } : {} )
  };
  const scenes = model.scenes.map( sceneState );
  return {
    read: () => ( {
      ...readFields( fields ),
      scene: model.scenes.indexOf( model.sceneProperty.value ),
      scenes: scenes.map( scene => scene.read() )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const { scene, scenes: savedScenes } = state;
      if ( typeof scene !== 'number' || !Number.isInteger( scene ) || !model.scenes[ scene ] ||
           !Array.isArray( savedScenes ) || savedScenes.length !== scenes.length ) {
        throw new Error( 'Invalid vector addition scene.' );
      }
      const applyScenes = scenes.map( ( scene, index ) => scene.prepare( savedScenes[ index ] ) );
      return () => {
        view.interruptSubtreeInput();
        applyScenes.forEach( apply => apply() );
        model.sceneProperty.value = model.scenes[ scene ];
        applyFields();
      };
    }
  };
}
