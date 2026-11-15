// ── INDICATOR TEMPLATES: a member's saved indicator set (Chart Settings → Indicators → Indicator templates) ─────────
//
// A different store from CHART templates (`chart.applyTemplate`, pref `chart_templates`, a chart's whole look): these are
// pref `indicator_templates`, a named list of indicators only, and applying one ADDS them, removing nothing.
// Indicators owns what a template is (`components/chart/builder/indicatorTemplates.js`); this file routes and receipts.
//
//   indicatorTemplate.list    QUERY — the saved templates and what is in each
//   indicatorTemplate.apply   put one template's indicators on ONE chart (one op per chart). No second writer: the template
//                             is materialised in memory and handed to Indicators' `copyFrom`, the mutation that already
//                             wraps applyIndicatorTemplate, so plan, pins, read-back and exact Undo are the ones
//                             indicatorCopy.copyTo has. What is already on the chart is skipped and said.
//   indicatorTemplate.save    capture ONE chart's indicators. A same-named template is shown first (confirmIf); Undo puts it back.
//   indicatorTemplate.delete  always shown first; Undo puts it back.
//
// ⛔ THE LIST IS WRITTEN WITH setPrefMerged, through host.prefs.merge, never whole: the bar's own rule, so a template another tab
// just saved survives. Each write re-judges against the list as it stands at that instant, so an overwrite that was approved
// for one template can never replace a different one that took its name meanwhile.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import {
  indicatorTemplatesEnabled, captureIndicatorTemplate, applyIndicatorTemplate, parseIndicatorTemplates, planTemplateSave,
  cleanTemplateName, INDICATOR_TEMPLATES_PREF, TEMPLATE_NAME_MAX, MAX_INDICATOR_TEMPLATES, MAX_TEMPLATE_INDICATORS,
} from '../../components/chart/builder/indicatorTemplates'
import * as nativeRegistry from '../../components/chart/engine/nativeRegistry'
import { common } from './indicatorEdits'
import { checkBuilt, applyBuilt } from './indicatorControls'

const quote = (s) => `“${s}”`
const OFF = 'Indicator templates aren’t switched on in this build.'
const plural = (n) => `${n} indicator${n === 1 ? '' : 's'}`
const lc = (s) => String(s ?? '').trim().toLowerCase()
const sig = (v) => JSON.stringify(v ?? null)
// a template's content: `savedAt` is stamped when it is written, so it never counts as a change
const body = (t) => { const { savedAt: _at, ...rest } = t; return sig(rest) }
// ⛔ A PLAN MUST BE REPRODUCIBLE: an approval re-plans and compares, so a random id would refuse every overwrite the member
// approved. The id comes from the name (a replaced template keeps its own), and the time is stamped at commit.
const idOfName = (name) => `it${[...lc(name)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7).toString(36).replace('-', '_')}`
const contents = (t) => t.instances.map(i => i.label || i.defId)

let hostRef = null
const listOf = (host) => parseIndicatorTemplates(host?.prefs?.read?.()?.[INDICATOR_TEMPLATES_PREF])
function byName(list, name) {
  const want = lc(cleanTemplateName(name))
  return want ? list.find(t => lc(t.name) === want) || null : null
}
const noSuch = (list, name) => (list.length
  ? `You have no indicator template named ${quote(name)} (you have: ${list.slice(0, 8).map(t => t.name).join(', ')}).`
  : 'You have no saved indicator templates.')

// ── the list as a target ──
function snap(host) {
  const charts = (() => { try { return host?.charts?.list() || [] } catch { return [] } })()
  return { ref: 'indicatorTemplates', label: 'Your indicator templates', templates: listOf(host), charts: charts.map(c => ({ ref: c.ref, label: c.label, cs: c.cs })) }
}
/** One change to the stored list, judged against the list as it stands NOW → { list } | { why }. */
export function mergedTemplates(current, { put, drop, at }) {
  const list = parseIndicatorTemplates(current)
  if (drop) {
    const cur = list.find(t => t.id === drop.id)
    if (!cur || body(cur) !== body(drop)) return { why: 'changed' }
  }
  const rest = drop ? list.filter(t => t.id !== drop.id) : list
  if (!put) return { list: rest }
  if (rest.some(t => lc(t.name) === lc(put.name))) return { why: 'changed' }
  const plan = planTemplateSave(rest, put)
  if (!plan.ok) return { why: plan.reason }
  if (!Number.isInteger(at)) return { list: plan.list }
  const [head, ...tail] = plan.list
  return { list: [...tail.slice(0, at), head, ...tail.slice(at)] }
}
const WHY = {
  changed: 'that template changed since I read it, so nothing was saved — ask again',
  full: `you have ${MAX_INDICATOR_TEMPLATES} indicator templates, the most there can be — delete one first`,
  'too-big': 'that is too large to save with your other templates — delete a template first',
}

