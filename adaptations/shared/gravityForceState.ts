// Gravity Force Lab family state. Distributed under GPL-3.0.
import type ISLCModel from '../../../inverse-square-law-common/js/model/ISLCModel.js';
import type Sim from '../../../joist/js/Sim.js';
import installSimulationBridge from './installSimulationBridge.js';
import { number, object, prepareFields, readFields } from './stateFields.js';

type Fields = Parameters<typeof readFields>[ 0 ];

export default function installGravityForceState<T extends ISLCModel>(
  sim: Sim, id: string, version: string, extraFields: ( model: T ) => Fields
): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as T;
    const fields = {
      leftMass: number( model.object1.valueProperty ),
      rightMass: number( model.object2.valueProperty ),
      ...extraFields( model )
    };
    return {
      bridge: `webwriter-${id}/v1`,
      build: `${id}@${version}-webwriter.1`,
      screens: [ {
        id: 'gravity-force',
        screen,
        read: () => ( {
          ...readFields( fields ),
          leftPosition: model.object1.positionProperty.value,
          rightPosition: model.object2.positionProperty.value
        } ),
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( fields, state );
          const { leftPosition, rightPosition } = state;
          if ( typeof leftPosition !== 'number' || !Number.isFinite( leftPosition ) ||
               typeof rightPosition !== 'number' || !Number.isFinite( rightPosition ) ||
               leftPosition < model.leftObjectBoundary || rightPosition > model.rightObjectBoundary ||
               leftPosition >= rightPosition ) {
            throw new Error( 'Invalid gravity force lab mass positions.' );
          }
          return () => {
            screen.view.interruptSubtreeInput();
            apply();
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
      } ]
    };
  } );
}
