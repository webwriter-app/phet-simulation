// State bindings for the fraction matching games. Distributed under GPL-3.0.
import FractionsCommonColors from '../../../fractions-common/js/common/view/FractionsCommonColors.js';
import FilledPartition from '../../../fractions-common/js/game/model/FilledPartition.js';
import ShapePartition from '../../../fractions-common/js/game/model/ShapePartition.js';
import MatchingChallenge from '../../../fractions-common/js/matching/model/MatchingChallenge.js';
import MatchingGameModel from '../../../fractions-common/js/matching/model/MatchingGameModel.js';
import MatchingLevel from '../../../fractions-common/js/matching/model/MatchingLevel.js';
import MatchPiece from '../../../fractions-common/js/matching/model/MatchPiece.js';
import MatchSpot from '../../../fractions-common/js/matching/model/MatchSpot.js';
import MatchingGameScreenView from '../../../fractions-common/js/matching/view/MatchingGameScreenView.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Fraction from '../../../phetcommon/js/model/Fraction.js';
import { object } from './stateFields.js';

const colors = [ FractionsCommonColors.shapeBlueProperty, FractionsCommonColors.shapeGreenProperty, FractionsCommonColors.shapeRedProperty ];
const partitions = ShapePartition.SHAPE_PARTITIONS;
const phases = MatchingChallenge.State.VALUES;
const pairCount = 6;
const pieceCount = 2 * pairCount;
const scaleCount = 2;

function list( input: unknown, min: number, max = min ): unknown[] {
  if ( !Array.isArray( input ) || input.length < min || input.length > max ) {
    throw new Error( 'Invalid Fraction Matcher list.' );
  }
  return input;
}

function finite( input: unknown ) {
  if ( typeof input !== 'number' || !Number.isFinite( input ) || input < 0 ) {
    throw new Error( 'Invalid Fraction Matcher time.' );
  }
  return input;
}

function integer( input: unknown, min: number, max: number ) {
  if ( typeof input !== 'number' || !Number.isInteger( input ) || input < min || input > max ) {
    throw new Error( 'Invalid Fraction Matcher number.' );
  }
  return input;
}

function flag( input: unknown ) {
  if ( typeof input !== 'boolean' ) { throw new Error( 'Invalid Fraction Matcher option.' ); }
  return input;
}

function allSpots( challenge: MatchingChallenge ): MatchSpot[] {
  return [ ...challenge.sourceSpots, ...challenge.scaleSpots, ...challenge.targets.flatMap( target => target.spots ) ];
}

function readPiece( piece: MatchPiece, spot: number ) {
  return {
    fraction: [ piece.fraction.numerator, piece.fraction.denominator ],
    partitions: piece.filledPartitions?.map( part => ( {
      shape: partitions.indexOf( part.shapePartition ),
      color: colors.indexOf( part.color ),
      fills: part.fills.slice()
    } ) ) ?? null,
    spot
  };
}

function readChallenge( challenge: MatchingChallenge ) {
  const spots = allSpots( challenge );
  const occupied = new Set( challenge.pieces.map( piece => spots.indexOf( piece.spotProperty.value ) ) );
  return {
    pieces: challenge.pieces.map( piece => {
      let spot = spots.indexOf( piece.spotProperty.value );
      if ( spot === -1 ) {
        // A piece being dragged has no model spot. Settle it in a free source spot.
        spot = challenge.sourceSpots.findIndex( ( _, index ) => !occupied.has( index ) );
        occupied.add( spot );
      }
      return readPiece( piece, spot );
    } ),
    phase: phases.indexOf( challenge.stateProperty.value ),
    score: challenge.scoreProperty.value,
    lastScore: challenge.lastScoreGainProperty.value,
    lastFailed: challenge.lastFailedPair.map( piece => challenge.pieces.indexOf( piece ) ),
    wasLastAttemptFailure: challenge.wasLastAttemptFailureProperty.value,
    lastScale: challenge.scaleSpots.indexOf( challenge.lastChangedScaleSpotProperty.value ),
    elapsed: challenge.elapsedTimeProperty.value,
    previousBestTime: Number.isFinite( challenge.previousBestTime ) ? challenge.previousBestTime : null,
    newBestTime: challenge.isNewBestTime,
    complete: challenge.isComplete
  };
}

