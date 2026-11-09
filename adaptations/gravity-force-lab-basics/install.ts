// Gravity Force Lab: Basics WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import type GFLBModel from '../model/GFLBModel.js';
import installGravityForceState from './gravityForceState.js';
import { boolean } from './stateFields.js';

export default function installWebWriter( sim: Sim ): void {
  installGravityForceState( sim, 'gravity-force-lab-basics', '1.2.0-dev.0', ( model: GFLBModel ) => ( {
    constantSize: boolean( model.constantRadiusProperty ),
    distance: boolean( model.showDistanceProperty ),
    forceValues: boolean( model.showForceValuesProperty )
  } ) );
}
