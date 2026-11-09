// State adapter for PhET My Solar System. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import SolarSystemCommonConstants from '../../../solar-system-common/js/SolarSystemCommonConstants.js';
import BodyInfo from '../../../solar-system-common/js/model/BodyInfo.js';
import type MySolarSystemModel from '../common/model/MySolarSystemModel.js';
import type MySolarSystemScreenView from '../common/view/MySolarSystemScreenView.js';
import LabModel from '../lab/model/LabModel.js';
import OrbitalSystem from '../lab/model/OrbitalSystem.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, enumeration, number, object, prepareFields, readFields, vector } from './stateFields.js';

function readVector( point: Vector2 ) { return [ point.x, point.y ]; }

function point( input: unknown ) {
  if ( !Array.isArray( input ) || input.length !== 2 || !input.every( value => Number.isFinite( value ) && Math.abs( value ) <= 1e12 ) ) {
    throw new Error( 'Invalid My Solar System coordinates.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}

function readBody( body: BodyInfo ) {
  return { active: body.isActive, mass: body.mass, position: readVector( body.position ), velocity: readVector( body.velocity ) };
}

function bindScreen( screen: AnyScreen ) {
  const model = screen.model as MySolarSystemModel;
  const view = screen.view as MySolarSystemScreenView;
  const lab = model instanceof LabModel ? model : null;
  const visible = view.visibleProperties;
  const controls = {
    ...( lab ? { orbitalSystem: field( lab.orbitalSystemProperty, String, input =>
      lab.orbitalSystemProperty.validValues?.find( value => String( value ) === input && !value.isPhetioConfigurable ) ) } : {} ),
    zoom: number( model.zoomLevelProperty, true ),
    timeSpeed: enumeration( model.timeSpeedProperty ),
    gravityScale: number( model.gravityForceScalePowerProperty ),
    speed: boolean( visible.speedVisibleProperty ),
    velocity: boolean( visible.velocityVisibleProperty ),
    gravity: boolean( visible.gravityVisibleProperty ),
    path: boolean( visible.pathVisibleProperty ),
    grid: boolean( visible.gridVisibleProperty ),
    measuringTape: boolean( visible.measuringTapeVisibleProperty ),
    tapeBase: vector( model.measuringTape.basePositionProperty ),
    tapeTip: vector( model.measuringTape.tipPositionProperty ),
    centerOfMass: boolean( visible.centerOfMassVisibleProperty ),
    ...( lab ? { moreData: boolean( visible.moreDataVisibleProperty ) } : {} )
  };
  const timing = {
    time: number( model.timeProperty, false, value => value >= 0 ),
    played: boolean( model.hasPlayedProperty ),
    collided: boolean( model.isAnyBodyCollidedProperty ),
    playing: boolean( model.isPlayingProperty )
  };
  const starting = model[ 'startingBodyInfoProperty' ];
  const readBodies = ( input: unknown ) => {
    if ( !Array.isArray( input ) || input.length !== model.bodies.length ) { throw new Error( 'Invalid My Solar System bodies.' ); }
    const bodies = input.map( ( item, index ) => {
      const { active, mass, position, velocity } = object( item );
      const range = model.bodies[ index ].massProperty.range;
      if ( typeof active !== 'boolean' || typeof mass !== 'number' || !Number.isFinite( mass ) || mass <= 0 || !range.contains( mass ) ) {
        throw new Error( 'Invalid My Solar System body.' );
      }
      return new BodyInfo( { isActive: active, mass, position: point( position ), velocity: point( velocity ) } );
    } );
    const active = bodies.filter( body => body.isActive );
    if ( active.length === 0 || active.some( ( body, index ) =>
      active.slice( index + 1 ).some( other => body.position.distance( other.position ) <= 1e-9 ) ) ) {
      throw new Error( 'Invalid My Solar System arrangement.' );
    }
    return bodies;
  };
  return {
    id: lab ? 'lab' : 'intro',
    screen,
    isPlaying: () => model.isPlayingProperty.value,
    read: () => ( {
      ...readFields( controls ),
      ...readFields( timing ),
      starting: starting.value.map( readBody ),
      bodies: model.bodies.map( body => readBody( body.getBodyInfo() ) ),
      paths: model.bodies.map( body => body.pathPoints.map( readVector ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state );
      const applyTiming = prepareFields( timing, state );
      const first = readBodies( state.starting );
      const current = readBodies( state.bodies );
      if ( !Array.isArray( state.paths ) || state.paths.length !== current.length ) { throw new Error( 'Invalid orbit paths.' ); }
      const paths = state.paths.map( ( path, index ) => {
        if ( !Array.isArray( path ) || path.length > SolarSystemCommonConstants.MAX_PATH_POINTS ||
             ( path.length > 0 && ( !state.path || !current[ index ].isActive ) ) ) {
          throw new Error( 'Invalid orbit path.' );
        }
        return path.map( point );
      } );
      return () => {
        view.interruptSubtreeInput();
        model.isPlayingProperty.value = false;
        // Selecting a preset resets the orbit, so do that before applying either body configuration.
        if ( lab ) { lab.orbitalSystemProperty.value = OrbitalSystem.CUSTOM; }
        applyControls();
        model.loadBodyInfo( first );
        model.bodies.forEach( ( body, index ) => {
          if ( current[ index ].isActive ) { body.isActiveProperty.value = true; }
        } );
        model.bodies.forEach( ( body, index ) => {
          const info = current[ index ];
          body.isActiveProperty.value = info.isActive;
          body.massProperty.value = info.mass;
          body.positionProperty.value = info.position;
          body.velocityProperty.value = info.velocity;
        } );
        model.update();
        starting.value = first;
        applyTiming();
        model.bodies.forEach( ( body, index ) => {
          body.clearPath();
          let length = 0;
          paths[ index ].forEach( ( position, i, path ) => {
            body.pathPoints.push( position );
            if ( i > 0 ) { length += position.distance( path[ i - 1 ] ); }
          } );
          body[ 'pathLengthProperty' ].value = length;
        } );
      };
    }
  };
}

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-my-solar-system/v1',
    build: 'my-solar-system@1.4.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( bindScreen )
  } ) );
}
