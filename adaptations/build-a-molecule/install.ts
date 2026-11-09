// Build a Molecule WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import Dimension2 from '../../../dot/js/Dimension2.js';
import Vector2 from '../../../dot/js/Vector2.js';
import Atom from '../../../nitroglycerin/js/Atom.js';
import Element from '../../../nitroglycerin/js/Element.js';
import type Atom2 from '../common/model/Atom2.js';
import BAMBucket from '../common/model/BAMBucket.js';
import type BAMModel from '../common/model/BAMModel.js';
import Bond from '../common/model/Bond.js';
import CollectionBox from '../common/model/CollectionBox.js';
import Direction from '../common/model/Direction.js';
import Kit from '../common/model/Kit.js';
import KitCollection from '../common/model/KitCollection.js';
import Molecule from '../common/model/Molecule.js';
import MoleculeList, { COLLECTION_BOX_MOLECULES } from '../common/model/MoleculeList.js';
import type BAMScreenView from '../common/view/BAMScreenView.js';
import installSimulationBridge from './installSimulationBridge.js';
import { object } from './stateFields.js';

const screenIds = [ 'single', 'multiple', 'playground' ];
const elements = new Map( Element.elements.map( element => [ element.symbol, element ] ) );

function readLayout( collection: KitCollection ) {
  return {
    boxes: collection.collectionBoxes.map( box => [ box.moleculeType.cid, box.capacity ] ),
    kits: collection.kits.map( kit => kit.buckets.map( bucket => [
      bucket.element.symbol, bucket.size.width, bucket.size.height, bucket.fullState.length
    ] ) )
  };
}

function prepareLayout( model: BAMModel, input: unknown, index: number ) {
  const { boxes, kits } = object( input );
  const firstLayout = readLayout( model.firstCollection );
  if ( !Array.isArray( boxes ) || boxes.length !== firstLayout.boxes.length ||
       !Array.isArray( kits ) || kits.length < 1 || kits.length > 24 ||
       ( index === 0 && JSON.stringify( { boxes, kits } ) !== JSON.stringify( firstLayout ) ) ) {
    throw new Error( 'Invalid molecule collection layout.' );
  }
  const boxModels = [ ...model.firstCollection.collectionBoxes.map( box => box.moleculeType ), ...COLLECTION_BOX_MOLECULES ];
  const boxSpecs = boxes.map( box => {
    if ( !Array.isArray( box ) || box.length !== 2 || !Number.isInteger( box[ 1 ] ) || box[ 1 ] < 1 || box[ 1 ] > ( index === 0 ? 4 : 3 ) ) {
      throw new Error( 'Invalid molecule collection box.' );
    }
    const molecule = boxModels.find( molecule => molecule.cid === box[ 0 ] );
    if ( !molecule ) {
      throw new Error( 'Unknown molecule collection target.' );
    }
    return { molecule, capacity: box[ 1 ] as number };
  } );
  const kitSpecs = kits.map( kit => {
    if ( !Array.isArray( kit ) || kit.length < 1 || kit.length > 12 ) {
      throw new Error( 'Invalid molecule kit.' );
    }
    return kit.map( bucket => {
      if ( !Array.isArray( bucket ) || bucket.length !== 4 ) {
        throw new Error( 'Invalid atom bucket.' );
      }
      const [ symbol, width, height, count ] = bucket;
      const element = elements.get( symbol );
      if ( !element || !Number.isFinite( width ) || width < 200 || width > 10000 ||
           height !== 200 || !Number.isInteger( count ) || count < 1 || count > 100 ) {
        throw new Error( 'Invalid atom bucket.' );
      }
      return { element, size: new Dimension2( width, height ), count: count as number };
    } );
  } );
  return {
    signature: JSON.stringify( { boxes, kits } ),
    boxes: boxSpecs,
    kits: kitSpecs,
    create: () => {
      const collection = new KitCollection();
      kitSpecs.forEach( kit => collection.addKit( new Kit( model.collectionLayout,
        kit.map( bucket => new BAMBucket( bucket.size, model.stepEmitter, bucket.element, bucket.count ) ) ) ) );
      boxSpecs.forEach( box => collection.addCollectionBox( new CollectionBox( box.molecule, box.capacity, { initializeAudio: false } ) ) );
      return collection;
    }
  };
}

