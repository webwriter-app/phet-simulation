// Least-Squares Regression WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import Vector2 from '../../../dot/js/Vector2.js';
import DataPoint from '../least-squares-regression/model/DataPoint.js';
import DataSet from '../least-squares-regression/model/DataSet.js';
import type LeastSquaresRegressionModel from '../least-squares-regression/model/LeastSquaresRegressionModel.js';
import BestFitLineAccordionBox from '../least-squares-regression/view/BestFitLineAccordionBox.js';
import CorrelationCoefficientAccordionBox from '../least-squares-regression/view/CorrelationCoefficientAccordionBox.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, number, object, prepareFields, readFields } from './stateFields.js';

function point( input: unknown ): Vector2 {
  if ( !Array.isArray( input ) || input.length !== 2 || !input.every( coordinate =>
    typeof coordinate === 'number' && Number.isFinite( coordinate ) && Math.abs( coordinate ) <= 10 ) ) {
    throw new Error( 'Invalid regression data point.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as LeastSquaresRegressionModel;
    const graph = model.graph;
    const bestFit = screen.view.children.find( child => child instanceof BestFitLineAccordionBox );
    const correlation = screen.view.children.find( child => child instanceof CorrelationCoefficientAccordionBox );
    if ( !bestFit || !correlation ) { throw new Error( 'The regression control panels are unavailable.' ); }
    const fields = {
      grid: boolean( model.showGridProperty ),
      angle: number( graph.angleProperty, false, value => Math.abs( value ) < Math.PI / 2 ),
      intercept: number( graph.interceptProperty, false, value => Math.abs( value ) <= 1.5 * graph.bounds.maxY ),
      myLine: boolean( graph.myLineVisibleProperty ),
      myResiduals: boolean( graph.myLineShowResidualsProperty ),
      mySquaredResiduals: boolean( graph.myLineShowSquaredResidualsProperty ),
      bestFitLine: boolean( graph.bestFitLineVisibleProperty ),
      bestResiduals: boolean( graph.bestFitLineShowResidualsProperty ),
      bestSquaredResiduals: boolean( graph.bestFitLineShowSquaredResidualsProperty ),
      bestFitExpanded: boolean( bestFit.expandedProperty ),
      correlationExpanded: boolean( correlation.expandedProperty )
    };

    // The model keeps its inactive Custom data in a closure. Track the same points while that data set is active.
    const readPoint = ( data: DataPoint ) => ( {
      origin: [ data.positionProperty.initialValue.x, data.positionProperty.initialValue.y ],
      position: [ data.positionProperty.value.x, data.positionProperty.value.y ]
    } );
    let customPoints: ReturnType<typeof readPoint>[] = [];
    const readCustom = () => {
      if ( model.selectedDataSetProperty.value === DataSet.CUSTOM ) {
        customPoints = model.dataPoints.filter( data => !data.animatingProperty.value &&
          graph.isDataPointPositionOverlappingGraph( data.positionProperty.value ) ).map( readPoint );
      }
    };
    const observe = ( data: DataPoint ) => {
      if ( model.selectedDataSetProperty.value === DataSet.CUSTOM ) {
        data.positionProperty.lazyLink( readCustom );
        data.animatingProperty.lazyLink( readCustom );
        readCustom();
      }
    };
    model.dataPoints.addItemAddedListener( observe );
    model.dataPoints.addItemRemovedListener( readCustom );
    model.dataPoints.forEach( observe );

    return {
      bridge: 'webwriter-least-squares-regression/v1',
      build: 'least-squares-regression@1.3.0-dev.0-webwriter.1',
      screens: [ {
        id: 'regression',
        screen,
        read: () => {
          readCustom();
          return {
            ...readFields( fields ),
            dataSet: model.dataSets.indexOf( model.selectedDataSetProperty.value ),
            customPoints
          };
        },
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( fields, state );
          const { dataSet, customPoints } = state;
          if ( typeof dataSet !== 'number' || !Number.isInteger( dataSet ) || !model.dataSets[ dataSet ] ||
               !Array.isArray( customPoints ) || customPoints.length > 2000 ) {
            throw new Error( 'Invalid regression data set.' );
          }
          const restore = customPoints.map( input => {
            const state = object( input );
            const origin = point( state.origin );
            const position = point( state.position );
            if ( !graph.isDataPointPositionOverlappingGraph( position ) ) {
              throw new Error( 'The custom data point is outside the graph.' );
            }
            return { origin, position };
          } );
          return () => {
            screen.view.interruptSubtreeInput();
            model.reset();
            restore.forEach( ( { origin, position } ) => {
              const data = new DataPoint( origin );
              data.positionProperty.value = position;
              model.addUserCreatedDataPoint( data );
              graph.addPointAndResiduals( data );
            } );
            readCustom();
            model.dataPointsAddedEmitter.emit();
            model.selectedDataSetProperty.value = model.dataSets[ dataSet ];
            apply();
          };
        }
      } ]
    };
  } );
}
