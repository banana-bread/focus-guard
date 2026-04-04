import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger } from '@/core/logger';

describe('createLogger', () => {
  it('returns an object with debug, info, warn, error methods', () => {
    const logger = createLogger('test');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('suppresses output when VITEST env var is set', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const logger = createLogger('service_worker');
    logger.info('test_event');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  describe('when VITEST is unset', () => {
    afterEach(() => {
      process.env['VITEST'] = 'true';
    });

    it('emits JSON with correct shape', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      process.env['VITEST'] = '';
      const logger = createLogger('popup');
      logger.info('domain_blocked', { domain: 'example.com' });
      expect(spy).toHaveBeenCalledOnce();
      const emitted = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
      expect(emitted['level']).toBe('info');
      expect(emitted['event']).toBe('domain_blocked');
      expect(emitted['context']).toBe('popup');
      expect(emitted['domain']).toBe('example.com');
      spy.mockRestore();
    });

    it('includes context in every entry', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
      process.env['VITEST'] = '';
      const logger = createLogger('blocked_page');
      logger.debug('some_event');
      const emitted = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
      expect(emitted['context']).toBe('blocked_page');
      spy.mockRestore();
    });

    it('emits only level/event/context when fields omitted', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      process.env['VITEST'] = '';
      const logger = createLogger('content_script');
      logger.warn('something_happened');
      const emitted = JSON.parse(spy.mock.calls[0]?.[0] as string) as Record<string, unknown>;
      expect(Object.keys(emitted).sort()).toEqual(['context', 'event', 'level']);
      spy.mockRestore();
    });
  });
});
