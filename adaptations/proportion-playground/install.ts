// State adapter for PhET Proportion Playground. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import type BilliardsTable from '../common/model/billiards/BilliardsTable.js';
import PaintChoice from '../common/model/paint/PaintChoice.js';
import type ProportionModel from '../common/model/ProportionModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

function point( vector: Vector2 ) { return [ vector.x, vector.y ]; }

function vector( input: unknown, minX: number, maxX: number, minY: number, maxY: number ) {
  if ( !Array.isArray( input ) || input.length !== 2 || !input.every( Number.isFinite ) ||
       input[ 0 ] < minX || input[ 0 ] > maxX || input[ 1 ] < minY || input[ 1 ] > maxY ) {
    throw new Error( 'Invalid Proportion Playground table coordinates.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}

function readTable( table: BilliardsTable ) {
  return {
    position: point( table.ballPositionProperty.value ),
    velocity: point( table.ballVelocity ),
    started: table.hasStartedAnimating,
    collisions: table.collisionPoints.map( point )
  };
}
function prepareTable( table: BilliardsTable, input: unknown, width: number, length: number ) {
  const data = object( input );
  const epsilon = 1e-8;
  const speed = 1.5 * Math.hypot( width, length );
  const position = vector( data.position, -epsilon, width + epsilon, -epsilon, length + epsilon );
  const velocity = vector( data.velocity, -speed - epsilon, speed + epsilon, -speed - epsilon, speed + epsilon );
  const stopped = velocity.magnitude === 0;
  if ( typeof data.started !== 'boolean' || !Array.isArray( data.collisions ) ||
       data.collisions.length < 1 || data.collisions.length > 2 * ( width + length ) + 1 ||
       !stopped && ( Math.abs( Math.abs( velocity.x ) - speed ) > epsilon || Math.abs( Math.abs( velocity.y ) - speed ) > epsilon ) ) {
    throw new Error( 'Invalid Proportion Playground billiards path.' );
  }
  const collisions = data.collisions.map( input => {
    const collision = vector( input, 0, width, 0, length );
    if ( !Number.isInteger( collision.x ) || !Number.isInteger( collision.y ) ||
         ( collision.x !== 0 && collision.x !== width && collision.y !== 0 && collision.y !== length ) ) {
      throw new Error( 'Invalid Proportion Playground billiards bounce.' );
    }
    return collision;
  } );
  const started = data.started;
  return () => {
    table.restartBall();
    table.collisionPoints.clear();
    collisions.forEach( point => table.collisionPoints.push( point ) );
    table.ballPositionProperty.value = position;
    table.ballVelocity.set( velocity );
    table.hasStartedAnimating = started;
  };
}

function bindScreen( screen: AnyScreen ) {
  const model = screen.model as ProportionModel;
  const scenes = [ model.necklaceScene, model.paintScene, model.billiardsScene, model.appleScene ];
  const ids = [ 'necklace', 'paint', 'billiards', 'apples' ];
  const active = field( model.sceneProperty, value => ids[ scenes.indexOf( value ) ],
    input => typeof input === 'string' ? scenes[ ids.indexOf( input ) ] : undefined );
  const tables = [ model.billiardsScene.leftTable, model.billiardsScene.rightTable ];
  const quantities = [ 'firstLeft', 'secondLeft', 'firstRight', 'secondRight' ];
  const bindings = scenes.map( ( scene, i ) => ( {
    ...Object.fromEntries( quantities.map( ( name, i ) => [ name, number( scene.quantityProperties[ i ], true ) ] ) ),
    both: boolean( scene.showBothProperty ),
    controls: boolean( scene.leftControlsVisibleProperty ),
    revealed: boolean( scene.revealProperty ),
    ...( i === 1 ? {
      paint: field( model.paintScene.paintChoiceProperty, value => PaintChoice.CHOICES.indexOf( value ),
        input => typeof input === 'number' && Number.isInteger( input ) ? PaintChoice.CHOICES[ input ] : undefined )
    } : {} ),
    ...( i === 3 ? { costPerApple: boolean( model.appleScene.showCostPerAppleProperty ) } : {} )
  } ) );
  return {
    id: model.predictMode ? 'predict' : 'explore',
    screen,
    isPlaying: () => model.sceneProperty.value === model.billiardsScene && model.billiardsScene.revealProperty.value &&
      ( tables[ 0 ].ballVelocity.magnitude > 0 || ( model.billiardsScene.showBothProperty.value || tables[ 1 ].hasStartedAnimating ) &&
        tables[ 1 ].ballVelocity.magnitude > 0 ),
    read: () => ( {
      scene: active.read(), scenes: Object.fromEntries( ids.map( ( id, i ) => [ id, readFields( bindings[ i ] ) ] ) ),
      tables: tables.map( readTable )
    } ),
    prepare: ( input: unknown ) => {
      const data = object( input );
      const values = object( data.scenes );
      const applyActive = active.prepare( data.scene, 'scene' );
      const applyScenes = ids.map( ( id, i ) => prepareFields( bindings[ i ], values[ id ] ) );
      const billiards = object( values.billiards );
      const saved = data.tables;
      if ( !Array.isArray( saved ) || saved.length !== tables.length ) { throw new Error( 'Invalid Proportion Playground tables.' ); }
      const applyTables = tables.map( ( table, i ) =>
        prepareTable( table, saved[ i ], billiards[ quantities[ 2 * i + 1 ] ] as number, billiards[ quantities[ 2 * i ] ] as number ) );
      return () => {
        screen.view.interruptSubtreeInput();
        applyScenes.forEach( apply => apply() );
        applyTables.forEach( apply => apply() );
        applyActive();
      };
    }
  };
}

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-proportion-playground/v1',
    build: 'proportion-playground@1.1.0-dev.3-webwriter.1',
    screens: sim.simScreens.map( bindScreen )
  } ) );
}
