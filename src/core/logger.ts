/** Log severity levels. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Execution context where the log originated. */
export type Context = string;

/** Shape of a structured log entry. */
export interface LogEntry {
  level: LogLevel;
  event: string;
  context: Context;
  [key: string]: unknown;
}

/** Logger interface returned by {@link createLogger}. */
export interface Logger {
  debug: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  error: (event: string, fields?: Record<string, unknown>) => void;
}

function emit(
  context: Context,
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (process.env['VITEST']) return;

  const entry: LogEntry = { level, event, context, ...fields };
  // eslint-disable-next-line no-console
  console[level](JSON.stringify(entry));
}

/**
 * Creates a structured logger bound to the given execution context.
 *
 * @param context - The execution context (e.g. `service_worker`, `popup`).
 * @returns A logger with `debug`, `info`, `warn`, and `error` methods.
 */
export function createLogger(context: Context): Logger {
  return {
    debug: (event: string, fields?: Record<string, unknown>): void =>
      emit(context, 'debug', event, fields),
    info: (event: string, fields?: Record<string, unknown>): void =>
      emit(context, 'info', event, fields),
    warn: (event: string, fields?: Record<string, unknown>): void =>
      emit(context, 'warn', event, fields),
    error: (event: string, fields?: Record<string, unknown>): void =>
      emit(context, 'error', event, fields),
  };
}
