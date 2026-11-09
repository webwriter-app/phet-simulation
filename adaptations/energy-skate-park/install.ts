// Energy Skate Park WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installEnergySkateParkState from './energySkateParkState.js';

export default function installWebWriter( sim: Sim ): void {
  installEnergySkateParkState( sim, 'energy-skate-park', '1.4.0-dev.1', [ 'intro', 'measure', 'graphs', 'playground' ] );
}
