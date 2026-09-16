// app/src/components/chart/useSymbolDiscovery.js
//
// ─── SYMBOLS AND BREADTH, FOR THE ADD-TO-CHART DIALOG (P2.2) ────────────────
//
// ⛔⛔ NOT A SECOND SEARCH SYSTEM. It calls the SAME two endpoints `SymbolSearch`
// calls, with the same 150 ms debounce and the same AbortController discipline,
// and hands the rows to the SAME facade adapters. What it does not share with
// `SymbolSearch` is that component's chips, its keyboard model, its typed
// sentinel and its popular/indices presets — none of which a library dialog
// wants — and reaching into a mounted modal to borrow an effect is not reuse.
//
// ⛔ AND IT ADDS NO BREADTH REQUEST AT ALL. `useBreadthSymbols` already fetches
// `/api/breadth-symbols` ONCE per module and hands back the rows; breadth
// matching is local from that cache, exactly as `SymbolSearch`'s breadth chip
// does. So the only network this hook is responsible for is the ticker search
// the member's typing actually asks for.
//
// ⚠️ IT ANSWERS NORMALIZED `DiscoveryResult`s, NOT RAW ROWS. Capability, the
// breadth re-route and the `sym:` source all come from `discoveryCatalog`, so the
// dialog never sees an endpoint's shape.

import { useEffect, useMemo, useRef, useState } from 'react'
import useBreadthSymbols from '../../hooks/useBreadthSymbols'
import { breadthResults, securityResults } from './discoveryCatalog'
import { searchLibrary } from './breadthLibrary'

/** The same debounce `SymbolSearch` uses. Typed here rather than imported so the
 *  two surfaces can be tuned apart if one ever needs to be; they are the same
 *  number today because the member's expectation is the same. */
const DEBOUNCE_MS = 150

/** Below this a remote search is noise — one or two characters match thousands
 *  of tickers and the member is still typing. Local breadth still matches, so a
 *  two-letter query is not dead, just not remote. */
const MIN_REMOTE = 2

/** `UCTA50` / `% of Stocks Above 50-Day MA` — the same uppercase substring test
 *  `symbolSearchModel.matchQ` makes, on the two fields a breadth row has. */
const matchesBreadth = (row, q) => {
  const needle = q.toUpperCase()
  return String(row.symbol || row.ticker || '').toUpperCase().includes(needle)
    || String(row.name || '').toUpperCase().includes(needle)
}

/**
 * @param {string} query the member's raw search text
 * @param {boolean} enabled false while the dialog is closed — no fetch, no state
 * @param {{tf?: string, bars?: number, fetcher?: Function}} [opts]
 * @returns {{results: object[], loading: boolean, error: string|null}}
 */
