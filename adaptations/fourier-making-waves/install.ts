// Fourier: Making Waves WebWriter adapter. Distributed under GPL-3.0.
import DerivedProperty from '../../../axon/js/DerivedProperty.js';
import Range from '../../../dot/js/Range.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Sim from '../../../joist/js/Sim.js';
import Node from '../../../scenery/js/nodes/Node.js';
import RectangularPushButton from '../../../sun/js/buttons/RectangularPushButton.js';
import FMWConstants from '../common/FMWConstants.js';
import Domain from '../common/model/Domain.js';
import FourierSeries from '../common/model/FourierSeries.js';
import SeriesType from '../common/model/SeriesType.js';
import DiscreteAxisDescriptions from '../discrete/model/DiscreteAxisDescriptions.js';
import DiscreteModel from '../discrete/model/DiscreteModel.js';
import Waveform from '../discrete/model/Waveform.js';
import PeriodCalipersNode from '../discrete/view/PeriodCalipersNode.js';
import PeriodClockNode from '../discrete/view/PeriodClockNode.js';
import WavelengthCalipersNode from '../discrete/view/WavelengthCalipersNode.js';
import WaveGameLevel from '../waveGame/model/WaveGameLevel.js';
import WaveGameModel from '../waveGame/model/WaveGameModel.js';
import WaveGameScreenView from '../waveGame/view/WaveGameScreenView.js';
import WavePacketAxisDescriptions from '../wavepacket/model/WavePacketAxisDescriptions.js';
import WavePacketModel from '../wavepacket/model/WavePacketModel.js';
import ComponentSpacingToolNode from '../wavepacket/view/ComponentSpacingToolNode.js';
import WavePacketLengthToolNode from '../wavepacket/view/WavePacketLengthToolNode.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

const screenIds = [ 'discrete', 'wave-game', 'wave-packet' ];
const waveforms = new Map( [
  [ 'sinusoid', Waveform.SINUSOID ], [ 'triangle', Waveform.TRIANGLE ], [ 'square', Waveform.SQUARE ],
  [ 'sawtooth', Waveform.SAWTOOTH ], [ 'wave-packet', Waveform.WAVE_PACKET ], [ 'custom', Waveform.CUSTOM ]
] );

function findNode<T extends Node>( node: Node, matches: ( node: Node ) => node is T ): T | undefined {
  if ( matches( node ) ) { return node; }
  for ( const child of node.children ) {
    const match = findNode( child, matches );
    if ( match ) { return match; }
  }
  return undefined;
}

function indexed<T>( property: { value: T }, values: readonly T[] ) {
  return field( property, value => values.indexOf( value ),
    value => typeof value === 'number' && Number.isInteger( value ) ? values[ value ] : undefined );
}

function amplitudes( input: unknown, series: FourierSeries ): number[] {
  if ( !Array.isArray( input ) || input.length !== series.harmonics.length ||
       !input.every( ( value, i ) => Number.isFinite( value ) && series.harmonics[ i ].amplitudeProperty.range.contains( value ) ) ) {
    throw new Error( 'Invalid Fourier harmonic amplitudes.' );
  }
  return input.slice();
}

function chartFields( amplitudes: { chartExpandedProperty: { value: boolean } },
                      components: { chartExpandedProperty: { value: boolean } },
                      sum: { chartExpandedProperty: { value: boolean } } ) {
  return {
    amplitudesExpanded: boolean( amplitudes.chartExpandedProperty ),
    componentsExpanded: boolean( components.chartExpandedProperty ),
    sumExpanded: boolean( sum.chartExpandedProperty )
  };
}

