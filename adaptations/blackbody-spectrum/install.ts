// Blackbody Spectrum WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import BlackbodyConstants from '../BlackbodyConstants.js';
import GraphDrawingNode from '../blackbody-spectrum/view/GraphDrawingNode.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

function temperature( property: { value: number | null }, nullable: boolean ) {
  return field( property, value => value, value => {
    if ( value === null && nullable ) {
      return null;
    }
    return typeof value === 'number' && value >= BlackbodyConstants.minTemperature &&
           value <= BlackbodyConstants.maxTemperature ? value : undefined;
  } );
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model;
    const graph = screen.view.children.find( child => child instanceof GraphDrawingNode );
    if ( !graph ) {
      throw new Error( 'The blackbody graph is unavailable.' );
    }
    const fields = {
      temperature: temperature( model.mainBody.temperatureProperty, false ),
      savedTemperatureOne: temperature( model.savedBodyOne.temperatureProperty, true ),
      savedTemperatureTwo: temperature( model.savedBodyTwo.temperatureProperty, true ),
      graphValuesVisible: boolean( model.graphValuesVisibleProperty ),
      intensityVisible: boolean( model.intensityVisibleProperty ),
      labelsVisible: boolean( model.labelsVisibleProperty ),
      horizontalZoom: number( graph.axes.horizontalZoomProperty ),
      verticalZoom: number( graph.axes.verticalZoomProperty ),
      probeWavelength: number( graph.draggablePointNode.wavelengthProperty )
    };
    return {
      bridge: 'webwriter-blackbody-spectrum/v1',
      build: 'blackbody-spectrum@1.1.0-dev.0-webwriter.1',
      screens: [ {
        id: 'spectrum',
        screen,
        read: () => readFields( fields ),
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( fields, state );
          if ( state.savedTemperatureOne === null && state.savedTemperatureTwo !== null ) {
            throw new Error( 'Invalid saved blackbody curves.' );
          }
          return () => {
            screen.view.interruptSubtreeInput();
            apply();
          };
        }
      } ]
    };
  } );
}
