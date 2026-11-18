// The page harness the RS screens tests share (unit U5): FocusScreener mounted with the network
// mocked at fetch, the starters payload taken from the contract fixture.
//
// ⛔ The `vi.mock` calls that stub the chart and the live price hook live in each TEST file
// (vitest hoists them per file); this module only holds the fetch router and the mount.
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi } from 'vitest'
import FocusScreener from '../FocusScreener'
import { AuthContext } from '../../../../context/AuthContext'
import { STARTERS_ON, RS_ROWS } from './rsScreensFixture'

export const META = {
  filters: [
    { key: 'rs_rank', label: 'RS Rank', category: 'technical', type: 'range', presets: [{ label: 'Any' }] },
    { key: 'price', label: 'Price', category: 'technical', type: 'range', unit: '$', presets: [{ label: 'Any' }] },
  ],
  categories: [{ key: 'technical', label: 'Technical' }],
  views: [{ key: 'overview', columns: ['ticker', 'price'] }],
}

// What a test can move. `scan(body)` may return rows, or {rows, total}. `meta` replaces the small
// registry above (the request-capture test hands the page the server's own entries).
export const net = {
  starters: STARTERS_ON, saved: [], prefs: {}, rows: RS_ROWS, scan: null, savedDelay: 0, prefsDelay: 0,
  diff: null, methodology: { methods: [] }, themes: {}, prefsFail: false, meta: null,
  // unit U8: the saved-screens payload's `rs_market`; undefined leaves the key out (the flag is off)
  market: undefined,
  // the first night: the saved-screens payload's `rs_pending` ({ text }); undefined leaves the key out
  pending: undefined,
  // unit U8: `row(ticker, columns)` answers GET /api/screener/row/{ticker} with { row, stale }, null
  // for a 404, { status } for a refusal; `count(body)` answers POST /api/screener/count (null: a 500)
  row: null, count: null,
  // unit U13: the saved-screens payload's `rs_alerts`; undefined leaves the key out (the flag is
  // off). `alertSet(starterId, method)` answers POST / DELETE /api/screener/rs-alerts/{id}: return
  // nothing for a 200, { status } for a refusal, or a promise of either (to hold the answer back).
  alerts: undefined, alertSet: null,
  // unit U12: `rowsBatch(tickers, columns)` answers GET /api/screener/rows with { rows, missing }
  // ({ status } for a refusal; throwing is a dropped connection). Unset: no stock has a row.
  rowsBatch: null,
}
export function resetNet() {
  Object.assign(net, { starters: STARTERS_ON, saved: [], prefs: {}, rows: RS_ROWS, scan: null, savedDelay: 0, prefsDelay: 0,
    diff: null, methodology: { methods: [] }, themes: {}, prefsFail: false, meta: null, market: undefined, pending: undefined, row: null, count: null,
    alerts: undefined, alertSet: null, rowsBatch: null })
}
const later = (body, ms) => (ms ? new Promise(r => setTimeout(() => r(body), ms)) : body)

