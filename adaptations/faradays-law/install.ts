// Faraday's Law WebWriter adapter. Distributed under GPL-3.0.
import Bounds2 from '../../../dot/js/Bounds2.js';
import Vector2 from '../../../dot/js/Vector2.js';
import Sim from '../../../joist/js/Sim.js';
import FaradaysLawModel from '../faradays-law/model/FaradaysLawModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields } from './stateFields.js';

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as FaradaysLawModel;
    const { magnet, voltmeter } = model;
    const controls = {
      topCoil: boolean( model.topCoilVisibleProperty ),
      arrows: boolean( model.magnetArrowsVisibleProperty ),
      voltmeter: boolean( model.voltmeterVisibleProperty ),
      fieldLines: boolean( magnet.fieldLinesVisibleProperty ),
      orientation: enumeration( magnet.orientationProperty )
    };
    const motion = {
      voltage: number( model.voltageProperty ),
      signal: number( voltmeter.signalProperty )
    };
    const coils = [ model.bottomCoil, model.topCoil ].map( coil => ( {
      field: number( coil.magneticFieldProperty, false, value => Math.abs( value ) <= 2 ),
      previousField: number( coil.previousMagneticFieldProperty, false, value => Math.abs( value ) <= 2 ),
      emf: number( coil.emfProperty )
    } ) );
    return {
      bridge: 'webwriter-faradays-law/v1',
      build: 'faradays-law@1.5.0-dev.3-webwriter.1',
      screens: [ {
        id: 'induction',
        screen,
        isPlaying: () => model.voltageProperty.value !== 0 || voltmeter.needleAngularVelocity !== 0,
        read: () => ( {
          ...readFields( controls ),
          ...readFields( motion ),
          position: [ magnet.positionProperty.value.x, magnet.positionProperty.value.y ],
          velocity: voltmeter.needleAngularVelocity,
          acceleration: voltmeter.needleAngularAcceleration,
          coils: coils.map( readFields )
        } ),
        prepare: ( input: unknown ) => {
          const state = object( input );
          const applyControls = prepareFields( controls, state );
          const applyMotion = prepareFields( motion, state );
          const { position, velocity, acceleration } = state;
          if ( !Array.isArray( position ) || position.length !== 2 || !position.every( Number.isFinite ) ||
               typeof velocity !== 'number' || !Number.isFinite( velocity ) ||
               typeof acceleration !== 'number' || !Number.isFinite( acceleration ) ||
               !Array.isArray( state.coils ) || state.coils.length !== coils.length ) {
            throw new Error( 'Invalid Faraday’s Law state.' );
          }
          const point = new Vector2( position[ 0 ], position[ 1 ] );
          const bounds = Bounds2.point( point ).dilatedXY( magnet.width / 2, magnet.height / 2 );
          const restricted = state.topCoil ?
            model.bottomCoilRestrictedBounds.concat( model.topCoilRestrictedBounds ) :
            model.bottomCoilRestrictedBounds;
          if ( !model.bounds.dilated( 1e-7 ).containsBounds( bounds ) || restricted.some( obstacle => {
            const overlap = obstacle.intersection( bounds );
            return overlap.width > 1e-7 && overlap.height > 1e-7;
          } ) ) {
            throw new Error( 'The saved magnet overlaps an obstacle.' );
          }
          const coilStates = state.coils;
          const applyCoils = coils.map( ( fields, i ) => prepareFields( fields, coilStates[ i ] ) );
          return () => {
            screen.view.interruptSubtreeInput();
            model.reset();
            applyControls();
            magnet.positionProperty.value = point;
            applyCoils.forEach( apply => apply() );
            applyMotion();
            voltmeter.needleAngularVelocity = velocity;
            voltmeter.needleAngularAcceleration = acceleration;
          };
        }
      } ]
    };
  } );
}
