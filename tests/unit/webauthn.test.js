import { setupChromeMock } from '../helpers/chrome-mock.js';
import {
  registerCredential,
  verifyAssertionData,
  AAGUID_ALLOWLIST,
  base64urlEncode,
  base64urlDecode,
} from 'lib/webauthn.js';

// The extension origin the chrome mock reports (with trailing slash so .slice(0,-1) works)
const ORIGIN = 'chrome-extension://test-extension-id';

// First allowlist entry: YubiKey 5 NFC
const VALID_AAGUID = AAGUID_ALLOWLIST[0];
const INVALID_AAGUID = '00000000-0000-0000-0000-000000000000';

/** Convert AAGUID string to 16-byte Uint8Array. */
function aaguidToBytes(aaguidStr) {
  return new Uint8Array(
    aaguidStr.replace(/-/g, '').match(/.{2}/g).map((h) => parseInt(h, 16))
  );
}

/**
 * Build a minimal CBOR-encoded attestation object: { "authData": <bytes(58)> }
 *
 * authData layout:
 *   [0..31]  rpIdHash (zeros for tests)
 *   [32]     flags
 *   [33..36] signCount (big-endian uint32)
 *   [37..52] AAGUID (16 bytes)
 *   [53..57] padding
 *
 * CBOR encoding:
 *   A1           map(1)
 *   68           text(8)
 *   "authData"   0x61 0x75 0x74 0x68 0x44 0x61 0x74 0x61
 *   58 3A        bytes(58)
 *   <58 bytes>
 */
function buildAttestationObject(aaguid = VALID_AAGUID, signCount = 1) {
  const authData = new Uint8Array(58);
  authData[32] = 0x05; // UP + UV flags
  new DataView(authData.buffer).setUint32(33, signCount);
  authData.set(aaguidToBytes(aaguid), 37);

  const authDataKey = [0x61, 0x75, 0x74, 0x68, 0x44, 0x61, 0x74, 0x61]; // "authData"
  return new Uint8Array([0xa1, 0x68, ...authDataKey, 0x58, 58, ...authData]).buffer;
}

/**
 * Convert an IEEE P1363 signature (r||s, 64 bytes) to DER format.
 * This is the inverse of derToIEEEP1363 in webauthn.js.
 * Real WebAuthn authenticators return DER; webauthn.js converts it internally.
 */
function ieee1363ToDer(p1363) {
  const r = p1363.slice(0, 32);
  const s = p1363.slice(32, 64);
  // Prepend 0x00 if high bit is set (positive integer in DER)
  const rPad = r[0] & 0x80 ? new Uint8Array([0x00, ...r]) : r;
  const sPad = s[0] & 0x80 ? new Uint8Array([0x00, ...s]) : s;
  const inner = new Uint8Array(2 + rPad.length + 2 + sPad.length);
  let off = 0;
  inner[off++] = 0x02;
  inner[off++] = rPad.length;
  inner.set(rPad, off);
  off += rPad.length;
  inner[off++] = 0x02;
  inner[off++] = sPad.length;
  inner.set(sPad, off);
  return new Uint8Array([0x30, inner.length, ...inner]);
}

