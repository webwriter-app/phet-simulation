// Area Model WebWriter adapter. Distributed under GPL-3.0.
import Sim from '../../../joist/js/Sim.js';
import { areaModelState } from './areaModelState.js';
import installSimulationBridge from './installSimulationBridge.js';

const screenIds = [ 'explore', 'generic', 'game' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-area-model-multiplication/v1',
    build: 'area-model-multiplication@1.4.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...areaModelState( screen ) } ) )
  } ) );
}
