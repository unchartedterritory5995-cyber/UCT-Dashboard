import { genericAdapter } from './adapters/generic'
import { notionAdapter } from './adapters/notion'
import { obsidianAdapter } from './adapters/obsidian'
import { evernoteAdapter } from './adapters/evernote'

// Order matters: it is the tie-break when two adapters score the same
// confidence (see detectAdapter below). Evernote's .enex signal is
// unambiguous so it goes first; generic is the catch-all floor so it goes
// last.
export const ADAPTERS = [evernoteAdapter, notionAdapter, obsidianAdapter, genericAdapter]

/**
 * Scores every registered adapter against the dropped file set and returns
 * the highest-confidence match. Ties are broken by registry order (the
 * earlier adapter in ADAPTERS wins) — implemented by only replacing `best`
 * on a STRICTLY greater score.
 * @param {import('./intake').VFile[]} vfiles
 * @returns {{ adapter: object, confidence: number }}
 */
export function detectAdapter(vfiles) {
  let best = null
  for (const adapter of ADAPTERS) {
    const confidence = adapter.detect(vfiles)
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
