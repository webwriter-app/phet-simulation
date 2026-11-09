// State bindings shared by the Molecule Shapes simulations. Distributed under GPL-3.0.
import Vector3 from '../../../dot/js/Vector3.js';
import type Sim from '../../../joist/js/Sim.js';
import MoleculeShapesGlobals from '../../../molecule-shapes/js/common/MoleculeShapesGlobals.js';
import Bond from '../../../molecule-shapes/js/common/model/Bond.js';
import PairGroup from '../../../molecule-shapes/js/common/model/PairGroup.js';
import RealMolecule from '../../../molecule-shapes/js/common/model/RealMolecule.js';
import RealMoleculeShape from '../../../molecule-shapes/js/common/model/RealMoleculeShape.js';
import VSEPRMolecule from '../../../molecule-shapes/js/common/model/VSEPRMolecule.js';
import ModelMoleculesModel from '../../../molecule-shapes/js/model/ModelMoleculesModel.js';
import RealMoleculesModel from '../../../molecule-shapes/js/real/RealMoleculesModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, object, prepareFields, readFields } from './stateFields.js';

function coordinates( value: Vector3 ) { return [ value.x, value.y, value.z ]; }

function vector( input: unknown ) {
  if ( !Array.isArray( input ) || input.length !== 3 || !input.every( Number.isFinite ) ||
       input.some( value => Math.abs( value ) > 1e4 ) ) {
    throw new Error( 'Invalid Molecule Shapes coordinates.' );
  }
  return new Vector3( input[ 0 ], input[ 1 ], input[ 2 ] );
}

