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
// widget.remove lives with the board's other writes (capabilities/board.js), whose Undo restores
// the removed widget exactly. Undoing a widget THIS file created only closes that exact id.

import { registerCapability, registerTargetKind, registerContextProvider, isRef, SYMBOLS } from '../capabilities'
import { WORKSPACE_MENU_TYPES, labelMap } from '../../widgets/registry'
import { mark } from '../trace'
import { afterRender } from '../frames'
import { CHART_TIMEFRAMES, CHART_TYPE_IDS } from './chart'
import { isPronounToken, isReservedWord } from '../nl/tickers'
import { boardRefusalSentence } from '../../pages/charts/boardBound'

const LABEL = labelMap('agent')
const label = (t) => LABEL[t] || t
const plural = (t, n) => (n === 1 ? `a ${label(t)}` : `${n} ${label(t)}s`)
// Widget types whose new instances can be configured in the same request.
const CONFIGURABLE_KIND = { chart: 'chart' }

// widget.addCharts: at most this many charts from one request.
export const MAX_CHARTS_PER_REQUEST = 12
// The product's lists, through chart.js (one import path; never a second copy).
const TF_ENUM = CHART_TIMEFRAMES
const TF_ADJ = { 1: '1-minute', 5: '5-minute', 15: '15-minute', 30: '30-minute', 60: '1-hour', D: 'daily', W: 'weekly', M: 'monthly' }
const TYPE_ENUM = CHART_TYPE_IDS
const TYPE_WORD = { candles: 'candles', hollow: 'hollow candles', bars: 'bars', hlc: 'HLC bars', line: 'line', area: 'area' }
const TICKER = /^[A-Z0-9.$:^_\-/]{1,24}$/
// ⛔ S6 F4 — "Open a QQQ chart": a NEW chart the member gave a ticker is BORN on it, not linked
// (widget.addCharts → handleAddWidget's unlinkedSymbol). A plain widget.add would join link group A
// (the workspace's default for new widgets) and show A's ticker, and the follow-up "change it to
// QQQ" would then change group A's symbol for every widget that follows A. The ticker must be
// written in capitals (as the member typed it), so ordinary words never read as tickers.
// W1.1 R-02 (LT-1, live 2026-11-03 "add a daily chart of nvda to this board"): a timeframe word before "chart" and "to this
// board / workspace / layout" after the ticker are part of the same request (the ticker rule — capitals — is unchanged).
const TF_WORD = '(?:(daily|weekly|monthly|hourly|\\d{1,3}[ -]?(?:minute|minutes|min|mins|m)|\\d{1,2}[ -]?(?:hour|hours|hr|hrs|h))\\s+)?'
const BOARD_TAIL = '(?:\\s+(?:to|on|in|onto)\\s+(?:this|the|my)\\s+(?:board|workspace|layout))?(?:\\s+here)?'
const NEW_CHART_TICKER = new RegExp(`^(?:please\\s+)?(?:open|add|create|make|start|pull up|bring up|give me)(?:\\s+me)?\\s+(?:(?:a|an|another|one more)\\s+)?(?:new\\s+)?(?:${TF_WORD}(?:chart|graph)\\s+(?:of|for|on|with)\\s+\\$?([A-Za-z][A-Za-z0-9.]{0,9})|${TF_WORD}\\$?([A-Za-z][A-Za-z0-9.]{0,9})\\s+(?:chart|graph))${BOARD_TAIL}\\s*(?:,?\\s*please)?[.!]?$`, 'i')
const TF_OF_WORD = (w) => {
  if (!w) return null
  const s = String(w).toLowerCase().replace(/[ -]+/g, '')
  if (s === 'daily') return 'D'
  if (s === 'weekly') return 'W'
  if (s === 'monthly') return 'M'
  if (s === 'hourly') return '60'
  const m = /^(\d+)(minutes?|mins?|m|hours?|hrs?|h)$/.exec(s)
  if (!m) return undefined
  const n = Number(m[1]) * (/^h/.test(m[2]) ? 60 : 1)
  return TF_ENUM.includes(String(n)) ? String(n) : undefined       // a non-native interval → the model (custom timeframes)
}
// (2026-10-13) "Open NASDAQ:A50 in a new chart" — a series or ticker, then an explicit NEW / separate chart.
// The symbol is written in capitals and may carry a breadth series' colon (US:A50, NYSE:A200).
const IN_NEW_CHART = /^(?:please\s+)?(?:open|add|put|show|load|chart|pull up|bring up)\s+\$?([A-Z][A-Z0-9.]{0,9}(?::[A-Z0-9]{1,8})?)\s+(?:in|on|as|into)\s+(?:a|an|another|one more)\s+(?:new|separate|second|additional|fresh)\s+(?:chart|graph|chart widget)\s*(?:,?\s*please)?[.!]?$/i
/** The ticker of a "new <TICKER> chart" request, or null. */
export function newChartTicker(raw) {
  return newChartRequest(raw)?.symbol || null
}
/** W1.1 R-02: the ticker AND the timeframe word of a "new <tf> <TICKER> chart" request: { symbol, timeframe } (timeframe
 *  null when none was said), or null. A timeframe word UCT does not chart natively ("2 hour") returns null (the model's). */
