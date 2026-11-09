// Function Builder WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import functionBuilderState from './functionBuilderState.js';
import installSimulationBridge from './installSimulationBridge.js';

const screenIds = [ 'patterns', 'numbers', 'equations', 'mystery', 'test' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-function-builder/v1',
    build: 'function-builder@1.3.0-dev.3-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( {
      id: screenIds[ index ],
      screen,
      ...( index < 4 ? functionBuilderState( screen ) : { read: () => ( {} ), prepare: () => () => {} } )
    } ) )
  } ) );
}
