// Build an Atom WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import NumberAtom from '../../../shred/js/model/NumberAtom.js';
import AtomScreenView from '../atom/view/AtomScreenView.js';
import type BAAModel from '../common/model/BAAModel.js';
import { MAX_ELECTRONS, MAX_NEUTRONS, MAX_PROTONS } from '../common/model/BAAModel.js';
import BAAPreferences from '../common/model/BAAPreferences.js';
import type BAAScreenView from '../common/view/BAAScreenView.js';
import SymbolScreenView from '../symbol/view/SymbolScreenView.js';
import AtomValuePool from '../game/model/AtomValuePool.js';
import type BAAGameChallenge from '../game/model/BAAGameChallenge.js';
import type { ChallengeDescriptor } from '../game/model/ChallengeDescriptorSetFactory.js';
import GameModel, { GameStateValues } from '../game/model/GameModel.js';
import type ChallengeView from '../game/view/ChallengeView.js';
import CountsToChargeChallengeView from '../game/view/CountsToChargeChallengeView.js';
import CountsToMassNumberChallengeView from '../game/view/CountsToMassNumberChallengeView.js';
import type GameScreenView from '../game/view/GameScreenView.js';
import SchematicToChargeChallengeView from '../game/view/SchematicToChargeChallengeView.js';
import SchematicToMassNumberChallengeView from '../game/view/SchematicToMassNumberChallengeView.js';
import SymbolToCountsChallengeView from '../game/view/SymbolToCountsChallengeView.js';
import SymbolToSchematicChallengeView from '../game/view/SymbolToSchematicChallengeView.js';
import ToElementChallengeView from '../game/view/ToElementChallengeView.js';
import ToSymbolChallengeView from '../game/view/ToSymbolChallengeView.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, enumeration, number, object, prepareFields, readFields } from './stateFields.js';

type Counts = [ number, number, number ];
type Screen = Sim[ 'simScreens' ][ number ];

function readCounts( atom: {
  protonCountProperty: { value: number };
  neutronCountProperty: { value: number };
  electronCountProperty: { value: number };
} ): Counts {
  return [ atom.protonCountProperty.value, atom.neutronCountProperty.value, atom.electronCountProperty.value ];
}

function counts( input: unknown ): Counts {
  const max = [ MAX_PROTONS, MAX_NEUTRONS, MAX_ELECTRONS ];
  if ( !Array.isArray( input ) || input.length !== max.length ||
       !input.every( ( count, index ) => Number.isInteger( count ) && count >= 0 && count <= max[ index ] ) ) {
    throw new Error( 'Invalid atom composition.' );
  }
  return input as Counts;
}

function setCounts( model: BAAModel, [ protonCount, neutronCount, electronCount ]: Counts ) {
  const atom = new NumberAtom( { protonCount, neutronCount, electronCount } );
  try {
    model.reset();
    model.setAtomConfiguration( atom );
  }
  finally {
    atom.dispose();
  }
}

