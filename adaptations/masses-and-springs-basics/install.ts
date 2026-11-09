// PhET Masses and Springs adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import springScreenState from './springState.js';
import installSimulationBridge from './installSimulationBridge.js';

const screenIds = [ 'stretch', 'bounce', 'lab' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-masses-and-springs-basics/v1',
    build: 'masses-and-springs-basics@1.1.0-dev.1-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...springScreenState( screen ) } ) )
  } ) );
}
