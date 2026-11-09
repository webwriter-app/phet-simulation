// Curve Fitting WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type Checkbox from '../../../sun/js/Checkbox.js';
import CurveFittingConstants from '../curve-fitting/CurveFittingConstants.js';
import type CurveFittingModel from '../curve-fitting/model/CurveFittingModel.js';
import FitType from '../curve-fitting/model/FitType.js';
import Point from '../curve-fitting/model/Point.js';
import ControlPanels from '../curve-fitting/view/ControlPanels.js';
import DeviationsAccordionBox from '../curve-fitting/view/DeviationsAccordionBox.js';
import EquationAccordionBox from '../curve-fitting/view/EquationAccordionBox.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

function point( input: unknown, graphPosition: boolean ): Vector2 {
  if ( !Array.isArray( input ) || input.length !== 2 ||
       !input.every( value => Number.isFinite( value ) && Math.abs( value ) <= 100 ) ) {
    throw new Error( 'Invalid Curve Fitting point.' );
  }
  const position = new Vector2( input[ 0 ], input[ 1 ] );
  if ( graphPosition && !CurveFittingConstants.GRAPH_BACKGROUND_MODEL_BOUNDS.containsPoint( position ) ) {
    throw new Error( 'Curve Fitting point lies outside the graph.' );
  }
  return position;
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as CurveFittingModel;
    const optionsPanel = ( screen.view.children.find( node => node instanceof ControlPanels ) as ControlPanels ).viewOptionsPanel;
    const [ curve, residuals, values ] = optionsPanel._content.children as Checkbox[];
    const deviations = screen.view.children.find( node => node instanceof DeviationsAccordionBox ) as DeviationsAccordionBox;
    const equation = screen.view.children.find( node => node instanceof EquationAccordionBox ) as EquationAccordionBox;
    const equationExpanded = ( equation.expandCollapseButton as unknown as { buttonModel: { valueProperty: { value: boolean } } } ).buttonModel.valueProperty;
    const best = FitType.getValue( 'BEST' );
    const adjustable = FitType.getValue( 'ADJUSTABLE' );
    const controls = {
      order: number( model.orderProperty, true ),
      fit: field( model.fitProperty, value => value === best ? 'best' : 'adjustable', value =>
        value === 'best' ? best : value === 'adjustable' ? adjustable : undefined ),
      curve: boolean( curve.property ),
      residuals: boolean( residuals.property ),
      values: boolean( values.property ),
      deviationsExpanded: boolean( deviations.expandedProperty ),
      equationExpanded: boolean( equationExpanded ),
      ...Object.fromEntries( model.sliderPropertyArray.map( ( property, index ) => [ `coefficient${index}`, number( property ) ] ) )
    };

    return {
      bridge: 'webwriter-curve-fitting/v1',
      build: 'curve-fitting@1.1.0-dev.0-webwriter.1',
      screens: [ {
        id: 'curve-fitting',
        screen,
        read: () => ( {
          controls: readFields( controls ),
          residualsWhenVisible: optionsPanel.wereResidualsVisible,
          points: model.points.filter( ( point: Point ) => point.isInsideGraphProperty.value && point.animation === null ).map( ( point: Point ) => {
            const origin = point.positionProperty.initialValue;
            const position = point.positionProperty.value;
            return { origin: [ origin.x, origin.y ], position: [ position.x, position.y ], uncertainty: point.deltaProperty.value };
          } )
        } ),
        prepare: input => {
          const state = object( input );
          const applyControls = prepareFields( controls, state.controls );
          const { residualsWhenVisible } = state;
          if ( typeof residualsWhenVisible !== 'boolean' || !Array.isArray( state.points ) || state.points.length > 500 ) {
            throw new Error( 'Invalid Curve Fitting data.' );
          }
          const points = state.points.map( entry => {
            const state = object( entry );
            const origin = point( state.origin, false );
            const position = point( state.position, true );
            const { uncertainty } = state;
            if ( typeof uncertainty !== 'number' || !Number.isFinite( uncertainty ) || uncertainty < 0.01 || uncertainty > 20 ) {
              throw new Error( 'Invalid data-point uncertainty.' );
            }
            return { origin, position, uncertainty };
          } );
          return () => {
            screen.view.interruptSubtreeInput();
            model.points.clear();
            applyControls();
            optionsPanel.wereResidualsVisible = residualsWhenVisible;
            points.forEach( ( { origin, position, uncertainty } ) => {
              const dataPoint = new Point( { position: origin, dragging: true } );
              dataPoint.positionProperty.value = position;
              dataPoint.deltaProperty.value = uncertainty;
              dataPoint.draggingProperty.value = false;
              model.points.add( dataPoint );
            } );
          };
        }
      } ]
    };
  } );
}
