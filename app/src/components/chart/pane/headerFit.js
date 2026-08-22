// Width-driven degradation ladder for the chart pane header.
//
// The pane measures its own width (one ResizeObserver) and feeds it here; this
// pure module decides, in the owner's priority order, what the two header rows
// shed as the widget narrows so nothing overlaps and the info row never wraps
// below the timeframe bar (which would steal chart-canvas height):
//
//   1. title      "TICKER (Company Name)" → "TICKER"      (frees the identity row
//                                                          so the session buttons
//                                                          stop overlapping % change)
//   2. session    "Regular Hours"/"Include …-market" → "RTH"/"PRE"|"PM"
//   3. info row   "MARKET CAP" → "MC", etc. (labels only; values stay full)
//   4. timeframes drop buttons into the ▾ overflow menu, furthest-from-active
//                 first, down to just the active TF + ▾
//
// Pure + deterministic so it unit-tests without layout (jsdom does none). The
// thresholds are content-tuned but intentionally exported + adjustable — the
// exact px are a look decision, not a contract.

// Pane inner width (px) at/below which each step engages. Ordered widest→narrowest
// so the ladder degrades in the owner's stated priority order.
export const HEADER_FIT_THRESHOLDS = {
  titleTicker: 620,    // < → collapse the title to just the ticker
  sessionAbbrev: 520,  // < → RTH / PRE|PM
  infoAbbrev: 440,     // < → MC / NE / UCT / %OPEN
  tfDrop: 380,         // < → begin dropping timeframe buttons into the ▾ menu
}
// Roughly the width one extra timeframe button costs; each chunk below tfDrop
// sheds one more button.
const TF_PER_BUTTON = 26

/**
 * @param {number|null|undefined} width  measured pane inner width; nullish/≤0 ⇒ treat
 *   as unconstrained (full header — the safe first-paint / unmeasured default).
 * @param {number} tfCount  how many timeframe buttons the bar would show at full size.
 * @returns {{titleMode: 'ticker'|null, sessionAbbrev: boolean, infoAbbrev: boolean, maxTfs: number}}
 *   titleMode 'ticker' means OVERRIDE the host's title to the ticker; null means leave it.
 */
export function computeHeaderFit(width, tfCount = 8) {
  const w = (Number.isFinite(width) && width > 0) ? width : Infinity
  const T = HEADER_FIT_THRESHOLDS
  const n = (Number.isFinite(tfCount) && tfCount > 0) ? Math.floor(tfCount) : 1
  let maxTfs = n
  if (w < T.tfDrop) {
    const dropped = Math.ceil((T.tfDrop - w) / TF_PER_BUTTON)
    maxTfs = Math.max(1, Math.min(n, n - dropped))
  }
  return {
    titleMode: w < T.titleTicker ? 'ticker' : null,
    sessionAbbrev: w < T.sessionAbbrev,
    infoAbbrev: w < T.infoAbbrev,
    maxTfs,
  }
}

/**
 * Trim a sorted [code, label] timeframe list to `maxTfs` entries, ALWAYS keeping
 * the active code and dropping the furthest-from-active first (by position in the
 * duration-sorted list). Display order (low→high duration) is preserved, so the
 * remaining buttons never reshuffle — they just thin out around the active one.
 * The dropped codes stay reachable through the bar's ▾ overflow menu.
 */
export function trimTimeframes(visibleTfs, activeTf, maxTfs) {
  if (!Array.isArray(visibleTfs)) return visibleTfs
  const cap = Math.max(1, Math.floor(maxTfs) || 1)
  if (visibleTfs.length <= cap) return visibleTfs
  const activeIdx = visibleTfs.findIndex(([c]) => c === activeTf)
  const anchor = activeIdx >= 0 ? activeIdx : Math.floor(visibleTfs.length / 2)
  // Keep the `cap` entries closest to the active one (ties: earlier index wins).
  const keep = new Set(
    visibleTfs
      .map((t, i) => ({ i, d: Math.abs(i - anchor) }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .slice(0, cap)
      .map((x) => x.i),
  )
  return visibleTfs.filter((_, i) => keep.has(i))
}
