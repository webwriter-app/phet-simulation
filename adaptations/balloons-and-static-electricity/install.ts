// Balloons and Static Electricity WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import Vector2 from '../../../dot/js/Vector2.js';
import type BASEModel from '../balloons-and-static-electricity/model/BASEModel.js';
import { ShowChargesConstValues } from '../balloons-and-static-electricity/model/ShowChargesValues.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, object, prepareFields, readFields, vector } from './stateFields.js';

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as BASEModel;
    const controls = {
      charges: field( model.showChargesProperty, value => value,
        input => ShowChargesConstValues.find( value => value === input ) ),
      wallVisible: boolean( model.wall.isVisibleProperty ),
      secondBalloonVisible: boolean( model.greenBalloon.isVisibleProperty )
    };
    const charges = model.sweater.minusCharges;
    const balloons = model.balloons.map( balloon => ( {
      position: vector( balloon.positionProperty ),
      velocity: vector( balloon.velocityProperty )
    } ) );
    return {
      bridge: 'webwriter-balloons-and-static-electricity/v1',
      build: 'balloons-and-static-electricity@1.6.0-dev.4-webwriter.1',
      screens: [ {
        id: 'balloons',
        screen,
        isPlaying: () => model.balloons.some( balloon => balloon.isVisibleProperty.value &&
          balloon.velocityProperty.value.magnitudeSquared > 1e-10 ),
        read: () => ( {
          ...readFields( controls ),
          removedCharges: charges.flatMap( ( charge, index ) => charge.movedProperty.value ? [ index ] : [] ),
          balloons: balloons.map( ( fields, index ) => ( {
            position: fields.position.read(),
            velocity: fields.velocity.read(),
            charge: model.balloons[ index ].chargeProperty.value,
            releaseTime: model.balloons[ index ].timeSinceRelease
          } ) )
        } ),
        prepare: input => {
          const state = object( input );
          const applyControls = prepareFields( controls, state );
          const removed = state.removedCharges;
          if ( !Array.isArray( removed ) || new Set( removed ).size !== removed.length ||
               !removed.every( index => Number.isInteger( index ) && index >= 0 && index < charges.length ) ||
               !Array.isArray( state.balloons ) || state.balloons.length !== balloons.length ) {
            throw new Error( 'Invalid static electricity charge or balloon count.' );
          }
          const saved = state.balloons.map( object );
          let remaining = removed.length;
          const applyBalloons = balloons.map( ( fields, index ) => {
            const balloon = model.balloons[ index ];
            const { position, charge, releaseTime } = saved[ index ];
            const apply = prepareFields( { position: fields.position, velocity: fields.velocity }, saved[ index ] );
            const width = model.width - ( state.wallVisible ? model.wallWidth : 0 );
            if ( !Array.isArray( position ) || position[ 0 ] < 0 || position[ 1 ] < 0 ||
                 position[ 0 ] + balloon.width > width + 1e-8 || position[ 1 ] + balloon.height > model.height + 1e-8 ||
                 typeof charge !== 'number' || !Number.isInteger( charge ) || charge > 0 || -charge > remaining ||
                 typeof releaseTime !== 'number' || !Number.isFinite( releaseTime ) || releaseTime < 0 ) {
              throw new Error( 'Invalid static electricity balloon state.' );
            }
            const assigned = removed.slice( removed.length - remaining, removed.length - remaining - charge );
            remaining += charge;
            return () => {
              assigned.forEach( chargeIndex => model.sweater.moveChargeTo( charges[ chargeIndex ], balloon ) );
              apply();
              balloon.timeSinceRelease = releaseTime;
              balloon.oldPosition = balloon.positionProperty.value.copy();
              balloon.dragVelocityProperty.value = Vector2.ZERO;
            };
          } );
          if ( remaining !== 0 ) {
            throw new Error( 'The balloon charges do not account for the sweater charges.' );
          }
          return () => {
            screen.view.interruptSubtreeInput();
            model.reset();
            applyControls();
            applyBalloons.forEach( apply => apply() );
          };
        }
      } ]
    };
  } );
}
