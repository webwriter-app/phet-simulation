// Acid-Base Solutions WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Sim from '../../../joist/js/Sim.js';
import ABSConstants from '../common/ABSConstants.js';
import ABSPreferences from '../common/model/ABSPreferences.js';
import ABSScreenView from '../common/view/ABSScreenView.js';
import IntroModel from '../intro/model/IntroModel.js';
import MySolutionModel from '../mysolution/model/MySolutionModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, prepareFields, readFields } from './stateFields.js';

const solutionIds = [ 'water', 'strong-acid', 'weak-acid', 'strong-base', 'weak-base' ];
const screenIds = [ 'intro', 'my-solution' ];

function position( property: { value: Vector2 }, contains: ( point: Vector2 ) => boolean ) {
  return field( property, point => [ point.x, point.y ], value => {
    if ( !Array.isArray( value ) || value.length !== 2 || !value.every( Number.isFinite ) ) {
      return undefined;
    }
    const point = new Vector2( value[ 0 ], value[ 1 ] );
    return contains( point ) ? point : undefined;
  } );
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as IntroModel | MySolutionModel;
  const view = screen.view as ABSScreenView;
  const { pHMeter, pHPaper, conductivityTester: tester } = model;
  const { viewModeProperty, toolModeProperty } = view.viewProperties;
  const controls = {
    view: enumeration( viewModeProperty ),
    tool: enumeration( toolModeProperty ),
    ...( model instanceof IntroModel ? {
      solution: field( model.mutableSolutionProperty, solution => solutionIds[ model.solutions.indexOf( solution ) ],
        value => typeof value === 'string' ? model.solutions[ solutionIds.indexOf( value ) ] : undefined )
    } : {
      acid: boolean( model.isAcidProperty ),
      weak: boolean( model.isWeakProperty ),
      concentration: number( model.concentrationProperty ),
      strength: number( model.strengthProperty, false, value => ABSConstants.WEAK_STRENGTH_RANGE.contains( value ) )
    } )
  };
  const probePosition = ( property: { value: Vector2 } ) => {
    const x = property.value.x;
    return position( property, point => point.x === x &&
      tester.probeDragYRange.contains( point.y - tester.bulbPosition.y ) );
  };
  const tools = {
    meter: position( pHMeter.positionProperty, point => pHMeter.dragBounds.containsPoint( point ) ),
    paper: position( pHPaper.positionProperty, point => pHPaper.dragBounds.containsPoint( point ) ),
    paperColored: number( pHPaper.percentColoredProperty, false, value => value >= 0 && value <= 1 ),
    positiveProbe: probePosition( tester.positiveProbePositionProperty ),
    negativeProbe: probePosition( tester.negativeProbePositionProperty )
  };
  const fields = { ...controls, ...tools };
  return {
    read: () => readFields( fields ),
    prepare: ( input: unknown ) => {
      const apply = prepareFields( fields, input );
      return () => {
        view.interruptSubtreeInput();
        // Selecting a solution clears the pH paper. Apply its position and coloration last.
        apply();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const preferences = { showSolvent: boolean( ABSPreferences.showSolventProperty ) };
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-acid-base-solutions/v1',
    build: 'acid-base-solutions@1.4.0-dev.8-webwriter.1',
    readPreferences: () => readFields( preferences ),
    preparePreferences: input => prepareFields( preferences, input ),
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...screenState( screen ) } ) )
  } ) );
}
