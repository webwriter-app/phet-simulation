// Shared WebWriter bridge for adapted simulations. Distributed under GPL-3.0.
import regionAndCultureProperty, { supportedRegionAndCultureValues } from '../../../joist/js/i18n/regionAndCultureProperty.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Sim from '../../../joist/js/Sim.js';
import { object } from './stateFields.js';

type ScreenAdapter = {
  id: string;
  screen: AnyScreen;
  read: () => unknown;
  prepare: ( input: unknown ) => () => void;
  isPlaying?: () => boolean;
};

type Adapter = {
  bridge: string;
  build: string;
  compatibleBuilds?: readonly string[];
  screens: ScreenAdapter[];
  readPreferences?: () => Record<string, unknown>;
  preparePreferences?: ( input: Record<string, unknown> ) => () => void;
};

function installBridge( sim: Sim, adapter: Adapter ): void {
  const { bridge, build, screens } = adapter;
  const screenIds = screens.map( screen => screen.id );
  if ( screens.length !== sim.simScreens.length || new Set( screenIds ).size !== screens.length ||
       screens.some( ( entry, index ) => entry.screen !== sim.simScreens[ index ] || entry.id === 'home' || !entry.id ) ) {
    throw new Error( 'The state adapter must identify each simulation screen in navigation order.' );
  }
  const { visualModel, audioModel, localizationModel } = sim.preferencesModel;
  const locale = localizationModel.localeProperty;
  const locales = locale.availableRuntimeLocales;
  const regions = supportedRegionAndCultureValues;
  const colorProfiles = visualModel.colorProfileProperty.validValues ?? [ visualModel.colorProfileProperty.value ];
  const screenChoices = () => screens.map( ( { id, screen } ) => ( { value: id, label: screen.nameProperty.value || id } ) );

  const readSnapshot = () => ( {
    schemaVersion: 1,
    build,
    activeScreen: screenIds[ screens.findIndex( screen => screen.screen === sim.selectedScreenProperty.value ) ] ?? 'home',
    screens: Object.fromEntries( screens.map( screen => [ screen.id, screen.read() ] ) )
  } );

  const readPreferences = () => ( {
    enabledScreens: sim.availableScreensProperty.value.map( index => screenIds[ index - 1 ] ),
    locale: locale.value,
    colorProfile: visualModel.colorProfileProperty.value,
    audio: audioModel.audioEnabledProperty.value ? 'enabled' : 'muted',
    ...( regions.length > 1 ? { regionAndCulture: regionAndCultureProperty.value } : {} ),
    ...adapter.readPreferences?.()
  } );

  const initialSnapshot = readSnapshot();

  const prepareSnapshot = ( input: unknown ) => {
    const snapshot = input === null ? initialSnapshot : object( input );
    if ( snapshot.schemaVersion !== 1 ||
         ( snapshot.build !== build && !adapter.compatibleBuilds?.some( compatible => compatible === snapshot.build ) ) ) {
      throw new Error( 'This snapshot belongs to a different simulation build or schema.' );
    }
    const index = screenIds.findIndex( id => id === snapshot.activeScreen );
    if ( index < 0 && snapshot.activeScreen !== 'home' ) {
      throw new Error( 'The saved active screen is unknown.' );
    }
    const states = object( snapshot.screens );
    const changes = screens.map( screen => screen.prepare( states[ screen.id ] ) );
    return () => {
      changes.forEach( change => change() );
      const target = index < 0 ? sim.homeScreen : screens[ index ].screen;
      if ( target && ( target === sim.homeScreen && sim.activeSimScreensProperty.value.length > 1 ||
                       sim.activeSimScreensProperty.value.includes( target ) ) ) {
        sim.selectedScreenProperty.value = target;
      }
    };
  };

  const preparePreferences = ( input: unknown ) => {
    const settings = object( input );
    const { enabledScreens, locale: language, colorProfile, audio } = settings;
    const selectedLocale = locales.find( candidate => candidate === language );
    const region = regions.find( candidate => candidate === settings.regionAndCulture );
    if ( !Array.isArray( enabledScreens ) || !enabledScreens.length ||
         new Set( enabledScreens ).size !== enabledScreens.length ||
         !enabledScreens.every( id => screenIds.includes( id ) ) ||
         selectedLocale === undefined ||
         ( regions.length > 1 && !region ) ||
         typeof colorProfile !== 'string' || !colorProfiles.includes( colorProfile ) ||
         ( audio !== 'enabled' && audio !== 'muted' ) ) {
      throw new Error( 'The simulation preferences are invalid.' );
    }
    const applySpecific = adapter.preparePreferences?.( settings );
    return () => {
      sim.availableScreensProperty.value = enabledScreens.map( id => screenIds.indexOf( id ) + 1 );
      locale.value = selectedLocale;
      if ( region ) {
        regionAndCultureProperty.value = region;
      }
      visualModel.colorProfileProperty.value = colorProfile;
      audioModel.audioEnabledProperty.value = audio === 'enabled';
      applySpecific?.();
    };
  };

  const connect = ( event: MessageEvent ) => {
    if ( event.source !== window.parent || event.data?.bridge !== bridge ||
         event.data.type !== 'connect' || event.ports.length !== 1 ) {
      return;
    }
    window.removeEventListener( 'message', connect );
    const port = event.ports[ 0 ];
    port.onmessage = ( { data } ) => {
      if ( !Number.isSafeInteger( data?.id ) ) {
        return;
      }
      try {
        if ( data.type === 'read' ) {
          const active = screens.find( screen => screen.screen === sim.selectedScreenProperty.value );
          port.postMessage( { id: data.id, value: {
            snapshot: readSnapshot(),
            preferences: readPreferences(),
            playing: active?.isPlaying?.() ?? false
          } } );
        }
        else if ( data.type === 'apply' ) {
          const value = object( data.value );
          const applyPreferences = 'preferences' in value ? preparePreferences( value.preferences ) : null;
          const applySnapshot = 'snapshot' in value ? prepareSnapshot( value.snapshot ) : null;
          applyPreferences?.();
          applySnapshot?.();
          port.postMessage( { id: data.id } );
        }
        else {
          throw new Error( 'Unknown simulation request.' );
        }
      }
      catch ( error ) {
        port.postMessage( { id: data.id, error: error instanceof Error ? error.message : String( error ) } );
      }
    };
    port.postMessage( {
      type: 'connected',
      capabilities: {
        locales,
        regions,
        colorProfiles,
        screens: screenChoices(),
        defaults: readPreferences(),
        initialSnapshot: JSON.stringify( initialSnapshot ).replaceAll( '<', '\\u003c' )
      }
    } );
    locale.lazyLink( () => queueMicrotask( () => port.postMessage( { type: 'screens', screens: screenChoices() } ) ) );

    // Signal completed interactions, not animation frames or each drag update.
    const pointers = new Set<number>();
    window.addEventListener( 'pointerdown', event => {
      if ( event.isTrusted ) {
        pointers.add( event.pointerId );
        port.postMessage( { type: 'input-start' } );
      }
    }, true );
    const endPointer = ( event: PointerEvent ) => {
      if ( event.isTrusted && pointers.delete( event.pointerId ) && pointers.size === 0 ) {
        port.postMessage( { type: 'input-end' } );
      }
    };
    window.addEventListener( 'pointerup', endPointer, true );
    window.addEventListener( 'pointercancel', endPointer, true );
    const endInput = ( event: MouseEvent | KeyboardEvent ) => {
      if ( event.isTrusted && pointers.size === 0 ) {
        port.postMessage( { type: 'input-end' } );
      }
    };
    window.addEventListener( 'click', endInput, true );
    window.addEventListener( 'keyup', endInput, true );
  };
  window.addEventListener( 'message', connect );
  // The ready message contains no state. All data travels on the private port.
  window.parent.postMessage( { bridge, type: 'ready' }, '*' );
}

export default function installSimulationBridge( sim: Sim, createAdapter: () => Adapter ): void {
  if ( window.parent !== window ) {
    // Joist initializes the models and views asynchronously after sim.start().
    sim.isConstructionCompleteProperty.lazyLink( complete => {
      if ( complete ) {
        installBridge( sim, createAdapter() );
      }
    } );
  }
}
