// Molarity WebWriter adapter. Distributed under GPL-3.0.
import Sim from '../../../joist/js/Sim.js';
import Checkbox from '../../../sun/js/Checkbox.js';
import MolarityConstants from '../molarity/MolarityConstants.js';
import MolarityModel from '../molarity/model/MolarityModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, prepareFields, readFields } from './stateFields.js';

const soluteIds = [
  'drink-mix', 'cobalt-ii-nitrate', 'cobalt-chloride', 'potassium-dichromate', 'gold-iii-chloride',
  'potassium-chromate', 'nickel-ii-chloride', 'copper-sulfate', 'potassium-permanganate'
];

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as MolarityModel;
    const { solution } = model;
    const values = screen.view[ 'pdomControlAreaNode' ].pdomOrder!.find( node => node instanceof Checkbox ) as Checkbox;
    const fields = {
      solute: field( solution.soluteProperty, value => soluteIds[ model.solutes.indexOf( value ) ],
        value => typeof value === 'string' ? model.solutes[ soluteIds.indexOf( value ) ] : undefined ),
      amount: number( solution.soluteAmountProperty, false, value => MolarityConstants.SOLUTE_AMOUNT_RANGE.contains( value ) ),
      volume: number( solution.volumeProperty, false, value => MolarityConstants.SOLUTION_VOLUME_RANGE.contains( value ) ),
      values: boolean( values.property )
    };
    return {
      bridge: 'webwriter-molarity/v1',
      build: 'molarity@1.6.0-dev.6-webwriter.1',
      screens: [ {
        id: 'solution',
        screen,
        read: () => readFields( fields ),
        prepare: input => {
          const apply = prepareFields( fields, input );
          return () => {
            screen.view.interruptSubtreeInput();
            apply();
          };
        }
      } ]
    };
  } );
}
