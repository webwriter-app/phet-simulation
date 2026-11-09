// Gravity Force Lab WebWriter adapter. Distributed under GPL-3.0.
import ForceValuesDisplayEnum from '../../../inverse-square-law-common/js/model/ForceValuesDisplayEnum.js';
import type Sim from '../../../joist/js/Sim.js';
import type GravityForceLabModel from '../model/GravityForceLabModel.js';
import installGravityForceState from './gravityForceState.js';
import { boolean, field, vector } from './stateFields.js';

export default function installWebWriter( sim: Sim ): void {
  installGravityForceState( sim, 'gravity-force-lab', '2.3.0-dev.5', ( model: GravityForceLabModel ) => ( {
    constantSize: boolean( model.constantRadiusProperty ),
    ruler: vector( model.rulerPositionProperty ),
    forceDisplay: field( model.forceValuesDisplayProperty, value => String( value ), value =>
      ForceValuesDisplayEnum.VALUES.find( item => String( item ) === value ) )
  } ) );
}