export const indicatorTemplatesKind = {
  name: 'indicatorTemplates',
  source: (host) => !!host?.prefs?.merge,             // fix-nothing-on-workspace: the host source this kind reads (capabilities.noTargetSentence)
  unavailable: "Indicator templates aren't available on this page — open Charts to use an indicator template.",
  boardScoped: false,                // a member's templates are the same in every layout
  selfDescribing: true,
  list: (host) => (host?.prefs?.merge ? [snap(host)] : []),
  read: (host, ref) => (ref === 'indicatorTemplates' && host?.prefs?.merge ? snap(host) : null),
  stateOf: (s) => ({ templates: s.templates, charts: s.charts, change: null }),
  patch: (before, after) => (after.change ? { ...after.change } : null),
  async commit(host, ref, patch) {
    let verdict = null
    const stamped = { ...patch, ...(patch.put && patch.put.savedAt === 0 ? { put: { ...patch.put, savedAt: Date.now() } } : {}) }
    const answer = await host.prefs.merge(INDICATOR_TEMPLATES_PREF, (current) => {
      const m = mergedTemplates(current, stamped)
      verdict = m.why || null
      return m.why ? undefined : m.list          // `undefined` abandons the write
    })
    if (verdict) throw new Error(WHY[verdict] || verdict)
    if (!answer || answer.ok !== true) throw new Error('the server did not confirm the change, so it is not saved')
    return patch.line ? { lines: [patch.line] } : true
  },
  landed(s, { put, drop }) {
    if (!s) return false
    const has = (t) => s.templates.some(x => x.id === t.id && body(x) === body(t))
    return (!put || has(put)) && (!drop || !has(drop) || (!!put && body(put) === body(drop)))
  },
  undoPatch: ({ patch }) => (patch ? { put: patch.drop || null, drop: patch.put || null, at: patch.undoAt } : null),
  fingerprint: (s) => (s ? sig(s.templates) : 'gone'),
}

// ── apply: the template as the SOURCE of Indicators' `copyFrom` ──
function applyRequest(st, { template }) {
  if (!indicatorTemplatesEnabled()) return { why: OFF }
  const list = listOf(hostRef)
  const t = byName(list, template)
  if (!t) return { why: noSuch(list, template) }
  const src = applyIndicatorTemplate({ indicatorInstances: [] }, t, nativeRegistry)
  if (!src.ok) return { why: `The saved template ${quote(t.name)} is damaged, so nothing was added to ${st.chart}.` }
  const gone = src.unavailable.map(u => u.label)
  if (!src.added.length) return { why: `Nothing in ${quote(t.name)} can be added: ${gone.join(', ')} no longer ${gone.length === 1 ? 'exists' : 'exist'}.` }
  return { req: { op: 'copyFrom', sourceCs: src.cs, instanceIds: src.added.map(a => a.instanceId) }, name: t.name, gone }
}
const goneWords = (gone) => (gone.length ? ` Not added, no longer available: ${gone.join(', ')}.` : '')

