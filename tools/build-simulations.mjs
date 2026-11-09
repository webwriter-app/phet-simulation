#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSimulations, splitSimulations } from './split-simulations.mjs';

const packageRoot = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const readJSON = path => JSON.parse( readFileSync( path, 'utf8' ) );
const lock = readJSON( join( packageRoot, 'tools/simulations-build.lock.json' ) );
const requested = process.argv.slice( 2 );
const names = ( requested.length ? [ ...new Set( requested ) ] : Object.keys( lock.sources ) ).sort();
for ( const name of names ) {
  if ( !Object.hasOwn( lock.sources, name ) ) {
    throw new Error( `No pinned source for ${name}.` );
  }
}

const cacheParent = resolve( process.env.PHET_BUILD_DIR || join( tmpdir(), 'webwriter-phet-builds' ) );
mkdirSync( cacheParent, { recursive: true } );
const workspace = mkdtempSync( join( cacheParent, 'phet-' ) );
const stagingDir = join( workspace, 'artifacts' );
const sourceCache = process.env.PHET_SOURCE_CACHE && resolve( process.env.PHET_SOURCE_CACHE );
const synced = new Map();
console.log( `Using temporary PhET workspace ${workspace}` );

function run( command, args, cwd = packageRoot ) {
  execFileSync( command, args, { cwd, stdio: 'inherit' } );
}

function syncRepository( name, commit, url = `https://github.com/phetsims/${name === 'perennial-alias' ? 'perennial' : name}.git` ) {
  const directory = join( workspace, name );
  if ( synced.has( name ) ) {
    if ( synced.get( name ) !== commit ) {
      throw new Error( `Conflicting source pins for ${name}.` );
    }
    return directory;
  }
  const cached = sourceCache && join( sourceCache, name );
  if ( cached && existsSync( join( cached, '.git' ) ) ) {
    run( 'git', [ 'clone', '--quiet', '--shared', '--no-checkout', cached, directory ] );
    run( 'git', [ '-C', directory, 'remote', 'set-url', 'origin', url ] );
  }
  else {
    run( 'git', [ 'init', '--quiet', '--initial-branch=main', directory ] );
    run( 'git', [ '-C', directory, 'remote', 'add', 'origin', url ] );
    run( 'git', [ '-C', directory, 'fetch', '--quiet', '--depth=1', 'origin', commit ] );
  }
  run( 'git', [ '-C', directory, 'checkout', '--quiet', '--detach', commit ] );
  const actualCommit = execFileSync( 'git', [ '-C', directory, 'rev-parse', 'HEAD' ], { encoding: 'utf8' } ).trim();
  if ( actualCommit !== commit ) {
    throw new Error( `Fetched ${name} at ${actualCommit}; expected ${commit}.` );
  }
  synced.set( name, commit );
  return directory;
}

function patchSupportedBrand( sourceDir, pin ) {
  const path = join( sourceDir, 'package.json' );
  const manifest = readJSON( path );
  if ( manifest.version !== pin.version || !Array.isArray( manifest.phet?.supportedBrands ) ) {
    throw new Error( `Unexpected package version or supported brands in ${path}.` );
  }
  if ( !manifest.phet.supportedBrands.includes( 'adapted-from-phet' ) ) {
    manifest.phet.supportedBrands.push( 'adapted-from-phet' );
    writeFileSync( path, `${JSON.stringify( manifest, null, 2 )}\n` );
  }
}

function stageSharedBridge() {
  const path = join( workspace, 'joist/js/Sim.ts' );
  const source = readFileSync( path, 'utf8' );
  const declaration = /^  (?:declare )?private availableScreensProperty!?: Property<number\[\]>;$/m;
  if ( !declaration.test( source ) ) {
    throw new Error( 'Pinned Joist declaration changed; expected availableScreensProperty to be private.' );
  }
  writeFileSync( path, source.replace( declaration, line => line.replace( 'private', 'public' ) ) );

  const toolbarPath = join( workspace, 'joist/js/A11yButtonsHBox.ts' );
  const toolbar = readFileSync( toolbarPath, 'utf8' );
  const preferencesButton = '    if ( sim.preferencesModel.shouldShowDialog() ) {';
  if ( !toolbar.includes( preferencesButton ) ) {
    throw new Error( 'Pinned Joist toolbar changed; expected the preferences button.' );
  }
  writeFileSync( toolbarPath, "import createFullscreenButton from './webwriter/createFullscreenButton.js';\n" +
    toolbar.replace( preferencesButton, `    const fullscreenButton = createFullscreenButton( sim, backgroundColorProperty );
    if ( fullscreenButton ) {
      a11yButtons.push( fullscreenButton );
    }

${preferencesButton}` ) );

  const from = join( packageRoot, 'adaptations/shared' );
  const to = join( workspace, 'joist/js/webwriter' );
  mkdirSync( to, { recursive: true } );
  const files = readdirSync( from ).filter( file => file.endsWith( '.ts' ) );
  for ( const file of files ) {
    copyFileSync( join( from, file ), join( to, file ) );
  }
  return new Set( files.map( file => file.replace( /\.ts$/, '.js' ) ) );
}

