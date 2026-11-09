// Fractions Intro family state bindings. Distributed under GPL-3.0.
import type IntroModel from '../../../fractions-common/js/intro/model/IntroModel.js';
import type { AnyScreen } from '../Screen.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

export default function fractionIntroState( screen: AnyScreen ) {
  const model = screen.model as IntroModel;
  const fields = {
    representation: field( model.representationProperty, value => String( value ), input =>
      model.representations.find( value => String( value ) === input ) ),
    denominator: number( model.denominatorProperty, true ),
    containerCount: number( model.containerCountProperty, true ),
    ...( model.allowMixedNumbers ? {
      showMixed: boolean( model.showMixedNumbersProperty ),
      mixedExpanded: boolean( model.mixedNumbersBoxExpandedProperty )
    } : {} )
  };

  return {
    isPlaying: () => model.pieces.some( piece => !!piece.destinationCell ),
    read: () => ( {
      ...readFields( fields ),
      numerator: model.numeratorProperty.value,
      containers: model.containers.map( container => container.cells.map( cell => cell.isFilledProperty.value ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const { numerator, containers } = state;
      if ( typeof numerator !== 'number' || !Number.isInteger( numerator ) || !model.numeratorProperty.range.contains( numerator ) ||
           !Array.isArray( containers ) || containers.length !== state.containerCount ||
           !containers.every( cells => Array.isArray( cells ) && cells.length === state.denominator &&
             cells.every( value => typeof value === 'boolean' ) ) ||
           numerator !== containers.flat().filter( Boolean ).length ) {
        throw new Error( 'Invalid fraction fill pattern.' );
      }
      return () => {
        screen.view.interruptSubtreeInput();
        model.completeAllPieces();
        model.numeratorProperty.value = 0;
        model.completeAllPieces();
        apply();
        model.containers.forEach( ( container, index ) => {
          container.cells.forEach( ( cell, cellIndex ) => cell.setFilled( containers[ index ][ cellIndex ] ) );
        } );
        model.changeNumeratorManually( numerator );
      };
    }
  };
}