function vector( input: unknown ): Vector2 {
  if ( !Array.isArray( input ) || input.length !== 2 ||
       !input.every( value => typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) <= 20000 ) ) {
    throw new Error( 'Invalid molecule atom position.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}

function prepareCollection( model: BAMModel, input: unknown, index: number ) {
  const { layout, kits, currentKit, boxQuantities } = object( input );
  const collectionLayout = prepareLayout( model, layout, index );
  if ( !Array.isArray( kits ) || kits.length !== collectionLayout.kits.length ||
       typeof currentKit !== 'number' || !Number.isInteger( currentKit ) || !collectionLayout.kits[ currentKit ] ) {
    throw new Error( 'Invalid molecule kit selection.' );
  }
  if ( !Array.isArray( boxQuantities ) || boxQuantities.length !== collectionLayout.boxes.length ||
       !boxQuantities.every( ( quantity, index ) =>
         Number.isInteger( quantity ) && quantity >= 0 && quantity <= collectionLayout.boxes[ index ].capacity ) ) {
    throw new Error( 'Invalid molecule collection quantities.' );
  }
  const rebuildKits = kits.map( ( input, kitIndex ) => {
    const { molecules, selected, collectedAtoms } = object( input );
    const kitElements = collectionLayout.kits[ kitIndex ].flatMap( bucket => Array.from( { length: bucket.count }, () => bucket.element ) );
    if ( !Array.isArray( molecules ) || molecules.length > kitElements.length ) {
      throw new Error( 'Invalid molecule count.' );
    }
    if ( !Array.isArray( collectedAtoms ) || new Set( collectedAtoms ).size !== collectedAtoms.length ||
         !collectedAtoms.every( index => Number.isInteger( index ) && kitElements[ index ] ) ) {
      throw new Error( 'Invalid collected atom inventory.' );
    }
    const used = new Set<number>( collectedAtoms );
    const playable = new Set<number>();
    const rebuild = molecules.map( input => {
      const { atoms, bonds } = object( input );
      if ( !Array.isArray( atoms ) || !atoms.length || atoms.length > kitElements.length ||
           !Array.isArray( bonds ) || bonds.length !== atoms.length - 1 ) {
        throw new Error( 'Invalid molecular structure.' );
      }
      const specimen = new Molecule();
      const positions = atoms.map( input => {
        const { index, position, destination } = object( input );
        if ( typeof index !== 'number' || !Number.isInteger( index ) || !kitElements[ index ] || used.has( index ) ) {
          throw new Error( 'Invalid atom reference.' );
        }
        used.add( index );
        playable.add( index );
        specimen.addAtom( new Atom( kitElements[ index ] ) );
        return { index, position: vector( position ), destination: vector( destination ) };
      } );
      const connected = positions.map( ( _, index ) => index );
      const slots = positions.map( () => new Set<Direction>() );
      const links = bonds.map( input => {
        if ( !Array.isArray( input ) || input.length !== 3 ) {
          throw new Error( 'Invalid molecular bond.' );
        }
        const [ a, b, name ] = input;
        const direction = Direction.VALUES.find( direction => direction.id === name );
        if ( !Number.isInteger( a ) || !Number.isInteger( b ) || !positions[ a ] || !positions[ b ] ||
             connected[ a ] === connected[ b ] || !direction || slots[ a ].has( direction ) || slots[ b ].has( direction.opposite ) ) {
          throw new Error( 'Invalid molecular bond direction or topology.' );
        }
        const previous = connected[ b ];
        connected.forEach( ( value, index ) => {
          if ( value === previous ) { connected[ index ] = connected[ a ]; }
        } );
        slots[ a ].add( direction );
        slots[ b ].add( direction.opposite );
        specimen.addBond( new Bond( specimen.atoms[ a ], specimen.atoms[ b ] ) );
        return { a, b, direction };
      } );
      if ( positions.length > 1 && !MoleculeList.getMainInstance().isAllowedStructure( specimen ) ) {
        throw new Error( 'This molecular structure cannot be built in the simulation.' );
      }
      return ( kit: Kit, atomPool: Atom2[] ) => {
        const restored = positions.map( state => {
          const atom = atomPool[ state.index ];
          removeFromBucket( atom );
          atom.positionProperty.value = state.position;
          atom.destinationProperty.value = state.destination;
          kit.atomsInPlayArea.push( atom );
          return atom;
        } );
        links.forEach( ( { a, b, direction } ) => kit[ 'bond' ]( restored[ a ], direction, restored[ b ] ) );
      };
    } );
    if ( selected !== null && ( typeof selected !== 'number' || !playable.has( selected ) ) ) {
      throw new Error( 'Invalid selected atom.' );
    }
    return { rebuild, selected, collectedAtoms };
  } );
  return {
    ...collectionLayout,
    currentKit,
    apply: ( collection: KitCollection, view: BAMScreenView ) => {
      const atomPools = collection.kits.map( kit => kit.buckets.flatMap( bucket => bucket.fullState ) );
      collection.reset();
      rebuildKits.forEach( ( state, index ) => {
        const kit = collection.kits[ index ];
        const atomPool = atomPools[ index ];
        state.rebuild.forEach( restore => restore( kit, atomPool ) );
        state.collectedAtoms.forEach( index => {
          const atom = atomPool[ index ];
          removeFromBucket( atom );
          kit.atoms.splice( kit.atoms.indexOf( atom ), 1 );
          kit.atomsInCollectionBox.push( atom );
          atom.visibleProperty.value = false;
        } );
      } );
      // Refilling a kit can reuse its atoms while the collected molecules remain in their boxes.
      collection.collectionBoxes.forEach( ( box, index ) => {
        for ( let slot = 0; slot < boxQuantities[ index ]; slot++ ) {
          const molecule = new Molecule();
          box.moleculeType.atoms.forEach( atom => molecule.addAtom( atom ) );
          box.moleculeType.bonds.forEach( bond => molecule.addBond( bond ) );
          box.addMolecule( molecule );
        }
      } );
      view.kitCollectionMap[ collection.id ].kitPanel.kitCarousel.pageNumberProperty.value = currentKit;
      rebuildKits.forEach( ( { selected }, index ) => {
        collection.kits[ index ].selectedAtomProperty.value = selected === null ? null : atomPools[ index ][ selected ];
      } );
      view.updateRefillButton();
    }
  };
}

function removeFromBucket( atom: Atom2 ): void {
  const bucket = atom.containerProperty.value as BAMBucket;
  bucket.particleList.remove( atom );
  if ( bucket.containsParticle( atom ) ) {
    bucket.removeParticle( atom );
  }
}

function readCollection( collection: KitCollection ) {
  return {
    layout: readLayout( collection ),
    boxQuantities: collection.collectionBoxes.map( box => box.quantityProperty.value ),
    currentKit: collection.kits.indexOf( collection.currentKitProperty.value! ),
    kits: collection.kits.map( kit => {
      const atomPool = kit.buckets.flatMap( bucket => bucket.fullState );
      const molecules = kit.molecules.map( molecule => ( {
        atoms: molecule.atoms.map( value => {
          const atom = value as Atom2;
          const position = atom.positionProperty.value;
          const destination = atom.destinationProperty.value;
          return {
            index: atomPool.indexOf( atom ),
            position: [ position.x, position.y ],
            destination: [ destination.x, destination.y ]
          };
        } ),
        bonds: molecule.bonds.map( bond => [
          molecule.atoms.indexOf( bond.a ), molecule.atoms.indexOf( bond.b ), kit.getBondDirection( bond.a, bond.b ).id
        ] )
      } ) );
      const selected = kit.selectedAtomProperty.value;
      return {
        selected: selected && kit.isAtomInPlay( selected ) ? atomPool.indexOf( selected ) : null,
        collectedAtoms: kit.atomsInCollectionBox.map( atom => atomPool.indexOf( atom ) ),
        molecules
      };
    } )
  };
}

function screenState( screen: Sim[ 'simScreens' ][ number ] ) {
  const model = screen.model as BAMModel;
  const view = screen.view as BAMScreenView;
  return {
    isPlaying: () => model.currentCollectionProperty.value.currentKitProperty.value?.atomsInPlayArea.some( atom =>
      !atom.isDraggingProperty.value && !atom.positionProperty.value.equals( atom.destinationProperty.value ) ) ?? false,
    read: () => ( {
      currentCollection: model.currentIndex,
      collections: model.collections.map( readCollection )
    } ),
    prepare: ( input: unknown ) => {
      const { currentCollection, collections } = object( input );
      if ( !Array.isArray( collections ) || !collections.length || collections.length > 100 ||
           ( !model.firstCollection.collectionBoxes.length && collections.length !== 1 ) ||
           typeof currentCollection !== 'number' || !Number.isInteger( currentCollection ) ||
           currentCollection < 0 || currentCollection >= collections.length ) {
        throw new Error( 'Invalid molecule collections.' );
      }
      const restored = collections.map( ( collection, index ) => prepareCollection( model, collection, index ) );
      return () => {
        view.interruptSubtreeInput();
        if ( restored.length !== model.collections.length || restored.some( ( collection, index ) =>
          collection.signature !== JSON.stringify( readLayout( model.collections[ index ] ) ) ) ) {
          model.reset();
          restored.slice( 1 ).forEach( collection => model.addCollection( collection.create() ) );
        }
        restored.forEach( ( state, index ) => {
          const collection = model.collections[ index ];
          model[ 'switchTo' ]( collection );
          state.apply( collection, view );
        } );
        model[ 'switchTo' ]( model.collections[ currentCollection ] );
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-build-a-molecule/v1',
    build: 'build-a-molecule@1.1.0-dev.2-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...screenState( screen ) } ) )
  } ) );
}
