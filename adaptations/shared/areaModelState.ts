// State bindings for the Area Model family. Distributed under GPL-3.0.
import AreaModelCommonConstants from '../../../area-model-common/js/common/AreaModelCommonConstants.js';
import Term from '../../../area-model-common/js/common/model/Term.js';
import AreaChallenge from '../../../area-model-common/js/game/model/AreaChallenge.js';
import AreaChallengeDescription from '../../../area-model-common/js/game/model/AreaChallengeDescription.js';
import Entry from '../../../area-model-common/js/game/model/Entry.js';
import EntryStatus from '../../../area-model-common/js/game/model/EntryStatus.js';
import EntryType from '../../../area-model-common/js/game/model/EntryType.js';
import GameAreaModel from '../../../area-model-common/js/game/model/GameAreaModel.js';
import GameState from '../../../area-model-common/js/game/model/GameState.js';
import GenericArea from '../../../area-model-common/js/generic/model/GenericArea.js';
import GenericAreaModel from '../../../area-model-common/js/generic/model/GenericAreaModel.js';
import ProportionalArea from '../../../area-model-common/js/proportional/model/ProportionalArea.js';
import ProportionalAreaModel from '../../../area-model-common/js/proportional/model/ProportionalAreaModel.js';
import dotRandom from '../../../dot/js/dotRandom.js';
import Permutation from '../../../dot/js/Permutation.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Orientation from '../../../phet-core/js/Orientation.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

function list( value: unknown, size: number ): unknown[] {
  if ( !Array.isArray( value ) || value.length !== size ) {
    throw new Error( 'Invalid Area Model state list.' );
  }
  return value;
}

function index( value: unknown, size: number ): number {
  if ( typeof value !== 'number' || !Number.isInteger( value ) || value < 0 || value >= size ) {
    throw new Error( 'Invalid Area Model state index.' );
  }
  return value;
}

function readTerm( term: Term | null ): [ number, number ] | null {
  return term && [ term.coefficient, term.power ];
}

function readOrientation( value: Orientation ) {
  return value.ariaOrientation;
}

function restoreOrientation( value: unknown ) {
  return Orientation.enumeration.values.find( orientation => readOrientation( orientation ) === value );
}

function restoreTerm( input: unknown, maxDigits: number, maxPower: number ): Term | null {
  if ( input === null ) {
    return null;
  }
  const [ coefficient, power ] = list( input, 2 );
  if ( typeof coefficient !== 'number' || !Number.isSafeInteger( coefficient ) || Math.abs( coefficient ) >= 10 ** maxDigits ||
       typeof power !== 'number' || !Number.isInteger( power ) || power < 0 || power > maxPower ||
       ( coefficient === 0 && power !== 0 ) ) {
    throw new Error( 'Invalid Area Model term.' );
  }
  return new Term( coefficient, power );
}

function proportionalAreaState( area: ProportionalArea ) {
  const validSize = ( value: number ) => value >= area.minimumSize - 1e-7 && value <= area.maximumSize + 1e-7 &&
    Math.abs( value / area.snapSize - Math.round( value / area.snapSize ) ) < 1e-7;
  const fields = {
    width: number( area.activeTotalProperties.horizontal, false, validSize ),
    height: number( area.activeTotalProperties.vertical, false, validSize ),
    horizontalSplit: number( area.partitionSplitProperties.horizontal, false, value => value >= 0 && value <= area.maximumSize ),
    verticalSplit: number( area.partitionSplitProperties.vertical, false, value => value >= 0 && value <= area.maximumSize ),
    partitionOrientation: field( area.visiblePartitionOrientationProperty, readOrientation, restoreOrientation ),
    horizontalHint: boolean( area.hasHintArrows.horizontal ),
    verticalHint: boolean( area.hasHintArrows.vertical )
  };
  return {
    read: () => readFields( fields ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      if ( ( state.horizontalSplit as number ) > ( state.width as number ) + 1e-7 ||
           ( state.verticalSplit as number ) > ( state.height as number ) + 1e-7 ) {
        throw new Error( 'Invalid Area Model split.' );
      }
      return apply;
    }
  };
}

function genericAreaState( area: GenericArea, allowExponents: boolean ) {
  const partitions = area.partitions.horizontal.concat( area.partitions.vertical );
  return {
    read: () => partitions.map( partition => readTerm( partition.sizeProperty.value ) ),
    prepare: ( input: unknown ) => {
      const values = list( input, partitions.length ).map( ( value, i ) =>
        restoreTerm( value, partitions[ i ].digitCount, allowExponents ? 2 : 0 ) );
      return () => {
        area.activePartitionProperty.value = null;
        partitions.forEach( ( partition, i ) => { partition.sizeProperty.value = values[ i ]; } );
      };
    }
  };
}

