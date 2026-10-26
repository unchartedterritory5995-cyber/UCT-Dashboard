// Task 7.5 (wave 7, "bytes first"): the emoji data (`emojiData.js`) loads on the first `:` typed
// instead of riding the Notebook's first-open bytes. Same shape as templatesLoader.js.
//
//   loadEmoji()    one dynamic import, memoised, retried once in place (`importWithOneRetry`)
//   loadedEmoji()  the module if it has already arrived, else null (sync)
//
// NEVER a bare `await import('./emojiData')`: a failed dynamic import is remembered for its URL
// until the page reloads (lib/lazyChunk.js).
import { RETRY_WAIT_MS, importWithOneRetry } from './lazyChunk'

// A property so a rail can count or fail the fetch (jsdom cannot fetch a chunk).
export const emojiLoaders = {
  data: () => import('./emojiData'),
}

// Named exports only: accept the module that carries the lookups we need.
const hasLookups = (mod) => typeof mod?.searchEmoji === 'function' && typeof mod?.emojiByName === 'function'

let pending = null
let loaded = null

/** The emoji module. Concurrent callers share one import; a failure clears the memo so the next call asks again. */
export function loadEmoji() {
  if (!pending) {
    const p = importWithOneRetry(() => emojiLoaders.data(), RETRY_WAIT_MS, hasLookups)
    pending = p
    p.then((mod) => { if (pending === p) loaded = mod }, () => { if (pending === p) pending = null })
  }
  return pending
}

/** The module if it has already arrived, else null. Never starts a load. */
export function loadedEmoji() {
  return loaded
}

/** Test seam: forget the memo so a rail can start from "not loaded". */
export function resetEmojiLoaderForTest() {
  pending = null
  loaded = null
}
