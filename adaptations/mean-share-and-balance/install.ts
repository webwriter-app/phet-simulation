// Mean, Share, and Balance WebWriter state adapter. Distributed under GPL-3.0.
import Utils from '../../../dot/js/Utils.js';
import type Sim from '../../../joist/js/Sim.js';
import Fraction from '../../../phetcommon/js/model/Fraction.js';
import type BalancePointModel from '../balance-point/model/BalancePointModel.js';
import { BalanceBeamEndpointYValues } from '../balance-point/model/BalancePointSceneModel.js';
import MeanShareAndBalanceConstants from '../common/MeanShareAndBalanceConstants.js';
import type DistributeModel from '../distribute/model/DistributeModel.js';
import type FairShareModel from '../fair-share/model/FairShareModel.js';
import { WATER_LEVEL_ROUNDING_INTERVAL } from '../level-out/model/Cup.js';
import type LevelOutModel from '../level-out/model/LevelOutModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields } from './stateFields.js';

function values( input: unknown, minLength: number, maxLength: number, min: number, max: number, integer = false ): number[] {
  if ( !Array.isArray( input ) || input.length < minLength || input.length > maxLength ||
       !input.every( value => typeof value === 'number' && Number.isFinite( value ) &&
         value >= min && value <= max && ( !integer || Number.isInteger( value ) ) ) ) {
    throw new Error( 'Invalid sharing or balance data.' );
  }
  return input;
}

