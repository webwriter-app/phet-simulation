// Fractions: Equality WebWriter adapter. Distributed under GPL-3.0.
import EqualityLabModel from '../../../fractions-common/js/intro/model/EqualityLabModel.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Sim from '../../../joist/js/Sim.js';
import { fractionMatchingState } from './fractionMatchingState.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

function labState( screen: AnyScreen ) {
  const model = screen.model as EqualityLabModel;
  const fields = {
    representation: field( model.representationProperty, value => model.representations.indexOf( value ),
      value => typeof value === 'number' && Number.isInteger( value ) ? model.representations[ value ] : undefined ),
    containerCount: number( model.containerCountProperty, true ),
    denominator: number( model.denominatorProperty, true ),
    multiplier: number( model.multiplierProperty, true ),
    numberLine: boolean( model.showNumberLineProperty )
  };
  return {
    read: () => ( {
      ...readFields( fields ),
      cells: model.containers.map( container => container.cells.map( cell => cell.isFilledProperty.value ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const cells = state.cells;
      if ( !Array.isArray( cells ) || cells.length !== state.containerCount ||
           !cells.every( row => Array.isArray( row ) && row.length === state.denominator &&
                          row.every( value => typeof value === 'boolean' ) ) ) {
        throw new Error( 'Invalid Fractions: Equality cells.' );
      }
      const filled = cells.reduce( ( sum, row ) => sum + row.filter( Boolean ).length, 0 );
      return () => {
        screen.view.interruptSubtreeInput();
        model.completeAllPieces();
        model.containers.forEach( container => container.cells.forEach( cell => cell.setFilled( false ) ) );
        model.changeNumeratorManually( -model.numeratorProperty.value );
        applyFields();
        model.containers.forEach( ( container, i ) =>
          container.cells.forEach( ( cell, j ) => cell.setFilled( cells[ i ][ j ] ) ) );
        model.changeNumeratorManually( filled );
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-fractions-equality/v1',
    build: 'fractions-equality@1.2.0-dev.0-webwriter.1',
    screens: [
      { id: 'equality-lab', screen: sim.simScreens[ 0 ], ...labState( sim.simScreens[ 0 ] ) },
      { id: 'game', screen: sim.simScreens[ 1 ], ...fractionMatchingState( sim.simScreens[ 1 ] ) }
    ]
  } ) );
}
