/**
 * Shared Chrome extension API mock helper.
 * Call setupChromeMock() in beforeEach to get a fresh mock for each test.
 */

export function setupChromeMock() {
  const storage = {};

  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(async (key) => {
          if (key === null || key === undefined) {
            return { ...storage };
          }
          if (typeof key === 'string') {
            return { [key]: storage[key] };
          }
          if (Array.isArray(key)) {
            const result = {};
            for (const k of key) result[k] = storage[k];
            return result;
          }
          if (typeof key === 'object') {
            const result = {};
            for (const k of Object.keys(key)) {
              result[k] = k in storage ? storage[k] : key[k];
            }
            return result;
          }
          return {};
        }),
        set: vi.fn(async (items) => {
          Object.assign(storage, items);
        }),
        remove: vi.fn(async (key) => {
          if (typeof key === 'string') {
            delete storage[key];
          } else if (Array.isArray(key)) {
            for (const k of key) delete storage[k];
          }
        }),
        clear: vi.fn(async () => {
          for (const key of Object.keys(storage)) delete storage[key];
        }),
        _storage: storage,
      },
    },

    runtime: {
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onInstalled: {
        addListener: vi.fn(),
      },
      onStartup: {
        addListener: vi.fn(),
      },
      getURL: vi.fn((path) => `chrome-extension://test-extension-id${path}`),
      lastError: null,
    },

    declarativeNetRequest: {
      getDynamicRules: vi.fn(async () => []),
      updateDynamicRules: vi.fn(async () => {}),
      _rules: [],
    },

    alarms: {
      create: vi.fn(async () => {}),
      clear: vi.fn(async () => true),
      clearAll: vi.fn(async () => true),
      get: vi.fn(async () => null),
      getAll: vi.fn(async () => []),
      onAlarm: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },

    tabs: {
      query: vi.fn(async () => []),
      update: vi.fn(async () => {}),
      create: vi.fn(async () => {}),
      onUpdated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  };

  global.chrome = chromeMock;

  return chromeMock;
}
