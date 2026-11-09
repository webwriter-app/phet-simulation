// Balancing Act WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Sim from '../../../joist/js/Sim.js';
import BalanceLabModel from '../balancelab/model/BalanceLabModel.js';
import BalanceLabScreenView from '../balancelab/view/BalanceLabScreenView.js';
import BalanceModel from '../common/model/BalanceModel.js';
import ColumnState from '../common/model/ColumnState.js';
import Mass from '../common/model/Mass.js';
import Plank from '../common/model/Plank.js';
import Barrel from '../common/model/masses/Barrel.js';
import BigRock from '../common/model/masses/BigRock.js';
import Boy from '../common/model/masses/Boy.js';
import BrickStack from '../common/model/masses/BrickStack.js';
import CinderBlock from '../common/model/masses/CinderBlock.js';
import Crate from '../common/model/masses/Crate.js';
import FireHydrant from '../common/model/masses/FireHydrant.js';
import FlowerPot from '../common/model/masses/FlowerPot.js';
import Girl from '../common/model/masses/Girl.js';
import LargeBucket from '../common/model/masses/LargeBucket.js';
import LargeTrashCan from '../common/model/masses/LargeTrashCan.js';
import Man from '../common/model/masses/Man.js';
import MediumBucket from '../common/model/masses/MediumBucket.js';
import MediumRock from '../common/model/masses/MediumRock.js';
import MysteryMass from '../common/model/masses/MysteryMass.js';
import PottedPlant from '../common/model/masses/PottedPlant.js';
import Puppy from '../common/model/masses/Puppy.js';
import SmallBucket from '../common/model/masses/SmallBucket.js';
import SmallRock from '../common/model/masses/SmallRock.js';
import SodaBottle from '../common/model/masses/SodaBottle.js';
import Television from '../common/model/masses/Television.js';
import TinyRock from '../common/model/masses/TinyRock.js';
import Tire from '../common/model/masses/Tire.js';
import Woman from '../common/model/masses/Woman.js';
import BasicBalanceScreenView from '../common/view/BasicBalanceScreenView.js';
import BalanceGameChallenge from '../game/model/BalanceGameChallenge.js';
import BalanceGameModel from '../game/model/BalanceGameModel.js';
import BalanceMassesChallenge from '../game/model/BalanceMassesChallenge.js';
import MassDeductionChallenge from '../game/model/MassDeductionChallenge.js';
import TiltPredictionChallenge from '../game/model/TiltPredictionChallenge.js';
import BalanceGameView from '../game/view/BalanceGameView.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

const screenIds = [ 'intro', 'balance-lab', 'game' ];
const people = { boy: Boy, girl: Girl, man: Man, woman: Woman };
const objects = {
  barrel: Barrel, 'big-rock': BigRock, 'cinder-block': CinderBlock, crate: Crate,
  'fire-hydrant': FireHydrant, 'flower-pot': FlowerPot, 'large-bucket': LargeBucket,
  'large-trash-can': LargeTrashCan, 'medium-bucket': MediumBucket, 'medium-rock': MediumRock,
  'potted-plant': PottedPlant, puppy: Puppy, 'small-bucket': SmallBucket, 'small-rock': SmallRock,
  'soda-bottle': SodaBottle, television: Television, 'tiny-rock': TinyRock, tire: Tire
};
const columns = new Map( [
  [ 'both', ColumnState.DOUBLE_COLUMNS ], [ 'one', ColumnState.SINGLE_COLUMN ], [ 'none', ColumnState.NO_COLUMNS ]
] );
const gamePhases = [
  'choosingLevel', 'presentingInteractiveChallenge', 'showingCorrectAnswerFeedback',
  'showingIncorrectAnswerFeedbackTryAgain', 'showingIncorrectAnswerFeedbackMoveOn', 'displayingCorrectAnswer',
  'showingLevelResults'
] as const;
const challengeTypes = [
  [ 'balance', 'tilt', 'balance', 'deduce', 'tilt', 'deduce' ],
  [ 'tilt', 'balance', 'deduce', 'tilt', 'deduce', 'balance' ],
  [ 'balance', 'deduce', 'tilt', 'balance', 'tilt', 'deduce' ],
  [ 'tilt', 'balance', 'deduce', 'tilt', 'deduce', 'balance' ]
];

