// Circuit Construction Kit WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installCircuitState from './circuitState.js';

export default function installWebWriter( sim: Sim ): void {
  installCircuitState( sim, 'circuit-construction-kit-ac-virtual-lab', '1.1.0-dev.0', [ 'lab' ] );
}
