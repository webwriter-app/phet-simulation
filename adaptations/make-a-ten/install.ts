// Make a Ten WebWriter state adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import Vector2 from '../../../dot/js/Vector2.js';
import CountingObject from '../../../counting-common/js/common/model/CountingObject.js';
import ActiveTerm from '../make-a-ten/adding/model/ActiveTerm.js';
import type MakeATenAddingModel from '../make-a-ten/adding/model/MakeATenAddingModel.js';
import MakeATenConstants from '../make-a-ten/common/MakeATenConstants.js';
import type MakeATenExploreModel from '../make-a-ten/explore/model/MakeATenExploreModel.js';
import type MakeATenExploreScreenView from '../make-a-ten/explore/view/MakeATenExploreScreenView.js';
import GameState from '../make-a-ten/game/model/GameState.js';
import type MakeATenGameModel from '../make-a-ten/game/model/MakeATenGameModel.js';
import NumberChallenge from '../make-a-ten/game/model/NumberChallenge.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

type CountingModel = MakeATenExploreModel | MakeATenAddingModel | MakeATenGameModel;

function readNumbers( model: CountingModel ) {
  return model.countingObjects.filter( item => item.includeInSumProperty.value ).map( item => {
    const position = item.destination ?? item.positionProperty.value;
    return { value: item.numberValueProperty.value, position: [ position.x, position.y ] };
  } );
}

function validInteger( value: unknown, min: number, max = Number.MAX_SAFE_INTEGER ): value is number {
  return typeof value === 'number' && Number.isSafeInteger( value ) && value >= min && value <= max;
}

function prepareNumbers( model: CountingModel, input: unknown, keepInteractive = false ): () => void {
  if ( !Array.isArray( input ) || input.length > MakeATenConstants.MAX_SUM ) {
    throw new Error( 'Invalid number cards.' );
  }
  const numbers = input.map( entry => {
    const { value, position } = object( entry );
    if ( !validInteger( value, 1, MakeATenConstants.MAX_SUM * 2 ) || !Array.isArray( position ) ||
         position.length !== 2 || !position.every( coordinate => Number.isFinite( coordinate ) && Math.abs( coordinate ) < 100000 ) ) {
      throw new Error( 'Invalid number card.' );
    }
    return { value, position: new Vector2( position[ 0 ], position[ 1 ] ) };
  } );
  return () => {
    const previous = keepInteractive ? [ ...model.countingObjects ] : [];
    if ( !keepInteractive ) { model.removeAllCountingObjects(); }
    numbers.forEach( item => model.addCountingObject( new CountingObject( item.value, item.position ) ) );
    previous.forEach( item => model.removeCountingObject( item ) );
  };
}

function readTerms( model: MakeATenAddingModel | MakeATenGameModel ) {
  const terms = model.additionTerms;
  return {
    left: number( terms.leftTermProperty, true, value => value >= 0 && value <= MakeATenConstants.MAX_SUM ),
    right: number( terms.rightTermProperty, true, value => value >= 0 && value <= MakeATenConstants.MAX_SUM ),
    editing: field( terms.activeTermProperty, String, value => Object.values( ActiveTerm ).find( item => item === value ) )
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const [ exploreScreen, addingScreen, gameScreen ] = sim.simScreens;
    const explore = exploreScreen.model as MakeATenExploreModel;
    const exploreView = exploreScreen.view as MakeATenExploreScreenView;
    const adding = addingScreen.model as MakeATenAddingModel;
    const game = gameScreen.model as MakeATenGameModel;
    const challengeProperty = game.currentChallengeProperty as { value: NumberChallenge | null };
    const stageProperty = game.gameStateProperty as { value: ( typeof GameState )[keyof typeof GameState] };
    const exploreFields = { hideSum: boolean( exploreView.hideSumProperty ) };
    const addingFields = readTerms( adding );
    const gameFields = readTerms( game );

    return {
      bridge: 'webwriter-make-a-ten/v1',
      build: 'make-a-ten@1.1.0-dev.0-webwriter.1',
      screens: [ {
        id: 'explore',
        screen: exploreScreen,
        read: () => ( { ...readFields( exploreFields ), cards: readNumbers( explore ) } ),
        prepare: input => {
          const state = object( input );
          const applyFields = prepareFields( exploreFields, state );
          const applyNumbers = prepareNumbers( explore, state.cards );
          return () => {
            explore.splitCue.reset();
            applyFields();
            applyNumbers();
          };
        }
      }, {
        id: 'adding',
        screen: addingScreen,
        read: () => ( { ...readFields( addingFields ), cards: readNumbers( adding ) } ),
        prepare: input => {
          const state = object( input );
          const applyFields = prepareFields( addingFields, state );
          const applyNumbers = prepareNumbers( adding, state.cards );
          return () => {
            adding.additionTerms.activeTermProperty.value = ActiveTerm.NONE;
            applyFields();
            applyNumbers();
          };
        }
      }, {
        id: 'game',
        screen: gameScreen,
        read: () => {
          const challenge = challengeProperty.value;
          return {
            ...readFields( gameFields ),
            cards: readNumbers( game ),
            level: game.levels.indexOf( game.currentLevelProperty.value ),
            scores: game.levels.map( level => level.scoreProperty.value ),
            stage: stageProperty.value,
            challenge: challenge ? [ challenge.leftTerm, challenge.rightTerm ] : null
          };
        },
        prepare: input => {
          const state = object( input );
          const applyFields = prepareFields( gameFields, state );
          const applyNumbers = prepareNumbers( game, state.cards, state.stage === GameState.PRESENTING_INTERACTIVE_CHALLENGE );
          const { level, scores } = state;
          const stage = Object.values( GameState ).find( stage => stage === state.stage );
          const terms = state.challenge;
          if ( ( stage === GameState.PRESENTING_INTERACTIVE_CHALLENGE && ( state.cards as unknown[] ).length < 2 ) ||
               !stage ||
               !validInteger( level, 0, game.levels.length - 1 ) ||
               !Array.isArray( scores ) || scores.length !== game.levels.length ||
               !scores.every( score => validInteger( score, 0 ) ) ||
               ( terms === null ? stage !== GameState.CHOOSING_LEVEL :
                 !Array.isArray( terms ) || terms.length !== 2 ||
                 !terms.every( term => validInteger( term, 1, MakeATenConstants.MAX_SUM ) ) ) ) {
            throw new Error( 'Invalid Make a Ten game.' );
          }
          const challenge = Array.isArray( terms ) ? new NumberChallenge( terms[ 0 ], terms[ 1 ] ) : null;
          return () => {
            stageProperty.value = GameState.CHOOSING_LEVEL;
            game.currentLevelProperty.value = game.levels[ level ];
            challengeProperty.value = challenge;
            // Entering the interactive stage builds default cards, and entering the answer stage increments the score.
            // Apply the saved layout and scores afterward.
            stageProperty.value = stage;
            applyFields();
            applyNumbers();
            game.levels.forEach( ( gameLevel, index ) => { gameLevel.scoreProperty.value = scores[ index ]; } );
          };
        }
      } ]
    };
  } );
}
