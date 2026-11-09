// ── UCT Agent PRODUCT GUIDE capabilities: EXPLAIN and SHOW ME (Phase 2 Workstream B, 2026-10-29) ─────────────
//
//   guide.explain   a QUERY: what a term or feature means, from UCT's own catalog and concepts (guide/explain.js)
//   guide.show      a QUERY: highlight the real control on the board, step by step (guide/GuideOverlay.jsx) —
//                   nothing in the workspace changes, no receipt, no Undo (there is nothing to undo)
//   DO IT FOR ME    not a capability of its own: "now do it for me" after a walkthrough runs the feature's EXISTING
//                   capability (registry `doIt`) through the ordinary planner, policy, receipts and Undo
//                   (`doItForMe`, called by useAgent)
//
// Both are on the read-only `guide` target (it always exists; nothing is ever committed). Explain is never treated
// as permission to change anything; Show me never executes. Agent is admin-only, so the guide is too, and a feature
// whose capabilities this member cannot use is not shown (guide/registry.guideFeatures).

import { registerCapability, registerTargetKind, registerContextProvider, getTargetKind } from '../capabilities'
import { GUIDE_IDS, GUIDE_FEATURES, guideFeature, guideFeatures, matchFeature, surfaceOf, featuresOn } from '../guide/registry'
import { explainTopic, explainWords } from '../guide/explain'
import { startGuide, lastShownGuide, forgetLastShown, endGuide, guideState, takeGuideOffer } from '../guide/guideStore'
import { findTarget, exists, startIndex, unclip } from '../guide/targets'
import { stepsFor, titleFor } from '../guide/slots'
import { readControl, askWhich } from '../guide/controls'
import { catalogRows } from '../../components/chart/indicatorCatalog'
import { namedChart, namesAChart } from '../guide/namedChart'
import * as nativeRegistry from '../../components/chart/engine/nativeRegistry'

/** The first few studies of the chart's own quick set (its right-click "Indicators" toggles: `meta.quickMenu` not
 *  false), pane studies first — the catalog's order, its names. Never a hand-written list. */
function quickIndicators(n = 4) {
  let rows = []
  try { rows = catalogRows(nativeRegistry).filter(r => !r.userDefined && !r.carvedOut && nativeRegistry.getDefinition(r.id)?.meta?.quickMenu !== false) } catch { rows = [] }
  const pane = rows.filter(r => r.target === 'pane')
  return [...pane, ...rows.filter(r => r.target !== 'pane')].slice(0, n).map(r => [r.id, r.shortName || r.name])
}

