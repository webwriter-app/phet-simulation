// Magnets and Electromagnets WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import type FELPreferences from '../../../faradays-electromagnetic-lab/js/common/model/FELPreferences.js';
import { felPreferences, felState } from './felState.js';
import installSimulationBridge from './installSimulationBridge.js';
import { prepareFields, readFields } from './stateFields.js';

const screenIds = [ 'bar-magnet', 'electromagnet' ];

export default function installWebWriter( sim: Sim, preferences: FELPreferences ): void {
  const fields = felPreferences( preferences );
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-magnets-and-electromagnets/v1',
    build: 'magnets-and-electromagnets@1.1.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...felState( screen ) } ) ),
    readPreferences: () => readFields( fields ),
    preparePreferences: input => prepareFields( fields, input )
  } ) );
}
