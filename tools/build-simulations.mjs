#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const keplerLock = JSON.parse( readFileSync( join( packageRoot, 'tools/keplers-laws-build.lock.json' ), 'utf8' ) );
const pilotLock = JSON.parse( readFileSync( join( packageRoot, 'tools/pilot-build.lock.json' ), 'utf8' ) );
const sources = {
  'keplers-laws': keplerLock.source,
  'ohms-law': {
    repository: 'https://github.com/phetsims/ohms-law.git',
    commit: 'c3d66432b7497b2ea3e5e45c054f6ae0d0874092',
    version: '1.5.0-dev.6',
    license: 'GPL-3.0'
  },
  'pendulum-lab': {
    repository: 'https://github.com/phetsims/pendulum-lab.git',
    commit: 'c87eecd55a11cd4e861d7b842ad944b5a531b358',
    version: '1.1.0-dev.5',
    license: 'GPL-3.0'
  }
};
const requested = process.argv.slice( 2 );
const names = requested.length ? [ ...new Set( requested ) ] : Object.keys( sources );
for ( const name of names ) {
  if ( !Object.hasOwn( sources, name ) ) {
    throw new Error( `Unknown simulation: ${name}.` );
  }
}

const cacheParent = process.env.PHET_BUILD_DIR || process.env.PHET_KEPLERS_BUILD_DIR || join( tmpdir(), 'webwriter-phet-builds' );
mkdirSync( cacheParent, { recursive: true } );
const outputDir = join( packageRoot, 'sims' );

function run( command, args, cwd = packageRoot ) {
  execFileSync( command, args, { cwd, stdio: 'inherit' } );
}

function syncRepository( workspace, name, url, commit ) {
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

function patchSupportedBrand( sourceDir ) {
  const path = join( sourceDir, 'package.json' );
  const packageJson = JSON.parse( readFileSync( path, 'utf8' ) );
  const brands = packageJson.phet?.supportedBrands;
  if ( !Array.isArray( brands ) ) {
    throw new Error( 'Pinned simulation package has no supportedBrands array.' );
  }
  if ( !brands.includes( 'adapted-from-phet' ) ) {
    brands.push( 'adapted-from-phet' );
  }
  writeFileSync( path, `${JSON.stringify( packageJson, null, 2 )}\n` );
}

function patchJoistAvailableScreens( workspace ) {
  const path = join( workspace, 'joist/js/Sim.ts' );
  const source = readFileSync( path, 'utf8' );
  const declaration = /^  (?:declare )?private availableScreensProperty!?: Property<number\[\]>;$/m;
  if ( !declaration.test( source ) ) {
    throw new Error( 'Pinned Joist declaration changed; expected availableScreensProperty to be private.' );
  }
  writeFileSync( path, source.replace( declaration, line => line.replace( 'private', 'public' ) ) );
}

function installAdapter( name, sourceDir ) {
  const adapterSourceDir = join( packageRoot, 'adaptations', name );
  const adapterFiles = readdirSync( adapterSourceDir ).filter( name => name.endsWith( '.ts' ) ).sort();
  if ( !adapterFiles.length || !adapterFiles.includes( 'install.ts' ) ) {
    throw new Error( `Expected TypeScript adapter sources in ${adapterSourceDir}` );
  }
  const adapterTargetDir = join( sourceDir, 'js/webwriter' );
  mkdirSync( adapterTargetDir, { recursive: true } );
  const sharedDir = join( packageRoot, 'adaptations/shared' );
  for ( const file of readdirSync( sharedDir ).filter( name => name.endsWith( '.ts' ) ) ) {
    copyFileSync( join( sharedDir, file ), join( adapterTargetDir, file ) );
  }
  for ( const file of adapterFiles ) {
    copyFileSync( join( adapterSourceDir, file ), join( adapterTargetDir, file ) );
  }

  const mainDir = join( sourceDir, 'js' );
  const mainFile = readdirSync( mainDir ).find( file => file === `${name}-main.ts` || file === `${name}-main.js` );
  if ( !mainFile ) {
    throw new Error( `No launcher found for ${name}.` );
  }
  const mainPath = join( mainDir, mainFile );
  const source = readFileSync( mainPath, 'utf8' );
  const start = '  sim.start();';
  if ( !source.includes( start ) ) {
    throw new Error( `Pinned ${name} launcher has no sim.start() call.` );
  }
  const adapterImport = "import installWebWriter from './webwriter/install.js';";
  writeFileSync( mainPath, `${adapterImport}\n${source.replace( start, `${start}\n  installWebWriter( sim );` )}` );

}

function emitArtifact( name, sourceDir, pin ) {
  const htmlPath = join( sourceDir, `build/adapted-from-phet/${name}_all_adapted-from-phet.html` );
  const html = readFileSync( htmlPath, 'utf8' );
  const gpl = readFileSync( join( sourceDir, 'LICENSE' ) );
  mkdirSync( outputDir, { recursive: true } );
  writeFileSync( join( outputDir, `LICENSE-${name}` ), gpl );

  const notice = [
    `${name} ${pin.version} adapted-from-phet, built from public PhET source.`,
    `Source: ${pin.repository} at ${pin.commit}.`,
    `WebWriter adapter sources: adaptations/${name}/ and adaptations/shared/ (see ${pin.license} license text in LICENSE-${name}).`,
    'The embedded PhET HTML retains its CC BY-NC 4.0 attribution and bundled third-party license notices.'
  ].join( '\n * ' );
  const moduleSource = `/*\n * ${notice}\n */\nexport default ${JSON.stringify( html )};\n`;
  writeFileSync( join( outputDir, `${name}.js` ), moduleSource );
  console.log( `Wrote sims/${name}.js from ${htmlPath}` );
}

if ( ![ '22', '24' ].includes( process.versions.node.split( '.' )[ 0 ] ) ) {
  console.warn( `PhET recommends Node.js 22 or 24; current version is ${process.versions.node}.` );
}

function build( names, lock ) {
  if ( !names.length ) {
    return;
  }
  const workspace = mkdtempSync( join( cacheParent, 'phet-' ) );
  for ( const [ name, pin ] of Object.entries( lock.dependencies ) ) {
    const repository = name === 'perennial-alias' ? 'perennial' : name;
    syncRepository( workspace, name, `https://github.com/phetsims/${repository}.git`, pin.sha );
  }
  syncRepository( workspace, 'babel', lock.babel.repository, lock.babel.commit );
  patchJoistAvailableScreens( workspace );
  for ( const repository of [ 'chipper', 'perennial-alias' ] ) {
    run( 'npm', [ 'ci', '--ignore-scripts' ], join( workspace, repository ) );
  }

  for ( const name of names ) {
    const pin = sources[ name ];
    const sourceDir = syncRepository( workspace, name, pin.repository, pin.commit );
    patchSupportedBrand( sourceDir );
    installAdapter( name, sourceDir );
    run( 'npm', [ 'ci', '--ignore-scripts' ], sourceDir );
    run( join( workspace, 'chipper/node_modules/.bin/grunt' ), [
      '--no-lint',
      '--no-report-media',
      '--brands=adapted-from-phet',
      `--locales=${lock.babel.locales.join( ',' )}`,
      '--allHTML'
    ], sourceDir );
    emitArtifact( name, sourceDir, pin );
  }
  console.log( `Pinned sources retained in ${workspace}` );
}

build( names.filter( name => name === 'keplers-laws' ), keplerLock );
build( names.filter( name => name !== 'keplers-laws' ), pilotLock );
