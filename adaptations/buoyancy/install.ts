// Buoyancy WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installBuoyancyState from './buoyancyState.js';

export default function installWebWriter( sim: Sim ): void {
  installBuoyancyState( sim, 'buoyancy', '1.3.0-dev.2', [ 'compare', 'explore', 'lab', 'shapes', 'applications' ] );
}
