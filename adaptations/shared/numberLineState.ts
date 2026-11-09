// Number Line family WebWriter bindings. Distributed under GPL-3.0.
import type Range from '../../../dot/js/Range.js';
import Vector2 from '../../../dot/js/Vector2.js';
import NumberLinePoint from '../../../number-line-common/js/common/model/NumberLinePoint.js';
import type PointController from '../../../number-line-common/js/common/model/PointController.js';
import type SpatializedNumberLine from '../../../number-line-common/js/common/model/SpatializedNumberLine.js';
import { boolean, enumeration, field, object, prepareFields, readFields } from './stateFields.js';

export function lineFields( line: SpatializedNumberLine, ranges: readonly Range[] = [ line.displayedRangeProperty.value ] ) {
  return {
    orientation: enumeration( line.orientationProperty ),
    range: field( line.displayedRangeProperty, range => [ range.min, range.max ], input =>
      Array.isArray( input ) && input.length === 2 ? ranges.find( item => item.min === input[ 0 ] && item.max === input[ 1 ] ) : undefined ),
    labels: boolean( line.showPointLabelsProperty ),
    ticks: boolean( line.showTickMarksProperty ),
    absoluteValues: boolean( line.showAbsoluteValuesProperty ),
    opposites: boolean( line.showOppositesProperty )
  };
}

export function pointControllerState( controllers: readonly PointController[], putAway: ( controller: PointController ) => void ) {
  return {
    read: () => controllers.map( controller => ( {
      position: [ controller.positionProperty.value.x, controller.positionProperty.value.y ],
      points: controller.numberLinePoints.map( point => ( {
        line: controller.numberLines.indexOf( point.numberLine ),
        value: point.valueProperty.value
      } ) )
    } ) ),
    prepare: ( input: unknown ) => {
      if ( !Array.isArray( input ) || input.length !== controllers.length ) { throw new Error( 'Invalid Number Line controllers.' ); }
      const snapshots = input.map( ( item, index ) => {
        const state = object( item );
        if ( !Array.isArray( state.position ) || state.position.length !== 2 || !state.position.every( Number.isFinite ) ||
             !Array.isArray( state.points ) || state.points.length > controllers[ index ].numberLines.length ) {
          throw new Error( 'Invalid Number Line controller.' );
        }
        const position = new Vector2( state.position[ 0 ], state.position[ 1 ] );
        const seen = new Set<number>();
        const points = state.points.map( item => {
          const point = object( item );
          if ( typeof point.line !== 'number' || !Number.isInteger( point.line ) ||
               !controllers[ index ].numberLines[ point.line ] || seen.has( point.line ) ||
               typeof point.value !== 'number' || !Number.isFinite( point.value ) ) {
            throw new Error( 'Invalid Number Line point.' );
          }
          seen.add( point.line );
          return { line: controllers[ index ].numberLines[ point.line ], value: point.value };
        } );
        return { position, points };
      } );
      return () => {
        controllers.forEach( controller => {
          controller.stopAnimation();
          controller.removeClearAndDisposePoints();
        } );
        controllers.forEach( ( controller, index ) => {
          const { position, points } = snapshots[ index ];
          if ( !points.length ) {
            putAway( controller );
            return;
          }
          controller.goToPosition( position );
          points.forEach( ( { line, value } ) => {
            const point = new NumberLinePoint( line, { initialValue: value, initialColor: controller.color, controller } );
            line.addPoint( point );
            controller.associateWithNumberLinePoint( point );
          } );
          controller.goToPosition( position );
        } );
      };
    }
  };
}

export function groupedState( fields: Parameters<typeof readFields>[ 0 ], children: Record<string, { read: () => unknown; prepare: ( input: unknown ) => () => void }> ) {
  return {
    read: () => ( { controls: readFields( fields ), ...Object.fromEntries( Object.entries( children ).map( ( [ key, state ] ) => [ key, state.read() ] ) ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state.controls );
      const childrenApply = Object.entries( children ).map( ( [ key, adapter ] ) => adapter.prepare( state[ key ] ) );
      return () => {
        apply();
        childrenApply.forEach( apply => apply() );
      };
    }
  };
}
