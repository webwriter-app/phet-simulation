// State adapter for PhET Reactants, Products and Leftovers. Distributed under GPL-3.0.
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import BoxType from '../common/model/BoxType.js';
import type Reaction from '../common/model/Reaction.js';
import ReactionFactory from '../common/model/ReactionFactory.js';
import type RPALBaseModel from '../common/model/RPALBaseModel.js';
import type Substance from '../common/model/Substance.js';
import RPALConstants from '../common/RPALConstants.js';
import Challenge from '../game/model/Challenge.js';
import type GameModel from '../game/model/GameModel.js';
import GamePhase from '../game/model/GamePhase.js';
import PlayState from '../game/model/PlayState.js';
import SandwichRecipe from '../sandwiches/model/SandwichRecipe.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

function list( input: unknown, length: number ) {
  if ( !Array.isArray( input ) || input.length !== length ) { throw new Error( 'Invalid reaction state list.' ); }
  return input as unknown[];
}
function integer( input: unknown, min: number, max: number ) {
  if ( typeof input !== 'number' || !Number.isSafeInteger( input ) || input < min || input > max ) {
    throw new Error( 'Invalid reaction state number.' );
  }
  return input;
}

function readQuantities( substances: Substance[] ) {
  return substances.map( substance => substance.quantityProperty.value );
}
function prepareQuantities( substances: Substance[], input: unknown, max: number ) {
  const values = list( input, substances.length ).map( value => integer( value, 0, max ) );
  return () => substances.forEach( ( substance, i ) => { substance.quantityProperty.value = values[ i ]; } );
}
function quantities( reaction: Reaction ) { return reaction.reactants.concat( reaction.products, reaction.leftovers ); }

