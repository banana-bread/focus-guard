import { vi } from "vitest";

/**
 * Returns a fresh Chrome API mock on each call, preventing state leakage between tests.
 */
export function buildChromeMock() {
  // In-memory storage backing
  const storageData = {};

  // In-memory rules array for declarativeNetRequest
  let rulesArray = [];

  // Alarm listeners for triggering in tests
  const alarmListeners = [];

  const mock = {
    runtime: {
      sendMessage: vi.fn((msg, cb) => {
        if (typeof cb === "function") cb(undefined);
      }),
      getURL: vi.fn((path) => `chrome-extension://test-extension-id${path}`),
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    },

    storage: {
      local: {
        _data: storageData,
        get: vi.fn((keys) => {
          if (keys === null || keys === undefined) {
            return Promise.resolve({ ...storageData });
          }
          if (typeof keys === "string") {
            return Promise.resolve({ [keys]: storageData[keys] });
          }
          if (Array.isArray(keys)) {
            const result = {};
            for (const key of keys) {
              if (key in storageData) result[key] = storageData[key];
            }
            return Promise.resolve(result);
          }
          // keys is an object with defaults
          const result = {};
          for (const [key, defaultVal] of Object.entries(keys)) {
            result[key] = key in storageData ? storageData[key] : defaultVal;
          }
          return Promise.resolve(result);
        }),
        set: vi.fn((obj) => {
          Object.assign(storageData, obj);
          return Promise.resolve();
        }),
        remove: vi.fn((key) => {
          if (Array.isArray(key)) {
            for (const k of key) delete storageData[k];
          } else {
            delete storageData[key];
          }
          return Promise.resolve();
        }),
      },
    },

    declarativeNetRequest: {
      getDynamicRules: vi.fn(() => Promise.resolve([...rulesArray])),
      updateDynamicRules: vi.fn((delta) => {
        if (delta.removeRuleIds) {
          rulesArray = rulesArray.filter((r) => !delta.removeRuleIds.includes(r.id));
        }
        if (delta.addRules) {
          rulesArray.push(...delta.addRules);
        }
        return Promise.resolve();
      }),
    },

    alarms: {
      create: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve()),
      onAlarm: {
        addListener: vi.fn((fn) => {
          alarmListeners.push(fn);
        }),
        trigger: (alarm) => {
          for (const fn of alarmListeners) fn(alarm);
        },
      },
    },
  };

  return mock;
}
