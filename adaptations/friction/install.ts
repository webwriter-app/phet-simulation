// Friction WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import Vector2 from '../../../dot/js/Vector2.js';
import { writableIsSettingPhetioStateProperty } from '../../../tandem/js/isSettingPhetioStateProperty.js';
import FrictionModel from '../friction/model/FrictionModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, number, object, prepareFields, readFields, vector } from './stateFields.js';

function point( input: unknown, limit: number ) {
  if ( !Array.isArray( input ) || input.length !== 2 ||
       !input.every( value => typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) <= limit ) ) {
    throw new Error( 'Invalid friction atom position or velocity.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as FrictionModel;
    const fields = {
      bookPosition: vector( model.topBookPositionProperty ),
      temperature: number( model.vibrationAmplitudeProperty ),
      distance: number( model.distanceBetweenBooksProperty, false, value => value >= -1 && value < model.height ),
      hint: boolean( model.hintProperty ),
      rubbed: boolean( model.successfullyInteractedWithProperty )
    };
    const rows = model.shearableAtomsByRow;
    const initialRows = model.atomRowsToShearOffProperty.value;
    const initialBounds = model.topBookDragBoundsProperty.value.copy();
    const layerHeight = FrictionModel.MAGNIFIED_ATOMS_INFO.distanceY;
    const atoms = rows.flatMap( row => row );
    const atomIndex = new Map( atoms.map( ( atom, index ) => [ atom, index ] ) );
    return {
      bridge: 'webwriter-friction/v1',
      build: 'friction@1.7.0-dev.0-webwriter.1',
      screens: [ {
        id: 'friction',
        screen,
        isPlaying: () => model.vibrationAmplitudeProperty.value > FrictionModel.VIBRATION_AMPLITUDE_MIN + 0.001 ||
          atoms.some( atom => atom.isShearedOff && Math.abs( atom.centerPosition.x ) < 4 * model.width ),
        read: () => ( {
          ...readFields( fields ),
          rows: model.atomRowsToShearOffProperty.value,
          pendingCooling: model.scheduledShearingAmount,
          sheared: atoms.flatMap( ( atom, index ) => atom.isShearedOff ? [ {
            index,
            center: [ atom.centerPosition.x, atom.centerPosition.y ],
            position: [ atom.positionProperty.value.x, atom.positionProperty.value.y ],
            velocity: [ atom.shearingVelocity.x, atom.shearingVelocity.y ]
          } ] : [] )
        } ),
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( fields, state );
          const { rows: remaining, pendingCooling, sheared } = state;
          const book = point( state.bookPosition, model.width + model.height );
          if ( typeof remaining !== 'number' || !Number.isInteger( remaining ) || remaining < 0 || remaining > initialRows ||
               typeof pendingCooling !== 'number' || !Number.isFinite( pendingCooling ) || pendingCooling < 0 ||
               pendingCooling > FrictionModel.VIBRATION_AMPLITUDE_MAX || !Array.isArray( sheared ) || sheared.length > atoms.length ) {
            throw new Error( 'Invalid sheared atom state.' );
          }
          const maxY = initialBounds.maxY + layerHeight * ( initialRows - remaining );
          if ( book.x < initialBounds.minX || book.x > initialBounds.maxX ||
               book.y < initialBounds.minY || book.y > maxY + 1e-7 ||
               Math.abs( ( state.distance as number ) - ( maxY - book.y ) ) > 1e-7 ) {
            throw new Error( 'Invalid friction book position.' );
          }
          const used = new Set<number>();
          const restored = sheared.map( input => {
            const state = object( input );
            const index = state.index;
            if ( typeof index !== 'number' || !Number.isInteger( index ) || !atoms[ index ] || used.has( index ) ) {
              throw new Error( 'Invalid sheared atom index.' );
            }
            used.add( index );
            return {
              atom: atoms[ index ],
              center: point( state.center, 10 * model.width ),
              position: point( state.position, 10 * model.width ),
              velocity: point( state.velocity, 10 * model.width )
            };
          } );
          rows.forEach( ( row, index ) => {
            const count = row.filter( atom => used.has( atomIndex.get( atom )! ) ).length;
            if ( index >= remaining && index < initialRows && count !== row.length ||
                 index < remaining - 1 && count !== 0 ||
                 index === remaining - 1 && row.length > 0 && count === row.length ||
                 index >= initialRows && count !== 0 ) {
              throw new Error( 'Invalid order of sheared atom rows.' );
            }
          } );
          return () => {
            screen.view.interruptSubtreeInput();
            // Suppress the live friction and shearing listeners while restoring a saved book position and temperature.
            const previous = writableIsSettingPhetioStateProperty.value;
            writableIsSettingPhetioStateProperty.value = true;
            try {
              model.reset();
              apply();
              model.atoms.forEach( atom => {
                const center = atom.isTopAtom ? atom.initialPosition.plus( book ) : atom.initialPosition;
                atom.centerPosition.set( center );
                atom.positionProperty.value = center.copy();
              } );
              restored.forEach( ( { atom, center, position, velocity } ) => {
                atom.isShearedOff = true;
                atom.centerPosition.set( center );
                atom.positionProperty.value = position;
                atom.shearingVelocity.set( velocity );
              } );
              model.atomRowsToShearOffProperty.value = remaining;
              model.numberOfAtomsShearedOffProperty.value = restored.length;
              model.scheduledShearingAmount = pendingCooling;
              model.topBookDragBoundsProperty.value.setMaxY( maxY );
              model.topBookDragBoundsProperty.notifyListenersStatic();
            }
            finally {
              writableIsSettingPhetioStateProperty.value = previous;
            }
          };
        }
      } ]
    };
  } );
}
