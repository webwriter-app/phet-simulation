// Geometric Optics WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import { geometricOpticsPreferences, geometricOpticsState } from './geometricOpticsState.js';
import installSimulationBridge from './installSimulationBridge.js';
import { prepareFields, readFields } from './stateFields.js';

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const [ lens, mirror ] = sim.simScreens;
    return {
      bridge: 'webwriter-geometric-optics/v1',
      build: 'geometric-optics@1.4.0-dev.2-webwriter.1',
      screens: [
        { id: 'lens', screen: lens, ...geometricOpticsState( lens ) },
        { id: 'mirror', screen: mirror, ...geometricOpticsState( mirror ) }
      ],
      readPreferences: () => readFields( geometricOpticsPreferences ),
      preparePreferences: input => prepareFields( geometricOpticsPreferences, input )
    };
  } );
}