export default function useSymbolDiscovery(query, enabled, opts = {}) {
  const { tf = 'D', bars = 400, fetcher } = opts
  const breadth = useBreadthSymbols()
  // ⭐⭐ THE ANSWER IS STORED WITH THE QUESTION IT ANSWERS. A bare `rows` array
  // has to be CLEARED on every keystroke, which is a synchronous setState inside
  // an effect (cascading renders, and the lint rule that names them) and still
  // leaves a window where the previous query's rows are on screen under the new
  // text. Keying the state by its own query means a stale reply is simply not
  // read — the memo below compares — so the effect sets state only when a reply
  // actually lands.
  const [answer, setAnswer] = useState({ q: '', rows: [], error: null })
  const abortRef = useRef(null)

  const q = (query || '').trim()
  const wantsRemote = !!enabled && q.length >= MIN_REMOTE

  useEffect(() => {
    // ⛔ AN ABORT ON EVERY CHANGE, INCLUDING THE ONE THAT STOPS SEARCHING. A
    // member who clears the box or closes the dialog must not have a reply land
    // afterwards and repopulate a list they are no longer looking at.
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null }
    if (!wantsRemote) return undefined
    const ctl = new AbortController()
    abortRef.current = ctl
    const timer = setTimeout(() => {
      const url = `/api/ticker-search?q=${encodeURIComponent(q)}&limit=20`
      const get = typeof fetcher === 'function' ? fetcher : ((u, o) => fetch(u, o))
      Promise.resolve()
        .then(() => get(url, { signal: ctl.signal }))
        .then((r) => (r && r.ok ? r.json() : { results: [] }))
        .then((j) => {
          if (ctl.signal.aborted) return
          setAnswer({ q, rows: Array.isArray(j?.results) ? j.results : [], error: null })
        })
        .catch((e) => {
          // An abort is the normal path, not a failure — it is what every
          // keystroke after the first does.
          if (ctl.signal.aborted || (e && e.name === 'AbortError')) return
          setAnswer({ q, rows: [], error: 'Symbol search is unavailable.' })
        })
    }, DEBOUNCE_MS)
    return () => { clearTimeout(timer); ctl.abort() }
  }, [q, wantsRemote, fetcher])

  const results = useMemo(() => {
    if (!enabled || !q) return []
    // ⭐ LOCAL BREADTH FIRST, and it needs no network: a member typing `UCTA` sees
    // the measure before the ticker search has been asked anything.
    //
    // ⭐⭐ AND IT IS THE CANONICAL LIBRARY RANKING, not a substring test. "50 day",
    // "above 50", "new lows" and "NASDAQ breadth" are how a member thinks about
    // breadth; `UCTA50` is an address they should not need to know. `searchLibrary`
    // is the same ranking `breadth_symbols.library_search` defines, pinned to it by
    // a generated fixture — so the dialog, the search box and the server agree.
    const lib = (breadth && typeof breadth.library === 'function') ? breadth.library() : null
    const libRows = lib && lib.rows && lib.rows.length ? lib.rows : null
    const matched = libRows
      ? searchLibrary(libRows, q, { limit: 20, metricOrder: lib.metricOrder })
      // ⚠️ The pre-library fallback, for a payload that predates the `library` block
      // (an older backend, or a cached response). Substring over the registry rows.
      : ((breadth && typeof breadth.all === 'function') ? breadth.all() : [])
        .filter((r) => matchesBreadth(r, q))
    const brd = breadthResults(matched, { tf, bars })
    // ⛔ ONLY THE REPLY TO THE QUESTION ON SCREEN. A reply to an older query is
    // not cleared, it is simply not read.
    const sec = answer.q === q ? securityResults(answer.rows, { tf, bars }) : []
    // ⛔ DEDUPED BY KEY, LOCAL WINNING. `/api/ticker-search` INJECTS breadth rows
    // into its own results, and `securityResults` re-routes those to the breadth
    // kind — so without this a member searching `UCTA50` would see it twice, once
    // from each path, with the same key.
    const seen = new Set()
    const out = []
    for (const r of [...brd, ...sec]) {
      if (!r || seen.has(r.key)) continue
      seen.add(r.key)
      out.push(r)
    }
    // ⭐ AN EXACT SYMBOL MATCH OUTRANKS A MENTION, and that is the whole of the
    // ranking. ⚰️ MEASURED AGAINST THE LIVE BACKEND: searching `QQQ` put `UCTSC`
    // first — a breadth measure whose NAME is "Small-Cap vs Nasdaq (IWM/QQQ)" —
    // because local breadth is listed before the remote reply for latency. The
    // member typed an instrument; it has to be the first row.
    //
    // ⛔ AND IT IS A STABLE PARTITION, NOT A SORT. Everything else keeps the order
    // its own source gave it — the breadth registry's display order and the
    // server's own ranking, both of which know more than this file does.
    const exact = q.toUpperCase()
    const hit = out.filter((r) => r.id === exact)
    return hit.length ? [...hit, ...out.filter((r) => r.id !== exact)] : out
  }, [breadth, answer, q, enabled, tf, bars])

  return {
    results,
    // ⭐ LOADING MEANS "THE ANSWER ON SCREEN IS NOT FOR THIS QUESTION YET".
    loading: wantsRemote && answer.q !== q,
    error: answer.q === q ? answer.error : null,
  }
}
