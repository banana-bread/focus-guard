import { describe, it, expect } from 'vitest';
import { cborDecode } from '@/shared/cbor';
import type { CborMap } from '@/shared/cbor';

describe('cborDecode', () => {
  describe('positive integers', () => {
    it('decodes inline integer 0', () => {
      // major type 0, additional info 0 → value 0
      expect(cborDecode(new Uint8Array([0x00]))).toBe(0);
    });

    it('decodes inline integer 23', () => {
      expect(cborDecode(new Uint8Array([0x17]))).toBe(23);
    });

    it('decodes 1-byte integer 24', () => {
      // 0x18 = major 0, additional 24 (1-byte follows)
      expect(cborDecode(new Uint8Array([0x18, 0x18]))).toBe(24);
    });

    it('decodes 1-byte integer 255', () => {
      expect(cborDecode(new Uint8Array([0x18, 0xff]))).toBe(255);
    });

    it('decodes 2-byte integer', () => {
      // 0x19 = major 0, additional 25 (2-byte follows)
      expect(cborDecode(new Uint8Array([0x19, 0x01, 0x00]))).toBe(256);
    });
  });

  describe('negative integers', () => {
    it('decodes negative integer -1', () => {
      // major type 1, additional 0 → -1 - 0 = -1
      expect(cborDecode(new Uint8Array([0x20]))).toBe(-1);
    });

    it('decodes negative integer -7 (COSE alg)', () => {
      // major type 1, additional 6 → -1 - 6 = -7
      expect(cborDecode(new Uint8Array([0x26]))).toBe(-7);
    });

    it('decodes negative integer -24 via inline', () => {
      // major type 1, additional 23 → -1 - 23 = -24
      expect(cborDecode(new Uint8Array([0x37]))).toBe(-24);
    });

    it('decodes negative integer with 1-byte length', () => {
      // 0x38 = major 1, additional 24 (1-byte follows); value = -1 - 24 = -25
      expect(cborDecode(new Uint8Array([0x38, 0x18]))).toBe(-25);
    });
  });

  describe('byte strings', () => {
    it('decodes empty byte string', () => {
      // 0x40 = major 2, length 0
      const result = cborDecode(new Uint8Array([0x40]));
      expect(result).toBeInstanceOf(Uint8Array);
      expect((result as Uint8Array).length).toBe(0);
    });

    it('decodes 1-byte byte string', () => {
      // 0x41 = major 2, length 1, then 0xAB
      const result = cborDecode(new Uint8Array([0x41, 0xab]));
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(new Uint8Array([0xab]));
    });

    it('decodes 23-byte byte string (inline length)', () => {
      const data = new Uint8Array(23).fill(0xff);
      const encoded = new Uint8Array([0x57, ...data]); // 0x40 | 23 = 0x57
      const result = cborDecode(encoded);
      expect(result).toEqual(data);
    });

    it('decodes 24-byte byte string (1-byte length follows)', () => {
      const data = new Uint8Array(24).fill(0xaa);
      const encoded = new Uint8Array([0x58, 0x18, ...data]); // 0x58 = major 2, additional 24
      const result = cborDecode(encoded);
      expect(result).toEqual(data);
    });
  });

  describe('text strings', () => {
    it('decodes empty text string', () => {
      // 0x60 = major 3, length 0
      expect(cborDecode(new Uint8Array([0x60]))).toBe('');
    });

    it('decodes short text string "none"', () => {
      const enc = new TextEncoder();
      const bytes = enc.encode('none');
      // 0x64 = major 3, length 4
      const encoded = new Uint8Array([0x64, ...bytes]);
      expect(cborDecode(encoded)).toBe('none');
    });

    it('decodes text string "fmt"', () => {
      const bytes = new TextEncoder().encode('fmt');
      const encoded = new Uint8Array([0x63, ...bytes]);
      expect(cborDecode(encoded)).toBe('fmt');
    });
  });

  describe('arrays', () => {
    it('decodes empty array', () => {
      // 0x80 = major 4, length 0
      expect(cborDecode(new Uint8Array([0x80]))).toEqual([]);
    });

    it('decodes array of byte strings', () => {
      // [ h'01', h'02' ]
      // 0x82 = major 4, length 2; 0x41 0x01 = bstr(1); 0x41 0x02 = bstr(1)
      const result = cborDecode(new Uint8Array([0x82, 0x41, 0x01, 0x41, 0x02]));
      expect(result).toEqual([new Uint8Array([0x01]), new Uint8Array([0x02])]);
    });
  });

  describe('maps', () => {
    it('decodes map with text-string keys and byte-string values', () => {
      // { "fmt": "none", "authData": h'AB' }
      // Build manually:
      // 0xa2 = map(2)
      // 0x63 "fmt" (3 bytes) + 0x64 "none" (4 bytes)
      // 0x68 "authData" (8 bytes) + 0x41 0xAB
      const fmtKey = new TextEncoder().encode('fmt');
      const noneVal = new TextEncoder().encode('none');
      const authDataKey = new TextEncoder().encode('authData');
      const encoded = new Uint8Array([
        0xa2,
        0x63,
        ...fmtKey,
        0x64,
        ...noneVal,
        0x68,
        ...authDataKey,
        0x41,
        0xab,
      ]);
      const result = cborDecode(encoded) as CborMap;
      expect(result).toBeInstanceOf(Map);
      expect(result.get('fmt')).toBe('none');
      expect(result.get('authData')).toEqual(new Uint8Array([0xab]));
    });

    it('decodes map with integer keys and byte-string values (COSE_Key style)', () => {
      // { 1: 2, 3: -7, -1: 1, -2: h'AA', -3: h'BB' }
      // kty=2, alg=-7, crv=1, x=h'AA', y=h'BB'
      // 0xa5 = map(5)
      // 0x01 0x02 (kty: 2)
      // 0x03 0x26 (alg: -7)
      // 0x20 0x01 (-1: 1 = crv P-256)
      // 0x21 0x41 0xaa (-2: h'AA')
      // 0x22 0x41 0xbb (-3: h'BB')
      const encoded = new Uint8Array([
        0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x41, 0xaa, 0x22, 0x41, 0xbb,
      ]);
      const result = cborDecode(encoded) as CborMap;
      expect(result).toBeInstanceOf(Map);
      expect(result.get(1)).toBe(2);
      expect(result.get(3)).toBe(-7);
      expect(result.get(-1)).toBe(1);
      expect(result.get(-2)).toEqual(new Uint8Array([0xaa]));
      expect(result.get(-3)).toEqual(new Uint8Array([0xbb]));
    });

    it('decodes nested map', () => {
      // { "outer": { "inner": 42 } }
      // 0xa1 = map(1)
      // 0x65 "outer" (5 bytes)
      // 0xa1 = map(1)
      // 0x65 "inner" (5 bytes)
      // 0x18 0x2a (42)
      const outerKey = new TextEncoder().encode('outer');
      const innerKey = new TextEncoder().encode('inner');
      const encoded = new Uint8Array([
        0xa1,
        0x65,
        ...outerKey,
        0xa1,
        0x65,
        ...innerKey,
        0x18,
        0x2a,
      ]);
      const result = cborDecode(encoded) as CborMap;
      expect(result).toBeInstanceOf(Map);
      const inner = result.get('outer') as CborMap;
      expect(inner).toBeInstanceOf(Map);
      expect(inner.get('inner')).toBe(42);
    });
  });

  describe('error cases', () => {
    it('throws on unsupported major type (float/simple)', () => {
      // 0xe0 = major type 7 (float/simple) — not supported
      expect(() => cborDecode(new Uint8Array([0xe0]))).toThrow();
    });

    it('throws on truncated byte string', () => {
      // 0x43 = major 2, length 3 — but only 2 bytes follow
      expect(() => cborDecode(new Uint8Array([0x43, 0x01, 0x02]))).toThrow();
    });

    it('throws on truncated map', () => {
      // 0xa2 = map(2) — declares 2 entries but only 1 provided
      const fmtKey = new TextEncoder().encode('fmt');
      expect(() => cborDecode(new Uint8Array([0xa2, 0x63, ...fmtKey, 0x60]))).toThrow();
    });

    it('throws on empty input', () => {
      expect(() => cborDecode(new Uint8Array([]))).toThrow();
    });
  });
});
