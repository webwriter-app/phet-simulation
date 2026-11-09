import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';

const sharedName = names => 'shared-' + createHash( 'sha256' ).update( [ ...names ].sort().join( ',' ) ).digest( 'hex' ).slice( 0, 16 );

// Chipper supplies the HTML, locale and license data. Rebundle its transpiled
// entry points together so the browser can fetch shared code once. The widget
// still gets an offline HTML string for its opaque-origin sandbox.
export async function compileSimulations( workspace, names ) {
  workspace = realpathSync( workspace );
  const chipper = join( workspace, 'chipper' );
  const requireChipper = createRequire( join( chipper, 'package.json' ) );
  const webpack = requireChipper( 'webpack' );
  const dist = join( chipper, 'dist/js' );
  const libraries = requireChipper( './dist/js/chipper/js/common/webpackGlobalLibraries.js' ).default;
  const chunkDir = join( workspace, 'webwriter-chunks' );

  const compiler = webpack( {
    mode: 'production',
    context: chipper,
    entry: Object.fromEntries( names.map( name => [ name, join( dist, name, 'js', `${name}-main.js` ) ] ) ),
    output: { path: chunkDir, filename: '[name].js', hashFunction: 'xxhash64' },
    module: {
      // Keep async imports asynchronous, but ship their code with the owning
      // entry so it doesn't need to fetch a webpack URL inside the sandbox.
      parser: { javascript: { dynamicImportMode: 'eager' } },
      rules: [
        {
          test: /\.js$/,
          exclude: /affirm\.js$/,
          enforce: 'pre',
          use: [ { loader: join( dist, 'chipper/js/grunt/affirmTransformLoader.js' ) } ]
        },
        ...Object.entries( libraries ).map( ( [ name, path ] ) => ( {
          test: filename => filename.includes( normalize( path ) ),
          loader: requireChipper.resolve( 'expose-loader' ),
          options: { exposes: name }
        } ) )
      ]
    },
    plugins: [
      new webpack.IgnorePlugin( { resourceRegExp: /\/phet\//, contextRegExp: /brand/ } ),
      new webpack.IgnorePlugin( { resourceRegExp: /\/phet-io\// } )
    ],
    optimization: {
      minimize: false,
      // Module factories can be shared even when the order of imports varies.
      concatenateModules: false,
      runtimeChunk: 'single',
      splitChunks: {
        chunks: 'initial',
        maxInitialRequests: Infinity,
        cacheGroups: {
          default: false,
          defaultVendors: false,
          shared: {
            name: ( _module, chunks ) => chunks.length === names.length ? 'common' : sharedName( chunks.map( chunk => chunk.name ) ),
            minChunks: 2,
            // Keep small overlaps in the simulation entries instead of making
            // the browser fetch dozens of tiny files for each selection.
            minSize: 30000,
            minRemainingSize: 0
          }
        }
      }
    }
  } );
  const result = await new Promise( ( resolve, reject ) => {
    compiler.run( ( error, result ) => {
      compiler.close( closeError => {
        if ( error || closeError ) {
          reject( error ?? closeError );
        }
        else if ( result.hasErrors() ) {
          reject( new Error( result.toString( { all: false, errors: true, errorDetails: true } ) ) );
        }
        else {
          resolve( result );
        }
      } );
    } );
  } );
  const stats = result.toJson( { all: false, entrypoints: true, assets: true } );
  const entries = Object.fromEntries( names.map( name => [ name, stats.entrypoints[ name ].assets.map( asset => asset.name ) ] ) );
  const chunkNames = new Set( Object.values( entries ).flat() );
  // An opaque-origin frame can't fetch webpack's async chunk URLs. A change in
  // Chipper's output must fail the build instead of breaking the running sim.
  const externalAssets = stats.assets.filter( asset => !asset.name.endsWith( '.js' ) || !chunkNames.has( asset.name ) );
  if ( externalAssets.length ) {
    throw new Error( `Unexpected asynchronous PhET chunks or assets: ${externalAssets.map( asset => asset.name ).join( ', ' )}.` );
  }
  // Chipper scans the original modules for the strings and media notices each
  // simulation needs. Walk from each entry so it can reuse this compilation.
  const { entries: graphEntries, moduleGraph } = result.compilation;
  const usedModules = Object.fromEntries( names.map( name => {
    const modules = new Set();
    const seen = new Set();
    const entry = graphEntries.get( name );
    const pending = [ ...entry.dependencies, ...entry.includeDependencies ].map( dependency => moduleGraph.getModule( dependency ) );
    while ( pending.length ) {
      const module = pending.pop();
      if ( !module || seen.has( module ) ) {
        continue;
      }
      seen.add( module );
      const filename = module.nameForCondition?.();
      if ( filename && isAbsolute( filename ) && statSync( filename, { throwIfNoEntry: false } )?.isFile() ) {
        const path = relative( workspace, filename );
        if ( path && !path.startsWith( `..${sep}` ) ) {
          modules.add( path.split( sep ).join( '/' ) );
        }
      }
      for ( const connection of moduleGraph.getOutgoingConnections( module ) ) {
        pending.push( connection.module );
      }
    }
    return [ name, [ ...modules ].sort() ];
  } ) );
  return { entries, chunkDir, chunkNames, usedModules };
}

export async function splitSimulations( workspace, names, outputDir, compiled ) {
  const { entries, chunkDir, chunkNames } = compiled ?? await compileSimulations( workspace, names );
  const requireChipper = createRequire( join( workspace, 'chipper/package.json' ) );
  const { minify } = requireChipper( 'terser' );
  const chunks = new Map();
  for ( const name of chunkNames ) {
    const source = await readFile( join( chunkDir, name ), 'utf8' );
    const { code, error } = await minify( source, {
      mangle: { safari10: true },
      compress: { global_defs: { assert: false, assertSlow: false, sceneryLog: false } },
      output: { inline_script: true }
    } );
    if ( error ) {
      throw new Error( `Could not minify PhET chunk ${name}.`, { cause: error } );
    }
    if ( !code || /<\/script/i.test( code ) ) {
      throw new Error( `Cannot inline PhET chunk ${name}.` );
    }
    chunks.set( name, code );
  }

  const htmls = new Map();
  const scripts = new Map();
  const sharedScripts = new Map();
  const isStartup = body => /^phet\.chipper\.runWebpack\s*=/.test( body );
  for ( const name of names ) {
    const html = await readFile( join( workspace, name, `build/adapted-from-phet/${name}_all_adapted-from-phet.html` ), 'utf8' );
    htmls.set( name, html );
    const matches = [ ...html.matchAll( /<script\b([^>]*)>([\s\S]*?)<\/script>/gi ) ];
    scripts.set( name, matches );
    for ( const body of new Set( matches.map( match => match[ 2 ] ) ) ) {
      if ( isStartup( body ) ) {
        continue;
      }
      if ( !sharedScripts.has( body ) ) {
        sharedScripts.set( body, new Set() );
      }
      sharedScripts.get( body ).add( name );
    }
  }
  const runtimePreloads = {};
  const preloads = new Map();
  const shared = new Map();
  function group( name ) {
    if ( !shared.has( name ) ) {
      shared.set( name, { preloads: {} } );
    }
    return shared.get( name );
  }
  for ( const [ body, owners ] of sharedScripts ) {
    if ( owners.size > 1 ) {
      const key = preloads.size;
      const file = owners.size === names.length ? null : `${sharedName( owners )}.js`;
      preloads.set( body, { key, file } );
      const target = file ? group( file ).preloads : runtimePreloads;
      target[ key ] = body;
    }
  }
  for ( const [ name, code ] of chunks ) {
    if ( /^shared-[a-f0-9]{16}\.js$/.test( name ) ) {
      group( name ).code = code;
    }
  }

  await mkdir( outputDir, { recursive: true } );
  const emitted = new Set();
  async function emit( file, content ) {
    await writeFile( join( outputDir, file ), content );
    emitted.add( file );
  }

  const runtimeChunks = new Set( [ 'runtime.js', 'common.js' ].filter( name => chunks.has( name ) ) );
  await emit( 'runtime.js', [
    '// Shared PhET code. See the simulation source pins and license notices.',
    `export const chunks = ${JSON.stringify( Object.fromEntries( [ ...runtimeChunks ].map( name => [ name, chunks.get( name ) ] ) ) )};`,
    `const preloads = ${JSON.stringify( runtimePreloads )};`,
    'export function assemble(shell, sources, extraPreloads) {',
    '  return shell.replace(/<!--WEBWRITER_PHET_(\\d+|ENTRY)-->/g, (_, id) =>',
    '    id === "ENTRY" ? sources.join(";\\n") : preloads[id] ?? extraPreloads[id]);',
    '}',
    ''
  ].join( '\n' ) );
  for ( const [ name, data ] of shared ) {
    await emit( name, `export default ${JSON.stringify( data )};\n` );
  }

  for ( const name of names ) {
    let startupCount = 0;
    const parts = [];
    const preloadFiles = new Set();
    let start = 0;
    for ( const match of scripts.get( name ) ) {
      const [ original, attributes, body ] = match;
      let replacement;
      if ( isStartup( body ) ) {
        startupCount++;
        replacement = 'phet.chipper.runWebpack=function(){<!--WEBWRITER_PHET_ENTRY-->};';
      }
      else if ( preloads.has( body ) ) {
        const { key, file } = preloads.get( body );
        replacement = `<!--WEBWRITER_PHET_${key}-->`;
        if ( file ) {
          preloadFiles.add( file );
        }
      }
      else {
        continue;
      }
      parts.push( htmls.get( name ).slice( start, match.index ), `<script${attributes}>${replacement}</script>` );
      start = match.index + original.length;
    }
    if ( startupCount !== 1 ) {
      throw new Error( `Expected one Chipper startup bundle for ${name}, found ${startupCount}.` );
    }
    parts.push( htmls.get( name ).slice( start ) );

    const imports = [ 'import {assemble, chunks} from "./runtime.js";' ];
    const sharedImports = new Map();
    function reference( file ) {
      if ( !sharedImports.has( file ) ) {
        const variable = `shared${sharedImports.size}`;
        sharedImports.set( file, variable );
        imports.push( `import ${variable} from "./${file}";` );
      }
      return sharedImports.get( file );
    }
    const order = entries[ name ].map( chunk => {
      if ( runtimeChunks.has( chunk ) ) {
        return `chunks[${JSON.stringify( chunk )}]`;
      }
      if ( shared.has( chunk ) ) {
        return `${reference( chunk )}.code`;
      }
      return JSON.stringify( chunks.get( chunk ) );
    } );
    const extras = [ ...preloadFiles ].map( file => `${reference( file )}.preloads` );
    await emit( `${name}.js`, [
      ...imports,
      `const shell = ${JSON.stringify( parts.join( '' ) )};`,
      `export default () => assemble(shell, [${order.join( ', ' )}], Object.assign(${[ '{}', ...extras ].join( ', ' )}));`,
      ''
    ].join( '\n' ) );
    await emit( `LICENSE-${name}`, await readFile( join( workspace, name, 'LICENSE' ) ) );
  }
  await emit( 'bundled.js', [
    '// Generated by tools/build-simulations.mjs.',
    'export default {',
    ...names.map( name => `  ${JSON.stringify( name )}: () => import("./${name}.js"),` ),
    '};',
    ''
  ].join( '\n' ) );
  return emitted;
}