function bindReactionScreen( screen: AnyScreen, id: string ) {
  const model = screen.model as RPALBaseModel;
  const fields = {
    reaction: field( model.reactionProperty, value => model.reactions.indexOf( value ),
      input => typeof input === 'number' && Number.isInteger( input ) ? model.reactions[ input ] : undefined )
  };
  return {
    id,
    screen,
    read: () => ( {
      ...readFields( fields ),
      reactions: model.reactions.map( reaction => ( {
        reactants: readQuantities( reaction.reactants ),
        ...( reaction instanceof SandwichRecipe && reaction.coefficientsMutable ? {
          coefficients: reaction.reactants.map( substance => substance.coefficientProperty.value )
        } : {} )
      } ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const reactions = list( state.reactions, model.reactions.length ).map( ( input, i ) => {
        const data = object( input );
        const reaction = model.reactions[ i ];
        const applyAmounts = prepareQuantities( reaction.reactants, data.reactants, RPALConstants.QUANTITY_RANGE.max );
        const coefficients = reaction instanceof SandwichRecipe && reaction.coefficientsMutable ?
          list( data.coefficients, reaction.reactants.length ).map( value => integer( value, 0, RPALConstants.SANDWICH_COEFFICIENT_RANGE.max ) ) : null;
        return () => {
          coefficients?.forEach( ( value, i ) => { reaction.reactants[ i ].coefficientProperty.value = value; } );
          applyAmounts();
        };
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        reactions.forEach( apply => apply() );
        apply();
      };
    }
  };
}

// A game challenge always comes from the upstream molecular reaction catalog.
function reactionKey( reaction: Reaction ) {
  const formula = ( substances: Substance[] ) =>
    substances.map( substance => `${substance.coefficientProperty.value}:${substance.tandemName}` ).join( '+' );
  return `${formula( reaction.reactants )}=${formula( reaction.products )}`;
}
let factoryByKey: Map<string, () => Reaction> | undefined;
function factoryFor( key: unknown ) {
  if ( typeof key !== 'string' ) { return undefined; }
  factoryByKey ??= new Map( Object.values( ReactionFactory ).map( factory => [ reactionKey( factory() ), factory ] ) );
  return factoryByKey.get( key );
}

function bindGame( screen: AnyScreen ) {
  const model = screen.model as GameModel;
  const timer = model.timer;
  const fields = {
    level: number( model.levelProperty, true ),
    timer: boolean( model.timerEnabledProperty ),
    visibility: enumeration( model.gameVisibilityProperty ),
    playState: enumeration( model.playStateProperty )
  };
  const phase = enumeration( model.gamePhaseProperty );
  const bestScores = model.bestScoreProperties.map( ( property, i ) => number( property, true, value => value >= 0 && value <= model.getPerfectScore( i ) ) );
  return {
    id: 'game',
    screen,
    isPlaying: () => model.gamePhaseProperty.value === GamePhase.PLAY && timer.isRunning,
    read: () => {
      const challenges = model.challenges.slice( 0, model.numberOfChallengesProperty.value );
      return {
        ...readFields( fields ),
        phase: phase.read(),
        challenges: challenges.map( challenge => ( {
          reaction: reactionKey( challenge.reaction ),
          reactants: readQuantities( challenge.reaction.reactants ),
          guess: readQuantities( challenge.guess.reactants.concat( challenge.guess.products, challenge.guess.leftovers ) ),
          points: challenge.points,
          moleculesVisible: challenge.moleculesVisible,
          numbersVisible: challenge.numbersVisible
        } ) ),
        current: model.challengeNumberProperty.value,
        score: model.scoreProperty.value,
        elapsed: timer.elapsedTimeProperty.value,
        running: timer.isRunning && model.gamePhaseProperty.value === GamePhase.PLAY,
        bestScores: bestScores.map( binding => binding.read() ),
        bestTimes: model.bestTimeProperties.map( property => property.value ),
        newBestTime: model.isNewBestTime
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const applyPhase = phase.prepare( state.phase, 'game phase' );
      const level = state.level as number;
      const playing = state.phase === String( GamePhase.PLAY );
      const settings = state.phase === String( GamePhase.SETTINGS );
      const count = model.getNumberOfChallenges( level );
      if ( !Array.isArray( state.challenges ) ||
           ( state.challenges.length !== count && !( settings && state.challenges.length === 0 ) ) ||
           typeof state.running !== 'boolean' || state.running && !playing ||
           typeof state.newBestTime !== 'boolean' || playing === ( state.playState === String( PlayState.NONE ) ) ) {
        throw new Error( 'Invalid reaction game phase.' );
      }
      const current = integer( state.current, state.challenges.length ? 1 : 0, state.challenges.length );
      const score = integer( state.score, 0, model.getPerfectScore( level ) );
      const elapsed = integer( state.elapsed, 0, Number.MAX_SAFE_INTEGER );
      const applyBestScores = list( state.bestScores, model.numberOfLevels ).map( ( value, i ) => bestScores[ i ].prepare( value, 'best score' ) );
      const bestTimes = list( state.bestTimes, model.numberOfLevels ).map( value =>
        value === null ? null : integer( value, 0, Number.MAX_SAFE_INTEGER ) );
      const seen = new Set<string>();
      const challenges = state.challenges.map( ( input, index ) => {
        const data = object( input );
        const factory = factoryFor( data.reaction );
        if ( !factory || typeof data.moleculesVisible !== 'boolean' || typeof data.numbersVisible !== 'boolean' ||
             !data.moleculesVisible && !data.numbersVisible || seen.has( data.reaction as string ) ) {
          throw new Error( 'Invalid reaction game challenge.' );
        }
        seen.add( data.reaction as string );
        const reaction = factory();
        if ( level > 0 && reaction.products.length !== level ) { throw new Error( 'Reaction is incompatible with the game level.' ); }
        prepareQuantities( reaction.reactants, data.reactants, model.maxQuantity )();
        if ( quantities( reaction ).some( substance => substance.quantityProperty.value > model.maxQuantity ) ) {
          throw new Error( 'Reaction exceeds the game quantity limit.' );
        }
        const challenge = new Challenge( reaction, level === 0 ? BoxType.BEFORE : BoxType.AFTER, {
          moleculesVisible: data.moleculesVisible,
          numbersVisible: data.numbersVisible
        } );
        const guess = challenge.guess;
        prepareQuantities( guess.reactants.concat( guess.products, guess.leftovers ), data.guess, model.maxQuantity )();
        challenge.points = integer( data.points, 0, index < current ? 2 : 0 );
        return challenge;
      } );
      if ( challenges.reduce( ( sum, challenge ) => sum + challenge.points, 0 ) !== score ) { throw new Error( 'Invalid reaction game score.' ); }
      const running = state.running;
      const newBestTime = state.newBestTime;
      return () => {
        screen.view.interruptSubtreeInput();
        model.settings();
        apply();
        model.challenges = challenges;
        model.numberOfChallengesProperty.value = challenges.length;
        model[ '_challengeNumberProperty' ].value = current;
        model.scoreProperty.value = score;
        model.challengeProperty.value = challenges[ current - 1 ] ?? null;
        applyBestScores.forEach( apply => apply() );
        model.bestTimeProperties.forEach( ( property, i ) => { property.value = bestTimes[ i ]; } );
        model.isNewBestTime = newBestTime;
        if ( running ) { timer.start(); }
        timer.elapsedTimeProperty.value = elapsed;
        applyPhase();
      };
    }
  };
}

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-reactants-products-and-leftovers/v1',
    build: 'reactants-products-and-leftovers@1.4.0-dev.0-webwriter.1',
    screens: [
      bindReactionScreen( sim.simScreens[ 0 ], 'sandwiches' ),
      bindReactionScreen( sim.simScreens[ 1 ], 'molecules' ),
      bindGame( sim.simScreens[ 2 ] )
    ]
  } ) );
}
