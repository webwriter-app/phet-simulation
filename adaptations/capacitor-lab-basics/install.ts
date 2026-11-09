// Capacitor Lab: Basics WebWriter adapter. Distributed under GPL-3.0.
import Vector3 from '../../../dot/js/Vector3.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import CapacitorConstants from '../../../scenery-phet/js/capacitor/CapacitorConstants.js';
import TimeSpeed from '../../../scenery-phet/js/TimeSpeed.js';
import type CLBModel from '../common/model/CLBModel.js';
import CircuitState from '../common/model/CircuitState.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

function readPosition( position: Vector3 ): number[] {
  return [ position.x, position.y, position.z ];
}

function position( value: unknown ): Vector3 {
  if ( !Array.isArray( value ) || value.length !== 3 ||
       !value.every( coordinate => Number.isFinite( coordinate ) && Math.abs( coordinate ) <= 10 ) ) {
    throw new Error( 'Invalid voltmeter position.' );
  }
  return new Vector3( value[ 0 ], value[ 1 ], value[ 2 ] );
}

function screenState( screen: AnyScreen, lightBulb: boolean ) {
  const model = screen.model as CLBModel;
  const circuit = model.circuit;
  const capacitor = circuit.capacitor;
  const meter = model.voltmeter;
  const controls = {
    plateCharges: boolean( model.plateChargesVisibleProperty ),
    electricField: boolean( model.electricFieldVisibleProperty ),
    capacitanceMeter: boolean( model.capacitanceMeterVisibleProperty ),
    plateChargeMeter: boolean( model.topPlateChargeMeterVisibleProperty ),
    storedEnergyMeter: boolean( model.storedEnergyMeterVisibleProperty ),
    barGraphs: boolean( model.barGraphsVisibleProperty ),
    voltmeter: boolean( model.voltmeterVisibleProperty ),
    current: boolean( model.currentVisibleProperty ),
    switchUsed: boolean( model.switchUsedProperty ),
    speed: field( model.timeSpeedProperty, value => value === TimeSpeed.SLOW ? 'slow' : 'normal', value =>
      value === 'slow' ? TimeSpeed.SLOW : value === 'normal' ? TimeSpeed.NORMAL : undefined )
  };
  const playback = { playing: boolean( model.isPlayingProperty ) };
  const geometry = {
    batteryVoltage: number( circuit.battery.voltageProperty ),
    plateSeparation: number( capacitor.plateSeparationProperty ),
    connection: field<string>( circuit.circuitConnectionProperty, value =>
      value === CircuitState.SWITCH_IN_TRANSIT ? CircuitState.OPEN_CIRCUIT : value, value =>
      value === CircuitState.BATTERY_CONNECTED || value === CircuitState.OPEN_CIRCUIT ||
      ( lightBulb && value === CircuitState.LIGHT_BULB_CONNECTED ) ? value : undefined )
  };
  const charge = {
    plateVoltage: number( capacitor.plateVoltageProperty, false, value => Math.abs( value ) <= 100 ),
    disconnectedCharge: number( circuit.disconnectedPlateChargeProperty, false, value => Math.abs( value ) <= 1e-8 ),
    currentAmplitude: number( circuit.currentAmplitudeProperty )
  };
  return {
    isPlaying: () => model.isPlayingProperty.value,
    read: () => ( {
      controls: readFields( controls ),
      playback: readFields( playback ),
      circuit: { ...readFields( geometry ), ...readFields( charge ), plateWidth: capacitor.plateSizeProperty.value.width },
      voltmeter: {
        body: readPosition( meter.bodyPositionProperty.value ),
        positiveProbe: readPosition( meter.positiveProbePositionProperty.value ),
        negativeProbe: readPosition( meter.negativeProbePositionProperty.value )
      }
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const circuitState = object( state.circuit );
      const { plateWidth } = circuitState;
      if ( typeof plateWidth !== 'number' || !CapacitorConstants.PLATE_WIDTH_RANGE.contains( plateWidth ) ) {
        throw new Error( 'Invalid capacitor plate width.' );
      }
      const meterState = object( state.voltmeter );
      const body = position( meterState.body );
      const positiveProbe = position( meterState.positiveProbe );
      const negativeProbe = position( meterState.negativeProbe );
      const applyControls = prepareFields( controls, state.controls );
      const applyGeometry = prepareFields( geometry, circuitState );
      const applyCharge = prepareFields( charge, circuitState );
      const applyPlayback = prepareFields( playback, state.playback );
      return () => {
        screen.view.interruptSubtreeInput();
        model.isPlayingProperty.value = false;
        capacitor.setPlateWidth( plateWidth );
        applyGeometry();
        // Connection and geometry listeners derive charge. Restore the saved charge after them.
        applyCharge();
        circuit.previousTotalCharge = circuit.getTotalCharge();
        applyControls();
        meter.bodyPositionProperty.value = body;
        meter.positiveProbePositionProperty.value = positiveProbe;
        meter.negativeProbePositionProperty.value = negativeProbe;
        applyPlayback();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-capacitor-lab-basics/v1',
    build: 'capacitor-lab-basics@1.8.0-dev.6-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( {
      id: index === 0 ? 'capacitance' : 'light-bulb', screen, ...screenState( screen, index === 1 )
    } ) )
  } ) );
}
