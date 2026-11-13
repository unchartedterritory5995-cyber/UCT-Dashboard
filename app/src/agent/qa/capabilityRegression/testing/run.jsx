// CAPABILITY REGRESSION (Mission 2) — replay one case (a corpus phrasing at level c, or a golden workflow) through
// the REAL panel and assert its STATE: the board, the charts' indicators, which canonical reads / writes ran, a
// receipt / proposal / refusal by its structure. Never an exact string of prose.
import { anyAverageOn } from '../../../../components/chart/averageVisibility'
import { mergeChartSettings } from '../../../../components/chart/chartDefaults'
import * as nativeRegistry from '../../../../components/chart/engine/nativeRegistry'
import { expect } from 'vitest'
import { waitFor, fireEvent, screen } from '@testing-library/react'
import { mountCase, faithful, boardState, chartsOf, refusals, receiptsNow, proposalsNow, nlm1Of } from './harness'
import { routedNames } from './route'
import { kindsFor } from './registry'
import * as drawingsStore from '../../../../components/chart/drawingsStore'
import { resolveLevels } from '../../../../components/chart/drawingFib'
import { loadIndicatorAlerts, _resetIndicatorAlertCache } from '../../../capabilities/indicatorAlerts'
import { _resetScreenerCache } from '../../../capabilities/screener'
import { looksLikeFormula } from '../../../capabilities/indicatorAuthoring'
import { listDrafts } from '../../../../components/chart/builder/agentAuthoring'
import { readFavoriteTools } from '../../../../components/chart/drawToolFavorites'

/** A hex colour's hue family (red / green / blue / yellow / …) — a colour word maps to a palette shade, never one exact hex. */
export function hueFamily(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return null
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max - min < 0.12) return 'grey'
  let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
  h = (h * 60 + 360) % 360
  return h < 20 || h >= 335 ? 'red' : h < 45 ? 'orange' : h < 70 ? 'yellow' : h < 165 ? 'green' : h < 260 ? 'blue' : 'purple'
}
const callLine = (c) => `${c[0]} ${c[1]}${c[2] ? ` ${JSON.stringify(c[2])}` : ''}`
const turnCount = (p) => p.st.calls.filter(c => c[1] === '/api/agent/turn').length

