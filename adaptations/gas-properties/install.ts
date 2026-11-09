// PhET gas simulation WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import gasState, { gasPreferences } from './gasState.js';
import installSimulationBridge from './installSimulationBridge.js';
import { prepareFields, readFields } from './stateFields.js';

const screenIds = [ 'ideal', 'explore', 'energy', 'diffusion' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-gas-properties/v1',
    build: 'gas-properties@1.2.0-dev.9-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...gasState( screen ) } ) ),
    readPreferences: () => readFields( gasPreferences ),
    preparePreferences: input => prepareFields( gasPreferences, input )
  } ) );
}
