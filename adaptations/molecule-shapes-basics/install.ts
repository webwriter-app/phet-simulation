// State adapter for PhET molecule-shapes-basics. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installMoleculeShapesState from './moleculeShapesState.js';

export default function install( sim: Sim ) {
  installMoleculeShapesState( sim, true );
}
