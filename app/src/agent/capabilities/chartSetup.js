// ── CHART SETUP capabilities (Charts operator P1, 2026-10-27) ───────────────────────────────────
//
// The rest of a chart's own controls, through the SAME writers the manual UI uses. Kept in their own
// routing group (`chartSetup`), so the NL-1 core (charts, indicators, screener, agent) keeps its size:
//
//   chartSetup.copyLook          "make this chart look like that one": the other chart's LOOK — its settings
//                                minus everything that is not appearance: the indicator-owned keys and
//                                header.infoValues (A1's `keepIndicatorState`, the one shared Restore rule),
//                                comparisons, the timeframe menu, position-calculator defaults. Proposed;
//                                exact Undo (the chart kind).
//   chartSetup.removeTimeframe   the timeframe menu's ✕ on a custom interval (ChartPane.removeCustomTf):
//                                out of header.customTimeframes AND header.timeframes.
//   chartSetup.favoriteTimeframe the timeframe menu's ★ (ChartPane.toggleTfFav): header.timeframes.
//   chartSetup.compareDisplay    the Compare panel's per-symbol scale ("Same % scale" / "New price scale"),
//                                its eye (enabled), and "Group only" (compareHideBase).
//   chartSetup.saveTemplate      Chart Settings → Templates → Save as Template, from ONE chart's settings
//                                (the shared chartTemplatesAfterSave: a same-named template is replaced —
//                                then it is proposed first). Undo puts the old list back.
//   chartSetup.deleteTemplate    a template's ✕ (chartTemplatesAfterDelete). Proposed; Undo puts it back.
//
// ⛔ Nothing here writes indicator state: copyLook carries the target chart's indicator keys over UNCHANGED
// (keepIndicatorState) — never the source chart's.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { keepIndicatorState } from '../../components/chart/indicatorPreservation'
import { makeTfCode, isValidTf, tfLabel as tfShort, NATIVE_TFS } from '../../components/chart/timeframes'
import { chartTemplatesAfterSave, chartTemplatesAfterDelete, CHART_TEMPLATE_NAME_MAX } from '../../components/chart/chartTemplateApply'
import { MAX_CHART_TEMPLATES } from '../../components/chart/chartCeilings'

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const quote = (s) => `“${s}”`
const onCharts = (ctx) => ctx.surface === 'charts'

// ── copyLook: what a chart's LOOK is NOT (kept from the target chart) ──
// Top-level keys that are data or per-chart tools, not appearance.
export const NOT_LOOK_TOP = ['comparisonSymbols', 'compareHideBase', 'positionCalc']
// Header keys that are the chart's own timeframe menu, not appearance.
export const NOT_LOOK_HEADER = ['timeframes', 'customTimeframes']

/** The target chart's settings with the SOURCE chart's look. Indicator state, comparisons, the timeframe
 *  menu and position-calculator defaults stay exactly as the target has them (present keeps, absent stays absent). */
export function lookOnto(source, target) {
  const out = keepIndicatorState(source || {}, target || {})
  const keepKey = (o, from, k) => {
    if (from && Object.prototype.hasOwnProperty.call(from, k)) o[k] = clone(from[k])
    else delete o[k]
  }
  for (const k of NOT_LOOK_TOP) keepKey(out, target, k)
  const th = target?.header && typeof target.header === 'object' ? target.header : null
  if (out.header && typeof out.header === 'object') {
    out.header = { ...out.header }
    for (const k of NOT_LOOK_HEADER) keepKey(out.header, th, k)
  } else if (th && NOT_LOOK_HEADER.some(k => k in th)) {
    out.header = {}
    for (const k of NOT_LOOK_HEADER) keepKey(out.header, th, k)
  }
  out.preset = 'custom'
  return out
}

