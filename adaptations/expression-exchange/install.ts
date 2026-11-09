// Expression Exchange WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Sim from '../../../joist/js/Sim.js';
import AccordionBox from '../../../sun/js/AccordionBox.js';
import EESharedConstants from '../common/EESharedConstants.js';
import AllowedRepresentations from '../common/enum/AllowedRepresentations.js';
import CoinTermTypeID from '../common/enum/CoinTermTypeID.js';
import ViewMode from '../common/enum/ViewMode.js';
import CoinTerm from '../common/model/CoinTerm.js';
import Expression from '../common/model/Expression.js';
import ExpressionManipulationModel from '../common/model/ExpressionManipulationModel.js';
import EEChallengeDescriptors from '../game/model/EEChallengeDescriptors.js';
import EEGameLevel from '../game/model/EEGameLevel.js';
import EEGameModel from '../game/model/EEGameModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

const screenIds = [ 'basics', 'explore', 'negatives', 'game' ];
const types = CoinTermTypeID.VALUES as string[];
type Challenge = ReturnType<typeof EEChallengeDescriptors.getChallengeDescriptor>;

function list( value: unknown, min: number, max = min ): unknown[] {
  if ( !Array.isArray( value ) || value.length < min || value.length > max ) {
    throw new Error( 'Invalid Expression Exchange list.' );
  }
  return value;
}

function integer( value: unknown, min: number, max: number ): number {
  if ( typeof value !== 'number' || !Number.isInteger( value ) || value < min || value > max ) {
    throw new Error( 'Invalid Expression Exchange number.' );
  }
  return value;
}

function point( value: unknown ) {
  const coordinates = list( value, 2 );
  if ( !coordinates.every( coordinate => typeof coordinate === 'number' &&
      Number.isFinite( coordinate ) && Math.abs( coordinate ) < 100000 ) ) {
    throw new Error( 'Invalid Expression Exchange position.' );
  }
  return new Vector2( coordinates[ 0 ] as number, coordinates[ 1 ] as number );
}

function readPoint( point: Vector2 ) {
  return [ point.x, point.y ];
}

function expressionPosition( expression: Expression ) {
  const animation = expression.inProgressAnimationProperty.value;
  return animation ? animation.startPosition.plus( animation.travelVector ) : expression.upperLeftCornerProperty.value;
}

