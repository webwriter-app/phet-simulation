// Beer's Law Lab WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import Vector2 from '../../../dot/js/Vector2.js';
import type BLLMovable from '../common/model/BLLMovable.js';
import type ConcentrationModel from '../concentration/model/ConcentrationModel.js';
import type BeersLawModel from '../beerslaw/model/BeersLawModel.js';
import LightMode from '../beerslaw/model/LightMode.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields } from './stateFields.js';

function position( movable: BLLMovable ) {
  return field( movable.positionProperty, point => [ point.x, point.y ], input => {
    if ( !Array.isArray( input ) || input.length !== 2 || !input.every( Number.isFinite ) ) {
      return undefined;
    }
    const point = new Vector2( input[ 0 ], input[ 1 ] );
    return movable.dragBounds.containsPoint( point ) ? point : undefined;
  } );
}

function selection<T>( property: { value: T }, choices: T[] ) {
  return field( property, value => choices.indexOf( value ), input =>
    typeof input === 'number' && Number.isInteger( input ) ? choices[ input ] : undefined );
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const [ concentrationScreen, beersLawScreen ] = sim.simScreens;
    const concentration = concentrationScreen.model as ConcentrationModel;
    const beersLaw = beersLawScreen.model as BeersLawModel;

    const mixture = {
      solute: selection( concentration.soluteProperty, concentration.solutes ),
      form: enumeration( concentration.soluteFormProperty ),
      soluteMoles: number( concentration.solution.soluteMolesProperty ),
      volume: number( concentration.solution.volumeProperty ),
      shakerPosition: position( concentration.shaker ),
      probePosition: position( concentration.concentrationMeter.probe ),
      probeJumpIndex: number( concentration.concentrationProbeJumpPositionIndexProperty, true )
    };
    const optics = {
      solution: selection( beersLaw.solutionProperty, beersLaw.solutions ),
      cuvetteWidth: number( beersLaw.cuvette.widthProperty ),
      lightOn: boolean( beersLaw.light.isOnProperty ),
      lightMode: enumeration( beersLaw.light.modeProperty ),
      wavelength: number( beersLaw.light.wavelengthProperty ),
      detectorMode: enumeration( beersLaw.detector.modeProperty ),
      detectorPosition: position( beersLaw.detector.body ),
      probePosition: position( beersLaw.detector.probe ),
      rulerPosition: position( beersLaw.ruler ),
      probeJumpIndex: number( beersLaw.detectorProbeJumpPositionIndexProperty, true ),
      rulerJumpIndex: number( beersLaw.rulerJumpPositionIndexProperty, true )
    };
    const concentrations = beersLaw.solutions.map( solution => ( {
      concentration: number( solution.concentrationProperty )
    } ) );
    return {
      bridge: 'webwriter-beers-law-lab/v1',
      build: 'beers-law-lab@1.9.0-dev.0-webwriter.1',
      screens: [ {
        id: 'concentration',
        screen: concentrationScreen,
        read: () => readFields( mixture ),
        prepare: input => {
          const apply = prepareFields( mixture, input );
          return () => {
            concentrationScreen.view.interruptSubtreeInput();
            concentration.reset();
            apply();
            concentration.solution.updateIsSaturatedProperty();
          };
        }
      }, {
        id: 'beers-law',
        screen: beersLawScreen,
        read: () => ( {
          ...readFields( optics ),
          concentrations: concentrations.map( fields => fields.concentration.read() )
        } ),
        prepare: input => {
          const state = object( input );
          const apply = prepareFields( optics, state );
          const amounts = state.concentrations;
          if ( !Array.isArray( amounts ) || amounts.length !== concentrations.length ) {
            throw new Error( 'Invalid number of Beers Law solutions.' );
          }
          if ( state.lightMode === String( LightMode.PRESET ) &&
               state.wavelength !== beersLaw.solutions[ state.solution as number ].molarAbsorptivityData.lambdaMax ) {
            throw new Error( 'Invalid preset wavelength for the selected solution.' );
          }
          const applyConcentrations = concentrations.map( ( fields, index ) =>
            fields.concentration.prepare( amounts[ index ], 'concentration' ) );
          return () => {
            beersLawScreen.view.interruptSubtreeInput();
            applyConcentrations.forEach( restore => restore() );
            apply();
          };
        }
      } ]
    };
  } );
}
