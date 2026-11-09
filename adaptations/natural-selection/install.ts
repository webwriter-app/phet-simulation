// State adapter for PhET Natural Selection. Distributed under GPL-3.0.
import Range from '../../../dot/js/Range.js';
import Vector2 from '../../../dot/js/Vector2.js';
import Vector3 from '../../../dot/js/Vector3.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import { writableIsSettingPhetioStateProperty } from '../../../tandem/js/isSettingPhetioStateProperty.js';
import NaturalSelectionQueryParameters from '../common/NaturalSelectionQueryParameters.js';
import type Bunny from '../common/model/Bunny.js';
import BunnyCounts from '../common/model/BunnyCounts.js';
import type NaturalSelectionModel from '../common/model/NaturalSelectionModel.js';
import ProportionsCounts from '../common/model/ProportionsCounts.js';
import XDirection from '../common/model/XDirection.js';
import type NaturalSelectionScreenView from '../common/view/NaturalSelectionScreenView.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

const maxGeneration = NaturalSelectionQueryParameters.maxGenerations;
const maxPopulation = NaturalSelectionQueryParameters.maxPopulation;
const countKeys = [ 'totalCount', 'whiteFurCount', 'brownFurCount', 'straightEarsCount', 'floppyEarsCount',
  'shortTeethCount', 'longTeethCount' ] as const;
const times = [ 'restTime', 'cumulativeRestTime', 'hopTime', 'cumulativeHopTime' ] as const;

function bounded( input: unknown, max: number, integer = false ) {
  if ( typeof input !== 'number' || !Number.isFinite( input ) || input < 0 || input > max || integer && !Number.isInteger( input ) ) {
    throw new Error( 'Invalid Natural Selection number.' );
  }
  return input;
}
function list( input: unknown, max: number, length?: number ): unknown[] {
  if ( !Array.isArray( input ) || input.length > max || length !== undefined && input.length !== length ) {
    throw new Error( 'Invalid Natural Selection list.' );
  }
  return input;
}
function flag( input: unknown ) {
  if ( typeof input !== 'boolean' ) { throw new Error( 'Invalid Natural Selection flag.' ); }
  return input;
}
function point( value: Vector3 ) { return [ value.x, value.y, value.z ]; }
function readPoint( input: unknown ) {
  const values = list( input, 3, 3 );
  if ( !values.every( value => typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) < 1e6 ) ) {
    throw new Error( 'Invalid Natural Selection position.' );
  }
  return new Vector3( ...( values as [ number, number, number ] ) );
}
function direction( input: unknown ) {
  const value = XDirection.enumeration.values.find( option => String( option ) === input );
  if ( !value ) { throw new Error( 'Invalid Natural Selection direction.' ); }
  return value;
}
function readCounts( input: unknown ) {
  const data = object( input );
  const counts = Object.fromEntries( countKeys.map( key => [ key, bounded( data[ key ], 4 * maxPopulation, true ) ] ) ) as
    ConstructorParameters<typeof BunnyCounts>[0];
  if ( counts.whiteFurCount + counts.brownFurCount !== counts.totalCount ||
       counts.straightEarsCount + counts.floppyEarsCount !== counts.totalCount ||
       counts.shortTeethCount + counts.longTeethCount !== counts.totalCount ) { throw new Error( 'Inconsistent bunny counts.' ); }
  return new BunnyCounts( counts );
}

