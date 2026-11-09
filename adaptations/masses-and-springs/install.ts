// PhET Masses and Springs adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import springScreenState from './springState.js';
import installSimulationBridge from './installSimulationBridge.js';

const screenIds = [ 'intro', 'vectors', 'energy', 'lab' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-masses-and-springs/v1',
    build: 'masses-and-springs@1.1.0-dev.2-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...springScreenState( screen ) } ) )
  } ) );
}
