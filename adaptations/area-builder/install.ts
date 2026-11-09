// Area Builder WebWriter adapter. Distributed under GPL-3.0.
import stepTimer from '../../../axon/js/stepTimer.js';
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Sim from '../../../joist/js/Sim.js';
import Shape from '../../../kite/js/Shape.js';
import Fraction from '../../../phetcommon/js/model/Fraction.js';
import Color from '../../../scenery/js/util/Color.js';
import AreaBuilderSharedConstants from '../common/AreaBuilderSharedConstants.js';
import MovableShape from '../common/model/MovableShape.js';
import PerimeterShape from '../common/model/PerimeterShape.js';
import ShapePlacementBoard from '../common/model/ShapePlacementBoard.js';
import AreaBuilderExploreModel from '../explore/model/AreaBuilderExploreModel.js';
import AreaBuilderGameChallenge from '../game/model/AreaBuilderGameChallenge.js';
import AreaBuilderGameModel from '../game/model/AreaBuilderGameModel.js';
import BuildSpec from '../game/model/BuildSpec.js';
import GameState from '../game/model/GameState.js';
import QuizGameModel from '../game/model/QuizGameModel.js';
import AreaBuilderGameView from '../game/view/AreaBuilderGameView.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

const unit = AreaBuilderSharedConstants.UNIT_SQUARE_LENGTH;
const boardWidth = AreaBuilderGameModel.SHAPE_BOARD_UNIT_WIDTH;
const boardHeight = AreaBuilderGameModel.SHAPE_BOARD_UNIT_HEIGHT;

function finite( value: unknown, min: number, max: number ) {
  if ( typeof value !== 'number' || !Number.isFinite( value ) || value < min || value > max ) {
    throw new Error( 'Invalid Area Builder number.' );
  }
  return value;
}

function integer( value: unknown, min: number, max = Number.MAX_SAFE_INTEGER ) {
  const result = finite( value, min, max );
  if ( !Number.isSafeInteger( result ) ) {
    throw new Error( 'Invalid Area Builder integer.' );
  }
  return result;
}

function list( value: unknown, min: number, max = min ): unknown[] {
  if ( !Array.isArray( value ) || value.length < min || value.length > max ) {
    throw new Error( 'Invalid Area Builder list.' );
  }
  return value;
}

function readPoint( point: Vector2 ): [ number, number ] {
  return [ point.x, point.y ];
}

function readColor( color: Color | string ) {
  return Color.toColor( color ).toHexString();
}

function color( value: unknown ) {
  if ( typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test( value ) ) {
    throw new Error( 'Invalid Area Builder color.' );
  }
  return new Color( value );
}

function readPolygon( shape: Shape ) {
  return shape.getSVGPath().trim().replace( /\.0{20}\b/g, '' );
}

function polygon( value: unknown ) {
  if ( typeof value !== 'string' || value.length > 120 ||
       !/^M \d+ \d+(?: L \d+ \d+){2,5} Z$/.test( value ) ||
       value.match( /\d+/g )!.some( coordinate => Number( coordinate ) > 2 * unit || Number( coordinate ) % unit !== 0 ) ) {
    throw new Error( 'Invalid Area Builder tile.' );
  }
  const shape = new Shape( value );
  if ( shape.bounds.minX !== 0 || shape.bounds.minY !== 0 ||
       shape.bounds.width < unit || shape.bounds.height < unit ) {
    throw new Error( 'Invalid Area Builder tile dimensions.' );
  }
  return shape.makeImmutable();
}

function readBoard( board: ShapePlacementBoard ) {
  return [ ...board.residentShapes, ...board.incomingShapes ].map( ( shape: MovableShape ) => {
    const cell = board.modelToCellVector( shape.destination );
    return {
      path: readPolygon( shape.shape ),
      color: readColor( shape.color ),
      origin: readPoint( shape.positionProperty.initialValue ),
      cell: readPoint( cell )
    };
  } );
}

