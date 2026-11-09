// Collision Lab WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Ball from '../common/model/Ball.js';
import BallState from '../common/model/BallState.js';
import type CollisionLabModel from '../common/model/CollisionLabModel.js';
import type CollisionLabPath from '../common/model/CollisionLabPath.js';
import PathDataPoint from '../common/model/PathDataPoint.js';
import type CollisionLabCheckbox from '../common/view/CollisionLabCheckbox.js';
import CollisionLabControlPanel from '../common/view/CollisionLabControlPanel.js';
import MoreDataCheckbox from '../common/view/MoreDataCheckbox.js';
import type InelasticBallSystem from '../inelastic/model/InelasticBallSystem.js';
import type InelasticCollisionEngine from '../inelastic/model/InelasticCollisionEngine.js';
import type InelasticPlayArea from '../inelastic/model/InelasticPlayArea.js';
import type IntroBallSystem from '../intro/model/IntroBallSystem.js';
import InelasticCollisionType from '../inelastic/model/InelasticCollisionType.js';
import InelasticModel from '../inelastic/model/InelasticModel.js';
import InelasticPreset from '../inelastic/model/InelasticPreset.js';
import RotatingBallCluster from '../inelastic/model/RotatingBallCluster.js';
import IntroModel from '../intro/model/IntroModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

function coordinates( point: Vector2 ): number[] {
  return [ point.x, point.y ];
}

function vector( value: unknown ): Vector2 {
  if ( !Array.isArray( value ) || value.length !== 2 ||
       !value.every( coordinate => Number.isFinite( coordinate ) && Math.abs( coordinate ) <= 1e9 ) ) {
    throw new Error( 'Invalid Collision Lab vector.' );
  }
  return new Vector2( value[ 0 ], value[ 1 ] );
}

function scalar( value: unknown, min: number, max: number ): number {
  if ( typeof value !== 'number' || !Number.isFinite( value ) || value < min || value > max ) {
    throw new Error( 'Invalid Collision Lab number.' );
  }
  return value;
}

function readPath( path: CollisionLabPath ) {
  return path.dataPoints.slice( -1200 ).map( point => [ point.time, ...coordinates( point.position ) ] );
}

function preparePath( path: CollisionLabPath, input: unknown ) {
  if ( !Array.isArray( input ) || input.length > 1200 ) {
    throw new Error( 'Invalid Collision Lab path.' );
  }
  let lastTime = -1;
  const points = input.map( entry => {
    if ( !Array.isArray( entry ) || entry.length !== 3 ) { throw new Error( 'Invalid path point.' ); }
    const time = scalar( entry[ 0 ], 0, 1e9 );
    if ( time <= lastTime ) { throw new Error( 'Invalid path chronology.' ); }
    lastTime = time;
    return new PathDataPoint( time, vector( entry.slice( 1 ) ) );
  } );
  return () => {
    path.dataPoints.splice( 0, path.dataPoints.length, ...points );
    path.pathChangedEmitter.emit();
  };
}

function readBallState( state: BallState ) {
  return { position: coordinates( state.position ), velocity: coordinates( state.velocity ), mass: state.mass };
}