// "where do I change the timeframe?", "show me where to add an indicator", "how do I use watchlists?"
const SHOW = /^(?:(?:can|could) you |please |ok |okay |so |hey )*(?:show me (?:where|how)|where (?:do|can|would|should) i|where(?:'s| is| are)|whereabouts|how (?:do|can|would|should) i|how to|walk me through|guide me (?:through|to)|teach me(?: how)?(?: to)?|help me (?:find|with)|give me a (?:tour|walkthrough)|tutorial (?:on|for))\b/i

/** A message about learning UCT (the guide entry rides in the context; the guide routing group is sent). */
export const GUIDE_WORDS = /\b(where (do|can|would|should) i|where(?:'s| is| are) the|show me (where|how)|how (do|can|would|should) i|walk me through|guide me|teach me|tutorial)\b/i

function chartsOf(host) { try { return host?.charts?.list?.() || [] } catch { return [] } }
/** The chart a walkthrough is about: the one chart, else the clicked one, else the first in reading order. */
function guideChart(host) {
  const charts = chartsOf(host)
  if (!charts.length) return null
  if (charts.length === 1) return charts[0]
  let sel = null
  try { sel = host?.charts?.selected?.() || null } catch { sel = null }
  return charts.find(c => c.ref === sel) || charts[0]
}
// '@chart': a control looked for on the chart talked about itself (guide/targets.js)
const scoped = (t) => (Array.isArray(t) ? t.some(scoped) : typeof t === 'string' ? t.startsWith('chart.') || t.startsWith('widget.') : t?.within === '@chart' || (!!t?.id && scoped(t.id)))

/** Start the walkthrough for one feature → the sentence the member reads (never claims what is not on screen). */
export function showFeature(f, host, words = '') {
  if (!f) return 'I don’t have a walkthrough for that yet — ask me what it does instead.'
  const steps = stepsFor(f, words)
  const needsChart = steps.some(s => scoped(s.target))
  // the chart the words name wins over the clicked one; a chart they name that is not here is said, never swapped for another
  const asked = needsChart ? namedChart(words, chartsOf(host)) : null
  if (asked?.say) return asked.say
  const chart = needsChart ? asked?.chart || guideChart(host) : null
  if (needsChart && !chart) return `There’s no chart on this board to show that on. Add one from Widgets ▾ → Chart first.`
  const chartRef = chart?.ref || null
  // ⭐ Multi Chart: a cell has no "more timeframes" menu or drawing strip, so a chart step past the first goes unless it is there
  const absentOnCell = (s, i) => host?.multiChart && i > 0 && String(s.target).startsWith('chart.')
  // an optional opening step (the board's own watchlist) only when it is there
  const all = steps.filter((s, i) => !((s.optional && !s.late) || absentOnCell(s, i)) || exists(s.target, { chartRef }))
  // ⭐ CONTEXT-AWARE: where the member already is. A step whose control is on screen BECAUSE the step before it was
  // done (Chart settings is open → its Indicators tab; the Indicators tab is open → its search box) is where the
  // walkthrough starts — never "open the gear" when the settings are already open. The steps before it stay in the list.
  const from = startIndex(all, { chartRef })
  const first = all[from]
  if (!first || !(findTarget(first.target, { chartRef }) || unclip(first.target, { chartRef }))) {
    // ⭐ Multi Chart: a cell carries its ticker and timeframe controls only; the rest of a chart's header is not on it
    if (host?.multiChart) return `That control isn’t on a Multi Chart cell, so I can’t point at it here — exit Multi Chart to see it. ${f.explain}`
    return `I can’t see ${f.control || 'that control'} on your screen right now — ${chart ? `${chart.label} may be scrolled out of view or covered by a panel` : 'a panel may be covering it'}. ${f.explain}`
  }
  if (guideState()) endGuide('replaced')
  startGuide({ ...f, title: titleFor(f, words) }, { chartRef, chartLabel: chart?.label || null, steps: all, index: from })
  const where = chart && chartsOf(host).length > 1 ? ` on ${chart.label}` : ''
  const already = from > 0 ? ' You’re already part of the way there, so I started from where you are.' : ''
  const note = asked?.note ? `${asked.note} ` : ''
  return `${note}I’ve highlighted it${where} — follow the card (Next, Back or Exit). Nothing on your ${chart || surfaceOf(f) === 'charts' ? 'board' : 'page'} has changed.${already}`
}

// C1-025: the member's answer to a walkthrough the Agent offered ("Want me to show you?")
const OFFER_YES = /^(?:(?:yes|yeah|yep|yup|sure|ok(?:ay)?|please|go ahead|go on|sounds good)(?:[,!.]?\s*(?:please|thanks|thank you|do|show me))*|(?:please\s+)?show me(?:\s+(?:how|please|then))*)[.!]*$/i
/** The next message after an offered walkthrough → { say } when it is a yes (the walkthrough, started), else null. The offer
 *  is spent either way: a "no", or any other request, drops it. Starting it changes nothing on the board. */
export function acceptGuideOffer(text, host) {
  const o = takeGuideOffer()
  if (!o || !OFFER_YES.test(String(text || '').trim())) return null
  return { say: showFeature(guideFeature(o.feature), host, o.detail) }
}

/**
 * "now do it for me" after a walkthrough → null (not that) | { say } | { ask: { text, choices, ops, pickArg } } |
 * { ops } — the feature's EXISTING capability, aimed at the chart the walkthrough was on (if it is still there).
 */
const DO_IT = /^(?:(?:ok|okay|now|then|great|cool|alright|actually|no|nah)[,!.]?\s+)*(?:(?:can|could|would|will) you |please |just |go ahead and |i'?d rather you |i want you to )*(?:do it|do that|do this|change it|set it|you do it|do that one|handle it)(?: for me| instead| please| then| yourself)*[.!?]*$/i
export function doItForMe(text, host) {
  if (!DO_IT.test(String(text || '').trim())) return null
  // while a walkthrough is on screen it is the one meant, however long the member has been at it
  const running = guideState()
  const last = running ? { featureId: running.feature.id, chartRef: running.chartRef } : lastShownGuide()
  const f = last ? guideFeature(last.featureId) : null
  if (!f) return null
  const d = f.doIt || {}
  if (guideState()) endGuide('done')
  forgetLastShown()
  if (d.say || !d.action) return { say: d.say || 'Tell me exactly what to change and I’ll do it.' }
  if (surfaceOf(f) !== 'charts') return doOnPage(f, host)
  const charts = chartsOf(host)
  const chart = charts.find(c => c.ref === last.chartRef) || (charts.length === 1 ? charts[0] : null)
  if (!chart) return { say: `The chart I showed you isn’t on the board any more — tell me which chart, and what to change.` }
  const kind = getTargetKind(d.kind || 'chart')
  // ⭐ PHASE 3: a BOARD action about the chart shown (its link colour): the board entry, with the chart's widget id
  const snap = !kind ? null : d.widgetArg ? (kind.list(host) || [])[0] || null : (kind.list(host) || []).find(s => (s.chartRef || s.ref) === chart.ref)
  if (!snap) return { say: 'I can’t change that on this chart.' }
  const widget = d.widgetArg ? { [d.widgetArg]: String(chart.ref).split('~')[0] } : {}
  const ops = [{ action: d.action, target: snap.ref, args: { ...widget, [d.arg]: null, ...(d.extra || {}) } }]
  const choices = d.choicesFrom === 'quickIndicators' ? quickIndicators() : d.choices
  if (!choices?.length) return { say: 'Tell me which one and I’ll do it.' }
  return { ask: { text: `${d.ask} (on ${chart.label})`, choices: choices.map(([ref, label]) => ({ ref, label })), ops, pickArg: { action: d.action, arg: d.arg } } }
}

/** The page's own choices for a page feature's "do it for me" (never a hand list): the member's saved screens and
 *  UCT's starters, exactly as the page's Screen menu lists them. */
function pageChoices(from, host) {
  if (from === 'savedScreens') {
    let lib = null
    try { lib = host?.screenerPage?.saved?.() || null } catch { lib = null }
    return [...(lib?.saved || []), ...(lib?.starters || [])].filter(x => x.id && x.name).slice(0, 8).map(x => [x.id, x.name])
  }
  return []
}
/** ⭐ W2-C2 — DO IT FOR ME on a page: the feature's capability on the page's OWN target kind (the page host the
 *  member is on), asked first with the page's own choices; then the ordinary planner, policy, receipt and Undo. */
function doOnPage(f, host) {
  const d = f.doIt
  const pageName = surfaceOf(f).replace(/^./, ch => ch.toUpperCase())
  if ((host?.surface || 'charts') !== surfaceOf(f)) return { say: `That’s on the ${pageName} page — open it and ask me again there.` }
  const kind = getTargetKind(d.kind)
  const snap = kind ? (kind.list(host) || [])[0] || null : null
  if (!snap) return { say: `I can’t do that on this ${pageName} page.` }
  const choices = pageChoices(d.choicesFrom, host)
  if (!choices.length) return { say: 'You have no saved screens yet — save one from the Screen menu first.' }
  const ops = [{ action: d.action, target: snap.ref, args: { [d.arg]: null, ...(d.extra || {}) } }]
  return { ask: { text: d.ask, choices: choices.map(([ref, label]) => ({ ref, label })), ops, pickArg: { action: d.action, arg: d.arg } } }
}

let registered = false
export function registerGuideCapabilities() {
  if (registered) return
  registered = true
  const self = { ref: 'guide', label: 'UCT product guide (explain a term or feature; show where a control is, step by step)' }
  registerTargetKind({
    name: 'guide', boardScoped: false, selfDescribing: true, undoable: false,
    list: () => [self], read: (host, ref) => (ref === 'guide' ? self : null), stateOf: (s) => s,
    patch: () => null, commit: async () => true, landed: () => true, undoPatch: () => null, fingerprint: () => 'guide',
  })
  // in the model's context only when the message is about learning UCT (as indicatorCatalog is only for adds)
  registerContextProvider({
    key: 'guide',
    build: (host, refFor, { message, nl1 = false } = {}) => (nl1 || GUIDE_WORDS.test(String(message || ''))
      ? [{ ref: refFor('guide', 'guide'), label: self.label, features: featuresOn(host?.surface || 'charts').map(f => f.id).join(', ') }] : undefined),
  })

  // fastWhole: a question is read WHOLE ("the difference between an indicator AND a condition" is one question)
  const common = { surfaces: ['*'], target: 'guide', query: true, fastWhole: true }
  registerCapability({
    ...common,
    name: 'guide.explain',
    summary: 'Explain what a UCT term, indicator or feature IS (“what does ADR mean?”, “explain RSI”, “the difference between an indicator and a condition”), from UCT\'s own catalog. Changes nothing.',
    hints: 'target = the guide entry. topic = the member\'s words for what to explain (an indicator, a UCT term or feature). Prefer it for UCT\'s own indicators and features — its text is UCT\'s catalog. Use ONLY for "what is / what does / explain / difference" questions; a request to change something is a command — plan it.',
    args: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'], additionalProperties: false },
    // instant only for UCT's own meanings (a concept, a feature); "what is an EMA?" stays the model's
    fast: ({ raw, host }) => {
      const words = explainWords(raw)
      return words && explainTopic(words, host?.surface || 'charts')?.local ? { topic: words } : null
    },
    answer: (_snap, { topic }, host) => explainTopic(topic, host?.surface || 'charts')?.text
      || 'I don’t have UCT’s own explanation of that — ask me in other words, or ask what I can do.',
  })
  registerCapability({
    ...common,
    name: 'guide.show',
    summary: 'SHOW the member where a control is (on Charts, the Screener, Breadth, the Calendar or the Journal): highlight the real control on their screen with a short step-by-step card (Next / Back / Exit). Changes nothing — use it for "where do I…", "show me how to…", "how do I…" questions, never to do the thing.',
    hints: `target = the guide entry. feature = the walkthrough that teaches it: an id from the enum, each named for what it teaches (indicators, indicatorColor, drawing, multiChart, widgetResize, layoutSave, alertPrice, chartSetting…), and control for any other named control (a widget's button, a list's or a drawing's menu row: detail = the member's words); ${GUIDE_FEATURES.filter(f => f.surface).length} ids belong to other pages and work only there. detail = the member's own words for which one ("the RSI", "a rectangle", "2x2") or for the chart they named ("the NVDA chart", "the left chart"), when they named one. A request to DO it ("change my chart to weekly") is a command, not this.`,
    args: { type: 'object', properties: { feature: { type: 'string', enum: GUIDE_IDS }, detail: { type: ['string', 'null'] } }, required: ['feature', 'detail'], additionalProperties: false },
    absentAsNull: ['detail'],
    fast: ({ raw, host }) => {
      const q = String(raw || '').trim()
      if (!SHOW.test(q)) return null
      const here = host?.surface || 'charts'
      const f = matchFeature(q, null, here)
      // ⭐ words only a control in a place they did not name fits: never shown straight away, asked about (answer)
      if (!f && here === 'charts' && (readControl(q)?.say || readControl(q, { weak: true }))) return { feature: 'control', detail: q }
      // the words travel when they choose something: a family's row, or the chart they name
      if (f) return f.slots || namesAChart(q, chartsOf(host)) ? { feature: f.id, detail: q } : { feature: f.id }
      // a Charts feature marked `everyPage`, asked elsewhere: `answer` says where it lives (no model turn, nothing highlighted)
      const charts = here === 'charts' ? null : matchFeature(q, null, 'charts')
      return charts?.everyPage ? { feature: charts.id } : null
    },
    answer: (_snap, { feature, detail }, host, ctx) => {
      const f = guideFeature(feature)
      // ⭐ W2-C2: a feature of another page is never highlighted here (its control is not on this screen)
      const here = host?.surface || ctx?.surface || 'charts'
      if (f && surfaceOf(f) !== here) return surfaceOf(f) === 'charts' ? `${f.title} is on the Charts page — open Charts and ask me again there.` : `${f.title} is on the ${surfaceOf(f).replace(/^./, ch => ch.toUpperCase())} page — open it and ask me again there.`
      if (f && ctx && !guideFeatures(ctx).includes(f)) return `${f.title} isn’t available on your account here.`
      // ⭐ the named-control catalog: several controls fit → ask which; a drawing that has no such control → say so
      if (f?.id === 'control') {
        const r = readControl(detail) || readControl(detail, { weak: true })
        if (r?.say) return r.say
        if (!r?.row) return r?.ask ? askWhich(r.ask) : 'Which control do you mean? Tell me its name, or the widget it’s in.'
        return showFeature({ ...f, control: r.row.name }, host, detail)
      }
      return showFeature(f, host, detail)
    },
  })
}