function prepareBoard(
  input: unknown,
  board: ShapePlacementBoard,
  addShape: ( shape: MovableShape ) => void,
  game = false
) {
  const occupied = new Set<number>();
  const tiles = list( input, 0, board.numRows * board.numColumns ).map( entry => {
    const tile = object( entry );
    const [ x, y ] = list( tile.origin, 2 );
    const origin = new Vector2( finite( x, 0, 768 ), finite( y, 0, 464 ) );
    const tileShape = polygon( tile.path );
    const tileColor = color( tile.color );
    const [ savedColumn, savedRow ] = list( tile.cell, 2 );
    const width = tileShape.bounds.width / unit;
    const height = tileShape.bounds.height / unit;
    const column = integer( savedColumn, 0, board.numColumns - width );
    const row = integer( savedRow, 0, board.numRows - height );
    if ( !game && ( width !== 1 || height !== 1 || !tileColor.equals( board.colorHandled ) ) ||
         board.shapeOverlapsBoard( new MovableShape( tileShape, tileColor, origin ) ) ) {
      throw new Error( 'Invalid Area Builder tile origin or color.' );
    }
    for ( let dy = 0; dy < height; dy++ ) {
      for ( let dx = 0; dx < width; dx++ ) {
        const key = ( row + dy ) * board.numColumns + column + dx;
        if ( occupied.has( key ) ) { throw new Error( 'Overlapping Area Builder tiles.' ); }
        occupied.add( key );
      }
    }
    return { tileShape, tileColor, origin, column, row, width, height };
  } );
  return () => {
    board.updatesSuspended = true;
    for ( const { tileShape, tileColor, origin, column, row, width, height } of tiles ) {
      const add = ( shape: Shape, column: number, row: number ) => {
        const movable = new MovableShape( shape, tileColor, origin );
        addShape( movable );
        movable.invisibleWhenStillProperty.value = board.formCompositeProperty.value;
        movable.setDestination( board.cellToModelCoords( column, row ), false );
        board.addResidentShape( movable, false );
        board[ 'addRemovalListener' ]( movable );
      };
      // Completed game placements consist of individual unit squares.
      if ( game && ( width > 1 || height > 1 ) ) {
        for ( let y = 0; y < height; y++ ) {
          for ( let x = 0; x < width; x++ ) {
            add( Shape.rect( 0, 0, unit, unit ), column + x, row + y );
          }
        }
      }
      else {
        add( tileShape, column, row );
      }
    }
    board.updatesSuspended = false;
    board.updateAll();
  };
}

function readFraction( fraction: Fraction | null ) {
  return fraction === null ? null : [ fraction.numerator, fraction.denominator ];
}

function fraction( value: unknown, allowZero = false ) {
  const [ numerator, denominator ] = list( value, 2 );
  const divisor = integer( denominator, allowZero ? 0 : 1, boardWidth * boardHeight );
  return new Fraction( integer( numerator, allowZero ? 0 : 1, allowZero ? divisor : divisor - 1 ), divisor );
}

function readChallenge( challenge: AreaBuilderGameChallenge ) {
  const { toolSpec, userShapes, buildSpec, backgroundShape, checkSpec, exampleBuildItSolution } = challenge;
  return {
    tools: { grid: toolSpec.gridControl, dimensions: toolSpec.dimensionsControl, decomposition: toolSpec.decompositionToolControl },
    kit: userShapes?.map( item => ( {
      path: readPolygon( item.shape ),
      color: readColor( item.color ),
      limit: item.creationLimit ?? null
    } ) ) ?? null,
    build: buildSpec && {
      area: buildSpec.area,
      perimeter: buildSpec.perimeter ?? null,
      proportions: buildSpec.proportions ? {
        color1: readColor( buildSpec.proportions.color1 ),
        color2: readColor( buildSpec.proportions.color2 ),
        ratio: readFraction( buildSpec.proportions.color1Proportion )
      } : null
    },
    background: backgroundShape && {
      exterior: backgroundShape.exteriorPerimeters.map( ring => ring.map( readPoint ) ),
      interior: backgroundShape.interiorPerimeters.map( ring => ring.map( readPoint ) ),
      fill: backgroundShape.fillColor === null ? null : readColor( backgroundShape.fillColor ),
      edge: backgroundShape.edgeColor === null ? null : readColor( backgroundShape.edgeColor )
    },
    check: checkSpec,
    solution: exampleBuildItSolution?.map( cell => [ cell.cellColumn, cell.cellRow, readColor( cell.color ) ] ) ?? null
  };
}