function constructionState( screen: AnyScreen, model: GenericAreaModel | ProportionalAreaModel ) {
  const controls = {
    factorsExpanded: boolean( model.factorsBoxExpandedProperty ),
    areaExpanded: boolean( model.areaBoxExpandedProperty ),
    calculation: enumeration( model.areaCalculationChoiceProperty ),
    partialProducts: enumeration( model.partialProductsChoiceProperty ),
    ...( model instanceof ProportionalAreaModel ? {
      gridLines: boolean( model.gridLinesVisibleProperty ),
      tiles: boolean( model.tilesVisibleProperty ),
      counting: boolean( model.countingVisibleProperty ),
      calculationBox: boolean( model.calculationBoxVisibleProperty )
    } : {} )
  };
  const areas = model instanceof ProportionalAreaModel ?
    model.areas.map( area => proportionalAreaState( area as ProportionalArea ) ) :
    model.areas.map( area => genericAreaState( area as GenericArea, model.allowExponents ) );
  return {
    read: () => ( {
      ...readFields( controls ),
      selectedArea: model.areas.indexOf( model.currentAreaProperty.value ),
      areas: areas.map( area => area.read() )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state );
      const selectedArea = model.areas[ index( state.selectedArea, areas.length ) ];
      const applyAreas = list( state.areas, areas.length ).map( ( value, i ) => areas[ i ].prepare( value ) );
      return () => {
        screen.view.interruptSubtreeInput();
        applyAreas.forEach( apply => apply() );
        if ( model instanceof GenericAreaModel ) {
          model.genericLayoutProperty.value = ( selectedArea as GenericArea ).layout;
        }
        else {
          model.currentAreaProperty.value = selectedArea;
        }
        applyControls();
      };
    }
  };
}

type ChallengeLayout = {
  horizontal: string[];
  vertical: string[];
  products: string[][];
  total: string;
  horizontalTotal: string;
  verticalTotal: string;
  type: string;
  unique: boolean;
};

function challengeLayout( description: AreaChallengeDescription ): ChallengeLayout {
  return {
    horizontal: description.partitionTypes.horizontal,
    vertical: description.partitionTypes.vertical,
    products: description.productTypes,
    total: description.totalType,
    horizontalTotal: description.dimensionTypes.horizontal,
    verticalTotal: description.dimensionTypes.vertical,
    type: description.type,
    unique: description.unique
  };
}

function layoutVariants( description: AreaChallengeDescription ): ChallengeLayout[] {
  const layout = challengeLayout( description );
  const horizontal = layout.horizontal.map( ( _, i ) => i );
  const vertical = layout.vertical.map( ( _, i ) => i );
  const columns = description.shufflable ? Permutation.permutationsOf( horizontal ) : [ horizontal ];
  const rows = description.shufflable ? Permutation.permutationsOf( vertical ) : [ vertical ];
  return columns.flatMap( x => rows.flatMap( y => {
    const variant = {
      ...layout,
      horizontal: x.map( column => layout.horizontal[ column ] ),
      vertical: y.map( row => layout.vertical[ row ] ),
      products: y.map( row => x.map( column => layout.products[ row ][ column ] ) )
    };
    return description.transposable ? [ variant, {
      ...variant,
      horizontal: variant.vertical,
      vertical: variant.horizontal,
      products: x.map( ( _, column ) => variant.products.map( row => row[ column ] ) ),
      horizontalTotal: variant.verticalTotal,
      verticalTotal: variant.horizontalTotal
    } ] : [ variant ];
  } ) );
}

function editableEntries( challenge: AreaChallenge ): Entry[] {
  return ( [
    ...challenge.partitionSizeEntries.horizontal,
    ...challenge.partitionSizeEntries.vertical,
    ...challenge.partialProductSizeEntries.flat(),
    ...challenge.totalCoefficientEntries
  ] as Entry[] ).filter( entry => entry.type === EntryType.EDITABLE );
}

function readChallenge( challenge: AreaChallenge ) {
  return {
    layout: JSON.stringify( challengeLayout( challenge.description ) ),
    horizontal: ( challenge.partitionSizes.horizontal as Term[] ).map( readTerm ),
    vertical: ( challenge.partitionSizes.vertical as Term[] ).map( readTerm ),
    wrongOrientation: readOrientation( challenge.arbitraryNonUniqueWrongOrientation ),
    state: challenge.stateProperty.value,
    entries: editableEntries( challenge ).map( entry => ( {
      term: readTerm( entry.valueProperty.value ),
      status: entry.statusProperty.value
    } ) )
  };
}

function restorePartitionTerms( input: unknown, quantity: number, allowExponents: boolean ): Term[] {
  return list( input, quantity ).map( ( value, i ) => {
    const term = restoreTerm( value, quantity, allowExponents ? quantity - 1 : 0 );
    const power = quantity - i - 1;
    const place = 10 ** power;
    const validVariable = ( term: Term ) => term.power === power &&
      ( i === 0 && power > 0 ? term.coefficient === 1 :
        Math.abs( term.coefficient ) <= 9 && term.coefficient !== 0 && ( quantity !== 1 || term.coefficient !== 1 ) );
    const validNumber = ( term: Term ) => term.coefficient % place === 0 &&
      term.coefficient >= ( quantity === 1 ? 2 : place ) && term.coefficient < 10 * place;
    if ( !term || !( allowExponents ? validVariable( term ) : validNumber( term ) ) ) {
      throw new Error( 'Invalid Area Model challenge dimensions.' );
    }
    return term;
  } );
}

