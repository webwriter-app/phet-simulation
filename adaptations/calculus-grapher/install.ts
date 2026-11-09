// Calculus Grapher WebWriter adapter. Distributed under GPL-3.0.
import type NumberProperty from '../../../axon/js/NumberProperty.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type AncillaryTool from '../common/model/AncillaryTool.js';
import type CalculusGrapherModel from '../common/model/CalculusGrapherModel.js';
import CalculusGrapherPreferences from '../common/model/CalculusGrapherPreferences.js';
import CurvePoint from '../common/model/CurvePoint.js';
import type TransformedCurve from '../common/model/TransformedCurve.js';
import type CalculusGrapherScreenView from '../common/view/CalculusGrapherScreenView.js';
import DerivativeModel from '../derivative/model/DerivativeModel.js';
import IntegralModel from '../integral/model/IntegralModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

function curveState( curve: TransformedCurve ) {
  return {
    read: () => curve.points.map( point => [ point.y, point.pointType ] ),
    prepare: ( input: unknown ) => {
      if ( !Array.isArray( input ) || input.length !== curve.numberOfPoints ) {
        throw new Error( 'Invalid curve length.' );
      }
      const points = curve.points.map( ( current, index ) => {
        const entry = input[ index ];
        if ( !Array.isArray( entry ) || entry.length !== 2 ) {
          throw new Error( 'Invalid curve point.' );
        }
        const [ y, pointType ] = entry;
        if ( !Number.isFinite( y ) || Math.abs( y ) > 1e6 ||
             ( pointType !== 'smooth' && pointType !== 'cusp' && pointType !== 'discontinuous' ) ) {
          throw new Error( 'Invalid curve point.' );
        }
        return CurvePoint.fromStateObject( { ...current.toStateObject(), y, pointType } );
      } );
      return () => {
        curve.pointsProperty.value = points;
        curve.curveChangedEmitter.emit();
      };
    }
  };
}

function toolFields( tool: AncillaryTool ) {
  return { visible: boolean( tool.visibleProperty ), x: number( tool.xProperty ) };
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as CalculusGrapherModel;
  const manipulation = model.curveManipulationProperties;
  const manipulationTypes = manipulation.curveManipulationTypeProperty.validValues || [];
  const controls = {
    graphSet: field( model.graphSetProperty, value => model.graphSets.indexOf( value ), value =>
      typeof value === 'number' && Number.isInteger( value ) ? model.graphSets[ value ] : undefined ),
    predict: boolean( model.predictSelectedProperty ),
    grid: boolean( model.gridVisibleProperty ),
    manipulationType: field( manipulation.curveManipulationTypeProperty, value => String( value ), value =>
      manipulationTypes.find( item => String( item ) === value ) ),
    manipulationWidth: number( manipulation.widthProperty ),
    primaryHandle: vector( model.primaryCurveManipulator.positionProperty ),
    predictHandle: vector( model.predictCurveManipulator.positionProperty )
  };
  const graphs = ( screen.view as CalculusGrapherScreenView ).graphsNode;
  const graphFields = Object.fromEntries( [
    [ 'primary', graphs.primaryGraphNode ],
    [ 'integral', graphs.integralGraphNode ],
    [ 'derivative', graphs.derivativeGraphNode ],
    [ 'secondDerivative', graphs.secondDerivativeGraphNode ]
  ].flatMap( ( [ name, node ] ) => {
    if ( !node ) { return []; }
    const graph = node as unknown as {
      _curveLayerVisibleProperty: { value: boolean };
      yZoomLevelProperty?: NumberProperty;
    };
    return [
      [ `${name}Visible`, boolean( graph._curveLayerVisibleProperty ) ],
      ...( graph.yZoomLevelProperty ? [ [ `${name}Zoom`, number( graph.yZoomLevelProperty, true ) ] ] : [] )
    ];
  } ) );
  const view = {
    ...graphFields,
    showPrimaryCurve: boolean( ( graphs.primaryGraphNode as unknown as { _showPrimaryCurveProperty: { value: boolean } } )._showPrimaryCurveProperty )
  };
  const primary = curveState( model.primaryCurve );
  const prediction = curveState( model.predictCurve );
  const reference = toolFields( model.referenceLine );
  const scrubber = model instanceof DerivativeModel ? toolFields( model.tangentScrubber ) :
                   model instanceof IntegralModel ? toolFields( model.areaUnderCurveScrubber ) : null;
  return {
    read: () => ( {
      controls: readFields( controls ),
      primary: primary.read(),
      view: readFields( view ),
      prediction: prediction.read(),
      reference: readFields( reference ),
      ...( scrubber ? { scrubber: readFields( scrubber ) } : {} )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state.controls );
      const applyPrimary = primary.prepare( state.primary );
      const applyView = prepareFields( view, state.view );
      const applyPrediction = prediction.prepare( state.prediction );
      const applyReference = prepareFields( reference, state.reference );
      const applyScrubber = scrubber && prepareFields( scrubber, state.scrubber );
      return () => {
        screen.view.interruptSubtreeInput();
        applyControls();
        applyPrimary();
        applyPrediction();
        applyReference();
        applyScrubber?.();
        applyView();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'derivative', 'integral', 'advanced', 'lab' ];
  const preferences = {
    functionVariable: enumeration( CalculusGrapherPreferences.functionVariableProperty ),
    derivativeNotation: enumeration( CalculusGrapherPreferences.derivativeNotationProperty ),
    connectDiscontinuities: enumeration( CalculusGrapherPreferences.connectDiscontinuitiesProperty ),
    valuesVisible: boolean( CalculusGrapherPreferences.valuesVisibleProperty ),
    predictFeature: boolean( CalculusGrapherPreferences.predictFeatureEnabledProperty ),
    showPrimaryCurveCheckbox: boolean( CalculusGrapherPreferences.hasShowPrimaryCurveCheckboxProperty )
  };
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-calculus-grapher/v1',
    build: 'calculus-grapher@1.2.0-dev.0-webwriter.1',
    readPreferences: () => readFields( preferences ),
    preparePreferences: input => prepareFields( preferences, input ),
    screens: sim.simScreens.map( ( screen, index ) => ( { id: ids[ index ], screen, ...screenState( screen ) } ) )
  } ) );
}
