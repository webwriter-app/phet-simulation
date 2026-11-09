// Gene Expression Essentials WebWriter adapter. Distributed under GPL-3.0.
import type Sim from '../../../joist/js/Sim.js';
import Vector2 from '../../../dot/js/Vector2.js';
import Vector3 from '../../../dot/js/Vector3.js';
import type Node from '../../../scenery/js/nodes/Node.js';
import GEEConstants from '../common/GEEConstants.js';
import MessengerRna from '../common/model/MessengerRna.js';
import MessengerRnaDestroyer from '../common/model/MessengerRnaDestroyer.js';
import type MobileBiomolecule from '../common/model/MobileBiomolecule.js';
import Protein from '../common/model/Protein.js';
import Ribosome from '../common/model/Ribosome.js';
import RnaPolymerase from '../common/model/RnaPolymerase.js';
import TranscriptionFactor from '../common/model/TranscriptionFactor.js';
import MeanderToDestinationMotionStrategy from '../common/model/motion-strategies/MeanderToDestinationMotionStrategy.js';
import type ManualGeneExpressionModel from '../manual-gene-expression/model/ManualGeneExpressionModel.js';
import ProteinA from '../manual-gene-expression/model/ProteinA.js';
import ProteinB from '../manual-gene-expression/model/ProteinB.js';
import ProteinC from '../manual-gene-expression/model/ProteinC.js';
import MessengerRnaProductionModel from '../mrna-production/model/MessengerRnaProductionModel.js';
import type MessengerRnaProductionScreenView from '../mrna-production/view/MessengerRnaProductionScreenView.js';
import CellProteinSynthesisSimulator from '../multiple-cells/model/CellProteinSynthesisSimulator.js';
import type MultipleCellsModel from '../multiple-cells/model/MultipleCellsModel.js';
import type MultipleCellsScreenView from '../multiple-cells/view/MultipleCellsScreenView.js';
import ParameterControlAccordionBox from '../multiple-cells/view/ParameterControlAccordionBox.js';
import installSimulationBridge from './installSimulationBridge.js';
import { boolean, field, number, object, prepareFields, readFields } from './stateFields.js';

type Screen = Sim[ 'simScreens' ][ number ];
type MoleculeModel = ManualGeneExpressionModel | MessengerRnaProductionModel;

const factorTypes = [
  TranscriptionFactor.TRANSCRIPTION_FACTOR_CONFIG_GENE_1_POS,
  TranscriptionFactor.TRANSCRIPTION_FACTOR_CONFIG_GENE_1_NEG,
  TranscriptionFactor.TRANSCRIPTION_FACTOR_CONFIG_GENE_2_POS_1,
  TranscriptionFactor.TRANSCRIPTION_FACTOR_CONFIG_GENE_2_POS_2,
  TranscriptionFactor.TRANSCRIPTION_FACTOR_CONFIG_GENE_2_NEG,
  TranscriptionFactor.TRANSCRIPTION_FACTOR_CONFIG_GENE_3_POS_1,
  TranscriptionFactor.TRANSCRIPTION_FACTOR_CONFIG_GENE_3_POS_2,
  TranscriptionFactor.TRANSCRIPTION_FACTOR_CONFIG_GENE_3_NEG
];

function finite( input: unknown, min: number, max: number ) {
  return typeof input === 'number' && Number.isFinite( input ) && input >= min && input <= max;
}

function point( input: unknown ) {
  if ( !Array.isArray( input ) || input.length !== 3 || !finite( input[ 0 ], -1e6, 1e6 ) ||
       !finite( input[ 1 ], -1e6, 1e6 ) || !finite( input[ 2 ], -1, 0 ) ) {
    throw new Error( 'Invalid biomolecule position.' );
  }
  return new Vector3( input[ 0 ], input[ 1 ], input[ 2 ] );
}

function moleculeType( molecule: MobileBiomolecule ) {
  if ( molecule instanceof TranscriptionFactor ) { return 'factor'; }
  if ( molecule instanceof RnaPolymerase ) { return 'polymerase'; }
  if ( molecule instanceof Ribosome ) { return 'ribosome'; }
  if ( molecule instanceof MessengerRnaDestroyer ) { return 'destroyer'; }
  if ( molecule instanceof ProteinA ) { return 'protein-a'; }
  if ( molecule instanceof ProteinB ) { return 'protein-b'; }
  if ( molecule instanceof ProteinC ) { return 'protein-c'; }
  throw new Error( 'Unknown mobile biomolecule.' );
}

