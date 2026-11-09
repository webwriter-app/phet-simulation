// Membrane Transport WebWriter state adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import {
  getFeatureSetSelectableSoluteTypes,
  getFeatureSetSoluteTypes,
  getFeatureSetTransportProteins
} from '../common/MembraneTransportFeatureSet.js';
import MembraneTransportPreferences from '../common/MembraneTransportPreferences.js';
import type Ligand from '../common/model/Ligand.js';
import type MembraneTransportModel from '../common/model/MembraneTransportModel.js';
import type { FluxEntry } from '../common/model/MembraneTransportModel.js';
import Particle from '../common/model/Particle.js';
import type { ParticleModeType } from '../common/model/particleModes/BaseParticleMode.js';
import createTransportProtein from '../common/model/proteins/createTransportProtein.js';
import type TransportProteinType from '../common/model/proteins/TransportProteinType.js';
import Solute from '../common/model/Solute.js';
import type SoluteType from '../common/model/SoluteType.js';
import SoluteConcentrationsAccordionBox from '../common/view/SoluteConcentrationsAccordionBox.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, object, prepareFields, readFields } from './stateFields.js';

const proteinStates: Record<TransportProteinType, readonly string[]> = {
  sodiumIonLeakageChannel: [ 'open' ],
  potassiumIonLeakageChannel: [ 'open' ],
  sodiumIonVoltageGatedChannel: [ 'closedNegative70mV', 'openNegative50mV', 'closed30mV' ],
  potassiumIonVoltageGatedChannel: [ 'closedNegative70mV', 'closedNegative50mV', 'open30mV' ],
  sodiumIonLigandGatedChannel: [ 'closed', 'ligandBoundClosed', 'ligandBoundOpen', 'ligandUnboundOpen' ],
  potassiumIonLigandGatedChannel: [ 'closed', 'ligandBoundClosed', 'ligandBoundOpen', 'ligandUnboundOpen' ],
  sodiumPotassiumPump: [ 'openToInsideEmpty', 'openToInsideSodiumBound', 'openToInsideSodiumAndATPBound',
    'openToInsideSodiumAndPhosphateBound', 'openToOutsideAwaitingPotassium', 'openToOutsidePotassiumBound' ],
  sodiumGlucoseCotransporter: [ 'openToOutsideAwaitingParticles', 'openToOutsideAllParticlesBound', 'openToInside' ]
};
const targetModes = new Set( [ 'moveToCenterOfChannel', 'moveToLigandBindingLocation',
  'moveToSodiumGlucoseCotransporter', 'moveToSodiumPotassiumPump' ] );
const slottedModes = new Set( [ ...targetModes, 'ligandBound', 'enteringTransportProtein', 'movingThroughTransportProtein',
  'waitingInSodiumGlucoseCotransporter', 'waitingInSodiumPotassiumPump' ] );

function finite( value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER ): value is number {
  return typeof value === 'number' && Number.isFinite( value ) && value >= min && value <= max;
}

function position( input: unknown ) {
  const { x, y } = object( input );
  if ( !finite( x, -10000, 10000 ) || !finite( y, -10000, 10000 ) ) { throw new Error( 'Invalid membrane particle position.' ); }
  return new Vector2( x, y );
}

function readParticle( particle: Particle ) {
  const { x, y } = particle.position;
  const mode = particle.mode.type;
  return {
    type: particle.type,
    position: { x, y },
    opacity: particle.opacity,
    crossed: Number.isFinite( particle.timeSinceCrossedMembrane ) ? particle.timeSinceCrossedMembrane : null,
    mode: mode === 'userControlled' || mode === 'userOver' ?
      { type: 'randomWalk', currentDirection: { x: 1, y: 0 }, timeUntilNextDirection: 0, timeElapsedSinceMembraneCrossing: 0 } :
      particle.mode.toStateObject()
  };
}