let registered = false
export function registerIndicatorTemplateCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(indicatorTemplatesKind)
  registerContextProvider({
    key: 'indicatorTemplateLibrary',
    build: (host, refFor) => {
      if (!host?.prefs?.merge || !indicatorTemplatesEnabled()) return undefined
      hostRef = host
      return [{ ref: refFor('indicatorTemplates', 'indicatorTemplates'), label: 'Your saved indicator templates (sets of indicators; different from chart templates)', names: listOf(host).map(t => t.name) }]
    },
  })
  const libCommon = { target: 'indicatorTemplates', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts' }

  registerCapability({
    ...libCommon,
    name: 'indicatorTemplate.list',
    query: true,
    summary: 'List the member\'s saved INDICATOR templates and the indicators in each, from the real list. Use this (disposition apply) for "what indicator templates do I have".',
    hints: 'target = the ref of the indicatorTemplateLibrary entry.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    answer(s) {
      if (!indicatorTemplatesEnabled()) return OFF
      const list = s?.templates || []
      if (!list.length) return 'You have no saved indicator templates.'
      return {
        text: `You have ${list.length} indicator template${list.length === 1 ? '' : 's'}.`,
        table: {
          columns: [{ key: 'name', label: 'Template' }, { key: 'count', label: 'Indicators' }, { key: 'what', label: 'In it' }],
          rows: list.map(t => ({ name: t.name, count: t.instances.length, what: contents(t).join(', ') })),
        },
      }
    },
  })

  registerCapability({
    ...common,
    name: 'indicatorTemplate.apply',
    addsIndicators: true,
    fanOut: true,
    summary: 'Add the indicators of ONE saved INDICATOR template to ONE chart, each exactly as saved. Nothing on the chart is removed; one already there is skipped and said. Undo removes what was added. A CHART template (look and settings) is chart.applyTemplate instead.',
    hints: 'target = the chart\'s indicatorEdits entry. template = a name from indicatorTemplateLibrary, exactly. Several charts = one op per chart; if it isn\'t clear which charts, ask. A name in both that entry and chartTemplates: ask which they mean.',
    args: { type: 'object', properties: { template: { type: 'string' } }, required: ['template'], additionalProperties: false },
    check: (st, args) => checkBuilt(st, applyRequest(st, args)),
    apply(st, args) {
      const built = applyRequest(st, args)
      const a = applyBuilt(st, built)
      if (!a.change) return built.why ? a : { ...a, skipped: `${built.name}|${goneWords(built.gone)}` }
      return { ...a, change: { ...a.change, note: `From your indicator template ${quote(built.name)}.${goneWords(built.gone)}` } }
    },
    describe(b, a) {
      if (!a.change) return null
      const pv = a.change.plan.preview
      const had = (pv.already || []).map(x => x.name)
      return `Add ${pv.name} to ${a.chart}${had.length ? ` · already there: ${had.join(', ')}` : ''}. ${a.change.note}`
    },
    noop(b, a, { template } = {}) {
      const [name, gone] = String(a?.skipped || `${template}|`).split('|')
      return `Everything in ${quote(name)} is already on ${b.chart}.${gone || ''}`
    },
  })

  registerCapability({
    ...libCommon,
    name: 'indicatorTemplate.save',
    summary: 'Save the indicators on ONE chart as a named INDICATOR template (settings, colours, panes; no alerts). A template with that name is replaced only after the member approves it. Undo puts the list back. A chart\'s whole look is chartSetup.saveTemplate instead.',
    hints: `target = the ref of the indicatorTemplateLibrary entry; chart = the ref of the chart to save from; name = exactly as the member said it (at most ${TEMPLATE_NAME_MAX} characters). It saves every indicator on that chart.`,
    argRefs: { chart: 'chart' },
    args: { type: 'object', properties: { name: { type: 'string' }, chart: { type: 'string' } }, required: ['name', 'chart'], additionalProperties: false },
    check(st, { name, chart }) {
      if (!indicatorTemplatesEnabled()) return OFF
      const nm = String(name || '').trim()
      if (!nm) return 'What should the template be called?'
      if (nm.length > TEMPLATE_NAME_MAX) return `Template names can be at most ${TEMPLATE_NAME_MAX} characters.`
      const c = st.charts.find(x => x.ref === chart)
      if (!c) return 'Which chart should I save it from? Name a chart on this board.'
      if (st.change) return 'Save one template at a time.'
      const cap = captureIndicatorTemplate(c.cs, nativeRegistry, { name: nm, now: 0 })
      if (!cap.ok) return `There are no indicators on ${c.label} to save.`
      const m = mergedTemplates(st.templates, { put: cap.template, drop: byName(st.templates, nm) })
      return m.why ? `${WHY[m.why]}.`.replace(/^./, x => x.toUpperCase()) : null
    },
    confirmIf: (st, { name }) => !!byName(st.templates, name),
    apply(st, { name, chart }) {
      const c = st.charts.find(x => x.ref === chart)
      const old = byName(st.templates, name)
      const cap = captureIndicatorTemplate(c.cs, nativeRegistry, { name: String(name).trim(), id: old ? old.id : idOfName(name), now: 0 })
      const t = cap.template
      const what = `${plural(t.instances.length)} from ${c.label}`
      const cut = cap.omitted > 0 ? ` Only the first ${MAX_TEMPLATE_INDICATORS} were saved; ${cap.omitted} more were left out.` : ''
      return { ...st, change: { put: t, drop: old, undoAt: old ? st.templates.indexOf(old) : undefined,
        says: old ? `Replace your indicator template ${quote(old.name)} (${contents(old).join(', ')}) with ${what}.${cut}` : `Save ${what} as the indicator template ${quote(t.name)}.${cut}`,
        line: `${old ? `Replaced the indicator template ${quote(t.name)} with` : `Saved the indicator template ${quote(t.name)} with`} ${what}.${cut}` } }
    },
    describe: (b, a) => a.change?.says || null,
  })

  registerCapability({
    ...libCommon,
    name: 'indicatorTemplate.delete',
    risk: 'confirm',
    summary: 'Delete one of the member\'s saved INDICATOR templates. Indicators already on charts stay. Shown first; Undo puts it back. A chart template is chartSetup.deleteTemplate instead.',
    hints: 'target = the ref of the indicatorTemplateLibrary entry; name = a name from that entry, exactly.',
    args: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
    check(st, { name }) {
      if (!indicatorTemplatesEnabled()) return OFF
      return byName(st.templates, name) ? null : noSuch(st.templates, name)
    },
    apply(st, { name }) {
      const t = byName(st.templates, name)
      return { ...st, change: { put: null, drop: t, undoAt: st.templates.indexOf(t), says: `Delete your indicator template ${quote(t.name)} (${contents(t).join(', ')}); indicators already on charts stay`,
        line: `Deleted the indicator template ${quote(t.name)}. Indicators already on charts stayed.` } }
    },
    describe: (b, a) => a.change?.says || null,
  })
}