function bindScreen( screen: AnyScreen, id: string ) {
  const model = screen.model as NaturalSelectionModel;
  const view = screen.view as NaturalSelectionScreenView;
  const clock = model.generationClock;
  const population = model.populationModel;
  const proportions = model.proportionsModel;
  const pedigree = model.pedigreeModel;
  const bunnies = model.bunnyCollection;
  const bunnyGroup = bunnies[ 'bunnyGroup' ];
  const wolves = model.wolfCollection[ 'wolfGroup' ];
  const genes = model.genePool.genes;
  const series = [ population.totalPoints, population.whiteFurPoints, population.brownFurPoints, population.straightEarsPoints,
    population.floppyEarsPoints, population.shortTeethPoints, population.longTeethPoints ];
  const controls = {
    environment: enumeration( model.environmentProperty ),
    speed: enumeration( model.timeSpeedProperty ),
    wolves: boolean( model.wolfCollection.enabledProperty ),
    toughFood: boolean( model.food.isToughProperty ),
    limitedFood: boolean( model.food.isLimitedProperty ),
    graph: enumeration( view.graphChoiceProperty ),
    total: boolean( population.totalVisibleProperty ),
    white: boolean( population.whiteFurVisibleProperty ),
    brown: boolean( population.brownFurVisibleProperty ),
    straight: boolean( population.straightEarsVisibleProperty ),
    floppy: boolean( population.floppyEarsVisibleProperty ),
    short: boolean( population.shortTeethVisibleProperty ),
    long: boolean( population.longTeethVisibleProperty ),
    populationZoom: number( population.yZoomLevelProperty, true ),
    probe: boolean( population.dataProbe.visibleProperty ),
    probeOffset: vector( population.dataProbe.offsetProperty ),
    proportionsValues: boolean( proportions.valuesVisibleProperty ),
    proportionsFur: boolean( proportions.furVisibleProperty ),
    proportionsEars: boolean( proportions.earsVisibleProperty ),
    proportionsTeeth: boolean( proportions.teethVisibleProperty ),
    pedigreeFur: boolean( pedigree.furAllelesVisibleProperty ),
    pedigreeEars: boolean( pedigree.earsAllelesVisibleProperty ),
    pedigreeTeeth: boolean( pedigree.teethAllelesVisibleProperty )
  };
  const timing = {
    playing: boolean( model.isPlayingProperty ),
    running: boolean( clock.isRunningProperty ),
    mode: enumeration( model.simulationModeProperty )
  };
  const geneFields = genes.map( gene => ( {
    dominant: field( gene.dominantAlleleProperty, value => value === null ? null : value === gene.normalAllele ? 'normal' : 'mutant',
      input => input === null ? null : input === 'normal' ? gene.normalAllele : input === 'mutant' ? gene.mutantAllele : undefined ),
    pending: boolean( gene.mutationComingProperty )
  } ) );
  const time = clock[ 'timeInSecondsProperty' ];
  const past = proportions[ 'previousCounts' ];
  const start = proportions[ 'currentStartCountsProperty' ];
  return {
    id,
    screen,
    isPlaying: () => model.isPlayingProperty.value && clock.isRunningProperty.value,
    read: () => {
      const group = bunnyGroup.getArrayCopy();
      const index = ( bunny: Bunny | null ) => bunny ? group.indexOf( bunny ) : null;
      return {
        ...readFields( controls ), ...readFields( timing ), time: time.value,
        graphGeneration: proportions.proportionsGenerationProperty.value,
        genes: geneFields.map( readFields ),
        selected: index( bunnies.selectedBunnyProperty.value ),
        recessive: bunnies[ 'recessiveMutants' ].map( index ),
        bunnies: group.map( bunny => {
          const genotype = bunny.genotype;
          return {
            parents: [ index( bunny.father ), index( bunny.mother ) ],
            alive: bunny.isAlive, generation: bunny.generation, age: bunny.age,
            alleles: [ genotype.furGenePair, genotype.earsGenePair, genotype.teethGenePair ].map( pair => [
              pair.fatherAllele === pair.gene.mutantAllele, pair.motherAllele === pair.gene.mutantAllele
            ] ),
            mutation: genes.findIndex( gene => genotype.mutation === gene.mutantAllele ),
            position: point( bunny.positionProperty.value ), direction: String( bunny.xDirectionProperty.value ),
            times: times.map( key => bunny[ key ] ), hopDelta: point( bunny[ 'hopDelta' ] ), hopStart: point( bunny[ 'hopStartPosition' ] )
          };
        } ),
        wolvesInField: wolves.getArrayCopy().map( wolf => ( {
          position: point( wolf.positionProperty.value ), direction: String( wolf.xDirectionProperty.value ), speed: wolf.speed
        } ) ),
        population: series.map( values => values.map( point => [ point.x, point.y ] ) ),
        startCounts: start.value,
        previousCounts: past.map( counts => [ counts.startCounts, counts.endCounts ] )
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( controls, state );
      const applyTiming = prepareFields( timing, state );
      const secondsPerGeneration = NaturalSelectionQueryParameters.secondsPerGeneration;
      const seconds = bounded( state.time, ( maxGeneration + 1 ) * secondsPerGeneration );
      const generation = Math.floor( seconds / secondsPerGeneration );
      const graphGeneration = bounded( state.graphGeneration, generation, true );
      const geneState = list( state.genes, genes.length, genes.length ).map( ( values, i ) => prepareFields( geneFields[ i ], values ) );
      const saved = list( state.bunnies, 8 * maxPopulation );
      const selected = state.selected === null ? null : bounded( state.selected, saved.length - 1, true );
      const recessive = list( state.recessive, saved.length ).map( value => bounded( value, saved.length - 1, true ) );
      const animals = saved.map( ( input, index ) => {
        const data = object( input );
        const parents = list( data.parents, 2, 2 ).map( parent => parent === null ? null : bounded( parent, index - 1, true ) );
        const alleles = list( data.alleles, 3, 3 ).map( ( input, i ) =>
          list( input, 2, 2 ).map( mutant => flag( mutant ) ? genes[ i ].mutantAllele : genes[ i ].normalAllele ) );
        return {
          parents, alleles, alive: flag( data.alive ), generation: bounded( data.generation, generation, true ),
          age: bounded( data.age, maxGeneration + 1, true ), mutation: data.mutation === -1 ? -1 : bounded( data.mutation, 2, true ),
          position: readPoint( data.position ), direction: direction( data.direction ),
          times: list( data.times, times.length, times.length ).map( value => bounded( value, 60 ) ),
          hopDelta: readPoint( data.hopDelta ), hopStart: readPoint( data.hopStart )
        };
      } );
      if ( new Set( recessive ).size !== recessive.length || recessive.some( i => !animals[ i ].alive || animals[ i ].mutation < 0 ) ) {
        throw new Error( 'Invalid Natural Selection recessive mutants.' );
      }
      const wolfData = list( state.wolvesInField, maxPopulation ).map( input => {
        const data = object( input );
        return { position: readPoint( data.position ), direction: direction( data.direction ), speed: bounded( data.speed, 1e5 ) };
      } );
      const graphs = list( state.population, series.length, series.length ).map( values =>
        list( values, 4 * maxGeneration + 4 ).map( value => {
          const coordinates = list( value, 2, 2 );
          return new Vector2( bounded( coordinates[ 0 ], maxGeneration + 1 ), bounded( coordinates[ 1 ], 4 * maxPopulation, true ) );
        } ) );
      const history = list( state.previousCounts, maxGeneration + 1, generation ).map( ( input, i ) => {
        const counts = list( input, 2, 2 );
        return new ProportionsCounts( i, readCounts( counts[ 0 ] ), readCounts( counts[ 1 ] ) );
      } );
      const startCounts = state.startCounts === null ? null : readCounts( state.startCounts );
      if ( !startCounts && generation !== 0 ) { throw new Error( 'Missing Natural Selection graph data.' ); }
      return () => {
        view.interruptSubtreeInput();
        model.startOver();
        model.isPlayingProperty.value = false;
        bunnies.reset();
        geneState.forEach( apply => apply() );
        const restored: Bunny[] = [];
        animals.forEach( data => {
          const father = data.parents[ 0 ] === null ? null : restored[ data.parents[ 0 ] ];
          const mother = data.parents[ 1 ] === null ? null : restored[ data.parents[ 1 ] ];
          const bunny = bunnies.createBunny( {
            father: father ?? mother, mother: mother ?? father, generation: data.generation,
            genotypeOptions: {
              fatherFurAllele: data.alleles[ 0 ][ 0 ], motherFurAllele: data.alleles[ 0 ][ 1 ],
              fatherEarsAllele: data.alleles[ 1 ][ 0 ], motherEarsAllele: data.alleles[ 1 ][ 1 ],
              fatherTeethAllele: data.alleles[ 2 ][ 0 ], motherTeethAllele: data.alleles[ 2 ][ 1 ]
            }
          } );
          bunny.positionProperty.value = data.position;
          bunny.xDirectionProperty.value = data.direction;
          bunny[ '_father' ] = father;
          bunny[ '_mother' ] = mother;
          bunny.genotype[ '_mutation' ] = genes[ data.mutation ]?.mutantAllele ?? null;
          bunny.age = data.age;
          times.forEach( ( key, i ) => { bunny[ key ] = data.times[ i ]; } );
          bunny[ 'hopDelta' ] = data.hopDelta;
          bunny[ 'hopStartPosition' ] = data.hopStart;
          restored.push( bunny );
        } );
        animals.forEach( ( data, i ) => { if ( !data.alive ) { restored[ i ].die(); } } );
        recessive.forEach( i => bunnies[ 'recessiveMutants' ].push( restored[ i ] ) );
        bunnies.selectedBunnyProperty.value = selected === null ? null : restored[ selected ];
        // The simulation's clock listeners distinguish state restoration from a generation transition.
        // Changing the clock without this guard would age, mate, or starve the restored population.
        const restoreGuard = writableIsSettingPhetioStateProperty.value;
        writableIsSettingPhetioStateProperty.value = true;
        try {
          time.value = seconds;
          apply();
          applyTiming();
        }
        finally { writableIsSettingPhetioStateProperty.value = restoreGuard; }
        const xMax = Math.max( population.xAxisLength, clock.timeInGenerationsProperty.value );
        population.xRangeProperty.value = new Range( xMax - population.xAxisLength, xMax );
        series.forEach( ( values, i ) => {
          values.clear();
          graphs[ i ].forEach( point => values.push( point ) );
        } );
        past.clear();
        history.forEach( counts => past.push( counts ) );
        proportions.proportionsGenerationProperty.setValueAndRange( graphGeneration, new Range( 0, generation ) );
        start.value = startCounts;
        wolves.clear();
        wolfData.forEach( data => {
          const wolf = wolves.createNextElement();
          wolf.positionProperty.value = data.position;
          wolf.xDirectionProperty.value = data.direction;
          wolf[ '_speed' ] = data.speed;
        } );
      };
    }
  };
}

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-natural-selection/v1',
    build: 'natural-selection@1.6.0-dev.2-webwriter.1',
    screens: [ bindScreen( sim.simScreens[ 0 ], 'intro' ), bindScreen( sim.simScreens[ 1 ], 'lab' ) ]
  } ) );
}
