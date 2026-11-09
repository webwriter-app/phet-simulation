// Fraction Matcher WebWriter adapter. Distributed under GPL-3.0.
import Sim from '../../../joist/js/Sim.js';
import { fractionMatchingState } from './fractionMatchingState.js';
import installSimulationBridge from './installSimulationBridge.js';

const screenIds = [ 'fractions', 'mixed-numbers' ];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-fraction-matcher/v1',
    build: 'fraction-matcher@1.3.0-dev.2-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...fractionMatchingState( screen ) } ) )
  } ) );
}