function readMode( input: unknown, proteinTypes: ( TransportProteinType | null )[], isLigand: boolean ) {
  const state = object( input );
  const type = state.type as ParticleModeType;
  if ( type === 'randomWalk' ) {
    if ( !finite( state.timeUntilNextDirection, -100 ) || !finite( state.timeElapsedSinceMembraneCrossing ) ) {
      throw new Error( 'Invalid particle movement time.' );
    }
    position( state.currentDirection );
    return state;
  }
  if ( type === 'passiveDiffusion' ) {
    if ( !isLigand && ( state.direction === 'inward' || state.direction === 'outward' ) ) { return state; }
    throw new Error( 'Invalid passive transport direction.' );
  }

  const { slot } = state;
  if ( !slottedModes.has( type ) || typeof slot !== 'number' || !Number.isInteger( slot ) || !proteinTypes[ slot ] ) {
    throw new Error( 'Invalid membrane particle interaction.' );
  }
  const protein = proteinTypes[ slot ]!;
  const ligandMode = type === 'ligandBound' || type === 'moveToLigandBindingLocation';
  if ( isLigand !== ligandMode || ( ligandMode && !protein.endsWith( 'LigandGatedChannel' ) ) ||
       ( type.endsWith( 'SodiumPotassiumPump' ) &&
         ( protein !== 'sodiumPotassiumPump' ||
           ![ 'sodium1', 'sodium2', 'sodium3', 'potassium1', 'potassium2', 'phosphate', 'atp' ].includes( state.site as string ) ) ) ||
       ( type.endsWith( 'SodiumGlucoseCotransporter' ) &&
         ( protein !== 'sodiumGlucoseCotransporter' || ( state.site !== 'left' && state.site !== 'right' ) ) ) ||
       ( ( type === 'enteringTransportProtein' || type === 'movingThroughTransportProtein' ) &&
         state.direction !== 'inward' && state.direction !== 'outward' ) ||
       ( type === 'movingThroughTransportProtein' &&
         ( protein !== state.transportProteinType || ( state.offset !== null && !finite( state.offset, -100, 100 ) ) ) ) ) {
    throw new Error( 'Invalid membrane protein binding.' );
  }
  if ( targetModes.has( type ) ) {
    position( state.startPosition );
    position( state.targetPosition );
    const { checkpoints, currentCheckpointIndex } = state;
    if ( !Array.isArray( checkpoints ) || checkpoints.length > 100 || typeof currentCheckpointIndex !== 'number' ||
         !Number.isInteger( currentCheckpointIndex ) || currentCheckpointIndex < 0 || currentCheckpointIndex > checkpoints.length ) {
      throw new Error( 'Invalid membrane particle route.' );
    }
    checkpoints.forEach( position );
  }
  return state;
}

function prepareParticle( input: unknown, proteinTypes: ( TransportProteinType | null )[], isLigand: boolean ) {
  const state = object( input );
  const { opacity, crossed } = state;
  const point = position( state.position );
  const mode = readMode( state.mode, proteinTypes, isLigand );
  if ( !finite( opacity, 0, 1 ) || ( crossed !== null && !finite( crossed ) ) ) {
    throw new Error( 'Invalid membrane particle display state.' );
  }
  return {
    point,
    apply: ( particle: Particle, model: MembraneTransportModel ) => {
      particle.position.set( point );
      particle.mode = Particle.stateToMode( model, mode );
      particle.opacity = opacity;
      particle.timeSinceCrossedMembrane = crossed ?? Number.POSITIVE_INFINITY;
    }
  };
}

