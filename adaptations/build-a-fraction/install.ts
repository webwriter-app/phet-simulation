// Build a Fraction WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import { fractionGameState, fractionLabState } from './fractionBuildingState.js';
import installSimulationBridge from './installSimulationBridge.js';

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const [ build, mixed, lab ] = sim.simScreens;
    return {
      bridge: 'webwriter-build-a-fraction/v1',
      build: 'build-a-fraction@1.1.0-dev.0-webwriter.1',
      screens: [
        { id: 'build-a-fraction', screen: build, ...fractionGameState( build ) },
        { id: 'mixed-numbers', screen: mixed, ...fractionGameState( mixed ) },
        { id: 'lab', screen: lab, ...fractionLabState( lab ) }
      ]
    };
  } );
}
