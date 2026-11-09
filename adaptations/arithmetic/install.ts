// Arithmetic WebWriter adapter. Distributed under GPL-3.0.
import stepTimer from '../../../axon/js/stepTimer.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Sim from '../../../joist/js/Sim.js';
import Node from '../../../scenery/js/nodes/Node.js';
import Keypad from '../../../scenery-phet/js/keypad/Keypad.js';
import ArithmeticGlobals from '../common/ArithmeticGlobals.js';
import ArithmeticModel from '../common/model/ArithmeticModel.js';
import GameState from '../common/model/GameState.js';
import FactorModel from '../factor/model/FactorModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { object } from './stateFields.js';

const screenIds = [ 'multiply', 'factor', 'divide' ];
const states = Object.values( GameState );
const digits = [ Keypad.KEY_0, Keypad.KEY_1, Keypad.KEY_2, Keypad.KEY_3, Keypad.KEY_4,
  Keypad.KEY_5, Keypad.KEY_6, Keypad.KEY_7, Keypad.KEY_8, Keypad.KEY_9 ];

function findKeypad( node: Node ): Keypad | undefined {
  if ( node instanceof Keypad ) {
    return node;
  }
  for ( const child of node.children ) {
    const keypad = findKeypad( child );
    if ( keypad ) { return keypad; }
  }
  return undefined;
}

function integer( value: unknown, min: number, max = Number.MAX_SAFE_INTEGER ): number {
  if ( typeof value !== 'number' || !Number.isSafeInteger( value ) || value < min || value > max ) {
    throw new Error( 'Invalid Arithmetic number.' );
  }
  return value;
}

function readEnvironment( model: ArithmeticModel ) {
  const { problemModel, activeLevelModel } = model;
  return {
    input: model.inputProperty.value,
    multiplicand: problemModel.multiplicandProperty.value ?? null,
    multiplier: problemModel.multiplierProperty.value ?? null,
    product: problemModel.productProperty.value ?? null,
    possiblePoints: problemModel.possiblePointsProperty.value,
    state: model.stateProperty.value,
    activeInput: model.activeInputProperty.value,
    currentScore: activeLevelModel?.currentScoreProperty.value ?? 0,
    elapsedTime: activeLevelModel?.gameTimer.elapsedTimeProperty.value ?? 0
  };
}

function prepareEnvironment( input: unknown, screenId: string, size: number ) {
  const state = object( input );
  const { activeInput, input: answer } = state;
  const phase = states.find( phase => phase === state.state );
  if ( !phase || typeof answer !== 'string' || !/^\d{0,3}$/.test( answer ) ||
       !( activeInput === null || screenId === 'divide' && ( activeInput === 'multiplicand' || activeInput === 'multiplier' ) ) ) {
    throw new Error( 'Invalid Arithmetic problem.' );
  }
  const operand = ( value: unknown ) => value === null ? undefined :
    value === '' && screenId === 'divide' ? value : integer( value, 0, 999 );
  const multiplicand = operand( state.multiplicand );
  const multiplier = operand( state.multiplier );
  const product = operand( state.product );
  if ( phase !== GameState.SELECTING_LEVEL ) {
    const validFactor = ( factor: unknown ) => typeof factor === 'number' && factor >= 1 && factor <= size;
    if ( ( screenId === 'multiply' || phase === GameState.DISPLAYING_CORRECT_ANSWER_FEEDBACK ) &&
         ( !validFactor( multiplicand ) || !validFactor( multiplier ) ) ||
         ( screenId !== 'multiply' && ( typeof product !== 'number' || product < 1 || product > size * size ) ) ||
         ( screenId === 'divide' && ( activeInput === null ||
           !validFactor( activeInput === 'multiplicand' ? multiplier : multiplicand ) ) ) ||
         ( phase === GameState.DISPLAYING_CORRECT_ANSWER_FEEDBACK &&
           ( multiplicand as number ) * ( multiplier as number ) !== product ) ) {
      throw new Error( 'Invalid Arithmetic operands.' );
    }
  }
  return {
    input: answer,
    multiplicand,
    multiplier,
    product,
    possiblePoints: integer( state.possiblePoints, 0, 1 ),
    state: phase,
    activeInput,
    currentScore: integer( state.currentScore, 0, size * size ),
    elapsedTime: integer( state.elapsedTime, 0 )
  };
}