function finite( value: unknown, min = -Infinity, max = Infinity ): number {
  if ( typeof value !== 'number' || !Number.isFinite( value ) || value < min || value > max ) {
    throw new Error( 'Invalid Balancing Act number.' );
  }
  return value;
}

function integer( value: unknown, min: number, max = Number.MAX_SAFE_INTEGER ): number {
  const number = finite( value, min, max );
  if ( !Number.isSafeInteger( number ) ) {
    throw new Error( 'Invalid Balancing Act integer.' );
  }
  return number;
}

function distance( value: unknown ): number {
  const spacing = Plank.INTER_SNAP_TO_MARKER_DISTANCE;
  const limit = Plank.MAX_VALID_MASS_DISTANCE_FROM_CENTER;
  const saved = finite( value, -limit - 1e-7, limit + 1e-7 );
  const snapped = Math.round( saved / spacing ) * spacing;
  if ( snapped === 0 || Math.abs( saved - snapped ) > 1e-7 ) {
    throw new Error( 'Invalid Balancing Act plank position.' );
  }
  return snapped;
}

function position( value: unknown ): Vector2 {
  if ( !Array.isArray( value ) || value.length !== 2 ) {
    throw new Error( 'Invalid Balancing Act position.' );
  }
  return new Vector2( finite( value[ 0 ], -20, 20 ), finite( value[ 1 ], -20, 20 ) );
}

function readMass( mass: Mass ) {
  if ( mass instanceof BrickStack ) { return { type: 'bricks', count: mass.numBricks }; }
  if ( mass instanceof MysteryMass ) { return { type: 'mystery', id: mass[ 'mysteryMassId' ] }; }
  const person = Object.entries( people ).find( ( [ , MassType ] ) => mass instanceof MassType );
  if ( person ) { return { type: person[ 0 ] }; }
  const object = Object.entries( objects ).find( ( [ , MassType ] ) => mass instanceof MassType );
  if ( object ) { return { type: object[ 0 ], hiddenMass: mass.isMystery }; }
  throw new Error( 'Unknown Balancing Act mass.' );
}

function prepareMass( input: unknown, origin = Vector2.ZERO, lab?: BalanceLabModel ): () => Mass {
  const data = object( input );
  const { type } = data;
  if ( type === 'bricks' ) {
    const count = integer( data.count, 1, 4 );
    return () => lab ? lab.brickStackGroup.createNextElement( count, origin ) : new BrickStack( count );
  }
  if ( type === 'mystery' && lab ) {
    const id = integer( data.id, 0, 7 );
    return () => lab.mysteryMassGroup.createNextElement( origin, id );
  }
  if ( typeof type === 'string' && Object.hasOwn( people, type ) ) {
    const Person = people[ type as keyof typeof people ];
    return () => new Person();
  }
  if ( !lab && typeof type === 'string' && Object.hasOwn( objects, type ) && typeof data.hiddenMass === 'boolean' ) {
    const ObjectMass = objects[ type as keyof typeof objects ];
    return () => new ObjectMass( origin, data.hiddenMass as boolean );
  }
  throw new Error( 'Invalid Balancing Act mass.' );
}

function columnField( model: BalanceModel | BalanceGameModel ) {
  return field( model.columnStateProperty,
    value => [ ...columns ].find( ( [ , state ] ) => state === value )![ 0 ],
    value => typeof value === 'string' ? columns.get( value ) : undefined );
}

