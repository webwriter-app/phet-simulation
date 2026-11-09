// PhET fractions simulation WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import { fractionGameState, fractionLabState } from './fractionBuildingState.js';
import fractionIntroState from './fractionIntroState.js';
import installSimulationBridge from './installSimulationBridge.js';

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const [ intro, game, lab ] = sim.simScreens;
    return {
      bridge: 'webwriter-fractions-mixed-numbers/v1',
      build: 'fractions-mixed-numbers@1.1.0-dev.1-webwriter.1',
      screens: [
        { id: 'intro', screen: intro, ...fractionIntroState( intro ) },
        { id: 'game', screen: game, ...fractionGameState( game ) },
        { id: 'lab', screen: lab, ...fractionLabState( lab ) }
      ]
    };
  } );
}
