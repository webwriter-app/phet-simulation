// Geometric Optics: Basics WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import { geometricOpticsPreferences, geometricOpticsState } from './geometricOpticsState.js';
import installSimulationBridge from './installSimulationBridge.js';
import { prepareFields, readFields } from './stateFields.js';

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'lens', 'mirror' ];
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-geometric-optics-basics/v1',
    build: 'geometric-optics-basics@1.4.0-dev.1-webwriter.1',
    readPreferences: () => readFields( geometricOpticsPreferences ),
    preparePreferences: input => prepareFields( geometricOpticsPreferences, input ),
    screens: sim.simScreens.map( ( screen, i ) => ( { id: ids[ i ], screen, ...geometricOpticsState( screen ) } ) )
  } ) );
}
