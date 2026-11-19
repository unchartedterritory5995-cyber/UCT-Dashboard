// app/src/components/chart/engine/useSecondarySources.js
//
// ─── THE CHART'S HALF OF THE SECONDARY-SYMBOL SEAM ──────────────────────────
//
// ⭐⭐ `binder.sync` IS SYNCHRONOUS AND BARS ARRIVE LATER, so somebody has to
// stand between them. `secondaryBars.js` owns the cache and the request — this
// hook owns the React half: which symbols this chart needs, asking for them once,
// and re-rendering when one lands so the next paint can bind it.
//
// ⛔⛔ THE MAP IDENTITY IS STABLE WHEN NOTHING CHANGED, AND THAT IS THE WHOLE
// DESIGN CONSTRAINT. `updateChart` is a `useCallback` whose dependency array this
// map joins; a fresh Map on every render would change that callback's identity on
// every render and repaint the chart continuously. So the state transition below
// returns the PREVIOUS object unless a symbol's entry actually changed — the same
// object-identity discipline `barFieldFor` and `projectionFor` use one layer down,
// for the same reason.
//
// ⛔ AND IT READS THE NORMALISED INSTANCE LIST, NOT `cs.indicatorInstances`. The
// raw blob still contains the records `normalizeInstances` dropped and the
// definitions the engine is not allowed to draw; fetching for those would be
// network traffic for series that will never be bound.
import { useEffect, useMemo, useState } from 'react'
import { symbolsNeeded } from './sourceRef'
import { fetchableOtherSymbols, isPineOriginDoc, heldKeyParts, heldDepthOf, OWN_DAILY_KEY } from './otherSymbols'
import { runtimeReadsOwnDaily } from './runtime/runtimeColumns'
import { instanceDocumentForFetch } from './symbolInputs'
import { ensureAll, ensureSecondaryBars, subscribe, cachedBars, refreshSecondaryTail } from './secondaryBars'

/** ⭐⭐ RS RATING L11 — every key this chart needs, asked once each: an ordinary key at the chart's
 *  own timeframe and depth (`ensureAll`, as before), a HELD key (`SPX@D` on a weekly chart,
 *  `otherSymbols.js::heldKeyParts`) at its held timeframe, deep enough for the chart's weekly bars
 *  (`heldDepthOf`). One map, keyed as `symbolsNeeded` named them. */
/** ⭐⭐ RS RATING (2026-11-19, the e81 live capture) — THE HELD SERIES FOLLOW THE CHART'S DEPTH, ONE RULE.
 *  The chart handed this hook its REQUESTED first-paint depth (600), and the deep backfill then grew the chart's
 *  LOADED rows to 3,000-28,000 without changing it: SP:SPX at the chart's timeframe was fetched 600 bars deep and the
 *  daily held rows `heldDepthOf(600, tf)` (5m 18, 30m 57, 60m 103 sessions), so the RS line was blank (na) on every
 *  bar older than the newest 600 SPX bars, and Fred RS's run half refused the whole chart for bars before them.
 *  The held span is now the chart's LOADED span (or the requested one, whichever is deeper), rounded UP to a coarse
 *  ladder rung, so a chart that fills refetches a few times (each rung once), never once per fill step. The server
 *  caps each answer at what our store holds (the store's depth), and `heldDepthOf` keeps its daily cap. This one
 *  number is what `ensureChartSources`, the held daily depths and `liveTailTick` all read. */
/** ⛔ The top rung is `/api/bars`'s own ceiling (`bars: Query(le=60000)`, `api/routers/bars.py`): a deeper ask is a
 *  422, never a deeper answer. */
export const HELD_SPAN_MAX = 60000
export const HELD_SPAN_LADDER = Object.freeze([600, 2000, 5000, 10000, 20000, 40000, HELD_SPAN_MAX])
export function heldSpanFor(loaded, requested) {
  const req = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0
  const want = Math.max(Number.isFinite(loaded) && loaded > 0 ? Math.floor(loaded) : 0, req)
  const rung = HELD_SPAN_LADDER.find((r) => r >= want) ?? HELD_SPAN_MAX
  return Math.min(HELD_SPAN_MAX, Math.max(rung, req))
}

