// Ohm's Law WebWriter adapter. Distributed under GPL-3.0.
import Sim from '../../../joist/js/Sim.js';
import CurrentUnit from '../ohms-law/model/CurrentUnit.js';
import installSimulationBridge from './installSimulationBridge.js';
import { field, number, prepareFields, readFields } from './stateFields.js';

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model;
    const fields = {
      voltage: number( model.voltageProperty ),
      resistance: number( model.resistanceProperty ),
      currentUnit: field( model.currentUnitsProperty, unit => unit === CurrentUnit.AMPS ? 'amps' : 'milliamps', value => {
        if ( value === 'amps' ) { return CurrentUnit.AMPS; }
        if ( value === 'milliamps' ) { return CurrentUnit.MILLIAMPS; }
        return undefined;
      } )
    };
    return {
      bridge: 'webwriter-ohms-law/v1',
      build: 'ohms-law@1.5.0-dev.6-webwriter.1',
      screens: [ {
        id: 'circuit',
        screen,
        read: () => readFields( fields ),
        prepare: state => {
          const apply = prepareFields( fields, state );
          return () => {
            screen.view.interruptSubtreeInput();
            apply();
          };
        }
      } ]
    };
  } );
}
