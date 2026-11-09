// Atomic Interactions WebWriter adapter. Distributed under GPL-3.0.
import type { AnyScreen } from '../Screen.js';
import DualAtomModel from '../../../states-of-matter/js/atomic-interactions/model/DualAtomModel.js';
import AtomicInteractionsScreenView from '../../../states-of-matter/js/atomic-interactions/view/AtomicInteractionsScreenView.js';
import SOMConstants from '../../../states-of-matter/js/common/SOMConstants.js';
import { boolean, enumeration, number, object, prepareFields, readFields } from './stateFields.js';

export default function atomicInteractionsState( screen: AnyScreen ) {
  const model = screen.model as DualAtomModel;
  const view = screen.view as AtomicInteractionsScreenView;
  const zoom = view[ 'interactivePotentialGraph' ][ 'gridNode' ]![ 'zoomFactorProperty' ];
  const controls = {
    atomPair: enumeration( model.atomPairProperty ),
    strength: number( model.adjustableAtomInteractionStrengthProperty, false,
      value => value >= SOMConstants.MIN_EPSILON && value <= SOMConstants.MAX_EPSILON ),
    diameter: number( model.adjustableAtomDiameterProperty, false,
      value => value >= SOMConstants.MIN_SIGMA && value <= SOMConstants.MAX_SIGMA ),
    forces: enumeration( model.forcesDisplayModeProperty ),
    forcesExpanded: boolean( model.forcesExpandedProperty ),
    movementHint: boolean( model.movementHintVisibleProperty ),
    speed: enumeration( model.timeSpeedProperty ),
    zoom: number( zoom, true )
  };
  const playback = { playing: boolean( model.isPlayingProperty ) };
  const movable = model.movableAtom;
  return {
  isPlaying: () => model.isPlayingProperty.value && !model.motionPausedProperty.value,
  read: () => ( {
    ...readFields( controls ),
    ...readFields( playback ),
    position: movable.getX(),
    velocity: movable.getVx(),
    acceleration: movable.getAx()
  } ),
  prepare: ( input: unknown ) => {
    const state = object( input );
    const applyControls = prepareFields( controls, state );
    const applyPlayback = prepareFields( playback, state );
    const { position, velocity, acceleration } = state;
    if ( typeof position !== 'number' || !Number.isFinite( position ) ||
         typeof velocity !== 'number' || !Number.isFinite( velocity ) ||
         typeof acceleration !== 'number' || !Number.isFinite( acceleration ) ) {
      throw new Error( 'Invalid Atomic Interactions motion.' );
    }
    return () => {
      view.interruptSubtreeInput();
      model.isPlayingProperty.value = false;
      model.setMotionPaused( false );
      // Pair and diameter changes can reposition the atom. Apply the saved motion after them.
      applyControls();
      movable.setVx( velocity );
      movable.setPosition( position, 0 );
      movable.setAx( acceleration );
      applyPlayback();
    };
  }
  };
}
