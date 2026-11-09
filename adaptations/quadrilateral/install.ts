// State adapter for PhET Quadrilateral. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type QuadrilateralModel from '../quadrilateral/model/QuadrilateralModel.js';
import { SoundDesign } from '../quadrilateral/model/QuadrilateralSoundOptionsModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, object, prepareFields, readFields } from './stateFields.js';

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as QuadrilateralModel;
    const shape = model.quadrilateralShapeModel;
    const visibility = model.visibilityModel;
    const audio = model.optionsModel.soundOptionsModel;
    const fields = {
      markers: boolean( visibility.markersVisibleProperty ),
      labels: boolean( visibility.vertexLabelsVisibleProperty ),
      grid: boolean( visibility.gridVisibleProperty ),
      diagonals: boolean( visibility.diagonalGuidesVisibleProperty ),
      shapeName: boolean( visibility.shapeNameVisibleProperty ),
      fineMovement: boolean( model.lockToMinorIntervalsProperty ),
      shapeSound: boolean( model.shapeSoundEnabledProperty )
    };
    const preferences = {
      soundDesign: field( audio.soundDesignProperty, value => value === SoundDesign.TRACKS_LAYER ? 'shapeLayer' : 'shapeUnique',
        input => input === 'shapeLayer' ? SoundDesign.TRACKS_LAYER : input === 'shapeUnique' ? SoundDesign.TRACKS_UNIQUE : undefined ),
      tracksPlayForever: boolean( audio.tracksPlayForeverProperty )
    };
    return {
      bridge: 'webwriter-quadrilateral/v1',
      build: 'quadrilateral@1.2.0-dev.0-webwriter.1',
      readPreferences: () => readFields( preferences ),
      preparePreferences: input => prepareFields( preferences, input ),
      screens: [ {
        id: 'quadrilateral',
        screen,
        read: () => ( {
          ...readFields( fields ),
          vertices: shape.vertices.map( vertex => [ vertex.positionProperty.value.x, vertex.positionProperty.value.y ] )
        } ),
        prepare: ( input: unknown ) => {
          const state = object( input );
          const apply = prepareFields( fields, state );
          const vertices = state.vertices;
          if ( !Array.isArray( vertices ) || vertices.length !== shape.vertices.length ) {
            throw new Error( 'Invalid Quadrilateral vertices.' );
          }
          const positions = new Map( shape.vertices.map( ( vertex, i ) => {
            const xy = vertices[ i ];
            if ( !Array.isArray( xy ) || xy.length !== 2 || !xy.every( Number.isFinite ) ) { throw new Error( 'Invalid vertex position.' ); }
            const point = new Vector2( xy[ 0 ], xy[ 1 ] );
            if ( !model.vertexDragBounds.containsPoint( point ) ) { throw new Error( 'Vertex is outside the model bounds.' ); }
            return [ vertex.vertexLabel, point ];
          } ) );
          if ( !model.areVertexPositionsAllowed( positions ) ) { throw new Error( 'Invalid Quadrilateral shape.' ); }
          return () => {
            screen.view.interruptSubtreeInput();
            apply();
            shape.setVertexPositions( positions );
          };
        }
      } ]
    };
  } );
}
