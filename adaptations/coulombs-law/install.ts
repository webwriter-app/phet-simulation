// Coulomb's Law WebWriter adapter. Distributed under GPL-3.0.
import ForceValuesDisplayEnum from '../../../inverse-square-law-common/js/model/ForceValuesDisplayEnum.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type CoulombsLawCommonModel from '../common/model/CoulombsLawCommonModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { field, number, object, prepareFields, readFields, vector } from './stateFields.js';

const displayModes = new Map( [
  [ 'decimal', ForceValuesDisplayEnum.getValue( 'DECIMAL' ) ],
  [ 'scientific', ForceValuesDisplayEnum.getValue( 'SCIENTIFIC' ) ],
  [ 'hidden', ForceValuesDisplayEnum.getValue( 'HIDDEN' ) ]
] );

function screenState( screen: AnyScreen ) {
  const model = screen.model as CoulombsLawCommonModel;
  const fields = {
    leftCharge: number( model.object1.valueProperty ),
    rightCharge: number( model.object2.valueProperty ),
    ruler: vector( model.rulerPositionProperty ),
    forceDisplay: field( model.forceValuesDisplayProperty, value =>
      [ ...displayModes ].find( ( [ , mode ] ) => mode === value )![ 0 ],
      value => typeof value === 'string' ? displayModes.get( value ) : undefined )
  };
  return {
    read: () => ( {
      ...readFields( fields ),
      leftPosition: model.object1.positionProperty.value,
      rightPosition: model.object2.positionProperty.value
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const { leftPosition, rightPosition } = state;
      if ( typeof leftPosition !== 'number' || !Number.isFinite( leftPosition ) ||
           typeof rightPosition !== 'number' || !Number.isFinite( rightPosition ) ||
           leftPosition < model.leftObjectBoundary || rightPosition > model.rightObjectBoundary ||
           rightPosition <= leftPosition ) {
        throw new Error( 'Invalid Coulomb charge positions.' );
      }
      return () => {
        screen.view.interruptSubtreeInput();
        apply();
        // Keep the two positions ordered even while individual Property listeners run.
        if ( leftPosition >= model.object2.positionProperty.value ) {
          model.object2.positionProperty.value = rightPosition;
          model.object1.positionProperty.value = leftPosition;
        }
        else {
          model.object1.positionProperty.value = leftPosition;
          model.object2.positionProperty.value = rightPosition;
        }
        model.step();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'macro', 'atomic' ];
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-coulombs-law/v1',
    build: 'coulombs-law@1.1.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, i ) => ( { id: ids[ i ], screen, ...screenState( screen ) } ) )
  } ) );
}
