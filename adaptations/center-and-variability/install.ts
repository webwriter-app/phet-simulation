// Center and Variability WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type KickDistributionStrategy from '../../../soccer-common/js/model/KickDistributionStrategy.js';
import { SoccerBallPhase } from '../../../soccer-common/js/model/SoccerBallPhase.js';
import CAVConstants, { MAX_KICKS_PROPERTY, SHOW_OUTLIERS_PROPERTY } from '../common/CAVConstants.js';
import type CAVModel from '../common/model/CAVModel.js';
import type CAVSoccerSceneModel from '../common/model/CAVSoccerSceneModel.js';
import MeanAndMedianModel from '../mean-and-median/model/MeanAndMedianModel.js';
import MedianModel from '../median/model/MedianModel.js';
import VariabilityModel from '../variability/model/VariabilityModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

function sceneState( scene: CAVSoccerSceneModel ) {
  // The sim chooses the direction of random skew separately for each scene.
  const strategy = ( scene as unknown as { kickDistributionStrategy: KickDistributionStrategy } ).kickDistributionStrategy;
  const ballsWithData = () => scene.soccerBalls.filter( ball =>
    ball.valueProperty.value !== null || ball.soccerBallPhaseProperty.value === SoccerBallPhase.FLYING );

  return {
    ballsWithData,
    read: () => ( {
      // Keep the landing target of a kick in progress and restore it as settled data.
      values: ballsWithData().map( ball => ball.valueProperty.value ?? ball.targetXProperty.value ),
      queuedKicks: scene.numberOfQueuedKicksProperty.value,
      skew: strategy.skewType
    } ),
    isPlaying: () => scene.numberOfQueuedKicksProperty.value > 0 || scene.soccerBalls.some( ball =>
      ball.soccerBallPhaseProperty.value === SoccerBallPhase.FLYING || ball.soccerBallPhaseProperty.value === SoccerBallPhase.STACKING ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const { values, queuedKicks, skew } = state;
      if ( !Array.isArray( values ) || values.length > scene.soccerBalls.length ||
           !values.every( value => Number.isInteger( value ) && scene.physicalRange.contains( value ) ) ||
           typeof queuedKicks !== 'number' || !Number.isInteger( queuedKicks ) || queuedKicks < 0 ||
           queuedKicks + values.length > scene.soccerBalls.length ||
           ( strategy.type === 'randomSkew' || strategy.type === 'skew' ?
             skew !== 'left' && skew !== 'right' : skew !== null ) ) {
        throw new Error( 'Invalid soccer data.' );
      }
      return {
        count: values.length,
        apply: () => {
          strategy.skewType = skew === 'left' || skew === 'right' ? skew : null;
          scene.setDataPoints( values.slice() );
          scene.scheduleKicks( queuedKicks );
        }
      };
    }
  };
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as CAVModel;
  const scenes = model.sceneModels.map( sceneState );
  const controls = {
    scene: field( model.selectedSceneModelProperty, scene => model.sceneModels.indexOf( scene ),
      value => typeof value === 'number' && Number.isInteger( value ) ? model.sceneModels[ value ] : undefined ),
    playAreaMedian: boolean( model.isPlayAreaMedianVisibleProperty ),
    playAreaMean: boolean( model.isPlayAreaMeanVisibleProperty ),
    predictMedian: boolean( model.isPredictMedianVisibleProperty ),
    predictedMedian: number( model.predictMedianValueProperty ),
    graphExpanded: boolean( model.isAccordionBoxExpandedProperty ),
    dataPoints: boolean( model.isDataPointLayerVisibleProperty ),
    ...( model instanceof MedianModel ? {
      sort: boolean( model.isSortingDataProperty ),
      median: boolean( model.medianVisibleProperty )
    } : {} ),
    ...( model instanceof MeanAndMedianModel ? {
      median: boolean( model.isMedianVisibleProperty ),
      mean: boolean( model.isMeanVisibleProperty ),
      predictMean: boolean( model.isPredictMeanVisibleProperty ),
      predictedMean: number( model.predictMeanValueProperty )
    } : {} ),
    ...( model instanceof VariabilityModel ? {
      measure: enumeration( model.selectedVariabilityMeasureProperty ),
      range: boolean( model.isRangeVisibleProperty ),
      iqr: boolean( model.isIQRVisibleProperty ),
      mad: boolean( model.isMADVisibleProperty ),
      pointer: boolean( model.isPointerVisibleProperty ),
      pointerValue: number( model.pointerValueProperty, false, value => CAVConstants.VARIABILITY_DRAG_RANGE.contains( value ) ),
      interval: boolean( model.intervalToolModel.isVisibleProperty ),
      intervalStart: number( model.intervalToolModel.handle1ValueProperty ),
      intervalEnd: number( model.intervalToolModel.handle2ValueProperty )
    } : {} )
  };
  const cards = model instanceof MedianModel ? model.interactiveCardContainerModel : null;

  return {
    isPlaying: () => scenes[ model.sceneModels.indexOf( model.selectedSceneModelProperty.value ) ].isPlaying(),
    read: () => {
      let cardOrder: number[] | null = null;
      if ( cards ) {
        const balls = scenes[ 0 ].ballsWithData();
        cardOrder = cards.getCardsInCellOrder().map( card => balls.findIndex( ball => ball === card.soccerBall ) ).filter( index => index >= 0 );
        balls.forEach( ( _, index ) => {
          if ( !cardOrder!.includes( index ) ) { cardOrder!.push( index ); }
        } );
      }
      return { controls: readFields( controls ), scenes: scenes.map( scene => scene.read() ), cardOrder };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state.controls );
      if ( !Array.isArray( state.scenes ) || state.scenes.length !== scenes.length ) {
        throw new Error( 'Invalid soccer scene count.' );
      }
      const sceneInputs = state.scenes;
      const preparedScenes = scenes.map( ( scene, i ) => scene.prepare( sceneInputs[ i ] ) );
      const { cardOrder } = state;
      if ( cards ?
           !Array.isArray( cardOrder ) || cardOrder.length !== preparedScenes[ 0 ].count ||
           new Set( cardOrder ).size !== cardOrder.length ||
           !cardOrder.every( index => Number.isInteger( index ) && index >= 0 && index < cardOrder.length ) :
           cardOrder !== null ) {
        throw new Error( 'Invalid soccer card order.' );
      }
      return () => {
        screen.view.interruptSubtreeInput();
        preparedScenes.forEach( scene => scene.apply() );
        applyControls();
        if ( cards && Array.isArray( cardOrder ) ) {
          cardOrder.map( index => cards.cards[ index ] ).filter( card => card.isActiveProperty.value ).forEach( ( card, index ) => {
            card.indexProperty.value = index;
            cards.setAtHomeCell( card );
          } );
          cards.cardCellsChangedEmitter.emit();
        }
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'median', 'mean-and-median', 'variability' ];
  const preferences = {
    plotType: enumeration( CAVConstants.PLOT_TYPE_PROPERTY ),
    maxKicks: number( MAX_KICKS_PROPERTY, true, value => CAVConstants.MAX_KICKS_VALUES.includes( value ) ),
    showOutliers: boolean( SHOW_OUTLIERS_PROPERTY )
  };
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-center-and-variability/v1',
    build: 'center-and-variability@1.3.0-dev.0-webwriter.1',
    readPreferences: () => readFields( preferences ),
    preparePreferences: input => prepareFields( preferences, input ),
    screens: sim.simScreens.map( ( screen, i ) => ( { id: ids[ i ], screen, ...screenState( screen ) } ) )
  } ) );
}
