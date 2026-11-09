// Color Vision WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Color from '../../../scenery/js/util/Color.js';
import RGBModel from '../rgb/model/RGBModel.js';
import SingleBulbModel from '../singlebulb/model/SingleBulbModel.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields } from './stateFields.js';

function screenState( screen: AnyScreen ) {
  const model = screen.model as SingleBulbModel | RGBModel;
  const head = { head: enumeration( model.headModeProperty ), playing: boolean( model.playingProperty ) };
  const bulbs: Parameters<typeof readFields>[ 0 ] = model instanceof SingleBulbModel ? {
    lightType: enumeration( model.lightTypeProperty ),
    beamType: enumeration( model.beamTypeProperty ),
    wavelength: number( model.flashlightWavelengthProperty ),
    filterWavelength: number( model.filterWavelengthProperty ),
    flashlightOn: boolean( model.flashlightOnProperty ),
    filterVisible: boolean( model.filterVisibleProperty )
  } : {
    red: number( model.redIntensityProperty ),
    green: number( model.greenIntensityProperty ),
    blue: number( model.blueIntensityProperty ),
    perceivedRed: number( model.perceivedRedIntensityProperty ),
    perceivedGreen: number( model.perceivedGreenIntensityProperty ),
    perceivedBlue: number( model.perceivedBlueIntensityProperty )
  };
  const photonColor = () => {
    if ( !( model instanceof SingleBulbModel ) ) { return null; }
    const color = Color.toColor( model.lastPhotonColorProperty.value );
    return [ color.red, color.green, color.blue, color.alpha ];
  };

  return {
    isPlaying: () => model.playingProperty.value,
    read: () => ( { head: readFields( head ), bulbs: readFields( bulbs ), lastPhoton: photonColor() } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyHead = prepareFields( head, state.head );
      const applyBulbs = prepareFields( bulbs, state.bulbs );
      const { lastPhoton } = state;
      let color: Color | null = null;
      if ( model instanceof SingleBulbModel ) {
        if ( !Array.isArray( lastPhoton ) || lastPhoton.length !== 4 ||
             !lastPhoton.every( ( value, i ) => Number.isFinite( value ) && value >= 0 && value <= ( i === 3 ? 1 : 255 ) ) ) {
          throw new Error( 'Invalid photon color.' );
        }
        color = new Color( lastPhoton[ 0 ], lastPhoton[ 1 ], lastPhoton[ 2 ], lastPhoton[ 3 ] );
      }
      else if ( lastPhoton !== null ) {
        throw new Error( 'Unexpected photon color on the RGB screen.' );
      }
      return () => {
        screen.view.interruptSubtreeInput();
        model.reset();
        applyBulbs();
        if ( model instanceof SingleBulbModel && color ) { model.lastPhotonColorProperty.value = color; }
        applyHead();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  const ids = [ 'single-bulb', 'rgb-bulbs' ];
  installSimulationBridge( sim, () => ( {
    bridge: 'webwriter-color-vision/v1',
    build: 'color-vision@1.4.0-dev.0-webwriter.1',
    screens: sim.simScreens.map( ( screen, i ) => ( { id: ids[ i ], screen, ...screenState( screen ) } ) )
  } ) );
}
