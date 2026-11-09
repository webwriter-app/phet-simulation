// Forces and Motion: Basics WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Sim from '../../../joist/js/Sim.js';
import MotionConstants from '../motion/MotionConstants.js';
import MotionModel from '../motion/model/MotionModel.js';
import ForcesAndMotionBasicsPreferences from '../netforce/model/ForcesAndMotionBasicsPreferences.js';
import NetForceModel from '../netforce/model/NetForceModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields, vector } from './stateFields.js';

const screenIds = [ 'net-force', 'motion', 'friction', 'acceleration' ];

function tugOfWar( screen: AnyScreen, model: NetForceModel ) {
  const fields = {
    started: boolean( model.hasStartedProperty ),
    phase: enumeration( model.stateProperty ),
    duration: number( model[ 'durationProperty' ], false, value => value >= 0 ),
    sumOfForces: boolean( model.showSumOfForcesProperty ),
    values: boolean( model.showValuesProperty ),
    showSpeed: boolean( model.showSpeedProperty ),
    position: number( model.cart.positionProperty ),
    velocity: number( model.cart.velocityProperty )
  };
  const playback = { running: boolean( model.isRunningProperty ) };
  return {
    isPlaying: () => model.isRunningProperty.value,
    read: () => ( {
      ...readFields( fields ),
      ...readFields( playback ),
      pullers: model.pullers.map( puller => {
        const mode = puller[ 'grabOrigin' ]?.mode ?? puller.modeProperty.value;
        const knot = mode.getKnot( model );
        return knot ? model.knots.indexOf( knot ) : null;
      } )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const applyPlayback = prepareFields( playback, state );
      const occupied = new Set<number>();
      if ( !Array.isArray( state.pullers ) || state.pullers.length !== model.pullers.length ||
           state.running && ( !state.started || state.phase !== 'experimenting' ) ||
           state.phase === 'completed' && ( Math.abs( state.position as number ) !== model.gameLength || state.velocity !== 0 ) ) {
        throw new Error( 'Invalid tug-of-war state.' );
      }
      const knots = state.pullers.map( ( value, i ) => {
        if ( value === null ) { return null; }
        if ( typeof value !== 'number' || !Number.isInteger( value ) ||
             model.knots[ value ]?.type !== model.pullers[ i ].type || occupied.has( value ) ) {
          throw new Error( 'Invalid tug-of-war knot placement.' );
        }
        occupied.add( value );
        return model.knots[ value ];
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        model.reset();
        apply();
        model.knots.forEach( knot => { knot.positionProperty.value = knot.initX + model.cart.positionProperty.value; } );
        model.pullers.forEach( ( puller, i ) => {
          const knot = knots[ i ];
          if ( knot ) { puller.dropAtKnot( knot ); }
        } );
        model.speedProperty.value = Math.abs( model.cart.velocityProperty.value );
        applyPlayback();
      };
    }
  };
}

function motion( screen: AnyScreen, model: MotionModel ) {
  const controls = {
    force: boolean( model.showForceProperty ),
    forceValues: boolean( model.showValuesProperty ),
    sumOfForces: boolean( model.showSumOfForcesProperty ),
    showSpeed: boolean( model.showSpeedProperty ),
    masses: boolean( model.showMassesProperty ),
    showAcceleration: boolean( model.showAccelerationProperty ),
    friction: number( model.frictionCoefficientProperty, false, value => !model.skateboard || value === 0 )
  };
  const kinematics = {
    position: number( model.positionProperty ),
    velocity: number( model.velocityProperty, false, value => Math.abs( value ) <= MotionConstants.MAX_SPEED ),
    acceleration: number( model.accelerationProperty ),
    elapsed: number( model.timeProperty, false, value => value >= 0 ),
    speedClassification: enumeration( model.speedClassificationProperty ),
    previousSpeedClassification: enumeration( model[ 'previousSpeedClassificationProperty' ] ),
    timeSinceFallen: number( model[ 'timeSinceFallenProperty' ], false, value => value >= 0 ),
    fallenDirection: enumeration( model.fallenDirectionProperty ),
    fallen: boolean( model.fallenProperty ),
    appliedForce: number( model.appliedForceProperty ),
    pusherPosition: number( model.pusherPositionProperty )
  };
  const stopwatch = model.stopwatch;
  const timer = {
    timerVisible: boolean( stopwatch.isVisibleProperty ),
    timerPosition: vector( stopwatch.positionProperty ),
    timerRunning: boolean( stopwatch.isRunningProperty ),
    timerTime: number( stopwatch.timeProperty )
  };
  const playback = { playing: boolean( model.isPlayingProperty ) };
  const fields = { ...controls, ...kinematics, ...timer, ...playback };
  return {
    isPlaying: () => model.isPlayingProperty.value && (
      model.velocityProperty.value !== 0 || model.appliedForceProperty.value !== 0 ||
      model.fallenProperty.value || stopwatch.isVisibleProperty.value && stopwatch.isRunningProperty.value
    ),
    read: () => ( {
      ...readFields( fields ),
      stack: model.stackedItems.map( item => {
        const point = item[ 'animationState' ]?.targetPosition ?? item.positionProperty.value;
        return { item: model.items.indexOf( item ), position: [ point.x, point.y ], facing: item.directionProperty.value };
      } )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      if ( !Array.isArray( state.stack ) || state.stack.length > 3 ||
           state.stack.length === 0 && ( state.appliedForce !== 0 || state.velocity !== 0 ) ||
           state.fallen && state.appliedForce !== 0 ) {
        throw new Error( 'Invalid Forces and Motion stack.' );
      }
      const ids = new Set<number>();
      const stack = state.stack.map( entry => {
        const { item, position, facing } = object( entry );
        if ( typeof item !== 'number' || !Number.isInteger( item ) || !model.items[ item ] || ids.has( item ) ||
             !Array.isArray( position ) || position.length !== 2 || !position.every( Number.isFinite ) ||
             !screen.view.layoutBounds.dilated( 250 ).containsPoint( new Vector2( position[ 0 ], position[ 1 ] ) ) ||
             ( facing !== 'left' && facing !== 'right' ) ) {
          throw new Error( 'Invalid Forces and Motion item.' );
        }
        ids.add( item );
        return { item: model.items[ item ], position: new Vector2( position[ 0 ], position[ 1 ] ), facing: facing as 'left' | 'right' };
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        model.reset();
        model.stackedItems.clear();
        model.items.forEach( item => item.reset() );
        stack.forEach( ( { item, position } ) => {
          item.modeProperty.value = 'onStack';
          item.positionProperty.value = position;
          model.stackedItems.add( item );
        } );
        apply();
        stack.forEach( ( { item, facing } ) => { item.directionProperty.value = facing; } );
        model.speedProperty.value = Math.abs( model.velocityProperty.value );
        model.frictionForceProperty.value = model[ 'getFrictionForce' ]( model.appliedForceProperty.value );
        model[ 'sumOfForcesProperty' ].value = model.appliedForceProperty.value + model.frictionForceProperty.value;
        model.stepEmitter.emit();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const preferences = { pullerColors: enumeration( ForcesAndMotionBasicsPreferences.netForcePullerColorsProperty ) };
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-forces-and-motion-basics/v1',
    build: 'forces-and-motion-basics@2.7.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => {
      const model = screen.model as NetForceModel | MotionModel;
      return {
        id: screenIds[ index ], screen,
        ...( model instanceof NetForceModel ? tugOfWar( screen, model ) : motion( screen, model ) )
      };
    } ),
    readPreferences: () => readFields( preferences ),
    preparePreferences: input => prepareFields( preferences, input )
  } ) );
}
