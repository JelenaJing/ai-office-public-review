/**
 * Polyfills for Electron's bundled Node.js version.
 *
 * diagnostics_channel.tracingChannel was added in Node 19.9 / 20.x.
 * Electron ships Node 18.x, so imapflow will crash without this polyfill.
 *
 * MUST be imported as the very first statement in electron/main/index.ts
 * so it runs before imapflow's module initialisation code.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const dc = require('node:diagnostics_channel') as Record<string, unknown>

if (typeof dc['tracingChannel'] !== 'function') {
  const noopChannel = {
    subscribe: () => {},
    unsubscribe: () => {},
    get hasSubscribers() { return false },
    publish: () => false,
    bindStore: () => {},
    unbindStore: () => {},
    runStores: (_ctx: unknown, fn: () => void) => fn(),
  }

  dc['tracingChannel'] = (_nameOrChannel: unknown) => ({
    start: noopChannel,
    end: noopChannel,
    asyncStart: noopChannel,
    asyncEnd: noopChannel,
    error: noopChannel,
    traceSync<T>(fn: () => T): T { return fn() },
    tracePromise<T>(fn: () => Promise<T>): Promise<T> { return fn() },
    traceCallback<T extends (...a: unknown[]) => unknown>(fn: T, ..._args: unknown[]): unknown {
      return fn
    },
    subscribe: () => {},
    unsubscribe: () => {},
    get hasSubscribers() { return false },
    publish: () => false,
    bindStore: () => {},
    unbindStore: () => {},
    runStores: (_ctx: unknown, fn: () => void) => fn(),
  })
}
