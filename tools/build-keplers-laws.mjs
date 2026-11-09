#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const lock = JSON.parse( readFileSync( join( packageRoot, 'tools/keplers-laws-build.lock.json' ), 'utf8' ) );
const cacheParent = process.env.PHET_KEPLERS_BUILD_DIR || join( tmpdir(), 'webwriter-keplers-poc', 'builds' );
mkdirSync( cacheParent, { recursive: true } );
const workspace = mkdtempSync( join( cacheParent, 'keplers-laws-' ) );
const sourceDir = join( workspace, 'keplers-laws' );
const outputDir = join( packageRoot, 'sims' );
const publicRepos = [
  ...Object.entries( lock.dependencies ).map( ( [ name, pin ] ) => ( {
    name,
    url: `https://github.com/phetsims/${name === 'perennial-alias' ? 'perennial' : name}.git`,
    commit: pin.sha
  } ) ),
  { name: 'babel', url: lock.babel.repository, commit: lock.babel.commit }
];

function run( command, args, cwd = packageRoot ) {
  execFileSync( command, args, { cwd, stdio: 'inherit' } );
}

function syncRepository( name, url, commit ) {
  const directory = join( workspace, name );
  mkdirSync( directory, { recursive: true } );
  run( 'git', [ 'init', '--quiet', '--initial-branch=main', directory ] );
  run( 'git', [ '-C', directory, 'remote', 'add', 'origin', url ] );
  run( 'git', [ '-C', directory, 'fetch', '--depth=1', 'origin', commit ] );
  run( 'git', [ '-C', directory, 'checkout', '--quiet', '--detach', 'FETCH_HEAD' ] );
  const actualCommit = execFileSync( 'git', [ '-C', directory, 'rev-parse', 'HEAD' ], { encoding: 'utf8' } ).trim();
  if ( actualCommit !== commit ) {
    throw new Error( `Fetched ${name} at ${actualCommit}; expected ${commit}.` );
  }
  return directory;
}

function patchSupportedBrand() {
  const path = join( sourceDir, 'package.json' );
  const packageJson = JSON.parse( readFileSync( path, 'utf8' ) );
  const brands = packageJson.phet?.supportedBrands;
  if ( !Array.isArray( brands ) ) {
    throw new Error( 'Pinned Kepler\'s Laws package has no supportedBrands array.' );
  }
  if ( !brands.includes( 'adapted-from-phet' ) ) {
    brands.push( 'adapted-from-phet' );
  }
  writeFileSync( path, `${JSON.stringify( packageJson, null, 2 )}\n` );
}

function patchJoistAvailableScreens() {
  const path = join( workspace, 'joist/js/Sim.ts' );
  const original = '  private availableScreensProperty!: Property<number[]>;';
  const replacement = '  public availableScreensProperty!: Property<number[]>;';
  const source = readFileSync( path, 'utf8' );
  if ( source.includes( replacement ) ) {
    return;
  }
  if ( !source.includes( original ) ) {
    throw new Error( 'Pinned Joist declaration changed; expected availableScreensProperty to be private.' );
  }
  writeFileSync( path, source.replace( original, replacement ) );
}

function installAdapter() {
  const adapterSourceDir = join( packageRoot, 'adaptations/keplers-laws' );
  const adapterFiles = readdirSync( adapterSourceDir ).filter( name => name.endsWith( '.ts' ) ).sort();
  if ( !adapterFiles.length || !adapterFiles.includes( 'install.ts' ) ) {
    throw new Error( `Expected TypeScript adapter sources in ${adapterSourceDir}` );
  }
  const adapterTargetDir = join( sourceDir, 'js/webwriter' );
  mkdirSync( adapterTargetDir, { recursive: true } );
  for ( const file of adapterFiles ) {
    copyFileSync( join( adapterSourceDir, file ), join( adapterTargetDir, file ) );
  }

  const mainPath = join( sourceDir, 'js/keplers-laws-main.ts' );
  let source = readFileSync( mainPath, 'utf8' );
  const existingImport = "import installWebWriter from './webwriter/install.js';";
  const anchor = "import KeplersLawsPreferencesNode from './common/view/KeplersLawsPreferencesNode.js';";
  if ( !source.includes( existingImport ) ) {
    if ( !source.includes( anchor ) ) {
      throw new Error( 'Pinned launcher import anchor changed.' );
    }
    source = source.replace( anchor, `${anchor}\n${existingImport}` );
  }
  const call = '  installWebWriter( sim, screens );';
  if ( !source.includes( call ) ) {
    if ( !source.includes( '  sim.start();' ) ) {
      throw new Error( 'Pinned launcher sim.start() call changed.' );
    }
    source = source.replace( '  sim.start();', `  sim.start();\n${call}` );
  }
  writeFileSync( mainPath, source );
}

function emitArtifact() {
  const htmlPath = join( sourceDir, 'build/adapted-from-phet/keplers-laws_all_adapted-from-phet.html' );
  const html = readFileSync( htmlPath, 'utf8' );
  const gpl = readFileSync( join( sourceDir, 'LICENSE' ) );
  mkdirSync( outputDir, { recursive: true } );
  writeFileSync( join( outputDir, 'LICENSE-keplers-laws' ), gpl );

  const notice = [
    'Kepler\'s Laws 1.2.11 adapted-from-phet, built from the public PhET source release.',
    `Source: ${lock.source.repository} at ${lock.source.commit}.`,
    `WebWriter adapter sources: adaptations/keplers-laws/*.ts (see ${lock.source.license} license text in LICENSE-keplers-laws).`,
    'The embedded PhET HTML retains its CC BY-NC 4.0 attribution and bundled third-party license notices.'
  ].join( '\n * ' );
  const moduleSource = `/*\n * ${notice}\n */\nexport default ${JSON.stringify( html )};\n`;
  writeFileSync( join( outputDir, 'keplers-laws.js' ), moduleSource );
  console.log( `Wrote sims/keplers-laws.js from ${htmlPath}` );
}

if ( ![ '22', '24' ].includes( process.versions.node.split( '.' )[ 0 ] ) ) {
  console.warn( `PhET recommends Node.js 22 or 24; current version is ${process.versions.node}.` );
}

syncRepository( 'keplers-laws', lock.source.repository, lock.source.commit );
for ( const repository of publicRepos ) {
  syncRepository( repository.name, repository.url, repository.commit );
}

patchSupportedBrand();
patchJoistAvailableScreens();
installAdapter();

for ( const repository of [ 'chipper', 'perennial-alias', 'keplers-laws' ] ) {
  run( 'npm', [ 'ci', '--ignore-scripts' ], join( workspace, repository ) );
}

run( join( workspace, 'chipper/node_modules/.bin/grunt' ), [
  '--no-lint',
  '--no-report-media',
  '--brands=adapted-from-phet',
  `--locales=${lock.babel.locales.join( ',' )}`,
  '--allHTML'
], sourceDir );

emitArtifact();
console.log( `Pinned sources retained in ${workspace}` );
