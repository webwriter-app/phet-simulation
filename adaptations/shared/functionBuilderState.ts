// Function Builder family state bindings. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type FBModel from '../../../function-builder/js/common/model/FBModel.js';
import type FBScene from '../../../function-builder/js/common/model/FBScene.js';
import MathFunction from '../../../function-builder/js/common/model/functions/MathFunction.js';
import FBSceneNode from '../../../function-builder/js/common/view/FBSceneNode.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import type { AnyScreen } from '../Screen.js';
import { boolean, number, object, prepareFields, readFields } from './stateFields.js';

type MysteryScene = FBScene & {
  challengePool: unknown[];
  challengeProperty: { value: unknown; notifyListenersStatic: () => void };
  availableChallenges: unknown[];
};
type MysteryNode = FBSceneNode & { revealProperties: { value: boolean }[] };

function sceneState( scene: FBScene, node: FBSceneNode ) {
  const mystery = 'challengeProperty' in scene ? scene as MysteryScene : null;
  const reveal = mystery ? ( node as MysteryNode ).revealProperties.map( property => boolean( property ) ) : [];
  const controls = {
    seeInside: boolean( node.seeInsideProperty ),
    hideFunctions: boolean( node.hideFunctionsProperty ),
    inputPage: number( node.inputCarousel.pageNumberProperty, true,
      value => value >= 0 && value < node.inputCarousel.numberOfPagesProperty.value ),
    outputPage: number( node.outputCarousel.pageNumberProperty, true,
      value => value >= 0 && value < node.outputCarousel.numberOfPagesProperty.value ),
    functionsPage: number( node.functionCarousel.pageNumberProperty, true,
      value => value >= 0 && value < node.functionCarousel.numberOfPagesProperty.value )
  };
  const operandFields = mystery ? [] : node.functionNodes.flatMap( functionNode => {
    const instance = functionNode.functionInstance;
    return instance instanceof MathFunction ? [ number( instance.operandProperty, true, value =>
      ( !instance.operandRange || instance.operandRange.contains( value ) ) &&
      ( value !== 0 || instance.zeroOperandValid ) ) ] : [];
  } );
  return {
    read: () => {
      const parked = node.builderNode.seeInsideCardNode;
      const parkedIndex = parked && !parked.card.isAnimating() && !parked.card.dragging ? node.cardNodes.indexOf( parked ) : -1;
      const builder = scene.builder;
      return {
        ...readFields( controls ),
        outputs: node.cardNodes.flatMap( ( cardNode, index ) => cardNode.outputContainer.containsNode( cardNode ) ? [ index ] : [] ),
        parked: parkedIndex < 0 ? null : {
          card: parkedIndex,
          window: builder.getWindowNumberLessThanOrEqualTo( parked.card.position.x )
        },
        ...( mystery ? {
          challenge: mystery.challengePool.indexOf( mystery.challengeProperty.value ),
          available: mystery.availableChallenges.map( item => mystery.challengePool.indexOf( item ) ),
          reveal: reveal.map( field => field.read() ),
          revealEnabled: node.seeInsideCheckbox.enabled
        } : {
          operands: operandFields.map( field => field.read() ),
          slots: builder.slots.map( ( slot, index ) => slot.functionInstance ?
            node.functionNodes.indexOf( node.builderNode.getFunctionNode( index ) ) : null )
        } )
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state );
      const outputs = state.outputs;
      const cardAt = ( value: unknown ) => typeof value === 'number' && Number.isInteger( value ) ? node.cardNodes[ value ] : undefined;
      if ( !Array.isArray( outputs ) || new Set( outputs ).size !== outputs.length || !outputs.every( index => cardAt( index ) ) ) {
        throw new Error( 'Invalid function builder output cards.' );
      }
      const parked = state.parked === null ? null : object( state.parked );
      const parkedCard = parked && cardAt( parked.card );
      if ( parked && ( !parkedCard || outputs.includes( parked.card ) || !state.seeInside ||
           typeof parked.window !== 'number' || !Number.isInteger( parked.window ) ||
           !scene.builder.isValidWindowNumber( parked.window ) ) ) {
        throw new Error( 'Invalid card in a function builder window.' );
      }
      let restoreFunctions: () => void;
      let restoreReveal = () => {};
      if ( mystery ) {
        const { challenge, available, reveal: savedReveal, revealEnabled } = state;
        const validChallenge = ( index: unknown ): index is number =>
          typeof index === 'number' && Number.isInteger( index ) && index >= 0 && index < mystery.challengePool.length;
        if ( !validChallenge( challenge ) || !Array.isArray( available ) || !available.every( validChallenge ) ||
             new Set( available ).size !== available.length || available.includes( challenge ) ||
             !Array.isArray( savedReveal ) || savedReveal.length !== reveal.length || typeof revealEnabled !== 'boolean' ) {
          throw new Error( 'Invalid function builder mystery challenge.' );
        }
        const applyReveal = reveal.map( ( field, index ) => field.prepare( savedReveal[ index ], 'revealed slot' ) );
        restoreFunctions = () => {
          const challengeValue = mystery.challengePool[ challenge ];
          if ( mystery.challengeProperty.value === challengeValue ) {
            mystery.challengeProperty.notifyListenersStatic();
          }
          else {
            mystery.challengeProperty.value = challengeValue;
          }
          mystery.availableChallenges = available.map( index => mystery.challengePool[ index ] );
        };
        restoreReveal = () => {
          applyReveal.forEach( apply => apply() );
          node.seeInsideCheckbox.enabled = revealEnabled;
        };
      }
      else {
        const { operands, slots } = state;
        if ( !Array.isArray( operands ) || operands.length !== operandFields.length ||
             !Array.isArray( slots ) || slots.length !== scene.builder.numberOfSlots ||
             !slots.every( index => index === null || Number.isInteger( index ) && node.functionNodes[ index ] ) ||
             new Set( slots.filter( index => index !== null ) ).size !== slots.filter( index => index !== null ).length ) {
          throw new Error( 'Invalid function builder slots.' );
        }
        const applyOperands = operandFields.map( ( field, index ) => field.prepare( operands[ index ], 'operand' ) );
        restoreFunctions = () => {
          node.reset();
          scene.reset();
          applyOperands.forEach( apply => apply() );
          slots.forEach( ( index, slot ) => { if ( index !== null ) { node.functionNodes[ index ].moveToBuilder( slot ); } } );
        };
      }
      return () => {
        restoreFunctions();
        outputs.forEach( index => {
          const card = cardAt( index )!;
          card.inputContainer.removeNode( card );
          card.outputContainer.addNode( card );
        } );
        applyControls();
        restoreReveal();
        if ( parked && parkedCard ) {
          parkedCard.inputContainer.removeNode( parkedCard );
          parkedCard.dragLayer.addChild( parkedCard );
          const position = scene.builder.getWindowPosition( parked.window );
          parkedCard.card.moveTo( new Vector2( position.x, position.y ) );
          node.builderNode.seeInsideCardNode = parkedCard;
        }
      };
    }
  };
}

