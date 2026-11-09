// State adapter for PhET Number Compare. Distributed under GPL-3.0.
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
import type SymbolType from '../../../number-suite-common/js/lab/view/SymbolType.js';
import Text from '../../../scenery/js/nodes/Text.js';
import preferences, { type NumberComparePreferences } from '../common/model/numberComparePreferences.js';
import type CompareModel from '../compare/model/CompareModel.js';
import type CompareScreenView from '../compare/view/CompareScreenView.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

function position( input: unknown ) {
  if ( !Array.isArray( input ) || input.length !== 2 || !input.every( value => Number.isFinite( value ) && Math.abs( value ) <= 1e5 ) ) {
    throw new Error( 'Invalid Number Compare position.' );
  }
  return new Vector2( input[ 0 ], input[ 1 ] );
}
function point( value: Vector2 ) { return [ value.x, value.y ]; }

function savedObjects( area: CountingArea ) { return area.getCountingObjectsIncludedInSum(); }

function readArea( objects: CountingObject[] ) {
  return objects.map( item => ( {
    value: item.numberValueProperty.value,
    position: point( item.destination ?? item.positionProperty.value )
  } ) );
}

function prepareArea( area: CountingArea, input: unknown ) {
  const max = area.sumProperty.range.max;
  if ( !Array.isArray( input ) || input.length > max ) { throw new Error( 'Invalid Number Compare collection.' ); }
  let total = 0;
  return input.map( item => {
    const data = object( item );
    const value = data.value;
    if ( typeof value !== 'number' || !Number.isInteger( value ) || value < 1 ||
         !area.groupingEnabledProperty.value && value !== 1 || ( total += value ) > max ) {
      throw new Error( 'Invalid Number Compare count.' );
    }
    return new CountingObject( value, position( data.position ), { groupingEnabledProperty: area.groupingEnabledProperty } );
  } );
}

function applyArea( area: CountingArea, values: CountingObject[] ) {
  area.removeAllCountingObjects();
  values.forEach( item => area.addCountingObject( item ) );
  area.calculateTotal();
}

