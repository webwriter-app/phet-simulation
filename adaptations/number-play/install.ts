// Number Play WebWriter adapter. Distributed under GPL-3.0.
import CountingObject from '../../../counting-common/js/common/model/CountingObject.js';
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import type CountingArea from '../../../number-suite-common/js/common/model/CountingArea.js';
import type LabModel from '../../../number-suite-common/js/lab/model/LabModel.js';
import TenFrame from '../../../number-suite-common/js/lab/model/TenFrame.js';
import type CardNode from '../../../number-suite-common/js/lab/view/CardNode.js';
import type LabScreenView from '../../../number-suite-common/js/lab/view/LabScreenView.js';
import NumberCardNode from '../../../number-suite-common/js/lab/view/NumberCardNode.js';
import SymbolCardNode from '../../../number-suite-common/js/lab/view/SymbolCardNode.js';
import Text from '../../../scenery/js/nodes/Text.js';
import type NumberPlayModel from '../common/model/NumberPlayModel.js';
import numberPlayPreferences from '../common/model/numberPlayPreferences.js';
import type NumberPlayScreenView from '../common/view/NumberPlayScreenView.js';
import CountingGameLevel from '../game/model/CountingGameLevel.js';
import type NumberPlayGameLevel from '../game/model/NumberPlayGameLevel.js';
import type NumberPlayGameModel from '../game/model/NumberPlayGameModel.js';
import SubitizeGameLevel from '../game/model/SubitizeGameLevel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

function xy( value: unknown ): Vector2 {
  if ( !Array.isArray( value ) || value.length !== 2 || !value.every( Number.isFinite ) ) {
    throw new Error( 'Invalid Number Play position.' );
  }
  return new Vector2( value[ 0 ], value[ 1 ] );
}

function readArea( area: CountingArea ) {
  return area.getCountingObjectsIncludedInSum().map( piece => {
    const position = piece.destination ?? piece.positionProperty.value;
    return { position: [ position.x, position.y ], value: piece.numberValueProperty.value };
  } );
}

function prepareArea( area: CountingArea, input: unknown ) {
  if ( !Array.isArray( input ) || input.length > area.sumProperty.range.max ) { throw new Error( 'Invalid Number Play area.' ); }
  const pieces = input.map( item => {
    const state = object( item );
    if ( typeof state.value !== 'number' || !Number.isInteger( state.value ) || state.value < 1 || state.value > area.sumProperty.range.max ) {
      throw new Error( 'Invalid Number Play object value.' );
    }
    return { value: state.value, position: xy( state.position ) };
  } );
  const total = pieces.reduce( ( sum, piece ) => sum + piece.value, 0 );
  if ( !area.sumProperty.range.contains( total ) ) { throw new Error( 'Invalid Number Play total.' ); }
  return {
    total,
    length: pieces.length,
    apply: () => {
      area.removeAllCountingObjects();
      pieces.forEach( piece => area.addCountingObject( new CountingObject( piece.value, piece.position, {
        groupingEnabledProperty: area.groupingEnabledProperty
      } ) ) );
      area.calculateTotal();
    }
  };
}

