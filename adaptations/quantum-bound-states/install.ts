// State adapter for PhET Quantum Bound States. Distributed under GPL-3.0.
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import type QBSModel from '../common/model/QBSModel.js';
import QBSPreferences from '../common/model/QBSPreferences.js';
import ManyWellsModel from '../many-wells/model/ManyWellsModel.js';
import OneWellModel from '../one-well/model/OneWellModel.js';
import SuperpositionModel from '../superposition/model/SuperpositionModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, prepareFields, readFields, vector } from './stateFields.js';

function bindScreen( screen: AnyScreen, id: string ) {
  const model = screen.model as QBSModel;
  const time = model.time;
  const wave = model.waveFunctionGraph;
  const graphs = model.quantumStateGraphProperty.validValues!;
  const potentials = model.potentialProperty.validValues!;
  const fields = {
    potential: field( model.potentialProperty, value => value.tandemPrefix,
      input => potentials.find( potential => potential.tandemPrefix === input ) ),
    energyLevel: number( model.energyLevelProperty, true ),
    graph: field( model.quantumStateGraphProperty, value => graphs.indexOf( value ),
      input => typeof input === 'number' && Number.isInteger( input ) ? graphs[ input ] : undefined ),
    curves: boolean( model.curvesVisibleProperty ),
    energyValues: boolean( model.energyDiagram.valuesVisibleProperty ),
    realPart: boolean( wave.realPartVisibleProperty ),
    imaginaryPart: boolean( wave.imaginaryPartVisibleProperty ),
    magnitude: boolean( wave.magnitudeVisibleProperty ),
    phase: boolean( wave.phaseVisibleProperty ),
    magnifier: boolean( model.magnifier.visibleProperty ),
    magnifierProbe: vector( model.magnifier.probePositionProperty ),
    magnifierBody: vector( model.magnifier.bodyPositionProperty ),
    referenceLine: boolean( model.referenceLine.visibleProperty ),
    referenceX: number( model.referenceLine.xProperty ),
    time: number( time[ '_currentTimeProperty' ], false, value => value >= 0 ),
    timeVisible: boolean( time.timeVisibleProperty ),
    timeScale: number( time.timeScaleProperty, true ),
    playing: boolean( time.isPlayingProperty ),
    ...( model instanceof OneWellModel ? { electronMasses: number( model.electronMassesProperty ) } : {} ),
    ...( model instanceof ManyWellsModel ? {
      wells: number( model.numberOfWellsProperty, true ),
      field: number( model.electricFieldProperty ),
      zoom: number( model.yAxisZoomLevelProperty, true )
    } : {} ),
    ...( model instanceof SuperpositionModel ? {
      configuration: enumeration( model.superpositionConfigurationTypeProperty ),
      preset: number( model.superpositionPresetProperty, true ),
      custom: number( model.superpositionCustomProperty, true )
    } : {} )
  };
  return {
    id,
    screen,
    isPlaying: () => time.isPlayingProperty.value,
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

export default function install( sim: Sim ) {
  installSimulationBridge( sim, () => {
    const phase = QBSPreferences.phaseCheckboxVisibleProperty;
    const preferences = {
      phaseCheckbox: field( phase, value => value ? 'shown' : 'hidden',
        input => input === 'shown' ? true : input === 'hidden' ? false : undefined )
    };
    const ids = [ 'one-well', 'two-wells', 'many-wells', 'superposition' ];
    return {
      bridge: 'webwriter-quantum-bound-states/v1',
      build: 'quantum-bound-states@1.0.0-dev.0-webwriter.1',
      screens: sim.simScreens.map( ( screen, i ) => bindScreen( screen, ids[ i ] ) ),
      readPreferences: () => readFields( preferences ),
      preparePreferences: input => prepareFields( preferences, input )
    };
  } );
}
