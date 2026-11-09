// State adapter for PhET Molecule Polarity. Distributed under GPL-3.0.
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import FireListener from '../../../scenery/js/listeners/FireListener.js';
import Node from '../../../scenery/js/nodes/Node.js';
import AquaRadioButton from '../../../sun/js/AquaRadioButton.js';
import Checkbox from '../../../sun/js/Checkbox.js';
import MPPreferences from '../common/model/MPPreferences.js';
import type { SurfaceType } from '../common/model/SurfaceType.js';
import SurfaceRadioButtonGroup from '../common/view/SurfaceRadioButtonGroup.js';
import type RealMoleculesModel from '../realmolecules/model/RealMoleculesModel.js';
import type ThreeAtomsModel from '../threeatoms/model/ThreeAtomsModel.js';
import type TwoAtomsModel from '../twoatoms/model/TwoAtomsModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

function find<T extends Node>( root: Node, match: ( node: Node ) => node is T ): T | undefined {
  if ( match( root ) ) { return root; }
  for ( const child of root.children ) {
    const result = find( child, match );
    if ( result ) { return result; }
  }
}

function checkbox( root: Node, name: string ) {
  const control = find( root, ( node ): node is Checkbox => node instanceof Checkbox && node.tandem.name === name );
  if ( !control ) { throw new Error( `Molecule Polarity checkbox unavailable: ${name}.` ); }
  return boolean( control.property );
}

function surface( root: Node ) {
  // The screen owns this property in a constructor closure. Use the radio group's actual selection and input path.
  const group = find( root, ( node ): node is SurfaceRadioButtonGroup => node instanceof SurfaceRadioButtonGroup );
  const buttons = group?.children.filter( ( node ): node is AquaRadioButton<SurfaceType> => node instanceof AquaRadioButton );
  if ( buttons?.length !== 3 ) { throw new Error( 'Molecule Polarity surface controls unavailable.' ); }
  return {
    read: () => buttons.find( button => button.pdomChecked )?.value ?? 'none',
    prepare: ( input: unknown ) => {
      const button = buttons.find( option => option.value === input );
      const listener = button?.inputListeners.find( candidate => candidate instanceof FireListener );
      if ( !button || !( listener instanceof FireListener ) ) { throw new Error( 'Invalid Molecule Polarity surface.' ); }
      return () => { if ( !button.pdomChecked ) { listener.fire( null ); } };
    }
  };
}

function atoms( screen: AnyScreen, id: 'two-atoms' | 'three-atoms' ) {
  const model = screen.model as TwoAtomsModel | ThreeAtomsModel;
  const molecule = 'triatomicMolecule' in model ? model.triatomicMolecule : model.diatomicMolecule;
  const three = 'bondAngleABProperty' in molecule ? molecule : null;
  const view = screen.view;
  const fields = {
    angle: number( molecule.angleProperty ),
    electricField: boolean( model.eFieldEnabledProperty ),
    atomA: number( molecule.atomA.electronegativityProperty ),
    atomB: number( molecule.atomB.electronegativityProperty ),
    partialCharges: checkbox( view, 'partialChargesCheckbox' ),
    ...( three ? {
      atomC: number( three.atomC.electronegativityProperty ),
      angleAB: number( three.bondAngleABProperty ),
      angleBC: number( three.bondAngleBCProperty ),
      bondDipoles: checkbox( view, 'bondDipolesCheckbox' ),
      molecularDipole: checkbox( view, 'molecularDipoleCheckbox' )
    } : {
      bondDipoles: checkbox( view, 'bondDipoleCheckbox' ),
      bondCharacter: checkbox( view, 'bondCharacterCheckbox' ),
      surface: surface( view )
    } )
  };
  return {
    id,
    screen,
    isPlaying: () => model.eFieldEnabledProperty.value && molecule.isRotatingDueToEFieldProperty.value,
    read: () => readFields( fields ),
    prepare: ( input: unknown ) => {
      const apply = prepareFields( fields, input );
      return () => {
        view.interruptSubtreeInput();
        apply();
      };
    }
  };
}

function realMolecules( screen: AnyScreen ) {
  const model = screen.model as RealMoleculesModel;
  const view = screen.view;
  const fields = {
    molecule: field( model.moleculeProperty, molecule => molecule.symbol, input => model.molecules.find( option => option.symbol === input ) ),
    advanced: boolean( model.isAdvancedProperty ),
    bondDipoles: checkbox( view, 'bondDipolesCheckbox' ),
    molecularDipole: checkbox( view, 'molecularDipoleCheckbox' ),
    partialCharges: checkbox( view, 'partialChargesCheckbox' ),
    electronegativities: checkbox( view, 'atomElectronegativitiesCheckbox' ),
    atomLabels: checkbox( view, 'atomLabelsCheckbox' ),
    surface: surface( view )
  };
  return {
    id: 'real-molecules',
    screen,
    read: () => {
      const rotation = model.moleculeQuaternionProperty.value;
      return { ...readFields( fields ), rotation: [ rotation.x, rotation.y, rotation.z, rotation.w ] };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const rotation = state.rotation;
      if ( !Array.isArray( rotation ) || rotation.length !== 4 || !rotation.every( Number.isFinite ) ||
           Math.abs( Math.hypot( ...rotation ) - 1 ) > 1e-4 ) {
        throw new Error( 'Invalid molecule rotation.' );
      }
      const quaternion = model.moleculeQuaternionProperty.value.clone().set( rotation[ 0 ], rotation[ 1 ], rotation[ 2 ], rotation[ 3 ] );
      return () => {
        view.interruptSubtreeInput();
        apply();
        model.moleculeQuaternionProperty.value = quaternion;
      };
    }
  };
}

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => {
    const preferences = {
      dipoleDirection: enumeration( MPPreferences.dipoleDirectionProperty ),
      surfaceColor: enumeration( MPPreferences.surfaceColorProperty )
    };
    return {
      bridge: 'webwriter-molecule-polarity/v1',
      build: 'molecule-polarity@2.1.0-dev.0-webwriter.1',
      screens: [ atoms( sim.simScreens[ 0 ], 'two-atoms' ), atoms( sim.simScreens[ 1 ], 'three-atoms' ), realMolecules( sim.simScreens[ 2 ] ) ],
      readPreferences: () => readFields( preferences ),
      preparePreferences: input => prepareFields( preferences, input )
    };
  } );
}
