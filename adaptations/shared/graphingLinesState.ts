// Graphing Lines family WebWriter state. Distributed under GPL-3.0.
import Range from '../../../dot/js/Range.js';
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import type TColor from '../../../scenery/js/util/TColor.js';
import GLColors from '../../../graphing-lines/js/common/GLColors.js';
import Line from '../../../graphing-lines/js/common/model/Line.js';
import type LineFormsModel from '../../../graphing-lines/js/common/model/LineFormsModel.js';
import EquationAccordionBox from '../../../graphing-lines/js/common/view/EquationAccordionBox.js';
import type LineFormsViewProperties from '../../../graphing-lines/js/common/view/LineFormsViewProperties.js';
import LineGameConstants from '../../../graphing-lines/js/linegame/LineGameConstants.js';
import BaseGameModel from '../../../graphing-lines/js/linegame/model/BaseGameModel.js';
import type Challenge from '../../../graphing-lines/js/linegame/model/Challenge.js';
import EquationForm from '../../../graphing-lines/js/linegame/model/EquationForm.js';
import GamePhase from '../../../graphing-lines/js/linegame/model/GamePhase.js';
import GraphTheLine from '../../../graphing-lines/js/linegame/model/GraphTheLine.js';
import MakeTheEquation from '../../../graphing-lines/js/linegame/model/MakeTheEquation.js';
import ManipulationMode from '../../../graphing-lines/js/linegame/model/ManipulationMode.js';
import NotALine from '../../../graphing-lines/js/linegame/model/NotALine.js';
import PlaceThePoints from '../../../graphing-lines/js/linegame/model/PlaceThePoints.js';
import PlayState from '../../../graphing-lines/js/linegame/model/PlayState.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

function bounded( value: unknown, min: number, max: number, integer = false ): number {
  if ( typeof value !== 'number' || !Number.isFinite( value ) || value < min || value > max ||
       ( integer && !Number.isInteger( value ) ) ) {
    throw new Error( 'Invalid graphing value.' );
  }
  return value;
}

function tuple( input: unknown, length: number, integer = false ): number[] {
  if ( !Array.isArray( input ) || input.length !== length ) { throw new Error( 'Invalid graphing coordinates.' ); }
  return input.map( value => bounded( value, -200, 200, integer ) );
}

function endpoints( line: Line ) {
  return [ line.x1, line.y1, line.x2, line.y2 ];
}

function line( input: unknown, color: TColor ): Line {
  const [ x1, y1, x2, y2 ] = tuple( input, 4, true );
  if ( x1 === x2 && y1 === y2 ) { throw new Error( 'Line requires two distinct points.' ); }
  return new Line( x1, y1, x2, y2, color );
}

function descendants( node: Node ): Node[] {
  return node.children.flatMap( child => [ child, ...descendants( child ) ] );
}