function moleculeState( model: MoleculeModel, screen: Screen ) {
  const dna = model.getDnaMolecule();
  const genes = dna.getGenes();
  const production = model instanceof MessengerRnaProductionModel ? model : null;
  const manual = production ? null : model as ManualGeneExpressionModel;
  const view = screen.view as MessengerRnaProductionScreenView;
  const expectedPolymerases = model.mobileBiomoleculeList.filter( molecule => molecule instanceof RnaPolymerase ).length;
  const controls = production ? {
    negativeEnabled: boolean( view.negativeTranscriptionFactorEnabled ),
    positiveCount: number( production.positiveTranscriptionFactorCountProperty, false,
      value => finite( value, 0, MessengerRnaProductionModel.MAX_TRANSCRIPTION_FACTOR_COUNT ) ),
    negativeCount: number( production.negativeTranscriptionFactorCountProperty, false,
      value => finite( value, 0, MessengerRnaProductionModel.MAX_TRANSCRIPTION_FACTOR_COUNT ) ),
    polymeraseAffinity: number( production.gene.getPolymeraseAffinityProperty(), false, value => finite( value, 0, 1 ) ),
    positiveAffinity: number( production.gene.getTranscriptionFactorAffinityProperty( MessengerRnaProductionModel.POSITIVE_TRANSCRIPTION_FACTOR_CONFIG ),
      false, value => finite( value, 0, 1 ) ),
    negativeAffinity: number( production.gene.getTranscriptionFactorAffinityProperty( MessengerRnaProductionModel.NEGATIVE_TRANSCRIPTION_FACTOR_CONFIG ),
      false, value => finite( value, 0, 1 ) )
  } : {
    gene: field( manual!.activeGeneProperty, value => genes.indexOf( value ),
      value => typeof value === 'number' && Number.isInteger( value ) ? genes[ value ] : undefined ),
    collectedA: number( manual!.proteinACollectedProperty, true, value => value >= 0 ),
    collectedB: number( manual!.proteinBCollectedProperty, true, value => value >= 0 ),
    collectedC: number( manual!.proteinCCollectedProperty, true, value => value >= 0 )
  };
  const playback = production ? { playing: boolean( production.clockRunningProperty ) } : {};

  return {
    isPlaying: () => production ? production.clockRunningProperty.value :
      model.mobileBiomoleculeList.length > 0 || model.messengerRnaList.length > 0,
    read: () => {
      const molecules = model.mobileBiomoleculeList.filter( molecule =>
        !( molecule instanceof Protein ) || molecule.fullGrownProperty.value );
      return {
        ...readFields( controls ),
        ...readFields( playback ),
        molecules: molecules.map( molecule => {
          const position = molecule.getPosition3D();
          const machine = molecule.attachmentStateMachine;
          const polymerase = molecule instanceof RnaPolymerase ? molecule.rnaPolymeraseAttachmentStateMachine : null;
          const site = ( polymerase || molecule instanceof TranscriptionFactor ) && machine.attachmentSite &&
                       machine.attachmentSite !== polymerase?.transcribingAttachmentSite ? machine.attachmentSite : null;
          const phase = site ? machine.attachmentState === machine.movingTowardsAttachmentState ? 'approaching' :
                        polymerase && machine.attachmentState === polymerase.attachedAndConformingState ? 'conforming' :
                        'attached' : null;
          return {
            type: moleculeType( molecule ),
            position: [ position.x, position.y, position.z ],
            strength: molecule.existenceStrengthProperty.value,
            ...( molecule instanceof TranscriptionFactor ? { factor: factorTypes.indexOf( molecule.getConfig() ) } : {} ),
            ...( site ? {
              attachment: {
                basePair: dna.getBasePairIndexFromXOffset( site.positionProperty.value.x ),
                phase,
                conformation: phase === 'conforming' ? polymerase!.attachedAndConformingState.conformationalChangeAmount : 0
              }
            } : {} )
          };
        } ),
        rna: model.messengerRnaList.map( rna => {
          const position = rna.getPosition3D();
          const owner = molecules.findIndex( molecule => molecule instanceof RnaPolymerase &&
            molecule.rnaPolymeraseAttachmentStateMachine.attachedAndTranscribingState.messengerRna === rna );
          const gene = genes.findIndex( gene => gene.getProteinPrototype().constructor === rna.getProteinPrototype().constructor );
          return {
            gene,
            owner: owner < 0 ? null : owner,
            position: [ position.x, position.y, position.z ],
            length: rna.getLength(),
            strength: rna.existenceStrengthProperty.value
          };
        } )
      };
    },
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyControls = prepareFields( controls, state );
      const applyPlayback = prepareFields( playback, state );
      if ( !Array.isArray( state.molecules ) || state.molecules.length > 1000 ||
           !Array.isArray( state.rna ) || state.rna.length > 1000 ) {
        throw new Error( 'Invalid number of gene expression molecules.' );
      }
      const sites = new Set<string>();
      const species = state.molecules.map( input => {
        const state = object( input );
        const { type, factor, strength } = state;
        const position = point( state.position );
        if ( !finite( strength, Number.MIN_VALUE, 1 ) || ![ 'polymerase', 'factor', 'ribosome', 'destroyer',
          'protein-a', 'protein-b', 'protein-c' ].includes( type as string ) ||
             ( production && type !== 'polymerase' && type !== 'factor' ) ||
             ( type === 'factor' && ( typeof factor !== 'number' || !Number.isInteger( factor ) || !factorTypes[ factor ] ||
                                     ( production && factor > 1 ) ) ) ) {
          throw new Error( 'Invalid gene expression biomolecule.' );
        }
        const attachment = state.attachment === undefined ? null : object( state.attachment );
        if ( attachment ) {
          const { basePair, phase, conformation } = attachment;
          const key = `${type}:${factor ?? ''}:${basePair}`;
          if ( ( type !== 'polymerase' && type !== 'factor' ) || typeof basePair !== 'number' ||
               !Number.isInteger( basePair ) || basePair < 0 || basePair >= dna.basePairs.length || sites.has( key ) ||
               ( phase !== 'approaching' && phase !== 'attached' && ( phase !== 'conforming' || type !== 'polymerase' ) ) ||
               !finite( conformation, 0, 1 ) ) {
            throw new Error( 'Invalid DNA attachment site.' );
          }
          sites.add( key );
        }
        return { type, position, strength: strength as number, factor: factor as number, attachment };
      } );
      if ( production && ( species.filter( state => state.type === 'polymerase' ).length !== expectedPolymerases ||
           species.filter( state => state.type === 'factor' && state.factor === 0 ).length !== Math.round( state.positiveCount as number ) ||
           species.filter( state => state.type === 'factor' && state.factor === 1 ).length !== Math.round( state.negativeCount as number ) ||
           ( !state.negativeEnabled && state.negativeCount !== 0 ) ) ) {
        throw new Error( 'Molecule counts disagree with the transcription controls.' );
      }
      const owners = new Set<number>();
      const transcripts = state.rna.map( input => {
        const state = object( input );
        const { owner, gene, length, strength } = state;
        const geneModel = typeof gene === 'number' && Number.isInteger( gene ) ? genes[ gene ] : undefined;
        if ( !geneModel || !finite( length, 0, 40000 ) || !finite( strength, Number.MIN_VALUE, 1 ) ||
             ( owner !== null && ( typeof owner !== 'number' || !Number.isInteger( owner ) || owners.has( owner ) ||
               species[ owner ]?.type !== 'polymerase' || species[ owner ].attachment ||
               !finite( species[ owner ].position.x, geneModel.getStartX(), geneModel.getEndX() ) ||
               Math.abs( species[ owner ].position.y - GEEConstants.DNA_MOLECULE_Y_POS ) > GEEConstants.DNA_MOLECULE_DIAMETER / 2 ) ) ) {
          throw new Error( 'Invalid messenger RNA strand.' );
        }
        if ( owner !== null ) { owners.add( owner as number ); }
        return { owner: owner as number | null, gene: geneModel, length: length as number,
          strength: strength as number, position: point( state.position ) };
      } );
      return () => {
        screen.view.interruptSubtreeInput();
        model.reset();
        if ( production ) { production.clockRunningProperty.value = false; }
        applyControls();
        const polymerases = model.mobileBiomoleculeList.filter( molecule => molecule instanceof RnaPolymerase );
        let polymeraseIndex = 0;
        const factors = [ 0, 0 ];
        const restored = species.map( state => {
          let molecule: MobileBiomolecule;
          const initial = new Vector2( state.position.x, state.position.y );
          if ( state.type === 'factor' ) {
            if ( production ) {
              const list = state.factor === 0 ? production.positiveTranscriptionFactorList : production.negativeTranscriptionFactorList;
              molecule = list[ factors[ state.factor ]++ ];
            }
            else {
              molecule = new TranscriptionFactor( model, factorTypes[ state.factor ], initial );
            }
          }
          else if ( state.type === 'polymerase' ) {
            molecule = production ? polymerases[ polymeraseIndex++ ] : new RnaPolymerase( model, initial );
          }
          else if ( state.type === 'ribosome' ) { molecule = new Ribosome( model, initial ); }
          else if ( state.type === 'destroyer' ) { molecule = new MessengerRnaDestroyer( model, initial ); }
          else {
            const Ctor = state.type === 'protein-a' ? ProteinA : state.type === 'protein-b' ? ProteinB : ProteinC;
            const protein = new Ctor( model );
            protein.setFullSizeProportion( 1 );
            protein.release();
            molecule = protein;
          }
          molecule.setPosition3D( state.position );
          if ( manual ) { manual.addMobileBiomolecule( molecule ); }
          molecule.existenceStrengthProperty.value = state.strength;
          if ( state.attachment ) {
            const { basePair, phase, conformation } = state.attachment;
            const machine = molecule.attachmentStateMachine;
            const site = molecule instanceof TranscriptionFactor ?
              dna.getTranscriptionFactorAttachmentSiteForBasePairIndex( basePair, molecule.getConfig() ) :
              dna.getRnaPolymeraseAttachmentSiteForBasePairIndex( basePair );
            machine.attachmentSite = site;
            site.attachedOrAttachingMoleculeProperty.value = molecule;
            if ( phase === 'approaching' ) {
              molecule.setMotionStrategy( new MeanderToDestinationMotionStrategy( site.positionProperty, molecule.motionBoundsProperty,
                machine.destinationOffset ) );
              machine.setState( machine.movingTowardsAttachmentState );
            }
            else if ( phase === 'conforming' && molecule instanceof RnaPolymerase ) {
              const asm = molecule.rnaPolymeraseAttachmentStateMachine;
              molecule.attachedToDnaProperty.value = true;
              asm.setState( asm.attachedAndConformingState );
              asm.attachedAndConformingState.conformationalChangeAmount = conformation;
              molecule.changeConformation( conformation );
              asm.dnaStrandSeparation.setProportionOfTargetAmount( conformation );
            }
            else {
              machine.setState( machine.attachedState );
            }
          }
          return molecule;
        } );
        transcripts.forEach( state => {
          let rna: MessengerRna;
          if ( state.owner !== null ) {
            const polymerase = restored[ state.owner ] as RnaPolymerase;
            const machine = polymerase.rnaPolymeraseAttachmentStateMachine;
            machine.attachmentSite = state.gene.getPolymeraseAttachmentSite();
            polymerase.attachedToDnaProperty.value = true;
            machine.setState( machine.attachedAndConformingState );
            polymerase.changeConformation( 1 );
            machine.dnaStrandSeparation.setProportionOfTargetAmount( 1 );
            machine.setState( machine.attachedAndTranscribingState );
            rna = machine.attachedAndTranscribingState.messengerRna;
          }
          else {
            rna = new MessengerRna( model, state.gene.getProteinPrototype(), new Vector2( state.position.x, state.position.y ),
              { windingParamSet: state.gene.windingAlgorithmParameterSet } );
            model.addMessengerRna( rna );
            rna.beingSynthesizedProperty.value = false;
            if ( production ) { rna.releaseFromPolymerase(); }
            else { rna.attachmentStateMachine.forceImmediateUnattachedAndAvailable(); }
          }
          if ( state.length > 0 ) { rna.addLength( state.length ); }
          rna.setPosition3D( state.position );
          rna.existenceStrengthProperty.value = state.strength;
        } );
        dna.step( 0 );
        applyPlayback();
      };
    }
  };
}

