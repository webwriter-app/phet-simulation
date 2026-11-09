// Circuit Construction Kit WebWriter state. Distributed under GPL-3.0.
import type { ObservableArray } from '../../../axon/js/createObservableArray.js';
import Range from '../../../dot/js/Range.js';
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type CCKCAccordionBox from '../../../circuit-construction-kit-common/js/view/CCKCAccordionBox.js';
import type Circuit from '../../../circuit-construction-kit-common/js/model/Circuit.js';
import type CircuitConstructionKitModel from '../../../circuit-construction-kit-common/js/model/CircuitConstructionKitModel.js';
import type CircuitElement from '../../../circuit-construction-kit-common/js/model/CircuitElement.js';
import type Meter from '../../../circuit-construction-kit-common/js/model/Meter.js';
import type Vertex from '../../../circuit-construction-kit-common/js/model/Vertex.js';
import ACVoltage from '../../../circuit-construction-kit-common/js/model/ACVoltage.js';
import Ammeter from '../../../circuit-construction-kit-common/js/model/Ammeter.js';
import Battery from '../../../circuit-construction-kit-common/js/model/Battery.js';
import Capacitor from '../../../circuit-construction-kit-common/js/model/Capacitor.js';
import DynamicCircuitElement from '../../../circuit-construction-kit-common/js/model/DynamicCircuitElement.js';
import Fuse from '../../../circuit-construction-kit-common/js/model/Fuse.js';
import Inductor from '../../../circuit-construction-kit-common/js/model/Inductor.js';
import ResistorType from '../../../circuit-construction-kit-common/js/model/ResistorType.js';
import Voltmeter from '../../../circuit-construction-kit-common/js/model/Voltmeter.js';
import ammeterReadoutTypeProperty from '../../../circuit-construction-kit-common/js/view/ammeterReadoutTypeProperty.js';
import schematicTypeProperty from '../../../circuit-construction-kit-common/js/view/schematicTypeProperty.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields, vector } from './stateFields.js';

const MAX_COMPONENTS = 500;
const NORMAL_RESISTANCE = new Range( 0, 120 );
const EXTREME_RESISTANCE = new Range( 100, 10000 );
const SOLVER_RANGE = new Range( -1e12, 1e12 );
const AC_PHASE = new Range( -180, 180 );

function finite( value: unknown, range: Range, name: string ): number {
  if ( typeof value !== 'number' || !Number.isFinite( value ) || !range.contains( value ) ) {
    throw new Error( `Invalid circuit ${name}.` );
  }
  return value;
}