export function newChartRequest(raw) {
  const m = NEW_CHART_TICKER.exec(String(raw || '').trim())
  const w = m ? null : IN_NEW_CHART.exec(String(raw || '').trim())
  if (w) return /^[A-Z][A-Z0-9.]{0,9}(?::[A-Z0-9]{1,8})?$/.test(w[1]) && !isPronounToken(w[1], raw) && !isReservedWord(String(raw).includes(`$${w[1]}`) ? `$${w[1]}` : w[1]) ? { symbol: w[1], timeframe: null } : null
  const t = m ? (m[2] || m[4]) : null
  // ⛔ a pronoun is never a ticker — "OPEN A CHART OF IT" typed in capitals is still "it"
  const typed = t && String(raw).includes(`$${t}`) ? `$${t}` : t       // "$IT" is explicitly a ticker
  if (!(t && /^[A-Z][A-Z0-9.]{0,9}$/.test(t) && !/^(?:A|AN|NEW|MY|THE)$/.test(t) && !isPronounToken(typed, raw) && !isReservedWord(typed))) return null
  const timeframe = TF_OF_WORD(m[1] || m[3])
  return timeframe === undefined ? null : { symbol: t, timeframe }
}
/** W1.1 R-02 (LT-1, model path): on a board with NO chart the planner put chart ops (symbol / timeframe / type) on a target that
 *  is not a chart — the live planner used the workspace entry — and the browser refused "That target is not on the workspace".
 *  Read as what the words meant: ONE new chart born on that symbol (widget.addCharts). Anything else is left exactly as planned. */
const EMPTY_BOARD_OPS = new Set(['chart.setSymbol', 'chart.setTimeframe', 'chart.setType'])
export function screenEmptyBoardChart(ops, host) {
  const charts = (() => { try { return host?.charts?.list?.() || [] } catch { return [] } })()
  if (charts.length || !Array.isArray(ops) || !ops.length || ops.length > 3) return { ops, corrected: false }
  if (!ops.every(o => EMPTY_BOARD_OPS.has(o?.action))) return { ops, corrected: false }
  if (new Set(ops.map(o => o?.target)).size !== 1) return { ops, corrected: false }
  const sym = String(ops.find(o => o.action === 'chart.setSymbol')?.args?.symbol || '').trim().toUpperCase()
  if (!sym || !TICKER.test(sym)) return { ops, corrected: false }
  const timeframe = ops.find(o => o.action === 'chart.setTimeframe')?.args?.timeframe ?? null
  const type = ops.find(o => o.action === 'chart.setType')?.args?.type ?? null
  if ((timeframe != null && !TF_ENUM.includes(timeframe)) || (type != null && !TYPE_ENUM.includes(type))) return { ops, corrected: false }
  return { ops: [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: [sym], timeframe, chart_type: type, exact: null } }], corrected: true }
}
/** F4 (model path): a plan that adds ONE chart for a named ticker but drops the ticker is corrected to
 *  the born-on-its-ticker form. Anything else is left exactly as planned. */
