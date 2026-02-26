// Minimal CBOR decoder — supports types needed for WebAuthn attestation objects:
// unsigned int, negative int, byte string, text string, array, map, simple values (true/false/null)

export function cborDecode(buffer) {
  const data = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset || 0, buffer.byteLength);
  let offset = 0;

  function readUint8() { return data.getUint8(offset++); }
  function readUint16() { const v = data.getUint16(offset); offset += 2; return v; }
  function readUint32() { const v = data.getUint32(offset); offset += 4; return v; }

  function readLength(additionalInfo) {
    if (additionalInfo < 24) return additionalInfo;
    if (additionalInfo === 24) return readUint8();
    if (additionalInfo === 25) return readUint16();
    if (additionalInfo === 26) return readUint32();
    throw new Error('CBOR: unsupported length encoding');
  }

  function decode() {
    const initial = readUint8();
    const majorType = initial >> 5;
    const additionalInfo = initial & 0x1f;

    switch (majorType) {
      case 0: // unsigned integer
        return readLength(additionalInfo);
      case 1: // negative integer
        return -1 - readLength(additionalInfo);
      case 2: { // byte string
        const len = readLength(additionalInfo);
        const bytes = new Uint8Array(data.buffer, data.byteOffset + offset, len);
        offset += len;
        return bytes;
      }
      case 3: { // text string
        const len = readLength(additionalInfo);
        const bytes = new Uint8Array(data.buffer, data.byteOffset + offset, len);
        offset += len;
        return new TextDecoder().decode(bytes);
      }
      case 4: { // array
        const len = readLength(additionalInfo);
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(decode());
        return arr;
      }
      case 5: { // map
        const len = readLength(additionalInfo);
        const map = {};
        for (let i = 0; i < len; i++) {
          const key = decode();
          map[key] = decode();
        }
        return map;
      }
      case 7: // simple values and float
        if (additionalInfo === 20) return false;
        if (additionalInfo === 21) return true;
        if (additionalInfo === 22) return null;
        throw new Error(`CBOR: unsupported simple value ${additionalInfo}`);
      default:
        throw new Error(`CBOR: unsupported major type ${majorType}`);
    }
  }

  return decode();
}
