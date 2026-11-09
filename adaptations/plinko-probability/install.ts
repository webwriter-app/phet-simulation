// Plinko Probability WebWriter adapter. Distributed under GPL-3.0.
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import QueryParameters from '../common/PlinkoProbabilityQueryParameters.js';
import type Ball from '../common/model/Ball.js';
import BallPhase from '../common/model/BallPhase.js';
import type PlinkoProbabilityCommonView from '../common/view/PlinkoProbabilityCommonView.js';
import IntroBall from '../intro/model/IntroBall.js';
import IntroModel from '../intro/model/IntroModel.js';
import LabBall from '../lab/model/LabBall.js';
import type LabModel from '../lab/model/LabModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields } from './stateFields.js';

function finite( value: unknown ): number {
  if ( typeof value !== 'number' || !Number.isFinite( value ) ) { throw new Error( 'Invalid Plinko number.' ); }
  return value;
}

function integer( input: unknown, min: number, max: number ): number {
  const value = finite( input );
  if ( !Number.isInteger( value ) || value < min || value > max ) { throw new Error( 'Invalid Plinko count.' ); }
  return value;
}

function direction( value: unknown ): 'left' | 'right' {
  if ( value !== 'left' && value !== 'right' ) { throw new Error( 'Invalid Plinko direction.' ); }
  return value;
}

function readBall( ball: Ball ) {
  return {
    phase: ball.phase, row: ball.row, direction: ball.direction, fallenRatio: ball.fallenRatio,
    position: [ ball.position.x, ball.position.y ],
    pegPosition: [ ball.pegPositionX ?? null, ball.pegPositionY ?? null ],
    remainingPegs: ball.pegHistory.map( peg => ( { ...peg } ) ),
    bin: ball.binIndex, binCount: ball.binCount,
    horizontalOffset: ball.finalBinHorizontalOffset, verticalOffset: ball.finalBinVerticalOffset,
    orientation: ball instanceof IntroBall ? ball.binOrientation : 0
  };
}

