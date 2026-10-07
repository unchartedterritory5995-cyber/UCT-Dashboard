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

const refOf = (r) => (r.tabId ? `${r.chartId}~${r.tabId}` : r.chartId)

function positionWord(w, all) {
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
      }
    },
    add: (type, place) => widgetOps.add(type, place),
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
    refresh: () => getLayouts()?.refresh?.(),
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
  let swrAt = 0
  let lastRows = null
  const slimItems = (row) => (row?.items || []).filter(i => i && i.sym).map(i => ({ id: String(i.id), sym: String(i.sym).toUpperCase(), notes: i.notes || '' }))
  const editableWhy = (row) => (row.origin?.mode === 'link' ? 'it is linked to its source list (save a copy to edit it)' : null)
  function rows() {
    const r = getLists() || []
    if (r !== lastRows) { lastRows = r; swrAt = Date.now() }
    const byId = new Map(r.filter(x => x && x.id && !x.is_flagged_list && !x.is_prebuilt).map(x => [String(x.id), x]))
    for (const [id, f] of fresh) if (f.at >= swrAt) byId.set(id, f.row)
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

export function buildWorkspaceHost({ chartApiById, getWidgets, widgetLabel, widgetOps, layouts, watchlists }) {
  const layoutSource = layouts ? buildLayoutSource(layouts) : null
  return {
    ...(watchlists ? { watchlists: buildWatchlistSource({ ...watchlists, getWidgets }) } : {}),
    charts: buildChartSource({ chartApiById, getWidgets }),
    ...(widgetOps ? { widgets: buildWidgetSource({ widgetOps, getWidgets }) } : {}),
    ...(layoutSource ? {
      layouts: layoutSource,
      // WHICH board this is: the open layout's identity. A plan proposed on one board
      // must never be applied to another, and an undo never reaches across a switch.
      epoch: () => {
        const a = layoutSource.snapshot().active
        return a ? `${a.scope}:${a.id}` : 'unsaved'
      },
    } : {}),
    otherWidgets: () => (getWidgets() || []).filter(w => w.type !== 'chart').map(w => widgetLabel(w.type)),
  }
}
