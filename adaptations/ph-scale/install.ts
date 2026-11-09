// pH Scale WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installPHScaleState from './phScaleState.js';

export default function installWebWriter( sim: Sim ): void {
  installPHScaleState( sim, 'ph-scale' );
}
