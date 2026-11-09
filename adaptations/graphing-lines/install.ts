// Graphing Lines WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installGraphingLinesState from './graphingLinesState.js';

export default function installWebWriter( sim: Sim ): void {
  installGraphingLinesState( sim, 'graphing-lines', '1.5.0-dev.0', [ 'slope', 'slope-intercept', 'point-slope', 'line-game' ] );
}