function prepareChallenge( input: unknown, level: MatchingLevel, model: MatchingGameModel ) {
  const state = object( input );
  const pieceStates = list( state.pieces, pieceCount ).map( input => {
    const data = object( input );
    const [ numerator, denominator ] = list( data.fraction, 2 );
    const fraction = new Fraction( integer( numerator, 1, 200 ), integer( denominator, 1, 100 ) );
    const allowed = level.description.fractions as Fraction[];
    if ( !allowed.some( value => value.numerator * fraction.denominator === fraction.numerator * value.denominator ) ) {
      throw new Error( 'Fraction is outside this level.' );
    }
    const filled = data.partitions === null ? null : list( data.partitions, 1, 4 ).map( input => {
      const state = object( input );
      const partition = partitions[ integer( state.shape, 0, partitions.length - 1 ) ];
      const color = colors[ integer( state.color, 0, colors.length - 1 ) ];
      const fills = list( state.fills, partition.length ).map( flag );
      if ( partition.length % fraction.denominator !== 0 ||
           level.description.shapePartitions && !level.description.shapePartitions.includes( partition ) ) {
        throw new Error( 'Shape cannot represent this fraction.' );
      }
      return new FilledPartition( partition, fills, color );
    } );
    if ( filled && ( filled.length !== Math.ceil( fraction.getValue() ) ||
         filled.some( part => part.shapePartition !== filled[ 0 ].shapePartition || part.color !== filled[ 0 ].color ) ||
         filled.reduce( ( sum, part ) => sum + part.fills.filter( Boolean ).length, 0 ) * fraction.denominator !==
         fraction.numerator * filled[ 0 ].shapePartition.length ) ) {
      throw new Error( 'Filled fraction does not match the piece.' );
    }
    return { fraction, filled, spot: integer( data.spot, 0, 2 * pieceCount + scaleCount - 1 ) };
  } );
  const occupied = new Map( pieceStates.map( piece => [ piece.spot, piece ] ) );
  const phase = phases[ integer( state.phase, 0, phases.length - 1 ) ];
  const phaseType = MatchingChallenge.State as typeof MatchingChallenge.State & Record<'NO_COMPARISON' | 'MATCHED' | 'TRY_AGAIN' | 'SHOW_ANSWER', typeof phase>;
  const score = integer( state.score, 0, pieceCount );
  const lastScore = integer( state.lastScore, 0, 2 );
  const lastScale = integer( state.lastScale, 0, scaleCount - 1 );
  const wasLastAttemptFailure = flag( state.wasLastAttemptFailure );
  const elapsed = finite( state.elapsed );
  const previousBestTime = state.previousBestTime === null ? Infinity : finite( state.previousBestTime );
  const newBestTime = flag( state.newBestTime );
  const complete = flag( state.complete );
  const lastFailed = list( state.lastFailed, 0, 2 ).map( index => integer( index, 0, pieceCount - 1 ) );
  if ( occupied.size !== pieceCount || lastFailed.length === 1 || new Set( lastFailed ).size !== lastFailed.length ||
       phase !== phaseType.NO_COMPARISON && ( !occupied.has( pieceCount ) || !occupied.has( pieceCount + 1 ) ) ) {
    throw new Error( 'Invalid Fraction Matcher placements.' );
  }
  const equivalent = ( first: Fraction, second: Fraction ) =>
    first.numerator * second.denominator === second.numerator * first.denominator;
  const leftScale = occupied.get( pieceCount );
  const rightScale = occupied.get( pieceCount + 1 );
  if ( leftScale && rightScale &&
       ( phase === phaseType.MATCHED && !equivalent( leftScale.fraction, rightScale.fraction ) ||
         ( phase === phaseType.TRY_AGAIN || phase === phaseType.SHOW_ANSWER ) && equivalent( leftScale.fraction, rightScale.fraction ) ) ) {
    throw new Error( 'Invalid Fraction Matcher comparison.' );
  }
  let filledTargets = 0;
  for ( let i = 0; i < pairCount; i++ ) {
    const first = occupied.get( pieceCount + scaleCount + 2 * i );
    const second = occupied.get( pieceCount + scaleCount + 2 * i + 1 );
    if ( first || second ) {
      if ( !first || !second || !equivalent( first.fraction, second.fraction ) || i !== filledTargets ) {
        throw new Error( 'Invalid Fraction Matcher target pair.' );
      }
      filledTargets++;
    }
  }
  if ( complete !== ( filledTargets === pairCount ) ) {
    throw new Error( 'Invalid Fraction Matcher completion.' );
  }

  return {
    saved: state,
    create: () => {
      // Use fresh pieces wired to this challenge by the upstream constructor. Replace the generated
      // puzzle data before exposing it to the view so all drag/drop callbacks keep their original owner.
      const challenge = new MatchingChallenge( level.number, {
        ...level.description,
        timeVisibleProperty: model.timeVisibleProperty,
        previousBestTime
      } );
      const hasGreaterThanOne = pieceStates.some( piece => piece.fraction.getValue() > 1 );
      challenge.pieces.forEach( ( piece, i ) => {
        piece.fraction = pieceStates[ i ].fraction;
        piece.filledPartitions = pieceStates[ i ].filled;
        piece.hasGreaterThanOne = hasGreaterThanOne;
        piece.targetScale = piece.getIdealTargetScale();
      } );
      challenge.scoreProperty.value = score;
      challenge.elapsedTimeProperty.value = elapsed;
      challenge.lastScoreGainProperty.value = lastScore;
      challenge.isNewBestTime = newBestTime;
      challenge.isComplete = complete;
      return challenge;
    },
    place: ( challenge: MatchingChallenge, view: MatchingGameScreenView ) => {
      const spots = allSpots( challenge );
      challenge.sourceSpots.forEach( spot => spot.detachPiece( spot.pieceProperty.value ) );
      const pieces = challenge.pieces;
      const bySpot = new Map( pieceStates.map( ( saved, i ) => [ saved.spot, pieces[ i ] ] ) );
      challenge.targets.forEach( ( target, i ) => {
        if ( i < filledTargets ) {
          const left = bySpot.get( pieceCount + scaleCount + 2 * i )!;
          const right = bySpot.get( pieceCount + scaleCount + 2 * i + 1 )!;
          target.layout( left, right );
          target.isFilledProperty.value = true;
        }
      } );
      pieces.forEach( ( piece, i ) => {
        const spot = spots[ pieceStates[ i ].spot ];
        piece.moveToSpot( spot, { scale: spot.isTarget ? piece.targetScale : 1 } );
        piece.animator.endAnimation();
      } );
      challenge.lastFailedPair = lastFailed.map( index => pieces[ index ] );
      challenge.wasLastAttemptFailureProperty.value = wasLastAttemptFailure;
      challenge.lastChangedScaleSpotProperty.value = challenge.scaleSpots[ lastScale ];
      challenge.stateProperty.value = phase;
      if ( phase === phaseType.MATCHED || phase === phaseType.TRY_AGAIN || phase === phaseType.SHOW_ANSWER ) {
        const [ left, right ] = challenge.scaleSpots.map( spot => spot.pieceProperty.value );
        view.lastChallengeNode?.chartNode.compare( left.fraction.value, right.fraction.value, left.getColor(), right.getColor() );
      }
    }
  };
}

