// Shared state field bindings. Distributed under GPL-3.0.
import Property from '../../../axon/js/Property.js';
import Vector2 from '../../../dot/js/Vector2.js';

type Value = boolean | number | string | null | [ number, number ];
type Field = {
  read: () => Value;
  prepare: ( value: unknown, name: string ) => () => void;
};
type Fields = Record<string, Field>;

export function object( value: unknown ): Record<string, unknown> {
  if ( !value || typeof value !== 'object' || Array.isArray( value ) ) {
    throw new Error( 'Expected a simulation state object.' );
  }
  return value as Record<string, unknown>;
}

export function field<T>(
  property: { value: T },
  encode: ( value: T ) => Value,
  decode: ( value: unknown ) => T | undefined
): Field {
  return {
    read: () => encode( property.value ),
    prepare: ( input, name ) => {
      const value = decode( input );
      if ( value === undefined ) {
        throw new Error( `Invalid simulation state field: ${name}.` );
      }
      return () => { property.value = value; };
    }
  };
}

export function boolean( property: { value: boolean } ): Field {
  return field( property, value => value, value => typeof value === 'boolean' ? value : undefined );
}

export function number(
  property: { value: number; range?: { contains: ( value: number ) => boolean } },
  integer = false,
  valid: ( value: number ) => boolean = () => true
): Field {
  return field( property, value => value, value =>
    typeof value === 'number' && Number.isFinite( value ) && ( !integer || Number.isInteger( value ) ) &&
    ( !property.range || property.range.contains( value ) ) && valid( value ) ? value : undefined
  );
}

export function vector( property: { value: Vector2 } ): Field {
  return field( property, value => [ value.x, value.y ], value =>
    Array.isArray( value ) && value.length === 2 && value.every( Number.isFinite ) ?
    new Vector2( value[ 0 ], value[ 1 ] ) : undefined
  );
}

export function enumeration<T>( property: Property<T> ): Field {
  return field( property, value => String( value ), value => property.validValues?.find( item => String( item ) === value ) );
}

export function readFields( fields: Fields ): Record<string, Value> {
  return Object.fromEntries( Object.entries( fields ).map( ( [ key, binding ] ) => [ key, binding.read() ] ) );
}

export function prepareFields( fields: Fields, state: unknown ): () => void {
  const values = object( state );
  const changes = Object.entries( fields ).map( ( [ key, binding ] ) => binding.prepare( values[ key ], key ) );
  return () => changes.forEach( change => change() );
}
