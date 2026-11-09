// Unit Rates WebWriter state adapter. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type Sim from '../../../joist/js/Sim.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import Color from '../../../scenery/js/util/Color.js';
import AccordionBox from '../../../sun/js/AccordionBox.js';
import type DoubleNumberLine from '../common/model/DoubleNumberLine.js';
import Marker from '../common/model/Marker.js';
import type MarkerEditor from '../common/model/MarkerEditor.js';
import URConstants from '../common/URConstants.js';
import type RaceCar from '../racinglab/model/RaceCar.js';
import type RacingLabModel from '../racinglab/model/RacingLabModel.js';
import type ShoppingModel from '../shopping/model/ShoppingModel.js';
import type ShoppingQuestion from '../shopping/model/ShoppingQuestion.js';
import type ShoppingScene from '../shopping/model/ShoppingScene.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, number, object, prepareFields, readFields } from './stateFields.js';

const creators = [ 'editor', 'scale', 'question', 'unitRateQuestion', 'race' ] as const;

function finite( value: unknown, min = 0, max = 1e8 ): value is number {
  return typeof value === 'number' && Number.isFinite( value ) && value >= min && value <= max;
}

function guess( value: unknown ): number | null {
  if ( value !== null && !finite( value, -1e8 ) ) { throw new Error( 'Invalid unit rate entry.' ); }
  return value;
}

function accordionFields( node: Node ) {
  const properties: ReturnType<typeof boolean>[] = [];
  const seen = new Set<object>();
  const visit = ( child: Node ) => {
    if ( child instanceof AccordionBox && !seen.has( child.expandedProperty ) ) {
      seen.add( child.expandedProperty );
      properties.push( boolean( child.expandedProperty ) );
    }
    child.children.forEach( visit );
  };
  visit( node );
  return Object.fromEntries( properties.map( ( property, index ) => [ `expanded${index}`, property ] ) );
}

