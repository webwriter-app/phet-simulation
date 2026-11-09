// Shared fraction building state. Distributed under GPL-3.0.
import type { AnyScreen } from '../Screen.js';
import Vector2 from '../../../dot/js/Vector2.js';
import Fraction from '../../../phetcommon/js/model/Fraction.js';
import type BuildingModel from '../../../fractions-common/js/building/model/BuildingModel.js';
import BuildingRepresentation from '../../../fractions-common/js/building/model/BuildingRepresentation.js';
import NumberPiece from '../../../fractions-common/js/building/model/NumberPiece.js';
import ShapeGroup from '../../../fractions-common/js/building/model/ShapeGroup.js';
import ShapePiece from '../../../fractions-common/js/building/model/ShapePiece.js';
import type NumberGroup from '../../../fractions-common/js/building/model/NumberGroup.js';
import FractionsCommonConstants from '../../../fractions-common/js/common/FractionsCommonConstants.js';
import FractionsCommonColors from '../../../fractions-common/js/common/view/FractionsCommonColors.js';
import type BuildingGameModel from '../../../fractions-common/js/game/model/BuildingGameModel.js';
import type BuildingGameScreenView from '../../../fractions-common/js/game/view/BuildingGameScreenView.js';
import ChallengeType from '../../../fractions-common/js/game/model/ChallengeType.js';
import FilledPartition from '../../../fractions-common/js/game/model/FilledPartition.js';
import FractionChallenge from '../../../fractions-common/js/game/model/FractionChallenge.js';
import type FractionLevel from '../../../fractions-common/js/game/model/FractionLevel.js';
import ShapePartition from '../../../fractions-common/js/game/model/ShapePartition.js';
import ShapeTarget from '../../../fractions-common/js/game/model/ShapeTarget.js';
import Target from '../../../fractions-common/js/game/model/Target.js';
import type BuildingLabModel from '../../../fractions-common/js/lab/model/BuildingLabModel.js';
import { boolean, field, object, prepareFields, readFields } from './stateFields.js';

type Group = ShapeGroup | NumberGroup;
type Inventory = Map<string, number>;

const partitions = [
  ...ShapePartition.GAME_PARTITIONS,
  ...ShapePartition.EXTENDED_HORIZONTAL_BARS,
  ...ShapePartition.EXTENDED_VERTICAL_BARS,
  ...ShapePartition.EXTENDED_RECTANGULAR_BARS
];
const colors = [
  FractionsCommonColors.level1Property, FractionsCommonColors.level2Property, FractionsCommonColors.level3Property,
  FractionsCommonColors.level4Property, FractionsCommonColors.level5Property, FractionsCommonColors.level6Property,
  FractionsCommonColors.level7Property, FractionsCommonColors.level8Property, FractionsCommonColors.level9Property,
  FractionsCommonColors.level10Property
];

function integer( input: unknown, min: number, max: number ): number {
  if ( typeof input !== 'number' || !Number.isInteger( input ) || input < min || input > max ) {
    throw new Error( 'Invalid fraction state number.' );
  }
  return input;
}

function pair( fraction: Fraction ) {
  return [ fraction.numerator, fraction.denominator ];
}

function fraction( input: unknown ) {
  if ( !Array.isArray( input ) || input.length !== 2 ) {
    throw new Error( 'Invalid fraction.' );
  }
  return new Fraction( integer( input[ 0 ], 1, 100 ), integer( input[ 1 ], 1, 100 ) );
}

