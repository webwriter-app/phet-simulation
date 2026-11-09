// States of Matter WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installSimulationBridge from './installSimulationBridge.js';
import statesOfMatterState from './statesOfMatterState.js';

const screenIds = [ 'states', 'phase-changes' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-states-of-matter-basics/v1',
    build: 'states-of-matter-basics@1.3.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( {
      id: screenIds[ index ],
      screen,
      ...statesOfMatterState( screen, false )
    } ) )
  } ) );
}
