// Diffusion WebWriter adapter. Distributed under GPL-3.0.
import type DiffusionModel from '../../../gas-properties/js/diffusion/model/DiffusionModel.js';
import type DiffusionParticle from '../../../gas-properties/js/diffusion/model/DiffusionParticle.js';
import DiffusionSettings from '../../../gas-properties/js/diffusion/model/DiffusionSettings.js';
import type ParticleFlowRateModel from '../../../gas-properties/js/diffusion/model/ParticleFlowRateModel.js';
import type DiffusionViewProperties from '../../../gas-properties/js/diffusion/view/DiffusionViewProperties.js';
import type Sim from '../../../joist/js/Sim.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields, vector } from './stateFields.js';

function readParticle( particle: DiffusionParticle ) {
  return [ particle.previousX, particle.previousY, particle.x, particle.y, particle.vx, particle.vy ];
}

function prepareParticles( input: unknown, count: unknown, particles: DiffusionParticle[] ): () => void {
  if ( !Array.isArray( input ) || input.length !== count ) { throw new Error( 'Invalid diffusion particle count.' ); }
  const values = input.map( value => {
    if ( !Array.isArray( value ) || value.length !== 6 ||
         !value.every( coordinate => Number.isFinite( coordinate ) && Math.abs( coordinate ) <= 1e6 ) ) {
      throw new Error( 'Invalid diffusion particle state.' );
    }
    return value;
  } );
  return () => {
    particles.forEach( ( particle, index ) => {
      const [ px, py, x, y, vx, vy ] = values[ index ];
      particle.setXY( px, py );
      particle.setXY( x, y );
      particle.setVelocityXY( vx, vy );
    } );
  };
}

function particleState( settings: DiffusionSettings, particles: DiffusionParticle[], flow: ParticleFlowRateModel ) {
  const delta = DiffusionSettings.DELTAS;
  const fields = {
    count: number( settings.numberOfParticlesProperty, true, value => value % delta.numberOfParticles === 0 ),
    mass: number( settings.massProperty, true, value => value % delta.mass === 0 ),
    radius: number( settings.radiusProperty, true, value => value % delta.radius === 0 ),
    temperature: number( settings.initialTemperatureProperty, true, value => value % delta.initialTemperature === 0 ),
    leftFlow: number( flow.leftFlowRateProperty, false, value => value >= 0 ),
    rightFlow: number( flow.rightFlowRateProperty, false, value => value >= 0 )
  };
  const history = flow as unknown as { dts: number[]; leftCounts: number[]; rightCounts: number[] };
  return {
    read: () => ( {
      controls: readFields( fields ),
      particles: particles.map( readParticle ),
      flowSamples: history.dts.map( ( dt, i ) => [ dt, history.leftCounts[ i ], history.rightCounts[ i ] ] )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const controls = object( state.controls );
      const applyControls = prepareFields( fields, controls );
      const applyParticles = prepareParticles( state.particles, controls.count, particles );
      if ( !Array.isArray( state.flowSamples ) || state.flowSamples.length > 1000 ) {
        throw new Error( 'Invalid diffusion flow history.' );
      }
      const samples = state.flowSamples.map( entry => {
        if ( !Array.isArray( entry ) || entry.length !== 3 ||
             !Number.isFinite( entry[ 0 ] ) || entry[ 0 ] <= 0 || entry[ 0 ] > 1e3 ||
             !entry.slice( 1 ).every( count => Number.isInteger( count ) && count >= 0 && count <= Number( controls.count ) ) ) {
          throw new Error( 'Invalid diffusion flow sample.' );
        }
        return entry;
      } );
      return () => {
        applyControls();
        applyParticles();
        history.dts.splice( 0, history.dts.length, ...samples.map( sample => sample[ 0 ] ) );
        history.leftCounts.splice( 0, history.leftCounts.length, ...samples.map( sample => sample[ 1 ] ) );
        history.rightCounts.splice( 0, history.rightCounts.length, ...samples.map( sample => sample[ 2 ] ) );
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const screen = sim.simScreens[ 0 ];
    const model = screen.model as DiffusionModel;
    const system = model.particleSystem;
    const view = ( screen.view as unknown as { viewProperties: DiffusionViewProperties } ).viewProperties;
    const controls = {
      divided: boolean( model.container.isDividedProperty ),
      speed: enumeration( model.timeSpeedProperty ),
      dataExpanded: boolean( view.dataExpandedProperty ),
      flowRates: boolean( view.particleFlowRateVisibleProperty ),
      centerOfMass: boolean( view.centerOfMassVisibleProperty ),
      scale: boolean( view.scaleVisibleProperty )
    };
    const stopwatch = {
      visible: boolean( model.stopwatch.isVisibleProperty ),
      running: boolean( model.stopwatch.isRunningProperty ),
      time: number( model.stopwatch.timeProperty, false, value => value >= 0 ),
      position: vector( model.stopwatch.positionProperty )
    };
    const playback = { playing: boolean( model.isPlayingProperty ) };
    const left = particleState( system.particle1Settings, system.particles1, system.particle1FlowRateModel );
    const right = particleState( system.particle2Settings, system.particles2, system.particle2FlowRateModel );

    return {
      bridge: 'webwriter-diffusion/v1',
      build: 'diffusion@1.2.0-dev.0-webwriter.1',
      screens: [ {
        id: 'diffusion',
        screen,
        isPlaying: () => model.isPlayingProperty.value && ( system.numberOfParticlesProperty.value > 0 || model.stopwatch.isRunningProperty.value ),
        read: () => ( {
          controls: readFields( controls ),
          stopwatch: readFields( stopwatch ),
          playback: readFields( playback ),
          left: left.read(),
          right: right.read()
        } ),
        prepare: input => {
          const state = object( input );
          const applyControls = prepareFields( controls, state.controls );
          const applyStopwatch = prepareFields( stopwatch, state.stopwatch );
          const applyPlayback = prepareFields( playback, state.playback );
          const applyLeft = left.prepare( state.left );
          const applyRight = right.prepare( state.right );
          return () => {
            screen.view.interruptSubtreeInput();
            model.isPlayingProperty.value = false;
            system.reset();
            applyControls();
            applyLeft();
            applyRight();
            applyStopwatch();
            system.updateCenterOfMass();
            model.leftData.update();
            model.rightData.update();
            applyPlayback();
          };
        }
      } ]
    };
  } );
}
