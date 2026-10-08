// ── WORKSPACE capabilities: widgets on the Charts board ─────────────────────
//
// Registered through the same public seam as charts (agent/capabilities.js).
// Nothing in the orchestrator, planner, runtime or server names a widget.
//
//   target kind 'workspace'  one target — the visible board. Commits go through
//                            ChartsWorkspace's OWN handlers (handleAddWidget /
//                            handleColorChange / handleRemoveWidget), reached via
//                            host.widgets.
//   context 'workspace'      widget count / limit and the visible widget types
//   widget.add               adds widgets into EMPTY space only (never resizes or
//                            moves anything the member didn't mention). Several
//                            per request are allowed when the WHOLE sequence fits
//                            — checked by simulating the product's own
//                            planPlacement before the first write. `as` names a
//                            new widget so later ops in the same request can
//                            configure it (transaction-local; resolved to the real
//                            widget id at commit, never persisted).
//
//   widget.addCharts         one chart PER SYMBOL of an ordered list — literal
//                            tickers, or a typed reference to a screen's results /
//                            a saved watchlist ({from, top}, compose.js). It is a
//                            MACRO, not a second builder: once its symbols are
//                            concrete it EXPANDS into widget.add + chart.setSymbol
//                            (+ setTimeframe / setType) per symbol, so placement
//                            (planGroupPlacement), unlinking, compensation and
//                            Undo are exactly those of "add 4 charts on …".
//
// ⛔ widget.remove is deliberately NOT here: undoing an arbitrary removal needs an
// exact-restore writer the product does not have. Undoing a widget THIS AGENT
// just created only needs to close that exact id — which is all this uses.

import { registerCapability, registerTargetKind, registerContextProvider, isRef, SYMBOLS } from '../capabilities'
import { WORKSPACE_MENU_TYPES, labelMap } from '../../widgets/registry'
import { mark } from '../trace'
import { afterRender } from '../frames'

const LABEL = labelMap('menu')
const label = (t) => LABEL[t] || t
const plural = (t, n) => (n === 1 ? `a ${label(t)}` : `${n} ${label(t)}s`)
// Widget types whose new instances can be configured in the same request.
const CONFIGURABLE_KIND = { chart: 'chart' }

// widget.addCharts: at most this many charts from one request.
export const MAX_CHARTS_PER_REQUEST = 12
const TF_ENUM = ['1', '5', '15', '30', '60', 'D', 'W', 'M']
const TF_ADJ = { 1: '1-minute', 5: '5-minute', 15: '15-minute', 30: '30-minute', 60: '1-hour', D: 'daily', W: 'weekly', M: 'monthly' }
const TYPE_ENUM = ['candles', 'hollow', 'bars', 'hlc', 'line', 'area']
const TYPE_WORD = { candles: 'candles', hollow: 'hollow candles', bars: 'bars', hlc: 'HLC bars', line: 'line', area: 'area' }
const TICKER = /^[A-Z0-9.$:^_\-/]{1,24}$/
const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const chartsPhrase = (n, tf, type) => {
  const adj = tf ? `${TF_ADJ[tf]} ` : ''
  return `${n === 1 ? `a ${adj}chart` : `${n} ${adj}charts`}${type ? ` (${TYPE_WORD[type]})` : ''}`
}
// Room for `n` more charts beside what this plan already creates? → sentence | null
function chartRoomProblem(st, snap, n) {
  if (!snap) return 'The workspace is not available.'
  const total = st.creates.length + n
  if (snap.count + total > snap.max) {
    const free = Math.max(0, snap.max - snap.count - st.creates.length)
    return `That needs ${n} new chart${n === 1 ? '' : 's'}, but the workspace has room for ${free} more widget${free === 1 ? '' : 's'} (it holds ${snap.max}). Close some first, or ask for fewer.`
  }
  if (!snap.fitsSequence([...st.creates.map(c => c.type), ...Array(n).fill('chart')])) {
    const room = snap.capacity('chart', n)
    return `There isn't enough open space for ${n} charts without rearranging your current workspace (room for ${room} more chart${room === 1 ? '' : 's'}). Close or shrink some widgets, or ask for fewer.`
  }
  return null
}

// Wait for React to commit (never for a paint: a hidden tab never paints) — see agent/frames.js.
const nextFrame = afterRender

const createdIds = (item) => {
  const before = new Set(item.patch?.beforeIds || item.before?.widgets?.map(w => w.id) || [])
  return (item.after?.widgets || []).filter(w => !before.has(w.id)).map(w => w.id)
}

