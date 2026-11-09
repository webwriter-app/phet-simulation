// Binary data encoding for WebWriter checkpoints. Distributed under GPL-3.0.

export function encodeBytes( bytes: Uint8Array ): string {
  if ( 'toBase64' in bytes && typeof bytes.toBase64 === 'function' ) {
    return bytes.toBase64();
  }
  let binary = '';
  for ( let offset = 0; offset < bytes.length; offset += 8192 ) {
    binary += String.fromCharCode( ...bytes.subarray( offset, offset + 8192 ) );
  }
  return btoa( binary );
}

export function decodeBytes( input: unknown, maxBytes: number ): Uint8Array {
  if ( typeof input !== 'string' || input.length > Math.ceil( maxBytes / 3 ) * 4 ) {
    throw new Error( 'Invalid checkpoint data.' );
  }
  const bytes = 'fromBase64' in Uint8Array && typeof Uint8Array.fromBase64 === 'function' ?
                Uint8Array.fromBase64( input ) :
                Uint8Array.from( atob( input ), character => character.charCodeAt( 0 ) );
  if ( bytes.length > maxBytes ) {
    throw new Error( 'Checkpoint data is too large.' );
  }
  return bytes;
}
