// Projectile Motion WebWriter adapter. Distributed under GPL-3.0.
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import Checkbox from '../../../sun/js/Checkbox.js';
import DataPoint from '../common/model/DataPoint.js';
import type ProjectileMotionModel from '../common/model/ProjectileMotionModel.js';
import type Trajectory from '../common/model/Trajectory.js';
import type ProjectileMotionScreenView from '../common/view/ProjectileMotionScreenView.js';
import LabModel from '../lab/model/LabModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

function finite( value: unknown, min = -Infinity ): number {
  if ( typeof value !== 'number' || !Number.isFinite( value ) || value < min ) {
    throw new Error( 'Invalid Projectile Motion number.' );
  }
  return value;
}

function flag( value: unknown ): boolean {
  if ( typeof value !== 'boolean' ) { throw new Error( 'Invalid Projectile Motion flag.' ); }
  return value;
}

function point( input: unknown ): DataPoint {
  const state = object( input );
  const xy = ( input: unknown ) => {
    const value = object( input );
    return { x: finite( value.x ), y: finite( value.y ) };
  };
  const time = finite( state.time, 0 );
  const position = xy( state.position );
  if ( time === 0 && position.x !== 0 ) { throw new Error( 'Invalid Projectile Motion starting point.' ); }
  return DataPoint.DataPointIO.fromStateObject( {
    time, position,
    airDensity: finite( state.airDensity, 0 ),
    velocity: xy( state.velocity ),
    acceleration: xy( state.acceleration ),
    dragForce: xy( state.dragForce ),
    forceGravity: finite( state.forceGravity ),
    apex: flag( state.apex ),
    reachedGround: flag( state.reachedGround )
  } );
}

function readTrajectory( trajectory: Trajectory ) {
  return {
    type: trajectory.projectileObjectType.benchmark,
    mass: trajectory[ 'mass' ],
    diameter: trajectory.diameter,
    dragCoefficient: trajectory.dragCoefficient,
    initialSpeed: trajectory[ 'initialSpeed' ],
    initialHeight: trajectory[ 'initialHeight' ],
    initialAngle: trajectory[ 'initialAngle' ],
    rank: trajectory.rankProperty.value,
    changedInMidAir: trajectory.changedInMidAir,
    reachedGround: trajectory.reachedGround,
    maxHeight: trajectory[ 'maxHeight' ],
    horizontalDisplacement: trajectory[ 'horizontalDisplacement' ],
    flightTime: trajectory[ 'flightTime' ],
    hasHitTarget: trajectory[ 'hasHitTarget' ],
    apexIndex: trajectory.apexPoint ? trajectory.dataPoints.indexOf( trajectory.apexPoint ) : -1,
    points: trajectory.dataPoints.map( item => DataPoint.DataPointIO.toStateObject( item ) )
  };
}

function prepareTrajectory( model: ProjectileMotionModel, input: unknown ): () => void {
  const state = object( input );
  const type = model.selectedProjectileObjectTypeProperty.validValues?.find( item => item.benchmark === state.type );
  if ( !type || !Array.isArray( state.points ) || state.points.length === 0 || state.points.length > 30000 ) {
    throw new Error( 'Invalid Projectile Motion trajectory.' );
  }
  const points = state.points.map( point );
  const reachedGround = flag( state.reachedGround );
  const rank = finite( state.rank, 0 );
  if ( !Number.isInteger( rank ) || points.some( ( item, index ) => index > 0 && item.time < points[ index - 1 ].time ) ||
       points[ 0 ].time !== 0 || points[ points.length - 1 ].reachedGround !== reachedGround ) {
    throw new Error( 'Invalid Projectile Motion trajectory sequence.' );
  }
  const mass = finite( state.mass, Number.MIN_VALUE );
  const diameter = finite( state.diameter, Number.MIN_VALUE );
  const drag = finite( state.dragCoefficient, 0 );
  const speed = finite( state.initialSpeed );
  const height = finite( state.initialHeight, 0 );
  const angle = finite( state.initialAngle );
  const changedInMidAir = flag( state.changedInMidAir );
  const maxHeight = finite( state.maxHeight, 0 );
  const displacement = finite( state.horizontalDisplacement );
  const flightTime = finite( state.flightTime, 0 );
  const hit = flag( state.hasHitTarget );
  const apexIndex = finite( state.apexIndex, -1 );
  if ( !Number.isInteger( apexIndex ) || apexIndex >= points.length ||
       ( apexIndex >= 0 && !points[ apexIndex ].apex ) ) {
    throw new Error( 'Invalid Projectile Motion apex.' );
  }
  return () => {
    const trajectory = model.trajectoryGroup.createNextElement( type, mass, diameter, drag, speed, height, angle );
    const initial = trajectory.dataPoints[ 0 ];
    trajectory.dataPoints.clear();
    initial[ 'dispose' ]();
    points.forEach( item => trajectory.dataPoints.push( item ) );
    trajectory.projectileDataPointProperty.value = points[ points.length - 1 ];
    trajectory.rankProperty.value = rank;
    trajectory.changedInMidAir = changedInMidAir;
    trajectory.reachedGround = reachedGround;
    trajectory[ 'maxHeight' ] = maxHeight;
    trajectory[ 'horizontalDisplacement' ] = displacement;
    trajectory[ 'flightTime' ] = flightTime;
    trajectory[ 'hasHitTarget' ] = hit;
    trajectory.apexPoint = points[ apexIndex ] ?? null;
    if ( reachedGround ) { model.numberOfMovingProjectilesProperty.value--; }
  };
}