function descendants( node: Node ): Node[] {
  return node.children.flatMap( child => [ child, ...descendants( child ) ] );
}

function cellsState( screen: Screen ) {
  const model = screen.model as MultipleCellsModel;
  const view = screen.view as MultipleCellsScreenView;
  const chart = view.proteinLevelChartNode;
  const panels = descendants( view ).filter( node => node instanceof ParameterControlAccordionBox );
  const rate = ( property: { value: number }, range: { contains: ( value: number ) => boolean } ) =>
    number( property, false, value => range.contains( value ) );
  const fields = {
    visibleCells: number( model.numberOfVisibleCellsProperty, false, value => finite( value, 1, model.cellList.length ) ),
    transcriptionFactor: rate( model.transcriptionFactorLevelProperty, CellProteinSynthesisSimulator.TranscriptionFactorCountRange ),
    proteinDegradation: rate( model.proteinDegradationRateProperty, CellProteinSynthesisSimulator.ProteinDegradationRange ),
    transcriptionAffinity: rate( model.transcriptionFactorAssociationProbabilityProperty, CellProteinSynthesisSimulator.TFAssociationProbabilityRange ),
    polymeraseAffinity: rate( model.polymeraseAssociationProbabilityProperty, CellProteinSynthesisSimulator.PolymeraseAssociationProbabilityRange ),
    mrnaDegradation: rate( model.mRnaDegradationRateProperty, CellProteinSynthesisSimulator.MRNADegradationRateRange ),
    playing: boolean( model.clockRunningProperty )
  };
  const panelFields = panels.map( panel => boolean( panel.expandedProperty ) );
  return {
    isPlaying: () => model.clockRunningProperty.value,
    read: () => ( {
      ...readFields( fields ),
      panels: panelFields.map( panel => panel.read() ),
      cells: model.cellList.map( cell => cell.proteinSynthesisSimulator.objectCounts.slice() ),
      averageProtein: model.averageProteinLevelProperty.value,
      chart: {
        time: chart.simRunningTime,
        offset: chart.timeOffset,
        points: Array.from( { length: chart.dataSeries.getLength() }, ( _, index ) => {
          const point = chart.dataSeries.getDataPoint( index );
          return [ point.x, point.y ];
        } )
      }
    } ),
    prepare: ( input: unknown ) => {
      const state = object( input );
      const applyFields = prepareFields( fields, state );
      const { panels, cells, averageProtein } = state;
      if ( !Array.isArray( panels ) || panels.length !== panelFields.length ||
           !Array.isArray( cells ) || cells.length !== model.cellList.length ||
           !finite( averageProtein, 0, 1e7 ) ||
           !cells.every( counts => Array.isArray( counts ) && counts.length === 9 &&
             counts.every( ( count, index ) => finite( count, 0, 1e7 ) && ( index === 1 || Number.isInteger( count ) ) ) &&
             counts[ 0 ] + counts[ 3 ] + counts[ 4 ] === 20 && counts[ 2 ] + counts[ 4 ] === 5000 &&
             counts[ 6 ] + counts[ 7 ] === 100 ) ) {
        throw new Error( 'Invalid cellular protein synthesis state.' );
      }
      const applyPanels = panelFields.map( ( panel, index ) => panel.prepare( panels[ index ], 'cell controls' ) );
      const { time, offset, points } = object( state.chart );
      if ( !finite( time, 0, Number.MAX_SAFE_INTEGER ) || !finite( offset, 0, time as number ) ||
           !Array.isArray( points ) || points.length > 10000 || !points.every( ( point, index ) =>
             Array.isArray( point ) && point.length === 2 && finite( point[ 0 ], 0, 30 ) && finite( point[ 1 ], 0, 1e7 ) &&
             ( index === 0 || point[ 0 ] >= points[ index - 1 ][ 0 ] ) ) ) {
        throw new Error( 'Invalid protein chart history.' );
      }
      return () => {
        view.interruptSubtreeInput();
        applyFields();
        applyPanels.forEach( apply => apply() );
        model.cellList.forEach( ( cell, index ) => {
          const counts = cell.proteinSynthesisSimulator.objectCounts;
          counts.splice( 0, counts.length, ...cells[ index ] );
          cell.proteinCount.value = cell.proteinSynthesisSimulator.getProteinCount();
        } );
        model.averageProteinLevelProperty.value = averageProtein as number;
        chart.reset();
        chart.simRunningTime = time as number;
        chart.timeOffset = offset as number;
        points.forEach( ( [ time, count ] ) => chart.dataSeries.addXYDataPoint( time, count ) );
      };
    }
  };
}

export default function installWebWriter( sim: Sim ): void {
  installSimulationBridge( sim, () => {
    const [ manual, production, cells ] = sim.simScreens;
    return {
      bridge: 'webwriter-gene-expression-essentials/v1',
      build: 'gene-expression-essentials@1.1.0-dev.0-webwriter.1',
      screens: [
        { id: 'gene-expression', screen: manual, ...moleculeState( manual.model as ManualGeneExpressionModel, manual ) },
        { id: 'mrna-production', screen: production, ...moleculeState( production.model as MessengerRnaProductionModel, production ) },
        { id: 'multiple-cells', screen: cells, ...cellsState( cells ) }
      ]
    };
  } );
}
