// Task 7.2 (wave 7, "bytes first"): the template catalog (`notebookTemplates.js`, ~10k lines of
// builders) loads on demand instead of riding the Notebook's first-open bytes.
//
//   loadTemplates()     one dynamic import, memoised, retried once in place (`importWithOneRetry`)
//   loadedTemplates()   the catalog module if it has already arrived, else null (sync; Task 7.4, ruling R-5)
//   getTemplateAsync()  a template by key, or null
//   preloadTemplates()  warms the load once idle, so a pick is usually instant
//
// ⛔ NEVER a bare `await import('./notebookTemplates')` anywhere: a failed dynamic import is
// remembered for its URL until the page reloads (lib/lazyChunk.js). Every caller goes through here.
// A property so a rail can fail the fetch (jsdom cannot fetch a chunk), like `chunkRetry`.
import { RETRY_WAIT_MS, importWithOneRetry } from './lazyChunk'
import whenIdle from './whenIdle'

export const templatesLoaders = {
  catalog: () => import('./notebookTemplates'),
}

// This module has NAMED exports only, so the retry's default "has a default export" test would
// refuse a good module. Accept the one that carries the lookup we need.
const hasGetTemplate = (mod) => typeof mod?.getTemplate === 'function'

let pending = null
let loaded = null

/**
 * The catalog module. Concurrent callers share one import. On a failure the memo is cleared, so the next
 * call asks again; the browser itself may still answer a failed dynamic import from its module map until
 * the page reloads (the in-place retry in `importWithOneRetry` is what works around that).
 */
export function loadTemplates() {
  if (!pending) {
    const p = importWithOneRetry(() => templatesLoaders.catalog(), RETRY_WAIT_MS, hasGetTemplate)
    pending = p
    p.then((mod) => { if (pending === p) loaded = mod }, () => { if (pending === p) pending = null })
  }
  return pending
}

/**
 * The catalog module if it has already arrived, else null. Synchronous, for a caller that cannot wait
 * (the hub's Templates sheet is built inside a gesture). It never starts a load; call `loadTemplates()`.
 */
export function loadedTemplates() {
  return loaded
}

/** A template by its stable key, or null (unknown key). Rejects only if the catalog cannot load. */
export async function getTemplateAsync(key) {
  const mod = await loadTemplates()
  return mod.getTemplate(key)
}

/** Warm the catalog once the browser is idle (a 1500 ms timer where there is no idle callback). Never throws. */
export function preloadTemplates() {
  return whenIdle(() => { loadTemplates().catch(() => {}) }, { fallbackMs: 1500 })
}
