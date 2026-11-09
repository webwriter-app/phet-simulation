// Energy Skate Park: Basics WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installEnergySkateParkState from './energySkateParkState.js';

export default function installWebWriter( sim: Sim ): void {
  installEnergySkateParkState( sim, 'energy-skate-park-basics', '1.5.0-dev.2', [ 'intro', 'friction', 'playground' ] );
}
