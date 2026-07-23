/**
 * Never-throw async wrappers for use by the EngineWatchdog and other
 * fire-and-forget call sites. These swallow errors and log them instead
 * of letting unhandled rejections propagate (which could crash the process).
 */

import { createLogger } from '../services/logger.service';

const logger = createLogger('SafeAsync');

/**
 * Execute an async function and swallow any errors. Returns undefined on
 * failure. Useful for watchdog cleanup operations where failure must not
 * crash the tick loop.
 */
export async function safeAsync<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    logger.error(`safeAsync: swallowed error: ${String(err)}`);
    return undefined;
  }
}

/**
 * Fire-and-forget: run an async function without awaiting or catching.
 * The error is logged but never surfaces to the caller.
 */
export function fireAndForget(fn: () => Promise<unknown>): void {
  fn().catch((err: unknown) => {
    logger.error(`fireAndForget: unhandled error: ${String(err)}`);
  });
}

/**
 * Retry an async function up to `maxAttempts` times with exponential
 * backoff. Returns the first successful result or undefined if all
 * attempts fail.
 */
export async function safeRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1_000,
): Promise<T | undefined> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) {
        logger.error(`safeRetry: all ${maxAttempts} attempts failed: ${String(err)}`);
        return undefined;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return undefined;
}
