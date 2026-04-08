/**
 * Minimal CBOR decoder sufficient to parse WebAuthn attestationObject payloads.
 *
 * Supports: unsigned int (major 0), negative int (major 1), byte string (major 2),
 * text string (major 3), array (major 4), map (major 5).
 *
 * Does NOT support: tagged items (major 6), floats/specials (major 7),
 * indefinite-length encoding, or streaming. Recursion depth is unbounded but
 * WebAuthn payloads are at most 3 levels deep in practice.
 */

export type CborMap = Map<number | string, CborValue>;
export type CborValue = number | string | Uint8Array | CborMap | CborValue[];

/**
 * Decodes a CBOR-encoded byte array into a JavaScript value.
 *
 * @param data - The CBOR-encoded bytes to decode.
 * @returns The decoded value.
 * @throws {Error} If the input is empty, truncated, or contains unsupported CBOR types.
 */
export function cborDecode(data: Uint8Array): CborValue {
  if (data.length === 0) throw new Error('cbor_decode: empty input');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const [value, consumed] = decodeItem(view, 0);
  void consumed;
  return value;
}

function decodeItem(view: DataView, offset: number): [CborValue, number] {
  if (offset >= view.byteLength) throw new Error('cbor_decode: unexpected end of input');
  const initialByte = view.getUint8(offset);
  const majorType = (initialByte >> 5) & 0x07;
  const additionalInfo = initialByte & 0x1f;
  offset++;

  const [argument, newOffset] = readArgument(view, offset, additionalInfo);
  offset = newOffset;

  switch (majorType) {
    case 0: // unsigned integer
      return [argument, offset];

    case 1: // negative integer
      return [-1 - argument, offset];

    case 2: {
      // byte string
      if (offset + argument > view.byteLength)
        throw new Error('cbor_decode: truncated byte string');
      const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, argument);
      return [bytes.slice(), offset + argument];
    }

    case 3: {
      // text string
      if (offset + argument > view.byteLength)
        throw new Error('cbor_decode: truncated text string');
      const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, argument);
      return [new TextDecoder().decode(bytes), offset + argument];
    }

    case 4: {
      // array
      const arr: CborValue[] = [];
      for (let i = 0; i < argument; i++) {
        if (offset >= view.byteLength) throw new Error('cbor_decode: truncated array');
        const [item, next] = decodeItem(view, offset);
        arr.push(item);
        offset = next;
      }
      return [arr, offset];
    }

    case 5: {
      // map
      const map: CborMap = new Map();
      for (let i = 0; i < argument; i++) {
        if (offset >= view.byteLength) throw new Error('cbor_decode: truncated map');
        const [key, afterKey] = decodeItem(view, offset);
        if (typeof key !== 'number' && typeof key !== 'string')
          throw new Error('cbor_decode: map key must be integer or string');
        offset = afterKey;
        if (offset >= view.byteLength) throw new Error('cbor_decode: truncated map value');
        const [val, afterVal] = decodeItem(view, offset);
        map.set(key as number | string, val);
        offset = afterVal;
      }
      return [map, offset];
    }

    default:
      throw new Error(`cbor_decode: unsupported major type ${majorType}`);
  }
}

function readArgument(view: DataView, offset: number, additionalInfo: number): [number, number] {
  if (additionalInfo <= 23) {
    return [additionalInfo, offset];
  }
  if (additionalInfo === 24) {
    if (offset >= view.byteLength) throw new Error('cbor_decode: truncated argument (1-byte)');
    return [view.getUint8(offset), offset + 1];
  }
  if (additionalInfo === 25) {
    if (offset + 1 >= view.byteLength) throw new Error('cbor_decode: truncated argument (2-byte)');
    return [view.getUint16(offset, false), offset + 2];
  }
  if (additionalInfo === 26) {
    if (offset + 3 >= view.byteLength) throw new Error('cbor_decode: truncated argument (4-byte)');
    return [view.getUint32(offset, false), offset + 4];
  }
  throw new Error(`cbor_decode: unsupported additional info ${additionalInfo}`);
}