export const workspaceKind = {
  name: 'workspace',
  list: (host) => (host?.widgets ? [host.widgets.snapshot()] : []),
  read: (host, ref) => (host?.widgets && ref === 'workspace' ? host.widgets.snapshot() : null),
  stateOf: (snap) => ({ creates: [], ids: snap.widgets.map(w => w.id) }),
  patch: (before, after) => (after.creates.length ? { add: after.creates, beforeIds: before.ids } : null),
  // ONE widget at a time through handleAddWidget, each confirmed on the board
  // before the next (its id is minted from Date.now(), and its no-room precheck
  // reads the board — both need the previous add to have landed).
  async commit(host, ref, patch) {
    if (patch.remove) {
      for (const id of patch.remove) host.widgets.remove(id)
      return true
    }
    const created = {}
    const born = {}                     // alias → { symbol, tf } for widgets born complete
    // Several of ONE type: plan them as a group (equal cells in one empty region,
    // via the product's planGroupPlacement) once, from the board as it is now. No
    // group region → null → each add uses the product's normal placement.
    const same = patch.add.length > 1 && patch.add.every(c => c.type === patch.add[0].type)
    const cells = same ? host.widgets.snapshot().groupPlan?.(patch.add[0].type, patch.add.length) : null
    for (let i = 0; i < patch.add.length; i++) {
      const c = patch.add[i]
      const known = new Set(host.widgets.snapshot().widgets.map(w => w.id))
      // Born on its ticker/timeframe when known (no default symbol loads first).
      const init = c.flags?.unlink && c.flags.init?.symbol ? c.flags.init : null
      host.widgets.add(c.type, cells?.[i] || null, init)
      let fresh = null
      const t0 = Date.now()
      while (!fresh && Date.now() - t0 < 5000) {
        await nextFrame()
        fresh = host.widgets.snapshot().widgets.find(w => !known.has(w.id) && w.type === c.type) || null
      }
      mark('widget:added', i)
      if (!fresh) { host.widgets.cancelPending?.(); break }
      // A new chart that gets its OWN symbol must not share the link group the
      // product assigns by default — that would retarget the member's existing
      // linked widgets. Unlink it the way the member would (the color dot → N).
      if (c.flags?.unlink && fresh.color !== 'N') { host.widgets.color(fresh.id, 'N'); await nextFrame(); mark('widget:unlinked', i) }
      created[c.alias || `#${i}`] = fresh.id
      if (init && c.flags?.complete && c.alias) born[c.alias] = init
    }
    return { created, born }
  },
  landed(snap, patch) {
    if (!snap) return false
    if (patch.remove) return patch.remove.every(id => !snap.widgets.some(w => w.id === id))
    const fresh = snap.widgets.filter(w => !patch.beforeIds.includes(w.id)).map(w => w.type).sort()
    return JSON.stringify(fresh) === JSON.stringify(patch.add.map(c => c.type).sort())
  },
  // Undo closes exactly the widget(s) this turn created, via the manual ✕ path.
  undoPatch: (item) => ({ remove: createdIds(item) }),
  fingerprint: (snap) => JSON.stringify(snap.widgets.map(w => [w.id, w.type, w.x, w.y, w.w, w.h]).sort()),
  // Stale-undo is about what THIS transaction created: its widgets' geometry,
  // link color and settings, and (for charts) their symbol. A member moving some
  // OTHER widget afterwards does not block undoing the Agent's widgets.
  fingerprintFor(host, snap, item) {
    const ids = createdIds(item)
    return JSON.stringify(ids.map(id => {
      const w = snap.widgets.find(x => x.id === id)
      // The ticker as the workspace holds it (same value a mounted chart shows), so a
      // chart that mounts after this fingerprint was taken never reads as edited.
      const sym = host?.widgets?.configOf?.(id)?.symbol ?? host?.charts?.read(id)?.symbol ?? null
      return w ? [w.id, w.x, w.y, w.w, w.h, w.color, w.optsSig, sym] : [id, 'gone']
    }))
  },
}