function restoreChallenge( input: unknown ) {
  const state = object( input );
  const tools = object( state.tools );
  const { grid, dimensions, decomposition } = tools;
  if ( typeof grid !== 'boolean' || typeof dimensions !== 'boolean' || typeof decomposition !== 'boolean' ) {
    throw new Error( 'Invalid Area Builder challenge controls.' );
  }
  const kit = state.kit === null ? null : list( state.kit, 1, 12 ).map( entry => {
    const tile = object( entry );
    const shape = polygon( tile.path );
    const creationLimit = tile.limit === null ? undefined : integer( tile.limit, 1, boardWidth );
    if ( creationLimit && ( shape.bounds.width !== unit || shape.bounds.height !== unit ) ) {
      throw new Error( 'Invalid Area Builder creation limit.' );
    }
    return { shape, color: color( tile.color ), creationLimit };
  } );
  const toolSpec = { gridControl: grid, dimensionsControl: dimensions, decompositionToolControl: decomposition };
  if ( state.check === 'areaEntered' && state.build === null && state.solution === null ) {
    const data = object( state.background );
    const rings = ( value: unknown, min: number ) => list( value, min, 4 ).map( ring =>
      list( ring, 3, 64 ).map( point => {
        const [ x, y ] = list( point, 2 );
        return new Vector2( finite( x, -768, 768 ), finite( y, -464, 464 ) );
      } ) );
    const background = new PerimeterShape( rings( data.exterior, 1 ), rings( data.interior, 0 ), unit, {
      fillColor: data.fill === null ? null : color( data.fill ),
      edgeColor: data.edge === null ? null : color( data.edge )
    } );
    if ( background.getWidth() > boardWidth * unit || background.getHeight() > boardHeight * unit ||
         background.getWidth() % unit !== 0 || background.getHeight() % unit !== 0 || background.unitArea <= 0 ) {
      throw new Error( 'Invalid Area Builder background shape.' );
    }
    return new AreaBuilderGameChallenge( toolSpec, kit, null, background, state.check, null );
  }
  if ( state.background !== null || !kit ) {
    throw new Error( 'Invalid Area Builder construction challenge.' );
  }
  const data = object( state.build );
  const area = integer( data.area, 1, boardWidth * boardHeight );
  const perimeter = data.perimeter === null ? undefined : integer( data.perimeter, 4, 2 * ( boardWidth * boardHeight + 1 ) );
  const proportions = data.proportions === null ? undefined : object( data.proportions );
  const check = proportions ?
    ( perimeter ? 'areaPerimeterAndProportionConstructed' : 'areaAndProportionConstructed' ) :
    ( perimeter ? 'areaAndPerimeterConstructed' : 'areaConstructed' );
  if ( state.check !== check ) {
    throw new Error( 'Invalid Area Builder challenge check.' );
  }
  const build = new BuildSpec( area, perimeter, proportions && {
    color1: color( proportions.color1 ),
    color2: color( proportions.color2 ),
    color1Proportion: fraction( proportions.ratio )
  } );
  const occupied = new Set<number>();
  const solution = list( state.solution, area ).map( entry => {
    const [ x, y, fill ] = list( entry, 3 );
    const cellColumn = integer( x, 0, boardWidth - 1 );
    const cellRow = integer( y, 0, boardHeight - 1 );
    const cell = cellRow * boardWidth + cellColumn;
    if ( occupied.has( cell ) ) { throw new Error( 'Overlapping Area Builder solution tiles.' ); }
    occupied.add( cell );
    return { cellColumn, cellRow, color: color( fill ) };
  } );
  return new AreaBuilderGameChallenge( toolSpec, kit, build, null, check, solution );
}

