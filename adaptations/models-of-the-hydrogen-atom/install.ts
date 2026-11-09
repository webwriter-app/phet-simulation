// Models of the Hydrogen Atom WebWriter adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import MOTHAConstants from '../common/MOTHAConstants.js';
import BohrModel from '../common/model/BohrModel.js';
import ClassicalSolarSystemModel from '../common/model/ClassicalSolarSystemModel.js';
import DeBroglieModel from '../common/model/DeBroglieModel.js';
import type HydrogenAtom from '../common/model/HydrogenAtom.js';
import type MOTHAModel from '../common/model/MOTHAModel.js';
import PlumPuddingModel from '../common/model/PlumPuddingModel.js';
import QuantumElectron from '../common/model/QuantumElectron.js';
import SchrodingerElectron from '../common/model/SchrodingerElectron.js';
import SchrodingerModel from '../common/model/SchrodingerModel.js';
import SchrodingerQuantumNumbers from '../common/model/SchrodingerQuantumNumbers.js';
import SpectrometerDataPoint from '../common/model/SpectrometerDataPoint.js';
import SpectrometerSnapshot from '../common/model/SpectrometerSnapshot.js';
import SpectrometerAccordionBox from '../common/view/SpectrometerAccordionBox.js';
import ElectronEnergyLevelAccordionBox from '../energylevels/view/ElectronEnergyLevelAccordionBox.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

function validNumber( value: unknown, min: number, max = Number.MAX_SAFE_INTEGER ): value is number {
  return typeof value === 'number' && Number.isFinite( value ) && value >= min && value <= max;
}

function positiveInteger( value: unknown, max = Number.MAX_SAFE_INTEGER ): value is number {
  return validNumber( value, 1, max ) && Number.isSafeInteger( value );
}

function atomState( atom: HydrogenAtom ) {
  if ( atom instanceof BohrModel ) {
    const electron = atom.electron;
    const nlm = electron instanceof SchrodingerElectron ? electron[ '_nlmProperty' ] : null;
    const fields = {
      angle: number( electron.angleProperty ),
      elapsed: number( electron.timeInStateProperty, false, value => value >= 0 ),
      ...( atom instanceof DeBroglieModel ? { representation: enumeration( atom.deBroglieRepresentationProperty ) } : {} ),
      ...( atom instanceof SchrodingerModel ? {
        metastableElapsed: number( atom.metastableHandler[ 'elapsedTimeProperty' ], false, value => value >= 0 )
      } : {} )
    };
    return {
      read: () => {
        const numbers = nlm?.value;
        return { ...readFields( fields ), n: electron.nProperty.value, ...( numbers ? { lm: [ numbers.l, numbers.m ] } : {} ) };
      },
      prepare: ( input: unknown ) => {
        const state = object( input );
        const applyFields = prepareFields( fields, state );
        const { n, lm } = state;
        if ( !positiveInteger( n, QuantumElectron.MAX_STATE ) ) { throw new Error( 'Invalid principal quantum number.' ); }
        if ( nlm ) {
          if ( !Array.isArray( lm ) || lm.length !== 2 || !SchrodingerQuantumNumbers.isValidState( n, lm[ 0 ], lm[ 1 ] ) ) {
            throw new Error( 'Invalid Schrödinger quantum numbers.' );
          }
          const numbers = new SchrodingerQuantumNumbers( n, lm[ 0 ], lm[ 1 ] );
          return () => {
            nlm.value = numbers;
            applyFields();
          };
        }
        return () => {
          electron.set_n( n );
          applyFields();
        };
      }
    };
  }
  const fields: Parameters<typeof readFields>[0] = atom instanceof ClassicalSolarSystemModel ? {
    position: vector( atom.electron.positionProperty ),
    angle: number( atom.electron.angleProperty ),
    speed: number( atom.electron.angularSpeedProperty, false, value => value >= 0 )
  } : atom instanceof PlumPuddingModel ? {
    position: vector( atom.electron.positionProperty ),
    moving: boolean( atom.electron.isMovingProperty ),
    direction: enumeration( atom.electron[ 'xDirectionProperty' ] ),
    amplitude: number( atom.electron.previousAmplitudeProperty ),
    perimeter: vector( atom[ 'perimeterPointProperty' ] ),
    zeroCrossings: number( atom[ 'numberOfZeroCrossingsProperty' ], true, value => value >= 0 ),
    absorbed: number( atom[ 'numberOfPhotonsAbsorbedProperty' ], true, value => value >= 0 )
  } : {};
  return {
    read: () => readFields( fields ),
    prepare: ( input: unknown ) => prepareFields( fields, input )
  };
}

function accordions( node: Node ): ( SpectrometerAccordionBox | ElectronEnergyLevelAccordionBox )[] {
  return node instanceof SpectrometerAccordionBox || node instanceof ElectronEnergyLevelAccordionBox ?
    [ node ] : node.children.flatMap( accordions );
}

function readDataPoints( input: unknown ): SpectrometerDataPoint[] {
  if ( !Array.isArray( input ) || input.length > 10000 ) { throw new Error( 'Invalid spectrum.' ); }
  const wavelengths = new Set<number>();
  return input.map( point => {
    if ( !Array.isArray( point ) || point.length !== 2 || !positiveInteger( point[ 0 ], 100000 ) ||
         !positiveInteger( point[ 1 ] ) || wavelengths.has( point[ 0 ] ) ) {
      throw new Error( 'Invalid spectrometer reading.' );
    }
    wavelengths.add( point[ 0 ] );
    return new SpectrometerDataPoint( point[ 0 ], point[ 1 ] );
  } );
}

