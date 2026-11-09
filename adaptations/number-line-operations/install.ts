// Number Line Operations WebWriter adapter. Distributed under GPL-3.0.
import type Range from '../../../dot/js/Range.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import type NLOChipsModel from '../chips/model/NLOChipsModel.js';
import NLOConstants from '../common/NLOConstants.js';
import Operation from '../common/model/Operation.js';
import type OperationTrackingNumberLine from '../common/model/OperationTrackingNumberLine.js';
import OperationEntryCarousel from '../common/view/OperationEntryCarousel.js';
import NLOGenericModel from '../generic/model/NLOGenericModel.js';
import type NLONetWorthModel from '../net-worth/model/NLONetWorthModel.js';
import type NLOOperationsModel from '../operations/model/NLOOperationsModel.js';
import InitialNetWorthAccordionBox from '../operations/view/InitialNetWorthAccordionBox.js';
import installSimulationBridge from './installSimulationBridge.js';
import { groupedState, lineFields } from './numberLineState.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

function operationsState( line: OperationTrackingNumberLine, ranges?: readonly Range[] ) {
  const fields = {
    ...lineFields( line, ranges ),
    start: number( line.startingValueProperty, true ),
    operationLabels: boolean( line.showOperationLabelsProperty ),
    operationDescriptions: boolean( line.showOperationDescriptionsProperty )
  };
  const operations = line.operations.map( operation => ( {
    type: field( operation.operationTypeProperty, value => String( value ), input =>
      Operation.VALUES.find( value => String( value ) === input ) ),
    amount: number( operation.amountProperty, true ),
    active: boolean( operation.isActiveProperty )
  } ) );
  return {
    read: () => ( {
      ...readFields( fields ),
      operations: operations.map( ( operation, index ) => {
        const expiration = line.operationExpirationTimes.get( line.operations[ index ] );
        return { ...readFields( operation ), remaining: expiration === undefined ? null : Math.max( 0, expiration - phet.joist.elapsedTime ) };
      } )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      if ( !Array.isArray( state.operations ) || state.operations.length !== operations.length ) {
        throw new Error( 'Invalid Number Line operations.' );
      }
      const restore = prepareFields( fields, state );
      const restoreOperations = state.operations.map( ( input, index ) => {
        const operation = object( input );
        const remaining = operation.remaining;
        if ( remaining !== null && ( typeof remaining !== 'number' || !Number.isFinite( remaining ) || remaining < 0 ||
             remaining > NLOConstants.OPERATION_AUTO_DEACTIVATE_TIME || operation.active !== true ) ) {
          throw new Error( 'Invalid Number Line operation expiration.' );
        }
        const apply = prepareFields( operations[ index ], operation );
        return () => {
          apply();
          if ( remaining !== null ) {
            line.operationExpirationTimes.set( line.operations[ index ], phet.joist.elapsedTime + remaining );
          }
        };
      } );
      return () => {
        line.deactivateAllOperations();
        restore();
        restoreOperations.forEach( apply => apply() );
      };
    }
  };
}

function bagState( model: NLOChipsModel | NLONetWorthModel ) {
  const items = 'chips' in model ? model.chips : model.balanceSheetItems;
  const total = 'chips' in model ? model.totalInBagsProperty : model.netWorthProperty;
  return {
    read: () => model.bags.map( bag => bag.containedItemList.map( item => items.indexOf( item ) ) ),
    prepare: ( input: unknown ) => {
      if ( !Array.isArray( input ) || input.length !== model.bags.length ) { throw new Error( 'Invalid Number Line bags.' ); }
      const seen = new Set<number>();
      const contents = input.map( ( group, index ) => {
        const bag = model.bags[ index ];
        if ( !Array.isArray( group ) || group.length > bag.capacity ) { throw new Error( 'Invalid Number Line bag capacity.' ); }
        return group.map( item => {
          if ( typeof item !== 'number' || !Number.isInteger( item ) || !items[ item ] || seen.has( item ) ||
               !bag.acceptsItem( items[ item ] ) ) { throw new Error( 'Invalid Number Line bag item.' ); }
          seen.add( item );
          return items[ item ];
        } );
      } );
      return () => {
        model.reset();
        model.storageBoxes.forEach( box => {
          items.filter( item => box.holdsItem( item ) ).forEach( item => box.returnItem( item, false ) );
        } );
        model.bags.forEach( ( bag, index ) => {
          contents[ index ].forEach( ( item, slot ) => {
            bag.addItem( item );
            item.teleportTo( bag.possibleItemPositions[ slot ] );
          } );
        } );
        total.value = model.bags.reduce( ( sum, bag ) => sum + bag.getTotalValue(), 0 );
      };
    }
  };
}

function findAccordion( node: Node ): InitialNetWorthAccordionBox | undefined {
  if ( node instanceof InitialNetWorthAccordionBox ) { return node; }
  for ( const child of node.children ) {
    const found = findAccordion( child );
    if ( found ) { return found; }
  }
  return undefined;
}

function entryCarousels( node: Node ): OperationEntryCarousel[] {
  return node.children.flatMap( child => child instanceof OperationEntryCarousel ? [ child ] : entryCarousels( child ) );
}

function screenState( screen: AnyScreen, index: number ) {
  if ( index < 2 ) {
    const model = screen.model as NLOChipsModel | NLONetWorthModel;
    const bags = bagState( model );
    const line = operationsState( model.numberLine );
    const controls = { expanded: boolean( model.netWorthAccordionBoxExpandedProperty ) };
    return {
      isPlaying: () => model.numberLine.operationExpirationTimes.size > 0,
      read: () => ( { ...readFields( controls ), bags: bags.read(), line: line.read() } ),
      prepare: ( input: unknown ) => {
        const state = object( input );
        const restoreBags = bags.prepare( state.bags );
        const restoreLine = line.prepare( state.line );
        const restoreControls = prepareFields( controls, state );
        return () => {
          restoreBags();
          restoreLine();
          restoreControls();
        };
      }
    };
  }
  const controls: Parameters<typeof readFields>[ 0 ] = {};
  entryCarousels( screen.view ).forEach( ( carousel, index ) => {
    controls[ `operationPage${index}` ] = number( carousel.selectedPageProperty, true, value => value >= 0 && value <= 1 );
  } );
  if ( index === 2 ) {
    const model = screen.model as NLOOperationsModel;
    const accordion = findAccordion( screen.view );
    if ( accordion ) { controls.expanded = boolean( accordion.expandedProperty ); }
    return { ...groupedState( controls, { line: operationsState( model.numberLine ) } ), isPlaying: undefined };
  }
  const model = screen.model as NLOGenericModel;
  const ranges = NLOGenericModel.NUMBER_LINE_RANGES;
  controls.secondLine = boolean( model.secondNumberLineVisibleProperty );
  return { ...groupedState( controls, {
    primary: operationsState( model.primaryNumberLine, ranges ),
    secondary: operationsState( model.secondaryNumberLine, ranges )
  } ), isPlaying: undefined };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'chips', 'net-worth', 'operations', 'generic' ];
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-number-line-operations/v1',
    build: 'number-line-operations@1.2.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => {
      const adapter = screenState( screen, index );
      return {
        id: ids[ index ], screen, read: adapter.read, isPlaying: adapter.isPlaying,
        prepare: input => {
          const restore = adapter.prepare( input );
          return () => { screen.view.interruptSubtreeInput(); restore(); };
        }
      };
    } )
  } ) );
}
