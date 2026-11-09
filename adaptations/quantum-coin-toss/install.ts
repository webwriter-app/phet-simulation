// State adapter for PhET Quantum Coin Toss. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installSimulationBridge from './installSimulationBridge.js';
import { coinsState, quantumPreferences } from './quantumCoinsState.js';
import { prepareFields, readFields } from './stateFields.js';

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => {
    const preferences = quantumPreferences( false );
    return {
      bridge: 'webwriter-quantum-coin-toss/v1',
      build: 'quantum-coin-toss@1.1.0-dev.0-webwriter.1',
      screens: [ coinsState( sim.simScreens[ 0 ] ) ],
      readPreferences: () => readFields( preferences ),
      preparePreferences: input => prepareFields( preferences, input )
    };
  } );
}