/** Check one step's expectations; throws (vitest expect) with the case label on the first one that does not hold. */
export function checkExpect(ctx, e, label) {
  const { board, h, p, start, before, since } = ctx
  const calls = p.st.calls.slice(since.calls).filter(c => c[1] !== '/api/agent/turn' && c[1] !== '/api/agent/record')
  if (e.modelTurns != null) expect(turnCount(p) - since.turns, `${label}: model turns`).toBeLessThanOrEqual(e.modelTurns)
  if (e.unchanged) expect(boardState(board), `${label}: the board is unchanged`).toBe(before)
  // NLM-1 step plans: what the panel SAID (a read-back line, a skipped step) — a structural phrase, matched case-insensitively
  for (const r of e.says || []) expect(String(p.transcript()), `${label}: the panel says /${r}/`).toMatch(new RegExp(r, 'i'))
  for (const r of e.saysNot || []) expect(String(p.transcript()), `${label}: the panel does not say /${r}/`).not.toMatch(new RegExp(r, 'i'))
  if (e.bySymbol) {
    // NLM-1: a chart found by the ONE symbol it shows (wherever a new chart was placed): its timeframe, and which indicator
    // kinds it carries (`has` / `hasNot`: defIds; `period`: a movingAverage of that length)
    for (const [sym, want] of Object.entries(e.bySymbol)) {
      const cs = chartsOf(board).filter(w => String(h.charts.read(w.id)?.symbol || '').toUpperCase() === sym)
      expect(cs.length, `${label}: exactly one ${sym} chart`).toBe(1)
      const c = h.charts.read(cs[0].id)
      const inst = p.instancesOn(board, cs[0].id)
      if (want.tf) expect(c?.tf, `${label}: the ${sym} chart's timeframe`).toBe(want.tf)
      for (const d of want.has || []) expect(inst.some(i => i.defId === d), `${label}: ${d} on the ${sym} chart`).toBe(true)
      for (const d of want.hasNot || []) expect(inst.some(i => i.defId === d), `${label}: no ${d} on the ${sym} chart`).toBe(false)
      for (const n of want.ma || []) expect(inst.some(i => i.defId === 'movingAverage' && i.inputs?.period === n), `${label}: MA ${n} on the ${sym} chart`).toBe(true)
      for (const n of want.noMa || []) expect(inst.some(i => i.defId === 'movingAverage' && i.inputs?.period === n), `${label}: no MA ${n} on the ${sym} chart`).toBe(false)
    }
  }
  if (e.restored) expect(boardState(board), `${label}: the board is back as it started`).toBe(start)
  // #1030: the Multi Chart grid's own state (the GRID board's host.gridControl), each named field exactly
  if (e.grid) for (const [k, want] of Object.entries(e.grid)) {
    const g = h.gridControl
    const now = k === 'maxId' ? g?.maxId() : k === 'settingsOpen' ? g?.settingsOpen() : k === 'cellCount' ? g?.state()?.cells?.length : g?.state()?.[k]
    expect(now, `${label}: the grid's ${k}`).toEqual(want)
  }
  if (e.charts) {
    const cs = chartsOf(board)
    if (e.charts.count != null) expect(cs.length, `${label}: chart count`).toBe(e.charts.count)
    const syms = cs.map(w => h.charts.read(w.id)?.symbol)
    if (e.charts.symbols) expect(syms, `${label}: chart symbols (board order)`).toEqual(e.charts.symbols)
    if (e.charts.symbolSet) expect([...syms].sort(), `${label}: chart symbols (any order)`).toEqual([...e.charts.symbolSet].sort())
    if (e.charts.keepsIds) for (const id of e.charts.keepsIds) expect(cs.map(w => w.id), `${label}: chart ${id} reused (kept)`).toContain(id)
    if (e.charts.sameSize) expect(new Set(cs.map(w => `${w.w}x${w.h}`)).size, `${label}: all charts the same size`).toBe(1)
    if (e.charts.tf) expect(cs.map(w => h.charts.read(w.id)?.tf), `${label}: every chart's timeframe`).toEqual(cs.map(() => e.charts.tf))
    if (e.charts.tfs) expect(cs.map(w => h.charts.read(w.id)?.tf), `${label}: the charts' timeframes`).toEqual(e.charts.tfs)
    if (e.charts.types) expect(cs.map(w => h.charts.read(w.id)?.cs?.chartType ?? null), `${label}: chart types`).toEqual(e.charts.types)
  }
  if (e.setting) {
    const id = chartsOf(board)[e.setting.chart || 0]?.id
    const v = e.setting.key.split('.').reduce((a, k) => a?.[k], h.charts.read(id)?.cs)      // a dotted path ("candles.upColor")
    if ('value' in e.setting) expect(v, `${label}: chart setting ${e.setting.key}`).toEqual(e.setting.value)
    if (e.setting.colour) expect(hueFamily(v), `${label}: chart setting ${e.setting.key} is ${e.setting.colour}`).toBe(e.setting.colour)
  }
  if (e.settingSome) {
    const id = chartsOf(board)[e.settingSome.chart || 0]?.id
    const v = h.charts.read(id)?.cs?.[e.settingSome.key] || []
    expect(v.some(x => Object.entries(e.settingSome.match).every(([k, want]) => x?.[k] === want)), `${label}: ${e.settingSome.key} holds ${JSON.stringify(e.settingSome.match)}`).toBe(true)
  }
  if (e.widgetTypes) {
    const types = board.state.widgets.map(w => w.type)
    for (const t of e.widgetTypes.include || []) expect(types, `${label}: a ${t} widget on the board`).toContain(t)
  }
  if (e.instance) {
    // one indicator instance, found by dotted-path fields ({"inputs.period": 9}); `has` = exact fields; `colour` = a hue family
    const id = chartsOf(board)[e.instance.chart || 0]?.id
    const get = (o, k) => k.split('.').reduce((a, x) => a?.[x], o)
    const hit = p.instancesOn(board, id).find(i => Object.entries(e.instance.find).every(([k, v]) => get(i, k) === v))
    expect(hit, `${label}: an indicator matching ${JSON.stringify(e.instance.find)}`).toBeTruthy()
    for (const [k, v] of Object.entries(e.instance.has || {})) expect(get(hit, k), `${label}: ${k}`).toEqual(v)
    for (const k of e.instance.lacks || []) expect(get(hit, k), `${label}: ${k} is not set`).toBe(undefined)      // PACKAGE 3: an exact Undo removes the key
    if (e.instance.colour) expect(hueFamily(get(hit, e.instance.colour.key)), `${label}: ${e.instance.colour.key} is ${e.instance.colour.family}`).toBe(e.instance.colour.family)
  }
  if (e.layout) {
    const lib = board.state.layouts
    if (e.layout.active) expect(lib?.entries.find(x => x.id === lib.activeId)?.name, `${label}: the open layout`).toBe(e.layout.active)
    for (const n of e.layout.names || []) expect((lib?.entries || []).map(x => x.name), `${label}: a layout named ${n}`).toContain(n)
  }
  if (e.watchlist) {
    const wl = (board.state.server?.lists || []).find(l => l.name === e.watchlist.name)
    expect(wl, `${label}: the watchlist ${e.watchlist.name}`).toBeTruthy()
    for (const sym of e.watchlist.include || []) expect(wl.items.map(i => i.sym), `${label}: ${sym} on ${e.watchlist.name}`).toContain(sym)
    for (const sym of e.watchlist.exclude || []) expect(wl.items.map(i => i.sym), `${label}: ${sym} not on ${e.watchlist.name}`).not.toContain(sym)
  }
  if (e.indicatorAlerts) {
    // the fixture /api/indicator-alerts rows (the product's hook writers wrote them); `match` = dotted-path fields
    const rows = ctx.st.ialerts
    const get = (o, k) => k.split('.').reduce((a, x) => a?.[x], o)
    if (e.indicatorAlerts.count != null) expect(rows.length, `${label}: indicator alerts`).toBe(e.indicatorAlerts.count)
    if (e.indicatorAlerts.match) expect(rows.some(r => Object.entries(e.indicatorAlerts.match).every(([k, v]) => get(r, k) === v)), `${label}: an indicator alert ${JSON.stringify(e.indicatorAlerts.match)} (rows: ${JSON.stringify(rows.map(r => [r.sym, r.indicator, r.condition, r.threshold, r.active]))})`).toBe(true)
  }
  if (e.drawings) {
    // the chart's drawings in the REAL drawings store (by the first chart's symbol); `has` = dotted-path fields of one
    const sym = h.charts.read(chartsOf(board)[e.drawings.chart || 0]?.id)?.symbol
    const ds = drawingsStore.peekDrawings(sym) || []
    const get = (o, k) => k.split('.').reduce((a, x) => a?.[x], o)
    if (e.drawings.count != null) expect(ds.length, `${label}: drawings on ${sym}`).toBe(e.drawings.count)
    if (e.drawings.has) expect(ds.some(d => Object.entries(e.drawings.has).every(([k, v]) => get(d, k) === v)), `${label}: a drawing ${JSON.stringify(e.drawings.has)} (have ${JSON.stringify(ds.map(d => [d.type, d.points?.[0]?.price, d.color]))})`).toBe(true)
    if (e.drawings.fibHidden != null) expect(ds.some(d => d.type === 'fib' && resolveLevels(d).some(l => l.level === e.drawings.fibHidden && !l.visible)), `${label}: Fibonacci level ${e.drawings.fibHidden} hidden`).toBe(true)
    if (e.drawings.colour) expect(ds.some(d => hueFamily(d.color) === e.drawings.colour), `${label}: a ${e.drawings.colour} drawing`).toBe(true)
  }
  if (e.chartTabs) {
    // a chart widget's own tabs (opts.chartTabs: [{ id, name, tf }]), by name
    const w = board.state.widgets.find(x => x.id === (e.chartTabs.widget || 'c1'))
    const names = (w?.opts?.chartTabs || []).map(t => t.name)
    for (const n of e.chartTabs.include || []) expect(names, `${label}: a chart tab ${n}`).toContain(n)
    for (const n of e.chartTabs.exclude || []) expect(names, `${label}: no chart tab ${n}`).not.toContain(n)
  }
  if (e.customIndicators) {
    // the member's OWN indicators on a chart (saved definitions: defId u_…) and the definitions the server now holds
    const id = chartsOf(board)[e.customIndicators.chart || 0]?.id
    const mine = p.instancesOn(board, id).filter(i => /^u_/.test(String(i.defId)))
    if (e.customIndicators.count != null) expect(mine.length, `${label}: own indicators on the chart`).toBe(e.customIndicators.count)
    if (e.customIndicators.saved != null) expect(ctx.st.defs.size, `${label}: definitions saved`).toBe(e.customIndicators.saved)
    // PACKAGE 3: the saved definition's NAME is a human one (never formula-like) / exactly the one asked for
    if (e.customIndicators.name || e.customIndicators.humanName) {
      const names = [...ctx.st.defs.values()].map(d => d.definition?.meta?.name || '')
      if (e.customIndicators.name) expect(names, `${label}: a saved indicator named ${e.customIndicators.name}`).toContain(e.customIndicators.name)
      if (e.customIndicators.humanName) expect(names.every(n => n && !looksLikeFormula(n) && n.length <= 40), `${label}: every saved name is a human name (${JSON.stringify(names)})`).toBe(true)
    }
    if (e.customIndicators.version != null) expect(Math.max(0, ...[...ctx.st.defs.values()].map(d => d.version || 0)), `${label}: the saved version`).toBe(e.customIndicators.version)
    if (e.customIndicators.placement) expect(mine.length && [...ctx.st.defs.values()].some(d => d.definition?.placement?.target === e.customIndicators.placement), `${label}: saved with placement ${e.customIndicators.placement}`).toBe(true)
  }
  if ('preview' in e) {
    // PACKAGE 3: the authoring preview on screen (null = none); {chart: <board index>} = on that chart
    if (e.preview === null) expect(ctx.st.preview, `${label}: no preview on screen`).toBe(null)
    else expect(ctx.st.preview?.chart, `${label}: the preview is on chart ${e.preview.chart}`).toBe(chartsOf(board)[e.preview.chart || 0]?.id)
  }
  if (e.drafts) {
    // PACKAGE 3: the indicator drafts open in this tab (the specialist's own list — never the Agent's memory)
    const open = listDrafts({ canAuthor: true, definitionRows: [] })
    if (e.drafts.count != null) expect(open.length, `${label}: indicator drafts open`).toBe(e.drafts.count)
    if (e.drafts.revision != null) expect(open[0]?.revision, `${label}: the draft's revision`).toBe(e.drafts.revision)
    if ('name' in e.drafts) expect(open[0]?.name ?? null, `${label}: the draft's name`).toBe(e.drafts.name)
  }
  if (e.prefs) for (const [k, v] of Object.entries(e.prefs)) expect(ctx.st.prefs[k], `${label}: preference ${k}`).toEqual(v)
  if (e.boards) {
    // C1-167..170: the member's Drawing Boards as the panel lists them (labels: a name, or "Board N") and the active one
    const all = drawingsStore.listTracings()
    if (e.boards.names) expect(all.map(t => drawingsStore.tracingLabel(t)), `${label}: the drawing boards`).toEqual(e.boards.names)
    if (e.boards.active) expect(drawingsStore.tracingLabel(all.find(t => t.id === drawingsStore.getActiveTracingId())), `${label}: the active drawing board`).toBe(e.boards.active)
  }
  if (e.templates) {
    const names = (() => { try { return JSON.parse(ctx.st.prefs.chart_templates || '[]').map(t => t.name) } catch { return [] } })()
    for (const n of e.templates.include || []) expect(names, `${label}: a chart template ${n}`).toContain(n)
    for (const n of e.templates.exclude || []) expect(names, `${label}: no chart template ${n}`).not.toContain(n)
  }
  if (e.screens) {
    const names = ctx.st.screens.map(x => x.name)
    for (const n of e.screens.include || []) expect(names, `${label}: a saved screen ${n}`).toContain(n)
    for (const n of e.screens.exclude || []) expect(names, `${label}: no saved screen ${n}`).not.toContain(n)
  }
  if (e.watchlistOrder) {
    const wl = (board.state.server?.lists || []).find(l => l.name === e.watchlistOrder.name)
    expect(wl?.items.map(i => i.sym), `${label}: ${e.watchlistOrder.name} order`).toEqual(e.watchlistOrder.symbols)
  }
  if (e.watchlistNote) {
    const wl = (board.state.server?.lists || []).find(l => l.name === e.watchlistNote.name)
    expect(wl?.items.find(i => i.sym === e.watchlistNote.symbol)?.notes, `${label}: the note on ${e.watchlistNote.symbol}`).toBe(e.watchlistNote.note)
  }
  if (e.watchlistNames) {
    const names = (board.state.server?.lists || []).map(l => l.name)
    for (const n of e.watchlistNames.include || []) expect(names, `${label}: a watchlist ${n}`).toContain(n)
    for (const n of e.watchlistNames.exclude || []) expect(names, `${label}: no watchlist ${n}`).not.toContain(n)
  }
  if (e.indicatorsEach) {
    // EVERY chart on the board (or every chart but the listed ones) carries these indicators
    for (const w of chartsOf(board).filter(x => !(e.indicatorsEach.except || []).includes(x.id))) {
      const got = p.brief(board, w.id)
      for (const want of e.indicatorsEach.include || []) expect(got, `${label}: ${want} on chart ${w.id}`).toContain(want)
    }
  }
  if ('replay' in e) expect(ctx.st.replay, `${label}: the Replay Mode cutoff`).toBe(e.replay)
  // the Custom-Period Sort's floating panel ({start, end, group} | null) and the Period Sort widgets on the board (their opts)
  if ('periodSortPanel' in e) expect(ctx.st.periodSort?.panel ?? null, `${label}: the Custom-Period Sort panel`).toEqual(e.periodSortPanel)
  if (e.periodSortWidgets) expect(board.state.widgets.filter(w => w.type === 'periodsort').map(w => w.opts), `${label}: the Period Sort widgets`).toEqual(e.periodSortWidgets)
  if (e.listView) {
    // what the Watchlist widget shows (the LISTVIEW board): only the fields a case names
    const now = ctx.st.listViewNow()
    if (e.listView.rows) expect(now.rows, `${label}: the widget's rows, in order`).toEqual(e.listView.rows)
    if ('sort' in e.listView) expect(now.sort, `${label}: the widget's sort`).toEqual(e.listView.sort)
    if (e.listView.selected) expect(now.selected, `${label}: the widget's selected row`).toBe(e.listView.selected)
    for (const k of e.listView.columns || []) expect(now.columns, `${label}: a ${k} column`).toContain(k)
    for (const k of e.listView.noColumns || []) expect(now.columns, `${label}: no ${k} column`).not.toContain(k)
  }
  if (e.flagged) {
    const syms = ctx.st.flaggedNow()
    for (const s of e.flagged.include || []) expect(syms, `${label}: ${s} flagged`).toContain(s)
    for (const s of e.flagged.exclude || []) expect(syms, `${label}: ${s} not flagged`).not.toContain(s)
  }
  if (e.indicatorTemplates) {
    const names = JSON.parse(ctx.st.prefs.indicator_templates || '[]').map(t => t.name)
    for (const n of e.indicatorTemplates.include || []) expect(names, `${label}: an indicator template ${n}`).toContain(n)
    for (const n of e.indicatorTemplates.exclude || []) expect(names, `${label}: no indicator template ${n}`).not.toContain(n)
  }
  if (e.viewRight) expect(new Date(ctx.st.views[chartsOf(board)[0]?.id]?.rightMs || 0).toISOString().slice(0, 10), `${label}: the chart's right edge`).toBe(e.viewRight)
  // the chart's view as its read-back reports it (activeRange, atDefaultView, indicatorsHidden)
  if (e.view) for (const [k, v] of Object.entries(e.view)) expect(ctx.st.views[chartsOf(board)[0]?.id]?.[k], `${label}: the chart's view ${k}`).toEqual(v)
  // C1-165: the member's favourite drawing tools, as the toolbar's ★ stores them (drawToolFavorites)
  if (e.favoriteTools) expect(readFavoriteTools(), `${label}: favourite drawing tools`).toEqual(e.favoriteTools)
  // C1-127: the first chart's Chart Settings dialog open (or not), as the pane reads it back
  if ('settingsOpen' in e) expect(!!ctx.st.settingsOpen?.[chartsOf(board)[0]?.id], `${label}: Chart Settings open`).toBe(e.settingsOpen)
  // family C: the first chart's hand-placed watermark as the chart reads it back (null = Reset to center); the Ask AI routes opened
  if ('watermarkPos' in e) expect(h.charts.read(chartsOf(board)[0]?.id)?.watermarkPos ?? null, `${label}: the watermark position`).toEqual(e.watermarkPos)
  // compare.openView: the Compare panel open or closed and the tab it shows; `comparePick` the last detail's stock / group
  if ('comparePanel' in e) expect({ open: !!ctx.st.compare?.open, tab: ctx.st.compare?.open ? ctx.st.compare.tab : null }, `${label}: the Compare panel`).toEqual(e.comparePanel)
  if ('comparePick' in e) expect({ sym: ctx.st.compare?.intent?.sym ?? null, group: ctx.st.compare?.intent?.group ?? null }, `${label}: the rotation map's pick`).toEqual(e.comparePick)
  if ('askAiOpened' in e) expect(ctx.st.askAi || [], `${label}: Ask AI opened`).toEqual(e.askAiOpened)
  // is any moving average on the first chart showing (the same answer Ctrl+M reads)
  if ('movingAveragesOn' in e) expect(anyAverageOn(mergeChartSettings(chartsOf(board)[0]?.opts?.settings ?? null), nativeRegistry.getDefinition), `${label}: a moving average showing`).toBe(e.movingAveragesOn)
  if (e.indicators) {
    const id = chartsOf(board)[e.indicators.chart || 0]?.id
    const got = p.brief(board, id)
    for (const want of e.indicators.include || []) expect(got, `${label}: indicator ${want} on chart ${e.indicators.chart || 0}`).toContain(want)
    for (const no of e.indicators.exclude || []) expect(got, `${label}: no ${no}`).not.toContain(no)
    if (e.indicators.count != null) expect(got.length, `${label}: indicator count`).toBe(e.indicators.count)
  }
  if (e.screenRows) {
    // SG-1: the rows the screen RETURNED (the fixture applies the engine's semantics to the wire spec) — each satisfies the
    // member's stated condition, written here in the Screener's own sign ({key, op, value}); `min` rows at least
    const rows = ctx.st.screenRows || []
    const cmp = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b, eq: (a, b) => a === b, in: (a, b) => b.includes(a) }
    if (e.screenRows.min != null) expect(rows.length, `${label}: rows returned`).toBeGreaterThanOrEqual(e.screenRows.min)
    for (const c of e.screenRows.all || []) {
      const bad = rows.filter(r => !cmp[c.op](r[c.key], c.value)).map(r => r.ticker)
      expect(bad, `${label}: every returned row has ${c.key} ${c.op} ${JSON.stringify(c.value)}`).toEqual([])
    }
  }
  for (const r of e.reads || []) expect(calls.map(callLine).some(l => new RegExp(r, 'i').test(l)), `${label}: a canonical read matching /${r}/ ran (ran: ${calls.map(c => `${c[0]} ${c[1]}`).join(' | ')})`).toBe(true)
  for (const r of e.writes || []) expect(calls.map(callLine).some(l => new RegExp(r, 'i').test(l)), `${label}: a canonical write matching /${r}/ ran`).toBe(true)
  for (const r of e.noCalls || []) expect(calls.map(callLine).some(l => new RegExp(r, 'i').test(l)), `${label}: nothing matching /${r}/ ran`).toBe(false)
  for (const a of [].concat(e.refusedAction || [])) {
    // the refusal names the capability it refused: the turn's own outcome row (useAgent record → /api/agent/record)
    const rows = p.st.calls.slice(since.calls).filter(c => c[1] === '/api/agent/record').map(c => c[2]?.outcomeData || {})
    expect(rows.some(o => String(o.kind || '').startsWith('refused') && (o.actions || []).includes(a)), `${label}: a refusal of ${a} (outcomes: ${JSON.stringify(rows.map(o => [o.kind, o.actions]))})`).toBe(true)
  }
  if (e.receipt != null) expect(receiptsNow().length - since.receipts > 0, `${label}: a receipt`).toBe(e.receipt)
  if (e.undoable) expect(receiptsNow().at(-1)?.getAttribute('data-undoable'), `${label}: the receipt is undoable`).toBe('true')
  if (e.proposal != null) expect(proposalsNow().length > 0, `${label}: a proposal waiting`).toBe(e.proposal)
  // what the waiting CARD itself says (a confirm-risk action's card names what it will do before anything is done)
  for (const r of e.proposalSays || []) expect(proposalsNow().map(x => x.textContent).join(' '), `${label}: the card says /${r}/`).toMatch(new RegExp(r, 'i'))
  if (e.refusal != null) expect(refusals().length - since.refusals > 0, `${label}: a refusal`).toBe(e.refusal)
}

