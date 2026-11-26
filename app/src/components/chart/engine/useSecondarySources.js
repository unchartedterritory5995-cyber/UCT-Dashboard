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
import { fetchableOtherSymbols, isPineOriginDoc, heldKeyParts, heldDepthOf, OWN_DAILY_KEY, BARS_ASK_MAX, eventsNeeded, financialNeeded } from './otherSymbols'
// ⭐⭐ T4 E2 — the chart's own corporate events: one door (`/api/pine/events/<symbol>`), never `/api/bars`
import { EVENTS_KEY } from './pineEvents'
import { ensureEvents, subscribeEvents } from './eventSupply'
// ⭐⭐ T4 F1b — and its own financial figures: one door (`/api/pine/financial/<symbol>`), never `/api/bars`
import { FINANCIAL_KEY } from './pineFinancial'
import { ensureFinancial, subscribeFinancial } from './financialSupply'
// ⭐⭐ T4 B2 — a `USI:` breadth spelling's rows: one door (`/api/pine/breadth/<spelling>`), never `/api/bars`
import { isBreadthKey, breadthSpellingOfKey } from './pineBreadth'
import { ensureBreadth, subscribeBreadth } from './breadthSupply'
import { runtimeReadsOwnDaily } from './runtime/runtimeColumns'
import { runtimeReadsOwnDailyOffThread, ownDailyKeyOf, onOwnDailyAnswer } from './runtime/ownDailyAsync'
import { instanceDocumentForFetch } from './symbolInputs'
import { ensureSecondaryBars, subscribe, cachedBars, refreshSecondaryTail, secondaryFetchOf } from './secondaryBars'
import { noteSecondaryNeeds, forgetSecondaryNeeds } from '../../../lib/bootSecondaryBars'

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
 *  422, never a deeper answer. Read from `otherSymbols.js::BARS_ASK_MAX`, which the run's
 *  "a deeper page is coming" test reads too (`runtime/requestSupply.js`). */
export const HELD_SPAN_MAX = BARS_ASK_MAX
export const HELD_SPAN_LADDER = Object.freeze([600, 2000, 5000, 10000, 20000, 40000, HELD_SPAN_MAX])
export function heldSpanFor(loaded, requested) {
  const req = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0
  const want = Math.max(Number.isFinite(loaded) && loaded > 0 ? Math.floor(loaded) : 0, req)
  const rung = HELD_SPAN_LADDER.find((r) => r >= want) ?? HELD_SPAN_MAX
  return Math.min(HELD_SPAN_MAX, Math.max(rung, req))
}

/** ⭐⭐ (2026-11-26, Fred RS load time) THE BARS WINDOWS a chart's needed keys fetch, in the order `ensureChartSources` asks
 *  them: the ordinary keys at the chart's own timeframe and depth first, then this chart symbol's own daily rows and every
 *  held key, in list order. One plan, read by `ensureChartSources` (the asks) and by `secondaryNeedUrls` (what the page
 *  remembers for its next load, `lib/bootSecondaryBars.js`), so the two can never name different windows. Breadth, events
 *  and financial keys have their own doors and are not bars windows. */
export function chartBarsWindows(keys, tf, barCount, chartSymbol = null, heldSessions = 0, extended = false) {
  const list = Array.isArray(keys) ? keys : []
  const out = []
  // ⛔⛔ T4 B2 — a breadth key (held or not: `USI~ADVN.NY`, `USI~ADVN.NY@D`) never reaches the bars fetch
  // (`extended`: the chart's own session; a custom intraday timeframe's other-symbol bars sit on ITS grid, review of #2753)
  for (const k of list) {
    if (heldKeyParts(k) || k === OWN_DAILY_KEY || k === EVENTS_KEY || k === FINANCIAL_KEY || isBreadthKey(k)) continue
    out.push({ key: k, symbol: k, tf, bars: barCount, opts: { extended }, ordinary: true })
  }
  for (const k of list) {
    if (isBreadthKey(k) || k === EVENTS_KEY || k === FINANCIAL_KEY) continue
    // ⭐ RS RATING L12 PR 2 — this chart symbol's own daily rows (`OWN_DAILY_KEY`), as deep as a held daily read
    if (k === OWN_DAILY_KEY) {
      if (!chartSymbol) continue
      out.push({ key: k, symbol: String(chartSymbol).trim().toUpperCase(), tf: 'D', bars: heldDepthOf(barCount, tf, heldSessions), opts: {} })
      continue
    }
    const held = heldKeyParts(k)
    if (!held) continue
    out.push({ key: k, symbol: held.symbol, tf: held.tf, bars: heldDepthOf(barCount, tf, heldSessions), opts: {} })
  }
  return out
}