function compare( screen: AnyScreen ) {
  const model = screen.model as CompareModel;
  const view = screen.view as CompareScreenView;
  const fields = {
    countingType: enumeration( model.countingTypeProperty ),
    signs: boolean( model.comparisonSignsAndTextVisibleProperty ),
    leftObject: enumeration( model.leftCountingObjectTypeProperty ),
    rightObject: enumeration( model.rightCountingObjectTypeProperty ),
    leftTotal: boolean( view[ 'leftTotalAccordionBoxExpandedProperty' ] ),
    rightTotal: boolean( view[ 'rightTotalAccordionBoxExpandedProperty' ] ),
    leftCounting: boolean( view[ 'leftCountingAccordionBoxExpandedProperty' ] ),
    rightCounting: boolean( view[ 'rightCountingAccordionBoxExpandedProperty' ] )
  };
  return {
    id: 'compare',
    screen,
    read: () => ( { ...readFields( fields ), left: readArea( savedObjects( model.leftCountingArea ) ),
      right: readArea( savedObjects( model.rightCountingArea ) ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const left = prepareArea( model.leftCountingArea, state.left );
      const right = prepareArea( model.rightCountingArea, state.right );
      return () => {
        view.interruptSubtreeInput();
        apply();
        applyArea( model.leftCountingArea, left );
        applyArea( model.rightCountingArea, right );
      };
    }
  };
}

function cardText( card: CardNode ) {
  const text = card.children[ 0 ]?.children[ 0 ];
  if ( !( text instanceof Text ) ) { throw new Error( 'Missing Number Compare card label.' ); }
  return text.string;
}

function lab( screen: AnyScreen ) {
  const model = screen.model as LabModel;
  const view = screen.view as LabScreenView<NumberComparePreferences>;
  const carousel = view.numberCardCreatorCarousel;
  const symbolPanel = view.symbolCardCreatorPanel;
  const numberCounts = carousel[ 'numberToCountPropertyMap' ];
  const symbolCounts = symbolPanel[ 'symbolTypeToCountPropertyMap' ];
  const areas = [ model.onesCountingArea, model.dogCountingArea, model.appleCountingArea, model.butterflyCountingArea, model.ballCountingArea ];
  const fields = { cardPage: number( carousel.pageNumberProperty, true, value => value >= 0 && value <= 1 ) };

  return {
    id: 'lab',
    screen,
    read: () => {
      const items = areas.map( savedObjects );
      const frames = model.tenFrames.filter( frame => view.getTenFrameNode( frame ).inputEnabled );
      return {
        ...readFields( fields ),
        areas: items.map( readArea ),
        frames: frames.map( frame => ( {
          position: point( frame.positionProperty.value ),
          objects: frame.countingObjects.filter( item => item.includeInSumProperty.value ).map( item => {
            const area = items.findIndex( objects => objects.includes( item ) );
            return [ area, items[ area ].indexOf( item ) ];
          } )
        } ) ),
        selected: frames.indexOf( model.selectedTenFrameProperty.value! ),
        cards: view.pieceLayer.children.filter( ( node ): node is NumberCardNode | SymbolCardNode =>
          ( node instanceof NumberCardNode || node instanceof SymbolCardNode ) && node.inputEnabled ).map( card => ( {
          number: card instanceof NumberCardNode,
          text: cardText( card ),
          position: point( card.positionProperty.value )
        } ) )
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      if ( !Array.isArray( state.areas ) || state.areas.length !== areas.length ||
           !Array.isArray( state.frames ) || state.frames.length > 400 ||
           !Array.isArray( state.cards ) || state.cards.length > 440 ||
           typeof state.selected !== 'number' || !Number.isInteger( state.selected ) ||
           state.selected < -1 || state.selected >= state.frames.length ) {
        throw new Error( 'Invalid Number Compare lab.' );
      }
      const selected = state.selected;
      const objects = state.areas.map( ( input, i ) => prepareArea( areas[ i ], input ) );
      const assigned = new Set<CountingObject>();
      const frames = state.frames.map( input => {
        const data = object( input );
        if ( !Array.isArray( data.objects ) || data.objects.length > 10 ) { throw new Error( 'Invalid ten frame.' ); }
        const contents = data.objects.map( pair => {
          if ( !Array.isArray( pair ) || pair.length !== 2 || !pair.every( Number.isInteger ) ) {
            throw new Error( 'Invalid ten frame object.' );
          }
          const item = objects[ pair[ 0 ] ]?.[ pair[ 1 ] ];
          if ( !item || assigned.has( item ) || item.numberValueProperty.value !== 1 ) { throw new Error( 'Invalid ten frame object.' ); }
          assigned.add( item );
          return item;
        } );
        return { frame: new TenFrame( position( data.position ) ), contents };
      } );
      const copies = new Map<string, number>();
      const cards = state.cards.map( input => {
        const data = object( input );
        if ( typeof data.number !== 'boolean' || typeof data.text !== 'string' ) { throw new Error( 'Invalid Number Compare card.' ); }
        const key = data.number ? Number( data.text ) : data.text as SymbolType;
        const count = data.number ? numberCounts.get( key as number ) : symbolCounts.get( key as SymbolType );
        const countKey = `${data.number}:${key}`;
        const next = ( copies.get( countKey ) ?? 0 ) + 1;
        if ( !count || next > ( data.number ? 20 : 10 ) ) { throw new Error( 'Invalid Number Compare card count.' ); }
        copies.set( countKey, next );
        return { number: data.number, key, count, position: position( data.position ) };
      } );
      return () => {
        view.interruptSubtreeInput();
        model.reset();
        carousel.reset();
        symbolPanel.reset();
        areas.forEach( ( area, i ) => applyArea( area, objects[ i ] ) );
        frames.forEach( ( { frame, contents } ) => {
          model.dragTenFrameFromIcon( frame );
          contents.forEach( item => frame.addCountingObject( item ) );
        } );
        model.selectedTenFrameProperty.value = frames[ selected ]?.frame ?? null;
        cards.forEach( ( { number, key, count, position } ) => {
          const panel = number ? carousel : symbolPanel;
          const dragBoundsProperty = number ? view.numberCardBoundsProperty : view.symbolCardBoundsProperty;
          const dropListener = () => {
            if ( !card.isDisposed && card.bounds.intersectsBounds( panel.bounds ) ) {
              view.pieceLayer.removeChild( card );
              card.dispose();
              count.value--;
            }
          };
          const card = number ?
            new NumberCardNode( { number: key as number, dragBoundsProperty, dropListener } ) :
            new SymbolCardNode( { symbolType: key as SymbolType, dragBoundsProperty, dropListener } );
          count.value++;
          view.pieceLayer.addChild( card );
          card.setConstrainedDestination( dragBoundsProperty.value, position );
        } );
        apply();
      };
    }
  };
}

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => {
    const fields = {
      showLabOnes: field( preferences.showLabOnesProperty, value => value ? 'shown' : 'hidden',
        input => input === 'shown' ? true : input === 'hidden' ? false : undefined ),
      autoHear: boolean( preferences.autoHearEnabledProperty ),
      secondLocaleEnabled: boolean( preferences.secondLocaleEnabledProperty ),
      secondLocale: field( preferences.secondLocaleProperty, String,
        input => preferences.secondLocaleProperty.availableRuntimeLocales.find( locale => locale === input ) )
    };
    const compareScreen = compare( sim.simScreens[ 0 ] );
    const primary = boolean( preferences.isPrimaryLocaleProperty );
    return {
      bridge: 'webwriter-number-compare/v1',
      build: 'number-compare@1.1.0-dev.0-webwriter.1',
      screens: [ {
        ...compareScreen,
        read: () => ( { ...compareScreen.read(), primaryLanguage: primary.read() } ),
        prepare: ( input: unknown ) => {
          const apply = compareScreen.prepare( input );
          const language = primary.prepare( object( input ).primaryLanguage, 'primaryLanguage' );
          return () => { apply(); language(); };
        }
      }, lab( sim.simScreens[ 1 ] ) ],
      readPreferences: () => readFields( fields ),
      preparePreferences: input => prepareFields( fields, input )
    };
  } );
}
