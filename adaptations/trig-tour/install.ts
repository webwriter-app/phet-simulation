// Trig Tour WebWriter state adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import TrigTourModel from '../trig-tour/model/TrigTourModel.js';
import GraphView from '../trig-tour/view/GraphView.js';
import ValuesAccordionBox from '../trig-tour/view/readout/ValuesAccordionBox.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, object, prepareFields, readFields } from './stateFields.js';

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as TrigTourModel;
    const graph = screen.view.children.find( node => node instanceof GraphView );
    const values = screen.view.children.find( node => node instanceof ValuesAccordionBox );
    if ( !graph || !values ) { throw new Error( 'The trigonometry view is unavailable.' ); }
    const options = graph[ 'viewProperties' ];
    const fields = {
      graph: field( options.graphProperty, value => value,
        input => input === 'cos' || input === 'sin' || input === 'tan' ? input : undefined ),
      units: field( options.angleUnitsProperty, value => value,
        input => input === 'degrees' || input === 'radians' ? input : undefined ),
      labels: boolean( options.labelsVisibleProperty ),
      grid: boolean( options.gridVisibleProperty ),
      specialAngles: boolean( options.specialAnglesVisibleProperty ),
      graphExpanded: boolean( graph.expandedProperty ),
      valuesExpanded: boolean( values.expandedProperty ),
      singularity: boolean( model.singularityProperty ),
      maxAngleExceeded: boolean( model.maxAngleExceededProperty )
    };
    return {
      bridge: 'webwriter-trig-tour/v1',
      build: 'trig-tour@1.2.0-dev.0-webwriter.1',
      screens: [ {
        id: 'trig-tour',
        screen,
        read: () => ( { ...readFields( fields ), angle: model.getFullAngleInRadians() } ),
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( fields, state );
          const { angle } = state;
          if ( typeof angle !== 'number' || !Number.isFinite( angle ) || Math.abs( angle ) > TrigTourModel.MAX_ANGLE_LIMIT ) {
            throw new Error( 'Invalid trigonometry angle.' );
          }
          return () => {
            screen.view.interruptSubtreeInput();
            model.setFullAngleInRadians( angle );
            apply();
          };
        }
      } ]
    };
  } );
}