export default function functionBuilderState( screen: AnyScreen ) {
  const model = screen.model as FBModel;
  const findSceneNodes = ( node: Node ): FBSceneNode[] => node instanceof FBSceneNode ?
    [ node ] : node.children.flatMap( findSceneNodes );
  const sceneNodes = findSceneNodes( screen.view );
  const states = model.scenes.map( scene => {
    const node = sceneNodes.find( candidate => candidate.scene === scene );
    if ( !node ) { throw new Error( 'The function builder scene view is unavailable.' ); }
    return sceneState( scene, node );
  } );
  return {
    isPlaying: () => {
      const scene = model.selectedSceneProperty.value;
      return scene.cards.some( card => card.isAnimating() ) || scene.functionInstances.some( fn => fn.isAnimating() );
    },
    read: () => ( { scene: model.scenes.indexOf( model.selectedSceneProperty.value ), scenes: states.map( state => state.read() ) } ),
    prepare: ( input: unknown ) => {
      const { scene, scenes } = object( input );
      if ( typeof scene !== 'number' || !Number.isInteger( scene ) || !model.scenes[ scene ] ||
           !Array.isArray( scenes ) || scenes.length !== states.length ) {
        throw new Error( 'Invalid function builder scene.' );
      }
      const restore = states.map( ( state, index ) => state.prepare( scenes[ index ] ) );
      return () => {
        screen.view.interruptSubtreeInput();
        restore.forEach( apply => apply() );
        model.selectedSceneProperty.value = model.scenes[ scene ];
      };
    }
  };
}