function plankState( model: BalanceModel | BalanceGameModel ) {
  const plank = model.plank;
  const fields = {
    columns: columnField( model ),
    tilt: number( plank.tiltAngleProperty, false, value => Math.abs( value ) <= plank.maxTiltAngle )
  };
  return {
    read: () => ( { ...readFields( fields ), velocity: plank[ 'angularVelocity' ] } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyColumns = fields.columns.prepare( state.columns, 'columns' );
      fields.tilt.prepare( state.tilt, 'tilt' );
      const angle = state.tilt as number;
      const velocity = finite( state.velocity );
      if ( state.columns === 'both' && ( angle !== 0 || velocity !== 0 ) ||
           state.columns === 'one' && ( angle !== plank.maxTiltAngle || velocity !== 0 ) ) {
        throw new Error( 'Invalid Balancing Act supported plank.' );
      }
      return () => {
        applyColumns();
        plank[ 'forceAngle' ]( angle );
        plank[ 'angularVelocity' ] = velocity;
      };
    },
    isPlaying: () => {
      const torque = plank[ 'currentNetTorque' ];
      const angle = plank.tiltAngleProperty.value;
      return model.columnStateProperty.value === ColumnState.NO_COLUMNS &&
        ( Math.abs( plank[ 'angularVelocity' ] ) > 1e-5 ||
          Math.abs( torque ) > 1e-5 && Math.sign( torque ) * angle < plank.maxTiltAngle );
    }
  };
}

function constructionState( screen: AnyScreen, model: BalanceModel ) {
  const view = screen.view as BasicBalanceScreenView;
  const carousel = ( view as BalanceLabScreenView )[ 'massCarousel' ];
  const props = view.viewProperties;
  const controls = {
    labels: boolean( props.massLabelsVisibleProperty ),
    forces: boolean( props.forceVectorsFromObjectsVisibleProperty ),
    level: boolean( props.levelIndicatorVisibleProperty ),
    positionMarkers: enumeration( props.positionMarkerStateProperty ),
    ...( carousel ? { massPage: number( carousel.pageNumberProperty, true,
      value => value >= 0 && value < carousel.numberOfPagesProperty.value ) } : {} )
  };
  const plank = plankState( model );
  return {
    isPlaying: plank.isPlaying,
    read: () => ( {
      ...readFields( controls ),
      plank: plank.read(),
      masses: model instanceof BalanceLabModel ? model.plank.massesOnSurface.map( mass => ( {
        mass: readMass( mass ),
        distance: model.plank.getMassDistanceFromCenter( mass ),
        origin: [ mass.animationDestination!.x, mass.animationDestination!.y ]
      } ) ) : model.massList.map( mass => model.plank.massesOnSurface.includes( mass ) ?
        { distance: model.plank.getMassDistanceFromCenter( mass ) } :
        { ground: model.userControlledMasses.includes( mass ) ? mass.positionProperty.initialValue.x : mass.positionProperty.value.x } )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state );
      const applyPlank = plank.prepare( state.plank );
      if ( !Array.isArray( state.masses ) || state.masses.length > Plank.NUM_SNAP_TO_POSITIONS - 1 ||
           !( model instanceof BalanceLabModel ) && state.masses.length !== model.massList.length ) {
        throw new Error( 'Invalid Balancing Act masses.' );
      }
      const distances = new Set<number>();
      const applyMasses = state.masses.map( ( item, i ) => {
        const data = object( item );
        if ( !( model instanceof BalanceLabModel ) && 'ground' in data ) {
          const x = finite( data.ground, -20, 20 );
          return () => { model.massList[ i ].positionProperty.value = new Vector2( x, 0 ); };
        }
        const savedDistance = distance( data.distance );
        if ( distances.has( savedDistance ) ) { throw new Error( 'Occupied Balancing Act plank position.' ); }
        distances.add( savedDistance );
        const origin = model instanceof BalanceLabModel ? position( data.origin ) : Vector2.ZERO;
        const create = model instanceof BalanceLabModel ? prepareMass( data.mass, origin, model ) : () => model.massList[ i ];
        return () => {
          const mass = create();
          if ( model instanceof BalanceLabModel ) {
            mass.animationDestination = origin;
            mass.userControlledProperty.value = false;
            model.addMass( mass );
          }
          model.plank.addMassToSurfaceAt( mass, savedDistance );
        };
      } );
      return () => {
        view.interruptSubtreeInput();
        model.reset();
        applyMasses.forEach( apply => apply() );
        applyPlank();
        applyControls();
      };
    }
  };
}

