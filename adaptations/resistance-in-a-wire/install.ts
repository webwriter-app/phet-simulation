// State adapter for PhET Resistance in a Wire. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import type ResistanceInAWireModel from '../resistance-in-a-wire/model/ResistanceInAWireModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { number, prepareFields, readFields } from './stateFields.js';

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as ResistanceInAWireModel;
    const fields = {
      resistivity: number( model.resistivityProperty ),
      length: number( model.lengthProperty ),
      area: number( model.areaProperty )
    };
    return {
      bridge: 'webwriter-resistance-in-a-wire/v1',
      build: 'resistance-in-a-wire@1.7.0-dev.5-webwriter.1',
      screens: [ {
        id: 'wire',
        screen,
        read: () => readFields( fields ),
        prepare: ( input: unknown ) => {
          const apply = prepareFields( fields, input );
          return () => { screen.view.interruptSubtreeInput(); apply(); };
        }
      } ]
    };
  } );
}
