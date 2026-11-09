// Charges and Fields WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type ChargesAndFieldsModel from '../charges-and-fields/model/ChargesAndFieldsModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, object, prepareFields, readFields, vector } from './stateFields.js';

function coordinates( point: Vector2 ): [ number, number ] {
  return [ point.x, point.y ];
}

function point( value: unknown ): Vector2 {
  if ( !Array.isArray( value ) || value.length !== 2 ||
       !value.every( coordinate => Number.isFinite( coordinate ) && Math.abs( coordinate ) <= 100 ) ) {
    throw new Error( 'Invalid Charges and Fields position.' );
  }
  return new Vector2( value[ 0 ], value[ 1 ] );
}

function list<T>( value: unknown, decode: ( entry: unknown ) => T ): T[] {
  if ( !Array.isArray( value ) || value.length > 500 ) {
    throw new Error( 'Invalid Charges and Fields object list.' );
  }
  return value.map( decode );
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as ChargesAndFieldsModel;
    const potential = model.electricPotentialSensor;
    const tape = model.measuringTape;
    const controls = {
      electricField: boolean( model.isElectricFieldVisibleProperty ),
      directionOnly: boolean( model.isElectricFieldDirectionOnlyProperty ),
      electricPotential: boolean( model.isElectricPotentialVisibleProperty ),
      values: boolean( model.areValuesVisibleProperty ),
      grid: boolean( model.isGridVisibleProperty ),
      snapToGrid: boolean( model.snapToGridProperty )
    };
    const tools = {
      potentialSensor: boolean( potential.isActiveProperty ),
      potentialSensorPosition: vector( potential.positionProperty ),
      measuringTape: boolean( tape.isActiveProperty ),
      measuringTapeBase: vector( tape.basePositionProperty ),
      measuringTapeTip: vector( tape.tipPositionProperty )
    };
    const readElement = ( element: { initialPosition: Vector2; positionProperty: { value: Vector2 } } ) => ( {
      origin: coordinates( element.initialPosition ),
      position: coordinates( element.positionProperty.value )
    } );
    const parseElement = ( input: unknown ) => {
      const state = object( input );
      return { origin: point( state.origin ), position: point( state.position ) };
    };

    return {
      bridge: 'webwriter-charges-and-fields/v1',
      build: 'charges-and-fields@1.1.0-dev.12-webwriter.1',
      screens: [ {
        id: 'charges-and-fields',
        screen,
        read: () => ( {
          controls: readFields( controls ),
          tools: readFields( tools ),
          charges: model.activeChargedParticles.map( charge => ( { ...readElement( charge ), sign: charge.charge } ) ),
          sensors: model.electricFieldSensorGroup.getArray().filter( sensor => sensor.isActiveProperty.value ).map( readElement ),
          contours: model.electricPotentialLineGroup.getArray().map( line => ( {
            position: coordinates( line.position ),
            label: coordinates( line.voltageLabelPositionProperty.value )
          } ) )
        } ),
        prepare: input => {
          const state = object( input );
          const applyControls = prepareFields( controls, state.controls );
          const applyTools = prepareFields( tools, state.tools );
          const charges = list( state.charges, entry => {
            const { sign } = object( entry );
            if ( sign !== 1 && sign !== -1 ) {
              throw new Error( 'Invalid particle charge.' );
            }
            return { ...parseElement( entry ), sign };
          } );
          const sensors = list( state.sensors, parseElement );
          const contours = list( state.contours, entry => {
            const line = object( entry );
            return { position: point( line.position ), label: point( line.label ) };
          } );
          if ( contours.length && ( !charges.length || contours.some( line =>
            charges.some( charge => charge.position.distance( line.position ) < 0.03 ) ) ) ) {
            throw new Error( 'Invalid equipotential line anchor.' );
          }
          return () => {
            screen.view.interruptSubtreeInput();
            model.clearElectricPotentialLines();
            // Deactivate first so charge listeners update the field with the final charge removed.
            model.chargedParticleGroup.getArray().forEach( charge => { charge.isActiveProperty.value = false; } );
            model.chargedParticleGroup.clear();
            model.electricFieldSensorGroup.clear();
            applyControls();
            charges.forEach( ( { sign, origin, position } ) => {
              const charge = sign === 1 ? model.addPositiveCharge( origin ) : model.addNegativeCharge( origin );
              charge.positionProperty.value = position;
              charge.isActiveProperty.value = true;
            } );
            sensors.forEach( ( { origin, position } ) => {
              const sensor = model.addElectricFieldSensor( origin );
              sensor.positionProperty.value = position;
              sensor.isActiveProperty.value = true;
            } );
            applyTools();
            contours.forEach( ( { position, label } ) => {
              const line = model.electricPotentialLineGroup.createNextElement( position );
              line.voltageLabelPositionProperty.value = label;
            } );
          };
        }
      } ]
    };
  } );
}
