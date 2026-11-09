// Balancing Chemical Equations WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import type Equation from '../common/model/Equation.js';
import BCEPreferences from '../common/model/BCEPreferences.js';
import type IntroModel from '../intro/model/IntroModel.js';
import type EquationsModel from '../equations/model/EquationsModel.js';
import type GameModel from '../game/model/GameModel.js';
import type GameScreenView from '../game/view/GameScreenView.js';
import { GameStateValues } from '../game/model/GameState.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

function equationSelection( property: { value: Equation }, equations: Equation[] ) {
  return field( property, equation => equations.indexOf( equation ), input =>
    typeof input === 'number' && Number.isInteger( input ) ? equations[ input ] : undefined );
}

function readEquations( equations: Equation[] ) {
  return equations.map( equation => equation.terms.map( term => term.coefficientProperty.value ) );
}

function prepareEquations( equations: Equation[], input: unknown ) {
  if ( !Array.isArray( input ) || input.length !== equations.length ) {
    throw new Error( 'Invalid equation count.' );
  }
  const changes = equations.map( ( equation, index ) => {
    const coefficients = input[ index ];
    if ( !Array.isArray( coefficients ) || coefficients.length !== equation.terms.length ) {
      throw new Error( 'Invalid equation coefficients.' );
    }
    return equation.terms.map( ( term, termIndex ) =>
      number( term.coefficientProperty, true ).prepare( coefficients[ termIndex ], 'coefficient' ) );
  } );
  return () => changes.forEach( equation => equation.forEach( apply => apply() ) );
}

