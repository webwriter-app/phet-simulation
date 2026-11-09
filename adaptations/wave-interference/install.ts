// Wave Interference WebWriter state adapter. Distributed under GPL-3.0.
import type NumberProperty from '../../../axon/js/NumberProperty.js';
import type Property from '../../../axon/js/Property.js';
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import type DiffractionScene from '../diffraction/model/DiffractionScene.js';
import type DiffractionModel from '../diffraction/model/DiffractionModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, prepareFields, readFields } from './stateFields.js';
import { wavesState } from './waveInterferenceState.js';

const screenIds = [ 'waves', 'interference', 'slits', 'diffraction' ];

function diffractionState( screen: AnyScreen ) {
  const model = screen.model as DiffractionModel & {
    onProperty: Property<boolean>;
    wavelengthProperty: NumberProperty;
    sceneProperty: Property<DiffractionScene>;
    scenes: DiffractionScene[];
    ellipseScene: Record<'diameterProperty' | 'eccentricityProperty', NumberProperty>;
    rectangleScene: Record<'widthProperty' | 'heightProperty', NumberProperty>;
    circleSquareScene: Record<'circleDiameterProperty' | 'squareWidthProperty', NumberProperty>;
    disorderScene: Record<'diameterProperty' | 'latticeSpacingProperty' | 'disorderProperty', NumberProperty>;
    wavingGirlScene: Record<'heightProperty' | 'rotationProperty', NumberProperty>;
  };
  const fields = {
    laser: boolean( model.onProperty ),
    wavelength: number( model.wavelengthProperty ),
    aperture: field( model.sceneProperty, scene => model.scenes.indexOf( scene ), input =>
      typeof input === 'number' && Number.isInteger( input ) ? model.scenes[ input ] : undefined ),
    ellipseDiameter: number( model.ellipseScene.diameterProperty ),
    ellipseEccentricity: number( model.ellipseScene.eccentricityProperty ),
    rectangleWidth: number( model.rectangleScene.widthProperty ),
    rectangleHeight: number( model.rectangleScene.heightProperty ),
    circleDiameter: number( model.circleSquareScene.circleDiameterProperty ),
    squareWidth: number( model.circleSquareScene.squareWidthProperty ),
    disorderDiameter: number( model.disorderScene.diameterProperty ),
    latticeSpacing: number( model.disorderScene.latticeSpacingProperty ),
    disorder: number( model.disorderScene.disorderProperty ),
    girlHeight: number( model.wavingGirlScene.heightProperty ),
    girlRotation: number( model.wavingGirlScene.rotationProperty )
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

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-wave-interference/v1',
    build: 'wave-interference@2.1.0-dev.2-webwriter.1',
    screens: sim.simScreens.map( ( screen, index ) => ( {
      id: screenIds[ index ],
      screen,
      ...( index === 3 ? diffractionState( screen ) : wavesState( screen ) )
    } ) )
  } ) );
}
