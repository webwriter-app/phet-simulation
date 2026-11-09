// State bindings for the Equality Explorer family. Distributed under GPL-3.0.
import EqualityExplorerConstants from '../../../equality-explorer/js/common/EqualityExplorerConstants.js';
import EqualityExplorerQueryParameters from '../../../equality-explorer/js/common/EqualityExplorerQueryParameters.js';
import ConstantTermCreator from '../../../equality-explorer/js/common/model/ConstantTermCreator.js';
import EqualityExplorerModel from '../../../equality-explorer/js/common/model/EqualityExplorerModel.js';
import EqualityExplorerScene from '../../../equality-explorer/js/common/model/EqualityExplorerScene.js';
import ObjectTermCreator from '../../../equality-explorer/js/common/model/ObjectTermCreator.js';
import Plate from '../../../equality-explorer/js/common/model/Plate.js';
import Snapshot from '../../../equality-explorer/js/common/model/Snapshot.js';
import Term from '../../../equality-explorer/js/common/model/Term.js';
import VariableTermCreator from '../../../equality-explorer/js/common/model/VariableTermCreator.js';
import EqualityExplorerScreenView from '../../../equality-explorer/js/common/view/EqualityExplorerScreenView.js';
import OperationsScene from '../../../equality-explorer/js/operations/model/OperationsScene.js';
import Challenge from '../../../equality-explorer/js/solveit/model/Challenge.js';
import SolveItLevel from '../../../equality-explorer/js/solveit/model/SolveItLevel.js';
import SolveItModel from '../../../equality-explorer/js/solveit/model/SolveItModel.js';
import SolveItScreenView from '../../../equality-explorer/js/solveit/view/SolveItScreenView.js';
import type { AnyScreen } from '../../../joist/js/Screen.js';
import Fraction from '../../../phetcommon/js/model/Fraction.js';
import Node from '../../../scenery/js/nodes/Node.js';
import soundManager from '../../../tambo/js/soundManager.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

function integer( input: unknown, min: number, max: number ) {
  if ( typeof input !== 'number' || !Number.isSafeInteger( input ) || input < min || input > max ) {
    throw new Error( 'Invalid Equality Explorer integer.' );
  }
  return input;
}

function indexed<T>( property: { value: T }, values: readonly T[] ) {
  return field( property, value => values.indexOf( value ),
    value => typeof value === 'number' && Number.isInteger( value ) ? values[ value ] : undefined );
}

function list( value: unknown, min: number, max = min ): unknown[] {
  if ( !Array.isArray( value ) || value.length < min || value.length > max ) {
    throw new Error( 'Invalid Equality Explorer list.' );
  }
  return value;
}

function readFraction( fraction: Fraction ): [ number, number ] {
  return [ fraction.numerator, fraction.denominator ];
}

function restoreFraction( input: unknown, limit: number ) {
  const [ numerator, denominator ] = list( input, 2 );
  const divisor = integer( denominator, -limit, limit );
  if ( divisor === 0 ) { throw new Error( 'Invalid Equality Explorer denominator.' ); }
  return new Fraction( integer( numerator, -limit, limit ), divisor );
}

function readTerm( term: Term, cell: number ) {
  return { cell, diameter: term.diameter, value: readFraction( term.significantValue ) };
}

function readPlate( plate: Plate, saved?: Snapshot[ 'leftPlateSnapshot' ] ) {
  return plate.termCreators.map( creator => saved ?
    saved.get( creator )!.map( entry => readTerm( entry.term, entry.cell ) ) :
    creator.getTermsOnPlate().map( term => readTerm( term, plate.getCellForTerm( term )! ) ) );
}

function preparePlate( input: unknown, plate: Plate ) {
  const occupied = new Set<number>();
  const size = plate.gridRows * plate.gridColumns;
  const placements = list( input, plate.termCreators.length ).flatMap( ( entries, i ) => {
    const creator = plate.termCreators[ i ];
    return list( entries, 0, creator.combineLikeTermsEnabled ? 1 : size ).map( entry => {
      const state = object( entry );
      const cell = integer( state.cell, 0, size - 1 );
      const diameter = state.diameter;
      const value = restoreFraction( state.value, EqualityExplorerQueryParameters.maxInteger );
      if ( occupied.has( cell ) || creator.combineLikeTermsEnabled && creator.likeTermsCell !== cell ||
           !value.isReduced() || value.getValue() === 0 ||
           !( diameter === EqualityExplorerConstants.SMALL_TERM_DIAMETER || diameter === EqualityExplorerConstants.BIG_TERM_DIAMETER ) ) {
        throw new Error( 'Invalid Equality Explorer plate term.' );
      }
      occupied.add( cell );
      const create = () => {
        if ( creator instanceof VariableTermCreator ) { return creator.createTerm( { coefficient: value, diameter } ); }
        if ( creator instanceof ConstantTermCreator ) { return creator.createTerm( { constantValue: value, diameter } ); }
        return creator.createTerm( { diameter } );
      };
      if ( creator instanceof ObjectTermCreator && value.getValue() !== 1 ) {
        throw new Error( 'Invalid Equality Explorer object.' );
      }
      return () => creator.putTermOnPlate( create(), cell );
    } );
  } );
  return () => placements.forEach( apply => apply() );
}