export function ensureChartSources(keys, tf, barCount, fetcher, chartSymbol = null) {
  const list = Array.isArray(keys) ? keys : []
  const out = ensureAll(list.filter((k) => !heldKeyParts(k) && k !== OWN_DAILY_KEY), tf, barCount, fetcher)
  for (const k of list) {
    // ⭐ RS RATING L12 PR 2 — this chart symbol's own daily rows (`OWN_DAILY_KEY`), as deep as a held daily read
    if (k === OWN_DAILY_KEY) {
      if (!chartSymbol) continue
      const own = ensureSecondaryBars(String(chartSymbol).trim().toUpperCase(), 'D', heldDepthOf(barCount, tf), fetcher)
      if (own) out.set(k, own)
      continue
    }
    const held = heldKeyParts(k)
    if (!held) continue
    const entry = ensureSecondaryBars(held.symbol, held.tf, heldDepthOf(barCount, tf), fetcher)
    if (entry) out.set(k, entry)
  }
  return out
}
import { lowerTfWindowsNeeded } from './lowerTf'
import { isAppVisible } from '../../../lib/deskVisibility'

/** ⭐⭐ RS RATING L11 PR 2 — how often a forming series is re-read (`secondaryBars.refreshSecondaryTail`). */
export const LIVE_TAIL_MS = 60000

/** ⭐⭐ RS RATING L11 PR 2 — one tick of the live tail: every held entry of this chart whose session is in
 *  progress (`newestBarIsForming === true`), and every one while the CHART's own newest bar is forming (a
 *  page opened before the open holds an index series with no row for today, flagged settled, and only a
 *  re-read finds today's), re-reads its newest rows. Nothing while the member cannot see the app
 *  (`deskVisibility.isAppVisible`: a hidden tab, or the desktop desk hidden, where a minimized window still
 *  reports `visible`; speed rule 6). Exported for its rail. */
export function liveTailTick(keys, tf, barCount, fetcher, chartForming, chartSymbol = null) {
  if (!isAppVisible()) return 0
  let started = 0
  for (const k of Array.isArray(keys) ? keys : []) {
    // ⭐ RS RATING L12 PR 2 — this chart symbol's own daily rows ride the tail as a held daily key does
    if (k === OWN_DAILY_KEY && !chartSymbol) continue
    const held = k === OWN_DAILY_KEY ? { symbol: String(chartSymbol).trim().toUpperCase(), tf: 'D' } : heldKeyParts(k)
    const symbol = held ? held.symbol : k
    const at = held ? held.tf : tf
    const depth = held ? heldDepthOf(barCount, tf) : barCount
    const e = cachedBars(symbol, at, depth)
    if (!e || e.status !== 'available') continue
    if (e.newestBarIsForming !== true && chartForming !== true) continue
    if (refreshSecondaryTail(symbol, at, depth, fetcher)) started += 1
  }
  return started
}

/** Do two maps hold the same entry OBJECT for the same symbols? */
function sameEntries(a, b) {
  if (a === b) return true
  if (!a || !b || a.size !== b.size) return false
  for (const [sym, entry] of a) {
    // Identity, not deep equality: `cachedBars` hands back the stored object, so
    // an unchanged symbol is the very same reference and a changed one is not.
    if (b.get(sym) !== entry) return false
  }
  return true
}

/**
 * Bars for every canonical symbol this chart's instances name.
 *
 * @param {object[]} instances  the NORMALISED engine instances (read from a ref)
 * @param {function} defOf      definition lookup
 * @param {string}   tf         the chart's resolved timeframe
 * @param {number}   barCount   the chart's own history depth
 * @param {function} fetcher    the chart's fetcher, so aborts on symbol flip apply
 * @param {*}        revalidate any value that should re-check the needed set
 * @param {function} [chartFormingOf]  ⭐ L11 PR 2: whether the chart's own newest bar is forming, read
 *   at each live-tail tick (`liveTailTick`)
 * @returns {Map<string,{bars,status}>|null} null when this chart needs none
 */
/** ⭐⭐ RS RATING L12 PR 2 (U-DAILY) — does any instance's run read this chart symbol's own daily rows on a `tf`
 *  chart (its run half's script, or a runtime document's, built for `tf`: `runtimeReadsOwnDaily`)? */