function numberLineState( line: DoubleNumberLine, editor: MarkerEditor ) {
  return {
    read: () => ( {
      editor: [ editor.numeratorProperty.value, editor.denominatorProperty.value ],
      undo: line.markers.indexOf( line.undoMarkerProperty.value! ),
      markers: line.markers.map( marker => ( {
        creator: marker.creator,
        numerator: marker.numeratorProperty.value,
        denominator: marker.denominatorProperty.value,
        major: marker.isMajor,
        erasable: marker.erasable,
        color: marker.colorProperty.value instanceof Color ? marker.colorProperty.value.toCSS() : marker.colorProperty.value
      } ) )
    } ),
    prepare: ( input: unknown ) => {
      const { editor: entries, undo, markers } = object( input );
      if ( !Array.isArray( entries ) || entries.length !== 2 || !Array.isArray( markers ) || markers.length > 2000 ||
           typeof undo !== 'number' || !Number.isInteger( undo ) || undo < -1 || undo >= markers.length ) {
        throw new Error( 'Invalid double number line.' );
      }
      const [ numeratorEntry, denominatorEntry ] = entries.map( guess );
      const saved: Marker[] = [];
      markers.forEach( entry => {
        const { creator, numerator, denominator, major, erasable, color } = object( entry );
        const markerCreator = creators.find( value => value === creator );
        if ( !markerCreator || !finite( numerator ) || !finite( denominator ) ||
             typeof major !== 'boolean' || typeof erasable !== 'boolean' || typeof color !== 'string' ||
             !/^(?:[a-zA-Z]+|#[\da-fA-F]{3,8}|rgba?\([\d., %]+\))$/.test( color ) ) {
          throw new Error( 'Invalid double number line marker.' );
        }
        const marker = new Marker( markerCreator, numerator, denominator, line.numeratorAxis, line.denominatorAxis,
          { isMajor: major, erasable, color } );
        if ( saved.some( item => item.conflictsWith( marker ) ) ) { throw new Error( 'Conflicting double number line markers.' ); }
        saved.push( marker );
      } );
      return () => {
        // Preserve the active scale/race marker that the model created and retains in its listener.
        const live = line.markers.filter( marker => !marker.erasable && ( marker.creator === 'scale' || marker.creator === 'race' ) );
        const restored = saved.map( marker => live.find( item =>
          !marker.erasable && item.creator === marker.creator && item.conflictsWith( marker ) ) ?? marker );
        line.reset();
        restored.forEach( marker => line.addMarker( marker ) );
        line.undoMarkerProperty.value = restored[ undo ] ?? null;
        editor.reset();
        editor.numeratorProperty.value = numeratorEntry;
        editor.denominatorProperty.value = denominatorEntry;
      };
    }
  };
}

function questionSignature( set: ShoppingQuestion[] ) {
  return set.map( question => [ question.numerator, question.denominator, question.answer ].join( '/' ) ).join( ',' );
}

function shoppingSceneState( scene: ShoppingScene, editableRate: boolean ) {
  const line = numberLineState( scene.doubleNumberLine, scene.markerEditor );
  const items = scene.bags.flatMap( bag => bag.items ?? [] );
  const movables = [ ...scene.bags, ...items ];
  const rows = [ scene.shelf.bagRow, scene.shelf.backItemRow, scene.shelf.frontItemRow,
    scene.scale.bagRow, scene.scale.backItemRow, scene.scale.frontItemRow ];
  const questionIndex = scene[ 'questionSetsIndexProperty' ];
  const rate = {
    cost: number( scene.rate.numeratorProperty, false, value => !editableRate ?
      value === scene.rate.numeratorProperty.initialValue : URConstants.COST_RANGE.contains( value ) ),
    quantity: number( scene.rate.denominatorProperty, false, value => !editableRate ?
      value === scene.rate.denominatorProperty.initialValue : URConstants.QUANTITY_RANGE.contains( value ) )
  };
  return {
    read: () => ( {
      ...readFields( rate ),
      line: line.read(),
      rows: rows.map( row => row.cells.map( cell => cell.movable ? movables.indexOf( cell.movable as typeof movables[number] ) : null ) ),
      movables: movables.map( item => ( {
        visible: item.visibleProperty.value,
        position: [ item[ 'destination' ].x, item[ 'destination' ].y ]
      } ) ),
      set: questionIndex.value,
      questions: scene.questionSets.map( set => ( {
        key: questionSignature( set ),
        guesses: set.map( question => question.guessProperty.value )
      } ) ),
      unitRateGuess: scene.unitRateQuestion.guessProperty.value
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyLine = line.prepare( state.line );
      const applyRate = prepareFields( rate, state );
      const { rows: savedRows, movables: savedMovables, set, questions } = state;
      if ( !Array.isArray( savedRows ) || savedRows.length !== rows.length ||
           !Array.isArray( savedMovables ) || savedMovables.length !== movables.length ||
           !Array.isArray( questions ) || questions.length !== scene.questionSets.length ||
           typeof set !== 'number' || !Number.isInteger( set ) || !scene.questionSets[ set ] ) {
        throw new Error( 'Invalid unit rate shopping scene.' );
      }
      const occupied = new Set<number>();
      const placements = rows.map( ( row, rowIndex ) => {
        const cells = savedRows[ rowIndex ];
        if ( !Array.isArray( cells ) || cells.length !== row.cells.length ) { throw new Error( 'Invalid shelf or scale.' ); }
        return cells.map( index => {
          if ( index === null ) { return null; }
          if ( !Number.isInteger( index ) || !movables[ index ] || occupied.has( index ) ||
               ( index < scene.bags.length ) !== ( rowIndex % 3 === 0 ) ) { throw new Error( 'Invalid shopping item placement.' ); }
          occupied.add( index );
          return movables[ index ];
        } );
      } );
      const applyMovables = savedMovables.map( ( entry, index ) => {
        const { visible, position } = object( entry );
        if ( typeof visible !== 'boolean' || !Array.isArray( position ) || position.length !== 2 ||
             !position.every( value => finite( value, -10000, 10000 ) ) ) { throw new Error( 'Invalid shopping item.' ); }
        const point = new Vector2( position[ 0 ], position[ 1 ] );
        return () => {
          movables[ index ].visibleProperty.value = visible;
          movables[ index ].dragging = false;
          movables[ index ].moveTo( point );
        };
      } );
      const available = scene.questionSets.slice();
      const ordered = questions.map( entry => {
        const { key, guesses } = object( entry );
        const index = available.findIndex( set => questionSignature( set ) === key );
        if ( index === -1 || !Array.isArray( guesses ) || guesses.length !== available[ index ].length ) {
          throw new Error( 'Invalid shopping question set.' );
        }
        const [ questions ] = available.splice( index, 1 );
        return { questions, guesses: guesses.map( guess ) };
      } );
      const unitRateGuess = guess( state.unitRateGuess );
      return () => {
        scene.reset();
        applyRate();
        scene.shelf.reset();
        scene.scale.quantityUpdateEnabled = true;
        scene.scale.reset();
        placements.forEach( ( cells, rowIndex ) => cells.forEach( ( item, index ) => {
          if ( item ) { rows[ rowIndex ].put( item, index ); }
        } ) );
        applyMovables.forEach( apply => apply() );
        scene.questionSets.splice( 0, scene.questionSets.length, ...ordered.map( entry => entry.questions ) );
        questionIndex.value = set;
        scene.questionSetProperty.value = scene.questionSets[ set ];
        ordered.forEach( entry => entry.questions.forEach( ( question, index ) => { question.guessProperty.value = entry.guesses[ index ]; } ) );
        scene.unitRateQuestion.guessProperty.value = unitRateGuess;
        applyLine();
      };
    }
  };
}

function racingCarState( car: RaceCar ) {
  const line = numberLineState( car.doubleNumberLine, car.markerEditor );
  const fields = {
    miles: number( car.rate.numeratorProperty, false, value => URConstants.MILES_RANGE.contains( value ) ),
    hours: number( car.rate.denominatorProperty, false, value => URConstants.HOURS_RANGE.contains( value ) ),
    track: number( car.track.lengthProperty, false, value => value >= 0 && value <= car.track.maxLength ),
    visible: boolean( car.visibleProperty )
  };
  const motion = {
    time: number( car.timeProperty, false, value => value >= 0 ),
    distance: number( car.distanceProperty, false, value => value >= 0 && value <= car.track.maxLength )
  };
  return {
    read: () => ( { ...readFields( fields ), ...readFields( motion ), line: line.read() } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const applyMotion = prepareFields( motion, state );
      const applyLine = line.prepare( state.line );
      return {
        apply,
        applyMotion: () => {
          applyMotion();
          applyLine();
        }
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-unit-rates/v1',
    build: 'unit-rates@1.2.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => {
      const controls = accordionFields( screen.view );
      if ( index === 2 ) {
        const model = screen.model as RacingLabModel;
        const fields = { ...controls, racing: boolean( model.runningProperty ) };
        const cars = [ racingCarState( model.car1 ), racingCarState( model.car2 ) ];
        return {
          id: 'racing-lab',
          screen,
          isPlaying: () => model.runningProperty.value,
          read: () => ( { ...readFields( fields ), cars: cars.map( car => car.read() ) } ),
          prepare: input => {
            const state = object( input );
            const apply = prepareFields( fields, state );
            const saved = state.cars;
            if ( !Array.isArray( saved ) || saved.length !== cars.length ) { throw new Error( 'Invalid unit rates race.' ); }
            const applyCars = cars.map( ( car, index ) => car.prepare( saved[ index ] ) );
            return () => {
              screen.view.interruptSubtreeInput();
              model.reset();
              applyCars.forEach( car => car.apply() );
              applyCars.forEach( car => car.applyMotion() );
              apply();
            };
          }
        };
      }

      const model = screen.model as ShoppingModel;
      const categories = model.categories.map( category => category.shoppingScenes.map( scene => shoppingSceneState( scene, index === 1 ) ) );
      return {
        id: index === 0 ? 'shopping' : 'shopping-lab',
        screen,
        read: () => ( {
          ...readFields( controls ),
          category: model.categories.indexOf( model.categoryProperty.value ),
          selected: model.categories.map( category => category.shoppingScenes.indexOf( category.shoppingSceneProperty.value ) ),
          scenes: categories.map( scenes => scenes.map( scene => scene.read() ) )
        } ),
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( controls, state );
          const { category, selected, scenes } = state;
          if ( typeof category !== 'number' || !Number.isInteger( category ) || !model.categories[ category ] ||
               !Array.isArray( selected ) || selected.length !== categories.length ||
               !Array.isArray( scenes ) || scenes.length !== categories.length ) { throw new Error( 'Invalid shopping categories.' ); }
          const applyScenes = categories.map( ( category, index ) => {
            const saved = scenes[ index ];
            if ( !Array.isArray( saved ) || saved.length !== category.length ||
                 !Number.isInteger( selected[ index ] ) || !category[ selected[ index ] ] ) { throw new Error( 'Invalid shopping category.' ); }
            return category.map( ( scene, index ) => scene.prepare( saved[ index ] ) );
          } );
          return () => {
            screen.view.interruptSubtreeInput();
            applyScenes.forEach( scenes => scenes.forEach( apply => apply() ) );
            model.categories.forEach( ( category, index ) => {
              category.shoppingSceneProperty.value = category.shoppingScenes[ selected[ index ] ];
            } );
            model.categoryProperty.value = model.categories[ category ];
            apply();
          };
        }
      };
    } )
  } ) );
}