function readChallenge( challenge: BalanceGameChallenge ) {
  return {
    type: challenge instanceof BalanceMassesChallenge ? 'balance' :
      challenge instanceof MassDeductionChallenge ? 'deduce' : 'tilt',
    fixed: challenge.fixedMassDistancePairs.map( pair => ( { mass: readMass( pair.mass ), distance: pair.distance } ) ),
    movable: challenge.movableMasses.map( readMass )
  };
}

function prepareChallenge( input: unknown, type: string ) {
  const state = object( input );
  const { fixed, movable } = state;
  const counts = type === 'balance' ? [ 1, 2 ] : type === 'deduce' ? [ 1 ] : [ 2, 3 ];
  if ( state.type !== type || !Array.isArray( fixed ) || !counts.includes( fixed.length ) ||
       !Array.isArray( movable ) || movable.length !== ( type === 'tilt' ? 0 : 1 ) ) {
    throw new Error( 'Invalid Balancing Act challenge.' );
  }
  const pairs = fixed.map( entry => {
    const state = object( entry );
    return { create: prepareMass( state.mass ), distance: distance( state.distance ) };
  } );
  if ( new Set( pairs.map( pair => pair.distance ) ).size !== pairs.length ) {
    throw new Error( 'Overlapping Balancing Act challenge masses.' );
  }
  const createMovable = movable.length ? prepareMass( movable[ 0 ] ) : null;
  return {
    fixedDistances: pairs.map( pair => pair.distance ),
    movableCount: movable.length,
    create: () => {
      const fixed = pairs.map( pair => ( { mass: pair.create(), distance: pair.distance } ) );
      if ( !createMovable ) {
        return new TiltPredictionChallenge( fixed );
      }
      const movable = createMovable();
      const solution = { mass: movable, distance: -fixed.reduce( ( torque, pair ) =>
        torque + pair.mass.massValue * pair.distance, 0 ) / movable.massValue };
      return type === 'deduce' ? new MassDeductionChallenge( fixed[ 0 ], movable, solution ) :
        new BalanceMassesChallenge( fixed, [ movable ], [ solution ] );
    }
  };
}