function workspace( model: ExpressionManipulationModel, allowNegativeValues: boolean ) {
  const modes = model.allowedRepresentations === AllowedRepresentations.COINS_ONLY ? [ ViewMode.COINS ] :
    model.allowedRepresentations === AllowedRepresentations.VARIABLES_ONLY ? [ ViewMode.VARIABLES ] :
      [ ViewMode.COINS, ViewMode.VARIABLES ];
  const validValue = ( value: number ) => value >= ( allowNegativeValues ? -10 : 1 ) && value <= 10;
  const fields = {
    mode: field( model.viewModeProperty, value => value, input => modes.find( mode => mode === input ) ),
    coinValues: boolean( model.showCoinValuesProperty ),
    variableValues: boolean( model.showVariableValuesProperty ),
    allCoefficients: boolean( model.showAllCoefficientsProperty ),
    simplifyNegatives: boolean( model.simplifyNegativesProperty ),
    x: number( model.xTermValueProperty, true, validValue ),
    y: number( model.yTermValueProperty, true, validValue ),
    z: number( model.zTermValueProperty, true, validValue )
  };
  return {
    read: () => {
      const terms = ( model.coinTerms.getArrayCopy() as CoinTerm[] ).filter( coin =>
        !coin.isFadingOut() && ( coin.expressionProperty.value || coin.collectedProperty.value ||
        coin.userControlledProperty.value || !coin.destinationProperty.value.equals( coin.initialPosition ) ) );
      const expressions = ( model.expressions.getArrayCopy() as Expression[] ).filter( expression =>
        expression.coinTerms.filter( term => terms.includes( term ) ).length >= 2 );
      const editing = expressions.indexOf( model.expressionBeingEditedProperty.value );
      return {
        ...readFields( fields ),
        terms: terms.map( term => ( {
          type: term.typeID,
          composition: term.composition.slice(),
          position: readPoint( term.userControlledProperty.value ? term.positionProperty.value : term.destinationProperty.value ),
          origin: readPoint( term.initialPosition ),
          onCard: term.initiallyOnCard
        } ) ),
        expressions: expressions.map( expression => ( {
          position: readPoint( expressionPosition( expression ) ),
          terms: expression[ 'getCoinTermsLeftToRight' ]().filter( term => terms.includes( term ) ).map( term => terms.indexOf( term ) )
        } ) ),
        editing: editing < 0 ? null : editing,
        collections: model.collectionAreas.map( area => {
          const item = area.collectedItemProperty.value;
          return item instanceof Expression ? { expression: expressions.indexOf( item ) } :
            item instanceof CoinTerm ? { term: terms.indexOf( item ) } : null;
        } )
      };
    },
    prepare: ( input: unknown, challenge?: Challenge ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const available = challenge?.carouselContents.map( item => item.typeID ) ?? types;
      const terms = list( state.terms, 0, 512 ).map( entry => {
        const data = object( entry );
        const { type, onCard } = data;
        if ( typeof type !== 'string' || !available.includes( type ) || typeof onCard !== 'boolean' ) {
          throw new Error( 'Invalid Expression Exchange term.' );
        }
        const max = EESharedConstants.MAX_NON_DECOMPOSABLE_AMOUNT;
        const composition = list( data.composition, 1, 2048 ).map( value => integer( value, -max, max ) );
        const count = composition.reduce( ( sum, value ) => sum + value, 0 );
        if ( count === 0 || composition.some( value => value === 0 ) ) {
          throw new Error( 'Invalid Expression Exchange coefficient.' );
        }
        return { type, onCard, position: point( data.position ), origin: point( data.origin ), composition, count };
      } );
      const attached = new Set<number>();
      const expressions = list( state.expressions, 0, Math.floor( terms.length / 2 ) ).map( entry => {
        const data = object( entry );
        const members = list( data.terms, 2, terms.length ).map( value => {
          const index = integer( value, 0, terms.length - 1 );
          if ( attached.has( index ) ) { throw new Error( 'A term can belong to one expression.' ); }
          attached.add( index );
          return index;
        } );
        return { members, position: point( data.position ) };
      } );
      const editing = state.editing === null ? null : integer( state.editing, 0, expressions.length - 1 );
      const collected = new Set<string>();
      const collections = list( state.collections, model.collectionAreas.length ).map( ( entry, i ) => {
        if ( entry === null ) { return null; }
        const data = object( entry );
        const expression = 'expression' in data;
        const index = expression ? integer( data.expression, 0, expressions.length - 1 ) :
          integer( data.term, 0, terms.length - 1 );
        const key = `${expression}:${index}`;
        if ( collected.has( key ) || ( expression ? editing === index : attached.has( index ) ) ) {
          throw new Error( 'Invalid Expression Exchange collection.' );
        }
        collected.add( key );
        const members = expression ? expressions[ index ].members : [ index ];
        const counts = new Map<string, number>();
        members.forEach( member => {
          const term = terms[ member ];
          counts.set( term.type, ( counts.get( term.type ) ?? 0 ) + term.count );
        } );
        const expected = challenge?.expressionsToCollect[ i ].terms;
        const distinct = [ ...counts.values() ].filter( count => count !== 0 ).length;
        if ( !expected || distinct !== expected.length ||
             !expected.every( term => counts.get( term.coinTermTypeID ) === term.coefficient ) ) {
          throw new Error( 'Collected terms do not match the Expression Exchange challenge.' );
        }
        return { expression, index };
      } );
      return () => {
        // The model reset removes listeners through the observable collections. This is the base
        // implementation so restoring a game level does not choose a different challenge.
        ExpressionManipulationModel.prototype.reset.call( model );
        applyFields();
        const coins = terms.map( data => {
          const coin = model.coinTermFactory.createCoinTerm( data.type as unknown as typeof CoinTermTypeID, {
            initialCount: data.count,
            initialPosition: data.origin,
            initiallyOnCard: data.onCard,
            decomposable: false
          } );
          coin.composition = data.composition.slice();
          coin.cardOpacityProperty.value = 0;
          coin.setPositionAndDestination( data.position );
          model.addCoinTerm( coin );
          return coin;
        } );
        const groups = expressions.map( data => {
          const members = data.members.map( index => coins[ index ] );
          const expression = new Expression( members[ 0 ], members[ 1 ], model.simplifyNegativesProperty );
          members.slice( 2 ).forEach( coin => expression.addCoinTerm( coin ) );
          members.forEach( coin => coin.goImmediatelyToDestination() );
          expression[ 'updateSizeAndCoinTermPositions' ]( false );
          expression.setPositionAndDestination( data.position );
          model.expressions.add( expression );
          return expression;
        } );
        collections.forEach( ( item, index ) => {
          if ( !item ) { return; }
          const area = model.collectionAreas[ index ];
          if ( item.expression ) {
            const expression = groups[ item.index ];
            expression.collectedProperty.value = true;
            const bounds = expression.getBounds();
            expression.setPositionAndDestination( new Vector2(
              area.bounds.centerX - bounds.width / 2, area.bounds.centerY - bounds.height * 0.4
            ) );
            area.collectedItemProperty.value = expression;
          }
          else {
            const coin = coins[ item.index ];
            coin.collectedProperty.value = true;
            coin.setPositionAndDestination( area.bounds.center );
            area.collectedItemProperty.value = coin;
          }
        } );
        if ( editing !== null ) {
          groups[ editing ].inEditModeProperty.value = true;
          model.expressionBeingEditedProperty.value = groups[ editing ];
        }
      };
    }
  };
}

