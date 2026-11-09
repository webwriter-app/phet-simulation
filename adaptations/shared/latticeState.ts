// Wave lattice snapshot encoding for Sound Waves and Wave Interference. Distributed under GPL-3.0.
import type Lattice from '../../../scenery-phet/js/Lattice.js';
import { decodeBytes, encodeBytes } from './binaryState.js';
import { object } from './stateFields.js';

function writePlane( plane: ArrayLike<number> ) {
  let first = 0;
  let last = plane.length;
  while ( first < last && plane[ first ] === 0 ) { first++; }
  if ( first === last ) { return null; }
  while ( plane[ last - 1 ] === 0 ) { last--; }
  const bytes = new Uint8Array( ( last - first ) * 8 );
  const floats = new DataView( bytes.buffer );
  for ( let i = first; i < last; i++ ) {
    floats.setFloat64( ( i - first ) * 8, plane[ i ], true );
  }
  return { first, data: encodeBytes( bytes ) };
}

function readPlane( input: unknown, size: number ): Float64Array {
  const plane = new Float64Array( size );
  if ( input === null ) { return plane; }
  const { first, data } = object( input );
  if ( typeof first !== 'number' || !Number.isInteger( first ) || first < 0 || first >= size ) {
    throw new Error( 'Invalid wave lattice offset.' );
  }
  const bytes = decodeBytes( data, ( size - first ) * 8 );
  if ( !bytes.length || bytes.length % 8 ) { throw new Error( 'Invalid wave lattice coordinates.' ); }
  const view = new DataView( bytes.buffer );
  for ( let offset = 0; offset < bytes.length; offset += 8 ) {
    const value = view.getFloat64( offset, true );
    if ( !Number.isFinite( value ) || Math.abs( value ) > 1e9 ) { throw new Error( 'Invalid wave amplitude.' ); }
    plane[ first + offset / 8 ] = value;
  }
  return plane;
}

function writeMask( plane: ArrayLike<number>, defaultValue: number ) {
  const bytes = new Uint8Array( Math.ceil( plane.length / 8 ) );
  let changed = false;
  for ( let i = 0; i < plane.length; i++ ) {
    if ( plane[ i ] !== defaultValue ) {
      bytes[ i >> 3 ] |= 1 << ( i % 8 );
      changed = true;
    }
  }
  return changed ? encodeBytes( bytes ) : null;
}

function readMask( input: unknown, size: number, defaultValue: number ): Uint8Array {
  const result = new Uint8Array( size ).fill( defaultValue );
  if ( input === null ) { return result; }
  const byteCount = Math.ceil( size / 8 );
  const bytes = decodeBytes( input, byteCount );
  if ( bytes.length !== byteCount ) { throw new Error( 'Invalid wave lattice mask.' ); }
  for ( let i = 0; i < size; i++ ) {
    if ( bytes[ i >> 3 ] & ( 1 << ( i % 8 ) ) ) { result[ i ] = 1 - defaultValue; }
  }
  return result;
}

export default function latticeState( lattice: Lattice ) {
  const matrices = lattice[ 'matrices' ].map( matrix => matrix.getArray() );
  const visitedCells = lattice[ 'visitedMatrix' ].getArray();
  const allowedCells = lattice[ 'allowedMask' ].getArray();
  const size = lattice.width * lattice.height;
  return {
    read: () => ( {
      planes: matrices.map( writePlane ),
      visited: writeMask( visitedCells, 0 ),
      allowed: writeMask( allowedCells, 1 ),
      current: lattice[ 'currentMatrixIndex' ],
      interpolation: lattice.interpolationRatio
    } ),
    prepare: ( input: unknown ) => {
      const { planes, visited, allowed, current, interpolation } = object( input );
      if ( !Array.isArray( planes ) || planes.length !== matrices.length ||
           typeof current !== 'number' || !Number.isInteger( current ) || current < 0 || current >= matrices.length ||
           typeof interpolation !== 'number' || !Number.isFinite( interpolation ) || interpolation < 0 || interpolation > 1 ) {
        throw new Error( 'Invalid wave lattice state.' );
      }
      const amplitudes = planes.map( plane => readPlane( plane, size ) );
      const visitedMask = readMask( visited, size, 0 );
      const allowedMask = readMask( allowed, size, 1 );
      return () => {
        matrices.forEach( ( matrix, index ) => {
          const amplitude = amplitudes[ index ];
          for ( let i = 0; i < size; i++ ) { matrix[ i ] = amplitude[ i ]; }
        } );
        for ( let i = 0; i < size; i++ ) {
          visitedCells[ i ] = visitedMask[ i ];
          allowedCells[ i ] = allowedMask[ i ];
        }
        lattice[ 'currentMatrixIndex' ] = current;
        lattice.interpolationRatio = interpolation;
        lattice.changedEmitter.emit();
      };
    }
  };
}
