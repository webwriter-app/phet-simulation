// Geometric Optics family state bindings. Distributed under GPL-3.0.
import type { AnyScreen } from '../Screen.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import MagnifyingGlassZoomButtonGroup from '../../../scenery-phet/js/MagnifyingGlassZoomButtonGroup.js';
import Checkbox from '../../../sun/js/Checkbox.js';
import type GOModel from '../../../geometric-optics/js/common/model/GOModel.js';
import GOPreferences from '../../../geometric-optics/js/common/model/GOPreferences.js';
import Lens from '../../../geometric-optics/js/lens/model/Lens.js';
import SecondPoint from '../../../geometric-optics/js/common/model/SecondPoint.js';
import type GOScreenView from '../../../geometric-optics/js/common/view/GOScreenView.js';
import VisibilityCheckboxGroup from '../../../geometric-optics/js/common/view/VisibilityCheckboxGroup.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

const zoomScales = [ 0.25, 0.5, 1 ];

function descendants( node: Node ): Node[] {
  return node.children.flatMap( child => [ child, ...descendants( child ) ] );
}

export function geometricOpticsState( screen: AnyScreen ) {
  const model = screen.model as GOModel;
  const view = screen.view as GOScreenView;
  const { optic, arrowScene, framedScene, lightScene } = model;
  const sceneNodes = descendants( view );
  const visibility = sceneNodes.find( node => node instanceof VisibilityCheckboxGroup );
  const zoom = sceneNodes.find( node => node instanceof MagnifyingGlassZoomButtonGroup );
  if ( !visibility || !zoom ) { throw new Error( 'Geometric optics controls are unavailable.' ); }
  const visibilityNames = [
    ...( optic.isExclusivelyFlatMirror() ? [] : [ 'focalPoints', 'twoFPoints' ] ),
    'virtualImage', 'labels', 'secondPoint',
    ...( optic instanceof Lens ? [ 'guides' ] : [] )
  ];
  const checkboxes = visibility.children.filter( child => child instanceof Checkbox );
  if ( checkboxes.length !== visibilityNames.length ) { throw new Error( 'Unexpected geometric optics visibility controls.' ); }
  const checkboxFields = Object.fromEntries( checkboxes.map( ( checkbox, index ) =>
    [ visibilityNames[ index ], boolean( checkbox.property ) ] ) );
  const ruler = model.horizontalRuler;
  const currentZoom = () => zoomScales.indexOf( ruler[ 'nominalLength' ] / ruler.length );
  const fields = {
    object: enumeration( model.opticalObjectChoiceProperty ),
    rays: enumeration( model.raysTypeProperty ),
    surface: enumeration( optic.opticSurfaceTypeProperty ),
    diameter: number( optic.diameterProperty ),
    focalLength: number( optic.directFocalLengthModel.focalLengthMagnitudeProperty ),
    directRefraction: number( optic.directFocalLengthModel.indexOfRefractionProperty ),
    curvature: number( optic.indirectFocalLengthModel.radiusOfCurvatureMagnitudeProperty ),
    indirectRefraction: number( optic.indirectFocalLengthModel.indexOfRefractionProperty ),
    lightPropagation: boolean( model.lightPropagationEnabledProperty ),
    dragMode: field( view[ 'objectDragModeProperty' ], value => value, input =>
      input === 'freeDragging' || input === 'horizontalDragging' ? input : undefined ),
    ...checkboxFields
  };
  const positions = {
    arrowOne: vector( arrowScene.arrowObject1.positionProperty ),
    arrowTwo: vector( arrowScene.arrowObject2.positionProperty ),
    framedObject: vector( framedScene.framedObject.positionProperty ),
    framedSecondPoint: number( framedScene.secondPoint.verticalOffsetProperty, false, value => SecondPoint.VERTICAL_OFFSET_RANGE.contains( value ) ),
    ...( lightScene ? {
      lightOne: vector( lightScene.lightObject1.positionProperty ),
      lightTwo: vector( lightScene.lightObject2.positionProperty ),
      projectionScreen: vector( lightScene.projectionScreen.positionProperty )
    } : {} )
  };
  const tools = [ model.horizontalRuler, model.verticalRuler, model.positionMarker1, model.positionMarker2 ].map( tool => ( {
    position: vector( tool.positionProperty ),
    inToolbox: boolean( tool.isInToolboxProperty )
  } ) );
  const rays = [ arrowScene, framedScene, ...( lightScene ? [ lightScene ] : [] ) ].map( scene => scene.raysAnimationTimeProperty );
  const rayTimes = rays.map( property => number( property ) );
  return {
    isPlaying: () => model.lightPropagationEnabledProperty.value && model.raysTypeProperty.value !== 'none' &&
      rays.some( time => time.value < time.range.max ),
    read: () => ( {
      ...readFields( fields ),
      positions: readFields( positions ),
      tools: tools.map( readFields ),
      rayTimes: rayTimes.map( field => field.read() ),
      zoom: currentZoom()
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const applyPositions = prepareFields( positions, state.positions );
      const { tools: savedTools, rayTimes: savedTimes, zoom: zoomLevel } = state;
      if ( !Array.isArray( savedTools ) || savedTools.length !== tools.length ||
           !Array.isArray( savedTimes ) || savedTimes.length !== rayTimes.length ||
           typeof zoomLevel !== 'number' || !Number.isInteger( zoomLevel ) || !zoomScales[ zoomLevel ] ) {
        throw new Error( 'Invalid geometric optics tools, rays, or zoom.' );
      }
      const applyTools = tools.map( ( fields, index ) => prepareFields( fields, savedTools[ index ] ) );
      const applyRays = rayTimes.map( ( field, index ) => field.prepare( savedTimes[ index ], 'ray animation time' ) );
      return () => {
        view.interruptSubtreeInput();
        applyFields();
        // Zoom buttons own the view's zoom property. Restore through their existing adjustment logic.
        const previousZoom = currentZoom();
        const button = zoomLevel > previousZoom ? zoom.zoomInButton : zoom.zoomOutButton;
        for ( let index = 0; index < Math.abs( zoomLevel - previousZoom ); index++ ) {
          button[ 'pushButtonModel' ].fire();
        }
        applyPositions();
        applyTools.forEach( apply => apply() );
        applyRays.forEach( apply => apply() );
      };
    }
  };
}

export const geometricOpticsPreferences = {
  focalLengthControl: enumeration( GOPreferences.focalLengthModelTypeProperty ),
  twoFPointsCheckbox: boolean( GOPreferences.add2FPointsCheckboxProperty ),
  cueingArrows: boolean( GOPreferences.cueingArrowsEnabledProperty )
};
