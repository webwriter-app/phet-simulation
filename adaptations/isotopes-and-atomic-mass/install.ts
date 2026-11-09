// Isotopes and Atomic Mass WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import AtomInfoUtils from '../../../shred/js/AtomInfoUtils.js';
import AccordionBox from '../../../sun/js/AccordionBox.js';
import type IsotopesModel from '../isotopes/model/IsotopesModel.js';
import MixturesModel from '../mixtures/model/MixturesModel.js';
import type MonoIsotopeBucket from '../mixtures/model/MonoIsotopeBucket.js';
import PositionableAtom from '../mixtures/model/PositionableAtom.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

type Mode = 'bucketsAndLargeAtoms' | 'slidersAndSmallAtoms';
const modes: Mode[] = [ 'bucketsAndLargeAtoms', 'slidersAndSmallAtoms' ];

function point( input: unknown, limit = 1000 ): Vector2 {
  if ( !Array.isArray( input ) || input.length !== 2 ||
       !input.every( value => Number.isFinite( value ) && Math.abs( value ) <= limit ) ) {
    throw new Error( 'Invalid isotope position.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}

function coordinates( value: Vector2 ): number[] {
  return [ value.x, value.y ];
}

function panelFields( screen: AnyScreen, names: string[] ) {
  const boxes = screen.view.children.filter( node => node instanceof AccordionBox ) as AccordionBox[];
  return Object.fromEntries( names.map( ( name, index ) => [ name, boolean( boxes[ index ].expandedProperty ) ] ) );
}

function isotopeState( screen: AnyScreen ) {
  const model = screen.model as IsotopesModel;
  const initializer = model as unknown as { initializeParticles: ( protonCount: number ) => void };
  const fields = {
    ...panelFields( screen, [ 'symbolExpanded', 'abundanceExpanded' ] ),
    nucleusOffset: vector( model.particleAtom.nucleusOffsetProperty ),
    element: number( model.selectedElementProtonCountProperty, true, value => value >= 1 && value <= 10 )
  };
  return {
    read: () => ( {
      ...readFields( fields ),
      neutrons: model.neutrons.map( neutron => ( {
        inNucleus: model.particleAtom.neutrons.includes( neutron ),
        position: coordinates( neutron.positionProperty.value ),
        destination: coordinates( neutron.destinationProperty.value )
      } ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const element = state.element as number;
      if ( !Array.isArray( state.neutrons ) || state.neutrons.length !== AtomInfoUtils.getNumNeutronsInMostCommonIsotope( element ) + 4 ) {
        throw new Error( 'Invalid isotope neutron count.' );
      }
      const neutrons = state.neutrons.map( input => {
        const neutron = object( input );
        if ( typeof neutron.inNucleus !== 'boolean' ) { throw new Error( 'Invalid neutron location.' ); }
        return { inNucleus: neutron.inNucleus, position: point( neutron.position ), destination: point( neutron.destination ) };
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        apply();
        // Regenerate the inventory even when the element itself is unchanged.
        initializer.initializeParticles( element );
        model.neutrons.forEach( neutron => neutron.containerProperty.value?.removeParticle( neutron ) );
        model.neutrons.forEach( ( neutron, index ) => {
          if ( neutrons[ index ].inNucleus ) { model.particleAtom.addParticle( neutron ); }
          else { model.neutronBucket.addParticleFirstOpen( neutron, false ); }
        } );
        model.neutrons.forEach( ( neutron, index ) => {
          neutron.positionProperty.value = neutrons[ index ].position;
          neutron.destinationProperty.value = neutrons[ index ].destination;
        } );
        apply();
      };
    }
  };
}

function mixtureState( screen: AnyScreen ) {
  const model = screen.model as MixturesModel;
  const saved = model as unknown as {
    savedParticleStates: Map<Mode, PositionableAtom[]>[];
    removeAllIsotopesFromTestChamberAndModel: () => void;
    restoreParticleState: ( element: number, mode: Mode ) => void;
    setControllers: ( mode: Mode ) => void;
    fillBuckets: () => void;
    placeIsotope: ( atom: PositionableAtom, bucket: MonoIsotopeBucket, chamber: MixturesModel['testChamber'] ) => void;
  };
  const fields = {
    ...panelFields( screen, [ 'compositionExpanded', 'averageMassExpanded' ] ),
    element: number( model.selectedElementProtonCountProperty, true, value => value >= 1 && value <= MixturesModel.MAX_ATOMIC_NUMBER ),
    mode: field( model.interactivityModeProperty, mode => mode, value => modes.find( mode => mode === value ) ),
    nature: boolean( model.showingNaturesMixProperty )
  };
  const panels = panelFields( screen, [ 'compositionExpanded', 'averageMassExpanded' ] );
  const snapshot = ( atoms: PositionableAtom[] ) => atoms.map( atom => [
    atom.atomConfigurationProperty.value.neutronCount, ...coordinates( atom.positionProperty.value )
  ] );
  const addDragBehavior = ( atom: PositionableAtom ) => {
    atom.isDraggingProperty.lazyLink( dragging => {
      if ( dragging ) {
        atom.containerProperty.value?.removeParticle( atom );
      }
      else {
        const config = atom.atomConfigurationProperty.value;
        const bucket = model.bucketList.find( bucket => bucket.isotopeConfigProperty.value.equals( config ) );
        if ( bucket ) { saved.placeIsotope( atom, bucket, model.testChamber ); }
      }
    } );
  };

  return {
    read: () => {
      const element = model.selectedElementProtonCountProperty.value;
      const mode = model.interactivityModeProperty.value;
      const nature = model.showingNaturesMixProperty.value;
      return {
        ...readFields( fields ),
        mixes: saved.savedParticleStates.flatMap( ( map, protonCount ) => modes.flatMap( modeValue => {
          const atoms = !nature && protonCount === element && modeValue === mode ?
                        model.testChamber.containedIsotopes : map.get( modeValue );
          return atoms?.length ? [ { element: protonCount, mode: modeValue, atoms: snapshot( atoms ) } ] : [];
        } ) )
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      // Validate the model fields together, then apply the configuration in its listener order.
      prepareFields( fields, state );
      const applyPanels = prepareFields( panels, state );
      const element = state.element as number;
      const mode = state.mode as Mode;
      const nature = state.nature as boolean;
      if ( !Array.isArray( state.mixes ) || state.mixes.length > 2 * MixturesModel.MAX_ATOMIC_NUMBER ) {
        throw new Error( 'Invalid isotope mixture count.' );
      }
      const unique = new Set<string>();
      const mixes = state.mixes.map( input => {
        const mix = object( input );
        const { element, mode, atoms } = mix;
        if ( typeof element !== 'number' || !Number.isInteger( element ) || element < 1 || element > MixturesModel.MAX_ATOMIC_NUMBER ||
             ( mode !== modes[ 0 ] && mode !== modes[ 1 ] ) || !Array.isArray( atoms ) ||
             atoms.length > 800 || unique.has( `${element}:${mode}` ) ) {
          throw new Error( 'Invalid isotope mixture.' );
        }
        unique.add( `${element}:${mode}` );
        const configs = AtomInfoUtils.getStableIsotopesOfElement( element );
        const quantities = new Map<number, number>();
        const parsed = atoms.map( atom => {
          if ( !Array.isArray( atom ) || atom.length !== 3 ) { throw new Error( 'Invalid mixture isotope.' ); }
          const config = configs.find( config => config.neutronCount === atom[ 0 ] );
          const position = point( atom.slice( 1 ) );
          if ( !config || !model.testChamber.getTestChamberRect().containsPoint( position ) ) {
            throw new Error( 'Invalid isotope or test chamber position.' );
          }
          const quantity = ( quantities.get( config.neutronCount ) ?? 0 ) + 1;
          quantities.set( config.neutronCount, quantity );
          if ( quantity > ( mode === modes[ 0 ] ? 10 : 100 ) ) { throw new Error( 'Too many isotopes of one kind.' ); }
          return { config, position };
        } );
        return { element, mode: mode as Mode, atoms: parsed };
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        model.reset();
        model.interactivityModeProperty.value = mode;
        model.selectedElementProtonCountProperty.value = element;
        mixes.forEach( mix => {
          saved.savedParticleStates[ mix.element ].set( mix.mode, mix.atoms.map( ( { config, position } ) => {
            const atom = new PositionableAtom( config, position, {
              particleRadius: mix.mode === modes[ 0 ] ? 10 : MixturesModel.SMALL_ISOTOPE_RADIUS
            } );
            if ( mix.mode === modes[ 0 ] ) { addDragBehavior( atom ); }
            return atom;
          } ) );
        } );
        saved.removeAllIsotopesFromTestChamberAndModel();
        saved.restoreParticleState( element, mode );
        saved.setControllers( mode );
        if ( mode === modes[ 0 ] ) { saved.fillBuckets(); }
        model.showingNaturesMixProperty.value = nature;
        applyPanels();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-isotopes-and-atomic-mass/v1',
    build: 'isotopes-and-atomic-mass@1.2.0-dev.1-webwriter.1',
    screens: sim.simScreens.map( ( screen, i ) => i === 0 ?
      { id: 'isotopes', screen, ...isotopeState( screen ) } : { id: 'mixtures', screen, ...mixtureState( screen ) } )
  } ) );
}
