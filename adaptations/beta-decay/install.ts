// Beta Decay WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import Vector2 from '../../../dot/js/Vector2.js';
import NuclearDecayAtom from '../../../nuclear-decay-common/js/model/NuclearDecayAtom.js';
import NuclearDecayModel from '../../../nuclear-decay-common/js/model/NuclearDecayModel.js';
import type BetaDecayModel from '../common/model/BetaDecayModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

const screenIds = [ 'single-atom', 'multiple-atoms', 'decay-rates' ];

function screenState( screen: Sim[ 'simScreens' ][ number ] ) {
  const model = screen.model as BetaDecayModel;
  const isotopes = model.selectableIsotopes.filter( isotope => isotope !== 'custom' ).map( isotope => ( {
    isotope,
    before: NuclearDecayModel.getIsotopeAtomConfig( isotope ),
    after: NuclearDecayModel.getIsotopeAtomConfig( NuclearDecayModel.getDecayProduct( isotope ) )
  } ) );
  const controls = {
    isotope: field( model.selectedIsotopeProperty, value => value, input =>
      model.selectableIsotopes.find( isotope => isotope === input ) ),
    halfLife: number( model.selectedHalfLifeProperty, false, value => value > 0 ),
    atomsToAdd: number( model.atomsToAddProperty, true ),
    timeSpeed: enumeration( model.timeSpeedProperty ),
    time: number( model.timeProperty, false, value => value >= 0 )
  };
  const playback = { playing: boolean( model.isPlayingProperty ) };

  return {
    isPlaying: () => model.isPlayingProperty.value && model.activeAtoms.length > 0,
    read: () => ( {
      ...readFields( controls ),
      ...readFields( playback ),
      atoms: model.activeAtoms.map( atom => {
        const isotope = isotopes.find( ( { before } ) =>
          before.protonCount === atom.atomConfigBeforeDecay.protonCount &&
          before.neutronCount === atom.atomConfigBeforeDecay.neutronCount )!.isotope;
        return {
          isotope,
          time: atom.time,
          decayTime: atom.decayTime,
          position: [ atom.position.x, atom.position.y ]
        };
      } ),
      decayOrder: model.decayedAtoms.map( atom => model.activeAtoms.indexOf( atom ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state );
      const applyPlayback = prepareFields( playback, state );
      const { atoms, decayOrder } = state;
      if ( !Array.isArray( atoms ) || atoms.length > model.maxNumberOfAtoms ||
           !Array.isArray( decayOrder ) || new Set( decayOrder ).size !== decayOrder.length ||
           !decayOrder.every( index => Number.isInteger( index ) && index >= 0 && index < atoms.length ) ) {
        throw new Error( 'Invalid beta decay population.' );
      }
      const selected = isotopes.find( ( { isotope } ) => isotope === state.isotope );
      if ( selected && model.getHalfLife( selected.isotope ) !== state.halfLife ) {
        throw new Error( 'Invalid half-life for the selected isotope.' );
      }
      const decayed = new Set( decayOrder );
      const restored = atoms.map( ( input, index ) => {
        const state = object( input );
        const { time, decayTime, position } = state;
        const isotope = isotopes.find( item => item.isotope === state.isotope );
        if ( !isotope || typeof time !== 'number' || !Number.isFinite( time ) || time < 0 ||
             ( decayTime !== null && ( typeof decayTime !== 'number' || !Number.isFinite( decayTime ) ||
                                      decayTime < 0 || decayTime > time ) ) ||
             !Array.isArray( position ) || position.length !== 2 || !position.every( Number.isFinite ) ) {
          throw new Error( 'Invalid beta decay atom.' );
        }
        return { isotope, time, decayTime, position: new Vector2( position[ 0 ], position[ 1 ] ), decayed: decayed.has( index ) };
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        model.reset();
        model.isPlayingProperty.value = false;
        applyControls();
        const population = restored.map( ( { isotope, time, decayTime, position, decayed } ) => {
          const atom = new NuclearDecayAtom( isotope.before, isotope.after );
          atom.isActive = true;
          atom.hasDecayed = decayed;
          atom.time = time;
          atom.decayTime = decayTime;
          atom.position = position;
          model.activeAtoms.add( atom );
          return atom;
        } );
        decayOrder.forEach( index => model.decayedAtoms.add( population[ index ] ) );
        model.isPlayAreaEmptyProperty.value = population.length === 0;
        model.updateEmitter.emit();
        applyPlayback();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-beta-decay/v1',
    build: 'beta-decay@1.0.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...screenState( screen ) } ) )
  } ) );
}
