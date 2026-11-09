// Build a Nucleus WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import AtomInfoUtils from '../../../shred/js/AtomInfoUtils.js';
import BANConstants from '../common/BANConstants.js';
import type ChartIntroModel from '../chart-intro/model/ChartIntroModel.js';
import ChartIntroScreenView from '../chart-intro/view/ChartIntroScreenView.js';
import type DecayModel from '../decay/model/DecayModel.js';
import type DecayScreenView from '../decay/view/DecayScreenView.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, object, prepareFields, readFields } from './stateFields.js';

const screenIds = [ 'decay', 'chart-intro' ];

function screenState( screen: Sim[ 'simScreens' ][ number ] ) {
  const model = screen.model as DecayModel | ChartIntroModel;
  const view = screen.view as DecayScreenView | ChartIntroScreenView;
  const chartView = view instanceof ChartIntroScreenView ? view : null;
  const chartModel = chartView && model as ChartIntroModel;
  const fields = chartView && chartModel ? {
    chart: field( chartModel.selectedNuclideChartProperty, value => value,
      value => value === 'partial' || value === 'zoom' ? value : undefined ),
    magicNumbers: boolean( chartView[ 'showMagicNumbersProperty' ] ),
    chartExpanded: boolean( chartView[ 'nuclideChartAccordionBox' ].expandedProperty )
  } : {
    symbolExpanded: boolean( ( view as DecayScreenView )[ 'symbolAccordionBox' ].expandedProperty ),
    electronCloud: boolean( ( view as DecayScreenView )[ 'showElectronCloudCheckbox' ][ 'showElectronCloudBooleanProperty' ] )
  };
  const readCount = ( value: unknown, max: number ) =>
    typeof value === 'number' && Number.isInteger( value ) && value >= 0 && value <= max;
  return {
    isPlaying: () => model.hasIncomingParticlesProperty.value || view[ 'timeSinceCountdownStarted' ] > 0,
    read: () => ( {
      ...readFields( fields ),
      protons: model.particleAtom.protonCountProperty.value,
      neutrons: model.particleAtom.neutronCountProperty.value,
      previousProtons: view[ 'previousProtonNumber' ],
      previousNeutrons: view[ 'previousNeutronNumber' ],
      correctionTime: view[ 'timeSinceCountdownStarted' ]
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const { protons, neutrons, previousProtons, previousNeutrons, correctionTime } = state;
      if ( !readCount( protons, model.protonNumberRange.max ) || !readCount( neutrons, model.neutronNumberRange.max ) ||
           !readCount( previousProtons, model.protonNumberRange.max ) || !readCount( previousNeutrons, model.neutronNumberRange.max ) ||
           typeof correctionTime !== 'number' || !Number.isFinite( correctionTime ) || correctionTime < 0 ) {
        throw new Error( 'Invalid nucleus state.' );
      }
      const applyFields = prepareFields( fields, state );
      const previousExists = ( previousProtons === 0 && previousNeutrons === 0 ) ||
                             AtomInfoUtils.doesExist( previousProtons as number, previousNeutrons as number );
      return () => {
        view.interruptSubtreeInput();
        model.reset();
        model.populateAtom( protons as number, neutrons as number );
        view.hideUndoButtonEmitter.emit();
        view[ 'correctingNonexistentNuclide' ] = true;
        view[ 'previousProtonNumber' ] = previousExists ? previousProtons as number : 0;
        view[ 'previousNeutronNumber' ] = previousExists ? previousNeutrons as number : 0;
        view[ 'timeSinceCountdownStarted' ] = Math.min( correctionTime, BANConstants.TIME_TO_SHOW_DOES_NOT_EXIST );
        applyFields();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-build-a-nucleus/v1',
    build: 'build-a-nucleus@1.2.0-dev.1-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( { id: screenIds[ index ], screen, ...screenState( screen ) } ) )
  } ) );
}
