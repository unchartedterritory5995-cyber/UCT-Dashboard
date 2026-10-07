// MOST — the movers model (feature-gaps-2026-10-06 #7). Pure: no React, no fetch.
//
// ONE tape, three cuts (Bloomberg 06 §5: "orthogonal lenses on one tape", not a rack of codes):
//   up      today's gainers         down    today's losers
//   volume  unusual volume — the names the Volume Surge scanner has lit right now
//
// ⭐ NO NEW SOURCE. Every number here is one an existing route already serves:
//   /api/movers              the quality-filtered gappers list (≥3%, the Movers sidebar's)
//   /api/catalysts/today     the catalyst board: why a name moved, and its volume ÷ 30-day average
//   /api/volume-scan/live    the Volume Surge accumulator: volume vs the usual by this time of day
//   /api/live-prices         (the shared 2 s store) last price, day change, volume, pre/post prints
//
// ⛔ THE SESSION IS SAID, NEVER IMPLIED. Outside the regular session a mover list is a
// pre-market, after-hours or last-session list, and the panel labels it so. The % column's
// basis changes with the session and the panel says which basis it is showing.

import { sortRows as seedSortRows } from '../../../lib/presentation/dataGrid'

/** The routes MOST reads — each already served, from a cache, to another surface. */
export const POLL_MS = 30000
export const MOVERS_URL = '/api/movers'
export const CATALYSTS_URL = '/api/catalysts/today'
/** The whole tracked universe, ranked, each row flagged `lit` — one read serves both the
 *  volume-vs-average column and the unusual-volume lens (VolumeScanWidget reads the same shape). */
export const VOLUME_URL = '/api/volume-scan/live?show_all=1&limit=300'
export const MAX_ROWS = 50

export const PRICE_FLOORS = [0, 1, 5, 10, 20]
export const VOLUME_FLOORS = [0, 100e3, 500e3, 1e6, 5e6]

/** The session string from useMarketOpen's flags. */
export function sessionOf({ isOpen, isPremarket, isExtended } = {}) {
  if (isOpen) return 'regular'
  if (isPremarket) return 'pre'
  if (isExtended) return 'post'
  return 'closed'
}

/** The session vocabulary marketClock.sessionState() publishes. */
export const SESSIONS = ['pre', 'regular', 'post', 'closed']

/** What the panel calls each session, and what the numbers on screen mean in it. */
export const SESSION_COPY = Object.freeze({
  regular: { badge: 'Live', title: 'Regular session',
    basis: '% change is the last trade against yesterday\'s close.' },
  pre: { badge: 'Pre-market', title: 'Pre-market',
    basis: 'Last is the latest pre-market print and % change is against yesterday\'s close. Pre-market volume is thin, so a big % on a few thousand shares means little.' },
  post: { badge: 'After hours', title: 'After hours',
    basis: '% change is today\'s regular session (close against yesterday\'s close). The After hours column is the move since the 4:00 PM close.' },
  closed: { badge: 'Last session', title: 'Market closed',
    basis: 'These are the last session\'s numbers, not a live list. Nothing here is moving until the next pre-market.' },
})

/** The lens a `MOST` argument selects. */
export const LENSES = Object.freeze({
  all: 'All movers',
  up: 'Gainers',
  down: 'Losers',
  volume: 'Unusual volume',
})

/** Most names the panel subscribes to live prices for (the live store polls the union every 2 s). */
export const MAX_NAMES = 60

