import { genericAdapter } from './adapters/generic'
import { notionAdapter } from './adapters/notion'
import { obsidianAdapter } from './adapters/obsidian'
import { evernoteAdapter } from './adapters/evernote'
import { uctAdapter } from './adapters/uct'
import { logseqAdapter } from './adapters/logseq'
import { keepAdapter } from './adapters/keep'

// Order matters: it is the tie-break when two adapters score the same
// confidence (see detectAdapter below). uctAdapter goes first — its
// unconditional manifest marker (`UCT_NOTEBOOK_EXPORT.json`) is even more
// unambiguous than a file extension or a directory name a general-purpose
// tool might reuse, since nothing but our own exporter ever writes it.
// Evernote's .enex signal is unambiguous too, so it's next; generic is the
// catch-all floor so it goes last. ⛔ evernote > notion > obsidian > generic
// is load-bearing (railed in registry.test.js) — adding uctAdapter ahead of
// all four does not change any of THEIR relative order.
// Wave 10 (R-18): logseqAdapter sits AFTER obsidian on purpose — a folder
// opened in both apps carries `.obsidian/` AND `logseq/config.edn` (both
// 0.95), and the tie keeps going to Obsidian exactly as before. keepAdapter's
// signal (a Keep-shaped Takeout JSON) overlaps nothing, so its slot only has
// to be ahead of the generic floor. The census of every tool members bring
// (`census.js`) names which adapter each one lands on.
export const ADAPTERS = [
  uctAdapter,
  evernoteAdapter,
  notionAdapter,
  obsidianAdapter,
  logseqAdapter,
  keepAdapter,
  genericAdapter,
]

/**
 * Scores every registered adapter against the dropped file set and returns
 * the highest-confidence match. Ties are broken by registry order (the
 * earlier adapter in ADAPTERS wins) — implemented by only replacing `best`
 * on a STRICTLY greater score.
 *
 * Async-tolerant: an adapter's `detect()` may return a plain number OR a
 * Promise<number> (Obsidian's does — a `.obsidian/` marker resolves
 * synchronously, but the 0.6 content heuristic must read file bytes, which
 * is always async). `Promise.resolve(...)` normalizes either shape, so a
 * sync `detect()` costs nothing extra and existing adapters need no change.
 * @param {import('./intake').VFile[]} vfiles
 * @returns {Promise<{ adapter: object, confidence: number }>}
 */
export async function detectAdapter(vfiles) {
  let best = null
  for (const adapter of ADAPTERS) {
    const confidence = await Promise.resolve(adapter.detect(vfiles))
    if (!best || confidence > best.confidence) {
      best = { adapter, confidence }
    }
  }
  // An all-zero result means nothing recognized any signal at all — that is
  // not a genuine tie between two real detections, so the registry-order
  // tie-break above (which would otherwise hand this to evernote, first in
  // ADAPTERS) doesn't apply here. Fall through to generic explicitly.
  if (best.confidence === 0) {
    return { adapter: genericAdapter, confidence: 0 }
  }
  return best
}
