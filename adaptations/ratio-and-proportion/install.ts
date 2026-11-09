// State adapter for PhET Ratio and Proportion. Distributed under GPL-3.0.
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import Node from '../../../scenery/js/nodes/Node.js';
import type RAPModel from '../common/model/RAPModel.js';
import RAPRatioTuple from '../common/model/RAPRatioTuple.js';
import type RAPScreenView from '../common/view/RAPScreenView.js';
import MyChallengeAccordionBox from '../create/view/MyChallengeAccordionBox.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields } from './stateFields.js';

function challengeBox( node: Node ): MyChallengeAccordionBox | undefined {
  if ( node instanceof MyChallengeAccordionBox ) { return node; }
  for ( const child of node.children ) {
    const box = challengeBox( child );
    if ( box ) { return box; }
  }
}

function bindScreen( screen: AnyScreen, create: boolean ) {
  const model = screen.model as RAPModel;
  const view = screen.view as RAPScreenView;
  const challenge = create ? challengeBox( view ) : null;
  if ( create && !challenge ) { throw new Error( 'Missing Ratio and Proportion challenge controls.' ); }
  const validChallengeTerm = ( value: number ) => value >= 1 && value <= 10;
  const fields = {
    ticks: enumeration( view[ 'tickMarkViewProperty' ] ),
    tickRange: number( view[ 'tickMarkRangeProperty' ], true, value => create ? [ 10, 20, 30 ].includes( value ) : value === 10 ),
    ...( challenge ? {
      targetAntecedent: number( challenge.targetAntecedentProperty, true, validChallengeTerm ),
      targetConsequent: number( challenge.targetConsequentProperty, true, validChallengeTerm ),
      challengeOpen: boolean( challenge.expandedProperty )
    } : {
      target: number( model.targetRatioProperty, false, value => [ 1 / 2, 1 / 3, 3 / 4 ].includes( value ) )
    } )
  };
  const lock = boolean( model.ratio.lockedProperty );
  return {
    id: create ? 'create' : 'discover',
    screen,
    read: () => {
      const ratio = model.ratio.tupleProperty.value;
      return { ...readFields( fields ), antecedent: ratio.antecedent, consequent: ratio.consequent, locked: lock.read() };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const applyLock = lock.prepare( state.locked, 'locked' );
      const { antecedent, consequent } = state;
      const target = challenge ? ( state.targetAntecedent as number ) / ( state.targetConsequent as number ) : state.target as number;
      if ( typeof antecedent !== 'number' || !Number.isFinite( antecedent ) || antecedent < 0 || antecedent > 1 ||
           typeof consequent !== 'number' || !Number.isFinite( consequent ) || consequent < 0 || consequent > 1 ||
           ( state.locked && ( !create || antecedent < 0.01 || consequent < 0.01 || Math.abs( antecedent / consequent - target ) > 1e-6 ) ) ) {
        throw new Error( 'Invalid Ratio and Proportion hands.' );
      }
      const ratio = new RAPRatioTuple( antecedent, consequent );
      return () => {
        view.interruptSubtreeInput();
        model.ratio.lockedProperty.value = false;
        apply();
        model.ratio.tupleProperty.value = ratio;
        applyLock();
      };
    }
  };
}

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-ratio-and-proportion/v1',
    build: 'ratio-and-proportion@1.3.0-dev.2-webwriter.1',
    screens: [ bindScreen( sim.simScreens[ 0 ], false ), bindScreen( sim.simScreens[ 1 ], true ) ]
  } ) );
}
