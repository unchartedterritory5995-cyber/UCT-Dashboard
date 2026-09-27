// The Notebook's on-demand views and dialogs load through this ONE helper (wave 7, lane I,
// fix round 1, review M-5). It retries a failed chunk once IN PLACE, and hands a second
// failure to the app's existing stale-chunk recovery, `utils/lazyWithRetry`.
//
// Before lane I3 these views rode inside the Notebook's own chunk and could not fail to load
// on their own. Now a view's first open fetches its chunk, and two different things can make
// that fetch fail:
//   * a network blip: the file is still on the server, and asking again works;
//   * a deploy since this tab loaded: the old hashed file is gone, asking again fails too, and
//     only a fresh index.html (a reload) knows the new name.
// The in-place retry covers the first without costing the member a reload (their chosen view
// and scroll survive). `lazyWithRetry` covers the second exactly as it does for every route in
// App.jsx: one reload per session, and after that the error reaches the boundary instead of
// looping. Words are never at stake either way -- they live in the durable store.
import { lazy } from 'react'
import lazyWithRetry, { isChunkLoadError } from '../../../utils/lazyWithRetry'

export const RETRY_WAIT_MS = 400

// ⚰️ WAVE-8 WALK W7: "ask again" with `load()` NEVER REFETCHED in Chromium. A failed dynamic
// `import()` is remembered in the module map for that URL, so calling the same `() => import(...)`
// a second time rejects at once without a request -- measured in a real Chromium: one request,
// then `lazyWithRetry`'s reload 595 ms later and the member's chosen view lost, while this file
// promised the opposite. The retry therefore imports the failed chunk under a NEW specifier (the
// same file with a `chunk-retry` query), which the module map has never seen. Chromium and
// Firefox name the chunk's URL in the error; Safari does not, so there the retry is `load()`
// again, as before. The chunk's own imports resolve to the same shared files, and its CSS was
// already attached by Vite's preload on the first attempt.
export const CHUNK_RETRY_PARAM = 'chunk-retry'
const CHUNK_URL = /((?:https?:\/\/[^\s'"()]+)?\/[^\s'"()?#]+\.m?js)(?![\w])/i

/** The same-origin chunk URL a failed dynamic import names in its message, or null. */
export function failedChunkUrl(err, origin = globalThis.location?.origin) {
  const m = CHUNK_URL.exec(String(err?.message ?? err ?? ''))
  if (!m || !origin) return null
  let url
  try { url = new URL(m[1], origin) } catch { return null }
  return url.origin === origin ? url : null
}

/** `failedChunkUrl` with a `chunk-retry` query the module map has never seen, as a string. */
export function retrySpecifier(err, stamp = Date.now(), origin = globalThis.location?.origin) {
  const url = failedChunkUrl(err, origin)
  if (!url) return null
  url.searchParams.set(CHUNK_RETRY_PARAM, String(stamp))
  return url.href
}

/** The importer the retry uses. A property, so a rail can swap it (jsdom cannot fetch a chunk). */
export const chunkRetry = {
  importUrl: (specifier) => import(/* @vite-ignore */ specifier),
}

export function importWithOneRetry(load, waitMs = RETRY_WAIT_MS) {
  return load().catch((err) => {
    // Only a failed FETCH is worth asking for again. A module that loaded and then threw is a
    // bug, and a second evaluation would throw the same way.
    if (!isChunkLoadError(err)) throw err
    const specifier = retrySpecifier(err)
    return new Promise((resolve) => setTimeout(resolve, waitMs)).then(() => {
      if (!specifier) return load()
      return chunkRetry.importUrl(specifier).then((mod) => {
        // Every caller hands a plain `() => import('./X')` of a default export. A module with no
        // `default` would mean a loader that maps its import; then the original failure stands
        // and takes its usual path, rather than a view that renders `undefined`.
        if (mod && 'default' in mod) return mod
        throw err
      })
    })
  })
}

export default function lazyChunk(load, waitMs = RETRY_WAIT_MS) {
  return lazyWithRetry(() => importWithOneRetry(load, waitMs))
}

/**
 * ⛔ Ruling D-I2 (wave 7, frontend re-review R-2): the LEAF form -- for a view that sits inside its
 * OWN error boundary (PdfViewerBoundary's PDF viewer, WidgetEmbedView's live embeds). One in-place
 * retry of a failed fetch, exactly as `lazyChunk`; after that the error is THROWN, so the leaf's
 * boundary shows its fallback (the "preview isn't available" line, the archived image).
 *
 * ⛔⛔ NEVER A PAGE RELOAD. `lazyChunk` hands a second failure to `lazyWithRetry`, which reloads the
 * page -- right for a view whose failure would blank the route anyway, wrong for one embed inside a
 * working note: the reload replaces the editor, and offline (Wave Q1's default) it lands on the
 * browser's offline page. A stale chunk here costs the member a leaf fallback until they reload.
 * `tabs/NotebookTab.lazyViews.test.js` allows it only where the enclosing boundary is visible.
 */
export function lazyLeaf(load, waitMs = RETRY_WAIT_MS) {
  return lazy(() => importWithOneRetry(load, waitMs))
}
