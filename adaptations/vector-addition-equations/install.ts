// Vector Addition WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installSimulationBridge from './installSimulationBridge.js';
import { prepareFields, readFields } from './stateFields.js';
import { vectorAdditionPreferences, vectorAdditionState } from './vectorAdditionState.js';

const screenIds = [ 'equations' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-vector-addition-equations/v1',
    build: 'vector-addition-equations@1.3.0-dev.0-webwriter.1',
    readPreferences: () => readFields( vectorAdditionPreferences ),
    preparePreferences: input => prepareFields( vectorAdditionPreferences, input ),
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...vectorAdditionState( screen ) } ) )
  } ) );
}
