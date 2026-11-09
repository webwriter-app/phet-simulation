// Vector Addition WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installSimulationBridge from './installSimulationBridge.js';
import { prepareFields, readFields } from './stateFields.js';
import { vectorAdditionPreferences, vectorAdditionState } from './vectorAdditionState.js';

const screenIds = [ 'explore-1d', 'explore-2d', 'lab', 'equations' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-vector-addition/v1',
    build: 'vector-addition@1.3.0-dev.0-webwriter.1',
    readPreferences: () => readFields( vectorAdditionPreferences ),
    preparePreferences: input => prepareFields( vectorAdditionPreferences, input ),
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...vectorAdditionState( screen ) } ) )
  } ) );
}
