// Number Pairs WebWriter adapter. Distributed under GPL-3.0.
import type { ObservableArray } from '../../../axon/js/createObservableArray.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import AccordionBox from '../../../sun/js/AccordionBox.js';
import { writableIsSettingPhetioStateProperty as isSettingPhetioStateProperty } from '../../../tandem/js/isSettingPhetioStateProperty.js';
import CountingObject, { AddendType } from '../common/model/CountingObject.js';
import DecompositionModel from '../common/model/DecompositionModel.js';
import type NumberPairsModel from '../common/model/NumberPairsModel.js';
import NumberPairsPreferences from '../common/model/NumberPairsPreferences.js';
import type NumberPairsScreenView from '../common/view/NumberPairsScreenView.js';
import Challenge from '../game/model/Challenge.js';
import type GameModel from '../game/model/GameModel.js';
import type Level from '../game/model/Level.js';
import NumberLineLevel from '../game/model/NumberLineLevel.js';
import SumModel from '../sum/model/SumModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

function count( value: unknown, max: number ): number {
  if ( typeof value !== 'number' || !Number.isSafeInteger( value ) || value < 0 || value > max ) {
    throw new Error( 'Invalid Number Pairs count.' );
  }
  return value;
}

function pieceFields( piece: CountingObject ) {
  return {
    attributePosition: vector( piece.attributePositionProperty ),
    locationPosition: vector( piece.locationPositionProperty ),
    beadX: number( piece.beadXPositionProperty ),
    selected: boolean( piece.kittenSelectedProperty )
  };
}

type Groups = readonly [ ObservableArray<CountingObject>, ObservableArray<CountingObject>, ObservableArray<CountingObject> ];

function groupState( groups: Groups, pieces: CountingObject[] ) {
  return {
    read: () => groups.map( group => group.map( piece => piece.id ) ),
    prepare: ( input: unknown, total: number ) => {
      if ( !Array.isArray( input ) || input.length !== 3 || !input.every( Array.isArray ) ||
           input[ 0 ].length + input[ 1 ].length !== total || input[ 2 ].length + total !== pieces.length ) {
        throw new Error( 'Invalid Number Pairs groups.' );
      }
      const seen = new Set<CountingObject>();
      const desired = input.map( group => group.map( ( id: unknown ) => {
        const piece = pieces.find( piece => piece.id === id );
        if ( !piece || seen.has( piece ) ) { throw new Error( 'Invalid Number Pairs piece.' ); }
        seen.add( piece );
        return piece;
      } ) );
      return () => groups.forEach( ( group, index ) => {
        const items = desired[ index ];
        if ( group.length !== items.length || group.some( ( item, index ) => item !== items[ index ] ) ) {
          group.splice( 0, group.length, ...items );
        }
      } );
    }
  };
}

