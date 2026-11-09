// Faraday's Electromagnetic Lab family state bindings. Distributed under GPL-3.0.
import type { AnyScreen } from '../Screen.js';
import Node from '../../../scenery/js/nodes/Node.js';
import Checkbox from '../../../sun/js/Checkbox.js';
import BarMagnetScreenModel from '../../../faradays-electromagnetic-lab/js/bar-magnet/model/BarMagnetScreenModel.js';
import BarMagnet from '../../../faradays-electromagnetic-lab/js/common/model/BarMagnet.js';
import Electromagnet from '../../../faradays-electromagnetic-lab/js/common/model/Electromagnet.js';
import type FELPreferences from '../../../faradays-electromagnetic-lab/js/common/model/FELPreferences.js';
import FELScreenModel from '../../../faradays-electromagnetic-lab/js/common/model/FELScreenModel.js';
import KinematicCompass from '../../../faradays-electromagnetic-lab/js/common/model/KinematicCompass.js';
import Magnet from '../../../faradays-electromagnetic-lab/js/common/model/Magnet.js';
import PickupCoil from '../../../faradays-electromagnetic-lab/js/common/model/PickupCoil.js';
import ElectromagnetScreenModel from '../../../faradays-electromagnetic-lab/js/electromagnet/model/ElectromagnetScreenModel.js';
import GeneratorScreenModel from '../../../faradays-electromagnetic-lab/js/generator/model/GeneratorScreenModel.js';
import PickupCoilScreenModel from '../../../faradays-electromagnetic-lab/js/pickup-coil/model/PickupCoilScreenModel.js';
import TransformerScreenModel from '../../../faradays-electromagnetic-lab/js/transformer/model/TransformerScreenModel.js';
import BarMagnetPanel from '../../../faradays-electromagnetic-lab/js/common/view/BarMagnetPanel.js';
import LockToAxisCheckbox from '../../../faradays-electromagnetic-lab/js/common/view/LockToAxisCheckbox.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

function descendants( node: Node ): Node[] {
  return node.children.flatMap( child => [ child, ...descendants( child ) ] );
}

function magnetFields( magnet: Magnet ) {
  return {
    magnetPosition: vector( magnet.positionProperty ),
    rotation: number( magnet.rotationProperty, false, value => value >= 0 && value <= 2 * Math.PI ),
    fieldVisible: boolean( magnet.fieldVisibleProperty ),
    ...( magnet instanceof BarMagnet ? { strength: number( magnet.strengthPercentProperty ) } : {} )
  };
}

function pickupFields( pickup: PickupCoil ) {
  return {
    coilPosition: vector( pickup.positionProperty ),
    coilLoops: number( pickup.coil.numberOfLoopsProperty, true ),
    coilArea: number( pickup.coil.loopAreaPercentProperty ),
    coilCurrent: boolean( pickup.coil.currentVisibleProperty ),
    currentIndicator: field( pickup.currentIndicatorProperty,
      value => value === pickup.lightBulb ? 'bulb' : 'voltmeter',
      value => value === 'bulb' ? pickup.lightBulb : value === 'voltmeter' ? pickup.voltmeter : undefined )
  };
}

function electromagneticFields( magnet: Electromagnet ) {
  const dc = magnet.dcPowerSupply;
  const ac = magnet.acPowerSupply;
  return {
    currentSource: field( magnet.currentSourceProperty, value => value === dc ? 'dc' : 'ac',
      value => value === 'dc' ? dc : value === 'ac' ? ac : undefined ),
    dcVoltage: number( dc.voltageProperty ),
    acAmplitude: number( ac.maxVoltagePercentProperty ),
    acFrequency: number( ac.frequencyPercentProperty ),
    acAngle: number( ac[ '_angleProperty' ] ),
    acVoltage: number( ac.voltageProperty ),
    coilLoops: number( magnet.coil.numberOfLoopsProperty, true ),
    coilCurrent: boolean( magnet.coil.currentVisibleProperty )
  };
}

