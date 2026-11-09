// Alpha Decay WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Sim from '../../../joist/js/Sim.js';
import NuclearDecayAtom from '../../../nuclear-decay-common/js/model/NuclearDecayAtom.js';
import NuclearDecayModel from '../../../nuclear-decay-common/js/model/NuclearDecayModel.js';
import AlphaDecayModel from '../common/model/AlphaDecayModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

const screenIds = [ 'single-atom', 'multiple-atoms', 'decay-rate' ];
const polonium = NuclearDecayModel.getIsotopeAtomConfig( 'polonium-211' );
const lead = NuclearDecayModel.getIsotopeAtomConfig( 'lead-207' );

function nonnegative( value: unknown ): value is number {
  return typeof value === 'number' && Number.isFinite( value ) && value >= 0;
}

function readAtom( atom: NuclearDecayAtom ) {
  return {
    time: atom.time,
    decayed: atom.hasDecayed,
    decayTime: atom.decayTime,
    position: [ atom.position.x, atom.position.y ]
  };
}

function restoreAtom( input: unknown ) {
  const { time, decayed, decayTime, position } = object( input );
  if ( !nonnegative( time ) || typeof decayed !== 'boolean' ||
       !( decayTime === null || nonnegative( decayTime ) && decayTime <= time ) ||
       !Array.isArray( position ) || position.length !== 2 || !position.every( Number.isFinite ) ) {
    throw new Error( 'Invalid Alpha Decay atom.' );
  }
  const atom = new NuclearDecayAtom( polonium, lead );
  atom.isActive = true;
  atom.time = time;
  atom.hasDecayed = decayed;
  atom.decayTime = decayTime as number | null;
  atom.position = new Vector2( position[ 0 ], position[ 1 ] );
  return atom;
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as AlphaDecayModel;
  const controls = {
    isotope: field( model.selectedIsotopeProperty, value => value,
      value => model.selectableIsotopes.find( isotope => isotope === value ) ),
    halfLife: number( model.selectedHalfLifeProperty, false, value => value > 0 ),
    speed: enumeration( model.timeSpeedProperty ),
    time: number( model.timeProperty, false, nonnegative ),
    atomsToAdd: number( model.atomsToAddProperty, true )
  };
  const playback = { playing: boolean( model.isPlayingProperty ) };
  return {
    isPlaying: () => model.isPlayingProperty.value && model.activeAtoms.length > 0,
    read: () => ( {
      ...readFields( controls ),
      ...readFields( playback ),
      atoms: model.activeAtoms.map( readAtom ),
      decayHistory: model.decayedAtoms.map( atom => {
        const index = model.activeAtoms.indexOf( atom );
        return index === -1 ? readAtom( atom ) : index;
      } )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state );
      const applyPlayback = prepareFields( playback, state );
      if ( !Array.isArray( state.atoms ) || state.atoms.length > model.maxNumberOfAtoms ||
           !Array.isArray( state.decayHistory ) ) {
        throw new Error( 'Invalid Alpha Decay experiment.' );
      }
      const atoms = state.atoms.map( restoreAtom );
      const history = state.decayHistory.map( entry => typeof entry === 'number' ? atoms[ entry ] : restoreAtom( entry ) );
      if ( history.some( atom => !atom?.hasDecayed ) || new Set( history ).size !== history.length ||
           atoms.some( atom => atom.hasDecayed && !history.includes( atom ) ) ) {
        throw new Error( 'Invalid Alpha Decay history.' );
      }
      return () => {
        screen.view.interruptSubtreeInput();
        model.reset();
        applyControls();
        model.activeAtoms.push( ...atoms );
        model.decayedAtoms.push( ...history );
        model.isPlayAreaEmptyProperty.value = atoms.length === 0;
        applyPlayback();
        model.updateEmitter.emit();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-alpha-decay/v1',
    build: 'alpha-decay@1.0.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...screenState( screen ) } ) )
  } ) );
}
