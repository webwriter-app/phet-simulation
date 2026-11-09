// Atomic Interactions WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import atomicInteractionsState from './atomicInteractionsState.js';
import installSimulationBridge from './installSimulationBridge.js';

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    return {
      bridge: 'webwriter-atomic-interactions/v1',
      build: 'atomic-interactions@1.3.0-dev.0-webwriter.1',
      screens: [ { id: 'atomic-interactions', screen, ...atomicInteractionsState( screen ) } ]
    };
  } );
}