function gameState( model: GameModel, view: GameScreenView ) {
  const controls = {
    timerEnabled: boolean( model.timerEnabledProperty ),
    reactantsExpanded: boolean( view.viewProperties.reactantsAccordionBoxExpandedProperty ),
    productsExpanded: boolean( view.viewProperties.productsAccordionBoxExpandedProperty )
  };
  const results = {
    score: number( model.scoreProperty, true, value => value >= 0 ),
    points: number( model.pointsProperty, true ),
    attempts: number( model[ 'attemptsProperty' ], true ),
    elapsedTime: number( model.timer.elapsedTimeProperty, true ),
    newBestTime: boolean( {
      get value() { return model.isNewBestTime; },
      set value( value ) { model.isNewBestTime = value; }
    } )
  };
  const best = model.levels.map( level => ( {
    score: number( level.bestScoreProperty, true, value => value >= 0 && value <= level.getPerfectScore() ),
    time: number( level.bestTimeProperty, true, value => value >= 0 )
  } ) );
  const pool = model.levels.map( level => Array.from( { length: level[ 'equationPool' ].getPoolSize() },
    ( _, index ) => level.getEquation( index ) ) );
  return {
    isPlaying: () => model.timer.isRunning,
    read: () => {
      const level = model.levelProperty.value;
      const challenges = model[ 'challengesProperty' ].value;
      return {
        ...readFields( controls ),
        best: best.map( readFields ),
        game: level ? {
          level: level.levelNumber,
          stage: model.gameStateProperty.value,
          challenge: model.challengeNumberProperty.value,
          challenges: challenges.map( challenge => pool[ level.levelNumber - 1 ].indexOf( challenge ) ),
          coefficients: readEquations( challenges ),
          ...readFields( results ),
          timerRunning: model.timer.isRunning
        } : null
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state );
      const savedBest = state.best;
      if ( !Array.isArray( savedBest ) || savedBest.length !== best.length ) {
        throw new Error( 'Invalid best scores.' );
      }
      const applyBest = best.map( ( fields, index ) => prepareFields( fields, savedBest[ index ] ) );
      let restoreGame = () => {};
      if ( state.game !== null ) {
        const game = object( state.game );
        const { level, challenge, challenges, timerRunning } = game;
        const stage = GameStateValues.find( value => value === game.stage );
        if ( typeof level !== 'number' || !Number.isInteger( level ) || !model.levels[ level - 1 ] ||
             !stage || stage === 'levelSelection' ||
             !Array.isArray( challenges ) || challenges.length !== model.levels[ level - 1 ].getNumberOfChallenges() ||
             new Set( challenges ).size !== challenges.length ||
             !challenges.every( index => Number.isInteger( index ) && pool[ level - 1 ][ index ] ) ||
             typeof challenge !== 'number' || !Number.isInteger( challenge ) || challenge < 1 || challenge > challenges.length ||
             ( stage === 'levelCompleted' && challenge !== challenges.length ) ||
             typeof timerRunning !== 'boolean' || ( timerRunning && ( !state.timerEnabled || stage === 'levelCompleted' ) ) ||
             typeof game.score !== 'number' || game.score > model.levels[ level - 1 ].getPerfectScore() ) {
          throw new Error( 'Invalid game progress.' );
        }
        const equations = challenges.map( index => pool[ level - 1 ][ index ] );
        const applyEquations = prepareEquations( equations, game.coefficients );
        const applyResults = prepareFields( results, game );
        restoreGame = () => {
          // Enter the level through the model so the game view creates its level UI first.
          model.levelProperty.value = model.levels[ level - 1 ];
          model[ 'challengesProperty' ].value = equations;
          model[ '_challengeNumberProperty' ].value = challenge;
          applyEquations();
          if ( timerRunning ) {
            model.timer.start();
          }
          applyResults();
          model[ '_gameStateProperty' ].value = stage;
        };
      }
      return () => {
        view.interruptSubtreeInput();
        model.startOver();
        model.timerEnabledProperty.value = false;
        applyBest.forEach( apply => apply() );
        restoreGame();
        applyControls();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const [ introScreen, equationsScreen, gameScreen ] = sim.simScreens;
    const intro = introScreen.model as IntroModel;
    const equations = equationsScreen.model as EquationsModel;
    const introEquations = intro.choices.map( choice => choice.equation );
    const allEquations = [ ...equations.synthesisEquations, ...equations.decompositionEquations, ...equations.combustionEquations ];
    const introFields = { equation: equationSelection( intro.equationProperty, introEquations ) };
    const equationFields = {
      reaction: enumeration( equations.reactionTypeProperty ),
      synthesis: equationSelection( equations.synthesisEquationProperty, equations.synthesisEquations ),
      decomposition: equationSelection( equations.decompositionEquationProperty, equations.decompositionEquations ),
      combustion: equationSelection( equations.combustionEquationProperty, equations.combustionEquations )
    };
    const preferences = BCEPreferences.instance;
    const preferenceFields = {
      initialCoefficient: number( preferences.initialCoefficientProperty, true,
        value => preferences.initialCoefficientProperty.validValues!.includes( value ) )
    };

    return {
      bridge: 'webwriter-balancing-chemical-equations/v1',
      build: 'balancing-chemical-equations@2.2.0-dev.0-webwriter.1',
      screens: [
        { id: 'intro', screen: introScreen, ...equationScreen( introScreen, introEquations, introFields ) },
        { id: 'equations', screen: equationsScreen, ...equationScreen( equationsScreen, allEquations, equationFields ) },
        { id: 'game', screen: gameScreen, ...gameState( gameScreen.model as GameModel, gameScreen.view as GameScreenView ) }
      ],
      readPreferences: () => readFields( preferenceFields ),
      preparePreferences: input => prepareFields( preferenceFields, input )
    };
  } );
}

function equationScreen( screen: Sim[ 'simScreens' ][ number ], equations: Equation[],
                         fields: Parameters<typeof prepareFields>[ 0 ] ) {
  return {
    read: () => ( { ...readFields( fields ), coefficients: readEquations( equations ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const applyEquations = prepareEquations( equations, state.coefficients );
      return () => {
        screen.view.interruptSubtreeInput();
        applyFields();
        applyEquations();
      };
    }
  };
}