function writeDataPoints( points: SpectrometerDataPoint[] ) {
  return points.map( point => [ point.wavelength, point.numberOfPhotonsEmitted ] );
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-models-of-the-hydrogen-atom/v1',
    build: 'models-of-the-hydrogen-atom@1.1.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => {
      const model = screen.model as MOTHAModel;
      const source = model.lightSource;
      const spectrometer = model.spectrometer;
      const views = accordions( screen.view );
      const spectrumView = views.find( node => node instanceof SpectrometerAccordionBox );
      const energyView = views.find( node => node instanceof ElectronEnergyLevelAccordionBox );
      const atoms = [ ...model.atomicModels, model.experiment ];
      const atomStates = atoms.map( atomState );
      const fields = {
        playing: boolean( model.isPlayingProperty ),
        speed: enumeration( model.timeSpeedProperty ),
        modelOrExperiment: enumeration( model.modelOrExperimentProperty ),
        atomicModel: field( model.atomicModelProperty, atom => model.atomicModels.indexOf( atom ), value =>
          typeof value === 'number' && Number.isInteger( value ) ? model.atomicModels[ value ] : undefined ),
        light: boolean( source.isOnProperty ),
        lightMode: enumeration( source.lightModeProperty ),
        wavelength: number( source.monochromaticWavelengthProperty, true ),
        lightElapsed: number( source[ 'dtSincePhotonEmittedProperty' ], false, value => value >= 0 ),
        ...( spectrumView ? { spectrumExpanded: boolean( spectrumView.expandedProperty ) } : {} ),
        ...( energyView ? { energyExpanded: boolean( energyView.expandedProperty ) } : {} )
      };
      return {
        id: index === 0 ? 'spectra' : 'energy-levels',
        screen,
        isPlaying: () => {
          const atom = model.hydrogenAtomProperty.value;
          return model.isPlayingProperty.value && ( source.isOnProperty.value || model.photonGroup.count > 0 ||
            atom instanceof BohrModel || ( atom instanceof ClassicalSolarSystemModel && !atom.isDestroyedProperty.value ) ||
            ( atom instanceof PlumPuddingModel && atom.electron.isMovingProperty.value ) );
        },
        read: () => {
          const photons: unknown[] = [];
          model.photonGroup.forEach( photon => {
            const point = photon.positionProperty.value;
            photons.push( {
              wavelength: photon.wavelength,
              position: [ point.x, point.y ],
              direction: photon.direction,
              fromAtom: photon.wasEmittedByAtom,
              collided: photon.hasCollidedWithAtom
            } );
          } );
          return {
            ...readFields( fields ),
            atoms: atomStates.map( atom => atom.read() ),
            spectrum: writeDataPoints( spectrometer.dataPointsProperty.value ),
            nextSnapshot: spectrometer[ 'nextSnapshotNumberProperty' ].value,
            snapshots: spectrometer.snapshotsProperty.value.map( snapshot => ( {
              number: snapshot.snapshotNumber,
              atom: atoms.indexOf( snapshot.hydrogenAtom ),
              spectrum: writeDataPoints( snapshot.dataPoints )
            } ) ),
            photons
          };
        },
        prepare: input => {
          const state = object( input );
          const applyFields = prepareFields( fields, state );
          const { atoms: savedAtoms, nextSnapshot, snapshots, photons } = state;
          if ( !Array.isArray( savedAtoms ) || savedAtoms.length !== atoms.length || !positiveInteger( nextSnapshot ) ||
               !Array.isArray( snapshots ) || snapshots.length > MOTHAConstants.MAX_SPECTROMETER_SNAPSHOTS ||
               !Array.isArray( photons ) || photons.length > 5000 ) {
            throw new Error( 'Invalid hydrogen atom experiment.' );
          }
          const restoreAtoms = atomStates.map( ( atom, atomIndex ) => atom.prepare( savedAtoms[ atomIndex ] ) );
          const spectrum = readDataPoints( state.spectrum );
          const snapshotNumbers = new Set<number>();
          const savedSnapshots = snapshots.map( entry => {
            const { number, atom, spectrum } = object( entry );
            if ( !positiveInteger( number, nextSnapshot - 1 ) || snapshotNumbers.has( number ) ||
                 typeof atom !== 'number' || !Number.isInteger( atom ) || !atoms[ atom ] ) {
              throw new Error( 'Invalid spectrum snapshot.' );
            }
            snapshotNumbers.add( number );
            return { number, atom: atoms[ atom ], spectrum: readDataPoints( spectrum ) };
          } );
          const savedPhotons = photons.map( entry => {
            const { wavelength, position, direction, fromAtom, collided } = object( entry );
            if ( !positiveInteger( wavelength, 100000 ) || !Array.isArray( position ) || position.length !== 2 ||
                 !position.every( coordinate => validNumber( coordinate, -10000, 10000 ) ) ||
                 !validNumber( direction, -100000, 100000 ) || typeof fromAtom !== 'boolean' || typeof collided !== 'boolean' ) {
              throw new Error( 'Invalid photon.' );
            }
            return { wavelength, position: new Vector2( position[ 0 ], position[ 1 ] ), direction,
              wasEmittedByAtom: fromAtom, hasCollidedWithAtom: collided };
          } );
          return () => {
            screen.view.interruptSubtreeInput();
            model.photonGroup.clear();
            spectrometer.reset();
            applyFields();
            restoreAtoms.forEach( apply => apply() );
            spectrometer.dataPointsProperty.value = spectrum;
            spectrometer.snapshotsProperty.value = savedSnapshots.map( snapshot =>
              new SpectrometerSnapshot( snapshot.number, snapshot.atom, snapshot.spectrum ) );
            spectrometer[ 'nextSnapshotNumberProperty' ].value = nextSnapshot;
            savedPhotons.forEach( photon => model.photonGroup.createNextElement( photon ) );
          };
        }
      };
    } )
  } ) );
}
