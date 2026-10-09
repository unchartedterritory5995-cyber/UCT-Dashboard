// ── UCT Agent HOST: the Charts workspace's binding for its target kinds ─────
//
// Built by ChartsWorkspace from what it already owns: the `chartApiById`
// registry every mounted ChartWidget registers into (each carries an `agent`
// adapter — read + commit through the widget's OWN sinks) and the visible board
// (to say WHERE a chart is). The host never touches prefs or React state.
// A future feature with its own target kind adds its own binding here
// (e.g. `host.widgets`) — capability modules then reach it through their kind.
//
// A chart's ref is its persisted widget id (+ "~tabId" for an extra chart tab).
// Only charts on the visible grid are targets; popped-out / floating ones are not.

import { planPlacement, planGroupPlacement } from '../pages/charts/placement/place'
import { boardWidgetCount, boardCanGrow, MAX_BOARD_WIDGETS } from '../pages/charts/boardBound'
import { WORKSPACE_MENU_TYPES } from '../widgets/registry'
import { UCT_DEFAULT_ID } from '../pages/charts/layoutDockPins'
import * as drawingsStore from '../components/chart/drawingsStore'

const refOf = (r) => (r.tabId ? `${r.chartId}~${r.tabId}` : r.chartId)

export function positionWord(w, all) {
  if (all.length < 2) return ''
  const cx = w.x + w.w / 2
  const cy = w.y + w.h / 2
  const spreadX = new Set(all.map(o => (o.x + o.w / 2) < 12)).size > 1
  const spreadY = new Set(all.map(o => (o.y + o.h / 2) < 10)).size > 1
  const v = spreadY ? (cy < 10 ? 'top' : 'bottom') : ''
  const h = spreadX ? (cx < 12 ? 'left' : 'right') : ''
  return [v, h].filter(Boolean).join('-')
}

export function buildChartSource({ chartApiById, getWidgets }) {
  function entries() {
    const widgets = getWidgets() || []
    const byId = new Map(widgets.map(w => [w.id, w]))
    const seen = new Set()
    const out = []
    for (const api of chartApiById.current.values()) {
      if (!api || !api.agent) continue
      const r = api.agent.read()
      if (!r || !r.chartId || !byId.has(r.chartId)) continue
      const ref = refOf(r)
      if (seen.has(ref)) continue
      seen.add(ref)
      out.push({ api, r, ref, w: byId.get(r.chartId) })
    }
    out.sort((a, b) => (a.w.y - b.w.y) || (a.w.x - b.w.x))
    const chartWidgets = out.map(e => e.w)
    return out.map((e, i) => {
      const pos = positionWord(e.w, chartWidgets)
      const linkedCount = typeof e.r.groupKey === 'string' && !e.r.groupKey.startsWith('N')
        ? widgets.filter(o => o.id !== e.r.chartId && o.color === e.r.groupKey).length
        : 0
      const name = out.length === 1 ? 'Chart' : (pos ? `${pos[0].toUpperCase()}${pos.slice(1)} chart` : `Chart ${i + 1}`)
      return {
        ...e,
        snap: {
          ref: e.ref, label: `${name} (${e.r.symbol})`, position: pos || null,
          symbol: e.r.symbol, tf: e.r.tf, cs: e.r.cs, stored: e.r.stored,
          linkedCount, group: e.r.groupKey,
          view: e.api.agent.view?.() || null,
          // the exact symbol string StockChart keys its drawings by (useChartDrawings(sym))
          drawSym: e.api.agent.drawSym?.() || e.r.symbol,
        },
      }
    })
  }
  return {
    list: () => entries().map(e => e.snap),
    read: (ref) => entries().find(e => e.ref === ref)?.snap || null,
    commit: (ref, patch) => {
      const e = entries().find(x => x.ref === ref)
      return e ? e.api.agent.commit(patch) : false
    },
    // The Time Navigator's jump on this chart (a view; see ChartWidget's adapter).
    goTo: (ref, ms) => {
      const e = entries().find(x => x.ref === ref)
      if (!e?.api.agent.goToDate) return false
      e.api.agent.goToDate(ms)
      return true
    },
  }
}

/**
 * The board, read EXACTLY as handleAddWidget reads it (layoutRef's widgets for
 * placement, boardWidgetCount for the bound) and written ONLY through the
 * workspace's own handlers (`widgetOps.add` = handleAddWidget, `widgetOps.remove`
 * = handleRemoveWidget). `fits[type]` is planPlacement's own verdict: true when
 * the type lands in empty space without resizing anything.
 */