let registered = false
export function registerWorkspaceCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(workspaceKind)
  registerContextProvider({
    key: 'workspace',
    // A one-item LIST so the workspace gets a minted short ref like every target.
    build: (host, refFor) => {
      if (!host?.widgets) return undefined
      const s = host.widgets.snapshot()
      return [{
        ref: refFor('workspace', 'workspace'), label: 'Workspace',
        widgetCount: s.count, widgetLimit: s.max,
        // How many of a type would still land in empty space (product placement rules).
        openSlots: { chart: s.capacity('chart', s.max - s.count) },
        visibleWidgets: s.visible.map(w => ({ type: w.type, label: label(w.type), position: w.position || null })),
      }]
    },
  })
  registerCapability({
    name: 'widget.add',
    target: 'workspace',
    createsResource: true,
    surfaces: ['charts'],
    available: (ctx) => ctx.surface === 'charts',
    summary: 'Add ONE widget of a given type to the Charts workspace, placed automatically in empty space. Use one op per widget.',
    // ⚠️ The "as" rule comes FIRST, ahead of the long type list: with it at the
    // end, the production model (measured 2026-10-07, 4/4) targeted new1… but
    // left every "as" null, so the plan was refused as naming unknown targets.
    hints: 'target = the ref of the workspace entry. "as" NAMES THE NEW WIDGET: if any later op in this plan changes the new widget '
      + '(a new chart\'s symbol, timeframe, …), set "as" to a short unique name (new1, new2, …) and use exactly that name as those ops\' target '
      + '— a later op may not target a new widget whose "as" is null. Otherwise "as" is null. '
      + 'Example: "add 2 charts on SPY and QQQ" → widget.add{type:chart, as:"new1"}, widget.add{type:chart, as:"new2"}, chart.setSymbol@new1{SPY}, chart.setSymbol@new2{QQQ}. '
      + `Types: ${WORKSPACE_MENU_TYPES.map(t => `${t} (${label(t)})`).join(', ')}.`,
    args: {
      type: 'object',
      properties: { type: { type: 'string', enum: [...WORKSPACE_MENU_TYPES] }, as: { type: ['string', 'null'] } },
      required: ['type', 'as'], additionalProperties: false,
    },
    creates: (args) => (args.as && CONFIGURABLE_KIND[args.type] ? { kind: CONFIGURABLE_KIND[args.type], alias: String(args.as), spec: { type: args.type } } : null),
    fast: ({ lower }) => {
      const m = /^add (?:a |an |another |one more |a new |new )?(.+?)(?: widget)?$/.exec(lower)
      if (!m) return null
      const want = m[1].trim()
      const hit = WORKSPACE_MENU_TYPES.find(t => t === want || label(t).toLowerCase() === want
        || `${label(t).toLowerCase()}s` === want)
      return hit ? { type: hit, as: null } : null
    },
    check(st, { type, as }, env) {
      const snap = env?.target
      if (!WORKSPACE_MENU_TYPES.includes(type)) return `“${type}” isn't a widget you can add.`
      if (as != null && !/^[A-Za-z][A-Za-z0-9_-]{0,23}$/.test(String(as))) return `“${as}” isn't a usable name for a new widget.`
      if (!snap) return 'The workspace is not available.'
      const n = st.creates.length + 1
      if (snap.count + n > snap.max) {
        return `That would take the workspace to ${snap.count + n} widgets — it holds ${snap.max}. Close some first.`
      }
      const seq = [...st.creates.map(c => c.type), type]
      if (!snap.fitsSequence(seq)) {
        const total = Math.max(env?.resourcesInPlan || 1, n)
        return total === 1
          ? `There's no empty space for a ${label(type)} without resizing other widgets. Use Widgets ▾ → ${label(type)} — it shows where it will go before placing it.`
          : `There isn't enough open space to add ${total} widgets without rearranging your current workspace (room for ${snap.capacity(type, total)} more ${label(type)}${snap.capacity(type, total) === 1 ? '' : 's'}).`
      }
      return null
    },
    apply: (st, { type, as }) => ({ ...st, creates: [...st.creates, { type, alias: as ?? null, flags: {} }] }),
    describe(b, a) {
      if (a.creates.length <= b.creates.length) return null
      const counts = {}
      for (const c of a.creates) counts[c.type] = (counts[c.type] || 0) + 1
      const unlinked = a.creates.some(c => c.flags?.unlink)
      return `Added ${Object.entries(counts).map(([t, n]) => plural(t, n)).join(' and ')}${unlinked ? ' (not linked — each keeps its own symbol)' : ''}`
    },
  })

  registerCapability({
    name: 'widget.addCharts',
    target: 'workspace',
    surfaces: ['charts'],
    available: (ctx) => ctx.surface === 'charts',
    summary: 'Add one NEW chart per symbol of an ordered list (tickers, a screen\'s results, or a saved watchlist), placed together in empty space. Existing widgets are never changed.',
    hints: 'target = the ref of the workspace entry. symbols = the tickers, uppercase, OR {from, top} to chart a source\'s stocks in its order: '
      + 'from = the ref of a saved watchlist (its stocks, read fresh in its saved order when they apply), the "as" of a screener.run / screener.runSaved op in this request, '
      + 'or "lastScreen" for the last screen run here; '
      + `top = how many charts (required, at most ${MAX_CHARTS_PER_REQUEST}). timeframe: 1|5|15|30|60 minutes, D, W, M, or null to keep the default. `
      + 'chart_type: candles|hollow|bars|hlc|line|area or null. exact: true only if they insist on exactly that many (else fewer results just make fewer charts). '
      + 'Use this — not widget.add + chart.setSymbol — whenever the charts\' symbols come from a screen or watchlist. Never type tickers you have not been given.',
    args: {
      type: 'object',
      properties: {
        symbols: { anyOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'object', properties: { from: { type: 'string' }, top: { type: ['integer', 'null'] } }, required: ['from', 'top'], additionalProperties: false },
        ] },
        timeframe: { type: ['string', 'null'], enum: [...TF_ENUM, null] },
        chart_type: { type: ['string', 'null'], enum: [...TYPE_ENUM, null] },
        exact: { type: ['boolean', 'null'] },
      },
      required: ['symbols', 'timeframe', 'chart_type', 'exact'], additionalProperties: false,
    },
    inputs: { symbols: SYMBOLS },
    // Only ever PLANNED while its symbols are a pending reference (literal tickers
    // are expanded before planning). The check is the capacity gate the member sees
    // in the proposal; it runs again on the expanded ops before the first write.
    check(st, { symbols, timeframe, chart_type: type }, env) {
      if (timeframe != null && !TF_ENUM.includes(timeframe)) return `“${timeframe}” is not a timeframe UCT charts.`
      if (type != null && !TYPE_ENUM.includes(type)) return `“${type}” is not a chart type UCT has.`
      const n = isRef(symbols) ? symbols.top : (Array.isArray(symbols) ? symbols.length : 0)
      if (isRef(symbols) && n == null) return `Say how many charts to make (up to ${MAX_CHARTS_PER_REQUEST}).`
      if (!n) return 'Which tickers?'
      if (n > MAX_CHARTS_PER_REQUEST) return `That's more than ${MAX_CHARTS_PER_REQUEST} charts at once — ask for fewer.`
      return chartRoomProblem(st, env?.target, n)
    },
    confirmIf: () => true,
    // Pending: nothing exists yet, so nothing is created in the plan's state —
    // the line below is what the member approves.
    apply: (st, args) => ({ ...st, pendingCharts: [...(st.pendingCharts || []), args] }),
    describe(b, a) {
      const added = (a.pendingCharts || []).slice((b.pendingCharts || []).length)
      if (!added.length) return null
      const { symbols, timeframe, chart_type: type, exact } = added[0]
      const n = isRef(symbols) ? symbols.top : symbols.length
      return `Create ${exact ? 'exactly ' : 'up to '}${chartsPhrase(n, timeframe, type)}, one per stock in its order — each on its own symbol, not linked; nothing existing moves`
    },
    expand(args, { key, asked }) {
      const { timeframe = null, chart_type: type = null, exact = false } = args
      if (!Array.isArray(args.symbols)) return { error: '“symbols” has the wrong kind of value' }
      const syms = [...new Set(args.symbols.map(s => String(s || '').trim().toUpperCase()).filter(Boolean))]
      if (!syms.length) return { error: 'there were no tickers to chart' }
      const odd = syms.find(s => !TICKER.test(s))
      if (odd) return { error: `“${odd}” doesn't look like a ticker` }
      if (syms.length > MAX_CHARTS_PER_REQUEST) return { error: `that's more than ${MAX_CHARTS_PER_REQUEST} charts at once — ask for fewer` }
      const want = asked?.symbols
      if (exact && want != null && syms.length < want) {
        return { error: `only ${syms.length} stock${syms.length === 1 ? '' : 's'} came back and you asked for exactly ${want}, so I didn't create any charts` }
      }
      const ops = []
      const alias = (i) => `ac${key}x${i + 1}`
      syms.forEach((_, i) => ops.push({ action: 'widget.add', target: 'workspace', args: { type: 'chart', as: alias(i) } }))
      syms.forEach((s, i) => ops.push({ action: 'chart.setSymbol', target: alias(i), args: { symbol: s } }))
      if (timeframe) syms.forEach((_, i) => ops.push({ action: 'chart.setTimeframe', target: alias(i), args: { timeframe } }))
      if (type) syms.forEach((_, i) => ops.push({ action: 'chart.setType', target: alias(i), args: { type } }))
      const what = chartsPhrase(syms.length, timeframe, type)
      return {
        ops,
        proposal: `Create ${what}: ${andList(syms)} — each on its own symbol, not linked; nothing existing moves`,
        line: `Created ${what}: ${andList(syms)}`,
      }
    },
  })
}