function stageChipperShell() {
  const path = join( workspace, 'chipper/js/grunt/buildRunnable.ts' );
  const source = readFileSync( path, 'utf8' );
  const discovery = /const webpackResult = await phetTimingLog.startAsync\( 'webpack',[\s\S]*?\n  \} \);/g;
  if ( [ ...source.matchAll( discovery ) ].length !== 1 ) {
    throw new Error( 'Pinned Chipper module discovery changed.' );
  }
  const reuse = "const webpackResult = { js: '', usedModules: JSON.parse( readFileSync( `../webwriter-used-modules/${repo}.json`, 'utf8' ) ) as string[] };";
  const minifier = '...minifiableScripts.map( js => minify( js, minifyOptions ) )';
  if ( source.split( minifier ).length !== 2 ) {
    throw new Error( 'Pinned Chipper script minification changed.' );
  }
  const cachedMinifier = `...minifiableScripts.map( js => {
        const hash = createHash( 'sha256' ).update( JSON.stringify( [ minifyOptions, js ] ) ).digest( 'hex' );
        const cacheFile = '../webwriter-minified/' + hash;
        if ( fs.existsSync( cacheFile ) ) {
          return readFileSync( cacheFile, 'utf8' );
        }
        const script = minify( js, minifyOptions );
        const temporary = cacheFile + '.' + process.pid;
        fs.writeFileSync( temporary, script );
        fs.renameSync( temporary, cacheFile );
        return script;
      } )`;
  const localeMetadata = 'localeData: getPrunedLocaleData( allLocales ),';
  if ( source.split( localeMetadata ).length !== 2 ) {
    throw new Error( 'Pinned Chipper locale metadata changed.' );
  }
  mkdirSync( join( workspace, 'webwriter-minified' ) );
  writeFileSync( path, "import { createHash } from 'node:crypto';\n" +
    source.replace( discovery, () => reuse ).replace( minifier, () => cachedMinifier )
      .replace( localeMetadata, 'localeData: getPrunedLocaleData( Object.keys( stringMap ) ),' ) );
}

