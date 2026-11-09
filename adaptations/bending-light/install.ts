// Bending Light WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import Vector2 from '../../../dot/js/Vector2.js';
import DragListener from '../../../scenery/js/listeners/DragListener.js';
import ProtractorNode from '../../../scenery-phet/js/ProtractorNode.js';
import RectangularRadioButton from '../../../sun/js/buttons/RectangularRadioButton.js';
import BendingLightStrings from '../BendingLightStrings.js';
import type BendingLightModel from '../common/model/BendingLightModel.js';
import Medium from '../common/model/Medium.js';
import Substance from '../common/model/Substance.js';
import type BendingLightScreenView from '../common/view/BendingLightScreenView.js';
import type IntroModel from '../intro/model/IntroModel.js';
import MoreToolsModel from '../more-tools/model/MoreToolsModel.js';
import DataPoint from '../more-tools/model/DataPoint.js';
import type PrismsModel from '../prisms/model/PrismsModel.js';
import LightType from '../prisms/model/LightType.js';
import LaserTypeRadioButtonGroup from '../prisms/view/LaserTypeRadioButtonGroup.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, field, number, object, prepareFields, readFields, vector } from './stateFields.js';

const substances = new Map( [
  [ 'air', Substance.AIR ],
  [ 'water', Substance.WATER ],
  [ 'glass', Substance.GLASS ],
  [ 'mystery-a', Substance.MYSTERY_A ],
  [ 'mystery-b', Substance.MYSTERY_B ]
] );

function mediumState( model: BendingLightModel, property: { value: Medium } ) {
  return {
    read: () => {
      const substance = property.value.substance;
      return substance.custom ? { type: 'custom', index: substance.indexForRed } : {
        type: [ ...substances ].find( ( [ , candidate ] ) => candidate.nameProperty === substance.nameProperty )![ 0 ]
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const index = state.index;
      const substance = state.type === 'custom' && typeof index === 'number' && index >= 1 && index <= 1.61 ?
        new Substance( BendingLightStrings.customStringProperty, index, false, true ) :
        typeof state.type === 'string' ? substances.get( state.type ) : undefined;
      if ( !substance ) {
        throw new Error( 'Invalid optical medium.' );
      }
      return () => {
        property.value = new Medium( property.value.shape, substance,
          model.mediumColorFactory.getColor( substance.indexOfRefractionForRedLight ) );
      };
    }
  };
}

function opticalPosition( property: { value: Vector2 } ) {
  return field( property, value => [ value.x, value.y ], input =>
    Array.isArray( input ) && input.length === 2 &&
    input.every( value => typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) <= 0.01 ) ?
    new Vector2( input[ 0 ], input[ 1 ] ) : undefined );
}

function laserFields( model: BendingLightModel ) {
  return {
    wavelength: number( model.wavelengthProperty ),
    laserOn: boolean( model.laser.onProperty ),
    pivot: opticalPosition( model.laser.pivotProperty ),
    emissionPoint: opticalPosition( model.laser.emissionPointProperty )
  };
}

function protractorFields( view: BendingLightScreenView, prisms?: PrismsModel ) {
  const layer = prisms ? view[ 'afterLightLayer' ] : view[ 'beforeLightLayer2' ];
  const tool = layer.children.find( child => child instanceof ProtractorNode );
  const drag = tool?.inputListeners.find( listener => listener instanceof DragListener && listener[ '_positionProperty' ] );
  if ( !tool || !drag ) {
    throw new Error( 'The bending light protractor is unavailable.' );
  }
  return {
    protractorVisible: boolean( prisms ? prisms.showProtractorProperty : view[ 'showProtractorProperty' ] ),
    protractorAngle: number( tool.angleProperty ),
    protractorPosition: vector( drag[ '_positionProperty' ]! )
  };
}

