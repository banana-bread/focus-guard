import { setupChromeMock } from '../helpers/chrome-mock.js';
import {
  getBlocklist,
  setBlocklist,
  getCredential,
  setCredential,
  clearCredential,
  getUnlocks,
  setUnlock,
  removeUnlock,
  getSettings,
  updateSettings,
} from 'lib/storage.js';

describe('storage.js', () => {
  let chromeMock;

  beforeEach(() => {
    chromeMock = setupChromeMock();
  });

  describe('blocklist', () => {
    it('returns empty array by default when storage is empty', async () => {
      const result = await getBlocklist();
      expect(result).toEqual([]);
    });

    it('reads blocklist from storage', async () => {
      chromeMock.storage.local._storage.blocklist = ['reddit.com', 'twitter.com'];
      const result = await getBlocklist();
      expect(result).toEqual(['reddit.com', 'twitter.com']);
    });

    it('writes blocklist to storage', async () => {
      await setBlocklist(['example.com']);
      expect(chromeMock.storage.local._storage.blocklist).toEqual(['example.com']);
    });

    it('overwrites existing blocklist', async () => {
      chromeMock.storage.local._storage.blocklist = ['old.com'];
      await setBlocklist(['new.com', 'other.com']);
      expect(chromeMock.storage.local._storage.blocklist).toEqual(['new.com', 'other.com']);
    });
  });

  describe('credential', () => {
    it('returns null by default when storage is empty', async () => {
      const result = await getCredential();
      expect(result).toBeNull();
    });

    it('reads credential from storage', async () => {
      const cred = { credentialId: 'abc123', publicKeySpki: 'xyz', signCount: 0 };
      chromeMock.storage.local._storage.credential = cred;
      const result = await getCredential();
      expect(result).toEqual(cred);
    });

    it('writes credential to storage', async () => {
      const cred = { credentialId: 'test-id', signCount: 1 };
      await setCredential(cred);
      expect(chromeMock.storage.local._storage.credential).toEqual(cred);
    });

    it('clears credential from storage', async () => {
      chromeMock.storage.local._storage.credential = { credentialId: 'test' };
      await clearCredential();
      expect('credential' in chromeMock.storage.local._storage).toBe(false);
    });

    it('clearCredential calls chrome.storage.local.remove', async () => {
      await clearCredential();
      expect(chromeMock.storage.local.remove).toHaveBeenCalledWith('credential');
    });
  });

  describe('unlocks', () => {
    it('returns empty object by default when storage is empty', async () => {
      const result = await getUnlocks();
      expect(result).toEqual({});
    });

    it('reads unlocks from storage', async () => {
      const unlocks = { 'reddit.com': { unlockedAt: 1000, expiresAt: 2000 } };
      chromeMock.storage.local._storage.unlocks = unlocks;
      const result = await getUnlocks();
      expect(result).toEqual(unlocks);
    });

    it('setUnlock adds a new unlock record', async () => {
      const data = { unlockedAt: 1000, expiresAt: 2000 };
      await setUnlock('example.com', data);
      expect(chromeMock.storage.local._storage.unlocks).toEqual({ 'example.com': data });
    });

    it('setUnlock preserves existing unlock records', async () => {
      chromeMock.storage.local._storage.unlocks = {
        'reddit.com': { unlockedAt: 100, expiresAt: 200 },
      };
      await setUnlock('twitter.com', { unlockedAt: 300, expiresAt: 400 });
      expect(chromeMock.storage.local._storage.unlocks).toEqual({
        'reddit.com': { unlockedAt: 100, expiresAt: 200 },
        'twitter.com': { unlockedAt: 300, expiresAt: 400 },
      });
    });

    it('setUnlock overwrites existing unlock for same domain', async () => {
      chromeMock.storage.local._storage.unlocks = {
        'reddit.com': { unlockedAt: 100, expiresAt: 200 },
      };
      await setUnlock('reddit.com', { unlockedAt: 500, expiresAt: 600 });
      expect(chromeMock.storage.local._storage.unlocks['reddit.com']).toEqual({
        unlockedAt: 500,
        expiresAt: 600,
      });
    });

    it('removeUnlock removes a domain from unlocks', async () => {
      chromeMock.storage.local._storage.unlocks = {
        'reddit.com': { unlockedAt: 100, expiresAt: 200 },
        'twitter.com': { unlockedAt: 300, expiresAt: 400 },
      };
      await removeUnlock('reddit.com');
      expect(chromeMock.storage.local._storage.unlocks).toEqual({
        'twitter.com': { unlockedAt: 300, expiresAt: 400 },
      });
    });

    it('removeUnlock is a no-op when domain not in unlocks', async () => {
      chromeMock.storage.local._storage.unlocks = {};
      await removeUnlock('nonexistent.com');
      expect(chromeMock.storage.local._storage.unlocks).toEqual({});
    });
  });

  describe('settings', () => {
    it('returns default settings when storage is empty', async () => {
      const result = await getSettings();
      expect(result).toEqual({ unlockDurationMinutes: 30 });
    });

    it('reads settings from storage', async () => {
      chromeMock.storage.local._storage.settings = { unlockDurationMinutes: 60 };
      const result = await getSettings();
      expect(result).toEqual({ unlockDurationMinutes: 60 });
    });

    it('updateSettings writes valid duration to storage', async () => {
      await updateSettings({ unlockDurationMinutes: 45 });
      expect(chromeMock.storage.local._storage.settings.unlockDurationMinutes).toBe(45);
    });

    it('updateSettings merges with current settings', async () => {
      chromeMock.storage.local._storage.settings = { unlockDurationMinutes: 30 };
      await updateSettings({ unlockDurationMinutes: 120 });
      expect(chromeMock.storage.local._storage.settings).toEqual({ unlockDurationMinutes: 120 });
    });

    it('updateSettings rejects non-integer value', async () => {
      await expect(updateSettings({ unlockDurationMinutes: 1.5 })).rejects.toThrow();
    });

    it('updateSettings rejects non-finite value', async () => {
      await expect(updateSettings({ unlockDurationMinutes: Infinity })).rejects.toThrow();
    });

    it('updateSettings rejects value below 1', async () => {
      await expect(updateSettings({ unlockDurationMinutes: 0 })).rejects.toThrow();
    });

    it('updateSettings rejects value above 1440', async () => {
      await expect(updateSettings({ unlockDurationMinutes: 1441 })).rejects.toThrow();
    });

    it('updateSettings accepts boundary value 1', async () => {
      await updateSettings({ unlockDurationMinutes: 1 });
      expect(chromeMock.storage.local._storage.settings.unlockDurationMinutes).toBe(1);
    });

    it('updateSettings accepts boundary value 1440', async () => {
      await updateSettings({ unlockDurationMinutes: 1440 });
      expect(chromeMock.storage.local._storage.settings.unlockDurationMinutes).toBe(1440);
    });
  });
});
