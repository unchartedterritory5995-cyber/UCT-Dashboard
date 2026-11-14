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

// What a test can move. `scan(body)` may return rows, or {rows, total}.
export const net = {
  starters: STARTERS_ON, saved: [], prefs: {}, rows: RS_ROWS, scan: null, savedDelay: 0, prefsDelay: 0,
  diff: null, methodology: { methods: [] }, themes: {}, prefsFail: false,
}
export function resetNet() {
  Object.assign(net, { starters: STARTERS_ON, saved: [], prefs: {}, rows: RS_ROWS, scan: null, savedDelay: 0, prefsDelay: 0,
    diff: null, methodology: { methods: [] }, themes: {}, prefsFail: false })
}
const later = (body, ms) => (ms ? new Promise(r => setTimeout(() => r(body), ms)) : body)

export function installFetch() {
  globalThis.fetch = vi.fn(async (u, o) => {
    const url = String(u)
    if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
    if (url === '/api/screener/scan') {
      const body = JSON.parse(o.body)
      const out = net.scan ? net.scan(body) : net.rows
      const rows = Array.isArray(out) ? out : out.rows
      return { ok: true, json: async () => ({ rows, total: Array.isArray(out) ? rows.length : out.total, page: body.page || 1 }) }
    }
    if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: net.rows.length }) }
    if (url === '/api/screener/membership-diff') return net.diff ? { ok: true, json: async () => net.diff } : { ok: false, status: 404, json: async () => ({}) }
    if (url.startsWith('/api/screener/methodology')) return { ok: true, json: async () => net.methodology }
    if (url.startsWith('/api/watchlists/themes-batch')) return { ok: true, json: async () => ({ results: net.themes }) }
    if (url.startsWith('/api/screener/saved-screens')) return later({ ok: true, json: async () => ({ saved: net.saved, starters: net.starters }) }, net.savedDelay)
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