function countState( screen: AnyScreen ) {
  const model = screen.model as NumberPlayModel;
  const view = screen.view as NumberPlayScreenView;
  const fields = {
    objectType: enumeration( model.countingObjectTypeProperty ),
    grouping: enumeration( model.objectsGroupAndLinkTypeProperty ),
    wordExpanded: boolean( view[ 'wordAccordionBoxExpandedProperty' ] ),
    totalExpanded: boolean( view[ 'totalAccordionBoxExpandedProperty' ] ),
    tenFrameExpanded: boolean( view[ 'tenFrameAccordionBoxExpandedProperty' ] ),
    onesExpanded: boolean( view[ 'onesAccordionBoxExpandedProperty' ] ),
    objectsExpanded: boolean( view[ 'objectsAccordionBoxExpandedProperty' ] )
  };
  return {
    read: () => ( { ...readFields( fields ), ones: readArea( model.onesCountingArea ), objects: readArea( model.objectsCountingArea ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const ones = prepareArea( model.onesCountingArea, state.ones );
      const objects = prepareArea( model.objectsCountingArea, state.objects );
      if ( ones.total !== objects.total ) { throw new Error( 'Number Play representations must have the same total.' ); }
      return () => {
        screen.view.interruptSubtreeInput();
        const primaryLocale = numberPlayPreferences.isPrimaryLocaleProperty.value;
        model.reset();
        numberPlayPreferences.isPrimaryLocaleProperty.value = primaryLocale;
        apply();

        // The two sum listeners expect one new unit at a time. Seed the model through those listeners, then replace
        // each representation with its saved grouping at the same total.
        for ( let i = 0; i < ones.total; i++ ) {
          model.onesCountingArea.addCountingObject( new CountingObject( 1, Vector2.ZERO, {
            groupingEnabledProperty: model.onesCountingArea.groupingEnabledProperty
          } ) );
          model.onesCountingArea.calculateTotal();
        }
        ones.apply();
        objects.apply();
      };
    }
  };
}

function gameLevelState( level: NumberPlayGameLevel ) {
  const controls: Parameters<typeof readFields>[ 0 ] = {
    challenge: number( level.challengeNumberProperty, true ),
    solved: boolean( level.isChallengeSolvedProperty ),
    score: number( level.scoreProperty, true, value => value >= 0 ),
    attempts: number( level.numberOfAnswerButtonPressesProperty, true, value => value >= 0 )
  };
  const counting = level instanceof CountingGameLevel ? level : null;
  const subitizer = level instanceof SubitizeGameLevel ? level.subitizer : null;
  if ( counting ) {
    controls.objectType = enumeration( counting.countingObjectTypeProperty );
    controls.objectsRepresentation = boolean( counting.isObjectsRepresentationProperty );
    controls.grouping = boolean( counting.groupObjectsEnabledProperty );
  }
  if ( subitizer ) {
    controls.visible = boolean( subitizer.isShapeVisibleProperty );
    controls.inputEnabled = boolean( subitizer.isInputEnabledProperty );
    controls.objectType = enumeration( subitizer.objectTypeProperty );
    controls.loading = boolean( subitizer.isLoadingBarAnimatingProperty );
    controls.showPlay = boolean( subitizer.isPlayButtonVisibleProperty );
    controls.delayStarted = boolean( {
      get value() { return subitizer[ 'isDelayStarted' ]; },
      set value( value ) { subitizer[ 'isDelayStarted' ] = value; }
    } );
    controls.delayTime = number( {
      get value() { return subitizer[ 'timeSinceDelayStarted' ]; },
      set value( value ) { subitizer[ 'timeSinceDelayStarted' ] = value; }
    }, false, value => value >= 0 );
    controls.visibleTime = number( {
      get value() { return subitizer[ 'timeSinceShapeVisible' ]; },
      set value( value ) { subitizer[ 'timeSinceShapeVisible' ] = value; }
    }, false, value => value >= 0 );
  }
  return {
    isPlaying: () => !!subitizer && ( subitizer[ 'isDelayStarted' ] ||
      ( subitizer.isShapeVisibleProperty.value && subitizer.isInputEnabledProperty.value ) ),
    read: () => ( {
      ...readFields( controls ),
      objects: counting ? readArea( counting.objectsCountingArea ) : null,
      points: subitizer ? subitizer.pointsProperty.value.map( position => [ position.x, position.y ] ) : null
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( controls, state );
      const objects = counting ? prepareArea( counting.objectsCountingArea, state.objects ) : null;
      if ( subitizer && ( !Array.isArray( state.points ) || state.points.length > 30 ) ) {
        throw new Error( 'Invalid Number Play subitizing pattern.' );
      }
      const points = subitizer ? ( state.points as unknown[] ).map( xy ) : null;
      return () => {
        apply();
        objects?.apply();
        if ( subitizer && points ) { subitizer.pointsProperty.value = points; }
      };
    }
  };
}

function gameState( screen: AnyScreen ) {
  const model = screen.model as NumberPlayGameModel;
  const fields = { level: field( model.levelProperty, value => value ? model.levels.indexOf( value ) : null, input =>
    input === null ? null : typeof input === 'number' && Number.isInteger( input ) ? model.levels[ input ] : undefined ) };
  const levels = model.levels.map( gameLevelState );
  return {
    isPlaying: () => levels.some( level => level.isPlaying() ),
    read: () => ( { ...readFields( fields ), levels: levels.map( level => level.read() ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      if ( !Array.isArray( state.levels ) || state.levels.length !== levels.length ) {
        throw new Error( 'Invalid Number Play game.' );
      }
      const select = prepareFields( fields, state );
      const applyLevels = state.levels.map( ( input, index ) => levels[ index ].prepare( input ) );
      return () => {
        screen.view.interruptSubtreeInput();
        select();
        applyLevels.forEach( apply => apply() );
      };
    }
  };
}

function labState( screen: AnyScreen ) {
  const model = screen.model as LabModel;
  const view = screen.view as LabScreenView<typeof numberPlayPreferences>;
  const areas = [ model.onesCountingArea, model.dogCountingArea, model.appleCountingArea, model.butterflyCountingArea, model.ballCountingArea ];
  const carousel = view.numberCardCreatorCarousel;
  const symbols = view.symbolCardCreatorPanel;
  const numberCounts = carousel[ 'numberToCountPropertyMap' ];
  const symbolCounts = symbols[ 'symbolTypeToCountPropertyMap' ];
  const controls = { page: number( carousel.pageNumberProperty, true, page => page >= 0 && page < 2 ) };
  function cardState( card: CardNode ) {
    const text = card.children[ 0 ].children.find( node => node instanceof Text )!;
    const position = card.positionProperty.value;
    return { kind: card instanceof NumberCardNode ? 'number' : 'symbol', label: text.string, position: [ position.x, position.y ] };
  }
  return {
    read: () => {
      const pieces = areas.map( area => area.getCountingObjectsIncludedInSum() );
      return {
        ...readFields( controls ),
        areas: areas.map( readArea ),
        tenFrames: model.tenFrames.map( frame => {
          const position = frame.positionProperty.value;
          return {
            position: [ position.x, position.y ],
            slots: frame.countingObjects.map( piece => {
              const area = pieces.findIndex( list => list.includes( piece ) );
              return [ area, pieces[ area ]?.indexOf( piece ) ?? -1 ];
            } ).filter( ( [ area ] ) => area >= 0 )
          };
        } ),
        selectedFrame: model.selectedTenFrameProperty.value ? model.tenFrames.indexOf( model.selectedTenFrameProperty.value ) : -1,
        cards: view.pieceLayer.children.flatMap( node => node.inputEnabled &&
          ( node instanceof NumberCardNode || node instanceof SymbolCardNode ) ? [ cardState( node ) ] : [] )
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      if ( !Array.isArray( state.areas ) || state.areas.length !== areas.length ||
           !Array.isArray( state.tenFrames ) || state.tenFrames.length > 100 ||
           !Array.isArray( state.cards ) || state.cards.length > 500 ||
           typeof state.selectedFrame !== 'number' || !Number.isInteger( state.selectedFrame ) ||
           state.selectedFrame < -1 || state.selectedFrame >= state.tenFrames.length ) {
        throw new Error( 'Invalid Number Play lab.' );
      }
      const restoreControls = prepareFields( controls, state );
      const restoreAreas = state.areas.map( ( input, index ) => prepareArea( areas[ index ], input ) );
      const seen = new Set<string>();
      const frames = state.tenFrames.map( item => {
        const frame = object( item );
        if ( !Array.isArray( frame.slots ) || frame.slots.length > 10 ) { throw new Error( 'Invalid Number Play ten frame.' ); }
        const slots = frame.slots.map( item => {
          if ( !Array.isArray( item ) || item.length !== 2 || !item.every( Number.isInteger ) ||
               !restoreAreas[ item[ 0 ] ] || item[ 1 ] < 0 || item[ 1 ] >= restoreAreas[ item[ 0 ] ].length || seen.has( item.join( ':' ) ) ) {
            throw new Error( 'Invalid Number Play ten-frame slot.' );
          }
          seen.add( item.join( ':' ) );
          return item as [ number, number ];
        } );
        if ( slots.some( slot => slot[ 0 ] !== slots[ 0 ][ 0 ] ) ) { throw new Error( 'Inconsistent Number Play ten-frame types.' ); }
        return { slots, position: xy( frame.position ) };
      } );
      const cardTotals = new Map<string, number>();
      const restoreCards = state.cards.map( item => {
        const state = object( item );
        const position = xy( state.position );
        const numeric = state.kind === 'number' && typeof state.label === 'string' ? Number( state.label ) : null;
        const symbol = state.kind === 'symbol' ? [ ...symbolCounts.keys() ].find( item => item === state.label ) : undefined;
        const count = numeric !== null ? numberCounts.get( numeric ) : symbol ? symbolCounts.get( symbol ) : undefined;
        const key = `${state.kind}:${state.label}`;
        const total = ( cardTotals.get( key ) ?? 0 ) + 1;
        if ( !count || total > ( numeric === null ? 10 : 20 ) ) { throw new Error( 'Invalid Number Play card.' ); }
        cardTotals.set( key, total );
        return () => {
          let card: CardNode;
          const tray = numeric === null ? symbols : carousel;
          const dropListener = () => {
            if ( card.bounds.intersectsBounds( tray.bounds ) ) {
              view.pieceLayer.removeChild( card );
              count.value--;
              card.dispose();
            }
          };
          card = numeric !== null ? new NumberCardNode( { number: numeric, dragBoundsProperty: view.numberCardBoundsProperty, dropListener } ) :
                 new SymbolCardNode( { symbolType: symbol!, dragBoundsProperty: view.symbolCardBoundsProperty, dropListener } );
          card.positionProperty.value = position;
          view.pieceLayer.addChild( card );
          count.value++;
        };
      } );
      const selectedFrame = state.selectedFrame;
      return () => {
        screen.view.interruptSubtreeInput();
        model.selectedTenFrameProperty.value = null;
        model.tenFrames.clear();
        carousel.reset();
        symbols.reset();
        restoreAreas.forEach( restore => restore.apply() );
        frames.forEach( ( { slots, position } ) => {
          const frame = new TenFrame( position );
          model.dragTenFrameFromIcon( frame );
          slots.forEach( ( [ area, index ] ) => frame.addCountingObject( areas[ area ].countingObjects[ index ] ) );
        } );
        model.selectedTenFrameProperty.value = model.tenFrames[ selectedFrame ] ?? null;
        restoreCards.forEach( restore => restore() );
        restoreControls();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'ten', 'twenty', 'game', 'lab' ];
  const prefs = numberPlayPreferences;
  const preferences = {
    autoHear: boolean( prefs.autoHearEnabledProperty ),
    secondLocaleEnabled: boolean( prefs.secondLocaleEnabledProperty ),
    secondLocale: field( prefs.secondLocaleProperty, value => value, input =>
      prefs.secondLocaleProperty.availableRuntimeLocales.find( locale => locale === input ) ),
    primaryLanguage: boolean( prefs.isPrimaryLocaleProperty ),
    showLabOnes: boolean( prefs.showLabOnesProperty ),
    subitizeTimeShown: number( prefs.subitizeTimeShownProperty )
  };
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-number-play/v1',
    build: 'number-play@1.2.0-dev.3-webwriter.1',
    readPreferences: () => readFields( preferences ),
    preparePreferences: input => prepareFields( preferences, input ),
    screens: sim.simScreens.map( ( screen, index ) => ( {
      id: ids[ index ], screen,
      ...( index < 2 ? countState( screen ) : index === 2 ? gameState( screen ) : labState( screen ) )
    } ) )
  } ) );
}
