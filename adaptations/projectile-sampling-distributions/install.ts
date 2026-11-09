// State adapter for PhET Projectile Sampling Distributions. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import type SamplingScreen from '../../../projectile-data-lab/js/sampling/SamplingScreen.js';
import installSimulationBridge from './installSimulationBridge.js';
import { projectileDataLabPreferences, samplingState } from './projectileDataLabState.js';
import { prepareFields, readFields } from './stateFields.js';

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-projectile-sampling-distributions/v1',
    build: 'projectile-sampling-distributions@1.2.0-dev.3-webwriter.1',
    screens: [ samplingState( sim.simScreens[ 0 ] as SamplingScreen ) ],
    readPreferences: () => readFields( projectileDataLabPreferences ),
    preparePreferences: input => prepareFields( projectileDataLabPreferences, input )
  } ) );
}