/** `"+34.40%"` / `"-3.1%"` / `3.1` → a number, else null. */
export function parsePct(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const n = Number(v.replace(/[%+,\s]/g, ''))
  return Number.isFinite(n) && v.trim() !== '' ? n : null
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const pos = (v) => (num(v) != null && v > 0 ? v : null)
const up = (s) => (typeof s === 'string' ? s.trim().toUpperCase() : '')

/** A catalyst row's one-line "why": its tag, else its type. */
export function catalystLabel(c) {
  if (!c) return null
  return c.tag || c.catalyst_type || null
}

/**
 * Pure: every name the three lists mention, merged, with the best number each column has.
 *
 *   movers     `/api/movers`            { ripping: [{sym, pct}], drilling: [...] }
 *   catalysts  `/api/catalysts/today`   { rows: [{ticker, tag, thesis_text, gap_pct, vol_x, price}] }
 *   volume     `/api/volume-scan/live`  { rows: [{sym, price, pct, rvol, rvol_day, lit}] }
 *   prices     the live store           { SYM: {price, change_pct, volume, prev_close, day_close, ext_price, ext_session} }
 *
 * Each row: { sym, last, pct, ah, volume, volVsAvg, volSource, lit, lists, catalyst }.
 * `lists` names where the row came from ('movers' | 'catalysts' | 'volume'), so the panel can say
 * why a name is on screen. A column with no honest value is null — rendered as a dash, never 0.
 */
export function buildRows({ movers = null, catalysts = null, volume = null, prices = {}, session = 'regular' } = {}) {
  const by = new Map()
  const get = (sym) => {
    const s = up(sym)
    if (!s) return null
    if (!by.has(s)) by.set(s, { sym: s, lists: new Set(), moversPct: null, cat: null, vol: null })
    return by.get(s)
  }
  for (const bucket of ['ripping', 'drilling']) {
    for (const m of Array.isArray(movers?.[bucket]) ? movers[bucket] : []) {
      const r = get(m?.sym)
      if (!r) continue
      r.lists.add('movers')
      r.moversPct = parsePct(m.pct)
    }
  }
  for (const c of Array.isArray(catalysts?.rows) ? catalysts.rows : []) {
    const r = get(c?.ticker)
    if (!r) continue
    r.lists.add('catalysts')
    r.cat = c
  }
  for (const v of Array.isArray(volume?.rows) ? volume.rows : []) {
    const r = get(v?.sym)
    if (!r) continue
    r.vol = v
    if (v.lit) r.lists.add('volume')
  }

  const out = []
  for (const r of by.values()) {
    // A name the scanner merely TRACKS (not lit) and no other list mentions is not a mover.
    if (!r.lists.size) continue
    const live = prices?.[r.sym] || null
    const extLive = live && live.ext_session === session ? num(live.ext_price) : null
    let last = null
    let pct = null
    let ah = null
    if (session === 'pre') {
      last = extLive ?? num(r.vol?.price) ?? null
      const prev = pos(live?.prev_close)
      pct = extLive != null && prev ? ((extLive - prev) / prev) * 100 : (r.moversPct ?? num(r.vol?.pct) ?? num(r.cat?.gap_pct))
    } else {
      last = pos(live?.price) ?? num(r.vol?.price) ?? pos(r.cat?.price)
      pct = num(live?.change_pct) ?? r.moversPct ?? num(r.vol?.pct) ?? num(r.cat?.gap_pct)
      if (session === 'post') {
        const close = pos(live?.day_close)
        ah = extLive != null && close ? ((extLive - close) / close) * 100 : null
      }
    }
    // Volume vs average: the live scanner's "so far today ÷ usual by now" first (it moves with the
    // day), else the catalyst engine's "today ÷ 30-day average". Each says which it is.
    let volVsAvg = null
    let volSource = null
    const rv = pos(r.vol?.rvol_day) ?? pos(r.vol?.rvol)
    if (rv != null) { volVsAvg = rv; volSource = 'scanner' } else if (pos(r.cat?.vol_x) != null) { volVsAvg = r.cat.vol_x; volSource = 'catalyst' }
    out.push({
      sym: r.sym,
      last,
      pct,
      ah,
      volume: pos(live?.volume),
      volVsAvg,
      volSource,
      lit: !!r.vol?.lit,
      lists: [...r.lists],
      // catalyst_at is unix SECONDS (catalyst engine `_compute_catalyst_at`); carried as ms.
      catalyst: r.cat ? {
        label: catalystLabel(r.cat),
        thesis: r.cat.thesis_text || null,
        at: pos(r.cat.catalyst_at) != null ? r.cat.catalyst_at * 1000 : null,
      } : null,
    })
  }
  return out
}

/** The symbols worth a live-price subscription: the movers list first (it is the point), capped. */
export function liveSymbols({ movers = null, catalysts = null, volume = null } = {}) {
  const seen = new Set()
  const add = (s) => { const u = up(s); if (u) seen.add(u) }
  for (const m of [...(movers?.ripping || []), ...(movers?.drilling || [])]) add(m?.sym)
  for (const c of catalysts?.rows || []) add(c?.ticker)
  for (const v of volume?.rows || []) if (v?.lit) add(v.sym)
  return [...seen].sort().slice(0, MAX_NAMES)
}

/** Default sort for a lens: gainers biggest-up first, losers biggest-down first, volume by RVOL. */
export function defaultSort(lens) {
  if (lens === 'down') return { key: 'pct', dir: 'asc' }
  if (lens === 'volume') return { key: 'volVsAvg', dir: 'desc' }
  if (lens === 'all') return { key: 'absPct', dir: 'desc' }
  return { key: 'pct', dir: 'desc' }
}

/**
 * Pure: the rows a lens + filters keep.
 *   lens       'all' | 'up' | 'down' | 'volume'
 *   minPrice   drop names whose last is below this (a name with no last is kept only at 0)
 *   minVolume  drop names whose volume today is below this (likewise)
 */
export function filterRows(rows, { lens = 'all', minPrice = 0, minVolume = 0 } = {}) {
  return rows.filter((r) => {
    if (lens === 'up' && !(r.pct > 0)) return false
    if (lens === 'down' && !(r.pct < 0)) return false
    if (lens === 'volume' && !r.lit) return false
    if (minPrice > 0 && !(r.last >= minPrice)) return false
    if (minVolume > 0 && !(r.volume >= minVolume)) return false
    return true
  })
}

const SORT_VALUE = {
  sym: (r) => r.sym,
  last: (r) => r.last,
  pct: (r) => r.pct,
  absPct: (r) => (r.pct == null ? null : Math.abs(r.pct)),
  ah: (r) => r.ah,
  volume: (r) => r.volume,
  volVsAvg: (r) => r.volVsAvg,
}
const valueOf = (key, r) => (SORT_VALUE[key] || SORT_VALUE.pct)(r)
const isNumeric = (key) => key !== 'sym'
const bySym = (a, b) => (a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0)

/** The direction a column takes on its first header click: the symbol reads A→Z, numbers biggest first. */
export const firstDirFor = (key) => (key === 'sym' ? 'asc' : 'desc')

/** Pure: rows ordered by `key` through the DataGrid seed (TERM-065); a missing value always sorts
 *  LAST, whichever the direction, and equal cells keep symbol order. */
export function sortRows(rows, { key = 'pct', dir = 'desc' } = {}) {
  return seedSortRows(rows, { key: SORT_VALUE[key] ? key : 'pct', dir }, { valueOf, isNumeric, tiebreak: bySym })
}
