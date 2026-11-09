// Kepler's Laws WebWriter adapter. Distributed with the adapted simulation under GPL-3.0.
import NumberProperty from '../../../axon/js/NumberProperty.js';
import Property from '../../../axon/js/Property.js';
import Vector2 from '../../../dot/js/Vector2.js';
import Screen from '../../../joist/js/Screen.js';
import Sim from '../../../joist/js/Sim.js';
import KeplersLawsModel from '../common/model/KeplersLawsModel.js';
import KeplersLawsPreferences from '../common/model/KeplersLawsPreferences.js';
import KeplersLawsScreenView from '../common/view/KeplersLawsScreenView.js';

import installSimulationBridge from './installSimulationBridge.js';

const bridge = 'webwriter-keplers-laws/v1';
const build = 'keplers-laws@1.2.11-webwriter.1';
const screenIds = [ 'first-law', 'second-law', 'third-law', 'all-laws' ];
type KeplerScreen = Screen<KeplersLawsModel, KeplersLawsScreenView>;
type Value = boolean | number | string | [ number, number ];
type Field = {
  read: () => Value;
  prepare: ( value: unknown, name: string ) => () => void;
};
type Fields = Record<string, Field>;

function object( value: unknown ): Record<string, unknown> {
  if ( !value || typeof value !== 'object' || Array.isArray( value ) ) {
    throw new Error( 'Expected a simulation state object.' );
  }
  return value as Record<string, unknown>;
}

function field<T>(
  property: { value: T },
  encode: ( value: T ) => Value,
  decode: ( value: unknown ) => T | undefined
): Field {
  return {
    read: () => encode( property.value ),
    prepare: ( input, name ) => {
      const value = decode( input );
      if ( value === undefined ) {
        throw new Error( `Invalid simulation state field: ${name}.` );
      }
      return () => { property.value = value; };
    }
  };
}

function boolean( property: { value: boolean } ): Field {
  return field( property, value => value, value => typeof value === 'boolean' ? value : undefined );
}

function number( property: NumberProperty, integer = false ): Field {
  return field( property, value => value, value =>
    typeof value === 'number' && Number.isFinite( value ) &&
    ( !integer || Number.isInteger( value ) ) && property.range.contains( value ) ? value : undefined
  );
}

function vector( property: Property<Vector2> ): Field {
  return field( property, value => [ value.x, value.y ], value =>
    Array.isArray( value ) && value.length === 2 && value.every( Number.isFinite ) ?
    new Vector2( value[ 0 ], value[ 1 ] ) : undefined
  );
}

function enumeration<T>( property: Property<T> ): Field {
  return field( property, value => String( value ), value => property.validValues?.find( item => String( item ) === value ) );
}

function readFields( fields: Fields ): Record<string, Value> {
  return Object.fromEntries( Object.entries( fields ).map( ( [ key, binding ] ) => [ key, binding.read() ] ) );
}

function prepareFields( fields: Fields, state: unknown ): () => void {
  const values = object( state );
  const changes = Object.entries( fields ).map( ( [ key, binding ] ) => binding.prepare( values[ key ], key ) );
  return () => changes.forEach( change => change() );
}