export function buildWidgetSource({ widgetOps, getWidgets }) {
  return {
    snapshot() {
      const layout = widgetOps.layout() || { widgets: [] }
      const all = layout.widgets || []
      const visible = getWidgets() || []
      const count = boardWidgetCount(layout) ?? 0
      // planPlacement is pure: simulate a SEQUENCE of adds exactly as the product
      // would place them one after another, and say whether every one lands in
      // empty space (no `mutations` = nothing else resized or moved).
      // Several new widgets of ONE type are planned as a group (equal cells in one
      // empty region, nothing else touched); only when no such region exists does
      // the one-after-another simulation decide.
      const groupPlan = (type, n) => {
        try { return planGroupPlacement(all, type, n) } catch { return null }
      }
      const fitsSequence = (types) => {
        if (types.length > 1 && types.every(t => t === types[0]) && groupPlan(types[0], types.length)) return true
        let board = all.map(w => ({ ...w }))
        for (let i = 0; i < types.length; i++) {
          let plan
          try { plan = planPlacement(board, types[i]) } catch { return false }
          if (!plan || !plan.place || (plan.mutations || []).length) return false
          board = [...board, { id: `__sim${i}`, type: types[i], ...plan.place }]
        }
        return true
      }
      const capacity = (type, limit) => {
        let n = 0
        while (n < limit && fitsSequence(Array(n + 1).fill(type))) n++
        return n
      }
      const fits = {}
      for (const t of WORKSPACE_MENU_TYPES) fits[t] = fitsSequence([t])
      return {
        ref: 'workspace', label: 'Workspace',
        widgets: all.map(w => ({
          id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, color: w.color,
          optsSig: JSON.stringify(w.opts ?? null),
        })),
        visible: visible.map(w => ({ id: w.id, type: w.type, position: positionWord(w, visible) || null })),
        count, max: MAX_BOARD_WIDGETS, canGrow: boardCanGrow(count), fits, fitsSequence, capacity, groupPlan,
        // ── arrangement (Batch 5): the board's exact widgets (for exact Undo) and its own
        // pure geometry rules. Nothing here writes; applyBoard below is the one writer.
        raw: all.map(w => JSON.parse(JSON.stringify(w))),
        layoutTheme: layout.layoutTheme ?? null,
        grid: widgetOps.grid?.() || null,
        minOf: (w) => widgetOps.minOf?.(w) || { minW: 2, minH: 3 },
        repack: (widgets, id, rect) => widgetOps.repack?.(widgets, id, rect) || null,
        resize: (widgets, id, rect, handle) => widgetOps.resize?.(widgets, id, rect, handle) || null,
        themeAll: (widgets, themeId) => widgetOps.themeAll?.(widgets, themeId) || null,
        extraGroups: widgetOps.extraGroups?.() === true,
      }
    },
    applyBoard: (p) => widgetOps.applyBoard(p),
    add: (type, place, init) => widgetOps.add(type, place, init),
    // A widget's CONFIGURATION as the workspace holds it (layout + link-group
    // ticker) — readable whether or not the widget has mounted yet. This is what a
    // chart will load; it says nothing about whether its data has arrived.
    configOf(id) {
      const w = ((widgetOps.layout() || {}).widgets || []).find(x => x.id === id)
      if (!w) return null
      const syms = widgetOps.groupSyms?.() || {}
      return { color: w.color || null, tf: w?.opts?.tf || 'D', symbol: (w.color === 'N' ? syms[`N:${id}`] : syms[w.color]) || null }
    },
    remove: (id) => widgetOps.remove(id),
    color: (id, color) => widgetOps.color?.(id, color),
    cancelPending: () => widgetOps.cancelPending?.(),
  }
}

/**
 * Named layouts, read through the Layout Dock's own catalog and active pointer and
 * changed only through its handlers (see ChartsWorkspace's agentLayoutsRef). The
 * Agent never writes a layout record itself.
 */
export function buildLayoutSource(getLayouts) {
  const kindWord = (scope, id) => (id === UCT_DEFAULT_ID ? 'built-in' : scope === 'global' ? 'prebuilt' : 'yours')
  return {
    snapshot() {
      const L = getLayouts() || { entries: [], active: null }
      return {
        entries: (L.entries || []).map(e => ({ id: e.id, name: e.name, scope: e.scope || 'user', kind: kindWord(e.scope, e.id) })),
        active: L.active || null,
        unsaved: !!L.unsaved,
        arrangement: L.arrangement || '',
      }
    },
    open: (entry) => getLayouts()?.open(entry),
    rename: (id, name) => getLayouts()?.rename(id, name),
    saveAs: (name) => getLayouts()?.saveAs(name),
    // The Layouts ▾ "Save current arrangement" handler: {ok, named: saved|none|failed}.
    saveCurrent: () => getLayouts()?.saveCurrent?.(),
    refresh: () => getLayouts()?.refresh?.(),
    remove: (id) => getLayouts()?.remove(id),
    create: (name) => getLayouts()?.create(name),
    duplicate: (id, name) => getLayouts()?.duplicate(id, name),
  }
}