function stageAdapter( name, sourceDir, sharedFiles, ts ) {
  const adapterSourceDir = join( packageRoot, 'adaptations', name );
  const adapterFiles = readdirSync( adapterSourceDir ).filter( file => file.endsWith( '.ts' ) );
  if ( !adapterFiles.includes( 'install.ts' ) ) {
    throw new Error( `No install.ts in ${adapterSourceDir}.` );
  }
  const target = join( sourceDir, 'js/webwriter' );
  mkdirSync( target, { recursive: true } );
  for ( const file of adapterFiles ) {
    const source = readFileSync( join( adapterSourceDir, file ), 'utf8' );
    writeFileSync( join( target, file ), source.replace( /(['"])\.\/([\w-]+\.js)\1/g,
      ( match, quote, specifier ) => sharedFiles.has( specifier ) ? `${quote}../../../joist/js/webwriter/${specifier}${quote}` : match ) );
  }

  const mainDir = join( sourceDir, 'js' );
  const mainFile = readdirSync( mainDir ).find( file => file === `${name}-main.ts` || file === `${name}-main.js` );
  if ( !mainFile ) {
    throw new Error( `No launcher found for ${name}.` );
  }
  const mainPath = join( mainDir, mainFile );
  const source = readFileSync( mainPath, 'utf8' );
  const file = ts.createSourceFile( mainFile, source, ts.ScriptTarget.Latest, true );
  const startCalls = [];
  function visit( node ) {
    if ( ts.isExpressionStatement( node ) && ts.isCallExpression( node.expression ) ) {
      const { expression, arguments: args } = node.expression;
      if ( !args.length && ts.isPropertyAccessExpression( expression ) && expression.name.text === 'start' &&
           ( ts.isIdentifier( expression.expression ) || ts.isNewExpression( expression.expression ) ) ) {
        startCalls.push( { node, receiver: expression.expression } );
      }
    }
    ts.forEachChild( node, visit );
  }
  visit( file );
  if ( startCalls.length !== 1 ) {
    throw new Error( `Expected one recognizable Sim start call in ${mainPath}.` );
  }
  const { node, receiver } = startCalls[ 0 ];
  const position = node.getStart( file );
  const indent = source.slice( source.lastIndexOf( '\n', position - 1 ) + 1, position ).match( /^[ \t]*/ )[ 0 ];
  const before = ts.isNewExpression( receiver ) ? `const webwriterSim = ${receiver.getText( file )};\n${indent}webwriterSim.start();` :
                 node.getText( file );
  const nameOfSim = ts.isNewExpression( receiver ) ? 'webwriterSim' : receiver.getText( file );
  const args = lock.sources[ name ].launcherArgs ?? [];
  if ( !args.every( arg => /^[a-zA-Z_$][\w$]*$/.test( arg ) ) ) {
    throw new Error( `Invalid adapter launcher arguments for ${name}.` );
  }
  const call = `installWebWriter( ${[ nameOfSim, ...args ].join( ', ' )} );`;
  const patched = `${source.slice( 0, position )}${before}\n${indent}${call}${source.slice( node.end )}`;
  // Let PhET initialize its own modules before the adapter imports any model
  // classes. Some upstream cycles rely on this entry point's import order.
  const afterImports = file.statements.filter( ts.isImportDeclaration ).at( -1 )?.end ?? 0;
  const adapterImport = "\nimport installWebWriter from './webwriter/install.js';\n";
  writeFileSync( mainPath, patched.slice( 0, afterImports ) + adapterImport + patched.slice( afterImports ) );
}

if ( ![ '22', '24' ].includes( process.versions.node.split( '.' )[ 0 ] ) ) {
  console.warn( `PhET recommends Node.js 22 or 24; current version is ${process.versions.node}.` );
}

for ( const [ name, pin ] of Object.entries( lock.dependencies ) ) {
  syncRepository( name, pin.sha, pin.repository );
}
syncRepository( 'babel', lock.babel.commit, lock.babel.repository );
const sharedFiles = stageSharedBridge();
stageChipperShell();
for ( const name of [ 'chipper', 'perennial-alias' ] ) {
  run( 'npm', [ 'ci', '--ignore-scripts' ], join( workspace, name ) );
}
const ts = createRequire( join( workspace, 'perennial-alias/package.json' ) )( 'typescript' );
for ( const name of names ) {
  const pin = lock.sources[ name ];
  syncRepository( name, pin.commit, pin.repository );
}
const publicManifests = new Set();
const privateRepos = new Set( [ 'phet-io', 'phet-io-sim-specific', 'phet-io-wrappers', 'studio' ] );
function includeSimulationDependencies( name ) {
  if ( publicManifests.has( name ) ) {
    return;
  }
  publicManifests.add( name );
  const { phet } = readJSON( join( workspace, name, 'package.json' ) );
  for ( const dependency of phet?.phetLibs ?? [] ) {
    if ( privateRepos.has( dependency ) || synced.has( dependency ) ) {
      continue;
    }
    const pin = lock.sources[ dependency ];
    if ( !pin ) {
      throw new Error( `No public source pin for ${name}'s dependency ${dependency}.` );
    }
    syncRepository( dependency, pin.commit, pin.repository );
    includeSimulationDependencies( dependency );
  }
}
names.forEach( includeSimulationDependencies );
for ( const name of names ) {
  const sourceDir = join( workspace, name );
  patchSupportedBrand( sourceDir, lock.sources[ name ] );
  stageAdapter( name, sourceDir, sharedFiles, ts );
}

const grunt = join( workspace, 'chipper/node_modules/.bin/grunt' );
for ( const name of names ) {
  const sourceDir = join( workspace, name );
  if ( existsSync( join( sourceDir, 'package-lock.json' ) ) ) {
    run( 'npm', [ 'ci', '--ignore-scripts' ], sourceDir );
  }
  else {
    // Most development snapshots declare only Grunt and have no lockfile.
    // Reuse Chipper's pinned version instead of doing an unlocked install.
    const manifest = readJSON( join( sourceDir, 'package.json' ) );
    if ( Object.keys( { ...manifest.dependencies, ...manifest.devDependencies } ).some( name => name !== 'grunt' ) ) {
      throw new Error( `Unpinned npm dependencies for ${name}.` );
    }
    mkdirSync( join( sourceDir, 'node_modules' ), { recursive: true } );
    symlinkSync( join( workspace, 'chipper/node_modules/grunt' ), join( sourceDir, 'node_modules/grunt' ), 'dir' );
  }
}

run( grunt, [ 'transpile', `--repos=${[ ...synced.keys() ].filter( name => name !== 'babel' ).join( ',' )}` ], join( workspace, 'chipper' ) );
const compiled = await compileSimulations( workspace, names );
const usedModulesDir = join( workspace, 'webwriter-used-modules' );
mkdirSync( usedModulesDir );
for ( const [ name, modules ] of Object.entries( compiled.usedModules ) ) {
  writeFileSync( join( usedModulesDir, `${name}.json` ), JSON.stringify( modules ) );
}
console.log( `Compiled ${names.length} simulations into ${compiled.chunkNames.size} chunks.` );
const logs = join( workspace, 'logs' );
mkdirSync( logs );
const jobs = Number( process.env.PHET_BUILD_JOBS ?? 3 );
if ( !Number.isSafeInteger( jobs ) || jobs < 1 ) {
  throw new Error( 'PHET_BUILD_JOBS must be a positive integer.' );
}
const failures = [];
let next = 0;
async function buildShells() {
  while ( next < names.length ) {
    const name = names[ next++ ];
    const log = join( logs, `${name}.log` );
    try {
      await new Promise( ( resolve, reject ) => {
        const fd = openSync( log, 'w' );
        try {
          const child = spawn( grunt, [
            '--no-lint',
            '--no-transpile',
            '--no-report-media',
            '--brands=adapted-from-phet',
            `--locales=${lock.babel.locales.join( ',' )}`,
            '--allHTML'
          ], { cwd: join( workspace, name ), stdio: [ 'ignore', fd, fd ] } );
          child.on( 'error', reject );
          child.on( 'exit', ( code, signal ) => code === 0 ? resolve() : reject( new Error( signal || `exit ${code}` ) ) );
        }
        finally {
          closeSync( fd );
        }
      } );
      console.log( `Built PhET shell for ${name}.` );
    }
    catch ( error ) {
      console.error( `Could not build ${name}: ${error.message}. See ${log}\n${readFileSync( log, 'utf8' ).slice( -6000 )}` );
      failures.push( name );
    }
  }
}
await Promise.all( Array.from( { length: Math.min( jobs, names.length ) }, buildShells ) );
if ( failures.length ) {
  throw new Error( `PhET build failed: ${failures.join( ', ' )}.` );
}

const artifacts = await splitSimulations( workspace, names, stagingDir, compiled );
if ( names.length === Object.keys( lock.sources ).length ) {
  const outputDir = join( packageRoot, 'sims' );
  for ( const file of artifacts ) {
    // Use an in-directory rename so it also works with PHET_BUILD_DIR on a separate drive.
    const target = join( outputDir, file );
    copyFileSync( join( stagingDir, file ), target + '.tmp' );
    renameSync( target + '.tmp', target );
  }
  for ( const file of readdirSync( outputDir ) ) {
    if ( /^shared-[a-f0-9]{16}\.js$/.test( file ) && !artifacts.has( file ) ) {
      rmSync( join( outputDir, file ) );
    }
  }
  const manifestPath = join( packageRoot, 'package.json' );
  const manifest = readJSON( manifestPath );
  const exports = Object.entries( manifest.exports ).filter( ( [ key ] ) => !key.startsWith( './sims/' ) );
  const simulationExports = [ ...artifacts ].filter( file => file.endsWith( '.js' ) ).sort().map( file => {
    const path = `./sims/${file}`;
    return [ path, path ];
  } );
  manifest.exports = Object.fromEntries( [ ...exports.slice( 0, 1 ), ...simulationExports, ...exports.slice( 1 ) ] );
  writeFileSync( manifestPath, `${JSON.stringify( manifest, null, 4 )}\n` );
  console.log( `Wrote shared runtime and ${names.length} simulations to ${outputDir}` );
}
else {
  console.log( `Wrote subset build to ${stagingDir}. The package's complete build was left in place.` );
}