function explorationState( screen: AnyScreen, model: ExpressionManipulationModel, negatives: boolean ) {
  const state = workspace( model, negatives );
  const boxes = screen.view.children.filter( node => node instanceof AccordionBox );
  const fields = Object.fromEntries( boxes.map( ( box, i ) => [ `accordion${i + 1}`, boolean( box.expandedProperty ) ] ) );
  return {
    read: () => ( { ...readFields( fields ), workspace: state.read() } ),
    prepare: ( input: unknown ) => {
      const data = object( input );
      const apply = state.prepare( data.workspace );
      const applyView = prepareFields( fields, data );
      return () => {
        screen.view.interruptSubtreeInput();
        apply();
        applyView();
      };
    }
  };
}

function challengeKey( challenge: Challenge ) {
  return JSON.stringify( [
    challenge.expressionsToCollect.map( expression => expression.expressionString ),
    challenge.carouselContents.map( term => [ term.typeID, term.minimumDecomposition, term.creationLimit ] )
  ] );
}

function levelState( level: EEGameLevel ) {
  const state = workspace( level, false );
  return {
    read: () => ( {
      challenge: challengeKey( level.currentChallengeProperty.value ),
      workspace: state.read(),
      completed: level.completedSinceLastClearProperty.value,
      hasCleared: level.scoreWasZeroSinceLastCompletion
    } ),
    prepare: ( input: unknown ) => {
      const data = object( input );
      const { completed, hasCleared } = data;
      const choices = Array.from( { length: EEChallengeDescriptors.CHALLENGES_PER_LEVEL },
        ( _, index ) => EEChallengeDescriptors.getChallengeDescriptor( level.levelNumber, index ) );
      const index = choices.findIndex( challenge => challengeKey( challenge ) === data.challenge );
      if ( index < 0 || typeof completed !== 'boolean' || typeof hasCleared !== 'boolean' ) {
        throw new Error( 'Invalid Expression Exchange level.' );
      }
      const challenge = choices[ index ];
      const apply = state.prepare( data.workspace, challenge );
      return () => {
        level.currentChallengeNumber = index;
        level.currentChallengeProperty.value = challenge;
        apply();
        level.scoreWasZeroSinceLastCompletion = hasCleared;
        level.completedSinceLastClearProperty.value = completed;
      };
    }
  };
}

function gameState( screen: AnyScreen, model: EEGameModel ) {
  const levels = ( model.gameLevels as EEGameLevel[] ).map( levelState );
  const fields = { timer: boolean( model.timerEnabledProperty ) };
  return {
    read: () => ( {
      ...readFields( fields ),
      level: model.currentLevelProperty.value === null ? null : model.gameLevels.indexOf( model.currentLevelProperty.value ),
      levels: levels.map( level => level.read() )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const selected = state.level === null ? null : integer( state.level, 0, levels.length - 1 );
      const applyLevels = list( state.levels, levels.length ).map( ( entry, i ) => levels[ i ].prepare( entry ) );
      return () => {
        screen.view.interruptSubtreeInput();
        model.currentLevelProperty.value = null;
        applyLevels.forEach( restore => restore() );
        apply();
        model.currentLevelProperty.value = selected === null ? null : model.gameLevels[ selected ];
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-expression-exchange/v1',
    build: 'expression-exchange@1.2.0-dev.2-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( {
      id: screenIds[ index ], screen,
      ...( index === 3 ? gameState( screen, screen.model as EEGameModel ) :
        explorationState( screen, screen.model as ExpressionManipulationModel, index === 2 ) )
    } ) )
  } ) );
}
