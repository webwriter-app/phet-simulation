// Hooke's Law WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import FireListener from '../../../scenery/js/listeners/FireListener.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import AquaRadioButton from '../../../sun/js/AquaRadioButton.js';
import AquaRadioButtonGroup from '../../../sun/js/AquaRadioButtonGroup.js';
import Checkbox from '../../../sun/js/Checkbox.js';
import RectangularRadioButton from '../../../sun/js/buttons/RectangularRadioButton.js';
import RectangularRadioButtonGroup from '../../../sun/js/buttons/RectangularRadioButtonGroup.js';
import EnergyModel from '../energy/model/EnergyModel.js';
import IntroModel from '../intro/model/IntroModel.js';
import type SystemsModel from '../systems/model/SystemsModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, prepareFields, readFields } from './stateFields.js';

const checkboxNames = new Map( [
  [ 'appliedForceCheckbox', 'appliedForceVisible' ],
  [ 'springForceCheckbox', 'springForceVisible' ],
  [ 'displacementCheckbox', 'displacementVisible' ],
  [ 'equilibriumPositionCheckbox', 'equilibriumVisible' ],
  [ 'valuesCheckbox', 'valuesVisible' ],
  [ 'energyCheckbox', 'energyVisible' ]
] );

function descendants( node: Node ): Node[] {
  return node.children.flatMap( child => [ child, ...descendants( child ) ] );
}

function viewFields( view: Node ): Parameters<typeof readFields>[ 0 ] {
  const fields: Parameters<typeof readFields>[ 0 ] = {};
  descendants( view ).forEach( node => {
    const name = node.tandem.name;
    const checkbox = checkboxNames.get( name );
    if ( checkbox && node instanceof Checkbox ) {
      fields[ checkbox ] = boolean( node.property );
    }
    else if ( node instanceof RectangularRadioButtonGroup &&
              ( name === 'numberOfSystemsRadioButtonGroup' || name === 'systemTypeRadioButtonGroup' ) ) {
      const button = descendants( node ).find( child => child instanceof RectangularRadioButton ) as RectangularRadioButton<unknown>;
      if ( name === 'numberOfSystemsRadioButtonGroup' ) {
        fields.numberOfSystems = number( button.property as { value: number }, true, value => value === 1 || value === 2 );
      }
      else {
        const property = button.property as Parameters<typeof enumeration>[ 0 ];
        fields.systemType = enumeration( property );
      }
    }
    else if ( node instanceof AquaRadioButtonGroup &&
              ( name === 'energyGraphRadioButtonGroup' || name === 'springForceRadioButtonGroup' ) ) {
      const buttons = descendants( node ).filter( ( child ): child is AquaRadioButton<unknown> => child instanceof AquaRadioButton );
      const buttonNames = buttons.map( button => button.tandem.name );
      fields[ name === 'energyGraphRadioButtonGroup' ? 'energyGraph' : 'springForceRepresentation' ] = {
        read: () => buttons.find( button => button.pdomChecked )?.tandem.name ?? buttonNames[ 0 ],
        prepare: input => {
          const button = buttons.find( button => button.tandem.name === input );
          const listener = button?.getInputListeners().find( candidate => candidate instanceof FireListener ) as FireListener | undefined;
          if ( !button || !listener ) { throw new Error( 'Invalid Hooke’s Law display choice.' ); }
          return () => { if ( !button.pdomChecked ) { listener.fire( null ); } };
        }
      };
    }
  } );
  return fields;
}

function screenState( screen: AnyScreen ) {
  const model = screen.model as IntroModel | EnergyModel | SystemsModel;
  const fields = { ...viewFields( screen.view ) };
  if ( model instanceof IntroModel ) {
    fields.spring1Constant = number( model.system1.spring.springConstantProperty );
    fields.spring2Constant = number( model.system2.spring.springConstantProperty );
    fields.force1 = number( model.system1.spring.appliedForceProperty );
    fields.force2 = number( model.system2.spring.appliedForceProperty );
  }
  else if ( model instanceof EnergyModel ) {
    fields.springConstant = number( model.system.spring.springConstantProperty );
    fields.displacement = number( model.system.spring.displacementProperty );
  }
  else {
    fields.seriesLeftConstant = number( model.seriesSystem.leftSpring.springConstantProperty );
    fields.seriesRightConstant = number( model.seriesSystem.rightSpring.springConstantProperty );
    fields.parallelTopConstant = number( model.parallelSystem.topSpring.springConstantProperty );
    fields.parallelBottomConstant = number( model.parallelSystem.bottomSpring.springConstantProperty );
    fields.seriesForce = number( model.seriesSystem.equivalentSpring.appliedForceProperty );
    fields.parallelForce = number( model.parallelSystem.equivalentSpring.appliedForceProperty );
  }

  return {
    read: () => readFields( fields ),
    prepare: ( state: unknown ) => {
      const apply = prepareFields( fields, state );
      return () => {
        screen.view.interruptSubtreeInput();
        apply();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'intro', 'systems', 'energy' ];
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-hookes-law/v1',
    build: 'hookes-law@1.3.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, i ) => ( { id: ids[ i ], screen, ...screenState( screen ) } ) )
  } ) );
}