function restoreChallenge( input: unknown, layouts: Map<string, ChallengeLayout>, allowExponents: boolean ) {
  const state = object( input );
  const layout = typeof state.layout === 'string' ? layouts.get( state.layout ) : undefined;
  const orientation = restoreOrientation( state.wrongOrientation );
  const gameState = GameState.VALUES.find( value => value === state.state );
  if ( !layout || !orientation || !gameState ) {
    throw new Error( 'Invalid Area Model challenge.' );
  }
  const horizontal = restorePartitionTerms( state.horizontal, layout.horizontal.length, allowExponents );
  const vertical = restorePartitionTerms( state.vertical, layout.vertical.length, allowExponents );
  const description = new AreaChallengeDescription( { ...layout, shufflable: false } );
  description.getPermutedDescription = () => description;

  // Let the upstream constructor wire the saved challenge's derived entries without drawing new random values.
  const generate = AreaChallenge[ 'generatePartitionTerms' ];
  const nextBoolean = Object.getOwnPropertyDescriptor( dotRandom, 'nextBoolean' );
  const terms = [ horizontal, vertical ];
  let challenge: AreaChallenge;
  AreaChallenge[ 'generatePartitionTerms' ] = () => terms.shift()!;
  Object.defineProperty( dotRandom, 'nextBoolean', {
    configurable: true,
    value: () => orientation === Orientation.HORIZONTAL
  } );
  try {
    challenge = new AreaChallenge( description );
  }
  finally {
    AreaChallenge[ 'generatePartitionTerms' ] = generate;
    if ( nextBoolean ) {
      Object.defineProperty( dotRandom, 'nextBoolean', nextBoolean );
    }
    else {
      Reflect.deleteProperty( dotRandom, 'nextBoolean' );
    }
  }

  const entries = editableEntries( challenge );
  list( state.entries, entries.length ).forEach( ( value, i ) => {
    const saved = object( value );
    const entry = entries[ i ];
    const term = restoreTerm( saved.term, entry.digits, allowExponents ? 2 : 0 );
    const status = EntryStatus.VALUES.find( value => value === saved.status );
    if ( !status ) {
      throw new Error( 'Invalid Area Model challenge entry.' );
    }
    entry.valueProperty.value = term;
    entry.statusProperty.value = status;
  } );
  challenge.stateProperty.value = gameState;
  return challenge;
}

function gameState( screen: AnyScreen, model: GameAreaModel ) {
  const levels = model.levels;
  const catalogs = levels.map( level => {
    const variants = ( level.challengeDescriptions as AreaChallengeDescription[] ).flatMap( layoutVariants );
    return new Map( variants.map( variant => [ JSON.stringify( variant ), variant ] ) );
  } );
  return {
    read: () => ( {
      level: model.currentLevelProperty.value === null ? null : levels.indexOf( model.currentLevelProperty.value ),
      levels: levels.map( level => ( {
        score: level.scoreProperty.value,
        challenge: level.challengeIndexProperty.value,
        finished: level.finished,
        challenges: level.challenges.map( readChallenge )
      } ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const selected = state.level === null ? null : levels[ index( state.level, levels.length ) ];
      const applyLevels = list( state.levels, levels.length ).map( ( value, i ) => {
        const saved = object( value );
        const level = levels[ i ];
        const { score, finished } = saved;
        const count = AreaModelCommonConstants.NUM_CHALLENGES;
        const challengeIndex = index( saved.challenge, count );
        if ( typeof score !== 'number' || !Number.isInteger( score ) || score < 0 ||
             score > AreaModelCommonConstants.PERFECT_SCORE || typeof finished !== 'boolean' ) {
          throw new Error( 'Invalid Area Model level.' );
        }
        const challenges = list( saved.challenges, count ).map( challenge =>
          restoreChallenge( challenge, catalogs[ i ], model.hasExponents ) );
        return () => {
          level.challenges = challenges;
          level.scoreProperty.value = score;
          level.finished = finished;
          if ( level.challengeIndexProperty.value === challengeIndex ) {
            level.challengeIndexProperty.notifyListenersStatic();
          }
          else {
            level.challengeIndexProperty.value = challengeIndex;
          }
        };
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        model.moveToLevelSelection();
        model.activeEntryProperty.value = null;
        applyLevels.forEach( apply => apply() );
        model.currentLevelProperty.value = selected;
      };
    }
  };
}

export function areaModelState( screen: AnyScreen ) {
  const model = screen.model;
  if ( model instanceof GameAreaModel ) {
    return gameState( screen, model );
  }
  if ( model instanceof ProportionalAreaModel || model instanceof GenericAreaModel ) {
    return constructionState( screen, model );
  }
  throw new Error( 'Unknown Area Model screen.' );
}
