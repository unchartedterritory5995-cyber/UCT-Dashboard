/**
 * Recovery from a STALE CHUNK: the build moved under a tab that was already open.
 *
 * Vite fingerprints every lazily-loaded chunk (`PopoutShell-Cnc5g7lA.js`). A
 * deploy replaces them with new hashes and deletes the old files, so a browser
 * still holding the previous `index.html` asks for a filename that no longer
 * exists. The dynamic `import()` rejects, React unwinds to the route boundary,
 * and the member sees "Something went wrong on this page" — on a perfectly
 * healthy app, for a route that works on any fresh load.
 *
 * Confirmed on production 8 Sep 2026: `PopoutShell-Cnc5g7lA.js` returned 404
 * while the current chunk returned 200, after a run of deploys. Opening a chart
 * pulls a lazy chunk, so /charts is where it surfaces first.
 *
 * The answer is a reload, not an error screen — the new index.html names chunks
 * that exist. ⚠️ ONCE, though: if a reload does not fix it the fault is real,
 * and reloading again would trap the user in a refresh loop with no way to read
 * the error. The stamp is per-tab (sessionStorage) and time-boxed, so a genuine
 * stale chunk weeks later still self-heals.
 */

const STAMP = 'uct:staleChunkReload'
const COOLDOWN_MS = 60_000

// Cross-browser texts for "the module you asked for did not load".
// Chrome/Edge, Firefox, Safari and the Vite preload helper all word it
// differently, and matching only Chrome's phrasing would leave Safari users on
// the error screen.
const PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,      // Safari
  /unable to preload css/i,                 // Vite's CSS preload helper
  /chunkloaderror/i,
  /loading chunk \d+ failed/i,
  // A server that answers a missing chunk with index.html instead of a 404
  // trips a MIME refusal rather than a fetch failure, and Chrome and Firefox
  // word it differently. Ours returns a real 404 today, but this is the same
  // bug wearing a different message.
  /responded with a mime type of ['"]?text\/html/i,   // Chrome/Edge
  /is not a valid javascript mime type/i,             // Firefox
]

export function isStaleChunkError(err) {
  if (!err) return false
  if (err.name === 'ChunkLoadError') return true
  const text = `${err.name || ''} ${err.message || ''}`
  return PATTERNS.some(re => re.test(text))
}

/** True when a reload was started; false when we must show the error instead. */
export function recoverFromStaleChunk(err, {
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  reload = () => window.location.reload(),
  now = () => Date.now(),
} = {}) {
  if (!isStaleChunkError(err)) return false
  try {
    const last = Number(storage?.getItem(STAMP) || 0)
    if (last && now() - last < COOLDOWN_MS) return false   // already tried
    storage?.setItem(STAMP, String(now()))
  } catch {
    // Private mode / storage disabled: reloading once is still better than a
    // dead page, and without a stamp we simply cannot loop-guard.
  }
  reload()
  return true
}