export function ownDailyNeeded(instances, defOf, tf) {
  for (const inst of Array.isArray(instances) ? instances : []) {
    const def = inst && defOf ? defOf(inst.defId) : null
    const c = def && def.compute
    if (!c) continue
    const src = c.runtimeObjects && typeof c.runtimeObjects.source === 'string' ? c.runtimeObjects.source
      : (c.kind === 'runtime' && typeof c.source === 'string' ? c.source : null)
    if (src && runtimeReadsOwnDaily(src, tf)) return true
  }
  return false
}

export function useSecondarySources(instances, defOf, tf, barCount, fetcher, revalidate, chartFormingOf, chartSymbol = null) {
  const [state, setState] = useState(EMPTY)

  useEffect(() => {
    // ⭐ RS RATING L11 — named for THIS chart's timeframe (a weekly chart holds SP:SPX and the seed at D)
    const listed = instances ? instances() : null
    const symbols = symbolsNeeded(listed, defOf, tf)
    // ⭐ RS RATING L12 PR 2 — and this chart symbol's own daily rows, for a run that reads them above the chart
    if (chartSymbol && ownDailyNeeded(listed, defOf, tf)) symbols.push(OWN_DAILY_KEY)
    const key = `${symbols.join(',')}|${tf}|${barCount}`
    let alive = true

    const apply = () => {
      if (!alive) return
      // ⭐ THE ZERO-COST PATH, AND IT IS THE COMMON ONE. A chart with no symbol
      // source produces no key, no request and no cache entry — the same
      // null-key-means-no-traffic idiom `compareSwrUrl` and
      // `useSignatureIndicators` already use. It returns the SHARED empty state,
      // so "needs nothing" is one stable identity rather than a new object.
      const map = symbols.length ? ensureChartSources(symbols, tf, barCount, fetcher, chartSymbol) : null
      setState((prev) => {
        if (!map) return prev.map === null ? prev : EMPTY
        return prev.key === key && sameEntries(prev.map, map) ? prev : { key, map }
      })
    }

    apply()
    if (!symbols.length) return () => { alive = false }
    // ⚠️ SUBSCRIBE, DO NOT POLL. `ensureAll` fires the request; the notification
    // is what tells this chart a response landed, and re-reading the cache is
    // cheap because the fetch is already deduped per URL.
    const unsub = subscribe(apply)
    // ⭐⭐ RS RATING L11 PR 2 — a forming series is re-read while this chart is up (`liveTailTick`); a
    // changed entry notifies, and `apply` above hands the chart the new one
    const timer = setInterval(() => {
      liveTailTick(symbols, tf, barCount, fetcher, typeof chartFormingOf === 'function' ? chartFormingOf() : null, chartSymbol)
    }, LIVE_TAIL_MS)
    return () => { alive = false; unsub(); clearInterval(timer) }
  }, [instances, defOf, tf, barCount, fetcher, revalidate, chartFormingOf])

  return state.map
}

/** One shared empty state, so "this chart needs nothing" is a stable identity. */
const EMPTY = Object.freeze({ key: '', map: null })

// ─── ⭐⭐ C26 — OUR STORE'S EXCHANGE FOR A PINE DOCUMENT'S OTHER SYMBOLS ─────────
//
// `otherSymbols.js` serves `"AMEX:SPY"` only when our store's listing of SPY
// answers to that Pine spelling, and that is a fact about the STORE: the same
// `/api/ticker-meta/{sym}` `exchange` the chart's own symbol reads
// (`useTickerMeta`), fetched once per ticker per session. ⛔ A failed or missing
// lookup is `null` — the bind then refuses the read by name, never guesses.

const _exchanges = new Map()   // ticker -> exchange string | null
const _asked = new Set()

async function _askExchange(ticker, notify) {
  if (_asked.has(ticker)) return
  _asked.add(ticker)
  try {
    const r = await fetch(`/api/ticker-meta/${encodeURIComponent(ticker)}`, { credentials: 'include' })
    const j = r.ok ? await r.json() : null
    const e = j && typeof j.exchange === 'string' && j.exchange.trim() ? j.exchange.trim() : null
    _exchanges.set(ticker, e)
    if (!r.ok) _asked.delete(ticker)
  } catch {
    _asked.delete(ticker)
  }
  notify()
}

