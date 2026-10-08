// A test board that behaves like the Charts workspace where it matters to the
// Agent: the product's own planPlacement places each add, ids are minted per add,
// a new widget joins link group A by default (pickWidgetColor's rule), the color
// dot can unlink a widget ('N' → its own `N:<id>` symbol key, as WidgetHost
// does), and charts read their symbol from their link group.
import { planPlacement } from '../../pages/charts/placement/place'
import { buildWidgetSource, buildLayoutSource, buildWatchlistSource } from '../host'
import { mergeChartSettings } from '../../components/chart/chartDefaults'

export function makeBoard(widgets, groupSyms = { A: 'AAPL' }, { failAddAt = null, layouts = null, watchlists = null } = {}) {
  const state = { widgets: widgets.map(w => ({ color: 'A', opts: {}, ...w })), groupSyms: { ...groupSyms } }
  let n = 0
  let adds = 0
  const keyOf = (w) => (w.color === 'N' ? `N:${w.id}` : w.color)
  const widgetOps = {
    layout: () => state,
    add: (type, slot = null, init = null) => {
      adds += 1
      if (failAddAt && adds === failAddAt) return                  // a write that never lands
      state.addCalls = [...(state.addCalls || []), { type, init }]
      // handleAddWidget's rule: an exact slot is honoured only when it is in-bounds
      // and overlaps nothing; otherwise the normal placement decides.
      const free = slot && slot.x >= 0 && slot.y >= 0 && slot.x + slot.w <= 24 && slot.y + slot.h <= 20
        && !state.widgets.some(w => w.x < slot.x + slot.w && slot.x < w.x + w.w && w.y < slot.y + slot.h && slot.y < w.y + w.h)
      const place = free ? { x: slot.x, y: slot.y, w: slot.w, h: slot.h } : planPlacement(state.widgets, type).place
      const id = `w-${type}-${++n}`
      // handleAddWidget's unlinkedSymbol: born 'N' on that ticker (and init.tf).
      if (init?.symbol) state.groupSyms = { ...state.groupSyms, [`N:${id}`]: init.symbol }
      state.widgets = [...state.widgets, { id, type, color: init?.symbol ? 'N' : 'A', opts: init?.tf ? { tf: init.tf } : {}, ...place }]
    },
    remove: (id) => { state.widgets = state.widgets.filter(w => w.id !== id) },
    color: (id, color) => { state.widgets = state.widgets.map(w => (w.id === id ? { ...w, color } : w)) },
    cancelPending: () => {},
    groupSyms: () => state.groupSyms,
  }
  const visible = () => state.widgets
  const readChart = (id) => {
    const w = state.widgets.find(x => x.id === id && x.type === 'chart')
    if (!w) return null
    const pos = null
    return {
      ref: id, label: `Chart ${id}`, position: pos,
      symbol: state.groupSyms[keyOf(w)] || 'SPY', tf: w.opts.tf || 'D',
      stored: w.opts.settings ?? null, cs: mergeChartSettings(w.opts.settings || null),
      linkedCount: 0,
    }
  }
  const host = {
    widgets: buildWidgetSource({ widgetOps, getWidgets: visible }),
    charts: {
      list: () => state.widgets.filter(w => w.type === 'chart').map(w => readChart(w.id)),
      read: (ref) => readChart(ref),
      commit: (ref, patch) => {
        const w = state.widgets.find(x => x.id === ref)
        if (!w) return false
        const opts = { ...w.opts }
        if ('settings' in patch) opts.settings = patch.settings
        if ('tf' in patch) opts.tf = patch.tf
        state.widgets = state.widgets.map(x => (x.id === ref ? { ...x, opts } : x))
        if (patch.symbol) state.groupSyms = { ...state.groupSyms, [keyOf(w)]: patch.symbol }
        return true
      },
    },
    otherWidgets: () => [],
  }
  // Optional layout library, behaving like the Layout Dock: `open` swaps the board
  // for the stored one (your own layouts keep their edits — they auto-save; others
  // drop them), `rename` refuses a duplicate, `saveAs` refuses an existing name.
  if (layouts) {
    const lib = {
      entries: layouts.entries.map(e => ({ scope: 'user', ...e })),
      boards: Object.fromEntries(Object.entries(layouts.boards || {}).map(([k, v]) => [k, v.map(w => ({ color: 'A', opts: {}, ...w }))])),
      activeId: layouts.active ?? null,
      unsaved: !!layouts.unsaved,
      calls: [],
    }
    state.layouts = lib
    const activeEntry = () => lib.entries.find(e => e.id === lib.activeId) || null
    const ops = {
      open(entry) {
        lib.calls.push(['open', entry.id])
        const cur = activeEntry()
        if (cur && cur.scope === 'user') lib.boards[cur.id] = state.widgets
        lib.activeId = entry.id
        state.widgets = (lib.boards[entry.id] || []).map(w => ({ ...w }))
        lib.unsaved = false
      },
      async rename(id, name) {
        lib.calls.push(['rename', id, name])
        if (lib.entries.some(e => e.id !== id && e.name === name)) return
        lib.entries = lib.entries.map(e => (e.id === id ? { ...e, name } : e))
      },
      async saveAs(name) {
        lib.calls.push(['saveAs', name])
        if (lib.entries.some(e => e.scope === 'user' && e.name === name)) throw new Error('You already have a layout with that name')
        const id = 1000 + lib.entries.length
        lib.entries = [...lib.entries, { id, name, scope: 'user' }]
        lib.boards[id] = state.widgets.map(w => ({ ...w }))
        lib.activeId = id
        lib.unsaved = false
        return { id, name, scope: 'user' }
      },
      refresh: async () => {},
    }
    const source = buildLayoutSource(() => {
      const a = activeEntry()
      return {
        entries: lib.entries, active: a ? { id: a.id, name: a.name, scope: a.scope } : null,
        unsaved: lib.unsaved,
        arrangement: JSON.stringify(state.widgets.map(w => [w.id, w.x, w.y, w.w, w.h])),
        ...ops,
      }
    })
    host.layouts = source
    host.epoch = () => { const a = source.snapshot().active; return a ? `${a.scope}:${a.id}` : 'unsaved' }
  }
  // Optional saved WATCHLISTS behind an in-memory server with the REAL routes'
  // semantics (watchlist_service.py): bulk add skips symbols already there and appends
  // in order; one add is idempotent; delete is by item id; reorder takes the full id
  // order; create mints an id (names are NOT unique server-side); rename is a PUT.
  // `getLists()` is the SWR cache: it only changes when `revalidate()` "refetches".
  if (watchlists) {
    let seq = 0
    const server = {
      lists: watchlists.map(l => ({ id: l.id, name: l.name, origin: l.origin || null, items: (l.symbols || []).map(sym => ({ id: `${l.id}-i${++seq}`, sym, notes: (l.notes || {})[sym] || '' })) })),
      calls: [], failOn: null,
    }
    state.server = server
    let cache = JSON.parse(JSON.stringify(server.lists))
    const ok = (o) => ({ ok: true, status: 200, json: async () => o })
    const nope = (status, detail) => ({ ok: false, status, json: async () => ({ detail }) })
    const request = async (url, init = {}) => {
      const method = (init.method || 'GET').toUpperCase()
      const body = init.body ? JSON.parse(init.body) : null
      const path = url.split('?')[0]
      server.calls.push([method, path, body])
      if (server.failOn && server.failOn(method, path, body)) return nope(500, 'server error')
      if (method === 'GET' && path === '/api/watchlists') return ok(server.lists.map(l => ({ id: l.id, name: l.name, item_count: l.items.length })))
      if (method === 'POST' && path === '/api/watchlists') {
        const row = { id: `wl${++seq}`, name: body.name, items: [] }
        server.lists.push(row)
        return ok({ ...row })
      }
      const m = /^\/api\/watchlists\/([^/]+)(\/.*)?$/.exec(path)
      const wl = m && server.lists.find(l => l.id === decodeURIComponent(m[1]))
      if (!wl) return nope(404, 'Watchlist not found')
      const sub = m[2] || ''
      if (method === 'GET' && !sub) return ok(JSON.parse(JSON.stringify(wl)))
      if (wl.origin?.mode === 'link' && sub) return nope(409, 'linked')
      if (method === 'POST' && sub === '/items/bulk') {
        let added = 0
        for (const raw of body.symbols) {
          const sym = raw.trim().toUpperCase()
          if (!sym || wl.items.some(i => i.sym === sym)) continue
          wl.items.push({ id: `${wl.id}-i${++seq}`, sym, notes: '' }); added++
        }
        return ok({ added, watchlist: JSON.parse(JSON.stringify(wl)) })
      }
      if (method === 'POST' && sub === '/items') {
        const sym = body.sym.trim().toUpperCase()
        const hit = wl.items.find(i => i.sym === sym)
        if (hit) return ok({ ...hit, duplicate: true })
        const row = { id: `${wl.id}-i${++seq}`, sym, notes: body.notes || '' }
        wl.items.push(row)
        return ok({ ...row, duplicate: false })
      }
      const di = /^\/items\/([^/]+)$/.exec(sub)
      if (method === 'DELETE' && di) {
        const before = wl.items.length
        wl.items = wl.items.filter(i => i.id !== decodeURIComponent(di[1]))
        return before === wl.items.length ? nope(404, 'Item not found') : ok({ ok: true })
      }
      if (method === 'PUT' && sub === '/reorder') {
        const pos = new Map(body.item_ids.map((id, k) => [id, k]))
        wl.items = [...wl.items].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9))
        return ok({ ok: true })
      }
      if (method === 'PUT' && !sub) { wl.name = body.name; return ok({ ...wl }) }
      if (method === 'DELETE' && !sub) { server.lists = server.lists.filter(l => l !== wl); return ok({ ok: true }) }
      return nope(400, 'unexpected')
    }
    host.watchlists = buildWatchlistSource({
      getLists: () => cache,
      getWidgets: () => state.widgets,
      revalidate: () => { cache = JSON.parse(JSON.stringify(server.lists)) },
      request,
    })
    // "The member edits the list by hand" (another tab, the Watchlists page).
    state.manual = (id, fn) => { const wl = server.lists.find(l => l.id === id); fn(wl); cache = JSON.parse(JSON.stringify(server.lists)) }
  }
  return { host, state, widgetOps }
}