function bindScreen( sim: Sim, index: number, basics: boolean ) {
  const screen = sim.simScreens[ index ];
  const model = screen.model as ModelMoleculesModel | RealMoleculesModel;
  const real = model instanceof RealMoleculesModel ? model : null;
  const fields = {
    bondAngles: boolean( model.showBondAnglesProperty ),
    moleculeGeometry: boolean( model.showMoleculeGeometryProperty ),
    ...( basics ? {} : {
      lonePairs: boolean( model.showLonePairsProperty ),
      electronGeometry: boolean( model.showElectronGeometryProperty )
    } ),
    ...( real ? {
      shape: field<RealMoleculeShape>( real.realMoleculeShapeProperty, shape => shape.displayName,
        input => real.realMoleculeShapeProperty.validValues?.find( ( option: RealMoleculeShape ) => option.displayName === input ) ),
      ...( basics ? {} : { realView: boolean( real.showRealViewProperty ) } )
    } : {} )
  };
  return {
    id: real ? 'real-molecules' : 'model',
    screen,
    isPlaying: () => model.moleculeProperty.value.groups.some( ( group: PairGroup ) => group.velocityProperty.value.magnitude > 0.01 ),
    read: () => {
      const molecule = model.moleculeProperty.value;
      const rotation = model.moleculeQuaternionProperty.value;
      return {
        ...readFields( fields ),
        rotation: [ rotation.x, rotation.y, rotation.z, rotation.w ],
        groups: molecule.groups.map( ( group: PairGroup ) => ( {
          position: coordinates( group.positionProperty.value ),
          velocity: coordinates( group.velocityProperty.value ),
          lonePair: group.isLonePair
        } ) ),
        bonds: molecule.bonds.map( ( bond: Bond ) => bond.toStateObject( molecule.groups ) ),
        midpoint: molecule.lastMidpoint ? coordinates( molecule.lastMidpoint ) : null
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const shape = real?.realMoleculeShapeProperty.validValues?.find( ( option: RealMoleculeShape ) => option.displayName === state.shape );
      const realView = !!real && ( basics || state.realView === true );
      const canonical = shape ? new RealMolecule( shape ) : null;
      if ( !Array.isArray( state.rotation ) || state.rotation.length !== 4 || !state.rotation.every( Number.isFinite ) ||
           Math.abs( Math.hypot( ...state.rotation ) - 1 ) > 1e-4 ||
           !Array.isArray( state.groups ) || state.groups.length < 1 || state.groups.length > 32 ||
           ( canonical ? state.groups.length !== canonical.groups.length : state.groups.length > 7 ) ||
           !Array.isArray( state.bonds ) || state.bonds.length !== state.groups.length - 1 ) {
        throw new Error( 'Invalid Molecule Shapes geometry.' );
      }
      const rotation = model.moleculeQuaternionProperty.value.clone().set(
        state.rotation[ 0 ], state.rotation[ 1 ], state.rotation[ 2 ], state.rotation[ 3 ] );
      const midpoint = state.midpoint === null ? null : vector( state.midpoint );
      const groupStates = state.groups.map( object );
      // The model keeps lone pairs at the front of its groups array, ahead of the central atom.
      const center = groupStates.findIndex( group => group.lonePair === false );
      if ( center < 0 || groupStates.slice( center ).some( group => group.lonePair !== false ) ) {
        throw new Error( 'Invalid Molecule Shapes central atom.' );
      }
      const groups = groupStates.map( ( group, index ) => {
        const position = vector( group.position );
        const velocity = vector( group.velocity );
        if ( typeof group.lonePair !== 'boolean' || ( !real && basics && group.lonePair ) ||
             ( index === center && ( position.magnitude !== 0 || velocity.magnitude !== 0 ) ) ||
             ( index !== center && position.magnitude === 0 ) ||
             ( realView && group.lonePair !== canonical?.groups[ index ].isLonePair ) ) {
          throw new Error( 'Invalid Molecule Shapes atom.' );
        }
        const pair = new PairGroup( position, group.lonePair );
        pair.velocityProperty.value = velocity;
        return pair;
      } );
      const parents = new Set<number>();
      const bonds = state.bonds.map( ( input, index ) => {
        const bond = object( input );
        const { a, b, order, length } = bond;
        if ( typeof a !== 'number' || !Number.isInteger( a ) || a < 0 || a >= groups.length || a === center || parents.has( a ) ||
             typeof b !== 'number' || !Number.isInteger( b ) || b < center || b >= groups.length || a === b ||
             typeof order !== 'number' || !Number.isInteger( order ) || order < 0 || order > 3 ||
             typeof length !== 'number' || !Number.isFinite( length ) || length < 0 || length > 100 ||
             groups[ b ].isLonePair || groups[ a ].isLonePair !== ( order === 0 ) ||
             ( !real && b !== center ) ||
             ( b !== center && order !== 0 ) ) {
          throw new Error( 'Invalid Molecule Shapes bond.' );
        }
        if ( realView ) {
          const expected = canonical!.bonds[ index ].toStateObject( canonical!.groups );
          if ( a !== expected.a || b !== expected.b || order !== expected.order || length !== expected.length ) {
            throw new Error( 'Invalid real molecule bond.' );
          }
        }
        parents.add( a );
        return new Bond( groups[ a ], groups[ b ], order, length );
      } );
      const molecule = realView ? canonical! : new VSEPRMolecule();
      if ( realView ) {
        groups.forEach( ( group, index ) => {
          molecule.groups[ index ].positionProperty.value = group.positionProperty.value;
          molecule.groups[ index ].velocityProperty.value = group.velocityProperty.value;
        } );
      }
      else {
        molecule.addCentralAtom( groups[ center ] );
        groups.slice( center + 1 ).forEach( group => molecule.addGroup( group, false ) );
        groups.slice( 0, center ).reverse().forEach( group => molecule.addGroup( group, false ) );
        bonds.filter( bond => bond.order > 0 ).forEach( bond => molecule.addBond( bond ) );
        bonds.filter( bond => bond.order === 0 ).reverse().forEach( bond => molecule.addBond( bond ) );
      }
      molecule.lastMidpoint = midpoint;
      return () => {
        screen.view.interruptSubtreeInput();
        apply();
        model.moleculeProperty.value = molecule;
        model.moleculeQuaternionProperty.value = rotation;
      };
    }
  };
}

export default function installMoleculeShapesState( sim: Sim, basics: boolean ) {
  const id = basics ? 'molecule-shapes-basics' : 'molecule-shapes';
  installSimulationBridge( sim, () => {
    const preferences = { showOuterLonePairs: boolean( MoleculeShapesGlobals.showOuterLonePairsProperty ) };
    return {
      bridge: `webwriter-${id}/v1`,
      build: `${id}@1.7.0-dev.0-webwriter.1`,
      screens: [ bindScreen( sim, 0, basics ), bindScreen( sim, 1, basics ) ],
      ...( basics ? {} : {
        readPreferences: () => readFields( preferences ),
        preparePreferences: ( input: unknown ) => prepareFields( preferences, input )
      } )
    };
  } );
}