describe('webauthn.js', () => {
  let chromeMock;
  let keyPair;
  let publicKeySpkiBytes;

  // Generate a real ECDSA P-256 key pair once for the entire suite.
  beforeAll(async () => {
    keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    publicKeySpkiBytes = new Uint8Array(
      await crypto.subtle.exportKey('spki', keyPair.publicKey)
    );
  });

  beforeEach(() => {
    chromeMock = setupChromeMock();
    // Real Chrome returns 'chrome-extension://<id>/' (trailing slash); .slice(0,-1) gives the origin.
    chromeMock.runtime.getURL.mockImplementation(
      (path) => (path === '' ? `${ORIGIN}/` : `${ORIGIN}/${path}`)
    );

    // Stub navigator.credentials so tests can control create/get.
    vi.stubGlobal('navigator', {
      credentials: {
        create: vi.fn(),
        get: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // Helpers for registerCredential tests
  // ---------------------------------------------------------------------------

  /** Build a fake credential object returned by navigator.credentials.create. */
  function makeMockCredential({
    transports = ['usb'],
    aaguid = VALID_AAGUID,
    signCount = 1,
  } = {}) {
    const authData = new Uint8Array(58);
    authData[32] = 0x05;
    new DataView(authData.buffer).setUint32(33, signCount);
    authData.set(aaguidToBytes(aaguid), 37);

    return {
      rawId: new Uint8Array(32),
      response: {
        getTransports: () => transports,
        attestationObject: buildAttestationObject(aaguid, signCount),
        getPublicKey: () => publicKeySpkiBytes.buffer,
        getAuthenticatorData: () => authData.buffer,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // registerCredential
  // ---------------------------------------------------------------------------

  describe('registerCredential', () => {
    it('returns a credential with the expected shape on success', async () => {
      navigator.credentials.create.mockResolvedValue(makeMockCredential());

      const result = await registerCredential();

      expect(result).toMatchObject({
        credentialId: expect.any(String),
        publicKeySpki: expect.any(String),
        transports: ['usb'],
        signCount: 1,
        aaguid: VALID_AAGUID,
        createdAt: expect.any(String),
      });
    });

    it('persists the credential to storage on success', async () => {
      navigator.credentials.create.mockResolvedValue(makeMockCredential());

      const result = await registerCredential();

      expect(chromeMock.storage.local._storage.credential).toMatchObject({
        credentialId: result.credentialId,
        aaguid: VALID_AAGUID,
      });
    });

    it('rejects when the authenticator transport is "internal" (software key)', async () => {
      navigator.credentials.create.mockResolvedValue(
        makeMockCredential({ transports: ['internal'] })
      );

      await expect(registerCredential()).rejects.toThrow('Non-hardware key detected');
    });

    it('rejects when the authenticator transport is "hybrid"', async () => {
      navigator.credentials.create.mockResolvedValue(
        makeMockCredential({ transports: ['hybrid'] })
      );

      await expect(registerCredential()).rejects.toThrow('Non-hardware key detected');
    });

    it('accepts USB, NFC, and BLE transports as hardware-only', async () => {
      for (const transport of ['usb', 'nfc', 'ble']) {
        navigator.credentials.create.mockResolvedValue(
          makeMockCredential({ transports: [transport] })
        );
        await expect(registerCredential()).resolves.toMatchObject({ transports: [transport] });
      }
    });

    it('rejects when the AAGUID is not on the allowlist', async () => {
      navigator.credentials.create.mockResolvedValue(
        makeMockCredential({ aaguid: INVALID_AAGUID })
      );

      await expect(registerCredential()).rejects.toThrow('not on the approved hardware list');
    });

    it('accepts every AAGUID present in AAGUID_ALLOWLIST', async () => {
      // Spot-check a few entries from the allowlist
      for (const aaguid of AAGUID_ALLOWLIST.slice(0, 3)) {
        navigator.credentials.create.mockResolvedValue(makeMockCredential({ aaguid }));
        await expect(registerCredential()).resolves.toMatchObject({ aaguid });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // verifyAssertionData
  // ---------------------------------------------------------------------------

  describe('verifyAssertionData', () => {
    /**
     * Build a fully valid assertion using real crypto.
     *
     * @param {object} opts
     * @param {number}     [opts.signCount=2]     signCount encoded in authenticatorData
     * @param {Uint8Array} [opts.overrideChallenge] replace the challenge embedded in clientDataJSON
     * @returns assertion parts + challenge + credentialData
     */
    async function buildValidAssertion({ signCount = 2, overrideChallenge } = {}) {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      // rpId is the hostname of the extension origin
      const rpId = new URL(ORIGIN).hostname; // 'test-extension-id'
      const rpIdHash = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rpId))
      );

      // Minimal authenticatorData: rpIdHash(32) + flags(1) + signCount(4) = 37 bytes
      const authData = new Uint8Array(37);
      authData.set(rpIdHash, 0);
      authData[32] = 0x05; // UP + UV
      new DataView(authData.buffer).setUint32(33, signCount);

      // clientDataJSON with the (possibly overridden) challenge
      const clientData = {
        type: 'webauthn.get',
        challenge: base64urlEncode(overrideChallenge ?? challenge),
        origin: ORIGIN,
      };
      const clientDataJSON = new TextEncoder().encode(JSON.stringify(clientData));

      // Signed data = authenticatorData || SHA-256(clientDataJSON)
      const clientDataHash = new Uint8Array(
        await crypto.subtle.digest('SHA-256', clientDataJSON)
      );
      const signedData = new Uint8Array(authData.length + clientDataHash.length);
      signedData.set(authData);
      signedData.set(clientDataHash, authData.length);

      // Sign with the test private key (WebCrypto returns IEEE P1363; convert to DER for webauthn.js)
      const sigBuffer = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keyPair.privateKey,
        signedData
      );
      const signature = ieee1363ToDer(new Uint8Array(sigBuffer));

      const credentialData = {
        credentialId: 'test-cred-id',
        publicKeySpki: base64urlEncode(publicKeySpkiBytes),
        transports: ['usb'],
        signCount: 1, // previously stored count (new count must be > this)
        aaguid: VALID_AAGUID,
        createdAt: new Date().toISOString(),
      };

      return { authenticatorData: authData, clientDataJSON, signature, challenge, credentialData };
    }

    it('returns { newSignCount } on successful verification', async () => {
      const { authenticatorData, clientDataJSON, signature, challenge, credentialData } =
        await buildValidAssertion({ signCount: 2 });

      const result = await verifyAssertionData(
        { authenticatorData, clientDataJSON, signature },
        challenge,
        credentialData
      );

      expect(result).toEqual({ newSignCount: 2 });
    });

    it('rejects with "Challenge mismatch" when the challenge does not match', async () => {
      const { authenticatorData, clientDataJSON, signature, credentialData } =
        await buildValidAssertion({ signCount: 2 });

      const wrongChallenge = new Uint8Array(32).fill(0xff);

      await expect(
        verifyAssertionData(
          { authenticatorData, clientDataJSON, signature },
          wrongChallenge,
          credentialData
        )
      ).rejects.toThrow('Challenge mismatch');
    });

    it('rejects when clientData.type is not "webauthn.get"', async () => {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const clientData = {
        type: 'webauthn.create', // wrong type
        challenge: base64urlEncode(challenge),
        origin: ORIGIN,
      };
      const clientDataJSON = new TextEncoder().encode(JSON.stringify(clientData));
      const authData = new Uint8Array(37);
      const signature = new Uint8Array(70);

      const credentialData = {
        credentialId: 'test-id',
        publicKeySpki: base64urlEncode(publicKeySpkiBytes),
        signCount: 1,
        aaguid: VALID_AAGUID,
        createdAt: new Date().toISOString(),
      };

      await expect(
        verifyAssertionData(
          { authenticatorData: authData, clientDataJSON, signature },
          challenge,
          credentialData
        )
      ).rejects.toThrow('webauthn.get');
    });

    it('rejects with "Signature verification failed" when the signature is invalid', async () => {
      const { authenticatorData, clientDataJSON, challenge, credentialData } =
        await buildValidAssertion({ signCount: 2 });

      // Structurally valid DER but wrong r/s values
      const badSig = new Uint8Array([
        0x30, 0x44,
        0x02, 0x20, ...new Uint8Array(32).fill(0x01), // r = 32 × 0x01
        0x02, 0x20, ...new Uint8Array(32).fill(0x02), // s = 32 × 0x02
      ]);

      await expect(
        verifyAssertionData(
          { authenticatorData, clientDataJSON, signature: badSig },
          challenge,
          credentialData
        )
      ).rejects.toThrow('Signature verification failed');
    });

    it('rejects when sign count does not increase (clone detection)', async () => {
      // signCount in authData = 1, stored signCount = 1 → no increment → clone detected
      const { authenticatorData, clientDataJSON, signature, challenge, credentialData } =
        await buildValidAssertion({ signCount: 1 });

      // credentialData.signCount is already 1 from buildValidAssertion
      await expect(
        verifyAssertionData(
          { authenticatorData, clientDataJSON, signature },
          challenge,
          credentialData
        )
      ).rejects.toThrow('Sign counter did not increase');
    });

    it('rejects when sign count resets to zero while stored count is non-zero', async () => {
      const { authenticatorData, clientDataJSON, signature, challenge, credentialData } =
        await buildValidAssertion({ signCount: 0 });

      await expect(
        verifyAssertionData(
          { authenticatorData, clientDataJSON, signature },
          challenge,
          credentialData
        )
      ).rejects.toThrow('Sign counter reset anomaly');
    });
  });
});
