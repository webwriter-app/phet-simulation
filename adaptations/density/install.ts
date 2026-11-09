// Density WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installBuoyancyState from './buoyancyState.js';

export default function installWebWriter( sim: Sim ): void {
  installBuoyancyState( sim, 'density', '1.3.0-dev.0', [ 'intro', 'compare', 'mystery' ] );
}
