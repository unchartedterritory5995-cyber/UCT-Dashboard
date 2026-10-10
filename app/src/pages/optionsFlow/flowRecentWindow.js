// Wave 5 client half: the Search deep-dive ASKS for a labelled recent window, and the
// window travels with the exact product it describes.
//
// ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
// NVDA, SPY, QQQ and SPXW always exceed the server's derivation budget, so their Search
// deep-dive used to be a refusal ("too big") and the member always waited on the 4+ s legacy
// tape. `api/flow_router.py` (`recent=1`) can now answer with the page's own derivation over
// the newest sessions that fit, headed `X-Flow-Window: recent`. `flowSearchFetch.js` already
// knew how to ask (`acceptRecent`) and how to read the answer (`window`); nothing on the page
// asked. This module is the asking, and `FlowRecentWindowNote.jsx` is the label.
//
// ⛔ PARTNER FILE, REBASE-SAFE HOOK. `OptionsFlow.jsx` imports `fetchSearchProduct` from
// HERE instead of from `flowSearchFetch` (one import line); its call site is untouched. A
// rebase that reverts that one line returns the page to exactly the old behaviour: the server
// never sends a window to a caller that did not ask, so nothing unlabelled can appear.
//
// ⛔ THE LABEL IS KEYED ON THE PRODUCT OBJECT, NEVER ON THE TICKER. A windowed answer can be
// followed by a declined re-fetch whose legacy tape lands the FULL history for the same ticker.
// A per-ticker flag would then caption full data as partial (or, cleared on the decline, leave
// a sticky windowed answer uncaptioned). A WeakMap from the landed product to its window says
// "partial" exactly when the product on screen is the partial one, and forgets it with it.

import { fetchSearchProduct as fetchProduct } from './flowSearchFetch'

const WINDOWS = new WeakMap()

/** The recent-window description of a landed product, or null when it is a full answer. */
export function searchWindowOf(product) {
  return product && typeof product === 'object' ? WINDOWS.get(product) || null : null
}

/**
 * `flowSearchFetch.fetchSearchProduct`, asking for (and recording) a labelled recent window.
 * Same signature and the same never-rejects contract; every decline passes through unchanged.
 */
export async function fetchSearchProduct(sym, source, opts = {}) {
  const got = await fetchProduct(sym, source, { ...opts, acceptRecent: true })
  if (got && got.ok && got.window && got.product && typeof got.product === 'object') {
    WINDOWS.set(got.product, got.window)
  }
  return got
}