export function fractionMatchingState( screen: AnyScreen ) {
  const model = screen.model as MatchingGameModel;
  const view = screen.view as MatchingGameScreenView;
  const pending = new WeakMap<MatchingChallenge, ReturnType<typeof prepareChallenge>>();
  model.challengeProperty.lazyLink( challenge => {
    if ( !challenge ) { return; }
    const saved = pending.get( challenge );
    if ( saved ) {
      pending.delete( challenge );
      saved.place( challenge, view );
    }
    if ( challenge.isComplete ) {
      challenge.completedEmitter.emit();
    }
  } );
  return {
    isPlaying: () => model.timeVisibleProperty.value &&
      model.challengeProperty.value !== null && !model.challengeProperty.value.isComplete,
    read: () => ( {
      level: model.levelProperty.value === null ? null : model.levels.indexOf( model.levelProperty.value ),
      timer: model.timeVisibleProperty.value,
      levels: model.levels.map( level => ( {
        bestTime: level.bestTimeProperty.value,
        menuScore: level.levelSelectionScoreProperty.value,
        challenge: pending.get( level.challengeProperty.value )?.saved ?? readChallenge( level.challengeProperty.value )
      } ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const selected = state.level === null ? null : integer( state.level, 0, model.levels.length - 1 );
      const timer = flag( state.timer );
      const levels = list( state.levels, model.levels.length ).map( ( value, i ) => {
        const data = object( value );
        const level = model.levels[ i ];
        return {
          level,
          bestTime: finite( data.bestTime ),
          menuScore: integer( data.menuScore, 0, pieceCount ),
          challenge: prepareChallenge( data.challenge, level, model )
        };
      } );
      return () => {
        view.interruptSubtreeInput();
        model.levelProperty.value = null;
        model.timeVisibleProperty.value = timer;
        levels.forEach( saved => {
          const challenge = saved.challenge.create();
          pending.set( challenge, saved.challenge );
          saved.level.challengeProperty.value = challenge;
        } );
        model.levelProperty.value = selected === null ? null : model.levels[ selected ];
        levels.forEach( saved => {
          saved.level.bestTimeProperty.value = saved.bestTime;
          saved.level.levelSelectionScoreProperty.value = saved.menuScore;
        } );
      };
    }
  };
}
