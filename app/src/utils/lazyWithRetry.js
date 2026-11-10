/**
 * React.lazy wrapper with auto-reload on stale-chunk failure.
 *
 * After a redeploy, the frontend bundle ships with new content-hashed asset
 * filenames. If a user has the old HTML loaded and clicks something that
 * lazy-imports a chunk, the browser fetches the OLD hash → 404 → import()
 * rejects. The user is stuck on a route that won't load until they hard-refresh.
 *
 * This wrapper: on the FIRST chunk-load error in a session, hard-reload the
 * page so the browser pulls fresh HTML pointing at the new chunks. If the
 * retry also fails, the error propagates to the error boundary instead of
 * looping forever.
 *
 * sessionStorage is used (not localStorage) so the flag clears when the
 * browser tab closes — each new session gets one free retry attempt.
 *
 * Usage:
 *   import lazy from './utils/lazyWithRetry'
 *   const Page = lazy(() => import('./pages/Page'))
 */

import { lazy } from 'react'
import UpdateRequiredNotice from '../components/UpdateRequiredNotice'
import { shouldDeferReload, announceUpdateRequired } from '../lib/reloadGuard'
import { isStaleChunkError } from './staleChunk'

const RELOAD_FLAG = 'uct.chunk-reload-attempted'

function isChunkLoadError(err) {
  if (!err) return false
  const msg = String(err.message || err.name || err)
  return /Failed to fetch dynamically imported module|Loading chunk|error loading dynamically imported module|ChunkLoadError|Importing a module script failed/i.test(msg)
}

export default function lazyWithRetry(importer) {
  return lazy(async () => {
    try {
      const mod = await importer()
      // Clear the retry flag on success so a future stale-chunk can also retry.
      try { sessionStorage.removeItem(RELOAD_FLAG) } catch {}
      return mod
    } catch (err) {
      let alreadyTried = false
      try { alreadyTried = !!sessionStorage.getItem(RELOAD_FLAG) } catch {}

      // A reload would close the member's pop-out windows (or this IS one): resolve a stub so the
      // desk stays mounted, and let the toast ask. No flag is set, so the member's own reload works.
      // Deferred branch only: also the CSS-preload and MIME forms of a stale chunk (staleChunk.js).
      if ((isChunkLoadError(err) || isStaleChunkError(err)) && shouldDeferReload()) {
        announceUpdateRequired()
        return { default: UpdateRequiredNotice }
      }

      if (isChunkLoadError(err) && !alreadyTried) {
        try { sessionStorage.setItem(RELOAD_FLAG, String(Date.now())) } catch {}
        // Hard-reload to pick up new HTML with current asset hashes.
        window.location.reload()
        // Return a never-resolving promise so React doesn't try to render
        // anything else before the reload completes.
        return new Promise(() => {})
      }

      throw err
    }
  })
}

/**
 * Plain lazy() for sites that do not auto-reload: resolves the UpdateRequiredNotice stub ONLY when a
 * reload would close pop-out windows and the failure is a stale chunk. Anything else rethrows, so
 * with no pop-out open the boundary behaves exactly as with plain lazy().
 */
export function lazyDeferrable(importer) {
  return lazy(async () => {
    try {
      return await importer()
    } catch (err) {
      if (isStaleChunkError(err) && shouldDeferReload()) {
        announceUpdateRequired()
        return { default: UpdateRequiredNotice }
      }
      throw err
    }
  })
}

// Exported for tests
export { isChunkLoadError, RELOAD_FLAG }