function atomScreen( screen: Screen ) {
  const model = screen.model as BAAModel;
  const view = screen.view as BAAScreenView;
  const props = view[ 'viewProperties' ];
  const fields = {
    elementName: boolean( props.elementNameVisibleProperty ),
    chargeLabel: boolean( props.neutralAtomOrIonVisibleProperty ),
    nuclearStability: boolean( props.nuclearStabilityVisibleProperty ),
    electronModel: enumeration( props.electronModelProperty ),
    periodicTableExpanded: boolean( view[ 'periodicTableAccordionBox' ].expandedProperty ),
    ...( view instanceof AtomScreenView ? {
      netChargeExpanded: boolean( view[ 'netChargeAccordionBox' ].expandedProperty ),
      massNumberExpanded: boolean( view[ 'massNumberAccordionBox' ].expandedProperty )
    } : {} ),
    ...( view instanceof SymbolScreenView ? {
      symbolExpanded: boolean( view[ 'symbolAccordionBox' ].expandedProperty )
    } : {} )
  };
  return {
    read: () => ( { ...readFields( fields ), atom: readCounts( model.atom ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const atom = counts( state.atom );
      const apply = prepareFields( fields, state );
      return () => {
        view.interruptSubtreeInput();
        setCounts( model, atom );
        apply();
      };
    }
  };
}

function answerState( view: ChallengeView, challenge: BAAGameChallenge ) {
  if ( view instanceof SymbolToSchematicChallengeView ) {
    const model = view.challenge.submittedAnswerModel;
    return {
      read: () => readCounts( model.atom ),
      prepare: ( input: unknown ) => {
        const atom = counts( input );
        return () => setCounts( model, atom );
      }
    };
  }
  const fields: Parameters<typeof prepareFields>[ 0 ] = {};
  if ( view instanceof ToElementChallengeView ) {
    fields.protons = number( view[ 'protonCountProperty' ], true, value => value >= 0 && value <= 118 );
    fields.charge = enumeration( view[ 'neutralOrIonProperty' ] );
  }
  else if ( view instanceof ToSymbolChallengeView ) {
    const node = view[ 'interactiveSymbolNode' ];
    fields.protons = number( node.protonCountProperty, true, value => value >= 0 && value <= 99 );
    fields.mass = number( node.massNumberProperty, true, value => value >= 0 && value <= 99 );
    fields.charge = number( node.chargeProperty, true, value => Math.abs( value ) <= 99 );
  }
  else if ( view instanceof SymbolToCountsChallengeView ) {
    const answer = view.interactiveParticleCountsNode.submittedAnswerAtom;
    fields.protons = number( answer.protonCountProperty, true, value => value >= 0 && value <= 99 );
    fields.neutrons = number( answer.neutronCountProperty, true, value => value >= 0 && value <= 99 );
    fields.electrons = number( answer.electronCountProperty, true, value => value >= 0 && value <= 99 );
  }
  else if ( view instanceof CountsToChargeChallengeView || view instanceof SchematicToChargeChallengeView ) {
    fields.charge = number( view[ 'chargeProperty' ], true, value => Math.abs( value ) <= 99 );
  }
  else if ( view instanceof CountsToMassNumberChallengeView || view instanceof SchematicToMassNumberChallengeView ) {
    fields.mass = number( view[ 'massNumberProperty' ], true );
  }
  else {
    throw new Error( `Unknown atom challenge answer: ${challenge.challengeType}.` );
  }
  return { read: () => readFields( fields ), prepare: ( input: unknown ) => prepareFields( fields, input ) };
}

function gameScreen( screen: Screen ) {
  const model = screen.model as GameModel;
  const view = screen.view as GameScreenView;
  const answers = new Map( model.getAllChallenges().map( challenge => [
    challenge.challengeType, {
      challenge,
      state: answerState( view[ 'challengeViewSet' ].get( challenge ), challenge )
    }
  ] ) );
  const settings = {
    timerEnabled: boolean( model.timerEnabledProperty ),
    randomSeed: number( model.randomSeedProperty, false, value => value >= 0 && value <= Number.MAX_SAFE_INTEGER )
  };
  const results = {
    score: number( model.scoreProperty, true ),
    points: number( model.pointsProperty, true ),
    attempts: number( model.attemptsProperty, true ),
    elapsedTime: number( model.timer.elapsedTimeProperty, true )
  };
  const best = model.levels.map( level => ( {
    score: number( level.bestScoreProperty, true, value => value >= 0 && value <= level.getPerfectScore() ),
    time: number( level.bestTimeProperty, true, value => value >= 0 ),
    newTime: boolean( level.isNewBestTimeProperty )
  } ) );
  const readDescriptor = ( descriptor: ChallengeDescriptor ) => ( {
    type: descriptor.type, atom: readCounts( descriptor.atomValue )
  } );
  const atomPools = model.levels.map( level => new AtomValuePool( level.levelIndex )[ 'remainingAtomValues' ] );
  const prepareDescriptor = ( input: unknown, levelIndex: number ) => {
    const state = object( input );
    const item = [ ...answers.values() ].find( item => item.challenge.challengeType === state.type );
    if ( !item ) {
      throw new Error( 'Invalid atom challenge type.' );
    }
    const counts = state.atom;
    const atomValue = Array.isArray( counts ) && counts.length === 3 && atomPools[ levelIndex ].find( atom =>
      atom.protonCount === counts[ 0 ] && atom.neutronCount === counts[ 1 ] && atom.electronCount === counts[ 2 ] );
    if ( !atomValue ) {
      throw new Error( 'Invalid atom for this game level.' );
    }
    return {
      ...item,
      atom: readCounts( atomValue ),
      create: () => ( { type: item.challenge.challengeType, atomValue } )
    };
  };
  return {
    isPlaying: () => model.timer.isRunning,
    read: () => {
      const level = model.levelProperty.value;
      const challenge = model.challengeProperty.value;
      return {
        ...readFields( settings ),
        best: best.map( readFields ),
        challenges: model.levels.map( level => level.challengeDescriptors.map( readDescriptor ) ),
        game: level ? {
          level: level.levelNumber,
          stage: model.gameStateProperty.value,
          challenge: model.challengeNumberProperty.value,
          current: challenge ? {
            type: challenge.challengeType,
            atom: readCounts( challenge.correctAnswerAtom ),
            answer: answers.get( challenge.challengeType )!.state.read()
          } : null,
          ...readFields( results ),
          timerRunning: model.timer.isRunning
        } : null
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applySettings = prepareFields( settings, state );
      const { challenges, best: savedBest } = state;
      if ( !Array.isArray( challenges ) || challenges.length !== best.length ||
           !Array.isArray( savedBest ) || savedBest.length !== best.length ) {
        throw new Error( 'Invalid atom game levels.' );
      }
      const levels = challenges.map( ( level, levelIndex ) => {
        if ( !Array.isArray( level ) || level.length !== GameModel.CHALLENGES_PER_LEVEL ) {
          throw new Error( 'Invalid atom game challenge count.' );
        }
        return level.map( challenge => prepareDescriptor( challenge, levelIndex ) );
      } );
      const applyBest = best.map( ( fields, index ) => prepareFields( fields, savedBest[ index ] ) );
      let applyGame = () => {};
      if ( state.game !== null ) {
        const game = object( state.game );
        const { level, challenge, timerRunning } = game;
        const stage = GameStateValues.find( value => value === game.stage );
        if ( typeof level !== 'number' || !Number.isInteger( level ) || !model.levels[ level - 1 ] ||
             typeof challenge !== 'number' || !Number.isInteger( challenge ) || challenge < 1 || challenge > GameModel.CHALLENGES_PER_LEVEL ||
             !stage || stage === 'levelSelection' ||
             ( stage === 'levelCompleted' && ( game.current !== null || challenge !== GameModel.CHALLENGES_PER_LEVEL ) ) ||
             typeof timerRunning !== 'boolean' || ( timerRunning && ( !state.timerEnabled || stage === 'levelCompleted' ) ) ) {
          throw new Error( 'Invalid atom game progress.' );
        }
        const current = stage === 'levelCompleted' ? null : object( game.current );
        const descriptor = current && prepareDescriptor( current, level - 1 );
        const applyAnswer = descriptor && descriptor.state.prepare( current!.answer );
        const applyResults = prepareFields( results, game );
        applyGame = () => {
          model.levelProperty.value = model.levels[ level - 1 ];
          model.challengeNumberProperty.value = challenge;
          model.timer.stop();
          if ( timerRunning ) {
            model.timer.start();
          }
          applyResults();
          if ( descriptor ) {
            descriptor.challenge.correctAnswerAtom.setSubAtomicParticleCount( ...descriptor.atom );
            model.challengeProperty.value = descriptor.challenge;
            const challengeView = view[ 'challengeViewSet' ].get( descriptor.challenge );
            if ( stage === 'presentingChallenge' ) {
              challengeView.handleStateChange( stage );
            }
            applyAnswer?.();
          }
          applyBest.forEach( restore => restore() );
          model.gameStateProperty.value = stage;
          if ( !descriptor ) {
            model.challengeProperty.value = null;
          }
        };
      }
      return () => {
        view.interruptSubtreeInput();
        model.startOver();
        applySettings();
        model.levels.forEach( ( level, index ) => {
          level.challengeDescriptors = levels[ index ].map( descriptor => descriptor.create() );
        } );
        applyBest.forEach( restore => restore() );
        applyGame();
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const [ atom, symbol, game ] = sim.simScreens;
    const preferences = { chargeNotation: enumeration( BAAPreferences.instance.chargeNotationProperty ) };
    return {
      bridge: 'webwriter-build-an-atom/v1',
      build: 'build-an-atom@1.10.0-dev.0-webwriter.1',
      screens: [
        { id: 'atom', screen: atom, ...atomScreen( atom ) },
        { id: 'symbol', screen: symbol, ...atomScreen( symbol ) },
        { id: 'game', screen: game, ...gameScreen( game ) }
      ],
      readPreferences: () => readFields( preferences ),
      preparePreferences: input => prepareFields( preferences, input )
    };
  } );
}
