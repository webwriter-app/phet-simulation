// Graphing Slope-Intercept WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installGraphingLinesState from './graphingLinesState.js';

export default function installWebWriter( sim: Sim ): void {
  installGraphingLinesState( sim, 'graphing-slope-intercept', '1.3.0-dev.0', [ 'slope-intercept', 'line-game' ] );
}