function exploreState( screen: AnyScreen ) {
  const model = screen.model as AreaBuilderExploreModel;
  const fields = {
    boardMode: field( model.boardDisplayModeProperty, value => value,
      value => value === 'single' || value === 'dual' ? value : undefined ),
    grid: boolean( model.showShapeBoardGridsProperty ),
    dimensions: boolean( model.showDimensionsProperty )
  };
  const boards = model.shapePlacementBoards;
  return {
    read: () => ( { ...readFields( fields ), boards: boards.map( readBoard ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( fields, state );
      const applyBoards = list( state.boards, boards.length ).map( ( value, i ) =>
        prepareBoard( value, boards[ i ], shape => model.addUserCreatedMovableShape( shape ) ) );
      return () => {
        screen.view.interruptSubtreeInput();
        model.reset();
        applyBoards.forEach( apply => apply() );
        applyControls();
      };
    }
  };
}

function gameState( screen: AnyScreen ) {
  const model = screen.model as QuizGameModel;
  const view = screen.view as AreaBuilderGameView;
  const specific = model.simSpecificModel as AreaBuilderGameModel;
  const board = specific.shapePlacementBoard;
  const fields = {
    timer: boolean( model.timerEnabledProperty ),
    level: number( model.levelProperty, true, value => value >= 0 && value < model.numberOfLevels ),
    challenge: number( model.challengeIndexProperty, true, value => value >= 0 && value < model.challengesPerSet ),
    score: number( model.scoreProperty, true, value => value >= 0 && value <= model.maxPossibleScore ),
    elapsedTime: number( model.elapsedTimeProperty, true, value => value >= 0 ),
    grid: boolean( specific.showGridOnBoardProperty ),
    dimensions: boolean( specific.showDimensionsProperty ),
    backgroundGrid: boolean( board.showGridOnBackgroundShapeProperty )
  };
  return {
    isPlaying: () => model.timerEnabledProperty.value && !!model.gameTimerId &&
      model.gameStateProperty.value !== GameState.CHOOSING_LEVEL,
    read: () => ( {
      ...readFields( fields ),
      phase: model.gameStateProperty.value,
      board: readBoard( board ),
      challenges: model.challengeList?.map( readChallenge ) ?? null,
      incorrectGuesses: model.incorrectGuessesOnCurrentChallenge,
      bestTimes: model.bestTimes.slice(),
      bestScores: model.bestScoreProperties.map( score => score.value ),
      newBestTime: model.newBestTime ?? false,
      running: !!model.gameTimerId,
      keypad: view.numberEntryControl.keypad.valueStringProperty.value,
      carouselPage: view.carousel?.pageNumberProperty.value ?? null,
      areaGuess: Number.isFinite( specific.areaGuess ) ? specific.areaGuess : null,
      answerArea: typeof view.areaOfUserCreatedShape === 'number' ? view.areaOfUserCreatedShape : null,
      answerPerimeter: typeof view.perimeterOfUserCreatedShape === 'number' ? view.perimeterOfUserCreatedShape : null,
      answerColorRatio: readFraction( view.color1Proportion ),
      resetDimensionsOnNextChallenge: view.clearDimensionsControlOnNextChallenge
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const phase = Object.values( GameState ).find( value => value === state.phase );
      const { running, newBestTime, keypad, resetDimensionsOnNextChallenge } = state;
      if ( !phase || typeof running !== 'boolean' || typeof newBestTime !== 'boolean' ||
           typeof resetDimensionsOnNextChallenge !== 'boolean' || typeof keypad !== 'string' ||
           !/^\d*(?:\.\d*)?$/.test( keypad ) || keypad.replace( '.', '' ).length > 5 ) {
        throw new Error( 'Invalid Area Builder game state.' );
      }
      const challenges = state.challenges === null ? null :
        list( state.challenges, model.challengesPerSet ).map( restoreChallenge );
      const challenge = challenges?.[ state.challenge as number ] ?? null;
      if ( !challenge && phase !== GameState.CHOOSING_LEVEL ) {
        throw new Error( 'Missing Area Builder challenge.' );
      }
      const guesses = integer( state.incorrectGuesses, 0 );
      const times = list( state.bestTimes, model.numberOfLevels ).map( time => time === null ? null : integer( time, 0 ) );
      const scores = list( state.bestScores, model.numberOfLevels ).map( score => integer( score, 0, model.maxPossibleScore ) );
      const areaGuess = state.areaGuess === null ? NaN : finite( state.areaGuess, 0, 99999 );
      const carouselPage = state.carouselPage === null ? null :
        integer( state.carouselPage, 0, ( challenge?.userShapes?.length ?? 0 ) - 1 );
      const answerArea = state.answerArea === null ? AreaBuilderSharedConstants.INVALID_VALUE :
        finite( state.answerArea, 0, boardWidth * boardHeight );
      const answerPerimeter = state.answerPerimeter === null ? AreaBuilderSharedConstants.INVALID_VALUE :
        integer( state.answerPerimeter, 0, 4 * boardWidth * boardHeight );
      const answerColorRatio = state.answerColorRatio === null ? null : fraction( state.answerColorRatio, true );
      const applyBoard = prepareBoard( state.board, board, shape => specific.addUserCreatedMovableShape( shape ), true );
      return () => {
        view.interruptSubtreeInput();
        if ( model.gameTimerId ) {
          stepTimer.clearInterval( model.gameTimerId );
          model.gameTimerId = null;
        }
        model.gameStateProperty.value = GameState.CHOOSING_LEVEL;
        view[ 'disposeCurrentCarousel' ]();
        board.updatesSuspended = false;
        specific.reset();
        model.challengeList = challenges;
        model.currentChallengeProperty.value = challenge;
        model.incorrectGuessesOnCurrentChallenge = 0;
        if ( challenge && phase !== GameState.CHOOSING_LEVEL ) {
          model.gameStateProperty.value = GameState.PRESENTING_INTERACTIVE_CHALLENGE;
        }
        model.incorrectGuessesOnCurrentChallenge = guesses;
        model.newBestTime = newBestTime;
        model.bestTimes = times;
        model.bestScoreProperties.forEach( ( property, i ) => { property.value = scores[ i ]; } );
        if ( running ) {
          model.gameTimerId = stepTimer.setInterval( () => { model.elapsedTimeProperty.value += 1; }, 1000 );
        }
        applyFields();
        applyBoard();
        view.numberEntryControl.keypad.valueStringProperty.value = keypad;
        if ( view.carousel && carouselPage !== null && carouselPage < view.carousel.numberOfPagesProperty.value ) {
          view.carousel.pageNumberProperty.value = carouselPage;
        }
        specific.areaGuess = areaGuess;
        ( view as { areaOfUserCreatedShape: number | string } ).areaOfUserCreatedShape = answerArea;
        ( view as { perimeterOfUserCreatedShape: number | string } ).perimeterOfUserCreatedShape = answerPerimeter;
        view.color1Proportion = answerColorRatio;
        model.gameStateProperty.value = phase;
        view.clearDimensionsControlOnNextChallenge = resetDimensionsOnNextChallenge;
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-area-builder/v1',
    build: 'area-builder@1.2.0-dev.0-webwriter.1',
    screens: [
      { id: 'explore', screen: sim.simScreens[ 0 ], ...exploreState( sim.simScreens[ 0 ] ) },
      { id: 'game', screen: sim.simScreens[ 1 ], ...gameState( sim.simScreens[ 1 ] ) }
    ]
  } ) );
}
