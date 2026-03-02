import { cborDecode } from 'lib/cbor.js';

function bytes(...args) {
  return new Uint8Array(args).buffer;
}

describe('cborDecode', () => {
  describe('unsigned integers', () => {
    it('decodes small integers (0-23)', () => {
      expect(cborDecode(bytes(0x00))).toBe(0);
      expect(cborDecode(bytes(0x01))).toBe(1);
      expect(cborDecode(bytes(0x17))).toBe(23);
    });

    it('decodes 1-byte integer (additionalInfo=24)', () => {
      // 0x18 = type 0, additionalInfo 24; next byte is the value
      expect(cborDecode(bytes(0x18, 0xFF))).toBe(255);
    });

    it('decodes 2-byte integer (additionalInfo=25)', () => {
      // 0x19 = type 0, additionalInfo 25; next 2 bytes big-endian
      expect(cborDecode(bytes(0x19, 0x01, 0x00))).toBe(256);
    });

    it('decodes 4-byte integer (additionalInfo=26)', () => {
      // 0x1A = type 0, additionalInfo 26; next 4 bytes big-endian
      expect(cborDecode(bytes(0x1A, 0x00, 0x01, 0x00, 0x00))).toBe(65536);
    });
  });

  describe('negative integers', () => {
    it('decodes negative integers', () => {
      // 0x20 = type 1, additionalInfo 0 → -1
      expect(cborDecode(bytes(0x20))).toBe(-1);
      // 0x37 = type 1, additionalInfo 23 → -24
      expect(cborDecode(bytes(0x37))).toBe(-24);
    });
  });

  describe('byte strings', () => {
    it('decodes a byte string', () => {
      // 0x43 = type 2 (byte string), length 3; followed by bytes 0x01, 0x02, 0x03
      const result = cborDecode(bytes(0x43, 0x01, 0x02, 0x03));
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Array.from(result)).toEqual([1, 2, 3]);
    });

    it('decodes an empty byte string', () => {
      // 0x40 = type 2, length 0
      const result = cborDecode(bytes(0x40));
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(0);
    });
  });

  describe('text strings', () => {
    it('decodes a text string', () => {
      // 0x63 = type 3 (text string), length 3; followed by "foo"
      const result = cborDecode(bytes(0x63, 0x66, 0x6F, 0x6F));
      expect(result).toBe('foo');
    });

    it('decodes an empty text string', () => {
      // 0x60 = type 3, length 0
      expect(cborDecode(bytes(0x60))).toBe('');
    });
  });

  describe('arrays', () => {
    it('decodes a simple array', () => {
      // 0x82 = type 4 (array), length 2; items: 1, 2
      const result = cborDecode(bytes(0x82, 0x01, 0x02));
      expect(result).toEqual([1, 2]);
    });

    it('decodes an empty array', () => {
      // 0x80 = type 4, length 0
      expect(cborDecode(bytes(0x80))).toEqual([]);
    });
  });

  describe('maps', () => {
    it('decodes a known CBOR map with integer key and text value', () => {
      // {1: "hi"} → 0xA1 (map, 1 entry), 0x01 (key=1), 0x62 0x68 0x69 (text "hi")
      const result = cborDecode(bytes(0xA1, 0x01, 0x62, 0x68, 0x69));
      expect(result).toEqual({ '1': 'hi' });
    });

    it('decodes a map with string key and integer value', () => {
      // {"a": 42} → 0xA1, 0x61 0x61 (text "a"), 0x18 0x2A (uint 42)
      const result = cborDecode(bytes(0xA1, 0x61, 0x61, 0x18, 0x2A));
      expect(result).toEqual({ a: 42 });
    });

    it('decodes an empty map', () => {
      // 0xA0 = type 5 (map), length 0
      expect(cborDecode(bytes(0xA0))).toEqual({});
    });
  });

  describe('nested CBOR structures', () => {
    it('decodes a map containing an array value', () => {
      // {1: [1, 2]} → 0xA1 (map,1), 0x01 (key=1), 0x82 (array,2), 0x01, 0x02
      const result = cborDecode(bytes(0xA1, 0x01, 0x82, 0x01, 0x02));
      expect(result).toEqual({ '1': [1, 2] });
    });

    it('decodes a map containing a byte string', () => {
      // {1: <bytes [0xAB]>} → 0xA1, 0x01, 0x41, 0xAB
      const result = cborDecode(bytes(0xA1, 0x01, 0x41, 0xAB));
      expect(result['1']).toBeInstanceOf(Uint8Array);
      expect(Array.from(result['1'])).toEqual([0xAB]);
    });

    it('decodes a nested map', () => {
      // {1: {2: 3}} → 0xA1, 0x01, 0xA1, 0x02, 0x03
      const result = cborDecode(bytes(0xA1, 0x01, 0xA1, 0x02, 0x03));
      expect(result).toEqual({ '1': { '2': 3 } });
    });
  });

  describe('simple values', () => {
    it('decodes false', () => {
      // 0xF4 = type 7, additionalInfo 20 → false
      expect(cborDecode(bytes(0xF4))).toBe(false);
    });

    it('decodes true', () => {
      // 0xF5 = type 7, additionalInfo 21 → true
      expect(cborDecode(bytes(0xF5))).toBe(true);
    });

    it('decodes null', () => {
      // 0xF6 = type 7, additionalInfo 22 → null
      expect(cborDecode(bytes(0xF6))).toBe(null);
    });
  });

  describe('error handling', () => {
    it('throws on unsupported major type (e.g. tag, type 6)', () => {
      // 0xC0 = type 6 (tag), unsupported
      expect(() => cborDecode(bytes(0xC0, 0x00))).toThrow('CBOR');
    });

    it('throws on unsupported simple value', () => {
      // 0xE0 = type 7, additionalInfo 0 → unsupported simple
      expect(() => cborDecode(bytes(0xE0))).toThrow('CBOR');
    });

    it('throws on unsupported length encoding (additionalInfo=31, indefinite length)', () => {
      // 0x5F = type 2 (byte string), additionalInfo 31 (indefinite)
      expect(() => cborDecode(bytes(0x5F))).toThrow('CBOR');
    });

    it('throws or errors on truncated/empty input', () => {
      expect(() => cborDecode(bytes())).toThrow();
    });

    it('throws on truncated byte string (declared length exceeds buffer)', () => {
      // 0x43 = byte string of length 3, but only 1 byte follows
      // This may throw depending on DataView bounds
      expect(() => cborDecode(bytes(0x43, 0x01))).toThrow();
    });
  });
});