function tableSnacks( model: DistributeModel | FairShareModel ): number[] {
  return model.getActivePlates().map( plate => plate.tableSnackNumberProperty.value );
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const [ levelScreen, distributeScreen, shareScreen, balanceScreen ] = sim.simScreens;
    const level = levelScreen.model as LevelOutModel;
    const distribute = distributeScreen.model as DistributeModel;
    const share = shareScreen.model as FairShareModel;
    const balance = balanceScreen.model as BalancePointModel;
    const scene = balance.selectedSceneModelProperty.value;
    const maxSnacks = MeanShareAndBalanceConstants.MAX_NUMBER_OF_SNACKS_PER_PLATE;

    const levelFields = {
      pipesOpen: boolean( level.pipesOpenProperty ),
      prediction: number( level.meanPredictionProperty ),
      predictionVisible: boolean( level.predictMeanVisibleProperty ),
      tickMarks: boolean( level.tickMarksVisibleProperty )
    };
    const distributeFields = {
      meanInfo: boolean( distribute.meanInfoPanelVisibleProperty ),
      total: boolean( distribute.totalVisibleProperty ),
      prediction: number( distribute.meanPredictionProperty ),
      predictionVisible: boolean( distribute.predictMeanVisibleProperty )
    };
    const shareFields = {
      mode: enumeration( share.appleDistributionModeProperty ),
      meanInfo: boolean( share.meanInfoPanelVisibleProperty ),
      total: boolean( share.totalVisibleProperty )
    };
    const balanceFields = {
      fixed: boolean( balance.meanFulcrumFixedProperty ),
      fulcrum: number( scene.meanPredictionFulcrumValueProperty ),
      fulcrumWasDragged: boolean( balance.fulcrumWasDraggedProperty ),
      supports: boolean( scene.beamSupportsPresentProperty ),
      tickMarks: boolean( balance.tickMarksVisibleProperty ),
      meanInfo: boolean( balance.meanInfoPanelVisibleProperty ),
      total: boolean( balance.totalVisibleProperty )
    };

    return {
      bridge: 'webwriter-mean-share-and-balance/v1',
      build: 'mean-share-and-balance@1.2.0-dev.0-webwriter.1',
      screens: [ {
        id: 'level-out',
        screen: levelScreen,
        isPlaying: () => level.getActiveNotepadCups().some( ( cup, index ) =>
          cup.waterLevelProperty.value !== ( level.pipesOpenProperty.value ?
            Utils.roundToInterval( level.meanValueProperty.value, WATER_LEVEL_ROUNDING_INTERVAL ) : level.tableCups[ index ].waterLevelProperty.value ) ) ||
          level.getActivePipes().some( pipe => pipe.rotationProperty.value !== ( level.pipesOpenProperty.value ? Math.PI / 2 : 0 ) ),
        read: () => ( {
          ...readFields( levelFields ),
          table: level.getActiveTableCups().map( cup => cup.waterLevelProperty.value ),
          notepad: level.getActiveNotepadCups().map( cup => cup.waterLevelProperty.value ),
          valves: level.getActivePipes().map( pipe => pipe.rotationProperty.value )
        } ),
        prepare: input => {
          const state = object( input );
          const applyFields = prepareFields( levelFields, state );
          const table = values( state.table, 1, level.numberOfCupsRangeProperty.value.max, 0, 1 );
          const notepad = values( state.notepad, table.length, table.length, 0, 1 );
          const valves = values( state.valves, table.length - 1, table.length - 1, 0, Math.PI / 2 );
          return () => {
            level.setDataPoints( table );
            applyFields();
            notepad.forEach( ( value, index ) => { level.notepadCups[ index ].waterLevelProperty.value = value; } );
            valves.forEach( ( value, index ) => { level.pipeArray[ index ].rotationProperty.value = value; } );
          };
        }
      }, {
        id: 'distribute',
        screen: distributeScreen,
        read: () => ( {
          ...readFields( distributeFields ),
          table: tableSnacks( distribute ),
          stacks: distribute.getActivePlates().map( plate => plate.getNumberOfNotepadSnacks() )
        } ),
        prepare: input => {
          const state = object( input );
          const applyFields = prepareFields( distributeFields, state );
          const table = values( state.table, 1, distribute.numberOfPlatesRangeProperty.value.max, 0, maxSnacks, true );
          const stacks = values( state.stacks, table.length, table.length, 0, maxSnacks, true );
          if ( stacks.reduce( ( sum, count ) => sum + count, 0 ) !== table.reduce( ( sum, count ) => sum + count, 0 ) ) {
            throw new Error( 'The notepad and table must contain the same number of snacks.' );
          }
          return () => {
            distribute[ 'setPlateValues' ]( table );
            distribute.allSnacks.forEach( snack => {
              snack.forceAnimationToFinish();
              snack.draggingProperty.value = false;
            } );
            distribute.plates.forEach( plate => plate.removeAllSnacks() );
            stacks.forEach( ( count, index ) => distribute.plates[ index ].setNotepadSnacksToValue( new Fraction( count, 1 ) ) );
            distribute.stackChangedEmitter.emit();
            applyFields();
          };
        }
      }, {
        id: 'fair-share',
        screen: shareScreen,
        read: () => ( { ...readFields( shareFields ), table: tableSnacks( share ) } ),
        prepare: input => {
          const state = object( input );
          const applyFields = prepareFields( shareFields, state );
          const table = values( state.table, 1, share.numberOfPlatesRangeProperty.value.max, 0, maxSnacks, true );
          return () => {
            share[ 'setPlateValues' ]( table );
            applyFields();
            share[ 'finishInProgressAnimations' ]();
          };
        }
      }, {
        id: 'balance-point',
        screen: balanceScreen,
        isPlaying: () => !scene.isBeamInTargetPosition() ||
          scene.getSortedStackedObjects().length < scene.targetNumberOfBallsProperty.value,
        read: () => {
          const endpoints = scene.balanceBeamEndpointYValuesProperty.value;
          return {
            ...readFields( balanceFields ),
            balls: scene.soccerBalls.map( ball => ball.valueProperty.value ).filter( value => value !== null ),
            targetCount: scene.targetNumberOfBallsProperty.value,
            beam: [ endpoints.left, endpoints.right ]
          };
        },
        prepare: input => {
          const state = object( input );
          const applyFields = prepareFields( balanceFields, state );
          const range = MeanShareAndBalanceConstants.SOCCER_BALL_RANGE;
          const balls = values( state.balls, 0, scene.maxKicksProperty.value, range.min, range.max );
          const [ targetCount ] = values( [ state.targetCount ], 1, 1, balls.length, scene.maxKicksProperty.value, true );
          const [ left, right ] = values( state.beam, 2, 2, -100, 100 );
          return () => {
            scene.setDataPoints( balls );
            scene.targetNumberOfBallsProperty.value = targetCount;
            scene.numberOfQueuedKicksProperty.value = targetCount - balls.length;
            applyFields();
            scene.balanceBeamEndpointYValuesProperty.value = new BalanceBeamEndpointYValues( left, right );
          };
        }
      } ]
    };
  } );
}