export function installFetch() {
  globalThis.fetch = vi.fn(async (u, o) => {
    const url = String(u)
    if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => net.meta || META }
    if (url === '/api/screener/scan') {
      const body = JSON.parse(o.body)
      const out = net.scan ? net.scan(body) : net.rows
      const rows = Array.isArray(out) ? out : out.rows
      return { ok: true, json: async () => ({ rows, total: Array.isArray(out) ? rows.length : out.total, page: body.page || 1, ...(out.coverage ? { coverage: out.coverage } : {}) }) }
    }
    if (url === '/api/screener/count') {
      const n = net.count ? net.count(JSON.parse(o.body)) : net.rows.length
      return n == null ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, json: async () => ({ count: n }) }
    }
    if (url.startsWith('/api/screener/rows')) {
      const at = new URL(url, 'http://x')
      const names = (at.searchParams.get('tickers') || '').split(',').filter(Boolean)
      const out = net.rowsBatch ? net.rowsBatch(names, (at.searchParams.get('columns') || '').split(',').filter(Boolean)) : { rows: {}, missing: names }
      if (out?.status) return { ok: false, status: out.status, json: async () => ({ detail: 'refused' }) }
      return { ok: true, status: 200, json: async () => out }
    }
    if (url.startsWith('/api/screener/row/')) {
      const at = new URL(url, 'http://x')
      const ticker = decodeURIComponent(at.pathname.split('/').pop())
      const out = net.row ? net.row(ticker, (at.searchParams.get('columns') || '').split(',').filter(Boolean)) : null
      if (!out) return { ok: false, status: 404, json: async () => ({ detail: 'No such stock in the Screener.' }) }
      if (out.status) return { ok: false, status: out.status, json: async () => ({ detail: 'refused' }) }
      return { ok: true, status: 200, json: async () => ({ ticker, ...out }) }
    }
    if (url === '/api/screener/membership-diff') return net.diff ? { ok: true, json: async () => net.diff } : { ok: false, status: 404, json: async () => ({}) }
    if (url.startsWith('/api/screener/methodology')) return { ok: true, json: async () => net.methodology }
    if (url.startsWith('/api/watchlists/themes-batch')) return { ok: true, json: async () => ({ results: net.themes }) }
    if (url.startsWith('/api/screener/saved-screens')) return later({ ok: true, json: async () => ({ saved: net.saved, starters: net.starters, ...(net.market !== undefined ? { rs_market: net.market } : {}), ...(net.pending !== undefined ? { rs_pending: net.pending } : {}), ...(net.alerts !== undefined ? { rs_alerts: net.alerts } : {}) }) }, net.savedDelay)
    if (url.startsWith('/api/screener/rs-alerts/')) {
      const id = decodeURIComponent(url.split('/').pop())
      const out = net.alertSet ? await net.alertSet(id, o?.method) : null
      if (out?.status) return { ok: false, status: out.status, json: async () => ({ detail: 'Not Found' }) }
      return { ok: true, status: 200, json: async () => ({ starter_id: id, subscribed: o?.method === 'POST' }) }
    }
    if (url.startsWith('/api/auth/preferences')) {
      if (o?.method === 'POST') {
        const { key, value } = JSON.parse(o.body)
        net.prefs = { ...net.prefs, [key]: value }
        return { ok: true, json: async () => ({ ok: true }) }
      }
      if (net.prefsFail) return { ok: false, status: 502, json: async () => ({}) }
      const snap = { ...net.prefs }
      return later({ ok: true, json: async () => snap }, net.prefsDelay)
    }
    if (url.startsWith('/api/screener/to-watchlist') || url.startsWith('/api/screener/save-fork') || url.startsWith('/api/exports/quota')) {
      return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) }
    }
    return { ok: true, json: async () => ([]) }
  })
}

export const mount = (auth = { user: { id: 'member-a' } }) => render(
  <MemoryRouter><AuthContext.Provider value={auth}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig>
  </AuthContext.Provider></MemoryRouter>)

export const scanBodies = () => fetch.mock.calls.filter(([u]) => String(u) === '/api/screener/scan').map(([, o]) => JSON.parse(o.body))
export const prefPosts = key => fetch.mock.calls.filter(([u, o]) => String(u).startsWith('/api/auth/preferences') && o?.method === 'POST')
  .map(([, o]) => JSON.parse(o.body)).filter(b => !key || b.key === key).map(b => JSON.parse(b.value))
// The clause the last scan carried on a filter key, without its key ({op, min, ...}), or undefined.
export const clauseOf = (body, key) => {
  const f = (body?.filters || []).find(x => x.key === key)
  if (!f) return undefined
  const { key: _k, ...rest } = f
  return rest
}
export const pin = ids => localStorage.setItem('uct.screener.pinned', JSON.stringify(ids))
