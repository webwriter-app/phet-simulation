// Function Builder: Basics WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import functionBuilderState from './functionBuilderState.js';
import installSimulationBridge from './installSimulationBridge.js';

const screenIds = [ 'patterns', 'mystery', 'test' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-function-builder-basics/v1',
    build: 'function-builder-basics@1.3.0-dev.2-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( {
      id: screenIds[ index ],
      screen,
      ...( index < 2 ? functionBuilderState( screen ) : { read: () => ( {} ), prepare: () => () => {} } )
    } ) )
  } ) );
}
