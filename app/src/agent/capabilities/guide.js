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
import { GUIDE_IDS, GUIDE_FEATURES, guideFeature, guideFeatures, matchFeature } from '../guide/registry'
import { explainTopic, explainWords } from '../guide/explain'
import { startGuide, lastShownGuide, forgetLastShown, endGuide, guideState } from '../guide/guideStore'
import { findTarget } from '../guide/targets'
import { catalogRows } from '../../components/chart/indicatorCatalog'
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
const needsChart = (f) => f.steps.some(s => typeof s.target === 'string' && s.target.startsWith('chart.'))

/** Start the walkthrough for one feature → the sentence the member reads (never claims what is not on screen). */
export function showFeature(f, host) {
  if (!f) return 'I don’t have a walkthrough for that yet — ask me what it does instead.'
  const chart = needsChart(f) ? guideChart(host) : null
  if (needsChart(f) && !chart) return `There’s no chart on this board to show that on. Add one from Widgets ▾ → Chart first.`
  const chartRef = chart?.ref || null
  // an optional opening step (the board's own watchlist) only when it is there
  const all = f.steps.filter(s => !s.optional || findTarget(s.target, { chartRef }))
  // ⭐ CONTEXT-AWARE: where the member already is. A step whose control is on screen BECAUSE the step before it was
  // done (Chart settings is open → its Indicators tab; the Indicators tab is open → its search box) is where the
  // walkthrough starts — never "open the gear" when the settings are already open.
  let from = 0
  for (let i = all.length - 1; i > 0; i--) {
    const prev = all[i - 1]
    if (prev.waitFor && findTarget(prev.waitFor, { chartRef }) && findTarget(all[i].target, { chartRef })) { from = i; break }
  }
  const steps = all.slice(from)
  const first = steps[0]
  if (!first || !findTarget(first.target, { chartRef })) {
    return `I can’t see ${f.control || 'that control'} on your screen right now — ${chart ? `${chart.label} may be scrolled out of view or covered by a panel` : 'a panel may be covering it'}. ${f.explain}`
  }
  if (guideState()) endGuide('replaced')
  startGuide(f, { chartRef, chartLabel: chart?.label || null, steps })
  const where = chart && chartsOf(host).length > 1 ? ` on ${chart.label}` : ''
  const already = from > 0 ? ' You’re already part of the way there, so I started from where you are.' : ''
  return `I’ve highlighted it${where} — follow the card (Next, Back or Exit). Nothing on your board has changed.${already}`
}

/**
 * "now do it for me" after a walkthrough → null (not that) | { say } | { ask: { text, choices, ops, pickArg } } |
 * { ops } — the feature's EXISTING capability, aimed at the chart the walkthrough was on (if it is still there).
 */
const DO_IT = /^(?:(?:ok|okay|now|then|great|cool|alright|actually)[,!.]?\s+)*(?:(?:can|could|would) you |please |just |go ahead and )*(?:do it|do that|do this|change it|set it|you do it|do that one)(?: for me| instead| please| then)*[.!?]*$/i
export function doItForMe(text, host) {
  if (!DO_IT.test(String(text || '').trim())) return null
  const last = lastShownGuide()
  const f = last ? guideFeature(last.featureId) : null
  if (!f) return null
  const d = f.doIt || {}
  if (guideState()) endGuide('done')
  forgetLastShown()
  if (d.say || !d.action) return { say: d.say || 'Tell me exactly what to change and I’ll do it.' }
  const charts = chartsOf(host)
  const chart = charts.find(c => c.ref === last.chartRef) || (charts.length === 1 ? charts[0] : null)
  if (!chart) return { say: `The chart I showed you isn’t on the board any more — tell me which chart, and what to change.` }
  const kind = getTargetKind(d.kind || 'chart')
  const snap = kind ? (kind.list(host) || []).find(s => (s.chartRef || s.ref) === chart.ref) : null
  if (!snap) return { say: 'I can’t change that on this chart.' }
  const ops = [{ action: d.action, target: snap.ref, args: { [d.arg]: null, ...(d.extra || {}) } }]
  const choices = d.choicesFrom === 'quickIndicators' ? quickIndicators() : d.choices
  if (!choices?.length) return { say: 'Tell me which one and I’ll do it.' }
  return { ask: { text: `${d.ask} (on ${chart.label})`, choices: choices.map(([ref, label]) => ({ ref, label })), ops, pickArg: { action: d.action, arg: d.arg } } }
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
      ? [{ ref: refFor('guide', 'guide'), label: self.label, features: GUIDE_IDS.join(', ') }] : undefined),
  })

  // fastWhole: a question is read WHOLE ("the difference between an indicator AND a condition" is one question)
  const common = { surfaces: ['charts'], target: 'guide', query: true, fastWhole: true, available: (ctx) => ctx.surface === 'charts' }
  registerCapability({
    ...common,
    name: 'guide.explain',
    summary: 'Explain what a UCT term, indicator or feature IS (“what does ADR mean?”, “explain RSI”, “the difference between an indicator and a condition”), from UCT\'s own catalog. Changes nothing.',
    hints: 'target = the guide entry. topic = the member\'s words for what to explain (an indicator, a UCT term or feature). Prefer it for UCT\'s own indicators and features — its text is UCT\'s catalog. Use ONLY for "what is / what does / explain / difference" questions; a request to change something is a command — plan it.',
    args: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'], additionalProperties: false },
    // instant only for UCT's own meanings (a concept, a feature); "what is an EMA?" stays the model's
    fast: ({ raw }) => {
      const words = explainWords(raw)
      return words && explainTopic(words)?.local ? { topic: words } : null
    },
    answer: (_snap, { topic }) => explainTopic(topic)?.text
      || 'I don’t have UCT’s own explanation of that — ask me in other words, or ask what I can do.',
  })
  registerCapability({
    ...common,
    name: 'guide.show',
    summary: 'SHOW the member where a Charts control is: highlight the real control on their board with a short step-by-step card (Next / Back / Exit). Changes nothing — use it for "where do I…", "show me how to…", "how do I…" questions, never to do the thing.',
    hints: `target = the guide entry. feature = one of: ${GUIDE_FEATURES.map(f => `${f.id} (${f.title.toLowerCase()})`).join('; ')}. A request to DO it ("change my chart to weekly") is a command, not this.`,
    args: { type: 'object', properties: { feature: { type: 'string', enum: GUIDE_IDS } }, required: ['feature'], additionalProperties: false },
    fast: ({ raw }) => {
      const q = String(raw || '').trim()
      if (!SHOW.test(q)) return null
      const f = matchFeature(q)
      return f ? { feature: f.id } : null
    },
    answer: (_snap, { feature }, host, ctx) => {
      const f = guideFeature(feature)
      if (f && ctx && !guideFeatures(ctx).includes(f)) return `${f.title} isn’t available on your account here.`
      return showFeature(f, host)
    },
  })
}
