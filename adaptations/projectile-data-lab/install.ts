// Projectile Data Lab WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import installSimulationBridge from './installSimulationBridge.js';
import { projectileDataLabPreferences, projectileDataLabScreenState } from './projectileDataLabState.js';
import { prepareFields, readFields } from './stateFields.js';

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'variability', 'sources', 'measures', 'sampling' ] as const;
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-projectile-data-lab/v1',
    build: 'projectile-data-lab@1.1.0-dev.8-webwriter.1',
    readPreferences: () => readFields( projectileDataLabPreferences ),
    preparePreferences: input => prepareFields( projectileDataLabPreferences, input ),
    screens: sim.simScreens.map( ( screen, index ) => projectileDataLabScreenState( screen, ids[ index ] ) )
  } ) );
}
