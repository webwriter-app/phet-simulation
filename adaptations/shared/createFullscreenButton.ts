// WebWriter's PhET toolbar button. Distributed under GPL-3.0.
import type { TReadOnlyProperty } from '../../../axon/js/TReadOnlyProperty.js';
import Shape from '../../../kite/js/Shape.js';
import Path from '../../../scenery/js/nodes/Path.js';
import Color from '../../../scenery/js/util/Color.js';
import FullScreen from '../../../scenery/js/util/FullScreen.js';
import Tandem from '../../../tandem/js/Tandem.js';
import JoistButton from '../JoistButton.js';
import JoistFluent from '../JoistFluent.js';
import type Sim from '../Sim.js';

export default function createFullscreenButton( sim: Sim, background: TReadOnlyProperty<Color> ): JoistButton | null {
  if ( window.parent === window || !FullScreen.isFullScreenEnabled() || phet.chipper.queryParameters.preventFullScreen ) {
    return null;
  }

  const enter = new Shape( 'M0 5V0H5 M13 0H18V5 M18 13V18H13 M5 18H0V13' );
  const exit = new Shape( 'M5 0V5H0 M18 5H13V0 M13 18V13H18 M0 13H5V18' );
  const icon = new Path( enter, { lineWidth: 2, pickable: false } );
  background.link( color => { icon.stroke = color.equals( Color.BLACK ) ? Color.WHITE : Color.BLACK; } );

  const button = new JoistButton( icon, background, {
    accessibleName: JoistFluent.menuItem.fullscreenStringProperty,
    voicingNameResponse: JoistFluent.menuItem.fullscreenStringProperty,
    listener: () => FullScreen.toggleFullScreen( sim.display ),
    tandem: Tandem.OPT_OUT,
    highlightExtensionWidth: 8,
    highlightExtensionHeight: 10,
    pointerAreaDilationX: 1,
    pointerAreaDilationY: 1,
    focusHighlightDilationX: 4,
    focusHighlightDilationY: 4
  } );
  FullScreen.isFullScreenProperty.link( fullscreen => {
    icon.shape = fullscreen ? exit : enter;
    button.setPDOMAttribute( 'aria-pressed', String( fullscreen ) );
  } );
  return button;
}