function discreteState( screen: AnyScreen, model: DiscreteModel ) {
  const series = model.fourierSeries;
  const wavelength = findNode( screen.view, ( node ): node is WavelengthCalipersNode => node instanceof WavelengthCalipersNode )!;
  const period = findNode( screen.view, ( node ): node is PeriodCalipersNode => node instanceof PeriodCalipersNode )!;
  const clock = findNode( screen.view, ( node ): node is PeriodClockNode => node instanceof PeriodClockNode )!;
  const fields = {
    seriesType: enumeration( model.seriesTypeProperty ),
    waveform: field( model.waveformProperty, value => [ ...waveforms ].find( ( [ , waveform ] ) => waveform === value )![ 0 ],
      value => typeof value === 'string' ? waveforms.get( value ) : undefined ),
    domain: enumeration( model.domainProperty ),
    equationForm: enumeration( model.equationFormProperty ),
    harmonicCount: number( series.numberOfHarmonicsProperty, true ),
    zoom: indexed( model.sumChart.xAxisDescriptionProperty, DiscreteAxisDescriptions.X_AXIS_DESCRIPTIONS ),
    infiniteHarmonics: boolean( model.sumChart.infiniteHarmonicsVisibleProperty ),
    ...chartFields( model.amplitudesChart, model.harmonicsChart, model.sumChart ),
    wavelengthSelected: boolean( model.wavelengthTool.isSelectedProperty ),
    periodSelected: boolean( model.periodTool.isSelectedProperty ),
    wavelengthPosition: vector( wavelength.positionProperty ),
    periodPosition: vector( period.positionProperty ),
    clockPosition: vector( clock.positionProperty ),
    time: number( model.tProperty, false, value => value >= 0 ),
    playing: boolean( model.isPlayingProperty )
  };
  return {
    isPlaying: () => model.isPlayingProperty.value && model.domainProperty.value === Domain.SPACE_AND_TIME,
    read: () => ( {
      ...readFields( fields ),
      wavelengthOrder: model.wavelengthTool.orderProperty.value,
      periodOrder: model.periodTool.orderProperty.value,
      amplitudes: series.amplitudesProperty.value.slice()
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const values = amplitudes( state.amplitudes, series );
      const count = state.harmonicCount as number;
      const order = ( value: unknown ) => {
        if ( typeof value !== 'number' || !Number.isInteger( value ) || value < 1 || value > count ) {
          throw new Error( 'Invalid Fourier measurement tool order.' );
        }
        return value;
      };
      const wavelengthOrder = order( state.wavelengthOrder );
      const periodOrder = order( state.periodOrder );
      if ( state.waveform === 'sawtooth' && state.seriesType === String( SeriesType.COS ) ) {
        throw new Error( 'Sawtooth waves require sines.' );
      }
      return () => {
        screen.view.interruptSubtreeInput();
        // Leave any previous waveform preset before changing series type.
        model.waveformProperty.value = Waveform.CUSTOM;
        apply();
        model.wavelengthTool.orderProperty.value = wavelengthOrder;
        model.periodTool.orderProperty.value = periodOrder;
        series.setAmplitudes( values );
      };
    }
  };
}

function packetState( screen: AnyScreen, model: WavePacketModel ) {
  const spacing = findNode( screen.view, ( node ): node is ComponentSpacingToolNode => node instanceof ComponentSpacingToolNode )!;
  const length = findNode( screen.view, ( node ): node is WavePacketLengthToolNode => node instanceof WavePacketLengthToolNode )!;
  const packet = model.wavePacket;
  const fields = {
    domain: enumeration( model.domainProperty ),
    seriesType: enumeration( model.seriesTypeProperty ),
    spacing: number( packet.componentSpacingProperty, false, value => packet.componentSpacingProperty.validValues!.includes( value ) ),
    center: number( packet.centerProperty ),
    deviation: number( packet.standardDeviationProperty ),
    widthIndicators: boolean( model.widthIndicatorsVisibleProperty ),
    continuousWaveform: boolean( model.amplitudesChart.continuousWaveformVisibleProperty ),
    envelope: boolean( model.sumChart.waveformEnvelopeVisibleProperty ),
    zoom: indexed( model.sumChart.xAxisDescriptionProperty, WavePacketAxisDescriptions.X_AXIS_DESCRIPTIONS ),
    ...chartFields( model.amplitudesChart, model.componentsChart, model.sumChart ),
    spacingTool: boolean( spacing.visibleProperty ),
    spacingPosition: vector( spacing[ 'positionProperty' ] ),
    lengthTool: boolean( length.visibleProperty ),
    lengthPosition: vector( length[ 'positionProperty' ] )
  };
  return {
    read: () => readFields( fields ),
    prepare: ( input: unknown ) => {
      const apply = prepareFields( fields, input );
      return () => {
        screen.view.interruptSubtreeInput();
        apply();
      };
    }
  };
}

function enabledDependency<T>( node: Node, name: string, index: number ): { value: T } {
  const button = node.pdomOrder?.find( child => child instanceof RectangularPushButton && child.tandem.name === name );
  const enabled = button instanceof RectangularPushButton ? button[ 'buttonModel' ].enabledProperty : null;
  if ( !( enabled instanceof DerivedProperty ) ) {
    throw new Error( 'Missing Fourier game button state.' );
  }
  return enabled[ 'dependencies' ]![ index ] as unknown as { value: T };
}

function levelState( level: WaveGameLevel, view: Node ) {
  const guessChanged = enabledDependency<boolean>( view, 'checkAnswerButton', 1 );
  const checks = enabledDependency<number>( view, 'showAnswerButton', 0 );
  const fields = {
    score: number( level.scoreProperty, true, value => value >= 0 ),
    solved: boolean( level.isSolvedProperty ),
    guessChanged: boolean( guessChanged ),
    checks: number( checks, true, value => value >= 0 ),
    ...chartFields( level.amplitudesChart, level.harmonicsChart, level.sumChart )
  };
  return {
    read: () => ( {
      ...readFields( fields ),
      answer: level.answerSeries.amplitudesProperty.value.slice(),
      guess: level.guessSeries.amplitudesProperty.value.slice(),
      controls: level.numberOfAmplitudeControlsProperty.value
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const answer = amplitudes( state.answer, level.answerSeries );
      const guess = amplitudes( state.guess, level.guessSeries );
      const required = answer.filter( value => value !== 0 ).length;
      const controls = state.controls;
      if ( typeof controls !== 'number' || !Number.isInteger( controls ) ||
           required < level.levelNumber || controls < required || controls > FMWConstants.MAX_HARMONICS ) {
        throw new Error( 'Invalid Fourier game amplitude controls.' );
      }
      return () => {
        level.answerSeries.setAmplitudes( answer );
        level.guessSeries.setAmplitudes( guess );
        level.numberOfAmplitudeControlsProperty.setValueAndRange( controls, new Range( required, FMWConstants.MAX_HARMONICS ) );
        level.newWaveformEmitter.emit();
        apply();
      };
    }
  };
}

function gameState( screen: AnyScreen, model: WaveGameModel ) {
  const view = screen.view as WaveGameScreenView;
  const levels = model.levels.map( ( level, i ) => levelState( level, view[ 'levelNodes' ][ i ] ) );
  const fields = {
    level: indexed( model.levelProperty, [ null, ...model.levels ] )
  };
  return {
    read: () => ( { ...readFields( fields ), levels: levels.map( level => level.read() ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const apply = prepareFields( fields, state );
      const saved = state.levels;
      if ( !Array.isArray( saved ) || saved.length !== levels.length ) {
        throw new Error( 'Invalid Fourier game levels.' );
      }
      const restore = levels.map( ( level, i ) => level.prepare( saved[ i ] ) );
      return () => {
        view.interruptSubtreeInput();
        restore.forEach( apply => apply() );
        apply();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-fourier-making-waves/v1',
    build: 'fourier-making-waves@1.2.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => {
      const model = screen.model as DiscreteModel | WaveGameModel | WavePacketModel;
      return {
        id: screenIds[ index ], screen,
        ...( model instanceof DiscreteModel ? discreteState( screen, model ) :
          model instanceof WavePacketModel ? packetState( screen, model ) : gameState( screen, model ) )
      };
    } )
  } ) );
}