function checkboxes( node: Node ): Checkbox[] {
  return node.children.flatMap( child => child instanceof Checkbox ? [ child ] : checkboxes( child ) );
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as ProjectileMotionModel;
  const view = screen.view as ProjectileMotionScreenView;
  const labTypes = model instanceof LabModel ? model.objectTypes : [];
  const fields: Parameters<typeof readFields>[ 0 ] = {
    projectile: field( model.selectedProjectileObjectTypeProperty, type => type.benchmark, value =>
      model.selectedProjectileObjectTypeProperty.validValues?.find( type => type.benchmark === value ) ),
    mass: number( model.projectileMassProperty ),
    diameter: number( model.projectileDiameterProperty ),
    dragCoefficient: number( model.projectileDragCoefficientProperty ),
    cannonHeight: number( model.cannonHeightProperty ),
    cannonAngle: number( model.cannonAngleProperty ),
    launchSpeed: number( model.initialSpeedProperty ),
    speedDeviation: number( model.initialSpeedStandardDeviationProperty ),
    angleDeviation: number( model.initialAngleStandardDeviationProperty ),
    altitude: number( model.altitudeProperty ),
    gravity: number( model.gravityProperty ),
    airResistance: boolean( model.airResistanceOnProperty ),
    zoom: number( model.zoomProperty ),
    playing: boolean( model.isPlayingProperty ),
    timeSpeed: enumeration( model.timeSpeedProperty ),
    rapidFire: boolean( model.rapidFireModeProperty ),
    targetPosition: number( model.target.positionProperty ),
    tapeActive: boolean( model.measuringTape.isActiveProperty ),
    tapeBase: vector( model.measuringTape.basePositionProperty ),
    tapeTip: vector( model.measuringTape.tipPositionProperty ),
    probeActive: boolean( model.dataProbe.isActiveProperty ),
    probePosition: vector( model.dataProbe.positionProperty )
  };
  checkboxes( view[ 'bottomRightPanel' ] ).forEach( ( checkbox, index ) => {
    fields[ `vector${index}` ] = boolean( checkbox.property );
  } );
  return {
    isPlaying: () => model.isPlayingProperty.value && model.numberOfMovingProjectilesProperty.value > 0,
    read: () => ( {
      ...readFields( fields ),
      labTypes: labTypes.map( type => [ type.mass, type.diameter, type.dragCoefficient ] ),
      trajectories: Array.from( { length: model.trajectoryGroup.count }, ( _, index ) =>
        readTrajectory( model.trajectoryGroup.getElement( index ) ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      if ( !Array.isArray( state.trajectories ) || state.trajectories.length > 250 ||
           !Array.isArray( state.labTypes ) || state.labTypes.length !== labTypes.length ) {
        throw new Error( 'Invalid Projectile Motion trajectories.' );
      }
      const controls = prepareFields( fields, state );
      const types = state.labTypes.map( ( input, index ) => {
        const type = labTypes[ index ];
        if ( !Array.isArray( input ) || input.length !== 3 ||
             ![ type.massRange, type.diameterRange, type.dragCoefficientRange ].every( ( range, index ) =>
               typeof input[ index ] === 'number' && Number.isFinite( input[ index ] ) && range.contains( input[ index ] ) ) ) {
          throw new Error( 'Invalid Projectile Motion Lab object settings.' );
        }
        const [ mass, diameter, dragCoefficient ] = input;
        return () => {
          type.mass = mass;
          type.diameter = diameter;
          type.dragCoefficient = dragCoefficient;
        };
      } );
      const trajectories = state.trajectories.map( item => prepareTrajectory( model, item ) );
      return () => {
        screen.view.interruptSubtreeInput();
        model.eraseTrajectories();
        types.forEach( restore => restore() );
        controls();
        trajectories.forEach( restore => restore() );
        if ( model.dataProbe.isActiveProperty.value ) { model.dataProbe.updateData(); }
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'intro', 'vectors', 'drag', 'lab' ];
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-projectile-motion/v1',
    build: 'projectile-motion@1.1.0-dev.41-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: ids[ index ], screen, ...screenState( screen ) } ) )
  } ) );
}