function sceneState( scene: EqualityExplorerScene ) {
  const { leftPlate, rightPlate } = scene.scale;
  const variables = scene.variables ?? [];
  const collection = scene.snapshotsCollection;
  const slots = collection.snapshotProperties;
  const fields = {
    ...( scene.lockedProperty ? { locked: boolean( scene.lockedProperty ) } : {} ),
    ...( scene instanceof OperationsScene ? {
      operator: indexed( scene.operatorProperty, scene.operators ),
      operand: indexed( scene.operandProperty, scene.operands )
    } : {} )
  };
  const preparePosition = ( input: unknown ) => {
    const state = object( input );
    const applyLeft = preparePlate( state.left, leftPlate );
    const applyRight = preparePlate( state.right, rightPlate );
    const values = list( state.variables, variables.length ).map( ( value, i ) => {
      if ( typeof value !== 'number' || !Number.isFinite( value ) || !variables[ i ].range.contains( value ) ) {
        throw new Error( 'Invalid Equality Explorer variable.' );
      }
      return value;
    } );
    return () => {
      scene.disposeAllTerms();
      variables.forEach( ( variable, i ) => { variable.valueProperty.value = values[ i ]; } );
      applyLeft();
      applyRight();
    };
  };
  return {
    read: () => ( {
      ...readFields( fields ),
      left: readPlate( leftPlate ),
      right: readPlate( rightPlate ),
      variables: variables.map( variable => variable.valueProperty.value ),
      selected: collection.selectedSnapshotProperty.value === null ? null :
        slots.findIndex( slot => slot.value === collection.selectedSnapshotProperty.value ),
      snapshots: slots.map( slot => {
        const snapshot = slot.value;
        return snapshot && {
          left: readPlate( leftPlate, snapshot[ 'leftPlateSnapshot' ] ),
          right: readPlate( rightPlate, snapshot[ 'rightPlateSnapshot' ] ),
          variables: variables.map( variable => snapshot[ 'variablesSnapshot' ].get( variable )! )
        };
      } )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyPosition = preparePosition( state );
      const applyControls = prepareFields( fields, state );
      const saved = list( state.snapshots, slots.length ).map( snapshot => snapshot === null ? null : preparePosition( snapshot ) );
      const selected = state.selected === null ? null : integer( state.selected, 0, slots.length - 1 );
      if ( selected !== null && !saved[ selected ] ) {
        throw new Error( 'Invalid Equality Explorer snapshot selection.' );
      }
      return () => {
        collection.reset();
        saved.forEach( ( apply, i ) => {
          if ( apply ) {
            apply();
            slots[ i ].value = new Snapshot( scene );
          }
        } );
        applyPosition();
        applyControls();
        collection.selectedSnapshotProperty.value = selected === null ? null : slots[ selected ].value;
      };
    }
  };
}

function explorationState( screen: AnyScreen, model: EqualityExplorerModel ) {
  const view = screen.view as EqualityExplorerScreenView;
  const scenes = model.scenes.map( sceneState );
  const fields = {
    scene: indexed( model.sceneProperty, model.scenes ),
    equationExpanded: boolean( view[ 'equationAccordionBoxExpandedProperty' ] ),
    snapshotsExpanded: boolean( view[ 'snapshotsAccordionBoxExpandedProperty' ] )
  };
  return {
    read: () => ( { ...readFields( fields ), scenes: scenes.map( scene => scene.read() ) } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const applyScenes = list( state.scenes, scenes.length ).map( ( entry, i ) => scenes[ i ].prepare( entry ) );
      return () => {
        view.interruptSubtreeInput();
        applyScenes.forEach( apply => apply() );
        applyFields();
      };
    }
  };
}

function readChallenge( challenge: Challenge | null ) {
  return challenge && {
    x: challenge.x,
    a: readFraction( challenge.a ),
    b: readFraction( challenge.b ),
    m: readFraction( challenge.m ),
    n: readFraction( challenge.n )
  };
}

function restoreChallenge( input: unknown ) {
  if ( input === null ) { return null; }
  const state = object( input );
  const x = integer( state.x, -10000, 10000 );
  const limit = EqualityExplorerQueryParameters.maxInteger;
  const [ a, b, m, n ] = [ state.a, state.b, state.m, state.n ].map( value => restoreFraction( value, limit ) );
  const evaluate = ( coefficient: Fraction, constant: Fraction ) => [
    BigInt( coefficient.numerator ) * BigInt( x ) * BigInt( constant.denominator ) +
    BigInt( constant.numerator ) * BigInt( coefficient.denominator ),
    BigInt( coefficient.denominator ) * BigInt( constant.denominator )
  ];
  const [ left, leftDivisor ] = evaluate( a, b );
  const [ right, rightDivisor ] = evaluate( m, n );
  if ( left * rightDivisor !== right * leftDivisor || a.getValue() === m.getValue() ) {
    throw new Error( 'Invalid Equality Explorer equation.' );
  }
  return new Challenge( x, a, b, m, n, '' );
}

function namedNode( node: Node, name: string ): Node | undefined {
  if ( node.tandem.name === name ) { return node; }
  for ( const child of node.children ) {
    const match = namedNode( child, name );
    if ( match ) { return match; }
  }
  return undefined;
}

function levelState( level: SolveItLevel, levelView: SolveItScreenView[ 'levelNodes' ][ number ] ) {
  const scene = sceneState( level );
  const nextButton = namedNode( levelView, 'nextButton' );
  const refreshButton = namedNode( levelView, 'refreshButton' );
  const face = namedNode( levelView, 'faceNode' );
  const fields = { score: number( level.scoreProperty, true, value => value >= 0 ) };
  return {
    read: () => ( {
      ...readFields( fields ),
      scene: scene.read(),
      challenge: readChallenge( level.challengeProperty.value ),
      solved: level[ 'challengeHasBeenSolved' ],
      xOnLeft: level[ 'xOnLeft' ]
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const { solved, xOnLeft } = state;
      const challenge = restoreChallenge( state.challenge );
      const applyFields = prepareFields( fields, state );
      const applyScene = scene.prepare( state.scene );
      if ( typeof solved !== 'boolean' || typeof xOnLeft !== 'boolean' || solved && !challenge ) {
        throw new Error( 'Invalid Equality Explorer level.' );
      }
      return {
        challenge,
        apply: () => {
          levelView[ 'faceAnimation' ]?.stop();
          levelView[ 'faceAnimation' ] = null;
          applyFields();
          level.disposeAllTerms();
          if ( challenge ) {
            // The original equation panel takes its contents from the scale when the challenge changes.
            level.variables![ 0 ].valueProperty.value = challenge.x;
            const [ left, right ] = xOnLeft ?
              [ level.leftTermCreators, level.rightTermCreators ] : [ level.rightTermCreators, level.leftTermCreators ];
            level[ 'createVariableTermOnPlate' ]( left[ 0 ] as VariableTermCreator, challenge.a );
            level[ 'createConstantTermOnPlate' ]( left[ 1 ] as ConstantTermCreator, challenge.b );
            level[ 'createVariableTermOnPlate' ]( right[ 0 ] as VariableTermCreator, challenge.m );
            level[ 'createConstantTermOnPlate' ]( right[ 1 ] as ConstantTermCreator, challenge.n );
          }
          level.challengeProperty.value = challenge;
          level[ 'challengeHasBeenSolved' ] = solved;
          level[ 'xOnLeft' ] = xOnLeft;
          applyScene();
          levelView[ 'faceAnimation' ]?.stop();
          levelView[ 'faceAnimation' ] = null;
          if ( nextButton ) { nextButton.visible = solved; }
          if ( refreshButton ) { refreshButton.visible = !solved; }
          if ( face ) { face.visible = false; }
        }
      };
    }
  };
}

function solveItState( screen: AnyScreen, model: SolveItModel ) {
  const view = screen.view as SolveItScreenView;
  const fields = { snapshotsExpanded: boolean( view[ 'snapshotsAccordionBoxExpandedProperty' ] ) };
  const levels = model.levels.map( ( level, i ) => levelState( level, view[ 'levelNodes' ][ i ] ) );
  return {
    read: () => ( {
      ...readFields( fields ),
      selected: model.levelProperty.value === null ? null : model.levels.indexOf( model.levelProperty.value ),
      levels: levels.map( level => level.read() )
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const selected = state.selected === null ? null : integer( state.selected, 0, levels.length - 1 );
      const applyFields = prepareFields( fields, state );
      const changes = list( state.levels, levels.length ).map( ( entry, i ) => levels[ i ].prepare( entry ) );
      if ( selected !== null && changes[ selected ].challenge === null ) {
        throw new Error( 'The selected Equality Explorer level is missing its challenge.' );
      }
      return () => {
        view.interruptSubtreeInput();
        const sound = soundManager.enabled;
        const reward = model.rewardScoreProperty.value;
        soundManager.enabled = false;
        model.rewardScoreProperty.value = Number.MAX_SAFE_INTEGER;
        try {
          changes.forEach( change => change.apply() );
        }
        finally {
          model.rewardScoreProperty.value = reward;
          soundManager.enabled = sound;
        }
        applyFields();
        model.levelProperty.value = selected === null ? null : model.levels[ selected ];
      };
    }
  };
}

export function equalityExplorerState( screen: AnyScreen ) {
  const model = screen.model as SolveItModel | EqualityExplorerModel;
  return model instanceof SolveItModel ? solveItState( screen, model ) : explorationState( screen, model );
}