function formsState( screen: AnyScreen ) {
  const model = screen.model as LineFormsModel;
  const view = ( screen.view as unknown as { viewProperties: LineFormsViewProperties } ).viewProperties;
  const equation = descendants( screen.view ).find( node => node instanceof EquationAccordionBox ) as EquationAccordionBox;
  const fields = {
    lines: boolean( view.linesVisibleProperty ),
    grid: boolean( view.gridVisibleProperty ),
    interactiveEquation: boolean( view.interactiveEquationVisibleProperty ),
    slopeTool: boolean( view.slopeToolVisibleProperty ),
    equationExpanded: boolean( equation.expandedProperty ),
    pointTool1: vector( model.pointTool1.positionProperty ),
    pointTool2: vector( model.pointTool2.positionProperty )
  };
  const standards = [ Line.Y_EQUALS_X_LINE, Line.Y_EQUALS_NEGATIVE_X_LINE ];
  return {
    read: () => ( {
      controls: readFields( fields ),
      interactiveLine: endpoints( model.interactiveLineProperty.value ),
      savedLines: model.savedLines.map( endpoints ),
      standardLines: standards.map( line => model.standardLines.includes( line ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state.controls );
      const interactive = line( state.interactiveLine, GLColors.interactiveLineColorProperty );
      if ( !Array.isArray( state.savedLines ) || state.savedLines.length > 200 ||
           !Array.isArray( state.standardLines ) || state.standardLines.length !== 2 ||
           !state.standardLines.every( value => typeof value === 'boolean' ) ) {
        throw new Error( 'Invalid graphing line collection.' );
      }
      const saved = state.savedLines.map( value => line( value, GLColors.savedLineColorProperty ) );
      const enabled = state.standardLines;
      return () => {
        screen.view.interruptSubtreeInput();
        model.interactiveLineProperty.value = interactive;
        model.savedLines.clear();
        model.savedLines.addAll( saved );
        standards.forEach( ( standard, index ) => {
          const exists = model.standardLines.includes( standard );
          if ( enabled[ index ] && !exists ) { model.standardLines.add( standard ); }
          if ( !enabled[ index ] && exists ) { model.standardLines.remove( standard ); }
        } );
        apply();
      };
    }
  };
}

function readChallenge( challenge: Challenge ) {
  const guess = challenge.guessProperty.value;
  return {
    kind: challenge instanceof PlaceThePoints ? 'points' : challenge instanceof MakeTheEquation ? 'equation' : 'graph',
    answer: endpoints( challenge.answer ),
    guess: guess instanceof Line ? endpoints( guess ) : null,
    form: challenge.equationForm.name,
    mode: challenge.manipulationMode.name,
    xRange: [ challenge.graph.xRange.min, challenge.graph.xRange.max ],
    yRange: [ challenge.graph.yRange.min, challenge.graph.yRange.max ],
    answerVisible: challenge.answerVisible,
    tools: [ challenge.pointTool1, challenge.pointTool2 ].map( tool => [ tool.positionProperty.value.x, tool.positionProperty.value.y ] ),
    ...( challenge instanceof PlaceThePoints ? {
      points: [ challenge.p1Property, challenge.p2Property, challenge.p3Property ].map( point => [ point.value.x, point.value.y ] )
    } : {} )
  };
}

function axisRange( input: unknown ): Range {
  const [ min, max ] = tuple( input, 2, true );
  if ( min >= max ) { throw new Error( 'Invalid challenge graph range.' ); }
  return new Range( min, max );
}

function readPoint( input: unknown ): Vector2 {
  const [ x, y ] = tuple( input, 2 );
  return new Vector2( x, y );
}

function restoreChallenge( input: unknown ): Challenge {
  const state = object( input );
  const form = EquationForm.enumeration.values.find( value => value.name === state.form );
  const mode = ManipulationMode.enumeration.values.find( value => value.name === state.mode );
  const { kind, answerVisible, tools } = state;
  if ( !form || !mode || !Array.isArray( tools ) || tools.length !== 2 || typeof answerVisible !== 'boolean' ||
       ( kind !== 'points' && kind !== 'equation' && kind !== 'graph' ) ||
       ( ( kind === 'points' ) !== ( mode === ManipulationMode.THREE_POINTS ) ) ) {
    throw new Error( 'Invalid line game challenge.' );
  }
  const xRange = axisRange( state.xRange );
  const yRange = axisRange( state.yRange );
  const answer = line( state.answer, LineGameConstants.ANSWER_COLOR );
  const guess = state.guess === null ? new NotALine() : line( state.guess, LineGameConstants.GUESS_COLOR );
  const challenge = kind === 'points' ? new PlaceThePoints( '', answer, form, xRange, yRange ) :
                    kind === 'equation' ? new MakeTheEquation( '', answer, form, mode, xRange, yRange ) :
                    new GraphTheLine( '', answer, form, mode, xRange, yRange );
  if ( challenge instanceof PlaceThePoints ) {
    if ( !Array.isArray( state.points ) || state.points.length !== 3 ) { throw new Error( 'Invalid challenge points.' ); }
    const points = state.points.map( readPoint );
    if ( points.some( ( point, i ) => !challenge.graph.contains( point ) || points.slice( 0, i ).some( p => p.equals( point ) ) ) ) {
      throw new Error( 'Challenge points must be distinct and within the graph.' );
    }
    // Move the first two points out of each other's way before moving to their final positions.
    challenge.p1Property.value = new Vector2( xRange.min - 1, yRange.min );
    challenge.p2Property.value = points[ 1 ];
    challenge.p1Property.value = points[ 0 ];
    challenge.p3Property.value = points[ 2 ];
  }
  else {
    if ( !( guess instanceof Line ) ) { throw new Error( 'Missing line guess.' ); }
    challenge.guessProperty.value = guess;
  }
  challenge.setAnswerVisible( answerVisible );
  challenge.pointTool1.positionProperty.value = readPoint( tools[ 0 ] );
  challenge.pointTool2.positionProperty.value = readPoint( tools[ 1 ] );
  return challenge;
}

function gameState( screen: AnyScreen, model: BaseGameModel ) {
  const fields = {
    level: number( model.levelProperty, true, value => value >= 0 && value < model.numberOfLevels ),
    sound: boolean( model.soundEnabledProperty ),
    timer: boolean( model.timerEnabledProperty ),
    score: number( model.scoreProperty, true, value => value >= 0 && value <= model.getPerfectScore() ),
    elapsed: number( model.timer.elapsedTimeProperty, true, value => value >= 0 ),
    ...Object.fromEntries( model.bestScoreProperties.map( ( property, i ) => [
      `bestScore${i}`, number( property, true, value => value >= 0 && value <= model.getPerfectScore() )
    ] ) ),
    ...Object.fromEntries( model.bestTimeProperties.map( ( property, i ) => [
      `bestTime${i}`, field( property, value => value, value => value === null ||
        ( typeof value === 'number' && Number.isInteger( value ) && value >= 0 ) ? value : undefined )
    ] ) )
  };
  return {
    isPlaying: () => model.timer.isRunning,
    read: () => ( {
      ...readFields( fields ),
      phase: model.gamePhaseProperty.value.name,
      playState: model.playStateProperty.value.name,
      running: model.timer.isRunning,
      newBestTime: model.isNewBestTime,
      index: model.gamePhaseProperty.value === GamePhase.SETTINGS ? -1 : model.challengeIndexProperty.value,
      challenges: model.gamePhaseProperty.value === GamePhase.SETTINGS ? [] : model.challenges.map( readChallenge )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const phase = GamePhase.enumeration.values.find( value => value.name === state.phase );
      const playState = PlayState.enumeration.values.find( value => value.name === state.playState );
      const { running, newBestTime } = state;
      if ( !phase || !playState || typeof running !== 'boolean' || typeof newBestTime !== 'boolean' ||
           !Array.isArray( state.challenges ) ||
           state.challenges.length !== ( phase === GamePhase.SETTINGS ? 0 : model.challengesPerGameProperty.value ) ||
           ( phase === GamePhase.PLAY ? playState === PlayState.NONE : playState !== PlayState.NONE || running ) ) {
        throw new Error( 'Invalid line game state.' );
      }
      const challenges = state.challenges.map( restoreChallenge );
      const index = bounded( state.index, phase === GamePhase.SETTINGS ? -1 : 0, challenges.length - 1, true );
      return () => {
        screen.view.interruptSubtreeInput();
        model.setGamePhase( GamePhase.SETTINGS );
        model.timer.stop();
        if ( phase === GamePhase.PLAY && running ) { model.timer.start(); }
        apply();
        model.isNewBestTime = newBestTime;
        if ( challenges.length ) {
          model.challenges = challenges;
          // FIRST_CHECK normally advances to the next challenge.
          model.challengeIndexProperty.value = playState === PlayState.FIRST_CHECK ? index - 1 : index;
          model.challengeProperty.value = challenges[ index ];
          model.playStateProperty.value = playState;
          model.challengeIndexProperty.value = index;
        }
        model.gamePhaseProperty.value = phase;
      };
    }
  };
}

export default function installGraphingLinesState( sim: Sim, id: string, version: string, ids: string[] ): void {
  installSimulationBridge( sim, () => ( {
    bridge: `webwriter-${id}/v1`,
    build: `${id}@${version}-webwriter.1`,
    screens: sim.simScreens.map( ( screen, i ) => ( {
      id: ids[ i ], screen,
      ...( screen.model instanceof BaseGameModel ? gameState( screen, screen.model ) : formsState( screen ) )
    } ) )
  } ) );
}
