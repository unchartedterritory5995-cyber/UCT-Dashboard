// Task 7.2 (wave 7, "bytes first"): the template catalog (`notebookTemplates.js`, ~10k lines of
// builders) loads on demand instead of riding the Notebook's first-open bytes.
//
//   loadTemplates()     one dynamic import, memoised, retried once in place (`importWithOneRetry`)
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

/** The catalog module. Concurrent callers share one import; a failure is NOT remembered. */
export function loadTemplates() {
  if (!pending) {
    pending = importWithOneRetry(() => templatesLoaders.catalog(), RETRY_WAIT_MS, hasGetTemplate)
    pending.catch(() => { pending = null })
  }
  return pending
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