// ── timeframe menu helpers (ChartPane's header writers) ──
const headerOf = (cs) => (cs?.header && typeof cs.header === 'object' ? cs.header : {})
const favsOf = (cs) => (Array.isArray(headerOf(cs).timeframes) ? headerOf(cs).timeframes : [])
const customsOf = (cs) => (Array.isArray(headerOf(cs).customTimeframes) ? headerOf(cs).customTimeframes : [])
const patchHeader = (cs, patch) => ({ ...cs, header: { ...headerOf(cs), ...patch }, preset: 'custom' })
/** A timeframe arg → its menu code: a native code ('5', 'D'), or a custom code ('45', '2h', '3D'…). */
export function tfCodeOf(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (NATIVE_TFS.includes(s) || isValidTf(s)) return s
  const m = /^(\d{1,3})\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?|mo|months?)$/i.exec(s)
  if (!m) return null
  const u = m[2].toLowerCase()
  const unit = /^mo/.test(u) ? 'months' : /^m/.test(u) ? 'minutes' : /^h/.test(u) ? 'hours' : /^d/.test(u) ? 'days' : 'weeks'
  const code = makeTfCode(unit, Number(m[1]))
  return code && isValidTf(code) ? code : null
}

// ── compare display ──
const comps = (cs) => (Array.isArray(cs?.comparisonSymbols) ? cs.comparisonSymbols : [])
const upper = (s) => String(s || '').trim().toUpperCase()

// ── the member's saved chart templates (pref `chart_templates`), as a target ──
function rawTemplates(host) {
  const raw = host?.prefs?.read?.()?.chart_templates
  try { const a = typeof raw === 'string' ? JSON.parse(raw) : raw; return Array.isArray(a) ? a : [] } catch { return [] }
}
const usable = (list) => list.filter(t => t && t.name && t.settings)
const byName = (list, name) => {
  const n = String(name || '').trim().toLowerCase()
  const hits = usable(list).filter(t => String(t.name).trim().toLowerCase() === n)
  return hits.length === 1 ? hits[0] : null
}
function templatesSnap(host) {
  const charts = (() => { try { return host?.charts?.list() || [] } catch { return [] } })()
  return { ref: 'chartTemplates', label: 'Your chart templates', templates: rawTemplates(host), charts: charts.map(c => ({ ref: c.ref, label: c.label, cs: c.cs })) }
}
const tplSig = (list) => JSON.stringify(list ?? [])

export const chartTemplatesKind = {
  name: 'chartTemplates',
  boardScoped: false,                // a member's templates are the same in every layout
  selfDescribing: true,
  list: (host) => (host?.prefs ? [templatesSnap(host)] : []),
  read: (host, ref) => (ref === 'chartTemplates' && host?.prefs ? templatesSnap(host) : null),
  stateOf: (s) => ({ templates: s.templates, charts: s.charts, saved: null, replaced: null, deleted: null }),
  patch: (before, after) => (sameJson(before.templates, after.templates) ? null : { write: after.templates, prev: before.templates }),
  async commit(host, ref, patch) {
    // the member's own preference writer (setPref → true only once the server accepted it)
    const ok = await host.prefs.write('chart_templates', JSON.stringify(patch.write))
    if (!ok) throw new Error('the server did not confirm the change, so it is not saved')
    return true
  },
  landed: (s, patch) => !!s && tplSig(s.templates) === tplSig(patch.write),
  undoPatch: (item) => (item.patch?.write ? { write: item.patch.prev, prev: item.patch.write } : null),
  fingerprint: (s) => (s ? tplSig(s.templates) : 'gone'),
}

