// Gravity and Orbits WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type GravityAndOrbitsScene from '../common/GravityAndOrbitsScene.js';
import type Body from '../common/model/Body.js';
import type GravityAndOrbitsModel from '../common/model/GravityAndOrbitsModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

function scalar( value: unknown, min: number, max: number ): number {
  if ( typeof value !== 'number' || !Number.isFinite( value ) || value < min || value > max ) {
    throw new Error( 'Invalid orbital quantity.' );
  }
  return value;
}

function point( input: unknown, limit = 1e16 ): Vector2 {
  if ( !Array.isArray( input ) || input.length !== 2 ) { throw new Error( 'Invalid orbital point.' ); }
  return new Vector2( scalar( input[ 0 ], -limit, limit ), scalar( input[ 1 ], -limit, limit ) );
}

function coordinates( point: Vector2 ): number[] {
  return [ point.x, point.y ];
}

function rewind<T, V>( property: { updateDifferentProperty: () => void }, encode: ( value: T ) => V, decode: ( value: unknown ) => T ) {
  const saved = property as unknown as { rewindValue: T };
  return {
    read: () => encode( saved.rewindValue ),
    prepare: ( input: unknown ) => {
      const value = decode( input );
      return () => {
        saved.rewindValue = value;
        property.updateDifferentProperty();
      };
    }
  };
}

function bodyState( body: Body ) {
  const acceleration = ( body as unknown as { accelerationProperty: { value: Vector2 } } ).accelerationProperty;
  const massRange = ( value: unknown ) => scalar( value, body.massProperty.initialValue / 100, body.massProperty.initialValue * 100 );
  const fields = {
    position: vector( body.positionProperty ),
    velocity: vector( body.velocityProperty ),
    rotation: number( body.rotationProperty ),
    mass: number( body.massProperty, false, value => value >= body.massProperty.initialValue / 100 && value <= body.massProperty.initialValue * 100 ),
    collided: boolean( body.isCollidedProperty ),
    explosionTicks: number( body.clockTicksSinceExplosionProperty, true, value => value >= 0 ),
    force: vector( body.forceProperty ),
    acceleration: vector( acceleration )
  };
  const rewinds = {
    position: rewind( body.positionProperty, coordinates, value => point( value ) ),
    velocity: rewind( body.velocityProperty, coordinates, value => point( value ) ),
    rotation: rewind( body.rotationProperty, Number, value => scalar( value, -1e12, 1e12 ) ),
    mass: rewind( body.massProperty, Number, massRange ),
    collided: rewind( body.isCollidedProperty, Boolean, value => {
      if ( typeof value !== 'boolean' ) { throw new Error( 'Invalid orbital collision state.' ); }
      return value;
    } ),
    force: rewind( body.forceProperty, coordinates, value => point( value, 1e50 ) )
  };
  return {
    read: () => ( {
      ...readFields( fields ),
      rewind: Object.fromEntries( Object.entries( rewinds ).map( ( [ key, binding ] ) => [ key, binding.read() ] ) ),
      path: body.toStateObject()
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const rewindValues = object( state.rewind );
      const applyRewind = Object.entries( rewinds ).map( ( [ key, binding ] ) => binding.prepare( rewindValues[ key ] ) );
      const trajectory = object( state.path );
      if ( !Array.isArray( trajectory.path ) || trajectory.path.length > 8000 ) { throw new Error( 'Invalid orbital path.' ); }
      const path = trajectory.path.map( value => {
        const vector = object( value );
        return { x: scalar( vector.x, -1e16, 1e16 ), y: scalar( vector.y, -1e16, 1e16 ) };
      } );
      const pathLength = scalar( trajectory.pathLength, 0, 1e16 );
      const modelPathLength = scalar( trajectory.modelPathLength, -1e12, 1e16 );
      return () => {
        apply();
        applyRewind.forEach( restore => restore() );
        body.storePreviousPosition();
        body.setStateObject( { path, pathLength, modelPathLength } );
      };
    }
  };
}

function sceneState( scene: GravityAndOrbitsScene ) {
  const clock = scene.getClock();
  const fields = {
    time: number( clock.timeProperty, false, value => value >= 0 ),
    zoom: number( scene.zoomLevelProperty, false, value => value > 0 ),
    tapeStart: vector( scene.measuringTapeStartPointProperty ),
    tapeEnd: vector( scene.measuringTapeEndPointProperty ),
    changed: boolean( ( scene as unknown as { deviatedFromDefaultsProperty: { value: boolean } } ).deviatedFromDefaultsProperty )
  };
  const rewindTime = rewind( clock.timeProperty, Number, value => scalar( value, 0, 1e16 ) );
  const bodies = scene.getBodies().map( bodyState );
  return {
    read: () => ( { ...readFields( fields ), rewindTime: rewindTime.read(), bodies: bodies.map( body => body.read() ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const applyRewindTime = rewindTime.prepare( state.rewindTime );
      if ( !Array.isArray( state.bodies ) || state.bodies.length !== bodies.length ) {
        throw new Error( 'Invalid orbital body count.' );
      }
      const bodyInputs = state.bodies;
      const applyBodies = bodies.map( ( body, index ) => body.prepare( bodyInputs[ index ] ) );
      return () => {
        applyBodies.forEach( restore => restore() );
        apply();
        applyRewindTime();
      };
    }
  };
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as GravityAndOrbitsModel;
  const scenes = model.getScenes();
  const states = scenes.map( sceneState );
  const fields = {
    scene: field( model.sceneProperty, scene => scenes.indexOf( scene ), value =>
      typeof value === 'number' && Number.isInteger( value ) ? scenes[ value ] : undefined ),
    force: boolean( model.showGravityForceProperty ),
    velocity: boolean( model.showVelocityProperty ),
    path: boolean( model.showPathProperty ),
    grid: boolean( model.showGridProperty ),
    mass: boolean( model.showMassProperty ),
    tape: boolean( model.showMeasuringTapeProperty ),
    gravity: boolean( model.gravityEnabledProperty ),
    speed: enumeration( model.timeSpeedProperty )
  };
  const playback = { playing: boolean( model.isPlayingProperty ) };
  return {
    isPlaying: () => model.isPlayingProperty.value || model.sceneProperty.value.getBodies().some( body =>
      body.isCollidedProperty.value && body.clockTicksSinceExplosionProperty.value < 60 ),
    read: () => ( { controls: readFields( fields ), playback: readFields( playback ), scenes: states.map( scene => scene.read() ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state.controls );
      const applyPlayback = prepareFields( playback, state.playback );
      if ( !Array.isArray( state.scenes ) || state.scenes.length !== states.length ) {
        throw new Error( 'Invalid orbit scene count.' );
      }
      const sceneInputs = state.scenes;
      const applyScenes = states.map( ( scene, i ) => scene.prepare( sceneInputs[ i ] ) );
      return () => {
        screen.view.interruptSubtreeInput();
        model.isPlayingProperty.value = false;
        model.rewindingProperty.value = true;
        try {
          apply();
          applyScenes.forEach( restore => restore() );
        }
        finally {
          model.rewindingProperty.value = false;
        }
        applyPlayback();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'model', 'to-scale' ];
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-gravity-and-orbits/v1',
    build: 'gravity-and-orbits@1.7.0-dev.7-webwriter.1',
    screens: sim.simScreens.map( ( screen, i ) => ( { id: ids[ i ], screen, ...screenState( screen ) } ) )
  } ) );
}