function screenState( screen: AnyScreen, screenId: string ) {
  const model = screen.model as ArithmeticModel;
  const keypad = findKeypad( screen.view );
  return {
    isPlaying: () => model.stateProperty.value === GameState.DISPLAYING_CORRECT_ANSWER_FEEDBACK || ArithmeticGlobals.timerEnabledProperty.value &&
      !!model.activeLevelModel?.gameTimer.isRunning && model.stateProperty.value !== GameState.SELECTING_LEVEL,
    read: () => ( {
      level: model.levelNumberProperty.value,
      problem: readEnvironment( model ),
      levels: model.levelModels.map( level => ( {
        environment: level.environment && {
          ...level.environment,
          multiplicand: level.environment.multiplicand ?? null,
          multiplier: level.environment.multiplier ?? null,
          product: level.environment.product ?? null
        },
        used: level.cellUsedStates.map( row => row.map( value => !!value ) ),
        bestTime: level.bestTimeProperty.value,
        score: level.currentScoreProperty.value,
        displayScore: level.displayScoreProperty.value,
        elapsedTime: level.gameTimer.elapsedTimeProperty.value,
        running: level.gameTimer.isRunning
      } ) ),
      ...( model instanceof FactorModel ? { handHint: model.handImageVisibleProperty.value } : {} )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const active = state.level === null ? null : integer( state.level, 0, model.levelModels.length - 1 );
      const size = active === null ? 0 : model.levelModels[ active ].tableSize;
      const problem = prepareEnvironment( state.problem, screenId, size );
      if ( active === null && problem.state !== GameState.SELECTING_LEVEL ||
           !Array.isArray( state.levels ) || state.levels.length !== model.levelModels.length ||
           model instanceof FactorModel && typeof state.handHint !== 'boolean' ) {
        throw new Error( 'Invalid Arithmetic game state.' );
      }
      const savedLevels = state.levels;
      const levels = model.levelModels.map( ( level, i ) => {
        const saved = object( savedLevels[ i ] );
        const environment = saved.environment === null ? null : prepareEnvironment( saved.environment, screenId, level.tableSize );
        const bestTime = saved.bestTime === null ? null : integer( saved.bestTime, 0 );
        const score = integer( saved.score, 0, level.perfectScore );
        const displayScore = integer( saved.displayScore, 0, level.perfectScore );
        const elapsedTime = integer( saved.elapsedTime, 0 );
        const { running, used } = saved;
        if ( typeof running !== 'boolean' || !Array.isArray( used ) || used.length !== level.tableSize ||
             !used.every( row => Array.isArray( row ) && row.length === level.tableSize &&
                                row.every( value => typeof value === 'boolean' ) ) ) {
          throw new Error( 'Invalid Arithmetic level state.' );
        }
        return { environment, bestTime, score, displayScore, elapsedTime, running, used };
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        if ( model.feedbackTimer ) {
          stepTimer.clearTimeout( model.feedbackTimer );
          model.feedbackTimer = null;
        }
        model.faceModel.hideFace();
        model.stateProperty.value = GameState.SELECTING_LEVEL;
        model.levelModels.forEach( ( level, i ) => {
          const saved = levels[ i ];
          level.environment = saved.environment;
          level.bestTimeProperty.value = saved.bestTime;
          level.currentScoreProperty.value = saved.score;
          level.displayScoreProperty.value = saved.displayScore;
          level.cellUsedStates = saved.used.map( row => [ ...row ] );
          level.gameTimer.stop();
          if ( saved.running ) { level.gameTimer.start(); }
          level.gameTimer.elapsedTimeProperty.value = saved.elapsedTime;
        } );
        model.levelNumberProperty.value = active;
        if ( model instanceof FactorModel ) {
          model.handImageVisibleProperty.value = state.handHint as boolean;
        }
        const restoreKeypad = () => {
          keypad?.clear();
          for ( const digit of problem.input ) {
            keypad?.[ 'keyAccumulator' ].handleKeyPressed( digits[ Number( digit ) ].keyID );
          }
        };
        restoreKeypad();
        if ( active !== null ) {
          // Set the input before incorrect-feedback state. Changing input afterward retries the question.
          model.inputProperty.value = problem.input;
          model[ 'restoreGameEnvironment' ]( problem );
          if ( problem.state === GameState.AWAITING_USER_INPUT ) {
            restoreKeypad();
            model[ 'restoreGameEnvironment' ]( problem );
          }
        }
        else {
          model.activeInputProperty.reset();
          model.inputProperty.reset();
          model.problemModel.reset();
        }
        if ( problem.state === GameState.DISPLAYING_CORRECT_ANSWER_FEEDBACK ||
             problem.state === GameState.DISPLAYING_INCORRECT_ANSWER_FEEDBACK ) {
          model.faceModel.pointsToDisplayProperty.value = problem.possiblePoints;
          model.faceModel.isSmileProperty.value = problem.state === GameState.DISPLAYING_CORRECT_ANSWER_FEEDBACK;
          model.faceModel.showFace();
        }
        if ( problem.state === GameState.DISPLAYING_CORRECT_ANSWER_FEEDBACK ) {
          model.feedbackTimer = stepTimer.setTimeout( () => {
            model.feedbackTimer = null;
            model[ 'nextProblem' ]();
          }, 1200 );
        }
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-arithmetic/v1',
    build: 'arithmetic@1.3.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( {
      id: screenIds[ index ], screen, ...screenState( screen, screenIds[ index ] )
    } ) ),
    readPreferences: () => ( { gameTimer: ArithmeticGlobals.timerEnabledProperty.value } ),
    preparePreferences: input => {
      const { gameTimer } = input;
      if ( typeof gameTimer !== 'boolean' ) { throw new Error( 'Invalid Arithmetic timer preference.' ); }
      return () => { ArithmeticGlobals.timerEnabledProperty.value = gameTimer; };
    }
  } ) );
}