function ballState( ball: Ball ) {
  const rotation = { rotation: number( ball.rotationProperty ) };
  return {
    read: () => ( {
      ...readFields( rotation ),
      current: readBallState( new BallState( ball.positionProperty.value, ball.velocityProperty.value, ball.massProperty.value ) ),
      restart: readBallState( ball.restartState ),
      path: readPath( ball.path )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyRotation = prepareFields( rotation, state );
      const readBall = ( input: unknown ) => {
        const state = object( input );
        const { min, max } = ball.massProperty.range;
        return new BallState( vector( state.position ), vector( state.velocity ), scalar( state.mass, min, max ) );
      };
      const current = readBall( state.current );
      const restart = readBall( state.restart );
      const applyPath = preparePath( ball.path, state.path );
      return () => {
        ball.setState( current );
        ball.restartState = restart;
        applyRotation();
        applyPath();
      };
    }
  };
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as CollisionLabModel;
  const system = model.ballSystem;
  const area = model.playArea;
  const inelastic = model instanceof InelasticModel ? {
    playArea: model.playArea as InelasticPlayArea,
    ballSystem: model.ballSystem as InelasticBallSystem,
    collisionEngine: model.collisionEngine as InelasticCollisionEngine
  } : null;
  const intro = model instanceof IntroModel ? model.ballSystem as IntroBallSystem : null;
  const panel = screen.view.children.find( node => node instanceof CollisionLabControlPanel ) as CollisionLabControlPanel;
  const moreData = screen.view.children.find( node => node instanceof MoreDataCheckbox ) as MoreDataCheckbox;
  const boxes = panel.contentNode.children as CollisionLabCheckbox[];
  const centerOfMassIndex = boxes.indexOf( panel.centerOfMassCheckbox );
  const controls = {
    quantity: number( system.numberOfBallsProperty, true ),
    constantSize: boolean( system.ballsConstantSizeProperty ),
    paths: boolean( system.pathsVisibleProperty ),
    centerOfMass: boolean( system.centerOfMassVisibleProperty ),
    reflectingBorder: boolean( area.reflectingBorderProperty ),
    grid: boolean( area.gridVisibleProperty ),
    elasticity: number( area.elasticityPercentProperty ),
    momentumDiagram: boolean( model.momentaDiagram.expandedProperty ),
    momentumZoom: number( model.momentaDiagram.zoomProperty ),
    speed: enumeration( model.timeSpeedProperty ),
    velocityVectors: boolean( boxes[ 0 ].property ),
    momentumVectors: boolean( boxes[ 1 ].property ),
    kineticEnergy: boolean( boxes[ centerOfMassIndex + 1 ].property ),
    values: boolean( boxes[ centerOfMassIndex + 2 ].property ),
    moreData: boolean( moreData.property ),
    ...( intro ? { changeInMomentum: boolean( intro.changeInMomentumVisibleProperty ) } : {} ),
    ...( inelastic ? {
      collisionType: field( inelastic.playArea.inelasticCollisionTypeProperty, value => String( value ), value =>
        InelasticCollisionType.VALUES.find( item => String( item ) === value ) ),
      preset: field( inelastic.ballSystem.inelasticPresetProperty, value => String( value ), value =>
        InelasticPreset.VALUES.find( item => String( item ) === value ) )
    } : {} )
  };
  const playback = { playing: boolean( model.isPlayingProperty ), time: number( model.elapsedTimeProperty, false, value => value >= 0 ) };
  const balls = system.prepopulatedBalls.map( ballState );
  const momentum = intro && {
    opacity: number( intro.changeInMomentumOpacityProperty, false, value => value >= 0 && value <= 1 )
  };
  return {
    isPlaying: () => model.isPlayingProperty.value,
    read: () => ( {
      controls: readFields( controls ),
      playback: readFields( playback ),
      balls: balls.map( ball => ball.read() ),
      centerOfMassPath: readPath( system.centerOfMass.path ),
      angularVelocity: inelastic?.collisionEngine.rotatingBallCluster?.angularVelocity ?? null,
      impulse: intro && momentum ? {
        ...readFields( momentum ),
        time: intro.collisionContactTime,
        point: intro.collisionPointProperty.value && coordinates( intro.collisionPointProperty.value ),
        changes: intro.balls.map( ball => coordinates( intro.ballToChangeInMomentumProperty.get( ball ).value ) )
      } : null
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state.controls );
      const applyPlayback = prepareFields( playback, state.playback );
      const applyCenter = preparePath( system.centerOfMass.path, state.centerOfMassPath );
      if ( !Array.isArray( state.balls ) || state.balls.length !== balls.length ) {
        throw new Error( 'Invalid Collision Lab ball count.' );
      }
      const ballInputs = state.balls;
      const applyBalls = balls.map( ( ball, index ) => ball.prepare( ballInputs[ index ] ) );
      const angularVelocity = state.angularVelocity === null ? null : scalar( state.angularVelocity, -1e6, 1e6 );
      if ( !inelastic && angularVelocity !== null ) { throw new Error( 'Unexpected rotating cluster.' ); }
      let applyImpulse: ( () => void ) | null = null;
      if ( intro && momentum ) {
        const impulse = object( state.impulse );
        const applyMomentum = prepareFields( momentum, impulse );
        const time = impulse.time === null ? null : scalar( impulse.time, 0, 1e9 );
        const point = impulse.point === null ? null : vector( impulse.point );
        if ( !Array.isArray( impulse.changes ) || impulse.changes.length !== intro.balls.length ) {
          throw new Error( 'Invalid changes in momentum.' );
        }
        const changes = impulse.changes.map( vector );
        applyImpulse = () => {
          intro.collisionContactTime = time;
          intro.collisionPointProperty.value = point;
          intro.balls.forEach( ( ball, index ) => {
            intro.ballToChangeInMomentumProperty.get( ball ).value = changes[ index ];
          } );
          applyMomentum();
        };
      }
      return () => {
        screen.view.interruptSubtreeInput();
        model.isPlayingProperty.value = false;
        applyControls();
        model.collisionEngine.reset();
        applyBalls.forEach( apply => apply() );
        applyCenter();
        if ( inelastic ) {
          inelastic.collisionEngine.rotatingBallCluster = angularVelocity === null ? null :
            new RotatingBallCluster( system.balls, angularVelocity, system.centerOfMass );
        }
        applyImpulse?.();
        applyPlayback();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'intro', 'explore-1d', 'explore-2d', 'inelastic' ];
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-collision-lab/v1',
    build: 'collision-lab@1.2.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, i ) => ( { id: ids[ i ], screen, ...screenState( screen ) } ) )
  } ) );
}