function introState( screen: Sim[ 'simScreens' ][ number ] ) {
  const model = screen.model as IntroModel;
  const moreTools = model instanceof MoreToolsModel ? model : null;
  const probes = moreTools ? [ moreTools.waveSensor.probe1, moreTools.waveSensor.probe2 ] : [];
  const top = mediumState( model, model.topMediumProperty );
  const bottom = mediumState( model, model.bottomMediumProperty );
  const fields = {
    ...laserFields( model ),
    ...protractorFields( screen.view as BendingLightScreenView ),
    laserView: enumeration( model.laserViewProperty ),
    speed: enumeration( model.speedProperty ),
    showNormal: boolean( model.showNormalProperty ),
    showAngles: boolean( model.showAnglesProperty ),
    intensityMeterEnabled: boolean( model.intensityMeter.enabledProperty ),
    intensityMeterBody: opticalPosition( model.intensityMeter.bodyPositionProperty ),
    intensityMeterProbe: opticalPosition( model.intensityMeter.sensorPositionProperty ),
    ...( moreTools ? {
      velocitySensorEnabled: boolean( moreTools.velocitySensor.enabledProperty ),
      velocitySensorPosition: opticalPosition( moreTools.velocitySensor.positionProperty ),
      waveSensorEnabled: boolean( moreTools.waveSensor.enabledProperty ),
      waveSensorPosition: opticalPosition( moreTools.waveSensor.bodyPositionProperty ),
      waveProbeOne: opticalPosition( moreTools.waveSensor.probe1.positionProperty ),
      waveProbeTwo: opticalPosition( moreTools.waveSensor.probe2.positionProperty )
    } : {} )
  };
  const playback = { playing: boolean( model.isPlayingProperty ) };
  return {
    isPlaying: () => model.laser.onProperty.value && model.isPlayingProperty.value,
    read: () => ( {
      ...readFields( fields ),
      ...readFields( playback ),
      time: model.time,
      top: top.read(),
      bottom: bottom.read(),
      traces: probes.map( probe => probe.seriesProperty.value.map( point => [ point.time, point.value ] ) )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const applyPlayback = prepareFields( playback, state );
      const applyTop = top.prepare( state.top );
      const applyBottom = bottom.prepare( state.bottom );
      const { time, traces } = state;
      if ( typeof time !== 'number' || !Number.isFinite( time ) || time < 0 ||
           !Array.isArray( traces ) || traces.length !== probes.length ) {
        throw new Error( 'Invalid bending light timing.' );
      }
      const samples = traces.map( trace => {
        if ( !Array.isArray( trace ) || trace.length > 10000 ) {
          throw new Error( 'Invalid wave probe history.' );
        }
        return trace.map( point => {
          if ( !Array.isArray( point ) || point.length !== 2 || !point.every( Number.isFinite ) || point[ 0 ] < 0 ) {
            throw new Error( 'Invalid wave probe point.' );
          }
          return new DataPoint( point[ 0 ], point[ 1 ] );
        } );
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        model.isPlayingProperty.value = false;
        applyFields();
        applyTop();
        applyBottom();
        model.time = time;
        model.updateModel();
        model.rays.forEach( ray => ray.setTime( time ) );
        probes.forEach( ( probe, index ) => { probe.seriesProperty.value = samples[ index ]; } );
        applyPlayback();
      };
    }
  };
}

function prismState( screen: Sim[ 'simScreens' ][ number ] ) {
  const model = screen.model as PrismsModel;
  const view = screen.view as BendingLightScreenView;
  const environment = mediumState( model, model.environmentMediumProperty );
  const material = mediumState( model, model.prismMediumProperty );
  const prototypes = new Map( model.getPrismPrototypes().map( prism => [ prism.typeName, prism ] ) );
  const radioGroup = view[ 'afterLightLayer2' ].children.find( node => node instanceof LaserTypeRadioButtonGroup );
  const radioButton = radioGroup?.children.find( child => child instanceof RectangularRadioButton );
  if ( !radioButton ) {
    throw new Error( 'The prism laser controls are unavailable.' );
  }
  const fields = {
    ...laserFields( model ),
    ...protractorFields( view, model ),
    lightType: field<LightType>( radioButton.property, value => String( value ), input =>
      LightType.enumeration.values.find( value => String( value ) === input ) ),
    showNormals: boolean( model.showNormalsProperty ),
    showReflections: boolean( model.showReflectionsProperty )
  };
  return {
    read: () => ( {
      ...readFields( fields ),
      environment: environment.read(),
      material: material.read(),
      prisms: model.prisms.map( prism => {
        const reference = prism.shapeProperty.value.getReferencePoint();
        const prototype = prototypes.get( prism.typeName )!.shapeProperty.value;
        const original = prototype.getReferencePoint();
        const angle = reference && original ?
          reference.minus( prism.shapeProperty.value.getRotationCenter() ).angle - original.minus( prototype.getRotationCenter() ).angle : 0;
        return { type: prism.typeName, angle, position: opticalPosition( prism.positionProperty ).read() };
      } )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const applyEnvironment = environment.prepare( state.environment );
      const applyMaterial = material.prepare( state.material );
      if ( !Array.isArray( state.prisms ) || state.prisms.length > 500 ) {
        throw new Error( 'Invalid prism list.' );
      }
      const rebuild = state.prisms.map( input => {
        const { type, angle, position } = object( input );
        const template = typeof type === 'string' ? prototypes.get( type ) : undefined;
        if ( !template || typeof angle !== 'number' || !Number.isFinite( angle ) || Math.abs( angle ) > 2 * Math.PI ||
             !Array.isArray( position ) || position.length !== 2 ||
             !position.every( value => typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) <= 0.01 ) ) {
          throw new Error( 'Invalid prism.' );
        }
        return () => {
          const prism = template.copy();
          prism.rotate( angle );
          prism.translate( position[ 0 ], position[ 1 ] );
          model.addPrism( prism );
        };
      } );
      return () => {
        view.interruptSubtreeInput();
        model.prisms.slice().forEach( prism => model.removePrism( prism ) );
        applyFields();
        applyEnvironment();
        applyMaterial();
        rebuild.forEach( add => add() );
        model.updateModel();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const [ intro, prisms, moreTools ] = sim.simScreens;
    return {
      bridge: 'webwriter-bending-light/v1',
      build: 'bending-light@1.3.0-dev.0-webwriter.1',
      screens: [
        { id: 'intro', screen: intro, ...introState( intro ) },
        { id: 'prisms', screen: prisms, ...prismState( prisms ) },
        { id: 'more-tools', screen: moreTools, ...introState( moreTools ) }
      ]
    };
  } );
}
