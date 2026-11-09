// Graphing Quadratics WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import EyeToggleButton from '../../../scenery-phet/js/buttons/EyeToggleButton.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import AccordionBox from '../../../sun/js/AccordionBox.js';
import Checkbox from '../../../sun/js/Checkbox.js';
import GQColors from '../common/GQColors.js';
import Quadratic from '../common/model/Quadratic.js';
import FocusAndDirectrixModel from '../focusanddirectrix/model/FocusAndDirectrixModel.js';
import StandardFormModel from '../standardform/model/StandardFormModel.js';
import type VertexFormModel from '../vertexform/model/VertexFormModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, number, object, prepareFields, readFields, vector } from './stateFields.js';

const visibilityKeys = new Map( [
  [ 'vertexCheckbox', 'vertex' ],
  [ 'axisOfSymmetryCheckbox', 'axisOfSymmetry' ],
  [ 'rootsCheckbox', 'roots' ],
  [ 'equationsCheckbox', 'equations' ],
  [ 'coordinatesCheckbox', 'coordinates' ],
  [ 'focusCheckbox', 'focus' ],
  [ 'directrixCheckbox', 'directrix' ],
  [ 'pointOnParabolaCheckbox', 'pointOnParabola' ],
  [ 'quadraticTermCheckbox', 'quadraticTerm' ],
  [ 'linearTermCheckbox', 'linearTerm' ],
  [ 'constantTermCheckbox', 'constantTerm' ]
] );

function descendants( node: Node ): Node[] {
  return node.children.flatMap( child => [ child, ...descendants( child ) ] );
}

function viewFields( screen: AnyScreen ) {
  const fields: Parameters<typeof readFields>[ 0 ] = {};
  descendants( screen.view ).forEach( node => {
    if ( node instanceof EyeToggleButton ) {
      fields.graphVisible = boolean( ( node as unknown as { buttonModel: { valueProperty: { value: boolean } } } ).buttonModel.valueProperty );
    }
    else if ( node instanceof AccordionBox ) {
      const name = node.tandem.name;
      if ( name === 'equationAccordionBox' || name === 'quadraticTermsAccordionBox' ) {
        fields[ name ] = boolean( node.expandedProperty );
      }
    }
    else if ( node instanceof Checkbox ) {
      const key = visibilityKeys.get( node.tandem.name );
      if ( key ) { fields[ key ] = boolean( node.property ); }
    }
  } );
  return fields;
}

function coefficients( input: unknown ): [ number, number, number ] {
  if ( !Array.isArray( input ) || input.length !== 3 ||
       !input.every( value => Number.isFinite( value ) && Math.abs( value ) <= 1e5 ) ) {
    throw new Error( 'Invalid quadratic coefficients.' );
  }
  return [ input[ 0 ], input[ 1 ], input[ 2 ] ];
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as StandardFormModel | VertexFormModel | FocusAndDirectrixModel;
  const fields = {
    ...viewFields( screen ),
    leftTool: vector( model.leftPointTool.positionProperty ),
    rightTool: vector( model.rightPointTool.positionProperty )
  };
  const parameters = model instanceof StandardFormModel ? {
    a: number( model.aProperty ), b: number( model.bProperty ), c: number( model.cProperty )
  } : {
    h: number( model.hProperty ), k: number( model.kProperty ),
    ...( model instanceof FocusAndDirectrixModel ? { p: number( model.pProperty, false, value => value !== 0 ) } :
      { a: number( model.aProperty ) } )
  };
  const front = { savedInFront: boolean( model.isSavedQuadraticInFrontProperty ) };
  const probe = model instanceof FocusAndDirectrixModel ? { point: vector( model.pointOnParabolaProperty ) } : null;

  return {
    read: () => {
      const saved = model.savedQuadraticProperty.value;
      return {
        controls: readFields( fields ),
        parameters: readFields( parameters as Parameters<typeof readFields>[ 0 ] ),
        ...readFields( front ),
        saved: saved ? [ saved.a, saved.b, saved.c ] : null,
        probe: probe ? readFields( probe ) : null
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state.controls );
      const applyParameters = prepareFields( parameters as Parameters<typeof readFields>[ 0 ], state.parameters );
      const applyFront = prepareFields( front, state );
      const saved = state.saved === null ? null : new Quadratic( ...coefficients( state.saved ), { color: GQColors.SAVED_CURVE } );
      const applyProbe = probe && prepareFields( probe, state.probe );
      return () => {
        screen.view.interruptSubtreeInput();
        applyParameters();
        model.savedQuadraticProperty.value = saved;
        applyFront();
        applyProbe?.();
        apply();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'explore', 'standard-form', 'vertex-form', 'focus-and-directrix' ];
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-graphing-quadratics/v1',
    build: 'graphing-quadratics@1.5.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, i ) => ( { id: ids[ i ], screen, ...screenState( screen ) } ) )
  } ) );
}