function findConcentrations( node: Node ): SoluteConcentrationsAccordionBox | undefined {
  if ( node instanceof SoluteConcentrationsAccordionBox ) { return node; }
  for ( const child of node.children ) {
    const result = findConcentrations( child );
    if ( result ) { return result; }
  }
  return undefined;
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const preferences = MembraneTransportPreferences.instance;
    const preferenceFields = {
      animateLipids: boolean( preferences.animateLipidsProperty ),
      glucoseMetabolism: boolean( preferences.glucoseMetabolismProperty ),
      stereoCrossingSounds: boolean( preferences.stereoCrossingSoundsEnabledProperty )
    };
    const screenIds = [ 'simple-diffusion', 'facilitated-diffusion', 'active-transport', 'playground' ];
    return {
      bridge: 'webwriter-membrane-transport/v1',
      build: 'membrane-transport@1.1.0-dev.0-webwriter.1',
      readPreferences: () => readFields( preferenceFields ),
      preparePreferences: input => prepareFields( preferenceFields, input ),
      screens: sim.simScreens.map( ( screen, index ) => {
        const model = screen.model as MembraneTransportModel;
        const availableSolutes = getFeatureSetSoluteTypes( model.featureSet );
        const selectedSolutes = getFeatureSetSelectableSoluteTypes( model.featureSet );
        const availableProteins = getFeatureSetTransportProteins( model.featureSet );
        const concentrations = findConcentrations( screen.view );
        const fields = {
          playing: boolean( model.isPlayingProperty ),
          speed: enumeration( model.timeSpeedProperty ),
          solute: field( model.soluteProperty, value => value, input => selectedSolutes.find( solute => solute === input ) ),
          charges: boolean( model.chargesVisibleProperty ),
          potential: field( model.membranePotentialProperty, value => value,
            input => input === -70 || input === -50 || input === 30 ? input : undefined ),
          ligandsAdded: boolean( model.areLigandsAddedProperty ),
          ligandCue: boolean( model.ligandInteractionCueVisibleProperty ),
          highlights: boolean( model.crossingHighlightsEnabledProperty ),
          sounds: boolean( model.crossingSoundsEnabledProperty ),
          ...( concentrations ? { concentrations: boolean( concentrations.expandedProperty ) } : {} )
        };
        const running = () => model.solutes.length > 0 || model.fluxEntries.length > 0 ||
          model.areLigandsAddedProperty.value || model.getFilledSlots().length > 0;
        return {
          id: screenIds[ index ],
          screen,
          isPlaying: () => model.isPlayingProperty.value && running(),
          read: () => ( {
            ...readFields( fields ),
            time: running() ? model.time : 0,
            flux: model.fluxEntries.map( entry => ( { ...entry } ) ),
            solutes: model.solutes.map( readParticle ),
            ligands: model.ligands.map( ligand => ( { ...readParticle( ligand ), manuallyBound: ligand.manuallyBound } ) ),
            proteins: model.membraneSlots.map( slot => {
              const protein = slot.transportProteinProperty.value;
              return protein ? { type: protein.type, state: protein.stateProperty.value, elapsed: protein.timeSinceStateTransition } : null;
            } )
          } ),
          prepare: input => {
            const state = object( input );
            const applyFields = prepareFields( fields, state );
            const { time, flux, solutes, ligands, proteins } = state;
            if ( !finite( time ) || !Array.isArray( flux ) || flux.length > 50000 ||
                 !Array.isArray( solutes ) || solutes.length > 15000 || !Array.isArray( ligands ) || ligands.length !== model.ligands.length ||
                 !Array.isArray( proteins ) || proteins.length !== model.membraneSlots.length ) {
              throw new Error( 'Invalid membrane transport population.' );
            }
            const savedProteins = proteins.map( entry => {
              if ( entry === null ) { return null; }
              const { type, state, elapsed } = object( entry );
              const proteinType = availableProteins.find( candidate => candidate === type );
              if ( !proteinType || !proteinStates[ proteinType ].includes( state as string ) || !finite( elapsed ) ) {
                throw new Error( 'Invalid membrane transport protein.' );
              }
              return { type: proteinType, state, elapsed };
            } );
            const proteinTypes = savedProteins.map( entry => entry?.type ?? null );
            const savedSolutes = solutes.map( entry => {
              const type = availableSolutes.find( candidate => candidate === object( entry ).type );
              if ( !type ) { throw new Error( 'Invalid solute type.' ); }
              return { type, ...prepareParticle( entry, proteinTypes, false ) };
            } );
            const savedLigands = ligands.map( ( entry, index ) => {
              const { type, manuallyBound } = object( entry );
              if ( type !== model.ligands[ index ].type || typeof manuallyBound !== 'boolean' ) { throw new Error( 'Invalid ligand.' ); }
              return { manuallyBound, ...prepareParticle( entry, proteinTypes, true ) };
            } );
            const savedFlux: FluxEntry[] = flux.map( entry => {
              const { soluteType, time: crossingTime, direction } = object( entry );
              if ( !availableSolutes.includes( soluteType as SoluteType ) || !finite( crossingTime, 0, time ) ||
                   ( direction !== 'inward' && direction !== 'outward' ) ) {
                throw new Error( 'Invalid membrane crossing.' );
              }
              return { soluteType: soluteType as SoluteType, time: crossingTime, direction };
            } );
            return () => {
              screen.view.interruptSubtreeInput();
              model.reset();
              model.focusedProteinProperty.value = null;
              applyFields();
              savedProteins.forEach( ( entry, slotIndex ) => {
                if ( entry ) {
                  const slot = model.membraneSlots[ slotIndex ];
                  const protein = createTransportProtein( model, entry.type, slot.position );
                  slot.transportProteinProperty.value = protein;
                  protein.stateProperty.value = entry.state;
                  protein.timeSinceStateTransition = entry.elapsed;
                }
              } );
              savedSolutes.forEach( entry => {
                const solute = new Solute( entry.point.copy(), entry.type, model );
                entry.apply( solute, model );
                model.solutes.push( solute );
              } );
              savedLigands.forEach( ( entry, index ) => {
                const ligand: Ligand = model.ligands[ index ];
                entry.apply( ligand, model );
                ligand.manuallyBound = entry.manuallyBound;
              } );
              model.time = time;
              model.fluxEntries.length = 0;
              model.fluxEntries.push( ...savedFlux );
              model.updateSoluteCounts();
            };
          }
        };
      } )
    };
  } );
}
