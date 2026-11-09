// States of Matter family state bindings. Distributed under GPL-3.0.
import type { AnyScreen } from '../Screen.js';
import type MultipleParticleModel from '../../../states-of-matter/js/common/model/MultipleParticleModel.js';
import type { MultipleParticleModelStateObject } from '../../../states-of-matter/js/common/model/MultipleParticleModel.js';
import SOMConstants from '../../../states-of-matter/js/common/SOMConstants.js';
import SubstanceType from '../../../states-of-matter/js/common/SubstanceType.js';
import PhaseChangesModel from '../../../states-of-matter/js/phase-changes/PhaseChangesModel.js';
import type StatesScreenView from '../../../states-of-matter/js/states/view/StatesScreenView.js';
import { boolean, enumeration, number, object, prepareFields, readFields } from './stateFields.js';

const vectorNames = [ 'moleculeCenterOfMassPositions', 'moleculeVelocities', 'moleculeForces', 'nextMoleculeForces' ] as const;
const scalarNames = [ 'moleculeRotationAngles', 'moleculeRotationRates', 'moleculeTorques', 'nextMoleculeTorques' ] as const;
const species = { NEON: 1, ARGON: 1, DIATOMIC_OXYGEN: 2, WATER: 3, ADJUSTABLE_ATOM: 1 };

function finite( value: unknown, min = -1e15, max = 1e15 ): value is number {
  return typeof value === 'number' && Number.isFinite( value ) && value >= min && value <= max;
}

function vectorValue( input: unknown ) {
  const { x, y } = object( input );
  return finite( x ) && finite( y );
}

function array( input: unknown, length: number, validate: ( value: unknown ) => boolean ) {
  if ( !Array.isArray( input ) || input.length !== length || !input.every( validate ) ) {
    throw new Error( 'Invalid molecular particle data.' );
  }
  return input;
}

function thermostat( input: unknown, isokinetic: boolean ) {
  const state = object( input );
  if ( !finite( state.targetTemperature, -1, 100 ) || !finite( state.minModelTemperature, 0, 1 ) ||
       !vectorValue( state.previousParticleVelocity ) || !vectorValue( state.totalVelocityChangeThisStep ) ||
       !vectorValue( state.accumulatedAverageVelocityChange ) ||
       ( isokinetic ? !finite( state.previousTemperatureScaleFactor, 0 ) : !vectorValue( state.totalVelocityChangePreviousStep ) ) ) {
    throw new Error( 'Invalid molecular thermostat.' );
  }
}

export default function statesOfMatterState( screen: AnyScreen, adjustable: boolean ) {
  const model = screen.model as MultipleParticleModel;
  const view = screen.view as StatesScreenView;
  const thermometer = view[ 'particleContainerNode' ][ 'compositeThermometerNode' ];
  const phase = model instanceof PhaseChangesModel ? model : null;
  const controls = {
    temperatureUnits: enumeration( thermometer[ 'temperatureUnitsProperty' ] ),
    temperature: number( model.temperatureSetPointProperty, false, value => value >= 0.00001 && value <= 50 ),
    playing: boolean( model.isPlayingProperty ),
    ...( phase ? {
      diagram: boolean( phase.phaseDiagramExpandedProperty ),
      potential: boolean( phase.interactionPotentialExpandedProperty ),
      strength: number( phase.adjustableAtomInteractionStrengthProperty ),
      lidTarget: number( phase.targetContainerHeightProperty )
    } : {} )
  };
  return {
    isPlaying: () => model.isPlayingProperty.value,
    read: () => {
      const physics = model.toStateObject();
      const data = physics._moleculeDataSet;
      const count = data.numberOfMolecules;
      data.atomPositions = data.atomPositions.slice( 0, data.numberOfAtoms );
      data.insideContainer = data.insideContainer.slice( 0, count );
      vectorNames.forEach( key => { data[ key ] = data[ key ].slice( 0, count ); } );
      scalarNames.forEach( key => { data[ key ] = data[ key ].slice( 0, count ); } );
      return {
        ...readFields( controls ),
        physics,
        targetCount: model.targetNumberOfMoleculesProperty.value,
        queued: model[ 'numMoleculesQueuedForInjectionProperty' ].value,
        injectionHoldoff: model[ 'moleculeInjectionHoldoffTimer' ],
        residualTime: model[ 'residualTime' ]
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( controls, state );
      const physics = object( state.physics );
      const data = object( physics._moleculeDataSet );
      const substance = typeof physics._substance === 'string' && Object.hasOwn( species, physics._substance ) ?
        physics._substance as keyof typeof species : null;
      if ( !substance || ( substance === 'ADJUSTABLE_ATOM' && !adjustable ) ||
           typeof physics._isExploded !== 'boolean' || !finite( physics._containerHeight, 0, 1e12 ) ||
           !finite( physics._gravitationalAcceleration ) || !finite( physics._normalizedLidVelocityY ) ||
           !finite( physics._heatingCoolingAmount, -1, 1 ) || !finite( physics._moleculeForcesAndMotionCalculatorPressure, 0 ) ) {
        throw new Error( 'Invalid States of Matter conditions.' );
      }
      const { numberOfMolecules: count, numberOfAtoms: atoms, atomsPerMolecule } = data;
      const { targetCount, queued, injectionHoldoff, residualTime } = state;
      const max = Math.floor( SOMConstants.MAX_NUM_ATOMS / species[ substance ] );
      if ( atomsPerMolecule !== species[ substance ] || !finite( count, 0, max ) || !Number.isInteger( count ) ||
           atoms !== count * atomsPerMolecule || !finite( data.moleculeMass, 0.1, 10 ) ||
           !finite( data.moleculeRotationalInertia, 1e-8, 100 ) || !finite( targetCount, 0, max ) ||
           !Number.isInteger( targetCount ) || !finite( queued, 0, 3 ) || !Number.isInteger( queued ) ||
           !finite( injectionHoldoff, 0, 1 ) || !finite( residualTime, 0, 1 ) ) {
        throw new Error( 'Invalid molecular population.' );
      }
      array( data.atomPositions, atoms as number, vectorValue );
      array( data.insideContainer, count, value => typeof value === 'boolean' );
      vectorNames.forEach( key => array( data[ key ], count, vectorValue ) );
      scalarNames.forEach( key => array( data[ key ], count, value => finite( value ) ) );
      thermostat( physics._isoKineticThermostatState, true );
      thermostat( physics._andersenThermostatState, false );
      const molecularState = physics as unknown as MultipleParticleModelStateObject;
      return () => {
        view.interruptSubtreeInput();
        model.isPlayingProperty.value = false;
        model.substanceProperty.value = SubstanceType[ substance ];
        // Apply the temperature readout and other controls before rehydrating the engine's exact thermostat state.
        apply();
        model.applyState( molecularState );
        model.temperatureSetPointProperty.value = state.temperature as number;
        model.targetNumberOfMoleculesProperty.value = targetCount;
        model[ 'numMoleculesQueuedForInjectionProperty' ].value = queued;
        model[ 'moleculeInjectionHoldoffTimer' ] = injectionHoldoff;
        model[ 'residualTime' ] = residualTime;
        if ( phase ) { phase.targetContainerHeightProperty.value = state.lidTarget as number; }
        model[ 'updatePressure' ]();
      };
    }
  };
}