/** The URLs those windows fetch (`secondaryFetchOf(...).fetchUrl`), for the page's boot record. */
export function secondaryNeedUrls(keys, tf, barCount, chartSymbol = null, heldSessions = 0, extended = false) {
  const urls = []
  for (const w of chartBarsWindows(keys, tf, barCount, chartSymbol, heldSessions, extended)) {
    const wire = secondaryFetchOf(w.symbol, w.tf, w.bars, w.opts)
    if (wire && wire.fetchUrl && !urls.includes(wire.fetchUrl)) urls.push(wire.fetchUrl)
  }
  return urls
}

export function ensureChartSources(keys, tf, barCount, fetcher, chartSymbol = null, heldSessions = 0, extended = false) {
  const list = Array.isArray(keys) ? keys : []
  const windows = chartBarsWindows(list, tf, barCount, chartSymbol, heldSessions, extended)
  const out = new Map()
  const ordinary = windows.filter((w) => w.ordinary)
  for (const w of ordinary) {
    const entry = ensureSecondaryBars(w.symbol, w.tf, w.bars, fetcher, w.opts)
    if (entry) out.set(w.key, entry)
  }
  const windowOf = new Map(windows.filter((w) => !w.ordinary).map((w) => [w.key, w]))
  for (const k of list) {
    // ⭐⭐ T4 B2 — a `USI:` breadth spelling's rows, from the breadth door (`breadthSupply.js`), at every chart timeframe
    // (a weekly or monthly chart holds them at D: the same rows under the held key)
    if (isBreadthKey(k)) {
      const spelling = breadthSpellingOfKey(k)
      const entry = spelling ? ensureBreadth(spelling, fetcher) : null
      if (entry) out.set(k, entry)
      continue
    }
    // ⭐⭐ T4 E2 — this chart symbol's corporate events: its own door and cache (`eventSupply.js`), never a bars fetch
    if (k === EVENTS_KEY) {
      const ev = chartSymbol ? ensureEvents(chartSymbol, fetcher) : null
      if (ev) out.set(k, ev)
      continue
    }
    // ⭐⭐ T4 F1b — this chart symbol's financial figures: their own door and cache (`financialSupply.js`)
    if (k === FINANCIAL_KEY) {
      const fin = chartSymbol ? ensureFinancial(chartSymbol, fetcher) : null
      if (fin) out.set(k, fin)
      continue
    }
    // ⭐ RS RATING L12 PR 2 — this chart symbol's own daily rows, and ⭐ L11 every held key (`chartBarsWindows`)
    const w = windowOf.get(k)
    if (!w) continue
    const entry = ensureSecondaryBars(w.symbol, w.tf, w.bars, fetcher, w.opts)
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
export function liveTailTick(keys, tf, barCount, fetcher, chartForming, chartSymbol = null, heldSessions = 0, extended = false) {
  if (!isAppVisible()) return 0
  let started = 0
  for (const k of Array.isArray(keys) ? keys : []) {
    // ⭐⭐ T4 E2 — the events entry has no tail (its own door, `eventSupply.js`, keeps its age)
    if (k === EVENTS_KEY || k === FINANCIAL_KEY) continue
    // ⭐⭐ T4 B2 — nor a breadth spelling's (`breadthSupply.js` keeps its age; never a bars tail)
    if (isBreadthKey(k)) continue
    // ⭐ RS RATING L12 PR 2 — this chart symbol's own daily rows ride the tail as a held daily key does
    if (k === OWN_DAILY_KEY && !chartSymbol) continue
    const held = k === OWN_DAILY_KEY ? { symbol: String(chartSymbol).trim().toUpperCase(), tf: 'D' } : heldKeyParts(k)
    const symbol = held ? held.symbol : k
    const at = held ? held.tf : tf
    const depth = held ? heldDepthOf(barCount, tf, heldSessions) : barCount
    const e = cachedBars(symbol, at, depth, { extended })
    if (!e || e.status !== 'available') continue
    if (e.newestBarIsForming !== true && chartForming !== true) continue
    if (refreshSecondaryTail(symbol, at, depth, fetcher, { extended })) started += 1
  }
  return started
}

/** ⭐⭐ T4 E2 — does any instance's document read this chart's corporate events (`otherSymbols.js::eventsNeeded`)? */
export function eventsNeededBy(instances, defOf) {
  for (const inst of Array.isArray(instances) ? instances : []) {
    const def = inst && defOf ? defOf(inst.defId) : null
    // ⭐ e95 unit 2b — as THIS instance's settings make the document (an unpicked arm's event read is not fetched for)
    if (def && eventsNeeded(instanceDocumentForFetch(def, inst))) return true
  }
  return false
}

/** ⭐⭐ T4 F1b — does any instance's document read this chart's financial figures (`otherSymbols.js::financialNeeded`)? */
export function financialNeededBy(instances, defOf) {
  for (const inst of Array.isArray(instances) ? instances : []) {
    const def = inst && defOf ? defOf(inst.defId) : null
    // ⭐ (train e95, the 2b bind audit) as THIS instance's settings make the document, like the events fetch above:
    // an unpicked arm's financial read is not fetched for
    if (def && financialNeeded(instanceDocumentForFetch(def, inst))) return true
  }
  return false
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
// ⭐⭐ RS RATING (2026-11-19, the e83 live capture) — built with the chart's SYMBOL (`symbol`, the chart's
// `symbolMeta`: the same binding the run is handed), so a script that branches on `syminfo.*` answers as its run
// does. ⚰️ Without it Fred RS's build refused at `syminfo.industry` and this said no on every intraday chart.
// ⭐⭐ (switch smoothness, 2026-11-20) `ask` answers each question: `runtimeReadsOwnDaily` (the default, on this
// thread), or the chart's off-thread door (`ownDailyAsync.runtimeReadsOwnDailyOffThread`), whose `null` (asked, not
// answered yet) reads NEEDED. Every instance is asked (a `null` does not stop the walk), so one switch asks the
// worker every question it has at once; a `true` still answers at once.
export function ownDailyNeeded(instances, defOf, tf, symbol = null, ask = runtimeReadsOwnDaily) {
  let unknown = false
  for (const inst of Array.isArray(instances) ? instances : []) {
    const def = inst && defOf ? defOf(inst.defId) : null
    const c = def && def.compute
    if (!c) continue
    const src = c.runtimeObjects && typeof c.runtimeObjects.source === 'string' ? c.runtimeObjects.source
      : (c.kind === 'runtime' && typeof c.source === 'string' ? c.source : null)
    if (!src) continue
    const a = ask(src, tf, symbol)
    if (a === true) return true
    if (a === null) unknown = true
  }
  return unknown
}

export function useSecondarySources(instances, defOf, tf, barCount, fetcher, revalidate, chartFormingOf, chartSymbol = null,
  chartSymbolMeta = null, heldSessions = 0, extended = false) {
  const [state, setState] = useState(EMPTY)
  // ⭐⭐ (switch smoothness) bumped when a question asked off this thread answers NO: the needed set is read again
  const [ownDailyGen, setOwnDailyGen] = useState(0)
  // ⭐⭐ (2026-11-26, Fred RS load time) this chart's slot in the page's boot record (`lib/bootSecondaryBars.js`)
  const [needSlot] = useState(() => ({}))
  useEffect(() => () => forgetSecondaryNeeds(needSlot), [needSlot])

  useEffect(() => {
    let alive = true
    // ⭐ RS RATING L11 — named for THIS chart's timeframe (a weekly chart holds SP:SPX and the seed at D)
    const listed = instances ? instances() : null
    const symbols = symbolsNeeded(listed, defOf, tf)
    // ⭐ RS RATING L12 PR 2 — and this chart symbol's own daily rows, for a run that reads them above the chart
    // (asked with the chart's symbol binding, `chartSymbolMeta`: the run's own, so a `syminfo.*` branch settles)
    // ⭐⭐ (switch smoothness, 2026-11-20) ASKED OFF THIS THREAD (`ownDailyAsync.js`): the answer builds the script's
    // runtime program, measured 51-74 ms inside the click's task on a 1D -> 5m switch with Fred RS. Not answered yet
    // reads NEEDED (the rows are asked for on the click, as before); a NO, when it lands, re-reads the set.
    const askedOff = new Set()
    const ask = (src, t, sym) => {
      const a = runtimeReadsOwnDailyOffThread(src, t, sym)
      if (a === null) askedOff.add(ownDailyKeyOf(src, t, sym))
      return a
    }
    if (chartSymbol && ownDailyNeeded(listed, defOf, tf, chartSymbolMeta, ask)) symbols.push(OWN_DAILY_KEY)
    // ⭐⭐ T4 E2 — and this chart symbol's corporate events, for a Pine document that reads them (`eventsNeeded`)
    if (chartSymbol && eventsNeededBy(listed, defOf)) symbols.push(EVENTS_KEY)
    // ⭐⭐ T4 F1b — and its financial figures, for a Pine document that reads `request.financial` (`financialNeeded`)
    if (chartSymbol && financialNeededBy(listed, defOf)) symbols.push(FINANCIAL_KEY)
    const offAnswer = askedOff.size
      ? onOwnDailyAnswer((k, yes) => { if (alive && yes === false && askedOff.has(k)) setOwnDailyGen((n) => n + 1) })
      : null
    const key = `${symbols.join(',')}|${tf}|${barCount}|${heldSessions}|${extended ? 'eth' : 'rth'}`
    // ⭐⭐ (2026-11-26, Fred RS load time) the page remembers the bars windows its charts need NOW, and its next load asks
    // for them as the entry bundle runs (`lib/bootSecondaryBars.js`): Fred RS's SP:SPX no longer waits for the chart, the
    // layout and the definitions to land before its round trip starts
    noteSecondaryNeeds(needSlot, secondaryNeedUrls(symbols, tf, barCount, chartSymbol, heldSessions, extended))

    const apply = () => {
      if (!alive) return
      // ⭐ THE ZERO-COST PATH, AND IT IS THE COMMON ONE. A chart with no symbol
      // source produces no key, no request and no cache entry — the same
      // null-key-means-no-traffic idiom `compareSwrUrl` and
      // `useSignatureIndicators` already use. It returns the SHARED empty state,
      // so "needs nothing" is one stable identity rather than a new object.
      const map = symbols.length ? ensureChartSources(symbols, tf, barCount, fetcher, chartSymbol, heldSessions, extended) : null
      setState((prev) => {
        if (!map) return prev.map === null ? prev : EMPTY
        return prev.key === key && sameEntries(prev.map, map) ? prev : { key, map }
      })
    }

    apply()
    if (!symbols.length) return () => { alive = false; if (offAnswer) offAnswer() }
    // ⚠️ SUBSCRIBE, DO NOT POLL. `ensureAll` fires the request; the notification
    // is what tells this chart a response landed, and re-reading the cache is
    // cheap because the fetch is already deduped per URL.
    const unsub = subscribe(apply)
    // ⭐⭐ T4 E2 — and an events answer landing (or its retry coming due) binds again
    const unsubEvents = symbols.includes(EVENTS_KEY) ? subscribeEvents(apply) : null
    const unsubFinancial = symbols.includes(FINANCIAL_KEY) ? subscribeFinancial(apply) : null
    // ⭐⭐ T4 B2 — and a breadth answer landing (or its retry coming due)
    const unsubBreadth = symbols.some(isBreadthKey) ? subscribeBreadth(apply) : null
    // ⭐⭐ RS RATING L11 PR 2 — a forming series is re-read while this chart is up (`liveTailTick`); a
    // changed entry notifies, and `apply` above hands the chart the new one
    const timer = setInterval(() => {
      liveTailTick(symbols, tf, barCount, fetcher, typeof chartFormingOf === 'function' ? chartFormingOf() : null, chartSymbol,
        heldSessions, extended)
    }, LIVE_TAIL_MS)
    return () => {
      alive = false; unsub(); if (unsubEvents) unsubEvents(); if (unsubFinancial) unsubFinancial()
      if (unsubBreadth) unsubBreadth(); clearInterval(timer)
      if (offAnswer) offAnswer()
    }
  }, [instances, defOf, tf, barCount, fetcher, revalidate, chartFormingOf, chartSymbol, chartSymbolMeta, ownDailyGen, heldSessions, extended, needSlot])

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
/** The tickers the chart asks our store's exchange for (`/api/ticker-meta/<ticker>`): every fetchable other symbol of
 *  every Pine document. ⛔⛔ T4 B2 — never a breadth key (`USI~ADVN.NY`): a `USI:` spelling resolves through the breadth
 *  door alone, never the symbol resolver. Exported for its rail. */
export function exchangeLookupTickers(list, defOf) {
  const tickers = new Set()
  for (const inst of Array.isArray(list) ? list : []) {
    const def = inst && defOf ? defOf(inst.defId) : null
    // ⭐ P0 — only a Pine translation's spelling needs our store's exchange; a
    // formula document's `sym` names the store ticker itself (`otherSymbols.js`).
    if (!isPineOriginDoc(def)) continue
    // ⭐ SETTINGS PARITY (symbol): as THIS instance's symbol choice makes the document
    for (const t of fetchableOtherSymbols(instanceDocumentForFetch(def, inst))) if (!isBreadthKey(t)) tickers.add(t)
  }
  return tickers
}

export function useOtherSymbolExchanges(instances, defOf, revalidate) {
  const [gen, setGen] = useState(0)
  useEffect(() => {
    let alive = true
    const list = instances ? instances() : null
    const tickers = exchangeLookupTickers(list, defOf)
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