function prepareBall( model: IntroModel | LabModel, rows: number, input: unknown ) {
  const state = object( input );
  if ( !Array.isArray( state.position ) || state.position.length !== 2 ||
       !Array.isArray( state.pegPosition ) || state.pegPosition.length !== 2 ||
       !Array.isArray( state.remainingPegs ) || state.remainingPegs.length > rows + 1 ) {
    throw new Error( 'Invalid Plinko ball path.' );
  }
  const phase = integer( state.phase, BallPhase.INITIAL, BallPhase.COLLECTED );
  const row = integer( state.row, 0, rows );
  const path = state.remainingPegs.map( item => {
    const peg = object( item );
    return {
      rowNumber: integer( peg.rowNumber, 0, rows ),
      positionX: finite( peg.positionX ),
      positionY: finite( peg.positionY ),
      direction: direction( peg.direction )
    };
  } );
  if ( ( phase === BallPhase.INITIAL && path.length !== rows + 1 ) ||
       ( phase === BallPhase.FALLING && path.length !== rows - row ) ) {
    throw new Error( 'Invalid Plinko ball phase.' );
  }
  const [ x, y ] = state.position.map( finite );
  const [ pegX, pegY ] = state.pegPosition.map( item => item === null ? undefined : finite( item ) );
  const ballDirection = direction( state.direction );
  const fallenRatio = finite( state.fallenRatio );
  const bin = integer( state.bin, 0, rows );
  const binCount = integer( state.binCount, 1, Number.MAX_SAFE_INTEGER );
  const horizontalOffset = finite( state.horizontalOffset );
  const verticalOffset = finite( state.verticalOffset );
  const orientation = integer( state.orientation, -1, 1 );
  return () => {
    const probability = model.probabilityProperty.value;
    const bins = model.histogram.bins;
    const ball = model instanceof IntroModel ? new IntroBall( probability, rows, bins, model.cylinderInfo ) :
                 new LabBall( probability, rows, bins );
    ball.phase = phase;
    ball.row = row;
    ball.direction = ballDirection;
    ball.fallenRatio = fallenRatio;
    ball.position.setXY( x, y );
    ball.pegPositionX = pegX!;
    ball.pegPositionY = pegY!;
    ball.pegHistory = path;
    ball.binIndex = bin;
    ball.binCount = binCount;
    ball.finalBinHorizontalOffset = horizontalOffset;
    ball.finalBinVerticalOffset = verticalOffset;
    if ( ball instanceof IntroBall ) { ball.binOrientation = orientation; }
    if ( phase < BallPhase.EXITED ) {
      const landed = () => {
        model.histogram.addBallToHistogram( ball );
        ball.ballOutOfPegsEmitter.removeListener( landed );
      };
      ball.ballOutOfPegsEmitter.addListener( landed );
    }
    if ( !( model instanceof IntroModel ) && phase < BallPhase.COLLECTED ) {
      const collected = () => {
        const index = model.balls.indexOf( ball );
        if ( index > 0 ) { model.balls.remove( model.balls[ index - 1 ] ); }
        ball.ballCollectedEmitter.removeListener( collected );
      };
      ball.ballCollectedEmitter.addListener( collected );
    }
    model.balls.push( ball );
  };
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as IntroModel | LabModel;
  const view = ( screen.view as PlinkoProbabilityCommonView ).viewProperties;
  const fields: Parameters<typeof readFields>[ 0 ] = {
    rows: number( model.numberOfRowsProperty, true ),
    probability: number( model.probabilityProperty ),
    ballMode: enumeration( model.ballModeProperty ),
    hopperMode: enumeration( model.hopperModeProperty ),
    histogramMode: enumeration( view.histogramModeProperty ),
    showTheoretical: boolean( view.isTheoreticalHistogramVisibleProperty ),
    histogramExpanded: boolean( view.expandedAccordionBoxProperty ),
    sound: boolean( view.isSoundEnabledProperty ),
    ballCap: boolean( model.isBallCapReachedProperty )
  };
  if ( !( model instanceof IntroModel ) ) { fields.playing = boolean( model.isPlayingProperty ); }
  return {
    isPlaying: () => ( model instanceof IntroModel ? model.ballsToCreateNumber > 0 : model.isPlayingProperty.value ) ||
      model.balls.some( ( ball: Ball ) => ball.phase !== BallPhase.COLLECTED ),
    read: () => ( {
      ...readFields( fields ),
      bins: model.histogram.bins.slice( 0, model.numberOfRowsProperty.value + 1 ).map( bin => ( { ...bin } ) ),
      balls: model.balls.map( readBall ),
      elapsed: Math.min( model.ballCreationTimeElapsed, 0.2 ),
      queued: model instanceof IntroModel ? model.ballsToCreateNumber : 0,
      launched: model instanceof IntroModel ? model.launchedBallsNumber : 0
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const rows = state.rows as number;
      if ( !Array.isArray( state.bins ) || state.bins.length !== rows + 1 ||
           !Array.isArray( state.balls ) || state.balls.length > Math.max( 200, QueryParameters.maxBallsIntro ) ) {
        throw new Error( 'Invalid Plinko histogram.' );
      }
      const bins = state.bins.map( item => {
        const bin = object( item );
        const binCount = integer( bin.binCount, 0, Number.MAX_SAFE_INTEGER );
        return {
          binCount, visibleBinCount: integer( bin.visibleBinCount, 0, binCount ),
          orientation: integer( bin.orientation, -1, 1 )
        };
      } );
      const elapsed = finite( state.elapsed );
      const queued = integer( state.queued, 0, QueryParameters.maxBallsIntro * 2 );
      const launched = integer( state.launched, 0, QueryParameters.maxBallsIntro );
      const balls = state.balls.map( item => prepareBall( model, rows, item ) );
      return () => {
        screen.view.interruptSubtreeInput();
        model.erase();
        apply();
        model.histogram.bins.splice( 0, bins.length, ...bins );
        const histogram = model.histogram;
        const total = bins.reduce( ( count, bin ) => count + bin.visibleBinCount, 0 );
        const sum = bins.reduce( ( sum, bin, index ) => sum + index * bin.visibleBinCount, 0 );
        const squares = bins.reduce( ( sum, bin, index ) => sum + index * index * bin.visibleBinCount, 0 );
        histogram.landedBallsNumber = total;
        histogram.average = total > 0 ? sum / total : 0;
        histogram.sumOfSquares = squares;
        histogram.variance = total > 1 ? Math.max( 0, ( squares - total * histogram.average ** 2 ) / ( total - 1 ) ) : 0;
        histogram.standardDeviation = Math.sqrt( histogram.variance );
        histogram.standardDeviationOfMean = total > 0 ? histogram.standardDeviation / Math.sqrt( total ) : 0;
        model.ballCreationTimeElapsed = elapsed;
        if ( model instanceof IntroModel ) {
          model.ballsToCreateNumber = queued;
          model.launchedBallsNumber = launched;
        }
        balls.forEach( restore => restore() );
        histogram.histogramUpdatedEmitter.emit();
        model.ballsMovedEmitter.emit();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'intro', 'lab' ];
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-plinko-probability/v1',
    build: 'plinko-probability@1.2.0-dev.6-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: ids[ index ], screen, ...screenState( screen ) } ) )
  } ) );
}