/**
 * The member's OWN saved watchlists — the DATA, not the Watchlist widget. Read from the
 * same `/api/watchlists` the Watchlists page reads; written ONLY through the same REST
 * routes the page and the ticker menu call (bulk add, delete-by-item, add, reorder,
 * create, rename), then every `/api/watchlists*` SWR key is revalidated so each open
 * list re-reads. The Agent keeps no list store of its own: `fresh` only holds the
 * server's latest answer between a write and the SWR refetch, so a read-back never sees
 * the pre-write cache.
 *   getLists()   → the SWR list rows (own lists, prebuilt excluded) or undefined
 *   getWidgets() → the visible board (which Watchlist widget shows which list)
 *   revalidate() → re-read every /api/watchlists* key
 */
export function buildWatchlistSource({ getLists, getWidgets, revalidate, request = (u, o) => fetch(u, { credentials: 'include', ...o }) }) {
  const fresh = new Map()       // id → { row, at }
  const gone = new Set()        // ids this tab deleted (until the SWR refetch drops them)
  let swrAt = 0
  let lastRows = null
  const slimItems = (row) => (row?.items || []).filter(i => i && i.sym).map(i => ({ id: String(i.id), sym: String(i.sym).toUpperCase(), notes: i.notes || '' }))
  const editableWhy = (row) => (row.origin?.mode === 'link' ? 'it is linked to its source list (save a copy to edit it)' : null)
  function rows() {
    const r = getLists() || []
    if (r !== lastRows) { lastRows = r; swrAt = Date.now() }
    const byId = new Map(r.filter(x => x && x.id && !x.is_flagged_list && !x.is_prebuilt).map(x => [String(x.id), x]))
    for (const [id, f] of fresh) if (f.at >= swrAt) byId.set(id, f.row)
    for (const id of gone) byId.delete(id)
    return [...byId.values()]
  }
  function shownIn(id, widgets) {
    const lists = widgets.filter(w => w.type === 'watchlist')
    return lists.filter(w => w.opts?.watchKey === `user:${id}`).map(w => positionWord(w, lists) || 'on the board')
  }
  const remember = (row) => { if (row?.id) fresh.set(String(row.id), { row: { ...row, id: String(row.id) }, at: Date.now() }); return row }
  async function json(r, what) {
    if (!r.ok) {
      const b = await r.json().catch(() => ({}))
      throw new Error(b.detail || `${what} failed (${r.status})`)
    }
    return r.json()
  }
  const enc = encodeURIComponent
  const send = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return {
    loaded: () => Array.isArray(getLists()),
    snapshot() {
      const widgets = getWidgets() || []
      return rows().map(row => ({
        id: String(row.id), name: row.name, items: slimItems(row),
        editable: !editableWhy(row), why: editableWhy(row), shownIn: shownIn(String(row.id), widgets),
      }))
    },
    /** The server's CURRENT list (never the cache) — read right before and after a write. */
    async fetchList(id) {
      return remember(await json(await request(`/api/watchlists/${enc(id)}?slim=1`, { cache: 'no-store' }), 'Reading the watchlist'))
    },
    async fetchAll() {
      const list = await json(await request('/api/watchlists?include_items=0&include_prebuilt=0', { cache: 'no-store' }), 'Reading your watchlists')
      return Array.isArray(list) ? list.filter(x => !x.is_flagged_list && !x.is_prebuilt) : []
    },
    bulkAdd: async (id, symbols) => json(await request(`/api/watchlists/${enc(id)}/items/bulk`, send('POST', { symbols })), 'Adding'),
    addItem: async (id, sym, notes = '') => json(await request(`/api/watchlists/${enc(id)}/items`, send('POST', { sym, notes })), 'Adding'),
    removeItem: async (id, itemId) => json(await request(`/api/watchlists/${enc(id)}/items/${enc(itemId)}`, { method: 'DELETE' }), 'Removing'),
    reorder: async (id, itemIds) => json(await request(`/api/watchlists/${enc(id)}/reorder`, send('PUT', { item_ids: itemIds })), 'Reordering'),
    async create(name) {
      const row = await json(await request('/api/watchlists', send('POST', { name, description: '', is_public: false })), 'Creating the watchlist')
      remember({ ...row, items: row.items || [] })
      return row
    },
    rename: async (id, name) => json(await request(`/api/watchlists/${enc(id)}`, send('PUT', { name })), 'Renaming'),
    /** Delete a whole list (the Watchlists page's DELETE; owner-only server-side, hard). */
    async deleteList(id) {
      await json(await request(`/api/watchlists/${enc(id)}`, { method: 'DELETE' }), 'Deleting the watchlist')
      fresh.delete(String(id))
      gone.add(String(id))
      revalidate?.()
    },
    /** Only to take back a list THIS transaction just created (compensation). */
    async deleteCreated(id) {
      await json(await request(`/api/watchlists/${enc(id)}`, { method: 'DELETE' }), 'Removing the new list')
      fresh.delete(String(id))
      revalidate?.()
    },
    /** After a write: the server's list becomes what the Agent reads, and every open list re-reads. */
    async settle(id) {
      const row = await this.fetchList(id)
      revalidate?.()
      return row
    },
  }
}

