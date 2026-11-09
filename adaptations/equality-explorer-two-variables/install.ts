// Equality Explorer WebWriter adapter. Distributed under GPL-3.0.
import Sim from '../../../joist/js/Sim.js';
import { equalityExplorerState } from './equalityExplorerState.js';
import installSimulationBridge from './installSimulationBridge.js';

const screenIds = [ 'two-variables' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-equality-explorer-two-variables/v1',
    build: 'equality-explorer-two-variables@1.3.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...equalityExplorerState( screen ) } ) )
  } ) );
}
