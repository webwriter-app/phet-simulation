// State bindings shared by Quantum Coin Toss and Quantum Measurement. Distributed under GPL-3.0.
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type CoinSet from '../../../quantum-measurement/js/coins/model/CoinSet.js';
import { MAX_COINS } from '../../../quantum-measurement/js/coins/model/CoinsExperimentSceneModel.js';
import type CoinsExperimentSceneModel from '../../../quantum-measurement/js/coins/model/CoinsExperimentSceneModel.js';
import type CoinsModel from '../../../quantum-measurement/js/coins/model/CoinsModel.js';
import QuantumMeasurementPreferences from '../../../quantum-measurement/js/common/model/QuantumMeasurementPreferences.js';
import { SystemType } from '../../../quantum-measurement/js/common/model/SystemType.js';
import { writableIsSettingPhetioStateProperty } from '../../../tandem/js/isSettingPhetioStateProperty.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

export function quantumPreferences( includesBlochSphere: boolean ) {
  const preferences = QuantumMeasurementPreferences.getInstance();
  return {
    classicalCoinsStartHidden: boolean( preferences.classicalCoinsStartHiddenProperty ),
    ...( includesBlochSphere ? { showGlobalPhase: boolean( preferences.showGlobalPhaseProperty ) } : {} )
  };
}

function bindSet( set: CoinSet, single: boolean ) {
  const fields = {
    count: field( set.numberOfCoinsProperty, value => value,
      input => input === 1 && single ? 1 : set.numberOfCoinsProperty.validValues?.find( value => value === input ) ),
    seed: number( set.seedProperty ),
    measurement: field( set.measurementStateProperty, value => value === 'preparingToBeMeasured' ?
      set.coinType === SystemType.CLASSICAL ? 'measuredAndHidden' : 'readyToBeMeasured' : value,
      input => set.measurementStateProperty.validValues?.find( value => value === input && value !== 'preparingToBeMeasured' ) )
  };
  return {
    read: () => ( {
      ...readFields( fields ),
      outcomes: set.measuredValues.slice( 0, set.numberOfCoinsProperty.value ).map( value => set.validValues.indexOf( value ) ).join( '' )
    } ),
    prepare: ( input: unknown ) => {
      const data = object( input );
      const apply = prepareFields( fields, data );
      if ( typeof data.outcomes !== 'string' || data.outcomes.length !== data.count ||
           data.outcomes.length > MAX_COINS || !/^[01]+$/.test( data.outcomes ) ) {
        throw new Error( 'Invalid Quantum Coin measurement outcomes.' );
      }
      const values = Array.from( data.outcomes, value => set.validValues[ Number( value ) ] );
      return () => {
        apply();
        values.forEach( ( value, i ) => { set.measuredValues[ i ] = value; } );
        set.measuredDataChangedEmitter.emit();
      };
    }
  };
}

function bindScene( scene: CoinsExperimentSceneModel ) {
  const fields = {
    initial: enumeration( scene.initialCoinStateProperty ),
    probability: number( scene.upProbabilityProperty ),
    preparing: boolean( scene.preparingExperimentProperty )
  };
  const single = bindSet( scene.singleCoin, true );
  const multiple = bindSet( scene.coinSet, false );
  return {
    read: () => ( { ...readFields( fields ), single: single.read(), multiple: multiple.read() } ),
    prepare: ( input: unknown ) => {
      const data = object( input );
      const apply = prepareFields( fields, data );
      if ( scene.systemType === SystemType.QUANTUM && !data.preparing &&
           data.initial !== ( data.probability === 0 ? 'down' : data.probability === 1 ? 'up' : 'superposition' ) ) {
        throw new Error( 'Inconsistent quantum coin preparation.' );
      }
      const applySingle = single.prepare( data.single );
      const applyMultiple = multiple.prepare( data.multiple );
      return () => {
        apply();
        applySingle();
        applyMultiple();
      };
    }
  };
}

export function coinsState( screen: AnyScreen ) {
  const model = screen.model as CoinsModel;
  const classical = bindScene( model.classicalCoinExperimentSceneModel );
  const quantum = bindScene( model.quantumCoinExperimentSceneModel );
  const fields = { mode: enumeration( model.experimentModeProperty ) };
  return {
    id: 'coins',
    screen,
    isPlaying: () => {
      const scene = model.experimentModeProperty.value === SystemType.CLASSICAL ?
                    model.classicalCoinExperimentSceneModel : model.quantumCoinExperimentSceneModel;
      return [ scene.singleCoin, scene.coinSet ].some( set => set.measurementStateProperty.value === 'preparingToBeMeasured' );
    },
    read: () => ( { ...readFields( fields ), classical: classical.read(), quantum: quantum.read() } ),
    prepare: ( input: unknown ) => {
      const data = object( input );
      const apply = prepareFields( fields, data );
      const applyClassical = classical.prepare( data.classical );
      const applyQuantum = quantum.prepare( data.quantum );
      return () => {
        screen.view.interruptSubtreeInput();
        const previous = writableIsSettingPhetioStateProperty.value;
        writableIsSettingPhetioStateProperty.value = true;
        try {
          apply();
          applyClassical();
          applyQuantum();
        }
        finally { writableIsSettingPhetioStateProperty.value = previous; }
      };
    }
  };
}