function gameState( screen: AnyScreen, model: BalanceGameModel ) {
  const view = screen.view as BalanceGameView;
  const plank = plankState( model );
  const controls = {
    timer: boolean( model.timerEnabledProperty ),
    elapsedTime: number( model.elapsedTimeProperty, true, value => value >= 0 ),
    score: number( model.scoreProperty, true, value => value >= 0 && value <= BalanceGameModel.MAX_POSSIBLE_SCORE ),
    phase: field( model.gameStateProperty, value => value, value => gamePhases.find( phase => phase === value ) ),
    massGuess: number( view.massValueEntryNode.massValueProperty, false, value => value >= 0 && value <= 100 ),
    tiltGuess: enumeration( view.tiltPredictionSelectorNode.tiltPredictionProperty )
  };
  return {
    isPlaying: () => model.gameStateProperty.value !== 'choosingLevel' &&
      ( plank.isPlaying() || model.timerEnabledProperty.value && model[ 'gameTimerId' ] !== null ),
    read: () => ( {
      ...readFields( controls ),
      plank: plank.read(),
      level: model.levelProperty.value,
      challenge: model.challengeIndexProperty.value,
      incorrectGuesses: model.incorrectGuessesOnCurrentChallenge,
      running: model[ 'gameTimerId' ] !== null,
      newBestTime: model.newBestTime,
      bestTimes: model.bestTimes.slice(),
      bestScores: model.bestScores.map( score => score.value ),
      challenges: model.challengeList?.map( readChallenge ) ?? null,
      placements: model.movableMasses.map( mass => model.plank.massesOnSurface.includes( mass ) ?
        model.plank.getMassDistanceFromCenter( mass ) : null )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const level = integer( state.level, 0, model.bestScores.length - 1 );
      const count = BalanceGameModel.PROBLEMS_PER_LEVEL;
      const challengeIndex = integer( state.challenge, 0, count );
      const incorrectGuesses = integer( state.incorrectGuesses, 0, 2 );
      const { challenges, newBestTime, running, bestTimes, bestScores, placements } = state;
      const applyControls = prepareFields( controls, state );
      const applyPlank = plank.prepare( state.plank );
      if ( typeof newBestTime !== 'boolean' || typeof running !== 'boolean' ||
           !Array.isArray( bestTimes ) || bestTimes.length !== model.bestTimes.length ||
           !Array.isArray( bestScores ) || bestScores.length !== model.bestScores.length ||
           ( challenges === null ? state.phase !== 'choosingLevel' : !Array.isArray( challenges ) || challenges.length !== count ) ||
           ( challengeIndex === count && state.phase !== 'showingLevelResults' && state.phase !== 'choosingLevel' ) ) {
        throw new Error( 'Invalid Balancing Act game state.' );
      }
      const times = bestTimes.map( value => value === null ? null : integer( value, 0 ) );
      const scores = bestScores.map( value => integer( value, 0, BalanceGameModel.MAX_POSSIBLE_SCORE ) );
      const saved = ( challenges as unknown[] | null )?.map( ( entry, i ) => prepareChallenge( entry, challengeTypes[ level ][ i ] ) );
      const active = saved?.[ Math.min( challengeIndex, count - 1 ) ];
      if ( !Array.isArray( placements ) || placements.length !== ( active?.movableCount ?? 0 ) ) {
        throw new Error( 'Invalid Balancing Act game placements.' );
      }
      const occupied = new Set( active?.fixedDistances );
      const positions = placements.map( value => {
        if ( value === null ) { return null; }
        const location = distance( value );
        if ( occupied.has( location ) ) { throw new Error( 'Overlapping Balancing Act game placements.' ); }
        occupied.add( location );
        return location;
      } );
      return () => {
        view.interruptSubtreeInput();
        if ( model[ 'gameTimerId' ] !== null ) { model.stopGameTimer(); }
        model.gameStateProperty.value = 'choosingLevel';
        model.plank.removeAllMasses();
        model.fixedMasses.clear();
        model.movableMasses.clear();
        model.challengeList?.forEach( challenge => challenge.dispose() );
        model.challengeList = saved?.map( challenge => challenge.create() ) ?? null;
        model.levelProperty.value = level;
        model.challengeIndexProperty.value = challengeIndex;
        model.incorrectGuessesOnCurrentChallenge = incorrectGuesses;
        model.newBestTime = newBestTime;
        model.bestTimes = times;
        model.bestScores.forEach( ( score, i ) => { score.value = scores[ i ]; } );
        if ( model.challengeList ) {
          model.plank[ 'forceAngle' ]( 0 );
          model[ 'setChallenge' ]( model.challengeList[ Math.min( challengeIndex, count - 1 ) ], ColumnState.DOUBLE_COLUMNS );
          positions.forEach( ( value, i ) => {
            if ( value !== null ) { model.plank.addMassToSurfaceAt( model.movableMasses[ i ], value ); }
          } );
        }
        if ( active && state.phase !== 'choosingLevel' && state.phase !== 'showingLevelResults' ) {
          model.gameStateProperty.value = 'presentingInteractiveChallenge';
        }
        applyPlank();
        if ( running ) { model.restartGameTimer(); }
        applyControls();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-balancing-act/v1',
    build: 'balancing-act@1.4.0-dev.2-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => {
      const model = screen.model as BalanceModel | BalanceGameModel;
      return {
        id: screenIds[ index ], screen,
        ...( model instanceof BalanceGameModel ? gameState( screen, model ) : constructionState( screen, model ) )
      };
    } )
  } ) );
}