// What identifies a board's arrangement: each widget's id, type, cell, link colour
// and timeframe. (Settings blobs are left out: they are rewritten on hydration.)
export const boardSig = (widgets) => JSON.stringify((widgets || [])
  .map(w => [w.id, w.type, w.x, w.y, w.w, w.h, w.color || null, w?.opts?.tf || null])
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * ⛔ CROSS-SESSION GUARD. The board and the open-layout pointer are ONE per-member
 * preference each, written last-write-wins, and a tab never re-reads them after it
 * loads — so another tab or device can change them under this one. Before the Agent
 * writes (Apply / Undo), re-read what the server holds and compare it with THIS tab:
 * a different open layout, or a different arrangement that is not just this tab's
 * own save still in flight (the workspace debounces its autosave ~500ms), means the
 * board changed elsewhere — refuse rather than overwrite it. → { ok, reason }
 */
export function buildBoardSync({ readServer, localLayout, localEpoch, settleMs = 700, tries = 2 }) {
  return async function boardInSync() {
    for (let i = 0; ; i++) {
      let server
      try { server = await readServer() } catch { server = null }
      if (!server) return { ok: true, unchecked: true }               // can't read: never block on a network blip
      const local = { epoch: localEpoch(), sig: boardSig(localLayout()?.widgets) }
      const sameLayout = server.epoch == null || server.epoch === local.epoch
      const sameBoard = server.sig === local.sig
      if (sameLayout && sameBoard) return { ok: true }
      if (!sameLayout) return { ok: false, reason: 'a different layout was opened in another window or device' }
      if (i >= tries) return { ok: false, reason: 'this board was changed in another window or device' }
      await sleep(settleMs)                                           // maybe just this tab's own pending save
    }
  }
}

const PREFS_URL = '/api/auth/preferences'
async function readServerBoard() {
  const r = await fetch(PREFS_URL, { credentials: 'include', cache: 'no-store' })
  if (!r.ok) return null
  const p = await r.json()
  let layout = null
  let active = null
  try { layout = typeof p.charts_workspace_layout === 'string' ? JSON.parse(p.charts_workspace_layout) : p.charts_workspace_layout } catch { /* unreadable → unchecked */ }
  try { active = typeof p.charts_active_template === 'string' ? JSON.parse(p.charts_active_template) : p.charts_active_template } catch { active = null }
  if (!layout || !Array.isArray(layout.widgets)) return null
  return { sig: boardSig(layout.widgets), epoch: active && active.id != null ? `${active.scope || 'user'}:${active.id}` : (p.charts_active_template === undefined ? null : 'unsaved') }
}

/**
 * The drawings on each SYMBOL a chart shows — the product's own drawing store (the array every
 * overlay on that symbol paints; persisted and synced like a manual edit). One entry per symbol:
 * every chart on NVDA shares NVDA's drawings. Writers are the store's own, by drawing id.
 */
export function buildDrawingSource(charts, store = drawingsStore) {
  const entries = () => {
    const by = new Map()
    for (const c of charts.list()) {
      const sym = c.drawSym || c.symbol
      if (!sym) continue
      const e = by.get(sym) || { ref: sym, symbol: sym, charts: [], defaults: null }
      e.charts.push(c.label)
      // the chart's own "drawing defaults" (Chart Settings → Drawings), as the context menu uses them
      if (!e.defaults) { const dd = c.cs?.drawingDefaults || {}; e.defaults = { color: dd.color || null, width: dd.width || null } }
      by.set(sym, e)
    }
    // `board`: the ACTIVE Drawing Board (tracing). The store holds only the active board's
    // drawings, so a board switch changes what an id means — it is part of every staleness check.
    const board = typeof store.getActiveTracingId === 'function' ? store.getActiveTracingId() : null
    return [...by.values()].map(e => ({ ...e, label: `Drawings on ${e.symbol}`, board, drawings: store.peekDrawings(e.symbol) }))
  }
  return {
    list: entries,
    read: (ref) => entries().find(e => e.ref === ref) || null,
    add: (sym, d) => store.addDrawing(sym, d),
    update: (sym, id, u) => store.updateDrawing(sym, id, u),
    remove: (sym, id) => store.removeDrawing(sym, id),
    // AUTHORITATIVE READ-BACK: the drawings reach the member's account only through the tracings
    // sync (useTracingsSync: a 1.5 s debounced push of exportTracings() into the tracings_doc
    // preference). Poll the SERVER's copy until this board's drawings for this symbol equal the
    // local ones. { ok } — or { ok:false, reason:'not-synced' } when the push is not seen in time
    // (a closed tab, a sync that is down): the receipt then says so instead of claiming it.
    confirm: (sym, opts) => confirmDrawingsSynced(sym, store, opts),
  }
}

const drawingSig = (list) => JSON.stringify((Array.isArray(list) ? list : []).map(d => [
  d.id, d.type, d.points, d.color ?? null, d.lineStyle ?? null, d.lineWidth ?? null, !!d.locked, !!d.hidden,
]))

export async function confirmDrawingsSynced(sym, store = drawingsStore, { timeoutMs = 8000, everyMs = 500, fetchFn = (u, o) => fetch(u, o) } = {}) {
  const board = typeof store.getActiveTracingId === 'function' ? store.getActiveTracingId() : null
  const want = drawingSig(store.peekDrawings(sym))
  const t0 = Date.now()
  while (Date.now() - t0 <= timeoutMs) {
    try {
      const r = await fetchFn('/api/auth/preferences', { credentials: 'include', cache: 'no-store' })
      if (r.ok) {
        const prefs = await r.json()
        // the sync's own envelope (useTracingsSync: setPref('tracings_doc', { updatedAt, doc })),
        // parsed the way parsePref does (a JSON string, or an already-parsed object)
        const raw = prefs?.tracings_doc
        const env = typeof raw === 'string' ? JSON.parse(raw) : raw
        const doc = env?.doc ?? null
        const onServer = doc?.byTracing?.[board ?? doc?.activeId]?.[sym]
        if (drawingSig(onServer) === want) return { ok: true }
      }
    } catch { /* keep polling until the deadline */ }
    await new Promise(res => setTimeout(res, everyMs))
  }
  return { ok: false, reason: 'not-synced' }
}

export function buildWorkspaceHost({ chartApiById, getWidgets, widgetLabel, widgetOps, layouts, watchlists, prefs, navigate, readServer = readServerBoard }) {
  const layoutSource = layouts ? buildLayoutSource(layouts) : null
  const epoch = layoutSource ? () => {
    const a = layoutSource.snapshot().active
    return a ? `${a.scope}:${a.id}` : 'unsaved'
  } : null
  return {
    ...(watchlists ? { watchlists: buildWatchlistSource({ ...watchlists, getWidgets }) } : {}),
    charts: buildChartSource({ chartApiById, getWidgets }),
    drawings: buildDrawingSource(buildChartSource({ chartApiById, getWidgets })),
    ...(widgetOps ? { widgets: buildWidgetSource({ widgetOps, getWidgets }) } : {}),
    ...(layoutSource ? {
      layouts: layoutSource,
      // WHICH board this is: the open layout's identity. A plan proposed on one board
      // must never be applied to another, and an undo never reaches across a switch.
      epoch,
    } : {}),
    ...(widgetOps && epoch ? { boardInSync: buildBoardSync({ readServer, localLayout: () => widgetOps.layout(), localEpoch: epoch }) } : {}),
    // The board's persistence acknowledgment (ChartsWorkspace `persist`): resolves once the
    // server has accepted — or refused — this tab's current board. → { ok, conflict, reason }
    ...(widgetOps?.persist ? { persist: () => widgetOps.persist() } : {}),
    otherWidgets: () => (getWidgets() || []).filter(w => w.type !== 'chart').map(w => widgetLabel(w.type)),
    // The member's own preferences, through the Settings page's writer: read() → the
    // current values; write(key, value) → true only once the server accepted it.
    ...(prefs ? { prefs } : {}),
    // The router's navigate() (an allow-listed path from capabilities/app.js only).
    ...(navigate ? { navigate } : {}),
  }
}