/**
 * Replay steps on a fresh panel. step = { say, model?: { ops, disposition }, expect, approve?: true, afterApprove? }.
 * Each step's expectations are retried until they hold (UI work settles asynchronously) and then asserted.
 */
export async function replay({ board: boardName = 'ONE', steps, seed = {}, kinds = null }, label) {
  _resetScreenerCache()                               // before the panel mounts (it reads the saved screens on open)
  const m = mountCase(boardName, { seed, kinds: kindsFor({ kinds }) })
  const { p, board, say } = m
  _resetScreenerCache()                               // module-level: each case reads its own saved screens
  // a member's panel has read their indicator alerts long before they ask (the cache is module-level: start clean)
  if (m.h.indicatorAlerts) { _resetIndicatorAlertCache(); await loadIndicatorAlerts(m.h, { force: true }) }
  const start = boardState(board)
  for (const [i, s] of steps.entries()) {
    const before = boardState(board)
    const since = { calls: p.st.calls.length, turns: turnCount(p), receipts: receiptsNow().length, refusals: refusals().length }
    p.st.envelopes.length = 0
    if (s.routes) {
      const got = routedNames(s.say, { host: m.h, v2: nlm1Of(seed) }).names   // NLM-1: the router the case runs with
      for (const a of s.routes) expect(got, `${label} · step ${i + 1}: "${s.say}" routes ${a}`).toContain(a)
    }
    if (s.model) p.st.envelopes.push(faithful(p, s.model))
    await say(s.say)
    const ctx = { ...m, start, before, since }
    const l = `${label} · step ${i + 1} "${s.say}"`
    if (s.expect) await waitFor(() => checkExpect(ctx, s.expect, l), { timeout: 6000 })
    if (s.dismiss) {
      // the member declines the card: nothing it proposed may happen, then or later
      const since2 = { ...since, calls: p.st.calls.length, receipts: receiptsNow().length }
      fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' }).at(-1))
      await m.p.idle()
      if (s.afterDismiss) await waitFor(() => checkExpect({ ...ctx, since: since2 }, s.afterDismiss, `${l} → Dismiss`), { timeout: 6000 })
    }
    if (s.approve) {
      const since2 = { ...since, calls: p.st.calls.length, receipts: receiptsNow().length }
      fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1))
      await m.p.idle()
      if (s.afterApprove) await waitFor(() => checkExpect({ ...ctx, since: since2 }, s.afterApprove, `${l} → Apply`), { timeout: 6000 })
    }
  }
  return m
}
