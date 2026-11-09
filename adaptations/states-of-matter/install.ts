// States of Matter WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import atomicInteractionsState from './atomicInteractionsState.js';
import installSimulationBridge from './installSimulationBridge.js';
import statesOfMatterState from './statesOfMatterState.js';

const screenIds = [ 'states', 'phase-changes', 'atomic-interactions' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-states-of-matter/v1',
    build: 'states-of-matter@1.3.0-dev.3-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( {
      id: screenIds[ index ],
      screen,
      ...( index === 2 ? atomicInteractionsState( screen ) : statesOfMatterState( screen, index === 1 ) )
    } ) )
  } ) );
}