export function felState( screen: AnyScreen ) {
  const model = screen.model as FELScreenModel;
  const view = screen.view;
  let magnet: Magnet;
  let pickup: PickupCoil | undefined;
  let turbine: GeneratorScreenModel[ 'generator' ][ 'turbine' ] | undefined;
  if ( model instanceof GeneratorScreenModel ) {
    turbine = model.generator.turbine;
    magnet = turbine.barMagnet;
    pickup = model.generator.pickupCoil;
  }
  else if ( model instanceof TransformerScreenModel ) {
    magnet = model.transformer.electromagnet;
    pickup = model.transformer.pickupCoil;
  }
  else if ( model instanceof PickupCoilScreenModel || model instanceof BarMagnetScreenModel ) {
    magnet = model.barMagnet;
    pickup = model instanceof PickupCoilScreenModel ? model.pickupCoil : undefined;
  }
  else if ( model instanceof ElectromagnetScreenModel ) {
    magnet = model.electromagnet;
  }
  else {
    throw new Error( 'Unknown Faraday’s Electromagnetic Lab model.' );
  }
  const nodes = descendants( view );
  const lock = nodes.find( child => child instanceof LockToAxisCheckbox );
  const barMagnetPanel = model instanceof BarMagnetScreenModel ? nodes.find( child => child instanceof BarMagnetPanel ) : null;
  // The Bar Magnet panel builds the magnetic field, see-inside and Earth controls in this order.
  const [ , inside, earth ] = barMagnetPanel ? descendants( barMagnetPanel ).filter( child => child instanceof Checkbox ) : [];
  const options = {
    ...( lock ? { lockToAxis: boolean( lock.property ) } : {} ),
    ...( inside ? { seeInside: boolean( inside.property ) } : {} ),
    ...( earth ? { earthVisible: boolean( earth.property ) } : {} )
  };
  const tools = {
    compassPosition: vector( model.compass.positionProperty ),
    compassVisible: boolean( model.compass.visibleProperty ),
    meterPosition: vector( model.fieldMeter.positionProperty ),
    meterVisible: boolean( model.fieldMeter.visibleProperty ),
    ...( turbine ? { waterFlow: number( turbine.waterFaucet.flowRatePercentProperty ) } : {} )
  };
  const compass = model.compass;
  const motion = {
    compassAngle: number( compass[ '_needleAngleProperty' ], false, value => Math.abs( value ) <= 2 * Math.PI ),
    ...( compass instanceof KinematicCompass ? {
      compassVelocity: number( compass[ 'angularVelocityProperty' ] ),
      compassAcceleration: number( compass[ 'angularAccelerationProperty' ] )
    } : {} ),
    ...( pickup ? {
      flux: number( pickup[ '_fluxProperty' ] ),
      deltaFlux: number( pickup[ '_deltaFluxProperty' ] ),
      emf: number( pickup[ '_emfProperty' ] ),
      needleAngle: number( pickup.voltmeter[ '_needleAngleProperty' ] ),
      bulbBrightness: number( pickup.lightBulb[ '_brightnessProperty' ] )
    } : {} )
  };
  const playing = { playing: boolean( model.isPlayingProperty ) };
  const magnetFieldBindings = magnetFields( magnet );
  const power = magnet instanceof Electromagnet ? electromagneticFields( magnet ) : null;
  const pickupBindings = pickup ? pickupFields( pickup ) : null;
  return {
    isPlaying: () => model.isPlayingProperty.value && (
      !!turbine?.waterFaucet.flowRatePercentProperty.value ||
      magnet instanceof Electromagnet && magnet.currentSourceProperty.value === magnet.acPowerSupply &&
        magnet.acPowerSupply.maxVoltagePercentProperty.value > 0 && magnet.acPowerSupply.frequencyPercentProperty.value > 0 ||
      !!pickup?.emfProperty.value || !!pickup?.voltmeter.needleAngleProperty.value ||
      compass.visibleProperty.value && compass.fieldVectorProperty.value.magnitude > 0 &&
        Math.abs( compass.fieldVectorProperty.value.angle - compass.needleAngleProperty.value ) > 1e-5
    ),
    read: () => ( {
      ...readFields( options ),
      ...readFields( tools ),
      ...readFields( motion ),
      ...readFields( playing ),
      magnet: readFields( magnetFieldBindings ),
      ...( power ? { power: readFields( power ) } : {} ),
      ...( pickupBindings ? { pickup: readFields( pickupBindings ) } : {} )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyOptions = prepareFields( options, state );
      const applyTools = prepareFields( tools, state );
      const applyMotion = prepareFields( motion, state );
      const applyPlaying = prepareFields( playing, state );
      const applyMagnet = prepareFields( magnetFieldBindings, state.magnet );
      const applyPower = power && prepareFields( power, state.power );
      const applyPickup = pickupBindings && prepareFields( pickupBindings, state.pickup );
      if ( state.lockToAxis && ( object( state.magnet ).magnetPosition as number[] )[ 1 ] !==
           ( object( state.pickup ).coilPosition as number[] )[ 1 ] ) {
        throw new Error( 'Locked coils must share an axis.' );
      }
      return () => {
        view.interruptSubtreeInput();
        applyOptions();
        applyMagnet();
        applyPower?.();
        applyPickup?.();
        applyTools();
        applyPlaying();
        // Position and power listeners can realign the needle or clear induced current.
        applyMotion();
      };
    }
  };
}

export function felPreferences( preferences: FELPreferences ) {
  return {
    magneticUnits: enumeration( preferences.magneticUnitsProperty ),
    ...( preferences.hasCurrentFlowFeature ? { currentFlow: enumeration( preferences.currentFlowProperty ) } : {} ),
    ...( preferences.hasEarthFeature ? {
      addEarthCheckbox: boolean( preferences.addEarthCheckboxProperty ),
      earthHemisphere: enumeration( preferences.earthHemisphereProperty )
    } : {} )
  };
}
