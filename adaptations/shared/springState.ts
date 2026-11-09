// Masses and Springs family state bindings. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../Screen.js';
import MassesAndSpringsConstants from '../../../masses-and-springs/js/common/MassesAndSpringsConstants.js';
import Body from '../../../masses-and-springs/js/common/model/Body.js';
import type Mass from '../../../masses-and-springs/js/common/model/Mass.js';
import type MassesAndSpringsModel from '../../../masses-and-springs/js/common/model/MassesAndSpringsModel.js';
import type Spring from '../../../masses-and-springs/js/common/model/Spring.js';
import type OneSpringScreenView from '../../../masses-and-springs/js/common/view/OneSpringScreenView.js';
import type SpringScreenView from '../../../masses-and-springs/js/common/view/SpringScreenView.js';
import IntroModel from '../../../masses-and-springs/js/intro/model/IntroModel.js';
import LabModel from '../../../masses-and-springs/js/lab/model/LabModel.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

const gravityRange = MassesAndSpringsConstants.GRAVITY_RANGE;
const dampingRange = MassesAndSpringsConstants.DAMPING_RANGE;
const bodyNames = [ 'moon', 'earth', 'jupiter', 'planet-x', 'custom' ];

function point( input: unknown ) {
  if ( !Array.isArray( input ) || input.length !== 2 || !input.every( value =>
    typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) <= 10 ) ) {
    throw new Error( 'Invalid mass position.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}

function springParameters( spring: Spring ) {
  return {
    constant: number( spring.springConstantProperty ),
    restingLength: number( spring.naturalRestingLengthProperty ),
    thickness: number( spring.thicknessProperty, false, value => value > 0 && value <= 100 )
  };
}

function sceneParameters( model: IntroModel ) {
  const scene = model.sceneModeProperty;
  const choices = scene.validValues;
  let current = choices.indexOf( scene.value );
  const fields = model.springs.map( springParameters );
  const read = () => fields.map( readFields );
  const states = choices.map( ( _, index ) => read().map( ( state, spring ) => ( {
    ...state,
    ...( index === current || spring !== 0 ? {} : { restingLength: MassesAndSpringsConstants.DEFAULT_SPRING_LENGTH / 2 } )
  } ) ) );
  const capture = () => {
    if ( scene.value === choices[ current ] ) { states[ current ] = read(); }
  };
  model.springs.forEach( spring => {
    spring.springConstantProperty.lazyLink( capture );
    spring.naturalRestingLengthProperty.lazyLink( capture );
    spring.thicknessProperty.lazyLink( capture );
  } );
  scene.lazyLink( value => {
    current = choices.indexOf( value );
    capture();
  } );
  return {
    read: () => {
      capture();
      return states.map( spring => spring.map( fields => ( { ...fields } ) ) );
    },
    prepare: ( input: unknown ) => {
      if ( !Array.isArray( input ) || input.length !== choices.length ) { throw new Error( 'Invalid spring scenes.' ); }
      const restore = input.map( springs => {
        if ( !Array.isArray( springs ) || springs.length !== fields.length ) { throw new Error( 'Invalid spring scene.' ); }
        return fields.map( ( field, index ) => prepareFields( field, springs[ index ] ) );
      } );
      return () => {
        restore.forEach( ( states, index ) => {
          scene.value = choices[ index ];
          states.forEach( apply => apply() );
        } );
      };
    }
  };
}

function massState( mass: Mass ) {
  const fields = {
    mass: number( mass.massProperty, false, value => mass.adjustable ? value >= 0.05 && value <= 0.3 : value === mass.massProperty.initialValue ),
    velocity: number( mass.verticalVelocityProperty ),
    onShelf: boolean( mass.onShelfProperty ),
    energy: number( mass.initialTotalEnergyProperty )
  };
  return {
    read: () => ( {
      ...readFields( fields ),
      position: [ mass.positionProperty.value.x, mass.positionProperty.value.y ],
      returnAnimation: mass.isAnimatingProperty.value ? {
        start: [ mass.animationStartPosition.x, mass.animationStartPosition.y ],
        end: [ mass.animationEndPosition.x, mass.animationEndPosition.y ],
        progress: mass.animationProgress
      } : null
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const position = point( state.position );
      const animation = state.returnAnimation === null ? null : object( state.returnAnimation );
      const progress = animation?.progress;
      const start = animation && point( animation.start );
      const end = animation && point( animation.end );
      if ( animation && ( typeof progress !== 'number' || !Number.isFinite( progress ) || progress < 0 || progress >= 1 ||
           end!.x !== mass.initialPosition.x || state.onShelf ) ) {
        throw new Error( 'Invalid returning mass animation.' );
      }
      return {
        position: () => { mass.positionProperty.value = position; },
        apply: () => {
          apply();
          if ( animation ) {
            mass.animationProgress = progress;
            mass.animationStartPosition = start;
            mass.animationEndPosition = end;
            mass.isAnimatingProperty.value = true;
          }
        }
      };
    }
  };
}

function springState( spring: Spring, model: MassesAndSpringsModel ) {
  const fields = {
    ...springParameters( spring ),
    displacement: number( spring.displacementProperty, false, value => Math.abs( value ) <= 10 ),
    stopEnabled: boolean( spring.buttonEnabledProperty ),
    animating: boolean( spring.animatingProperty ),
    traceVisible: boolean( spring.periodTraceVisibilityProperty )
  };
  const trace = spring.periodTrace;
  const traceFields = trace && {
    direction: field( trace.directionProperty, value => value, input =>
      input === null || input === -1 || input === 1 ? input : undefined ),
    xOffset: number( trace.xOffsetProperty, false, value => value >= 0 ),
    crossing: number( trace.crossingProperty, true, value => value >= 0 ),
    state: number( trace.stateProperty, true, value => value >= 0 ),
    alpha: number( trace.alphaProperty, false, value => value >= 0 && value <= 1 )
  };
  return {
    read: () => ( {
      ...readFields( fields ),
      attachedMass: spring.massAttachedProperty.value ? model.masses.indexOf( spring.massAttachedProperty.value ) : null,
      trace: traceFields ? {
        ...readFields( traceFields ),
        firstPeak: trace.firstPeakY,
        secondPeak: trace.secondPeakY,
        threshold: !!trace.thresholdReached
      } : null
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const attachedMass = state.attachedMass;
      const mass = typeof attachedMass === 'number' && Number.isInteger( attachedMass ) ? model.masses[ attachedMass ] : null;
      if ( attachedMass !== null && !mass ) { throw new Error( 'Invalid spring attachment.' ); }
      let restoreTrace = () => {};
      if ( traceFields ) {
        const traceState = object( state.trace );
        const applyTrace = prepareFields( traceFields, traceState );
        const { firstPeak, secondPeak, threshold } = traceState;
        const validPeak = ( value: unknown ) => value === null || typeof value === 'number' && Number.isFinite( value );
        if ( !validPeak( firstPeak ) || !validPeak( secondPeak ) || typeof threshold !== 'boolean' ) {
          throw new Error( 'Invalid spring period trace.' );
        }
        restoreTrace = () => {
          applyTrace();
          trace.firstPeakY = firstPeak;
          trace.secondPeakY = secondPeak;
          trace.thresholdReached = threshold;
        };
      }
      else if ( state.trace !== null ) {
        throw new Error( 'A spring period trace is unavailable.' );
      }
      return { apply, restoreTrace, mass };
    }
  };
}

export default function springScreenState( screen: AnyScreen ) {
  const model = screen.model as MassesAndSpringsModel;
  const view = screen.view as SpringScreenView & Partial<OneSpringScreenView>;
  const intro = model instanceof IntroModel ? sceneParameters( model ) : null;
  const fields = {
    ...( model instanceof IntroModel ? {
      scene: enumeration( model.sceneModeProperty ),
      constantMode: enumeration( model.constantModeProperty )
    } : {} ),
    damping: number( model.dampingProperty, false, value => dampingRange.contains( value ) ),
    body: field( model.bodyProperty, value => bodyNames[ Body.BODIES.indexOf( value ) ],
      value => typeof value === 'string' ? Body.BODIES[ bodyNames.indexOf( value ) ] : undefined ),
    gravity: number( model.gravityProperty, false, value => gravityRange.contains( value ) ),
    timeSpeed: enumeration( model.timeSpeedProperty ),
    rulerVisible: boolean( model.rulerVisibleProperty ),
    rulerPosition: vector( view.rulerNode.positionProperty ),
    rulerDragged: boolean( view.rulerNode.draggedProperty ),
    movableLine: boolean( model.movableLineVisibleProperty ),
    ...( view.movableLineNode ? { movableLinePosition: vector( view.movableLineNode.positionProperty ) } : {} ),
    equilibrium: boolean( model.equilibriumPositionVisibleProperty ),
    naturalLength: boolean( model.naturalLengthVisibleProperty ),
    velocityVector: boolean( model.velocityVectorVisibilityProperty ),
    accelerationVector: boolean( model.accelerationVectorVisibilityProperty ),
    gravityVector: boolean( model.gravityVectorVisibilityProperty ),
    springVector: boolean( model.springVectorVisibilityProperty ),
    forcesMode: enumeration( model.forcesModeProperty ),
    ...( model instanceof LabModel && model.gravityAccordionBoxExpandedProperty ? {
      gravityExpanded: boolean( model.gravityAccordionBoxExpandedProperty )
    } : {} ),
    ...( view.energyGraphAccordionBox ? {
      energyExpanded: boolean( view.energyGraphAccordionBox.expandedProperty ),
      energyZoom: number( view.energyGraphAccordionBox.zoomLevelProperty, true, value => Math.abs( value ) <= 30 )
    } : {} )
  };
  const stopwatch = model.stopwatch;
  const timing = {
    stopwatchVisible: boolean( stopwatch.isVisibleProperty ),
    stopwatchPosition: vector( stopwatch.positionProperty ),
    stopwatchTime: number( stopwatch.timeProperty ),
    stopwatchRunning: boolean( stopwatch.isRunningProperty ),
    timerRunning: boolean( model.timerRunningProperty ),
    playing: boolean( model.playingProperty )
  };
  const springs = model.springs.map( spring => springState( spring, model ) );
  const masses = model.masses.map( massState );

  return {
    isPlaying: () => model.playingProperty.value && ( stopwatch.isRunningProperty.value ||
      model.springs.some( spring => spring.buttonEnabledProperty.value || spring.animatingProperty.value ) ||
      model.masses.some( mass => !mass.userControlledProperty.value &&
        ( mass.isAnimatingProperty.value || !mass.onShelfProperty.value && !mass.springProperty.value ) ) ),
    read: () => ( {
      ...readFields( fields ),
      ...readFields( timing ),
      customGravity: Body.CUSTOM.gravity,
      masses: masses.map( state => state.read() ),
      springs: springs.map( state => state.read() ),
      ...( intro ? { scenes: intro.read() } : {} )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const applyTiming = prepareFields( timing, state );
      const restoreScenes = intro?.prepare( state.scenes );
      const { masses: savedMasses, springs: savedSprings, customGravity } = state;
      if ( !Array.isArray( savedMasses ) || savedMasses.length !== masses.length ||
           !Array.isArray( savedSprings ) || savedSprings.length !== springs.length ||
           typeof customGravity !== 'number' || !gravityRange.contains( customGravity ) ) {
        throw new Error( 'Invalid masses and springs state.' );
      }
      const restoreMasses = masses.map( ( mass, index ) => mass.prepare( savedMasses[ index ] ) );
      const restoreSprings = springs.map( ( spring, index ) => spring.prepare( savedSprings[ index ] ) );
      const attached = restoreSprings.flatMap( state => state.mass ? [ state.mass ] : [] );
      if ( new Set( attached ).size !== attached.length || attached.some( mass => {
        const state = object( savedMasses[ model.masses.indexOf( mass ) ] );
        return state.onShelf || state.returnAnimation !== null;
      } ) ) {
        throw new Error( 'A mass cannot occupy two springs or the shelf and a spring.' );
      }
      return () => {
        view.interruptSubtreeInput();
        model.reset();
        model.playingProperty.value = false;
        restoreScenes?.();
        Body.CUSTOM.gravity = customGravity;
        apply();
        restoreMasses.forEach( state => state.position() );
        restoreSprings.forEach( ( state, index ) => {
          if ( state.mass ) { model.springs[ index ].setMass( state.mass ); }
          state.apply();
        } );
        restoreMasses.forEach( state => state.apply() );
        restoreSprings.forEach( state => state.restoreTrace() );
        applyTiming();
      };
    }
  };
}