function point( input: unknown ): Vector2 {
  if ( !Array.isArray( input ) || input.length !== 2 ||
       !input.every( value => Number.isFinite( value ) && Math.abs( value ) <= 1e5 ) ) {
    throw new Error( 'Invalid circuit position.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}

function coordinates( point: Vector2 ): number[] {
  return [ point.x, point.y ];
}

function list( value: unknown, limit: number ): unknown[] {
  if ( !Array.isArray( value ) || value.length > limit ) {
    throw new Error( 'Invalid circuit state array.' );
  }
  return value;
}

function index( value: unknown, length: number ): number {
  if ( typeof value !== 'number' || !Number.isInteger( value ) || value < 0 || value >= length ) {
    throw new Error( 'Invalid circuit object index.' );
  }
  return value;
}

type Group<T extends CircuitElement> = {
  getArray: () => T[];
  createNextElement: ( start: Vertex, end: Vertex ) => T;
};

function component<T extends CircuitElement, P>(
  kind: string,
  group: Group<T>,
  read: ( element: T ) => P,
  decode: ( input: unknown ) => P,
  apply: ( element: T, parameters: P ) => void
) {
  return {
    kind,
    contains: ( element: CircuitElement ) => group.getArray().some( item => item === element ),
    read: ( element: CircuitElement ) => read( element as T ),
    prepare: ( input: unknown ) => {
      const parameters = decode( input );
      return ( start: Vertex, end: Vertex ) => {
        const element = group.createNextElement( start, end );
        apply( element, parameters );
        return element;
      };
    }
  };
}

function simple<T extends CircuitElement>( kind: string, group: Group<T> ) {
  return component( kind, group, () => null, input => {
    if ( input !== null ) { throw new Error( 'Unexpected circuit component settings.' ); }
    return null;
  }, () => {} );
}

function numericComponent<T extends CircuitElement>(
  kind: string, group: Group<T>, range: Range, property: ( element: T ) => { value: number }
) {
  return component( kind, group, element => property( element ).value, input => finite( input, range, kind ),
    ( element, value ) => { property( element ).value = value; } );
}

function componentTypes( circuit: Circuit ) {
  const householdTypes = ResistorType.enumeration.values
    .filter( type => type !== ResistorType.RESISTOR && type !== ResistorType.EXTREME_RESISTOR );
  const fuse = component( 'fuse', circuit.fuseGroup, element => ( {
    rating: element.currentRatingProperty.value, tripped: element.isTrippedProperty.value
  } ), input => {
    const { rating, tripped } = object( input );
    if ( typeof tripped !== 'boolean' ) { throw new Error( 'Invalid fuse status.' ); }
    return { rating: finite( rating, Fuse.RANGE, 'fuse rating' ), tripped };
  }, ( element, value ) => {
    element.currentRatingProperty.value = value.rating;
    element.isTrippedProperty.value = value.tripped;
  } );
  const acSource = circuit.acVoltageGroup && component( 'ac-source', circuit.acVoltageGroup, element => ( {
    amplitude: element.maximumVoltageProperty.value,
    frequency: element.frequencyProperty.value,
    phase: element.phaseProperty.value
  } ), input => {
    const state = object( input );
    return {
      amplitude: finite( state.amplitude, ACVoltage.MAX_VOLTAGE_RANGE, 'AC amplitude' ),
      frequency: finite( state.frequency, ACVoltage.FREQUENCY_RANGE, 'AC frequency' ),
      phase: finite( state.phase, AC_PHASE, 'AC phase' )
    };
  }, ( element, value ) => {
    element.maximumVoltageProperty.value = value.amplitude;
    element.frequencyProperty.value = value.frequency;
    element.phaseProperty.value = value.phase;
  } );
  return [
    simple( 'wire', circuit.wireGroup ),
    numericComponent( 'battery', circuit.batteryGroup, Battery.VOLTAGE_RANGE, element => element.voltageProperty ),
    numericComponent( 'resistor', circuit.resistorGroup, ResistorType.RESISTOR.range, element => element.resistanceProperty ),
    numericComponent( 'bulb', circuit.lightBulbGroup, NORMAL_RESISTANCE, element => element.resistanceProperty ),
    component( 'switch', circuit.switchGroup, element => element.isClosedProperty.value, value => {
      if ( typeof value !== 'boolean' ) { throw new Error( 'Invalid circuit switch.' ); }
      return value;
    }, ( element, value ) => { element.isClosedProperty.value = value; } ),
    fuse,
    ...householdTypes.map( type => simple( String( type ), {
      getArray: () => circuit.householdObjectGroup.getArray().filter( resistor => resistor.resistorType === type ),
      createNextElement: ( start, end ) => circuit.householdObjectGroup.createNextElement( start, end, type )
    } ) ),
    ...( circuit.extremeBatteryGroup ? [
      numericComponent( 'high-voltage-battery', circuit.extremeBatteryGroup, Battery.HIGH_VOLTAGE_RANGE, element => element.voltageProperty )
    ] : [] ),
    ...( circuit.extremeResistorGroup ? [
      numericComponent( 'high-resistance-resistor', circuit.extremeResistorGroup, EXTREME_RESISTANCE, element => element.resistanceProperty )
    ] : [] ),
    ...( circuit.extremeLightBulbGroup ? [
      numericComponent( 'high-resistance-bulb', circuit.extremeLightBulbGroup, EXTREME_RESISTANCE, element => element.resistanceProperty )
    ] : [] ),
    ...( circuit.realLightBulbGroup ? [ simple( 'real-bulb', circuit.realLightBulbGroup ) ] : [] ),
    ...( circuit.seriesAmmeterGroup ? [ simple( 'series-ammeter', circuit.seriesAmmeterGroup ) ] : [] ),
    ...( acSource ? [ acSource ] : [] ),
    ...( circuit.capacitorGroup ? [
      numericComponent( 'capacitor', circuit.capacitorGroup, Capacitor.CAPACITANCE_RANGE, element => element.capacitanceProperty )
    ] : [] ),
    ...( circuit.inductorGroup ? [
      numericComponent( 'inductor', circuit.inductorGroup, Inductor.INDUCTANCE_RANGE, element => element.inductanceProperty )
    ] : [] )
  ];
}

function meterFields( meter: Meter ) {
  return {
    body: vector( meter.bodyPositionProperty ),
    active: boolean( meter.isActiveProperty ),
    ...( meter instanceof Ammeter ? { probe: vector( meter.probePositionProperty ) } : {} ),
    ...( meter instanceof Voltmeter ? {
      redProbe: vector( meter.redProbePositionProperty ),
      blackProbe: vector( meter.blackProbePositionProperty )
    } : {} )
  };
}

// Chart sampling and probe placement are owned by the view in this build.
type Chart = {
  meter: Meter;
  series: ObservableArray<Vector2 | null>;
  probeNode1: { translation: Vector2 };
  probeNode2?: { translation: Vector2 };
  zoomLevelProperty: { value: number; range: Range };
  lastStepTime: number | null;
};

function chartState( chart: Chart ) {
  const fields = { ...meterFields( chart.meter ), zoom: number( chart.zoomLevelProperty, true ) };
  const probes = chart.probeNode2 ? [ chart.probeNode1, chart.probeNode2 ] : [ chart.probeNode1 ];
  return {
    read: () => ( {
      ...readFields( fields ),
      probes: probes.map( probe => coordinates( probe.translation ) ),
      lastSampleTime: chart.lastStepTime,
      samples: chart.series.map( sample => sample && coordinates( sample ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const positions = list( state.probes, probes.length ).map( point );
      if ( positions.length !== probes.length ) { throw new Error( 'Invalid chart probes.' ); }
      const sampleTime = state.lastSampleTime === null ? null : finite( state.lastSampleTime, SOLVER_RANGE, 'chart time' );
      const samples = list( state.samples, 4000 ).map( sample => {
        if ( sample === null ) { return null; }
        if ( !Array.isArray( sample ) || sample.length !== 2 ) { throw new Error( 'Invalid chart sample.' ); }
        return new Vector2( finite( sample[ 0 ], SOLVER_RANGE, 'chart time' ), finite( sample[ 1 ], SOLVER_RANGE, 'chart sample' ) );
      } );
      return () => {
        apply();
        probes.forEach( ( probe, i ) => { probe.translation = positions[ i ]; } );
        chart.lastStepTime = sampleTime;
        chart.series.clear();
        chart.series.push( ...samples );
      };
    }
  };
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as CircuitConstructionKitModel;
  const circuit = model.circuit;
  const types = componentTypes( circuit );
  const view = screen.view as unknown as { chartNodes: Chart[]; advancedAccordionBox: CCKCAccordionBox | null };
  const controls = {
    view: enumeration( model.viewTypeProperty ),
    showCurrent: boolean( circuit.showCurrentProperty ),
    currentType: enumeration( circuit.currentTypeProperty ),
    showLabels: boolean( model.showLabelsProperty ),
    showValues: boolean( model.showValuesProperty ),
    zoom: number( model.zoomLevelProperty, true ),
    realisticBulbs: boolean( model.addRealBulbsProperty ),
    wireResistivity: number( circuit.wireResistivityProperty ),
    batteryResistance: number( circuit.sourceResistanceProperty ),
    time: number( circuit.timeProperty, false, value => value >= 0 && value <= 1e12 ),
    ...( view.advancedAccordionBox ? { advanced: boolean( view.advancedAccordionBox.expandedProperty ) } : {} )
  };
  const playback = { playing: boolean( model.isPlayingProperty ) };
  const stopwatch = {
    visible: boolean( model.stopwatch.isVisibleProperty ),
    position: vector( model.stopwatch.positionProperty ),
    running: boolean( model.stopwatch.isRunningProperty ),
    time: number( model.stopwatch.timeProperty, false, value => value >= 0 )
  };
  const meters = [ ...model.voltmeters, ...model.ammeters ].map( meterFields );
  const charts = view.chartNodes.map( chartState );

  return {
    isPlaying: () => model.isPlayingProperty.value,
    read: () => {
      const vertices = circuit.vertexGroup.getArray();
      const vertexIndices = new Map( vertices.map( ( vertex, i ) => [ vertex, i ] ) );
      return {
        controls: readFields( controls ),
        playback: readFields( playback ),
        stopwatch: readFields( stopwatch ),
        meters: meters.map( readFields ),
        charts: charts.map( chart => chart.read() ),
        vertices: vertices.map( vertex => ( {
          position: coordinates( vertex.positionProperty.value ),
          voltage: vertex.voltageProperty.value
        } ) ),
        elements: circuit.circuitElements.map( element => {
          const type = types.find( type => type.contains( element ) );
          if ( !type ) { throw new Error( 'Unrecognized circuit component.' ); }
          return {
            kind: type.kind,
            start: vertexIndices.get( element.startVertexProperty.value ),
            end: vertexIndices.get( element.endVertexProperty.value ),
            parameters: type.read( element ),
            current: element.currentProperty.value,
            history: element instanceof DynamicCircuitElement ? [ element.mnaVoltageDrop, element.mnaCurrent ] : null
          };
        } )
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state.controls );
      const applyPlayback = prepareFields( playback, state.playback );
      const applyStopwatch = prepareFields( stopwatch, state.stopwatch );
      const meterStates = list( state.meters, meters.length );
      const chartStates = list( state.charts, charts.length );
      if ( meterStates.length !== meters.length || chartStates.length !== charts.length ) {
        throw new Error( 'Invalid circuit instrument count.' );
      }
      const applyMeters = meters.map( ( meter, i ) => prepareFields( meter, meterStates[ i ] ) );
      const applyCharts = charts.map( ( chart, i ) => chart.prepare( chartStates[ i ] ) );
      const vertices = list( state.vertices, 2 * MAX_COMPONENTS ).map( input => {
        const vertex = object( input );
        return { position: point( vertex.position ), voltage: finite( vertex.voltage, SOLVER_RANGE, 'vertex voltage' ) };
      } );
      const elements = list( state.elements, MAX_COMPONENTS ).map( input => {
        const element = object( input );
        const type = types.find( type => type.kind === element.kind );
        const start = index( element.start, vertices.length );
        const end = index( element.end, vertices.length );
        if ( !type || start === end ) { throw new Error( 'Invalid circuit element.' ); }
        const dynamic = type.kind === 'capacitor' || type.kind === 'inductor';
        const history = dynamic ? list( element.history, 2 ).map( value => finite( value, SOLVER_RANGE, 'component history' ) ) : null;
        if ( dynamic ? history?.length !== 2 : element.history !== null ) {
          throw new Error( 'Invalid circuit component history.' );
        }
        return { start, end, create: type.prepare( element.parameters ), history, current: finite( element.current, SOLVER_RANGE, 'current' ) };
      } );

      return () => {
        screen.view.interruptSubtreeInput();
        model.isPlayingProperty.value = false;
        // A drag interruption can queue a drop action for a vertex that is about to be replaced.
        ( circuit as unknown as { stepActions: ( () => void )[] } ).stepActions.length = 0;
        circuit.reset();
        applyControls();
        const restoredVertices = vertices.map( vertex => circuit.vertexGroup.createNextElement( vertex.position ) );
        elements.forEach( ( { start, end, create, history, current } ) => {
          const element = create( restoredVertices[ start ], restoredVertices[ end ] );
          circuit.circuitElements.add( element );
          if ( element instanceof ACVoltage ) {
            element.step( circuit.timeProperty.value, 0, circuit );
          }
          element.currentProperty.value = current;
          if ( element instanceof DynamicCircuitElement && history ) {
            [ element.mnaVoltageDrop, element.mnaCurrent ] = history;
          }
        } );
        restoredVertices.forEach( ( vertex, i ) => { vertex.voltageProperty.value = vertices[ i ].voltage; } );
        circuit.layoutChargesInDirtyCircuitElements();
        applyMeters.forEach( apply => apply() );
        applyCharts.forEach( apply => apply() );
        applyStopwatch();
        circuit.circuitChangedEmitter.emit();
        applyPlayback();
      };
    }
  };
}

export default function installCircuitState( sim: Sim, id: string, version: string, screenIds: string[] ): void {
  const preferences = {
    schematicStandard: enumeration( schematicTypeProperty ),
    ammeterReadout: enumeration( ammeterReadoutTypeProperty )
  };
  installSimulationBridge( sim, () => ( {
    bridge: `webwriter-${id}/v1`,
    build: `${id}@${version}-webwriter.1`,
    readPreferences: () => readFields( preferences ),
    preparePreferences: input => prepareFields( preferences, input ),
    screens: sim.simScreens.map( ( screen, i ) => ( { id: screenIds[ i ], screen, ...screenState( screen ) } ) )
  } ) );
}