function decompositionState( model: DecompositionModel ) {
  const selected = { total: field( model.selectedSceneProperty, scene => scene.total, input =>
    model.scenes.find( scene => scene.total === input ) ) };
  const scenes = model.scenes.map( scene => {
    const groups = groupState( [ scene.leftAddendObjects, scene.rightAddendObjects, scene.inactiveCountingObjects ], model.countingObjects );
    return {
      read: () => ( {
        groups: groups.read(),
        beads: scene === model.selectedSceneProperty.value ? {
          leftAddendXPositions: scene.leftAddendObjects.map( piece => piece.beadXPositionProperty.value ),
          rightAddendXPositions: scene.rightAddendObjects.map( piece => piece.beadXPositionProperty.value )
        } : scene.beadXPositionsProperty.value
      } ),
      prepare: ( input: unknown ) => {
        const state = object( input );
        const apply = groups.prepare( state.groups, scene.total );
        const beads = object( state.beads );
        if ( !Array.isArray( beads.leftAddendXPositions ) || !beads.leftAddendXPositions.every( Number.isFinite ) ||
             !Array.isArray( beads.rightAddendXPositions ) || !beads.rightAddendXPositions.every( Number.isFinite ) ||
             beads.leftAddendXPositions.length > scene.total || beads.rightAddendXPositions.length > scene.total ) {
          throw new Error( 'Invalid Number Pairs bead positions.' );
        }
        const left = beads.leftAddendXPositions.slice();
        const right = beads.rightAddendXPositions.slice();
        return () => {
          apply();
          scene.leftAddendProperty.value = scene.leftAddendObjects.length;
          scene.beadXPositionsProperty.value = { leftAddendXPositions: left, rightAddendXPositions: right };
        };
      }
    };
  } );
  return {
    read: () => ( { ...readFields( selected ), scenes: scenes.map( state => state.read() ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      if ( !Array.isArray( state.scenes ) || state.scenes.length !== scenes.length ) {
        throw new Error( 'Invalid Number Pairs scenes.' );
      }
      const select = prepareFields( selected, state );
      const restores = state.scenes.map( ( item, index ) => scenes[ index ].prepare( item ) );
      return () => {
        restores.forEach( restore => restore() );
        select();
      };
    }
  };
}

function sumState( model: SumModel ) {
  const groups = groupState( [ model.leftAddendCountingObjectsProperty.value,
    model.rightAddendCountingObjectsProperty.value, model.inactiveCountingObjects ], model.countingObjects );
  return {
    read: () => ( { total: model.totalProperty.value, groups: groups.read() } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const total = count( state.total, SumModel.SCENE_RANGE.max );
      const restore = groups.prepare( state.groups, total );
      return () => {
        restore();
        model.totalProperty.value = total;
      };
    }
  };
}

function playState( screen: AnyScreen ) {
  const model = screen.model as NumberPairsModel;
  const view = screen.view as NumberPairsScreenView;
  const controls: Parameters<typeof readFields>[ 0 ] = {
    representation: enumeration( model.representationTypeProperty ),
    totalVisible: boolean( model.totalVisibleProperty ),
    leftVisible: boolean( model.leftAddendVisibleProperty ),
    rightVisible: boolean( model.rightAddendVisibleProperty ),
    bothVisible: boolean( model.bothAddendsVisibleProperty ),
    lineAddends: boolean( model.numberLineAddendValuesVisibleProperty ),
    tickValues: boolean( model.tickValuesVisibleProperty ),
    totalJump: boolean( model.totalJumpVisibleProperty ),
    countFromZero: boolean( model.numberLineCountFromZeroProperty )
  };
  view[ 'accordionBoxes' ].forEach( ( box, index ) => {
    if ( box instanceof AccordionBox ) { controls[ `accordion${index}` ] = boolean( box.expandedProperty ); }
  } );
  const pieces = model.countingObjects.map( pieceFields );
  const scenes = model instanceof SumModel ? sumState( model ) : decompositionState( model as DecompositionModel );
  return {
    read: () => ( { controls: readFields( controls ), pieces: pieces.map( readFields ), arrangement: scenes.read() } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      if ( !Array.isArray( state.pieces ) || state.pieces.length !== pieces.length ) { throw new Error( 'Invalid Number Pairs pieces.' ); }
      const restoreControls = prepareFields( controls, state.controls );
      const restorePieces = state.pieces.map( ( item, index ) => prepareFields( pieces[ index ], item ) );
      const restoreScene = scenes.prepare( state.arrangement );
      return () => {
        screen.view.interruptSubtreeInput();
        model.countingObjectsAnimation?.stop();
        isSettingPhetioStateProperty.value = true;
        try {
          restoreScene();
          restoreControls();
          const left = model.leftAddendCountingObjectsProperty.value;
          const right = model.rightAddendCountingObjectsProperty.value;
          model.countingObjects.forEach( piece => {
            piece.addendTypeProperty.value = left.includes( piece ) ? AddendType.LEFT : right.includes( piece ) ? AddendType.RIGHT : AddendType.INACTIVE;
          } );
          restorePieces.forEach( apply => apply() );
          model.changingScenesProperty.value = false;
        }
        finally { isSettingPhetioStateProperty.value = false; }
      };
    }
  };
}

function gameLevelState( level: Level ) {
  const controls: Parameters<typeof readFields>[ 0 ] = {
    score: number( level[ '_scoreProperty' ], true, value => value >= 0 ),
    feedback: enumeration( level[ '_challengeStateProperty' ] ),
    addendsVisible: boolean( level.addendsVisibleProperty ),
    selectedGuess: field( level.selectedGuessProperty, value => value, input =>
      input === null || ( typeof input === 'number' && Number.isInteger( input ) && level.range.contains( input ) ) ? input : undefined )
  };
  if ( level instanceof NumberLineLevel ) {
    controls.tickValues = boolean( level.tickValuesVisibleProperty );
    controls.lineAddends = boolean( level.numberLineAddendsVisibleProperty );
  }
  const delegate = level.countingObjectsDelegate;
  const pieces = delegate.countingObjects.map( pieceFields );
  return {
    read: () => ( {
      ...readFields( controls ),
      challenge: Challenge.ChallengeIO.toStateObject( level.challengeProperty.value ),
      guessed: [ ...level.guessedNumbers ],
      reward: level.hasShownReward,
      pieces: pieces.map( readFields )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const challenge = object( state.challenge );
      const a = count( challenge.a, level.range.max );
      const b = count( challenge.b, level.range.max );
      const y = count( challenge.y, level.range.max );
      const missing = challenge.missingComponent;
      if ( a + b !== y || ( missing !== 'a' && missing !== 'b' && missing !== 'y' ) ||
           !Array.isArray( state.guessed ) || state.guessed.length > level.range.getLength() + 1 ||
           !Array.isArray( state.pieces ) || state.pieces.length !== pieces.length || typeof state.reward !== 'boolean' ) {
        throw new Error( 'Invalid Number Pairs challenge.' );
      }
      const guessed = state.guessed.map( item => count( item, level.range.max ) );
      if ( guessed.some( item => !level.range.contains( item ) ) || new Set( guessed ).size !== guessed.length ) {
        throw new Error( 'Invalid Number Pairs guesses.' );
      }
      const next = new Challenge( missing, a, b, y );
      const restore = prepareFields( controls, state );
      const restorePieces = state.pieces.map( ( item, index ) => prepareFields( pieces[ index ], item ) );
      return () => {
        delegate.countingObjectsAnimation?.stop();
        level.hasShownReward = state.reward as boolean;
        level.selectedGuessProperty.value = null;
        level[ '_challengeProperty' ].value = next;
        level.guessedNumbers.splice( 0, level.guessedNumbers.length, ...guessed );
        restore();
        restorePieces.forEach( apply => apply() );
      };
    }
  };
}

function gameState( screen: AnyScreen ) {
  const model = screen.model as GameModel;
  const selected = { level: field( model.levelProperty, value => value?.levelNumber ?? null, input =>
    input === null ? null : model.levels.find( level => level.levelNumber === input ) ) };
  const levels = model.levels.map( gameLevelState );
  return {
    read: () => ( { ...readFields( selected ), levels: levels.map( level => level.read() ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      if ( !Array.isArray( state.levels ) || state.levels.length !== levels.length ) { throw new Error( 'Invalid Number Pairs game.' ); }
      const select = prepareFields( selected, state );
      const restore = state.levels.map( ( input, index ) => levels[ index ].prepare( input ) );
      return () => {
        screen.view.interruptSubtreeInput();
        restore.forEach( apply => apply() );
        select();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'intro', 'ten', 'twenty', 'sum', 'game' ];
  const prefs = NumberPairsPreferences;
  const preferences = {
    autoHear: boolean( prefs.autoHearEnabledProperty ),
    secondLocaleEnabled: boolean( prefs.secondLocaleEnabledProperty ),
    secondLocale: field( prefs.secondLocaleProperty, value => value, input =>
      prefs.secondLocaleProperty.availableRuntimeLocales.find( locale => locale === input ) ),
    primaryLanguage: boolean( prefs.isPrimaryLocaleProperty ),
    numberModel: field( prefs.numberModelTypeProperty, value => value.id, input =>
      prefs.numberModelTypeProperty.validValues?.find( item => item.id === input ) ),
    sumTotalOnTop: boolean( prefs.sumScreenTotalOnTopProperty )
  };
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-number-pairs/v1',
    build: 'number-pairs@2.1.0-dev.0-webwriter.1',
    readPreferences: () => readFields( preferences ),
    preparePreferences: input => prepareFields( preferences, input ),
    screens: sim.simScreens.map( ( screen, index ) => ( { id: ids[ index ], screen, ...( index === 4 ? gameState( screen ) : playState( screen ) ) } ) )
  } ) );
}