let registered = false
export function registerChartSetupCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(chartTemplatesKind)
  registerContextProvider({
    key: 'chartTemplateLibrary',
    build: (host, refFor) => (host?.prefs ? [{ ref: refFor('chartTemplates', 'chartTemplates'), label: 'Your saved chart templates (save one from a chart, or delete one, here)',
      names: usable(rawTemplates(host)).slice(0, 30).map(t => t.name) }] : undefined),
  })
  const chartCommon = { target: 'chart', surfaces: ['charts'], available: onCharts }

  registerCapability({
    ...chartCommon,
    name: 'chartSetup.copyLook',
    risk: 'confirm',
    summary: 'Make ONE chart look like another chart on the board: it takes the other chart\'s colours, theme, chart type, scale and display settings. Its own indicators, comparisons and timeframe menu stay exactly as they are. Shown as a proposal first; Undo puts the old look back.',
    hints: 'target = the chart that CHANGES; from = the ref of the chart to copy the look FROM. "Make the left chart look like the right one" → target = left, from = right.',
    argRefs: { from: 'chart' },
    args: { type: 'object', properties: { from: { type: 'string' } }, required: ['from'], additionalProperties: false },
    check(st, { from }, env) {
      const src = env?.peer?.(from)
      if (!src) return 'Which chart should it look like? Name a chart on this board.'
      if (src.ref === env?.target?.ref) return 'That is the same chart — name the chart to copy the look from.'
      return null
    },
    apply(st, { from }, env) {
      const src = env.peer(from)
      const next = lookOnto(src.cs, st.cs)
      return sameJson(next, st.cs) ? st : { ...st, cs: next }
    },
    describe: (b, a, { from }, env) => (sameJson(b.cs, a.cs) ? null
      : `Copied the look of ${env?.peer?.(from)?.label || 'the other chart'} — colours, theme, chart type, scale and display settings; this chart's indicators, comparisons and timeframes are unchanged`),
    noop: () => 'It already looks exactly like that chart',
  })

  registerCapability({
    ...chartCommon,
    name: 'chartSetup.removeTimeframe',
    summary: 'Remove a CUSTOM timeframe (e.g. 45 minutes, 2 hours) from ONE chart\'s timeframe menu — the menu\'s own ✕. Built-in timeframes cannot be removed. Undo puts it back.',
    hints: 'timeframe = the custom code as the chart lists it (e.g. "45", "2h", "3D") or words ("45m", "2 hours").',
    args: { type: 'object', properties: { timeframe: { type: 'string' } }, required: ['timeframe'], additionalProperties: false },
    fast: ({ lower }) => {
      const m = /^(?:remove|delete|drop)\s+(?:the\s+)?(?:custom\s+)?(.+?)\s+(?:custom\s+)?(?:time ?frame|interval)(?:\s+from the (?:menu|list))?(?:\s+on the chart)?$/.exec(lower)
      const code = m ? tfCodeOf(m[1].replace(/\s+minute$/, 'm').replace(/\s+hour$/, 'h').replace(/\s+day$/, 'd').replace(/\s+week$/, 'w')) : null
      return code && !NATIVE_TFS.includes(code) ? { timeframe: code } : null
    },
    check(st, { timeframe }) {
      const code = tfCodeOf(timeframe)
      if (!code) return `“${timeframe}” isn't a timeframe.`
      if (NATIVE_TFS.includes(code)) return `${tfShort(code)} is one of UCT's built-in timeframes — only custom ones can be removed (you can un-star it instead).`
      if (!customsOf(st.cs).includes(code)) return `${tfShort(code)} isn't one of this chart's custom timeframes.`
      if (String(st.tf) === code) return `The chart is showing ${tfShort(code)} now — switch it to another timeframe first.`
      return null
    },
    apply(st, { timeframe }) {
      const code = tfCodeOf(timeframe)
      return { ...st, cs: patchHeader(st.cs, { customTimeframes: customsOf(st.cs).filter(c => c !== code), timeframes: favsOf(st.cs).filter(c => c !== code) }) }
    },
    describe: (b, a, { timeframe }) => (sameJson(b.cs, a.cs) ? null : `Removed the ${tfShort(tfCodeOf(timeframe))} timeframe from this chart's menu`),
  })

  registerCapability({
    ...chartCommon,
    name: 'chartSetup.favoriteTimeframe',
    summary: 'Star or un-star a timeframe on ONE chart (the timeframe menu\'s ★): starred timeframes show in the chart\'s header bar. Undo puts it back.',
    hints: 'timeframe = a code (1, 5, 15, 30, 60, D, W, M, or a custom one the chart has); favorite = true to star, false to un-star.',
    args: { type: 'object', properties: { timeframe: { type: 'string' }, favorite: { type: 'boolean' } }, required: ['timeframe', 'favorite'], additionalProperties: false },
    check(st, { timeframe, favorite }) {
      const code = tfCodeOf(timeframe)
      if (!code) return `“${timeframe}” isn't a timeframe.`
      if (!NATIVE_TFS.includes(code) && !customsOf(st.cs).includes(code)) return `${tfShort(code)} isn't in this chart's timeframe menu — add it as a custom timeframe first.`
      if (typeof favorite !== 'boolean') return 'Say whether to star or un-star it.'
      return null
    },
    apply(st, { timeframe, favorite }) {
      const code = tfCodeOf(timeframe)
      const fav = favsOf(st.cs)
      if (fav.includes(code) === favorite) return st
      return { ...st, cs: patchHeader(st.cs, { timeframes: favorite ? [...fav, code] : fav.filter(c => c !== code) }) }
    },
    describe: (b, a, { timeframe, favorite }) => (sameJson(b.cs, a.cs) ? null : `${favorite ? 'Starred' : 'Unstarred'} ${tfShort(tfCodeOf(timeframe))} in this chart's timeframe bar`),
    noop: (b, a, { favorite } = {}) => (favorite ? 'That timeframe is already starred' : 'That timeframe is not starred'),
  })

  registerCapability({
    ...chartCommon,
    name: 'chartSetup.compareDisplay',
    summary: 'Change how ONE chart\'s comparison overlays are shown (Tools → Compare Symbols): each overlay\'s scale ("same" = share the main price scale, "new" = its own % scale), showing or hiding an overlay, and "Group only" (hide the chart\'s own symbol). To add or remove overlays use chart.compare.',
    hints: 'symbols = the compared tickers this applies to ([] = every comparison on the chart); scale = same | new | null (keep); visible = true | false | null (keep); groupOnly = true | false | null (keep).',
    args: { type: 'object', properties: {
      symbols: { type: 'array', items: { type: 'string' } }, scale: { type: ['string', 'null'], enum: ['same', 'new', null] },
      visible: { type: ['boolean', 'null'] }, groupOnly: { type: ['boolean', 'null'] },
    }, required: ['symbols', 'scale', 'visible', 'groupOnly'], additionalProperties: false },
    check(st, { symbols, scale, visible, groupOnly }) {
      const list = comps(st.cs)
      if (!list.length) return 'This chart has no comparisons — add one first (Compare).'
      if (scale == null && visible == null && groupOnly == null) return 'Say what to change: the scale, showing or hiding, or Group only.'
      const want = (symbols || []).map(upper)
      const missing = want.filter(s => !list.some(x => upper(x.sym) === s))
      if (missing.length) return `${missing.join(', ')} ${missing.length === 1 ? "isn't" : "aren't"} compared on this chart.`
      return null
    },
    apply(st, { symbols, scale, visible, groupOnly }) {
      const want = new Set((symbols || []).map(upper))
      const hit = (x) => !want.size || want.has(upper(x.sym))
      const list = comps(st.cs).map(x => (hit(x) ? { ...x, ...(scale ? { scaleMode: scale } : {}), ...(visible != null ? { enabled: visible } : {}) } : x))
      let next = { ...st.cs, comparisonSymbols: list, preset: 'custom' }
      if (groupOnly != null) next = { ...next, compareHideBase: groupOnly }
      // StockChart forces percent while any "new scale" overlay is on (chart.setScale's rule) — the
      // Compare panel never leaves log/percent set beside it (chart.compare does the same)
      if (list.some(x => x.enabled && (x.scaleMode || 'new') !== 'same') && (next.percentScale || next.logScale)) next = { ...next, percentScale: false, logScale: false }
      return sameJson(next.comparisonSymbols, st.cs?.comparisonSymbols) && !!next.compareHideBase === !!st.cs?.compareHideBase ? st : { ...st, cs: next }
    },
    describe(b, a) {
      if (sameJson(b.cs, a.cs)) return null
      const out = []
      const was = new Map(comps(b.cs).map(x => [x.sym, x]))
      for (const x of comps(a.cs)) {
        const o = was.get(x.sym) || {}
        if ((o.scaleMode || 'new') !== (x.scaleMode || 'new')) out.push(`${x.sym} on ${x.scaleMode === 'same' ? 'the main price scale' : 'its own % scale'}`)
        if (o.enabled !== false && x.enabled === false) out.push(`${x.sym} hidden`)
        if (o.enabled === false && x.enabled !== false) out.push(`${x.sym} shown`)
      }
      if (!!b.cs?.compareHideBase !== !!a.cs?.compareHideBase) out.push(a.cs.compareHideBase ? 'Group only on (this chart\'s own symbol hidden)' : 'Group only off')
      return `Comparisons: ${out.join(', ')}`
    },
    noop: () => 'The comparisons already show that way',
  })

  const tplCommon = { target: 'chartTemplates', surfaces: ['charts'], available: onCharts }

  registerCapability({
    ...tplCommon,
    name: 'chartSetup.saveTemplate',
    summary: 'Save ONE chart\'s current settings as one of the member\'s chart templates (Chart Settings → Templates → Save as Template) — its look and its indicators, exactly what the button saves. A template with the same name is replaced (then it is shown first). Undo puts the old list back.',
    hints: `target = the ref of the chartTemplateLibrary entry; chart = the ref of the chart to save from; name = exactly as the member said it (at most ${CHART_TEMPLATE_NAME_MAX} characters).`,
    argRefs: { chart: 'chart' },
    args: { type: 'object', properties: { name: { type: 'string' }, chart: { type: 'string' } }, required: ['name', 'chart'], additionalProperties: false },
    check(st, { name, chart }) {
      const nm = String(name || '').trim()
      if (!nm) return 'What should the template be called?'
      if (nm.length > CHART_TEMPLATE_NAME_MAX) return `Template names can be at most ${CHART_TEMPLATE_NAME_MAX} characters.`
      const c = st.charts.find(x => x.ref === chart)
      if (!c) return 'Which chart should I save it from? Name a chart on this board.'
      if (st.saved) return 'Save one template at a time.'
      return null
    },
    confirmIf: (st, { name }) => !!byName(st.templates, name),
    apply(st, { name, chart }) {
      const c = st.charts.find(x => x.ref === chart)
      const r = chartTemplatesAfterSave(st.templates, name, c.cs, { max: MAX_CHART_TEMPLATES })
      return r ? { ...st, templates: r.templates, saved: { name: r.template.name, from: c.label }, replaced: r.replaced ? r.replaced.name : null } : st
    },
    describe: (b, a) => (a.saved ? `${a.replaced ? `Replaced your chart template ${quote(a.replaced)} with` : 'Saved'} ${a.saved.from}'s settings as the chart template ${quote(a.saved.name)} — its look and its indicators` : null),
  })

  registerCapability({
    ...tplCommon,
    name: 'chartSetup.deleteTemplate',
    risk: 'confirm',
    summary: 'Delete one of the member\'s saved chart templates (a template\'s ✕ in Chart Settings → Templates). Charts that used it keep their settings. Shown first; Undo puts it back.',
    hints: 'target = the ref of the chartTemplateLibrary entry; name = a template name from that entry, exactly.',
    args: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    check(st, { name }) {
      if (byName(st.templates, name)) return null
      const names = usable(st.templates).map(t => t.name)
      return names.length ? `You have no chart template named ${quote(name)} (you have: ${names.slice(0, 8).join(', ')}).` : 'You have no saved chart templates.'
    },
    apply(st, { name }) {
      const t = byName(st.templates, name)
      // (a template saved before ids existed is removed by identity, never every id-less one)
      const templates = t.id != null ? chartTemplatesAfterDelete(st.templates, t.id) : st.templates.filter(x => x !== t)
      return { ...st, templates, deleted: t.name }
    },
    describe: (b, a) => (a.deleted ? `Deleted your chart template ${quote(a.deleted)} (charts that used it keep their settings)` : null),
  })
}