export function screenNewChart(ops, text) {
  const t = newChartTicker(text)
  if (!t || !Array.isArray(ops)) return { ops, corrected: false }
  const adds = ops.filter(o => o?.action === 'widget.add' && o.args?.type === 'chart')
  if (adds.length !== 1 || ops.length !== 1) return { ops, corrected: false }
  return { ops: [{ action: 'widget.addCharts', target: adds[0].target, args: { symbols: [t], timeframe: null, chart_type: null, exact: null } }], corrected: true }
}
const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const chartsPhrase = (n, tf, type) => {
  const adj = tf ? `${TF_ADJ[tf] || tf} ` : ''
  return `${n === 1 ? `a ${adj}chart` : `${n} ${adj}charts`}${type ? ` (${TYPE_WORD[type] || type})` : ''}`
}
// Room for `n` more charts beside what this plan already creates? → sentence | null
function chartRoomProblem(st, snap, n) {
  if (!snap) return 'The workspace is not available.'
  const total = st.creates.length + n
  if (snap.count + total > snap.max) {
    return boardRefusalSentence(snap.count + total)
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
  source: 'widgets',             // fix-nothing-on-workspace: the host source this kind reads (capabilities.noTargetSentence)
  unavailable: "Board widgets aren't available on this page — open the Charts board to change its widgets.",
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
      const cfg = host?.widgets?.configOf?.(id) || null
      const sym = cfg?.symbol ?? host?.charts?.read(id)?.symbol ?? null
      // NLM1-G1: the timeframe compared as the workspace means it (an absent tf IS 'D' — configOf), never as stored: the
      // exact Undo of a timeframe change writes 'D' back where nothing was, and that is no later edit. Everything else
      // in the opts is still compared (optsSignature: null-valued keys are absent)
      // ONLY a chart widget's main timeframe: ChartWidget loads `opts.tf || 'D'`, so an absent tf and 'D' are the SAME chart
      // (a true no-op equivalence); any other value — and every other key, and every other widget type — is compared as stored
      const opts = w && w.type === 'chart' && cfg && w.optsSigNoTf != null ? `${w.optsSigNoTf}|tf:${cfg.tf || 'D'}` : w?.optsSig
      return w ? [w.id, w.x, w.y, w.w, w.h, w.color, opts, sym] : [id, 'gone']
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
      + 'Never drop a ticker the member named ("open a QQQ chart" needs its chart.setSymbol). '
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
        return boardRefusalSentence(snap.count + n)
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
    // W1.1 R-01 (LT-3, live "open the top two from <list> … with the 9 and 20 ema" refused as off-schema): the keys and words
    // the planner uses for this op's args. Extra keys (indicators, a row) still refuse — `shape` tells the model they do not exist here.
    argAliases: {
      symbols: ['tickers', 'symbol', 'ticker', 'stocks', 'list'],
      // ("from" / "top" at the top level: the reference written flat, as watchlist.add's 2026-10-08 production shape was)
      'symbols.from': ['symbols.list', 'symbols.watchlist', 'symbols.source', 'symbols.ref', 'symbols.screen', 'symbols.of', 'from', 'source', 'watchlist'],
      'symbols.top': ['symbols.count', 'symbols.n', 'symbols.limit', 'symbols.first', 'symbols.take', 'top', 'count', 'limit'],
      timeframe: ['tf', 'interval', 'period', 'time_frame', 'timeFrame'],
      chart_type: ['type', 'chartType', 'style', 'chart_style'],
    },
    coerce: {
      timeframe: { daily: 'D', day: 'D', '1d': 'D', d1: 'D', '1day': 'D', weekly: 'W', week: 'W', '1w': 'W', monthly: 'M', month: 'M', '1mo': 'M', hourly: '60', hour: '60', '1h': '60', '60m': '60', '60min': '60', '1hr': '60', '5min': '5', '15min': '15', '30min': '30', '1min': '1', default: null, '': null },
      chart_type: { candle: 'candles', candlestick: 'candles', candlesticks: 'candles', 'hollow candles': 'hollow', bar: 'bars', ohlc: 'bars', 'line chart': 'line', default: null, '': null },
    },
    shape: '{"symbols":["NVDA"],"timeframe":"D","chart_type":null,"exact":null} or {"symbols":{"from":"<watchlist ref or screen as>","top":2},'
      + '"timeframe":null,"chart_type":null,"exact":null}; timeframe 1|5|15|30|60|D|W|M (D daily, W weekly, M monthly, 60 hourly). No other keys: '
      + 'indicators, a row or a position cannot be set here — plan the charts alone and say in `reply` that indicators can be added next. '
      + '⛔ With NO chart in <workspace_context>, "add / open / show a <timeframe> chart of <symbol>" is THIS op on the workspace entry — '
      + 'never chart.setSymbol / chart.setTimeframe on a chart that does not exist.',
    // F4: "Open a QQQ chart" → one new chart born on QQQ, not linked; W1.1 R-02: "add a daily NVDA chart to this board" → on the daily
    fast: ({ raw }) => {
      const r = newChartRequest(raw)
      return r ? { symbols: [r.symbol], timeframe: r.timeframe, chart_type: null, exact: null } : null
    },
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
