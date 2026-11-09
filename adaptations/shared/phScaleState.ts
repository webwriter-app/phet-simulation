// pH Scale WebWriter state bindings. Distributed under GPL-3.0.
import Vector2 from '../../../dot/js/Vector2.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type Sim from '../../../joist/js/Sim.js';
import type PHModel from '../../../ph-scale/js/common/model/PHModel.js';
import PHScalePreferences from '../../../ph-scale/js/common/model/PHScalePreferences.js';
import type Solution from '../../../ph-scale/js/common/model/Solution.js';
import GraphControlPanel from '../../../ph-scale/js/common/view/graph/GraphControlPanel.js';
import GraphNode from '../../../ph-scale/js/common/view/graph/GraphNode.js';
import GraphScaleSwitch from '../../../ph-scale/js/common/view/graph/GraphScaleSwitch.js';
import GraphUnitsSwitch from '../../../ph-scale/js/common/view/graph/GraphUnitsSwitch.js';
import LinearGraphNode from '../../../ph-scale/js/common/view/graph/LinearGraphNode.js';
import ParticleCountsNode from '../../../ph-scale/js/common/view/ParticleCountsNode.js';
import RatioNode from '../../../ph-scale/js/common/view/RatioNode.js';
import MacroModel from '../../../ph-scale/js/macro/model/MacroModel.js';
import MicroPHAccordionBox from '../../../ph-scale/js/micro/view/MicroPHAccordionBox.js';
import MySolutionModel from '../../../ph-scale/js/mysolution/model/MySolutionModel.js';
import MySolutionPHAccordionBox from '../../../ph-scale/js/mysolution/view/MySolutionPHAccordionBox.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import ExpandCollapseButton from '../../../sun/js/ExpandCollapseButton.js';
import type ToggleButtonModel from '../../../sun/js/buttons/ToggleButtonModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

function descendants( node: Node ): Node[] {
  return node.children.flatMap( child => [ child, ...descendants( child ) ] );
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as PHModel<Solution> | MySolutionModel;
  const fields: Parameters<typeof readFields>[ 0 ] = {};
  const nodes = descendants( screen.view );
  const ratio = nodes.find( node => node instanceof RatioNode );
  const counts = nodes.find( node => node instanceof ParticleCountsNode );
  const meter = nodes.find( node => node instanceof MicroPHAccordionBox || node instanceof MySolutionPHAccordionBox );
  const graph = nodes.find( node => node instanceof GraphNode );
  if ( ratio && counts && meter && graph ) {
    const panel = graph.children.find( node => node instanceof GraphControlPanel );
    const controls = panel ? descendants( panel ) : [];
    const units = controls.find( node => node instanceof GraphUnitsSwitch );
    const expanded = controls.find( node => node instanceof ExpandCollapseButton );
    const scale = graph.controlNodes.find( node => node instanceof GraphScaleSwitch );
    const linear = descendants( graph ).find( node => node instanceof LinearGraphNode );
    fields.ratio = boolean( ratio.visibleProperty );
    fields.particleCounts = boolean( counts.visibleProperty );
    fields.meterExpanded = boolean( meter[ 'expandedProperty' ] );
    if ( units && expanded ) {
      fields.graphUnits = enumeration( units[ 'property' ] );
      fields.graphExpanded = boolean( ( expanded[ 'buttonModel' ] as ToggleButtonModel<boolean> ).valueProperty );
    }
    if ( scale && linear ) {
      fields.graphScale = enumeration( scale[ 'property' ] );
      fields.graphExponent = number( linear.exponentProperty, true );
    }
  }

  if ( model instanceof MySolutionModel ) {
    fields.pH = number( model.solution.pHProperty );
    fields.volume = number( model.solution.totalVolumeProperty );
    return {
      read: () => readFields( fields ),
      prepare: ( input: unknown ) => prepareFields( fields, input )
    };
  }

  if ( model instanceof MacroModel ) {
    const probe = model.pHMeter.probe;
    fields.probe = field( probe.positionProperty, value => [ value.x, value.y ], value => {
      if ( !Array.isArray( value ) || value.length !== 2 || !value.every( Number.isFinite ) ) { return undefined; }
      const position = new Vector2( value[ 0 ], value[ 1 ] );
      return probe.dragBounds.containsPoint( position ) ? position : undefined;
    } );
    fields.probeJumpPosition = number( model.probeJumpPositionIndexProperty, true, index => index >= 0 && index < model.probeJumpPositions.length );
  }

  const solution = model.solution as Solution;
  fields.solute = field( solution.soluteProperty, value => value.tandemName, value => model.solutes.find( solute => solute.tandemName === value ) );
  fields.autofilling = boolean( model.isAutofillingProperty );
  return {
    isPlaying: () => model.isAutofillingProperty.value || model.dropper.flowRateProperty.value > 0 ||
      model.waterFaucet.flowRateProperty.value > 0 || model.drainFaucet.flowRateProperty.value > 0,
    read: () => ( {
      ...readFields( fields ),
      waterVolume: solution[ 'waterVolumeProperty' ].value,
      soluteVolume: solution[ 'soluteVolumeProperty' ].value
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const { waterVolume, soluteVolume } = state;
      if ( typeof waterVolume !== 'number' || !Number.isFinite( waterVolume ) || waterVolume < 0 ||
           typeof soluteVolume !== 'number' || !Number.isFinite( soluteVolume ) || soluteVolume < 0 ||
           waterVolume + soluteVolume > solution.maxVolume + 1e-9 ) {
        throw new Error( 'Invalid pH Scale solution volumes.' );
      }
      const apply = prepareFields( fields, state );
      return () => {
        screen.view.interruptSubtreeInput();
        model[ 'stopAutofill' ]();
        model.waterFaucet.flowRateProperty.value = 0;
        model.drainFaucet.flowRateProperty.value = 0;
        apply();
        solution[ 'setVolumeAtomic' ]( waterVolume, soluteVolume );
        if ( state.autofilling ) {
          model.dropper.isDispensingProperty.value = true;
          model.dropper.flowRateProperty.value = 0.45;
        }
        else {
          model[ 'stopAutofill' ]();
        }
      };
    }
  };
}

export default function installPHScaleState( sim: Sim, id: 'ph-scale' | 'ph-scale-basics' ): void {
  const ids = [ 'macro', 'micro', 'my-solution' ];
  const preferences = { autoFill: boolean( PHScalePreferences.autoFillEnabledProperty ) };
  installSimulationBridge( sim, () => ( {
    bridge: `webwriter-${id}/v1`,
    build: `${id}@1.8.0-dev.0-webwriter.1`,
    readPreferences: () => readFields( preferences ),
    preparePreferences: input => prepareFields( preferences, input ),
    screens: sim.simScreens.map( ( screen, index ) => ( { id: ids[ index ], screen, ...screenState( screen ) } ) )
  } ) );
}
