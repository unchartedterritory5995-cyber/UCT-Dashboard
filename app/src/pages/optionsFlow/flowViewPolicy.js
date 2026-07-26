/**
 * flowViewPolicy — view-layer decisions for Options Flow, as pure functions.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `OptionsFlow.jsx` is edited through the GitHub web UI, and on 2026-07-26 four
 * separate saves from stale browser tabs reverted work that had already shipped
 * (31/60, 1606/56, 35/90, 30/…). The `optionsFlow/*.js` modules have never once
 * been hit — every commit to them is intentional.
 *
 * So logic that MUST survive lives here, and `OptionsFlow.jsx` keeps only a
 * one-line call. A stale save that drops the call site removes an *import*, which
 * `wiring.guard.test.js` asserts on and CI fails — whereas the previous inline
 * versions were behavioural edits inside otherwise-intact code, which no
 * structural guard can detect. That is the actual difference between "we noticed"
 * and "it silently regressed for weeks".
 *
 * Everything here is pure and unit-tested.
 */

/**
 * Which flow endpoint a given UI mode should read.
 *
 * GEX and Dark Pool have their own endpoints and never read the flow CSV. The
 * original expression fell through to the STOCKS url for any mode that was not
 * "index", so entering GEX/Dark Pool from Indexes changed the fetch URL and
 * fired a full ~12.4MB stocks download plus a worker parse the user could never
 * see — and it evicted the index dataset the worker was holding, forcing another
 * download on the way back. Pinning to the last real flow mode keeps the URL
 * stable across the excursion.
 */
export function flowBaseFor(dataMode, lastFlowMode) {
  const isFlow = dataMode === 'stocks' || dataMode === 'index'
  const effective = isFlow ? dataMode : (lastFlowMode || 'stocks')
  return {
    effective,
    base: effective === 'index' ? '/api/flow/indexes-data' : '/api/flow/data',
  }
}

/** Human label for a GEX expiry window. */
export function gexDteLabel(dte) {
  switch (dte) {
    case '0dte': return '0DTE'
    case '1dte': return '1DTE'
    case '2dte': return '2DTE'
    case '3dte': return '3DTE'
    case 'week': return 'Weekly'
    case 'month': return 'Monthly'
    default: return 'All'
  }
}

/**
 * Which expiry a GEX payload actually represents.
 *
 * The panel used to label the data from live UI state (`gexDte`). Combined with
 * a missing staleness guard — click 0DTE then Month and the slower 0DTE reply
 * lands last — that meant one expiry's gamma walls, zero-gamma line and flip
 * line could be displayed under a different expiry's name. Those are levels
 * people place stops against.
 *
 * The response echoes `dteFilter`, but it comes back null on an empty result
 * (e.g. no 0DTE contracts on a weekend), so the request params we stamped onto
 * the payload are the reliable source. UI state is the last resort only.
 */
export function gexPayloadDte(gexData, uiDte) {
  if (!gexData) return uiDte
  return gexData._reqDte ?? gexData.dteFilter ?? uiDte
}

/**
 * Apply the Leaderboard "Still-open" overlay — MUTATES the ticker objects.
 *
 * `computeStillOpen` contributes 0 for any contract with no live quote. Applying
 * it to every ticker therefore UNDERSTATED premium, and the board is then
 * re-sorted and Bull% recomputed off those understated figures — so a ticker's
 * rank became a function of how many of its contracts happened to get a quote
 * rather than of its actual flow. Worse, the enable gate only checks that
 * `priceCache` is non-empty, and that map is shared with every other tab (even
 * opening a contract popup writes to it), so it can pass while none of THESE
 * tickers are priced: every ticker computes 0, all are filtered out, and the
 * board renders "0 tickers" with no explanation.
 *
 * Mirrors the Search tab's proven `_useOpen = oiConfirmedOnly &&
 * stillOpenComputable` (never display a bogus 0), adapted for a RANKING:
 *  - only computable tickers are overlaid and ranked
 *  - un-priced tickers are zeroed so they drop OUT rather than being ranked on
 *    raw premium against still-open rows (a meaningless comparison)
 *  - if NOTHING is computable the overlay is skipped entirely and raw figures
 *    stand, because "can't tell yet" beats an empty board
 *
 * @returns {{applied: boolean, priced: number, total: number}}
 */
export function applyStillOpenOverlay(tickers, computeStillOpen) {
  const all = tickers || []
  if (!all.length || typeof computeStillOpen !== 'function') {
    return { applied: false, priced: 0, total: all.length }
  }
  const computable = all.filter(tk => {
    try { return computeStillOpen(tk._trades).computable } catch { return false }
  })
  if (computable.length === 0) {
    return { applied: false, priced: 0, total: all.length }
  }
  computable.forEach(tk => {
    const so = computeStillOpen(tk._trades)
    tk._bullRaw = tk.bull
    tk._bearRaw = tk.bear
    tk._stillOpenComputable = true
    tk.bull = Math.round(so.bullOpen)
    tk.bear = Math.round(so.bearOpen)
    const tot = tk.bull + tk.bear
    tk.bullPct = tot > 0 ? Math.round(tk.bull / tot * 100) : 50
  })
  all.forEach(tk => {
    if (tk._stillOpenComputable !== true) { tk.bull = 0; tk.bear = 0 }
  })
  return { applied: true, priced: computable.length, total: all.length }
}

/**
 * Is a range's payload premium-capped, and what should the UI admit?
 *
 * PRODUCTION runs FLOW_CSV_CAP_DAYS=2 (the code default is 20), so days=1 is
 * uncapped (~96k rows) while days>=2 ALL return exactly the top
 * FLOW_CSV_CAP_ROWS (50,000) trades BY PREMIUM. A "90d" view is therefore not
 * more data than a "2d" view — it is the same 50k budget spread thinner, and the
 * small-premium tail (disproportionately small/mid-cap flow) is absent.
 *
 * The UI never said so, and a trader reading "20d" reasonably believes they are
 * seeing twenty days of flow. This does not change what is served — it just
 * stops the page implying completeness it does not have.
 */
export function capNoticeFor({ fetchDays, dateFrom, dateTo, rowCount, capRows = 50000, capDays = 2 }) {
  // An explicit calendar range is scoped server-side to those dates and capped on
  // the range's own length, so it is only capped when the range is wide enough.
  const days = (dateFrom && dateTo) ? null : fetchDays
  const isAllData = days === 0
  const wide = isAllData || (days != null && days >= capDays)
  if (!wide) return null
  // Only claim a cap when the payload actually looks capped. Below the ceiling
  // the range genuinely fits, and saying otherwise would be its own lie.
  if (rowCount != null && rowCount < capRows) return null
  return {
    capped: true,
    rows: capRows,
    text: `top ${capRows.toLocaleString()} by premium`,
    title:
      `Ranges of ${capDays}+ days return the top ${capRows.toLocaleString()} trades by premium, ` +
      `not every print — a memory guard for wide pulls. Smaller-premium trades are not shown ` +
      `in this range. Use the 1d view for a complete, uncapped day.`,
  }
}