function screenState( screen: KeplerScreen ) {
  const model = screen.model;
  const visible = screen.view.visibleProperties;
  const orbit = {
    sunMass: number( model.sun.massProperty ),
    position: vector( model.planet.positionProperty ),
    velocity: vector( model.planet.velocityProperty )
  };
  const controls = {
    ...( model.isAllLaws ? { law: enumeration( model.selectedLawProperty ) } : {} ),
    alwaysCircular: boolean( model.alwaysCircularProperty ),
    targetOrbit: enumeration( model.targetOrbitProperty ),
    divisions: number( model.periodDivisionsProperty, true ),
    axisPower: number( model.selectedAxisPowerProperty, true ),
    periodPower: number( model.selectedPeriodPowerProperty, true ),
    timeSpeed: enumeration( model.timeSpeedProperty ),
    zoomLevel: number( model.zoomLevelProperty, true ),
    tapeBase: vector( model.measuringTape.basePositionProperty ),
    tapeTip: vector( model.measuringTape.tipPositionProperty )
  };
  const display = {
    speed: boolean( visible.speedVisibleProperty ),
    velocity: boolean( visible.velocityVisibleProperty ),
    gravity: boolean( visible.gravityVisibleProperty ),
    path: boolean( visible.pathVisibleProperty ),
    grid: boolean( visible.gridVisibleProperty ),
    measuringTape: boolean( visible.measuringTapeVisibleProperty ),
    stopwatch: boolean( visible.stopwatchVisibleProperty ),
    targetOrbitPanel: boolean( visible.targetOrbitPanelVisibleProperty ),
    axes: boolean( visible.axesVisibleProperty ),
    semiaxes: boolean( visible.semiaxesCheckedProperty ),
    foci: boolean( visible.fociVisibleProperty ),
    strings: boolean( visible.stringCheckedProperty ),
    eccentricity: boolean( visible.eccentricityVisibleProperty ),
    apoapsis: boolean( visible.apoapsisVisibleProperty ),
    periapsis: boolean( visible.periapsisVisibleProperty ),
    areaValues: boolean( visible.areaValuesVisibleProperty ),
    timeValues: boolean( visible.timeValuesVisibleProperty ),
    secondLawGraph: boolean( visible.secondLawAccordionBoxExpandedProperty ),
    semiMajorAxis: boolean( visible.semiMajorAxisVisibleProperty ),
    period: boolean( visible.periodVisibleProperty ),
    thirdLawGraph: boolean( visible.thirdLawAccordionBoxExpandedProperty )
  };
  const timing = {
    time: number( model.timeProperty ),
    played: boolean( model.hasPlayedProperty ),
    stopwatchPosition: vector( model.stopwatch.positionProperty ),
    stopwatchTime: number( model.stopwatch.timeProperty ),
    stopwatchRunning: boolean( model.stopwatch.isRunningProperty ),
    playing: boolean( model.isPlayingProperty )
  };
  const lawViews = [ ...visible.lawVisibilitiesMap ];

  return {
    read: () => ( {
      orbit: readFields( orbit ),
      controls: readFields( controls ),
      display: readFields( display ),
      savedLawViews: Object.fromEntries( lawViews.map( ( [ law, properties ] ) => [
        String( law ), properties.map( property => property.getInitialValue() )
      ] ) ),
      timing: readFields( timing )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyOrbit = prepareFields( orbit, state.orbit );
      const applyControls = prepareFields( controls, state.controls );
      const applyDisplay = prepareFields( display, state.display );
      const applyTiming = prepareFields( timing, state.timing );
      const savedLawViews = object( state.savedLawViews );
      const applyLawViews = lawViews.map( ( [ law, properties ] ) => {
        const values = savedLawViews[ String( law ) ];
        if ( !Array.isArray( values ) || values.length !== properties.length ||
             !values.every( value => typeof value === 'boolean' ) ) {
          throw new Error( 'Invalid saved law view.' );
        }
        return () => properties.forEach( ( property, index ) => property.setInitialValue( values[ index ] ) );
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        model.isPlayingProperty.value = false;
        model.periodTracker.reset();
        applyControls();

        // Apply the orbit together before letting the model recompute its derived elements.
        model.engine.internalPropertyMutation = true;
        try {
          applyOrbit();
          model.engine.update( model.bodies );
        }
        finally {
          model.engine.internalPropertyMutation = false;
        }
        model.saveStartingBodyInfo();
        applyDisplay();
        applyLawViews.forEach( change => change() );
        applyTiming();
      };
    }
  };
}

export default function installWebWriter( sim: Sim, screens: KeplerScreen[] ): void {
  installSimulationBridge( sim, () => ( {
    bridge,
    build,
    screens: screens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...screenState( screen ) } ) ),
    readPreferences: () => ( { moreOrbitalData: KeplersLawsPreferences.moreOrbitalDataVisibleProperty.value } ),
    preparePreferences: settings => {
      const { moreOrbitalData } = settings;
      if ( typeof moreOrbitalData !== 'boolean' ) {
        throw new Error( 'The simulation preferences are invalid.' );
      }
      return () => { KeplersLawsPreferences.moreOrbitalDataVisibleProperty.value = moreOrbitalData; };
    }
  } ) );
}