function position( input: unknown ): Vector2 {
  if ( !Array.isArray( input ) || input.length !== 2 ||
       !input.every( value => typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) <= 2000 ) ) {
    throw new Error( 'Invalid fraction group position.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}

function shapeKey( representation: string, fraction: Fraction ) {
  return `${representation}:${fraction.numerator}/${fraction.denominator}`;
}

function numberKey( value: number ) {
  return `number:${value}`;
}

function getRepresentation( name: unknown ) {
  if ( name === 'pie' ) { return BuildingRepresentation.PIE; }
  if ( name === 'bar' ) { return BuildingRepresentation.BAR; }
  throw new Error( 'Invalid fraction shape representation.' );
}

function readGroup( group: Group, target: number | null ) {
  const point = group.positionProperty.value;
  return {
    position: [ point.x, point.y ],
    target,
    ...( group instanceof ShapeGroup ? {
      kind: group.representation === BuildingRepresentation.PIE ? 'pie' : 'bar',
      partition: group.partitionDenominatorProperty.value,
      containers: group.shapeContainers.map( container => container.shapePieces.map( piece => pair( piece.fraction ) ) )
    } : {
      kind: 'number',
      mixed: group.isMixedNumber,
      spots: group.spots.map( spot => spot.pieceProperty.value?.number ?? null )
    } )
  };
}

function readWorkspace( model: BuildingModel, targets: Target[] = [] ) {
  const collected = targets.map( target => target.groupProperty.value );
  const groups: Group[] = [ ...model.shapeGroups, ...model.numberGroups ].filter( group => !collected.includes( group ) );
  const selected = groups.indexOf( model.selectedGroupProperty.value );
  return {
    groups: [
      ...groups.map( group => readGroup( group, null ) ),
      ...collected.flatMap( ( group, index ) => group ? [ readGroup( group, index ) ] : [] )
    ],
    selected: selected < 0 ? null : selected
  };
}

function prepareWorkspace( input: unknown, inventory: Inventory, maxContainers: number,
                           targets: Fraction[], shapeKind: string | null, mixed: boolean ) {
  const { groups, selected } = object( input );
  const lab = targets.length === 0;
  if ( !Array.isArray( groups ) || groups.length > ( lab ? 100 : targets.length ) ) {
    throw new Error( 'Invalid number of fraction groups.' );
  }
  const placed = new Set<number>();
  const usePiece = ( key: string ) => {
    const remaining = inventory.get( key );
    if ( !remaining ) {
      throw new Error( 'The fraction group uses an unavailable piece.' );
    }
    inventory.set( key, remaining - 1 );
  };
  const groupStates = groups.map( input => {
    const state = object( input );
    const point = position( state.position );
    const targetIndex = state.target === null ? null : integer( state.target, 0, targets.length - 1 );
    if ( targetIndex !== null ) {
      if ( placed.has( targetIndex ) ) {
        throw new Error( 'Two fraction groups occupy the same target.' );
      }
      placed.add( targetIndex );
    }
    const target = targetIndex === null ? null : targets[ targetIndex ];

    if ( state.kind === 'number' ) {
      const { spots, mixed: groupMixed } = state;
      if ( ( !lab && shapeKind !== null ) || typeof groupMixed !== 'boolean' ||
           ( !lab && groupMixed !== mixed ) || ( lab && groupMixed && !mixed ) ||
           !Array.isArray( spots ) || spots.length !== ( groupMixed ? 3 : 2 ) ) {
        throw new Error( 'Invalid number fraction group.' );
      }
      const values = spots.map( value => value === null ? null : integer( value, 0, 99 ) );
      values.forEach( value => { if ( value !== null ) { usePiece( numberKey( value ) ); } } );
      const [ numerator, denominator ] = values.slice( -2 );
      const whole = groupMixed ? values[ 0 ] : 0;
      if ( denominator === 0 || ( groupMixed && ( ( whole ?? 0 ) >= 10 || denominator === 1 ||
           ( numerator !== null && denominator !== null && numerator >= denominator ) ) ) ||
           ( target && ( numerator === null || denominator === null || whole === null ||
                         !new Fraction( whole * denominator + numerator, denominator ).reduced().equals( target.reduced() ) ) ) ) {
        throw new Error( 'Invalid numerator, denominator, or whole number.' );
      }
      return {
        targetIndex,
        apply: ( model: BuildingModel, challenge: FractionChallenge | null ) => {
          const stack = model.numberGroupStacks.find( stack => stack.isMixedNumber === groupMixed );
          const group = challenge ? challenge.pullGroupFromStack( stack, point ) : model.addNumberGroup( groupMixed );
          group.positionProperty.value = point;
          values.forEach( ( value, index ) => {
            if ( value === null ) { return; }
            const stack = model.numberStacks.find( stack => stack.number === value );
            const piece = challenge ? challenge.pullNumberPieceFromStack( stack, point ) : new NumberPiece( value );
            if ( !challenge ) { model.dragNumberPieceFromStack( piece ); }
            model.draggedNumberPieces.remove( piece );
            model.placeNumberPiece( group.spots[ index ], piece );
          } );
          return group;
        }
      };
    }

    const representation = getRepresentation( state.kind );
    const partition = integer( state.partition, 1, 8 );
    const { containers } = state;
    if ( ( !lab && state.kind !== shapeKind ) || !Array.isArray( containers ) || !containers.length ||
         containers.length > maxContainers ) {
      throw new Error( 'Invalid shape fraction group.' );
    }
    let total = new Fraction( 0, 1 );
    const pieces = containers.map( values => {
      if ( !Array.isArray( values ) || values.length > 100 ) {
        throw new Error( 'Invalid fraction container pieces.' );
      }
      let sum = new Fraction( 0, 1 );
      const pieces = values.map( value => {
        const piece = fraction( value );
        usePiece( shapeKey( state.kind as string, piece ) );
        sum = sum.plus( piece ).reduced();
        return piece;
      } );
      if ( sum.value > 1 ) { throw new Error( 'Fraction pieces overflow their container.' ); }
      total = total.plus( sum ).reduced();
      return pieces;
    } );
    if ( target && !total.equals( target.reduced() ) ) {
      throw new Error( 'The shape group does not match its target.' );
    }
    return {
      targetIndex,
      apply: ( model: BuildingModel, challenge: FractionChallenge | null ) => {
        const stack = model.shapeGroupStacks.find( stack => stack.representation === representation );
        const group = challenge ? challenge.pullGroupFromStack( stack, point ) : model.addShapeGroup( representation, maxContainers );
        group.positionProperty.value = point;
        group.partitionDenominatorProperty.value = partition;
        pieces.forEach( ( values, index ) => {
          if ( index > 0 ) { group.increaseContainerCount(); }
          values.forEach( value => {
            const stack = model.shapeStacks.find( stack => stack.representation === representation && stack.fraction.equals( value ) );
            const piece = challenge ? challenge.pullShapePieceFromStack( stack, point ) :
              new ShapePiece( value, representation, stack.color );
            if ( !challenge ) { model.dragShapePieceFromStack( piece ); }
            model.placeActiveShapePiece( piece, group.shapeContainers.get( index ), group );
            piece.animator.endAnimation();
          } );
        } );
        return group;
      }
    };
  } );
  const selectedIndex = selected === null ? null : integer( selected, 0, groups.length - 1 );
  if ( selectedIndex !== null && groupStates[ selectedIndex ].targetIndex !== null ) {
    throw new Error( 'Invalid selected fraction group.' );
  }
  return ( model: BuildingModel, challenge: FractionChallenge | null ) => {
    // Return the groups supplied by a fresh challenge so the original limited stacks stay authoritative.
    if ( challenge ) {
      model.shapeGroups.slice().forEach( group => {
        model.returnShapeGroup( group );
        group.animator.endAnimation();
      } );
      model.numberGroups.slice().forEach( group => {
        model.returnNumberGroup( group );
        group.animator.endAnimation();
      } );
    }
    const restored = groupStates.map( state => {
      const group = state.apply( model, challenge );
      if ( challenge && state.targetIndex !== null ) {
        challenge.targets[ state.targetIndex ].groupProperty.value = group;
        if ( group instanceof ShapeGroup ) { model.shapeGroups.remove( group ); }
        else { model.numberGroups.remove( group ); }
      }
      return group;
    } );
    model.selectedGroupProperty.value = selectedIndex === null ? null : restored[ selectedIndex ];
    model.previouslySelectedGroupProperty.value = model.selectedGroupProperty.value;
  };
}

function readChallenge( challenge: FractionChallenge ) {
  const type = challenge.hasShapes ? challenge.representation === BuildingRepresentation.PIE ? 'pie' : 'bar' : 'number';
  return {
    type,
    mixed: challenge.hasMixedTargets,
    targets: challenge.targets.map( target => ( {
      fraction: pair( target.fraction ),
      ...( target instanceof ShapeTarget ? {
        partitions: target.filledPartitions.map( partition => ( {
          shape: partitions.indexOf( partition.shapePartition ),
          fills: partition.fills.slice(),
          color: colors.indexOf( partition.color )
        } ) )
      } : {} )
    } ) ),
    pieces: challenge.hasShapes ?
      challenge.shapeStacks.map( stack => [ pair( stack.fraction ), stack.layoutQuantity ] ) :
      challenge.numberStacks.map( stack => [ stack.number, stack.layoutQuantity ] ),
    workspace: readWorkspace( challenge, challenge.targets )
  };
}

function prepareChallenge( input: unknown, level: FractionLevel, mixed: boolean, shapes: boolean ) {
  const state = object( input );
  const { type, pieces, targets } = state;
  if ( ( shapes ? type !== 'pie' && type !== 'bar' : type !== 'number' ) || state.mixed !== mixed ||
       !Array.isArray( targets ) || targets.length !== level.numTargets ||
       !Array.isArray( pieces ) || !pieces.length || pieces.length > 100 ) {
    throw new Error( 'Invalid fraction challenge.' );
  }
  const targetStates = targets.map( input => {
    const state = object( input );
    const value = fraction( state.fraction );
    if ( value.value > 10 ) { throw new Error( 'Invalid target fraction.' ); }
    if ( shapes ) { return { value, build: () => new Target( value ) }; }
    if ( !Array.isArray( state.partitions ) || !state.partitions.length || state.partitions.length > 10 ) {
      throw new Error( 'Invalid target shape partitions.' );
    }
    let sum = new Fraction( 0, 1 );
    const parts = state.partitions.map( input => {
      const { shape, fills, color } = object( input );
      const partition = partitions[ integer( shape, 0, partitions.length - 1 ) ];
      const paint = colors[ integer( color, 0, colors.length - 1 ) ];
      if ( !Array.isArray( fills ) || fills.length !== partition.length || !fills.every( value => typeof value === 'boolean' ) ) {
        throw new Error( 'Invalid target shape fill.' );
      }
      sum = sum.plus( new Fraction( fills.filter( Boolean ).length, fills.length ) ).reduced();
      return () => new FilledPartition( partition, fills, paint );
    } );
    if ( !sum.equals( value.reduced() ) ) { throw new Error( 'The partition fill does not match the target fraction.' ); }
    return { value, build: () => new ShapeTarget( value, parts.map( part => part() ) ) };
  } );
  const inventory: Inventory = new Map();
  const pieceStates = pieces.map( input => {
    if ( !Array.isArray( input ) || input.length !== 2 ) { throw new Error( 'Invalid fraction piece stack.' ); }
    const value = shapes ? fraction( input[ 0 ] ) : integer( input[ 0 ], 0, 99 );
    const count = integer( input[ 1 ], 1, 10 );
    const key = typeof value === 'number' ? numberKey( value ) : shapeKey( type as string, value );
    if ( inventory.has( key ) ) { throw new Error( 'Duplicate fraction piece stack.' ); }
    inventory.set( key, count );
    return { value, count };
  } );
  const targetFractions = targetStates.map( target => target.value );
  const maxContainers = Math.ceil( Math.max( ...targetFractions.map( fraction => fraction.value ) ) );
  const restore = prepareWorkspace( state.workspace, inventory, maxContainers, targetFractions, shapes ? type as string : null, mixed );
  return () => {
    const representation = shapes ? getRepresentation( type ) : null;
    const challenge = new FractionChallenge( level.number,
      type === 'pie' ? ChallengeType.PIE : type === 'bar' ? ChallengeType.BAR : ChallengeType.NUMBER,
      mixed, targetStates.map( target => target.build() ),
      shapes ? pieceStates.flatMap( ( { value, count } ) => Array.from( { length: count },
        () => new ShapePiece( value as Fraction, representation, level.color ) ) ) : [],
      shapes ? [] : pieceStates.flatMap( ( { value, count } ) => Array.from( { length: count },
        () => new NumberPiece( value as number ) ) )
    );
    restore( challenge, challenge );
    return challenge;
  };
}

function animating( model: BuildingModel ) {
  return model.activeShapePieces.some( piece => piece.isAnimatingProperty.value ) ||
         model.activeNumberPieces.some( piece => piece.isAnimatingProperty.value ) ||
         model.shapeGroups.some( group => group.isAnimatingProperty.value ) ||
         model.numberGroups.some( group => group.isAnimatingProperty.value );
}

export function fractionGameState( screen: AnyScreen ) {
  const model = screen.model as BuildingGameModel;
  const view = screen.view as BuildingGameScreenView;
  const levels = [ ...model.shapeLevels, ...model.numberLevels ];
  const fields = { leftLevels: boolean( view.leftLevelSelectionProperty ) };
  return {
    isPlaying: () => !!model.challengeProperty.value && animating( model.challengeProperty.value ),
    read: () => ( {
      ...readFields( fields ),
      level: model.levelProperty.value ? levels.indexOf( model.levelProperty.value ) : null,
      challenges: levels.map( level => readChallenge( level.challengeProperty.value ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const active = state.level === null ? null : integer( state.level, 0, levels.length - 1 );
      const { challenges } = state;
      if ( !Array.isArray( challenges ) || challenges.length !== levels.length ) {
        throw new Error( 'Invalid fraction game level count.' );
      }
      const restored = levels.map( ( level, index ) => prepareChallenge( challenges[ index ], level,
        model.hasMixedNumbers, index < model.shapeLevels.length ) );
      return () => {
        view.interruptSubtreeInput();
        model.levelProperty.value = null;
        restored.forEach( ( restore, index ) => {
          levels[ index ].challengeProperty.value = restore();
        } );
        applyFields();
        model.levelProperty.value = active === null ? null : levels[ active ];
      };
    }
  };
}

export function fractionLabState( screen: AnyScreen ) {
  const model = screen.model as BuildingLabModel;
  const fields = {
    representation: field( model.topRepresentationProperty, value => value === BuildingRepresentation.PIE ? 'pie' : 'bar',
      value => value === 'pie' || value === 'bar' ? getRepresentation( value ) : undefined )
  };
  return {
    isPlaying: () => animating( model ),
    read: () => ( { ...readFields( fields ), workspace: readWorkspace( model ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const inventory: Inventory = new Map();
      model.shapeStacks.forEach( stack => inventory.set( shapeKey(
        stack.representation === BuildingRepresentation.PIE ? 'pie' : 'bar', stack.fraction ), Infinity ) );
      model.numberStacks.forEach( stack => inventory.set( numberKey( stack.number ), Infinity ) );
      const restore = prepareWorkspace( state.workspace, inventory, FractionsCommonConstants.MAX_SHAPE_CONTAINERS,
        [], null, model.allowMixedNumbers );
      const applyFields = prepareFields( fields, state );
      return () => {
        screen.view.interruptSubtreeInput();
        model.reset();
        model.shapeGroups.slice().forEach( group => {
          model.returnShapeGroup( group );
          group.animator.endAnimation();
        } );
        model.numberGroups.slice().forEach( group => {
          model.returnNumberGroup( group );
          group.animator.endAnimation();
        } );
        restore( model, null );
        applyFields();
      };
    }
  };
}
