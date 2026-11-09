// PhET gas simulation WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import gasState, { gasPreferences } from './gasState.js';
import installSimulationBridge from './installSimulationBridge.js';
import { prepareFields, readFields } from './stateFields.js';

const screenIds = [ 'intro', 'laws' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-gases-intro/v1',
    build: 'gases-intro@1.2.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...gasState( screen ) } ) ),
    readPreferences: () => readFields( gasPreferences ),
    preparePreferences: input => prepareFields( gasPreferences, input )
  } ) );
}