/**
 * A synchronous `exchangeOf(ticker)` for the binder, over the OTHER symbols the
 * chart's Pine documents read. Its identity changes only when an answer lands,
 * so it can join `updateChart`'s dependencies without repainting on every render.
 */
export function useOtherSymbolExchanges(instances, defOf, revalidate) {
  const [gen, setGen] = useState(0)
  useEffect(() => {
    let alive = true
    const list = instances ? instances() : null
    const tickers = new Set()
    for (const inst of Array.isArray(list) ? list : []) {
      const def = inst && defOf ? defOf(inst.defId) : null
      // ⭐ P0 — only a Pine translation's spelling needs our store's exchange; a
      // formula document's `sym` names the store ticker itself (`otherSymbols.js`).
      if (!isPineOriginDoc(def)) continue
      // ⭐ SETTINGS PARITY (symbol): as THIS instance's symbol choice makes the document
      for (const t of fetchableOtherSymbols(instanceDocumentForFetch(def, inst))) tickers.add(t)
    }
    for (const t of tickers) {
      if (!_exchanges.has(t)) _askExchange(t, () => { if (alive) setGen((g) => g + 1) })
    }
    return () => { alive = false }
  }, [instances, defOf, revalidate])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (t) => (_exchanges.has(t) ? _exchanges.get(t) : null), [gen])
}

// ─── ⭐⭐ C41 — THIS SYMBOL'S INTRADAY BARS, FOR A READ BELOW THE CHART ──────────
//
// `request.security(syminfo.tickerid, "60", …)` on a daily chart is an `ltf` node
// (`engine/lowerTf.js` states every rule), and it reads the chart's OWN ticker at
// an intraday store timeframe. This is the React half: which windows the chart's
// instances need (`lowerTfWindowsNeeded` — one `meta.lowerTf` read per instance),
// asked once each through the SAME cache and fetcher a `sym:` source uses, and a
// re-render when one lands.
//
// ⛔⛔ A CHART WITH NO SUCH INDICATOR ASKS FOR NOTHING. No window ⇒ no key, no
// request, no cache entry, no subscription — the shared `EMPTY` state, the same
// zero-cost path `useSecondarySources` takes. Railed in `useLowerTfSources.test.jsx`.
/**
 * @param {function} instances  the stored instance list (read through a function)
 * @param {function} defOf      definition lookup
 * @param {string}   symbol     the chart's own ticker
 * @param {string}   tf         the chart's resolved timeframe
 * @param {number}   barCount   the chart's own history depth
 * @param {function} fetcher    the chart's fetcher, so aborts on symbol flip apply
 * @param {*}        revalidate any value that should re-check the needed set
 * @returns {Map<string,{bars,status}>|null} keyed by STORE timeframe; null when
 *   this chart needs none
 */
export function useLowerTfSources(instances, defOf, symbol, tf, barCount, fetcher, revalidate) {
  const [state, setState] = useState(EMPTY)

  useEffect(() => {
    const sym = typeof symbol === 'string' ? symbol.trim().toUpperCase() : ''
    const windows = sym ? lowerTfWindowsNeeded(instances ? instances() : null, defOf, tf, barCount) : []
    const key = `${sym}|${tf}|${windows.map((w) => `${w.tf}:${w.bars}`).join(',')}`
    let alive = true

    const apply = () => {
      if (!alive) return
      let map = null
      if (windows.length) {
        map = new Map()
        for (const w of windows) {
          const entry = ensureSecondaryBars(sym, w.tf, w.bars, fetcher)
          if (entry) map.set(w.tf, entry)
        }
      }
      setState((prev) => {
        if (!map) return prev.map === null ? prev : EMPTY
        return prev.key === key && sameEntries(prev.map, map) ? prev : { key, map }
      })
    }

    apply()
    if (!windows.length) return () => { alive = false }
    const unsub = subscribe(apply)
    return () => { alive = false; unsub() }
  }, [instances, defOf, symbol, tf, barCount, fetcher, revalidate])

  return state.map
}

export default useSecondarySources
