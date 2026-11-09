// Waves Intro WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installSimulationBridge from './installSimulationBridge.js';
import { wavesState } from './waveInterferenceState.js';

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'water', 'sound', 'light' ];
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-waves-intro/v1',
    build: 'waves-intro@1.2.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: ids[ index ], screen, ...wavesState( screen ) } ) )
  } ) );
}
