// State adapter for PhET Normal Modes. Distributed under GPL-3.0.
import type NumberProperty from '../../../axon/js/NumberProperty.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import NormalModesConstants from '../common/NormalModesConstants.js';
import OneDimensionModel from '../one-dimension/model/OneDimensionModel.js';
import type TwoDimensionsModel from '../two-dimensions/model/TwoDimensionsModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields } from './stateFields.js';

function bindScreen( screen: AnyScreen ) {
  const model = screen.model as OneDimensionModel | TwoDimensionsModel;
  const one = model instanceof OneDimensionModel;
  const controls = {
    masses: number( model.numberOfMassesProperty, true ),
    springs: boolean( model.springsVisibleProperty ),
    arrows: boolean( model.arrowsVisibleProperty ),
    timeSpeed: enumeration( model.timeSpeedProperty ),
    direction: enumeration( model.amplitudeDirectionProperty ),
    ...( one ? { phasesVisible: boolean( model.phasesVisibleProperty ) } : {} )
  };
  const timing = { time: number( model.timeProperty, false, value => value >= 0 ) };
  const playing = boolean( model.playingProperty );
  const amplitudes: NumberProperty[] = one ? model.modeAmplitudeProperties :
    [ ...model.modeXAmplitudeProperties.flat(), ...model.modeYAmplitudeProperties.flat() ];
  const phases: NumberProperty[] = one ? model.modePhaseProperties :
    [ ...model.modeXPhaseProperties.flat(), ...model.modeYPhaseProperties.flat() ];
  const prepareArray = ( properties: NumberProperty[], input: unknown, label: string ) => {
    if ( !Array.isArray( input ) || input.length !== properties.length ) {
      throw new Error( `Invalid Normal Modes ${label}.` );
    }
    return properties.map( ( property, index ) => number( property ).prepare( input[ index ], label ) );
  };
  return {
    id: one ? 'one-dimension' : 'two-dimensions',
    screen,
    isPlaying: () => model.playingProperty.value && amplitudes.some( property => property.value !== 0 ),
    read: () => ( {
      ...readFields( controls ),
      ...readFields( timing ),
      playing: playing.read(),
      remainder: model.dt,
      amplitudes: amplitudes.map( property => property.value ),
      phases: phases.map( property => property.value )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state );
      const applyTiming = prepareFields( timing, state );
      const applyPlaying = playing.prepare( state.playing, 'playing' );
      const applyAmplitudes = prepareArray( amplitudes, state.amplitudes, 'amplitude' );
      const applyPhases = prepareArray( phases, state.phases, 'phase' );
      const dt = state.remainder;
      if ( typeof dt !== 'number' || !Number.isFinite( dt ) || dt < 0 || dt >= NormalModesConstants.FIXED_DT ) {
        throw new Error( 'Invalid Normal Modes integration remainder.' );
      }
      return () => {
        screen.view.interruptSubtreeInput();
        model.playingProperty.value = false;
        if ( one ) { model.draggingMassIndexProperty.reset(); }
        else { model.draggingMassIndexesProperty.reset(); }
        applyControls();
        applyAmplitudes.forEach( apply => apply() );
        applyPhases.forEach( apply => apply() );
        applyTiming();
        model.dt = dt;
        model.step( 0 );
        applyPlaying();
      };
    }
  };
}

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-normal-modes/v1',
    build: 'normal-modes@1.1.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( bindScreen )
  } ) );
}
