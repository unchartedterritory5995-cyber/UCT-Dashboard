// ── UCT Agent CONVERSATION: TALK vs DO orchestration ─────────────────────────
//
// One hook owns the whole turn:
//
//   text ─► fastParse ──hit──► registry ops ─┐
//      └──miss──► POST /api/agent/turn ──────┤ envelope (answer | clarify | apply | propose | unsupported)
//                                            ▼
//          answer / clarify / unsupported ─► shown, NOTHING executes
//          apply / propose ─► planOps (validate ALL, compose) ─► policy.decideMode
//                 apply   ─► runtime.commitPlan (one write per target, read-back ACK) ─► receipt + Undo
//                 propose ─► stored proposal card ─► "Do it" re-plans the STORED ops against
//                            the current charts (never regenerates them) ─► commit
//
// The fast path and the model path meet at the same planner, so there is one
// execution path. Every real outcome (receipt, refusal, undo) is recorded to the
// conversation, so the model's next turn remembers what UCT DID.

import { protectionRefusal, undoProtectionRefusal, protectedOpenLayout, isProtected, protectedRenameRefusal } from './protectedLayouts'
import { chartRailRefusal, RAIL_MARK } from './chartRail'
import { replyRelation, QUESTION_TTL_MS, CONTINUE_CHOICES, continueQuestion } from './pendingTask'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AuthContext } from '../context/AuthContext'
import { useCreateIndicatorAccess } from '../components/chart/builder/studio/createIndicatorFlag'
import { useUserDefinitions, USER_DEFINITIONS_KEY } from '../hooks/useUserDefinitions'
import { mutate } from 'swr'
import { setOwnedDefinitionSource } from './capabilities/indicatorEdits'
import { setAuthoringSources, draftAmbiguity, selectDraft, isDraftAction, lastSaved, screenModelOps, PROPOSAL_TTL_MS, saveReferent, splitSaveAs, renameBeforeSave, explicitIndicatorCreate } from './capabilities/indicatorAuthoring'
import { fastParse, matchPosition } from './fastPath'
import { screenNewChart, screenEmptyBoardChart } from './capabilities/workspace'
import { resolveDeictic, screenDeicticOps, screenUnnamedTargets, pickedChoice, chartRefOf, selectedChart, chartNameWord, clausesNameDifferentCharts, targetTickerConflict, lowerTickerCandidates, TARGET_CHECK_FAILED } from './deixis'
import { screenWatchlistWidget } from './watchlistTarget'
import { whichListView, LIST_VIEW_WHICH } from './whichWidget'
import { checkSpatialConstraints, excludedCharts, spatialConstraints, UNPLACED, withoutExcludedCharts, everyExceptSet } from './spatialCheck'
import { groundSymbols, groundingOf } from './nl/tickers'
import { multiChartPlan, screenChartGrid, isWorkspaceRequest, gridChoiceFor } from './multiChart'
import { scopeHostToGrid } from './host'
import { screenGridOps, watchGridSync } from './gridMode'
import { boardRefusalIn } from '../pages/charts/boardBound'
import { chartFaultedSince, onChartFault } from '../pages/charts/chartFaults'
import { bindCreated } from './createdBinding'
import { planOps, prepareOps, collectTargets, undoNotesFor, approvalBinding, bindingDrift, splitMixedOps } from './executor'
import { notDoneLines } from './notDone'
import { decideMode } from './policy'
import { commitPlan, undoEntry, undoEntryFor } from './runtime'
import { pendingLines as pendingWording } from './proposalWording'
import { refsOf, checkRefs, consumedProducers, pendingLines, resolveRefs, expandOps, bindSourceRefs } from './compose'
import { traceStart, mark, traceEnd, turnStart, turnPath, turnVisible, turnOutput, turnOutputMs, turnMarkMs, turnEnd } from './trace'
import { buildContext, refreshContext, manifestFor, getCapability, getTargetKind, noTargetSentence, runWarmups, MANIFEST_VERSION, MANIFEST_CONTRACT, normalizeArgs } from './capabilities'
import { UNDO_ACTION } from './capabilities/about'
// the widget's own filter chips are not set from the Agent here (open owner decision); the member is pointed at the control itself
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { routingEnabled, routingNames, GROUPS as ROUTE_GROUPS, wordsSelect } from './routing'
import { pickRouter, routingV2Active } from './nlm1/flag'   // NLM-1 D1 (dark, two keys): routing v2, else v1's routeManifest
import { nlm1Rewrite, createReferents } from './nlm1/followups'   // NLM-1 D2/D3 (same two keys)
import { planCreatedReference } from './nlm1/plans'                 // NLM-1 D2 (same two keys), on Track A's bindCreated
import { resolveFollowUpOps, snapshotOf, rescopeOrdinal } from './nlm1/followupOps'   // NLM-1 D2/D3.1 (same two keys)
import { isStepPlan, prepareStepPlan, snapshotInstances, resolveResultRefs, readBackStepPlan } from './nlm1/stepPlans'   // NLM-1 step plans (same two keys)
import { doItForMe } from './capabilities/guide'
import { endForNewRequest } from './guide/guideStore'
import { createMemory, tickersOfAnswer } from './memory'
import { resolveReference, subjectTarget, pluralTarget, retargetCorrection } from './references'
import { resolveFollowUp, resolvePicked } from './conversation'
import { planCompound, resolveStep, chartsShowing, MAX_STEP_OPS, workspaceConflict, workspaceQuestion, workspaceSteps, WORKSPACE_CHOICES } from './compound'
import { screenDuplicateAdds, wantsCopy } from './duplicates'
import { nl1Enabled, exactLane, buildNl1Request, correctionPlan, preflightRefusals, repairedDisposition, withoutWordingApprovals } from './nl1/interpreter'
import { NL1_MAX_NEED } from './nl1/selection'
import { takeIndicatorTouches, takeIndicatorMentions, canonicalIndicatorAdds } from './capabilities/indicatorEdits'
import { correctTypos, lexiconFor, plainSymbolWord } from './nl/lexicon'
import { agentTurn, agentTurnStream, serverStreams, serverPlanner, loadAgentConfig, agentRecord, agentConversation, noteConversation, unknownSymbols } from './agentClient'
import { createStepRunner } from './steps'
import { AGENT_CONVERSATION_KEY, AGENT_INFLIGHT_KEY, readLocal, writeLocal } from './agentFlag'
import { presentOf, compactViews, itemsFromTurns, chartTarget } from './present'
import { KNOWLEDGE_REF } from './coach/brain'
import { isCoachMessage } from './capabilities/coach'
// ⭐ INDICATORS ⇄ AGENT (2026-10-12): the chart's Create Indicator / Modify doors open the Agent; the
// member's answer to its question runs the existing `indicator.draft` for that chart. See indicatorEntry.js.
import { beginAuthoringIntent, takeAuthoringIntent, peekAuthoringIntent, clearAuthoringIntent, authoringPrompt, authoringOp, isCancelWords, INDICATOR_DOORS, openIndicatorDoor } from './indicatorEntry'

registerBuiltins()

// ⛔ Charts operator P1 hardening: a model QUESTION's choices become buttons. Only a non-empty string, or an
// object with a non-empty string `label` (NL-1: plus a context `ref`, translated back to a real target), ever
// reaches the panel — a null, a number, a nested object is dropped, never rendered and never dereferenced.
const MAX_CHOICES = 12
const CHOICE_CHARS = 120
export function clarifyChoices(raw, refMap = null) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const c of raw) {
    if (out.length >= MAX_CHOICES) break
    const label = typeof c === 'string' ? c : (c && typeof c === 'object' && !Array.isArray(c) && typeof c.label === 'string' ? c.label : null)
    if (!label || !label.trim()) continue
    const ref = refMap && c && typeof c === 'object' && typeof c.ref === 'string' ? (refMap[c.ref]?.ref || null) : null
    out.push({ label: label.trim().slice(0, CHOICE_CHARS), ref })
  }
  return out
}
// ⛔ The SERVER refuses a model plan over the shared contract's maxOps (turn.py MAX_OPS); the panel holds a
// model plan to the same number before anything is planned (the client planner's own ceiling, executor
// MAX_OPS, is wider on purpose: it also carries the fast path's expansions).
export const MAX_MODEL_OPS = MANIFEST_CONTRACT.limits.maxOps
export const TOO_MANY_OPS = `That plan has more than ${MAX_MODEL_OPS} changes — UCT Agent makes at most ${MAX_MODEL_OPS} in one request, so nothing was changed. Ask for it in smaller parts.`

// An ARGUMENT that names another context target (widget.showList's `list` = a watchlist ref) is
// translated back like a target — only for the args a capability declares (`argRefs: {arg: kind}`),
// and only when the short ref really is a target of that kind; anything else stays as the model
// sent it, and the capability's check refuses it.
function argRefsBack(op, refMap, isAlias = () => false) {
  const decl = getCapability(op?.action)?.argRefs
  if (!decl || !op.args || typeof op.args !== 'object') return op.args
  const args = { ...op.args }
  for (const [arg, kind] of Object.entries(decl)) {
    const kinds = Array.isArray(kind) ? kind : [kind]
    const back = (v) => {
      if (isAlias(v, kinds)) return v
      const hit = typeof v === 'string' ? refMap[v] : null
      return hit && kinds.includes(hit.kind) ? hit.ref : v
    }
    args[arg] = Array.isArray(args[arg]) ? args[arg].map(back) : back(args[arg])
  }
  return args
}

// The model's short refs → real refs. ⛔ An ALIAS the plan itself declared (a creator's `as`,
// e.g. a new list "w1") wins over a context ref spelled the same way, for every LATER op that
// expects that kind — the model picks alias names freely, and "w1" may also be the short ref
// of an existing list (measured 2026-10-11: the fill went to the wrong list). Earlier ops, and
// ops expecting another kind, still read the context ref.
export function translateRefs(ops, refMap) {
  const aliasKind = {}
  const isAlias = (v, kinds) => typeof v === 'string' && aliasKind[v] != null && (!kinds || [].concat(kinds).includes(aliasKind[v]))
  return (ops || []).map((o) => {
    const cap = getCapability(o?.action)
    const target = isAlias(o?.target, cap?.target) ? o.target : (refMap[o?.target]?.ref || o?.target)
    const out = { ...o, target, args: argRefsBack(o, refMap, isAlias) }
    const c = cap?.creates?.(o?.args || {})
    if (c?.alias) aliasKind[c.alias] = c.kind
    return out
  })
}
// hotfix 2026-11-03: tab-adding actions — only when the member's own words say "tab"
const TAB_ADDS = new Set(['chart.addTab', 'widget.addTab'])
// Does a plan that adds tabs carry on the tab the member's previous message added? Only a short follow-up ("and a weekly one")
// on the very next message, every op the same tab action on the same widget. Memory's lifetime is no test: "the last change
// added a tab" stays true for half an hour, and any later request planned as tabs would pass (the 2026-11-03 hotfix's case).
const TAB_FOLLOW_MAX_WORDS = 6
export function continuesTabs(ops, lastTurn, turnNow, text) {
  if (!lastTurn || lastTurn.id !== turnNow - 1) return false
  const words = String(text || '').trim().split(/\s+/)
  if (words.length > TAB_FOLLOW_MAX_WORDS || /\bcharts?\b/i.test(text)) return false
  const added = new Set(lastTurn.ops.filter(o => TAB_ADDS.has(o?.action)).map(o => `${o.action}:${o.args?.widget}`))
  return ops.every(o => TAB_ADDS.has(o?.action) && added.has(`${o.action}:${o.args?.widget}`))
}
// hotfix 2026-11-03: a planned "change …, then undo it" whose change committed nothing undoable
// review F3: the refusal wording that would claim nothing changed
const DIDNT_CHANGE = /^I didn['’]t change anything/
const UNDO_HELD = 'I didn’t change or undo anything: that change needs your approval (or an answer) first, so I can’t make it and undo it in one request. Ask for the change on its own; once it has run, say “undo”.'
const UNDO_AFTER_NOTHING = 'I didn’t undo anything: the change before the Undo didn’t make a change I could take back (see above), so nothing was undone.'
// "undo that <noun> …" — the target kinds each noun names (F14)
const UNDO_ABOUT = { indicator: ['indicatorEdits', 'indicatorDrafts'], chart: ['chart'], widget: ['board', 'workspace'], drawing: ['drawing'], layout: ['layouts'] }
// ⭐ PHASE 3: "undo just the colour change" — a DESCRIPTION of the newest change, checked against what its receipt says
const UNDO_SAYS = { colour: /\bcolou?r|\bcolou?red\b/i, style: /\bstyle|dashed|dotted|solid|thick|thin|width/i, timeframe: /\btimeframe\b/i, symbol: /\bsymbol\b|\bticker\b/i,
  pane: /\bpane\b/i, layout: /\blayout\b/i, theme: /\btheme\b/i, resize: /\bresiz|\bsize\b|taller|shorter|wider|narrower/i, size: /\bresiz|\bsize\b|taller|shorter|wider|narrower/i, move: /\bmov(?:e|ed)\b/i, rename: /\brenam/i, link: /\blink/i }
// review F2 + #766 nit 1: a board / workspace write is a CHART change when what it STRUCTURALLY touched is a chart widget —
// a chart grid, charts added, a chart widget moved / resized / removed / restored — read from the entry's own patch and the
// board as it was before (never from the receipt's wording: "moved News next to the Chart" is a News change)
const typeOfIn = (raw, id) => (raw || []).find(w => String(w.id) === String(id))?.type || null
export function touchesCharts(it) {
  if (!it) return false
  if (it.kind === 'chart') return true
  const p = it.patch || {}
  if (it.kind === 'workspace') return (p.add || []).some(a => a?.type === 'chart')
  if (it.kind !== 'board') return false
  if (p.grid) return true
  if ((p.add || []).some(a => a?.type === 'chart')) return true
  const raw = it.before?.raw || []
  if ((p.restore || []).some(w => w?.type === 'chart')) return true
  return [...(p.remove || []), ...Object.keys(p.set || {})].some(id => typeOfIn(raw, id) === 'chart')
}
// W2 audit (live 2026-11-04): members call a grid / an arrangement of their widgets their LAYOUT — "undo the change you
// made to my layout" after a 2×2 grid was refused as "not a layout change". A board write that placed, re-tiled, added
// or removed widgets (structurally: its patch) is a layout change; a widget's settings / link colour alone is not.
const GEOM_KEYS = ['x', 'y', 'w', 'h']
export function arrangesBoard(it) {
  if (!it) return false
  const p = it.patch || {}
  if (it.kind === 'workspace') return (p.add || []).length > 0
  if (it.kind !== 'board') return false
  if (p.grid || (p.add || []).length || (p.remove || []).length || (p.restore || []).length) return true
  return Object.values(p.set || {}).some(d => d && GEOM_KEYS.some(k => k in d))
}
// round 3: "says:<word>" — a change described by a word its own receipt says ("rsi", "weekly"), whole word, any case
const escRe = (w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const saysWord = (about) => (String(about || '').startsWith('says:') ? new RegExp(`\\b${escRe(about.slice(5))}\\b`, 'i') : null)
const undoWordOf = (about) => (String(about || '').startsWith('says:') ? about.slice(5) : about)
const undoMatches = (about, entry) => (saysWord(about) ? saysWord(about).test((entry.lines || []).join(' ')) : UNDO_ABOUT[about] ? entry.items.some(it => UNDO_ABOUT[about].includes(it.kind))
  || (about === 'chart' && entry.items.some(touchesCharts))
  || (about === 'layout' && entry.items.some(arrangesBoard))
  : UNDO_SAYS[about] ? UNDO_SAYS[about].test((entry.lines || []).join(' ')) : true)
// ⭐ W2: words for the chart the conversation just made / last changed. "that one" / "that chart" always mean the subject
// (references.IT_WORDS); "the new one", "the chart you just added" only right after a turn that CREATED a widget.
const THAT_ONE = /\b(?:that one|that chart)\b/gi
const NEW_ONE = /\b(?:the|that|this) new (?:one|chart)\b|\bthe (?:one|chart) (?:you )?just (?:added|made|created|opened)\b|\bthe (?:one|chart) (?:you )?(?:added|made|created|opened)\b/gi
// ⭐ Multi Chart: "the one I just changed" is the member's last change, "the one you just changed" the Agent's, "the one we
// changed" whichever came last (`changed(who)`). Nothing to point at → the words are left alone, and the chart is asked for:
// `changed` with no `subject`. A clicked chart answers none of this: a click on a cell's own control selects that cell too, so
// after a member's change the "selected" chart is exactly the wrong guess for "the one you just changed".
const JUST_CHANGED = /\bthe (?:one|chart) (i|we|you) (?:just |last )?(?:changed|edited|updated|set|switched)\b/i
const CHANGED_BY = { i: 'member', you: 'agent', we: null }
const gridChanged = (host) => { const grid = host?.charts?.grid?.(); return grid ? (who) => grid.lastChanged(who) : null }
// → { text, subject }: `subject` = the chart "the new one" names (review #771: exactly ONE chart the latest committing request
// created — `created`, never the conversation subject a later step of that request moved). Several or none → the words
// are left alone (the instant path asks which chart; the model reads them).
export function asSubjectWords(text, created = null, changed = null) {
  const t = String(text || '')
  let out = t.replace(THAT_ONE, 'it')
  let subject = null
  const said = changed ? JUST_CHANGED.exec(t) : null
  const cell = said ? changed(CHANGED_BY[said[1].toLowerCase()]) : null
  if (cell) return { text: out.replace(JUST_CHANGED, 'it'), subject: cell, changed: true }
  if (said) return { text: out, subject: null, changed: true }
  NEW_ONE.lastIndex = 0
  if (NEW_ONE.test(t)) {
    NEW_ONE.lastIndex = 0
    const refs = Array.isArray(created) ? created : []
    if (refs.length === 1) { out = out.replace(NEW_ONE, 'it'); subject = refs[0] }
  }
  NEW_ONE.lastIndex = 0
  return { text: out, subject }
}
// the session memory with "it" bound to `subject` for this one message (the created chart)
const withSubject = (memory, subject) => (subject && memory
  ? { ...memory, subject: (kind, epoch) => (kind === 'chart' ? { ref: subject, symbol: null, at: Date.now(), epoch } : memory.subject(kind, epoch)) }
  : memory)
// review #771 (6): what a part of a split request IS, from its plan — "a new chart for QQQ", "the change to Chart (SPY)"
export function partLabel(ops, host) {
  const list = ops || []
  const adds = list.filter(o => getCapability(o?.action)?.creates?.(o.args || {}))
  if (adds.length) {
    const aliases = new Set(adds.map(o => String(getCapability(o.action).creates(o.args || {}).alias)))
    const syms = list.filter(o => o?.action === 'chart.setSymbol' && aliases.has(String(o.target))).map(o => String(o.args?.symbol || '').toUpperCase()).filter(Boolean)
    const types = [...new Set(adds.map(o => String(o.args?.type || 'widget')))]
    const n = adds.length
    const noun = types.length === 1 ? `${types[0]}${n > 1 ? 's' : ''}` : 'widgets'
    return `${n === 1 ? 'a new' : `${n} new`} ${noun}${syms.length ? ` for ${syms.join(', ')}` : ''}`
  }
  const labels = []
  for (const o of list) {
    const kind = getTargetKind(getCapability(o?.action)?.target)
    let label = null
    try { label = kind?.read?.(host, o.target)?.label || null } catch { label = null }
    if (!label) { try { label = host?.charts?.read?.(String(o.target))?.label || null } catch { label = null } }
    if (label && !labels.includes(label)) labels.push(label)
  }
  return labels.length ? `the change to ${labels.join(' and ')}` : 'the change to your existing widgets'
}
// the charts a committed plan aimed at, by the ref a chart is addressed by
function plannedChartRefs(plan, res) {
  const refs = new Set()
  for (const p of plan?.plans || []) {
    const kind = getTargetKind(p.kind)
    const ref = p.virtual ? res?.created?.[p.ref] : (p.kind === 'chart' ? p.ref : (kind?.groupOf ? kind.groupOf(p.ref) : null))
    if (ref) refs.add(String(ref))
  }
  return [...refs]
}
// How long a receipt answers for its chart: the render that throws waits for the bars of the change.
const FAULT_WATCH_MS = 8000
// ⭐ W2 (receipts): every chart a committed plan touched, read AFTER the commit — { label, symbol, tf, isNew } — so the
// receipt's one-liner names each chart with its symbol and timeframe (receiptView). Display only; never throws.
function receiptCharts(host, plan, res) {
  try {
    const out = []
    const seen = new Set()
    for (const p of plan?.plans || []) {
      const kind = getTargetKind(p.kind)
      const ref = p.virtual ? res?.created?.[p.ref] : (p.kind === 'chart' ? p.ref : (kind?.groupOf ? kind.groupOf(p.ref) : null))
      if (!ref || seen.has(ref) || (!p.virtual && p.kind !== 'chart' && !kind?.groupOf)) continue
      const c = host?.charts?.read?.(String(ref))
      if (!c?.symbol) continue
      seen.add(ref)
      out.push({ label: p.virtual ? null : (c.label || p.snap?.label || null), symbol: c.symbol, tf: c.tf || null, isNew: !!p.virtual })
    }
    return out.length ? out : null
  } catch { return null }
}
// ⭐ W2 AUDIT (live 2026-11-04, train 3): an indicator alert is ONE chart's — the same instance id (the default EMA 9 is
// "ovl:0" on every chart) is on every chart of the board. When the plan doesn't say which chart (`chart` null), the chart
// is resolved here, deterministically and in this order: the chart the member SELECTED, a chart the member's words name
// by its label ("Bottom-left chart (TSLA)" — a clicked choice), by its symbol (one chart), or by symbol + position. Still
// ambiguous → left null, and the capability asks which chart. The model's own `chart` is never overridden.
const CHART_SCOPED = new Set(['indicatorAlert.create'])
export function scopeChartOps(ops, host, words) {
  if (!(ops || []).some(o => CHART_SCOPED.has(o?.action) && o.args && o.args.chart == null)) return ops
  let charts = []
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  if (charts.length < 2) return ops
  const ref = (() => {
    // review #771 delta M2: what the member NAMES outranks the last-clicked chart — its label, then its symbol (one chart,
    // or symbol + position); a symbol on several charts with nothing else to tell them apart is ASKED, never the selection
    const t = String(words || '')
    const lower = t.toLowerCase()
    const byLabel = charts.filter(c => c.label && lower.includes(String(c.label).toLowerCase()))
    if (byLabel.length === 1) return byLabel[0].ref
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const bySym = charts.filter(c => c.symbol && new RegExp(`(^|[^A-Za-z])\\$?${esc(c.symbol)}(?![A-Za-z])`, String(c.symbol).length >= 3 ? 'i' : '').test(t))   // a 1–2 letter ticker only in capitals ("on", "a")
    if (bySym.length === 1) return bySym[0].ref
    if (bySym.length > 1) {
      const pos = bySym.filter(c => c.position && new RegExp(`\\b${esc(String(c.position).toLowerCase())}\\b`).test(lower))
      if (pos.length === 1) return pos[0].ref
      // several charts of the named symbol: the selected one only if it IS one of them, else asked
      try { const s = host?.charts?.selected?.(); if (s && bySym.some(c => c.ref === s)) return s } catch { /* no selection */ }
      return null
    }
    try { const s = host?.charts?.selected?.(); if (s && charts.some(c => c.ref === s)) return s } catch { /* no selection */ }
    return null
  })()
  if (!ref) return ops
  return ops.map(o => (CHART_SCOPED.has(o?.action) && o.args && o.args.chart == null ? { ...o, args: { ...o.args, chart: ref } } : o))
}
// review #771 delta H1/L3: a reply ANSWERS the model's open question only when it is a choice click, matches a choice, or
// is short with no action of its own ("Chart c3", "the left one", "TSLA") — anything else is a new request, routed fresh
const ANSWER_VERB = /\b(?:add|remove|delete|open|close|draw|put|make|change|switch|set|create|show|hide|move|alert|save|run|find|scan|undo|load|apply|swap|turn|give|rename|sort|copy|duplicate)\b/i
export function isShortAnswer(text, choices = [], answering = false) {
  if (answering) return true
  const t = String(text || '').trim().toLowerCase()
  if (!t) return false
  if ((choices || []).some(c => c?.label && t.includes(String(c.label).toLowerCase()))) return true
  return t.split(/\s+/).length <= 6 && !ANSWER_VERB.test(t)
}
// review gaps-5 (1): a message SETS ASIDE the open question only when it reads as a complete request of its OWN — an action
// verb or a tool / indicator noun, WITH its own object (a ticker, a date, a level, an indicator, a widget) — that names
// nothing the question offered or asked about. Anything that picks among the choices or the question's subject (a
// position, a symbol, a timeframe, a length, "instead / rather / go with / use / not the …") ANSWERS it. When unclear: an answer.
const REQUEST_VERB = /\b(?:add|remove|delete|open|draw|put|create|show|hide|move|alert|save|run|find|scan|swap|rename|sort|copy|duplicate|plot|load|apply|set up|set|build)\b/i
const REQUEST_NOUN = /\b(?:trend ?lines?|avwap|anchored vwap|fib\w*|rays?|rectangles?|alerts?|watch ?lists?|screens?|scans?|layouts?|widgets?|rsi|macd|vwap|bollinger|ema|sma|moving averages?)\b/i
// only an EXPLICIT pick ("instead", "go with", "the … one", "not the …") answers despite an action verb with new objects
const PICK_WORDS = /\b(?:instead|rather|go with|the (?:\w+ )?one|not the)\b/i
const sigTokens = (s) => new Set((String(s || '').toLowerCase().match(/[a-z0-9$.-]+/g) || [])
  .filter(w => w.length > 1 && !/^(?:the|a|an|my|on|in|to|of|for|and|or|chart|charts|one|this|that|it|do|you|mean|which|what|from|at|with|please)$/.test(w)))
export function isNewRequest(text, question = null) {
  const t = String(text || '').trim()
  if (!t) return false
  const raw = t.replace(/[.,!?]+/g, ' ')
  const tickers = (raw.match(/(?:^|\s)\$?([A-Z]{1,5})(?=\s|$)/g) || []).map(w => w.trim().replace('$', ''))
    .filter(w => !['I', 'A', 'UCT', 'OK'].includes(w))
  const lower = raw.toLowerCase()
  const action = REQUEST_VERB.test(raw) || REQUEST_NOUN.test(raw)
  if (!action) return false
  // delta review (1): the reply's OWN objects — tickers, dates, levels / lengths, indicators and tools it names
  const objects = new Set([
    ...tickers.map(x => x.toLowerCase()),
    ...(lower.match(/\b(?:nvda|tsla|aapl|amd|msft|amzn|meta|goog|googl|spy|qqq|iwm|nflx|avgo|mu|smci|pltr)\b/g) || []),
    ...(lower.match(/\b\d{4}-\d{2}-\d{2}\b|\$?\d+(?:\.\d+)?\b/g) || []).map(x => x.replace('$', '')),
    ...(lower.match(new RegExp(REQUEST_NOUN.source, 'gi')) || []).map(x => x.toLowerCase()),
  ])
  if (!objects.size) return false
  // gaps-5 nit: "set it at 70" / "draw it from 2026-10-10" — the reply's thing is a PRONOUN (the question's own subject) and
  // it brings only a value or a date: no ticker, indicator or tool of its own → it answers ("At what RSI level…?")
  const named = [...objects].filter(o => !/^(?:\d{4}-\d{2}-\d{2}|\d+(?:\.\d+)?)$/.test(o))
  if (!named.length && /\b(?:it|that|this|them|those)\b/i.test(raw)) return false
  // compared with the CHOICES only (what the question offered — never every word of the question, which names its topic)
  const offered = sigTokens((question?.choices || []).map(c => c?.label || '').join(' '))
  const fresh = [...objects].filter(o => !offered.has(o) && !o.split(/\s+/).every(w => offered.has(w)))
  if (!fresh.length) return false                                  // it only names what was offered: an answer
  if (PICK_WORDS.test(raw)) return false                           // an explicit pick among them
  return true
}
// the groups a question is ABOUT: those its request's own words named (never the always-on / budget fill)
const questionGroups = (words) => ROUTE_GROUPS.filter(g => !g.always && wordsSelect(g.id, words)).map(g => g.id)
const kindsOf = (ops) => [...new Set(ops.map(o => getCapability(o?.action)?.target).filter(Boolean))]
// ⭐ #988 (AUDIT ruling, option 2): "every chart except …" (spatialCheck.everyExceptSet) is asked about with the WHOLE set as ONE
// choice that names every chart — never one chart of it, so a partial set can't be picked. Only where a gate was about to ask
// (an ask is never added). The plan must be one uniform change (the same ops on each of its charts), so the set's ops are that
// change on each chart of the set, nothing else. → { text, choice: { ref, label, ops } } or null.
function everyExceptQuestion(host, ops, text) {
  try {
    const live = host?.charts?.list?.() || []
    const ev = everyExceptSet(text, live, selectedChart(host))
    if (!ev || !ops?.length) return null
    const kinds = kindsOf(ops)
    if (kinds.length !== 1) return null
    const k = getTargetKind(kinds[0])
    const list = k?.list(host) || []
    const sig = (o) => JSON.stringify([o.action, o.args || {}])
    const byChart = new Map()
    for (const o of ops) {
      const snap = list.find(x => x.ref === o.target)
      const c = snap ? chartRefOf(k, snap) : null
      if (!c) return null
      byChart.set(c, [...(byChart.get(c) || []), o])
    }
    const shapes = [...byChart.values()].map(os => os.map(sig).sort().join('|'))
    if (new Set(shapes).size !== 1) return null
    const tpl = [...byChart.values()][0]
    const set = live.filter(c => ev.refs.includes(c.ref))
    const out = []
    for (const c of set) {
      const snap = list.find(x => chartRefOf(k, x) === c.ref)
      if (!snap) return null
      for (const o of tpl) out.push({ ...o, target: snap.ref })
    }
    const labels = set.map(c => c.label || c.symbol || c.ref)
    const label = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    return { text: set.length === 1 ? `Did you mean ${label}? Nothing has changed yet.` : `Did you mean these ${set.length} charts: ${label}? Nothing has changed yet.`, choice: { ref: `set:${set.map(c => c.ref).join(',')}`, label, ops: out } }
  } catch { return null }
}
// GATE C: a committed plan → session memory, every target as its CHART ref (a kind's `groupOf`), with
// the chart's symbol after the change. Never throws (memory is a convenience, not a gate).
// ⭐ W2 (context across turns): `created` = the commit's alias → real ref map. A widget this change CREATED is what its ops
// were about — "add a QQQ chart" then "change it to weekly" / "add the 20 EMA to that one" means the chart just created, so
// the creating op and every op aimed at its alias are remembered on the REAL chart (never on 'workspace' or the alias)
function rememberChange(memory, host, ops, undoId = null, created = null) {
  try {
    const real = (o) => {
      if (!created) return o
      const made = getCapability(o.action)?.creates?.(o.args || {})
      if (made?.alias && created[made.alias]) return { ...o, target: created[made.alias] }
      return typeof o.target === 'string' && created[o.target] ? { ...o, target: created[o.target] } : o
    }
    const asChart = (o) => { const k = getTargetKind(getCapability(o.action)?.target); return k?.groupOf ? (k.groupOf(o.target) ?? o.target) : o.target }
    const clean = (ops || []).filter(o => o?.action && typeof o.target === 'string').map(real).map(o => ({ ...o, target: asChart(o) }))
    const refs = [...new Set(clean.map(o => o.target))]
    const sym = refs.length === 1 ? host?.charts?.read?.(refs[0])?.symbol || null : null
    memory?.seeBoard(visitOf(host))       // refs from an earlier visit go first; this change is on THIS one
    memory?.noteChange({ ops: clean, epoch: epochOf(host), chartSymbol: sym, undoId })
    // the indicator a confirmed add / edit touched ("make it a 9"), taken from Indicators' own receipt —
    // ⭐ PHASE 2: every one this plan confirmed, in order (the last is the subject, as before)
    for (const t of takeIndicatorTouches()) memory?.noteIndicator({ chart: t.chartRef, instanceId: t.instanceId, defId: t.defId, label: t.name, epoch: epochOf(host) })
    for (const t of takeIndicatorMentions()) memory?.noteMention({ chart: t.chartRef, instanceId: t.instanceId, epoch: epochOf(host) })
  } catch { /* memory is best-effort */ }
}
// session memory → the refs the model was given (subject chart; ⭐ PHASE 2: each recent indicator's chart as its
// indicatorEdits entry — the `target` an indicator change takes — an indicator whose chart has no ref is left out)
export function withModelRefs(m, back) {
  const out = m.subject_chart ? { ...m, subject_chart: back[m.subject_chart] || null } : { ...m }
  if (Array.isArray(m.recent_indicators)) {
    const inds = m.recent_indicators.map(i => ({ target: back[`ixe:${i.chart}`] || null, id: i.id, name: i.name })).filter(i => i.target)
    if (inds.length) out.recent_indicators = inds
    else delete out.recent_indicators
  }
  return out
}
// ⭐ PHASE 2: words that point back at what the conversation did — the follow-up reader goes first for these
const FOLLOW_CUES = /\b(?:it|that|this|them|those|these|both|first|second|third|last|other|others|rest|fast|faster|fastest|slow|slower|slowest|short|long|same|match|look like|next to|just added|i added|new one|everywhere|all of them|all my|every)\b/i
// GATE C: a message that corrects the last one ("no, I meant…", "not that", "wrong one", "I said…")
const CORRECTION = /^(?:no|nope|nah|not that|not those|wrong|that's wrong|that is wrong|actually,? i meant|i meant|i said|i asked for)\b/i
// Which board the host is showing (null for hosts without layouts).
const epochOf = (host) => (typeof host?.epoch === 'function' ? host.epoch() : null)
// How many times a layout has been opened in this tab (null for hosts without layouts).
const visitOf = (host) => (typeof host?.boardVisit === 'function' ? host.boardVisit() : null)
// A proposal is pinned to the board only if it touches something ON the board.
const boardEpoch = (host, ops) => (kindsOf(ops).some(k => getTargetKind(k)?.boardScoped !== false) ? epochOf(host) : null)
// ⛔ F6 — what an approval binds to: each target kind may SEAL its planned change (the M3 Save
// does: draft, revision, name, target definition, acknowledgement, summary, charts, expiry).
// The seals and the exact card lines are kept with the proposal; Apply plans from them.
const sealsOf = (plan) => (plan?.plans || []).map(p => { try { return getTargetKind(p.kind)?.seal?.(p) || null } catch { return null } }).filter(Boolean)
const sameLines = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || [])
const STALE_PROPOSAL = 'so nothing was changed — ask again and I’ll show you the current version.'
// ⛔ APPROVAL BINDING (Gate C safety fix, 2026-10-16) — see executor.approvalBinding. Every proposal
// carries the binding of the plan it showed and expires after PROPOSAL_TTL_MS; "do it" re-reads what
// can be re-read from its authority, re-plans, and runs only on an identical binding.
const boundRefusal = (why) => `That proposal can’t run as you approved it — ${why} — ${STALE_PROPOSAL}`
/** Before an approved plan is re-planned, every target whose kind can re-read it from its authority
 *  (the server) does — a change made in another tab or on another device is then seen. A kind that
 *  cannot re-read right now FAILS CLOSED: the approval is refused and nothing is written.
 *  → null, or the sentence to refuse with. */
async function refreshForApproval(host, ops) {
  const seen = new Set()
  for (const o of ops || []) {
    const cap = getCapability(o?.action)
    if (!cap || cap.query || o.target == null) continue
    const kind = getTargetKind(cap.target)
    if (!kind?.refreshForApproval) continue
    const key = `${cap.target}|${o.target}`
    if (seen.has(key)) continue
    seen.add(key)
    let r
    try { r = await kind.refreshForApproval(host, o.target) } catch { r = { ok: false } }
    if (!r?.ok && r?.why) return `That proposal can’t run as you approved it — ${r.why} — ${STALE_PROPOSAL}`
    if (!r?.ok) return `I couldn’t re-check ${r?.what || 'what it changes'} against your account just now, so nothing was changed — try “do it” again in a moment, or ask again.`
  }
  return null
}
// ⭐ F5 — the SAME change on several charts ("add this indicator to both charts"): a capability that
// declares `fanOut` is run once per target, each as its own ordinary execution (own plan,
// permission check, persistence, receipt and Undo) — never a second engine, never one write.
function fanOutOf(ops) {
  if (!Array.isArray(ops) || ops.length < 2) return null
  const cap = getCapability(ops[0]?.action)
  if (!cap?.fanOut) return null
  const args = JSON.stringify(ops[0].args ?? null)
  if (!ops.every(o => o?.action === ops[0].action && JSON.stringify(o.args ?? null) === args)) return null
  if (new Set(ops.map(o => o.target)).size !== ops.length) return null
  return ops
}

// ⭐ DEFERRED steps (a capability with `deferred: true`, e.g. watchlist.open): in a request that
// also does other things, they run AFTER the rest has landed — as their own execution with their
// own receipt and Undo, aimed at what the rest created (an alias → its real id). If one cannot
// run, what the rest did STAYS (a new list is never deleted because it could not be opened) and
// the member is told exactly that. Never a way around approval: they are on the same card.
const isDeferred = (o) => !!getCapability(o?.action)?.deferred
// ⭐ C2: "add AMD to my Momentum list and save this layout as Swing 2". A save is `exclusive` because it takes the board as it
// is, has no Undo and is bound to that board on its card, so it can't commit inside another change. As the LAST step of a plan
// it needs none of that: it is a deferred step, run once the rest has landed, on the board the rest left. A rest that failed or
// wasn't saved never reaches it. Anywhere but last it would save a board the member asked to change afterwards, so it stays
// refused, and so does a rest that is itself exclusive (opening a layout) or changes the layouts.
const SAVES_THE_BOARD = new Set(['layout.saveAs', 'layout.saveCurrent'])
function saveRunsLast(ops) {
  if (!Array.isArray(ops) || ops.length < 2 || !SAVES_THE_BOARD.has(ops[ops.length - 1]?.action)) return false
  return ops.slice(0, -1).every(o => {
    const c = getCapability(o?.action)
    return !!c && c.target !== 'layouts' && (!c.exclusive || c.sequential)
  })
}
// ⛔ LT-15: what a query that came back with NOTHING to show says (never an empty row after a reply that announced it)
export const NO_RESULT = "I couldn't get a result for that, so there is nothing to show. Try asking again."
/** True when a capability's answer carries nothing the member could see (no text, table, view, link or chart). */
// (the keys are the ones present.js presentOf renders — text, table, present, link, chart — plus storedAs; a new visible
// answer field added there must be added here too, or that answer would be replaced by NO_RESULT)
export function emptyAnswer(a) {
  if (a == null) return true
  if (typeof a === 'string') return !a.trim()
  if (typeof a !== 'object') return true
  return !String(a.text || '').trim() && !a.table && !a.present && !a.link && !a.chart && !a.storedAs
}
// a model reply that only acknowledges (the receipt that follows is the real confirmation)
export const BARE_ACK = /^(?:on it|sure(?: thing)?|ok(?:ay)?|got it|will do|doing (?:it|that)(?: now)?|right away|coming (?:right )?up|done|one moment|one sec)[.!…]*$/i
// alias → the name a creator in these ops will give it (watchlist.create's `as`)
function aliasNames(ops) {
  const out = {}
  for (const o of ops || []) {
    const c = getCapability(o?.action)?.creates?.(o.args || {})
    if (c?.alias && c.spec?.name) out[c.alias] = c.spec.name
  }
  return out
}
// A deferred op re-aimed at what was created: aliases in its target / args → real refs. ⭐ W1-B B-07: when the step's own
// kind addresses a chart by a derived ref (a chart's indicators: `ixe:<chart>`), the created CHART's ref is translated
// with that kind's `fromChart` — "open two charts … with the 9 and 20 ema on both" lands its indicator steps on the
// charts the same request just added (the adds fit in empty space, so nothing was gridded).
function landDeferred(ops, created, names, approved = false) {
  const real = (v) => (typeof v === 'string' && created?.[v] ? created[v] : v)
  const realTarget = (o) => {
    const r = real(o.target)
    if (r === o.target) return r
    const k = getTargetKind(getCapability(o.action)?.target)
    return typeof k?.fromChart === 'function' ? k.fromChart(r) : r
  }
  const made = Object.entries(names).filter(([a]) => created?.[a])
  const pendingLists = Object.fromEntries(made.map(([a, n]) => [created[a], n]))
  const followNote = made.length
    ? `${made.map(([, n]) => `“${n}”`).join(' and ')} ${made.length === 1 ? 'was' : 'were'} still created and filled — say “open ${made[0][1]}” to try again.`
    : 'The rest of your request was done.'
  return ops.map(o => ({
    action: o.action, target: realTarget(o),
    args: Object.fromEntries(Object.entries(o.args || {}).map(([k, v]) => [k, real(v)])),
    pendingLists, followNote,
    // a step that was ON the card the member approved runs as approved (re-validated, never re-asked). Not saving over the open
    // layout: that replaces its saved copy with no Undo, and what was on the card was the board before this request changed it
    ...(approved && o.action !== 'layout.saveCurrent' ? { approvedStep: true } : {}),
  }))
}

// ⛔ A RECEIPT CLAIMS ONLY WHAT IS PROVEN. A change to the board is on screen the moment it
// lands, but it is SAVED only when the server accepts the workspace write (which a newer change
// in another window can refuse). The board host's `persist()` writes it now and answers with
// the server's verdict; until it says ok, the receipt says "on screen, not saved" and offers no
// Undo (an Undo of something that was never saved would be a second unsaved change).
const INFLIGHT_TTL_MS = 30 * 60 * 1000
// What a plan DOES, in the member's words ("Create 2 charts: SPY, QQQ") — to recognise the same
// change coming back after a reload. Not the raw ops: their refs are minted per page load.
const planSig = (lines) => JSON.stringify(lines || [])

const UNSAVED_NOTE = {
  conflict: 'Shown on this screen but NOT saved: your workspace was changed in another window or device. Reload to see the current workspace (reloading discards this change).',
  'not-saved': 'Shown on this screen, but the save was not confirmed — it is not saved yet.',
  'not-synced': 'Drawn on this device, but syncing it to your account was not confirmed yet — keep this tab open a few seconds; closing it now may lose the change.',
  slow: 'On your screen. The save is taking longer than usual; this updates when it answers. Until then, “undo” would take back your change before this one, not this one.',
}
// Drawings reach the account through the tracings sync, not the board save: wait for the server's
// copy of each touched symbol to match (host.drawings.confirm). Same rule as a board change: until
// confirmed, the receipt says so and offers no Undo.
async function confirmDrawings(host, refs) {
  if (!host?.drawings?.confirm || !refs.length) return { ok: true }
  for (const ref of [...new Set(refs)]) {
    try {
      const r = await host.drawings.confirm(ref)
      if (!r?.ok) return { ok: false, reason: r?.reason || 'not-synced' }
    } catch { return { ok: false, reason: 'not-synced' } }
  }
  return { ok: true }
}
const drawingRefsOfPlan = (plan) => (plan?.plans || []).filter(p => p.kind === 'drawing' && p.changed).map(p => p.ref)
// ⭐ LATENCY: a target kind whose commit ALREADY saved its change and read it back (`persistsInCommit`,
// e.g. indicator edits) needs no second, identical board write after it. Only when every changed
// target is such a kind; anything else is saved exactly as before.
const selfSaved = (items) => {
  const changed = (items || []).filter(p => p && p.changed !== false)
  return changed.length > 0 && changed.every(p => getTargetKind(p.kind)?.persistsInCommit === true)
}
// W2 audit (live 2026-11-04): a change that touched ONLY the board's widgets (board / workspace kinds — a chart grid, adds,
// arrangement) does not wait on unrelated preference writes (the new charts' own chart_settings writes as they load):
// its receipt follows the board's own save. Any other kind waits exactly as before.
const BOARD_ONLY = new Set(['board', 'workspace'])
// A ticker or timeframe change lives in the layout and the link-group tickers, which persist writes itself: the reload a chart
// does for it (and any chart_settings write from that) is not this change's save. Its conflicts are still checked.
const LAYOUT_ONLY = new Set(['chart.setTimeframe', 'chart.setSymbol'])
async function persistBoard(host, ops) {
  if (!host?.persist || boardEpoch(host, ops) == null) return { ok: true }
  try {
    // ops aimed at a widget this same change creates (a new chart born on its ticker) are part of the board write
    const made = new Set(ops.map(o => getCapability(o?.action)?.creates?.(o.args || {})?.alias).filter(Boolean).map(String))
    const own = ops.filter(o => !made.has(String(o?.target)))
    const boardOnly = kindsOf(own).length > 0 && (kindsOf(own).every(k => BOARD_ONLY.has(k)) || own.every(o => LAYOUT_ONLY.has(o?.action)))
    const r = await host.persist(boardOnly ? { settle: [] } : undefined)
    return r && r.ok ? { ok: true } : { ok: false, reason: (r && r.reason) || 'not-saved' }
  } catch {
    return { ok: false, reason: 'not-saved' }
  }
}

// ⛔ The panel can't stay locked on a save that won't answer, and a slow save is not a failed one (a chart grid's has run 30 s+).
// At the deadline the panel is freed and the receipt says the save is still going; the save's OWN answer settles it whenever it
// comes: Undo if it landed, the real reason if not (a conflict stays a conflict). A save queued behind a slow one waits the
// same way, so it is never reported as failed for the time it spent in the queue.
export const SAVE_WAIT_MS = 90000
// (`p` never rejects: its caller turns a throw into a not-saved answer, so there is no rejection to forward)
const withinSaveWait = (p) => new Promise((resolve) => {
  const t = setTimeout(() => resolve({ ok: false, reason: 'slow', late: p }), SAVE_WAIT_MS)
  p.then((v) => { clearTimeout(t); resolve(v) })
})

// one ticker search for a word in a chart's place: bounded, because it holds the turn. No answer in time is an unread word (the gates ask)
export const NAME_SEARCH_MS = 1500
const nameSearch = (word) => new Promise((resolve) => {
  const t = setTimeout(resolve, NAME_SEARCH_MS)
  groundSymbols([word]).catch(() => {}).finally(() => { clearTimeout(t); resolve() })
})
// …several words at once (the target-ticker check's lowercase words), one bound for all of them
const nameSearchAll = (words) => new Promise((resolve) => {
  const t = setTimeout(resolve, NAME_SEARCH_MS)
  groundSymbols(words).catch(() => {}).finally(() => { clearTimeout(t); resolve() })
})

// the server's stage timings (ms only) for the turn trace
const stagesOf = (data) => { const s = data?.usage?.stages; return s && typeof s === 'object' ? JSON.stringify(s) : null }

let _id = 0
const nid = () => `i${Date.now().toString(36)}${(_id++).toString(36)}`
const UNDO_MAX = 20
// a change's Undo entry goes where the change happened: a save that answers late never puts it on top of newer changes
const atCommitOrder = (stack, entry) => {
  const i = stack.findIndex(e => (e.at || 0) > (entry.at || 0))
  return (i < 0 ? [...stack, entry] : [...stack.slice(0, i), entry, ...stack.slice(i)]).slice(-UNDO_MAX)
}

// A reason may already be a whole sentence of its own ("I didn't change it: …  Nothing was changed."): it is said once
const PREFIX_SAID = /^I didn['’]t (?:change|add) (?:it|anything):\s*/
const SUFFIX_SAID = /\s*Nothing (?:was|has) changed(?: yet)?\.?$/
const bareReason = (r) => String(r ?? '').replace(PREFIX_SAID, '').replace(SUFFIX_SAID, '')
export function refusalText(refusals) {
  const reasons = [...new Set(refusals.map(r => bareReason(r.reason)))]
  return reasons.length === 1
    ? `I didn't change anything: ${reasons[0]}`
    : `I didn't change anything:\n${reasons.map(r => `- ${r}`).join('\n')}`
}

// NLM-1 all-or-nothing (#806): a step READ (not run) that would not run — no ops, a refusal, too many changes
const stepUnread = (r) => !!r && !r.noop && (!!r.say || !r.ops?.length || r.ops.length > MAX_STEP_OPS)
// the up-front check can judge only a step that stands on its own: one that refers back ("make it orange" after "…, add
// the 21 ema") reads only once the step before it has run — the run itself (`whole`) is all or nothing for those
const refersBack = (t) => /\b(?:it|its|them|they|that|those|this|these|the new one|the new chart|the same)\b/i.test(String(t || ""))
// (`read`: the panel's own step reader — the same one the run uses)
const preUnread = (step, read) => step.kind !== 'undo' && !refersBack(step.text) && stepUnread(read(step, null))

export default function useAgent({ host: workspaceHost, gridMode = false, surface = 'charts' }) {
  // ⭐ Multi Chart: while the grid is on screen the Agent's charts are its cells, and the hidden board is not a target
  const host = useMemo(() => (gridMode ? scopeHostToGrid(workspaceHost) : workspaceHost), [gridMode, workspaceHost])
  // Create Indicator access — the button's own rule (Indicators' createIndicatorAccess: admin +
  // this browser's flag, or the server cohort). It makes indicator.openCreate available or not;
  // the chart's opener re-checks it, and /converse enforces it server-side.
  const createIndicator = useCreateIndicatorAccess(useContext(AuthContext))
  const capCtx = useMemo(() => ({ surface, createIndicator }), [surface, createIndicator])
  // INDICATORS M2 — the member's OWN saved definition ids (server rows), read fresh by the
  // Indicators permission check at plan, apply and Undo.
  const { rows: ownedDefinitionRows } = useUserDefinitions()
  const ownedRowsRef = useRef(ownedDefinitionRows)
  ownedRowsRef.current = ownedDefinitionRows
  useEffect(() => { setOwnedDefinitionSource(() => (ownedRowsRef.current || []).map(r => r && r.def_id).filter(Boolean)) }, [])
  // INDICATORS M3 — read at every specialist call (never captured when the conversation began)
  const accessRef = useRef(createIndicator)
  accessRef.current = createIndicator
  useEffect(() => { setAuthoringSources({ access: () => accessRef.current === true, rows: () => ownedRowsRef.current || [] }) }, [])
  // M3: a just-saved indicator is added only once the member's own list carries it (the store's
  // list, refreshed now) — bounded; if it never shows, the add refuses with M2's own sentence.
  const definitionListed = useCallback(async ({ defId, version }, ms = 8000) => {
    const has = () => (ownedRowsRef.current || []).some(r => r && r.def_id === defId && r.version >= version)
    if (has()) return true
    try { mutate(USER_DEFINITIONS_KEY) } catch { /* the wait below is the check */ }
    const until = Date.now() + ms
    while (!has() && Date.now() < until) await new Promise(r => setTimeout(r, 100))
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    return has()
  }, [])
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  // the member's line and "typing…" are on screen: the turn's first visible feedback
  useEffect(() => { if (busy) turnVisible() }, [busy])
  // ⛔ ONE thing at a time: a send, an Apply, an Undo or a choice. A ref (not the
  // `busy` state) so two clicks in the same tick cannot both get through; every
  // entry point the panel calls takes it, and the internal calls send() makes
  // ("undo" / "do it" typed) run inside the lock it already holds.
  const lockRef = useRef(false)
  // ⛔ A late save's Undo entry waits for the running request to end: that request tells its own changes from the entries that
  // appear while it runs (groupFresh, a step's "undo that"), so an entry landing mid-request would be taken for one of its own
  const lateUndoRef = useRef([])
  // ⛔ The ONE way the lock opens (a click's request here, a typed one in send): whatever a request held back lands as it ends
  const releaseLock = useCallback(() => {
    lockRef.current = false
    for (const e of lateUndoRef.current.splice(0)) undoRef.current = atCommitOrder(undoRef.current, e)
    setBusy(false)
  }, [])
  const exclusive = useCallback((fn) => async (...args) => {
    if (lockRef.current) return undefined
    lockRef.current = true
    const traced = turnStart('click')
    setBusy(true)
    try { return await fn(...args) } finally { releaseLock(); if (traced) turnEnd() }
  }, [releaseLock])
  const [conversationId, setConversationIdState] = useState(() => readLocal(AGENT_CONVERSATION_KEY))
  const conversationRef = useRef(conversationId)
  noteConversation(conversationRef.current)   // W1-C C-01: the chat restored from localStorage counts from the first render
  const pendingRef = useRef(null)           // { kind:'proposal', id, ops } | { kind:'target', ops, path }
  // INTERRUPTED EXECUTION. A board change is marked in-flight (this browser) before its first
  // write and cleared at its receipt. A mark that survives a reload means the change was cut off
  // part-way — some of it may already be on the board, and the Agent cannot know how much. The
  // member is told; and the SAME plan, if it comes back, is proposed with a warning instead of
  // run blind (re-running it would e.g. build the charts a second time). Best-effort, per
  // browser: not an exactly-once guarantee.
  const interruptedRef = useRef(null)       // { sig, lines, at } from a mark found at load
  const undoRef = useRef([])                // newest last
  const lastActionsRef = useRef([])         // actions of the last plan (routing keeps follow-ups' groups)
  const saidRef = useRef('')                // the member's words this turn (how much an answer shows)
  const memoryRef = useRef(null)            // GATE C session memory (agent/memory.js) — this chat only
  const tapRef = useRef(null)               // ⭐ PHASE 2: outcome kinds recorded while one step of a multi-step request runs
  const undoAfterRef = useRef(null)         // hotfix 2026-11-03: a model plan "change …, then undo it" — the Undo waits for the change
  const undoneFirstRef = useRef(false)      // review F3: a planned Undo ran FIRST this turn — a later "didn't change anything" isn't true
  const createdRef = useRef(null)           // review #771: { turn, refs } — the charts the latest committing request created
  const referentsRef = useRef(null)         // NLM-1 D3 (dark): member turn id → the text it was read as (nlm1/followups.js)
  const stepPlanRef = useRef(null)          // NLM-1 step plans (dark): the structured plan now running { ops, steps, before }
  const readBackRef = useRef(null)          // NLM-1 step plans (dark): reads the plan back once it has run (set below)
  if (!referentsRef.current) referentsRef.current = createReferents()
  const questionSetAsideRef = useRef(false) // LT-5/6: this turn's message set the open question aside (a new request)
  const askedGroupsRef = useRef(null)       // W2 AUDIT: the routing groups the model's open question was asked with
  const lastRoutedRef = useRef(null)        // this turn's routed groups (legacy request), for a question it asks
  const notDoneRef = useRef(null)           // W2 audit: this turn's fixed "Not done: …" sentences (notDone.js)
  const lastUndoRef = useRef(null)          // review F5: how the last doUndo ended — 'ok' | 'unsaved' | 'refused' | 'none'
  const runCompoundRef = useRef(null)       // ⭐ PHASE 3 acceptance: approve() resumes a whole workspace (defined after it)
  // PLANNER v2 (Wave 1 A-05, agent/steps.js): null unless /api/agent/config says planner 'v2' — then every model
  // turn is the server's step loop, each step through the same `execute`. v2TapRef collects the record bodies of
  // one step (its outcome goes back to the server); v2DepsRef hands the runner the current closures.
  const v2Ref = useRef(null)
  const v2TapRef = useRef(null)
  const v2DepsRef = useRef(null)
  // NL-1 (flag off by default): the question UCT is waiting on, sent to the model with the next message
  // (pending_question) so a TYPED answer is read with the question in front of it
  const lastQuestionRef = useRef(null)      // the newest question shown (local or the model's)
  const pendingQuestionRef = useRef(null)   // the MODEL's open question: { text, choices: [{ label, ref }] }
  // P2-B: the member's words the model's open question is ABOUT ("make the right chart cleaner" → "Hide volume"):
  // an answer is read with them when deciding which charts the member named. Kept for the very next message only.
  const askedForRef = useRef(null)
  const askedAtRef = useRef(0)              // hotfix 11-13: when the model's open question was asked (pendingTask QUESTION_TTL_MS)
  // ⛔ CHART RAIL (hotfix 11-13, chartRail.js): this turn's words — the message, plus the request an answered question carried
  const railWordsRef = useRef('')
  const resumeRef = useRef(null)            // pendingTask: restores (yes) or withdraws (no) a held reply's pending task
  const railOf = (plan, mode) => chartRailRefusal(plan, { words: railWordsRef.current, host, mode })
  if (!memoryRef.current) memoryRef.current = createMemory()
  const [, force] = useState(0)
  const rerender = () => force(n => n + 1)

  const setConversationId = useCallback((id) => {
    conversationRef.current = id
    setConversationIdState(id)
    writeLocal(AGENT_CONVERSATION_KEY, id)
    noteConversation(id)                 // W1-C C-01: capabilities key their server-kept state (lastScreen) by it
  }, [])

  // `at`: when the line joined the chat (the panel shows it beside the sender's name).
  // ⛔ Never an EMPTY Agent container: an agent / refusal / error line with nothing to show is not
  // added (a blank reply, an answer that came back empty). Cards and questions always carry content.
  const push = useCallback((item0) => {
    // review F3: after this turn's planned Undo went through, a refusal of the REST never says nothing changed
    const item = undoneFirstRef.current && ['refusal', 'error', 'agent'].includes(item0?.role) && DIDNT_CHANGE.test(String(item0.text || ''))
      ? { ...item0, text: String(item0.text).replace(DIDNT_CHANGE, 'I undid my earlier change (above), but I didn’t make the rest of your request') }
      : item0
    if (['agent', 'refusal', 'error'].includes(item?.role) && !String(item.text || '').trim()
        && !item.present && !item.table && !item.link) return
    if (item?.role && item.role !== 'member') turnOutput(item.role)
    const id = item?.id || nid()
    if (item?.role === 'question') lastQuestionRef.current = { ...item, id }
    setItems(xs => [...xs, { at: Date.now(), ...item, id }])
  }, [])
  const patchItem = useCallback((id, patch) => setItems(xs => xs.map(x => (x.id === id ? { ...x, ...patch } : x))), [])
  // ⛔ APPROVAL BINDING: a change that RAN (any write, or an Undo) withdraws a proposal still waiting —
  // it was shown for the state before that change, so "do it" must never apply it on top. Answers and
  // questions leave a waiting proposal alone (they change nothing).
  const withdrawPending = useCallback(() => {
    const p = pendingRef.current
    if (p?.kind !== 'proposal') return
    pendingRef.current = null
    patchItem(p.id, { status: 'replaced' })
    push({ role: 'outcome', text: 'I withdrew the proposal above because something changed after I made it — ask again if you still want it.' })
  }, [patchItem, push])
  // What the Agent is doing while the member waits, beyond "typing" ('research' = a web search runs).
  const [activity, setActivity] = useState(null)
  // ⭐ STREAMING (server flag UCT_AGENT_STREAM): an ANSWER's reply appears while it is being written, as
  // ONE provisional line — repainted at most every 50 ms, replaced by the final envelope's reply (the
  // authority) when the turn ends as an answer, removed when it does not or when a web search follows
  // (`retract`). The server sends text only through its gate (turn.ReplyStream): never a plan's words,
  // never a local-only result.
  const streamLine = useCallback(() => {
    let id = null
    let text = ''
    let timer = null
    const stop = () => { if (timer) { clearTimeout(timer); timer = null } }
    const remove = (gone) => setItems(xs => xs.filter(x => x.id !== gone))
    return {
      onEvent(e) {
        if (e?.t === 'delta' && typeof e.text === 'string') {
          text += e.text
          if (!id) {
            id = nid()
            mark('turn:first-delta')
            setActivity(null)
            push({ id, role: 'agent', text, streaming: true })
          } else if (!timer) {
            timer = setTimeout(() => { timer = null; if (id) patchItem(id, { text }) }, 50)
          }
        } else if (e?.t === 'retract') {
          stop()
          if (id) remove(id)
          id = null; text = ''
        } else if (e?.t === 'status' && e.stage === 'research') {
          setActivity('research')
        }
      },
      // `final` ({text, sources}): the answer takes the streamed line's place → true. null: removed → false.
      settle(final) {
        stop()
        const had = id
        id = null; text = ''
        if (!had) return false
        if (final && String(final.text || '').trim()) { patchItem(had, { ...final, streaming: false }); return true }
        remove(had)
        return false
      },
    }
  }, [push, patchItem])

  // Reopen the remembered conversation (transcript only; proposals and undo are per session).
  // ⭐ MERGED, never replaced: the composer stays usable while this loads, and a
  // message sent meanwhile (and its answer) must survive the history arriving —
  // replacing the transcript here is how a typed message "disappeared" after a reload.
  const [restoring, setRestoring] = useState(() => !!conversationRef.current)
  useEffect(() => {
    let alive = true
    const id = conversationRef.current
    if (!id) return undefined
    agentConversation(id).then((conv) => {
      if (!alive) return
      setRestoring(false)
      if (!conv) { setConversationId(null); return }
      const history = itemsFromTurns(conv.turns)
      setItems(xs => [...history, ...xs.filter(x => !x.history)])
    }, () => { if (alive) setRestoring(false) })
    return () => { alive = false }
  }, [setConversationId])

  // Features warm their data (catalogs) once the Agent is open; so does the server's streaming flag.
  useEffect(() => { runWarmups(host); loadAgentConfig().then(() => registerServerGatedBuiltins()) }, [host])

  useEffect(() => {
    let mark = null
    try { mark = JSON.parse(readLocal(AGENT_INFLIGHT_KEY) || 'null') } catch { mark = null }
    writeLocal(AGENT_INFLIGHT_KEY, null)
    if (!mark || !mark.sig || Date.now() - (mark.at || 0) > INFLIGHT_TTL_MS) return
    interruptedRef.current = mark
    const what = (mark.lines || []).join(' · ')
    push({ role: 'refusal', text: `Your last change was interrupted before it finished (the page reloaded or closed)${what ? `: ${what}` : ''}. Part of it may already be on the board — check it before asking again.` })
  }, [push])

  const record = useCallback(async (body) => {
    // ⭐ PHASE 2: a multi-step request watches what each of its steps came to (runCompound) — synchronous, before any await
    if (tapRef.current && body?.outcomeData?.kind) tapRef.current.push(body.outcomeData.kind)
    if (v2TapRef.current) v2TapRef.current.push(body)
    // a local turn's time to its first useful output (content-free: one number) rides the telemetry row
    const ms = turnOutputMs()
    if (body?.telemetry && body.telemetry.latency_ms == null && ms != null) body = { ...body, telemetry: { ...body.telemetry, latency_ms: ms } }
    // and when the change reached the screen and when it was read back and saved: the two times the member actually feels
    if (body?.telemetry) body = { ...body, telemetry: { ...body.telemetry, visible_ms: turnMarkMs('commit:end'), verified_ms: turnMarkMs('persist') } }
    const res = await agentRecord({ conversationId: conversationRef.current, ...body })
    if (res.ok && res.data?.conversationId && res.data.conversationId !== conversationRef.current) {
      setConversationId(res.data.conversationId)
    }
  }, [setConversationId])

  // ⛔ A RECEIPT DOES NOT OUTLIVE ITS CHART. Everything that confirms a change reads the chart's settings, and those hold it
  // while the chart itself goes to its error boundary, up to a bar fetch later. So a receipt keeps listening for a short while,
  // and a chart that faulted takes the success back, in words, with Undo only where the chart is still there to take it.
  const watchChartFaults = useCallback((refs, { receiptId, undoId, startedAt, label, actions }) => {
    if (!refs.length) return
    const report = (ref) => {
      const alive = (() => { try { return !!host?.charts?.read?.(ref) } catch { return false } })()
      const text = `${label || 'That chart'} hit an error after that change, so it isn't showing it. ${alive ? 'Say “undo” to take the change back.' : 'Remove the chart and add it again.'}`
      patchItem(receiptId, alive ? { faulted: true } : { faulted: true, undoId: null })
      // a chart that is gone can't be changed back: the words, the card and "undo" all say the same
      if (!alive && undoId) undoRef.current = undoRef.current.filter(e => e.id !== undoId)
      push({ role: 'refusal', text })
      record({ member: null, outcome: text, outcomeData: { kind: 'failed', actions, gates: ['chart-fault'] }, telemetry: { refused: true, actions } })
    }
    const now = refs.find(r => chartFaultedSince(r, startedAt))
    if (now) { setTimeout(() => report(now), 0); return }
    const off = onChartFault((id) => {
      if (!refs.includes(id)) return
      off(); clearTimeout(timer)
      setTimeout(() => report(id), 50)     // the boundary reports before React has finished taking the chart down: read it after
    })
    const timer = setTimeout(off, FAULT_WATCH_MS)
  }, [host, patchItem, push, record])

  // ── execution (shared by the fast path, the model path and approvals) ──
  // pl-auto symbol-01 (BROWSER-MOCK-MODEL) / AUDIT: a ticker word the member typed NOT in capitals ("pull up nvidia on this one")
  // is claimed instantly only when UCT's ticker search knows it, as a ticker or as one company's exact name. Otherwise the MODEL
  // reads the request (it knows "nvidia" is NVDA): never refused unread on an instant path, never charted as the literal word.
  async function typedSymbolsKnown(ops, said) {
    const words = (ops || []).filter(o => o?.action === 'chart.setSymbol' && !o.trusted).map(o => String(o.args?.symbol || ''))
      .filter(sym => sym && !String(said || '').includes(sym))
    if (!words.length) return true
    // AUDIT N1: bounded like nameSearch — a slow or silent ticker search never holds the turn; no answer in time is "not known
    // here", so the MODEL reads the request
    const lookup = (async () => {
      const unknown = await unknownSymbols(words)
      if (!unknown.size) return true
      const g = await groundSymbols([...unknown])
      return !g.unknown.size && !g.ambiguous.size
    })().catch(() => false)
    let t = null
    const timeout = new Promise((resolve) => { t = setTimeout(() => resolve(false), NAME_SEARCH_MS) })
    try { return await Promise.race([lookup, timeout]) } finally { clearTimeout(t) }
  }
  const executeInner = useCallback(async (opsIn, { path, mode: suggested, member, voice, approval = null, card = null, note = null, onTarget = null, lead = null, binding = null, subset = false, namePart = false, afterCommit = null, more = false }) => {
    // A follow-up step's refusal says what the earlier steps already did (`note`). `lead` (OWNER
    // 2026-10-12): the held receipt of the step before it (a Save) — said in THIS step's message,
    // first, so "save + apply" reads as ONE confirmation; `lead.used` tells the caller it was said.
    const leadLines = lead && !lead.used ? lead.lines : []
    const refusalPush = (text) => {
      const full = boardRefusalIn(text)
      if (full) { try { host?.widgets?.raiseBound?.(full) } catch { /* the words below still say it */ } }
      const before = leadLines.length ? `${leadLines.join(' ')} ` : ''
      if (lead) lead.used = true
      push({ role: 'refusal', text: `${before}${note ? `${text} ${note}` : text}` })
    }
    let allOps = opsIn
    let deferred = []
    if (opsIn.some(isDeferred) && !opsIn.every(isDeferred)) {
      deferred = opsIn.filter(isDeferred)
      allOps = opsIn.filter(o => !isDeferred(o))
      opsIn = allOps
    }
    if (saveRunsLast(allOps)) {
      deferred = [...deferred, allOps[allOps.length - 1]]
      allOps = allOps.slice(0, -1); opsIn = allOps
    }
    // SEQUENTIAL capabilities (indicator edits: exclusive — never mixed in a plan): in a request that
    // asks for more, each runs as its OWN step after the rest (own receipt + Undo), in request order.
    // The same change on several charts keeps its fan-out path (proposed together, run per chart).
    {
      const seq = (o) => !!getCapability(o?.action)?.sequential
      if (allOps.length > 1 && allOps.some(seq) && !fanOutOf(allOps)) {
        const rest = allOps.filter(o => !seq(o))
        const steps = allOps.filter(seq)
        const keep = rest.length ? rest : [steps.shift()]
        deferred = [...steps, ...deferred]
        allOps = keep; opsIn = keep
      }
    }
    const pendingNames = aliasNames(allOps)
    // Checked NOW against the board as it is (a new list's alias stands in for it). One that
    // cannot run is dropped and said up front — the rest of the request still runs.
    let deferredLines = []
    // ⭐ MISSION 3: this request CREATES widgets and its deferred steps change widgets that already exist ("add a chart for
    // AAPL and put the RSI on my NVDA chart") — its Undo entries are one group (execute)
    let mixedDeferred = false
    if (deferred.length) {
      // each one on its own (they run one at a time, so they are checked one at a time)
      const okd = []
      // ⭐ P2: a step aimed at a chart an EARLIER step of this request adds indicators to ("add the 9 EMA, make the
      // 9 green") cannot be checked yet — what it names does not exist until then. It is checked at its own turn
      // (and refused there, with the real reason, if it still cannot run).
      const grows = new Set(allOps.filter(o => getCapability(o?.action)?.addsIndicators).map(o => o.target))
      // ⭐ W1-B B-07: a step aimed at a target this request CREATES (a widget.add alias — "open two charts … with the 9 and
      // 20 ema on both") cannot be checked yet either: it is checked at its own turn, re-aimed at the real target (landDeferred)
      const creates = new Set(allOps.map(o => getCapability(o?.action)?.creates?.(o.args || {})?.alias).filter(Boolean).map(String))
      mixedDeferred = creates.size > 0 && deferred.some(d => !creates.has(String(d.target)))
      for (const d of deferred) {
        // this check runs on an unprepared plan: one that throws is that step refused, never the whole request lost
        let dp
        try {
          const dp0 = planOps(collectTargets(host, kindsOf([d])), [d], { pendingLists: pendingNames }, capCtx)
          const shut = dp0.ok ? protectionRefusal(host, dp0, dp0.normalizedOps || [d]) || railOf(dp0, 'apply') : null
          dp = shut ? { ok: false, refusals: [{ reason: shut }] } : dp0
        } catch { dp = { ok: false, refusals: [{ reason: 'I could not check that step.' }] } }
        if (!dp.ok && (grows.has(d.target) || creates.has(String(d.target)))) okd.push(d)
        else if (!dp.ok) {
          // said AND recorded, before anything runs: a reload, or a failure later in this request, still shows what was dropped.
          // Awaited, so this row lands first (and a new chat's id is known); the member's words ride on the first row only.
          const text = `I'll do the rest, but not this part: ${[...new Set(dp.refusals.map(r => r.reason))].join(' ')}`
          push({ role: 'agent', text })
          try { await record({ member, outcome: text, outcomeData: { kind: 'partial', actions: [d?.action] }, telemetry: { path, refused: true, actions: [d?.action], voice } }) } catch { /* the words above still say it */ }
          member = null
        } else { okd.push(d); deferredLines.push(...dp.lines) }
        if (getCapability(d?.action)?.addsIndicators) grows.add(d.target)
      }
      deferred = okd
    }
    // ⛔ Another window/device may have changed this member's board (one shared,
    // last-write-wins preference): never write over it (host.boardInSync).
    // `early`: the same check already started (LATENCY: beside planning's own lookups, see below)
    const boardStillOurs = async (ops, early = null) => {
      if (!host?.boardInSync || boardEpoch(host, ops) == null) return true
      const s = await (early || host.boardInSync())
      mark('board:synced', s.ok ? 'ok' : 'changed')
      if (s.ok) return true
      const text = `I didn't change anything: ${s.reason}. Reload this page to see the current board, then ask again.`
      refusalPush(text)
      record({ member, outcome: text, outcomeData: { kind: 'refused-stale-board', actions: ops.map(o => o?.action) }, telemetry: { path, refused: true, voice } })
      return false
    }
    const refuse = (why) => {
      const text = `I didn't change anything: ${why}`
      refusalPush(text)
      record({ member, outcome: text, outcomeData: { kind: 'refused', actions: opsIn.map(o => o?.action) }, telemetry: { path, refused: true, voice } })
    }
    // ⛔ APPROVAL: re-read every target that has an authority before anything is planned (fail closed).
    if (suggested === 'approved' && binding) {
      const why = await refreshForApproval(host, allOps)
      if (why) {
        refusalPush(why)
        record({ member, outcome: why, outcomeData: { kind: 'refused-stale-proposal', actions: allOps.map(o => o?.action) }, telemetry: { path, refused: true, voice } })
        return
      }
    }
    // ── EXPANSION: a macro op with CONCRETE inputs (widget.addCharts with tickers)
    // becomes the ordinary ops it stands for, before anything is planned. One whose
    // input is still a reference expands at apply, once its symbols exist.
    let expansion = null
    {
      const x = expandOps(allOps)
      if (!x.ok) { refuse(`${x.reason}.`); return }
      if (x.expanded) { allOps = x.ops; expansion = x }
    }
    // ── COMPOSITION: an op fed by another op's RESULT (compose.js). Never applied
    // straight from a model turn — the result does not exist yet, so the member
    // approves the query + selection rule; at APPLY the producers run fresh, the
    // actual symbols replace the references, and the rest commits as usual.
    const composing = refsOf(allOps).length > 0
    let composed = null
    if (composing) {
      const bad = checkRefs(allOps, host)
      if (bad) { refuse(bad); return }
      if (suggested === 'approved') {
        if (!(await boardStillOurs(allOps))) return
        // The consumers are re-checked against the board AS IT IS NOW (capacity,
        // the target list) BEFORE any producer runs — a full workspace never runs
        // the screen it could not use.
        {
          const producersNow = consumedProducers(allOps)
          const rest = allOps.filter(o => !producersNow.includes(o) && !getCapability(o?.action)?.query)
          if (rest.length) {
            const gate = planOps(collectTargets(host, kindsOf(rest)), rest, await prepareOps(rest), capCtx)
            if (!gate.ok) {
              const text = refusalText(gate.refusals)
              refusalPush(text)
              record({ member, outcome: text, outcomeData: { kind: 'refused', actions: rest.map(o => o.action) }, telemetry: { path, refused: true, voice } })
              return
            }
            // ⛔ the member approved the RULE (the query + selection) on the consumers' state as it was:
            // that state and the rule's plan must be unchanged (the producers' results are new by design)
            const drift = binding ? bindingDrift(binding, approvalBinding(gate, host), { subset }) : null
            if (drift) {
              const text = boundRefusal(drift)
              refusalPush(text)
              record({ member, outcome: text, outcomeData: { kind: 'refused-stale-proposal', actions: rest.map(o => o.action) }, telemetry: { path, refused: true, voice } })
              return
            }
          }
        }
        mark('gate:capacity')
        const r = await resolveRefs(allOps, host)
        mark('sources:resolved')
        if (!r.ok) {
          const text = `I didn't change anything: ${r.reason}.`
          refusalPush(text)
          record({ member, outcome: text, outcomeData: { kind: 'refused', actions: allOps.map(o => o.action) }, telemetry: { path, refused: true, voice } })
          return
        }
        if (r.empty) {
          const text = `${r.lines.join(' · ')}, so I didn't create or change anything.`
          push({ role: 'outcome', text })
          record({ member, outcome: text, outcomeData: { kind: 'noop', actions: allOps.map(o => o.action) }, telemetry: { path, disposition: 'apply', voice } })
          return
        }
        // The references are concrete now: macros fed by them expand here.
        const x = expandOps(r.ops)
        mark('expanded')
        if (!x.ok) { refuse(`${x.reason}.`); return }
        allOps = x.ops
        if (x.expanded) expansion = x
        composed = { lines: r.lines }
      }
    }
    const producers = composing && !composed ? consumedProducers(allOps) : []
    const targets = collectTargets(host, kindsOf(allOps))
    // QUERIES only read: answered from the target's own snapshot, never planned. A
    // plan that also changes something answers its queries and plans the rest. A
    // producer waiting to feed another op is not answered — it runs at apply.
    const queries = allOps.filter(o => getCapability(o?.action)?.query && !producers.includes(o))
    if (queries.length) {
      // An answer is a string, or { text, table, link } for structured results (rows
      // the feature returned — never written by the model). It may be async.
      const answers = []
      for (const o of queries) {
        let a
        try { a = await getCapability(o.action).answer(targets.get(o.target)?.snap || null, o.args || {}, host, capCtx) } catch (e) { a = `That didn't work: ${e?.message || 'error'}` }
        // ⛔ LT-15: never "announce work, then show nothing" — a query that came back with nothing to show (no text,
        // no table, no view, no link) says so plainly instead of leaving an empty row (or none) after the reply
        answers.push(emptyAnswer(a) ? { text: NO_RESULT } : (typeof a === 'string' ? { text: a } : a))
      }
      // ⭐ ONE presentation contract (present.js): each answer → the smallest view that carries it,
      // shaped by the member's own request (concise by default, depth when asked).
      const views = answers.map(a => presentOf(a, { message: saidRef.current }))
      // ⭐ GATE C session memory: a table of tickers UCT showed, in the order shown ("open the third one").
      // Never a local-only answer (its rows stay in the browser only, as before).
      queries.forEach((o, i) => {
        const syms = getCapability(o.action)?.localOnly ? null : tickersOfAnswer(answers[i])
        if (syms) memoryRef.current.noteResults({ source: o.action, label: answers[i]?.title || null, symbols: syms })
      })
      // ⭐ W3-4 `coach.next`: a capability's suggested next messages ride on the answer row as chips (≤ 3 short
      // strings; a tap sends one as the member's own message). Never saved, never read into a model request.
      const nextOf = (a) => (Array.isArray(a?.next) && a.next.length ? { next: a.next.slice(0, 3).map(s => String(s).slice(0, 120)) } : {})
      answers.forEach((a, i) => push(views[i] ? { role: 'agent', present: views[i], text: a.text || '', ...nextOf(a) } : { role: 'agent', text: a.text, table: a.table || null, link: a.link || null, ...nextOf(a) }))
      // ⛔ W3 review B3: an answer whose capability says `storedAs` (journal.reviewTrades) is SHOWN now but never
      // stored as text or as a view — the transcript keeps only that capability's value-free marker
      // (also an ANSWER's own `storedAs`: a coach answer led by UCT's approved knowledge stores a citation-only marker)
      const markerOf = (i) => (typeof answers[i]?.storedAs === 'string' && answers[i].storedAs) || getCapability(queries[i]?.action)?.storedAs || null
      const knowledgeLed = answers.some(a => typeof a?.storedAs === 'string' && a.storedAs.startsWith(KNOWLEDGE_REF))
      const text = answers.map((a, i) => markerOf(i) || a.text).filter(Boolean).join('\n\n')
      // the member's transcript keeps the views (restored on reload); never read into a model request
      const saved = compactViews(views.filter((v, i) => v && !markerOf(i)))
      // ⛔ LOCAL-RESULT BOUNDARY: the member's transcript keeps the answer; the row says it is LOCAL
      // ONLY (and what was asked — args, never values), so the server never replays it to a model.
      // The server also decides by the action name (turn.LOCAL_ONLY_ACTIONS); this is the second signal.
      const local = queries.filter(o => getCapability(o.action)?.localOnly)
      const localData = local.length ? { local: true, requests: local.map(o => o.args || {}) } : {}
      record({ member, outcome: text || 'Answered.', outcomeData: { kind: 'answered', actions: queries.map(o => o.action), ...localData, ...(knowledgeLed ? { knowledge: true } : {}), ...(saved.length ? { views: saved } : {}) }, telemetry: { path, disposition: 'answer', actions: queries.map(o => o.action), voice } })
    }
    const ops = allOps.filter(o => !getCapability(o?.action)?.query)
    if (!ops.length) return
    // ── F5: one change, several charts — each target planned (and refused) ON ITS OWN, all of them
    // before anything is proposed or written; the Apply re-checks all again, then runs them one by one
    // ⭐ AUTO-APPLY (live test 2026-10-28): an EXPLICIT request ("make the 9 green on both charts") whose every
    // per-chart plan the policy applies (local risk, reversible, no confirmIf) runs at once — each chart its own
    // execution, receipt and Undo, exactly as an approved fan-out. Anything that needs eyes is still proposed.
    const fan = fanOutOf(ops)
    if (fan) {
      const actions = fan.map(o => o.action)
      const lines = []
      const binds = []
      let needsCard = suggested !== 'apply'
      for (const o of fan) {
        const one = planOps(collectTargets(host, kindsOf([o])), [o], await prepareOps([o]), capCtx)
        if (one.ok) binds.push(approvalBinding(one, host))
        const guard = one.ok ? protectionRefusal(host, one, one.normalizedOps || [o]) : null   // W1.1 review NB-3: normalized
        // ⛔ CHART RAIL (hotfix 11-13): each chart's plan, before anything is proposed or written
        const railed = one.ok && !guard ? railOf(one, suggested === 'approved' ? 'approved' : decideMode(suggested, one)) : null
        const why = !one.ok ? refusalText(one.refusals) : (guard ? `I didn't change anything: ${guard}` : railed)
        if (why) {
          refusalPush(why)
          record({ member, outcome: why, outcomeData: { kind: 'refused', actions }, telemetry: { path, refused: true, actions, voice } })
          return
        }
        lines.push(...(one.lines.length ? one.lines : one.noops))
        if (decideMode('apply', one) !== 'apply') needsCard = true
      }
      if (!needsCard) return { followUps: fan }
      const plines = pendingWording([...lines, 'Each chart is changed separately, with its own receipt and Undo.'])
      if (suggested === 'approved') {
        // only the charts and the change the member approved — else nothing runs
        const fanDrift = !Array.isArray(binding) || binding.length !== binds.length ? 'it can no longer be checked against what you approved'
          : binds.map((b, i) => bindingDrift(binding[i], b)).find(Boolean) || null
        if (!card || !sameLines(card, plines) || fanDrift) {
          const text = `Something on those charts changed since you approved it, ${STALE_PROPOSAL}`
          refusalPush(text)
          record({ member, outcome: text, outcomeData: { kind: 'refused-stale-proposal', actions }, telemetry: { path, refused: true, actions, voice } })
          return
        }
        return { followUps: fan }
      }
      const pid = nid()
      pendingRef.current = { kind: 'proposal', id: pid, ops: fan, epoch: boardEpoch(host, fan), card: plines, expiresAt: Date.now() + PROPOSAL_TTL_MS, binding: binds, words: [member, saidRef.current] }
      push({ id: pid, role: 'proposal', lines: plines, status: 'pending' })
      record({ member, outcome: `Proposed: ${plines.join(' · ')}`, outcomeData: { kind: 'proposed', actions }, telemetry: { path, disposition: 'propose', actions, voice } })
      return
    }
    // ⛔ F6: an Apply plans from what was approved (the seals), never from a fresh read
    const pendingLists = Object.assign({}, ...ops.map(o => o.pendingLists || {}))
    // ⭐ LATENCY: a change that will be applied reads the server's board for the cross-session check NOW,
    // beside the lookups planning waits on (a ticker search), not after them — one network wait less.
    // The SAME check and the same refusal, still before anything is written; a plan that ends up
    // proposed or refused never uses it (one wasted read at most).
    const earlySync = (suggested === 'apply' || suggested === 'approved') && !composing && host?.boardInSync && boardEpoch(host, ops) != null
      ? host.boardInSync() : null
    earlySync?.catch(() => {})                 // awaited below; never an unhandled rejection meanwhile
    const env = { ...(await prepareOps(ops)), ...(suggested === 'approved' ? { approved: true, approval: approval || [] } : {}), ...(Object.keys(pendingLists).length ? { pendingLists } : {}) }
    mark('prepared')
    // A read in THIS request (a screen just run) is visible to the writes after it ("find … and save it"):
    // targets are re-read once the request's own queries have answered.
    const plan = planOps(queries.length ? collectTargets(host, kindsOf(ops)) : targets, ops, env, capCtx)
    mark('planned')
    const actions = ops.map(o => o.action)
    if (!plan.ok) {
      // ⭐ MISSION 3: refused ONLY as add + change-existing → two executions of this same runtime, in the member's order,
      // ONE grouped Undo (execute runs them). Every part is planned, protection-checked and policy-checked HERE, before
      // anything is written; any part that would not run at once keeps the request refused, with the two-step wording.
      const mixedOnly = plan.refusals.length > 0 && plan.refusals.every(r => r.code === 'mixed')
      if (mixedOnly) {
        const why = await (async () => {
          if (suggested !== 'apply' || composing || deferred.length || binding) return 'needs-approval'
          const sp = splitMixedOps(ops)
          if (!sp) return 'unsafe'
          const pre = []
          for (const part of sp.parts) {
            const pp = planOps(collectTargets(host, kindsOf(part.ops)), part.ops, env, capCtx)
            if (!pp.ok) return { text: refusalText(pp.refusals) }
            const g = protectionRefusal(host, pp, pp.normalizedOps || part.ops)
            if (g) return { text: `I didn't change anything: ${g}` }
            const rg = railOf(pp, 'apply')
            if (rg) return { text: rg }
            if (decideMode('apply', pp) !== 'apply') return 'needs-approval'
            pre.push({ ...part, lines: pp.lines.length ? pp.lines : pp.noops })
          }
          return { parts: pre }
        })()
        if (why?.parts) {
          mark('split', why.parts.map(p => p.side).join('+'))
          return { split: why.parts }
        }
        const text = why?.text || `I didn't change anything: ${why === 'needs-approval'
          ? 'adding new widgets and changing existing ones in one request only works when both parts can run straight away, and part of this one needs your approval first. Ask in two steps: the new widgets first, then the change to the ones you already have.'
          : plan.refusals[0].reason}`
        refusalPush(text)
        record({ member, outcome: text, outcomeData: { kind: 'refused', actions }, telemetry: { path, refused: true, actions, voice } })
        return
      }
      const text = refusalText(plan.refusals)
      refusalPush(text)
      record({ member, outcome: text, outcomeData: { kind: 'refused', actions }, telemetry: { path, refused: true, actions, voice } })
      return
    }
    // PROTECTED LAYOUTS (Main Trading…): checked after planning — so it covers a new request, a
    // proposal's Apply (which re-plans here) and a composed plan alike — and before anything writes.
    const guarded = protectionRefusal(host, plan, plan.normalizedOps || ops)   // W1.1 review NB-3: the NORMALIZED ops
    if (guarded) {
      const text = `I didn't change anything: ${guarded}`
      refusalPush(text)
      record({ member, outcome: text, outcomeData: { kind: 'refused-protected', actions }, telemetry: { path, refused: true, actions, voice } })
      return
    }
    // ⛔ CHART RAIL (hotfix 2026-11-13, agent/chartRail.js): no change may re-symbol, remove or switch away a chart the member
    // named as kept, change existing charts when the words asked for MORE charts, remove a chart at once unasked, or leave a
    // grid shape asked for in words with fewer charts — on every path (instant, model, approved), before anything is written
    const railed = railOf(plan, suggested === 'approved' ? 'approved' : decideMode(suggested, plan))
    if (railed) {
      mark(RAIL_MARK, 'refused')
      refusalPush(railed)
      record({ member, outcome: railed, outcomeData: { kind: 'refused', actions, reason: RAIL_MARK }, telemetry: { path, refused: true, actions, voice } })
      return
    }
    // ⛔ F6: a sealed approval runs only if the plan still reads EXACTLY as the card the member approved
    if (suggested === 'approved' && card && !sameLines(card, pendingWording(plan.lines.length ? plan.lines : plan.noops))) {
      const text = `That proposal no longer matches what you approved, ${STALE_PROPOSAL}`
      refusalPush(text)
      record({ member, outcome: text, outcomeData: { kind: 'refused-stale-proposal', actions }, telemetry: { path, refused: true, actions, voice } })
      return
    }
    // ⛔ APPROVAL BINDING: every approval runs only on an IDENTICAL structured binding — the same change
    // to the same targets in the same material state (a composed approval was checked at its gate).
    let freshCard = false
    if (suggested === 'approved' && binding && !composed) {
      const drift = bindingDrift(binding, approvalBinding(plan, host), { subset })
      if (drift) {
        // `freshCardOnDrift` (opt-in, drawing.deleteBoard): nothing runs; the card is shown again as things are NOW, to approve anew
        freshCard = !subset && ops.length > 0 && ops.every(o => getCapability(o?.action)?.freshCardOnDrift === true)
        const text = freshCard ? `That proposal can’t run as you approved it — ${drift} — so nothing was changed. Here it is as it is now:` : boundRefusal(drift)
        refusalPush(text)
        record({ member, outcome: text, outcomeData: { kind: 'refused-stale-proposal', actions }, telemetry: { path, refused: true, actions, voice } })
        if (!freshCard) return
      }
    }
    if (composing && !composed) {
      const pid = nid()
      pendingRef.current = { kind: 'proposal', id: pid, ops: [...allOps, ...deferred], epoch: boardEpoch(host, [...allOps, ...deferred]),
        binding: approvalBinding(plan, host), expiresAt: Date.now() + PROPOSAL_TTL_MS, words: [member, saidRef.current] }
      // a proposal says what WILL happen (proposalWording.js), never a success not yet written
      const lines = pendingWording([...pendingLines(allOps, host), ...plan.lines, ...deferredLines])
      push({ id: pid, role: 'proposal', lines, status: 'pending' })
      record({ member, outcome: `Proposed: ${lines.join(' · ')}`, outcomeData: { kind: 'proposed', actions }, telemetry: { path, disposition: 'propose', actions, voice } })
      return
    }
    // Every op came from expansions → the member reads ONE line per request
    // ("Create 4 5-minute charts: SPY, QQQ, …"), not the per-chart steps.
    const wholly = expansion && ops.every(o => o.fromExpand != null)
    // The very plan an interrupted Apply was running: never run it blind — propose it, warned.
    const sig = planSig(wholly ? expansion.lines : plan.lines)
    const repeatOfInterrupted = interruptedRef.current && interruptedRef.current.sig === sig
    if (repeatOfInterrupted) {
      interruptedRef.current = null
      push({ role: 'refusal', text: 'This is the same change that was interrupted a moment ago, and part of it may already be on the board. Check the board first — apply it again only if it is still needed.' })
    }
    // ⭐ AUTO-APPLY (live test 2026-10-28): an expansion ("add 4 charts on SPY, QQQ, …") the member asked for is
    // applied like any explicit change — the policy (decideMode) still sends anything confirm-risk to a card.
    const mode = (repeatOfInterrupted || freshCard) ? 'propose' : (suggested === 'approved' ? 'apply' : decideMode(suggested, plan))
    // Any write to the board is preceded by the cross-session check (once per Apply).
    if (mode !== 'propose' && !composed && !(await boardStillOurs(ops, earlySync))) return
    if (mode === 'propose') {
      const pid = nid()
      // The proposal keeps the UNEXPANDED request: Apply expands it again from scratch.
      const keep = [...(expansion ? opsIn.filter(o => !getCapability(o?.action)?.query) : ops), ...deferred]
      const plines = pendingWording([...(wholly ? expansion.proposal : (plan.lines.length ? plan.lines : plan.noops)), ...deferredLines])
      const seals = sealsOf(plan)
      pendingRef.current = { kind: 'proposal', id: pid, ops: keep, epoch: boardEpoch(host, keep),
        binding: approvalBinding(plan, host), expiresAt: Date.now() + PROPOSAL_TTL_MS, words: [member, saidRef.current],
        ...(seals.length ? { seals, card: plines, expiresAt: Math.min(Date.now() + PROPOSAL_TTL_MS, ...seals.map(x => x.expiresAt)) } : {}) }
      push({ id: pid, role: 'proposal', lines: plines, status: 'pending' })
      record({ member, outcome: `Proposed: ${plines.join(' · ')}`, outcomeData: { kind: 'proposed', actions }, telemetry: { path, disposition: 'propose', actions, voice } })
      return
    }
    if (!plan.changed) {
      const text = plan.noops.length ? `Nothing to change — ${plan.noops.join(' · ')}.` : 'Nothing to change.'
      push({ role: 'outcome', text })
      record({ member, outcome: text, outcomeData: { kind: 'noop', actions }, telemetry: { path, disposition: 'apply', actions, voice } })
      if (deferred.length) return { followUps: landDeferred(deferred, {}, {}, suggested === 'approved') }
      return
    }
    if (boardEpoch(host, ops) != null) {
      writeLocal(AGENT_INFLIGHT_KEY, JSON.stringify({ sig, lines: (wholly ? expansion.lines : plan.lines).slice(0, 4), at: Date.now() }))
    }
    mark('commit:start')
    let res, saved
    let saying = null                      // the receipt already on screen, while its save is out (id)
    const commitStartedAt = Date.now()
    const receiptNotes = (after = null) => [...(onTarget ? [onTarget] : []), ...(after ? [after] : []), ...(wholly ? [] : plan.noops), ...undoNotesFor(plan, res)]
    try {
      res = await commitPlan(host, plan, { env, ctx: capCtx })
      mark('commit:end')
      if (res.ok && wholly) {
        res.lines = expansion.lines
        if (res.undo) res.undo.lines = expansion.lines
      }
      // ⭐ SPEED (fast chart.setTimeframe p50 2189 ms, production telemetry 11-05): the change is on screen and read back here
      // (commitPlan: kind.landed), so the member is told now, not after the POSTs. The receipt says it is SAVING: no Undo, and
      // never a claim that it is saved. Everything else still waits for the save: the lock, the in-flight mark, the working
      // signal, Undo and the record. The save's answer patches this same receipt (below), a failure in words.
      // Only a change that is the whole request: a step, a follow-up or a deferred step has its order to keep.
      if (res.ok && path !== 'model' && !more && !lead && !afterCommit && !deferred.length && !res.followUps?.length && !tapRef.current && !v2TapRef.current
        && ((!selfSaved(plan.plans) && host?.persist && boardEpoch(host, ops) != null) || drawingRefsOfPlan(plan).length)) {
        const first = composed ? [...composed.lines, ...res.lines] : res.lines
        const notes = receiptNotes()
        if (![...first, ...notes].some(l => /\bsaved?\b/i.test(String(l)))) {
          withdrawPending()
          saying = nid()
          push({ id: saying, role: 'receipt', lines: first, undoId: null, saving: true, charts: receiptCharts(host, plan, res), notes })
          mark('receipt:saving')
        }
      }
      // Persistence acknowledgment (board changes): Undo waits for the server, and the receipt too unless it was said above.
      const persisted = async () => {
        const s = selfSaved(plan.plans) ? { ok: true } : await persistBoard(host, ops)
        return s.ok ? confirmDrawings(host, drawingRefsOfPlan(plan)) : s
      }
      saved = res.ok ? await withinSaveWait(persisted().catch(() => ({ ok: false, reason: 'not-saved' }))) : { ok: true }
    } finally {
      // Reached an outcome (even a thrown one): no longer in flight. Only a reload/close skips this; a save still out keeps the mark.
      if (!saved?.late) writeLocal(AGENT_INFLIGHT_KEY, null)
      if (saying && !saved?.late) patchItem(saying, { saving: false })       // here, so nothing after this can leave a receipt on "Saving…"
    }
    mark('persist', saved.ok ? 'ok' : saved.reason)
    if (res.undo && saved.ok) {
      undoRef.current = [...undoRef.current, res.undo].slice(-UNDO_MAX)
    }
    if (res.ok) {
      withdrawPending()
      // A composed request says first what its producers actually returned.
      // (the held Save's line FOLLOWS the add's — "Added “X” to QQQ · Saved to your indicators…")
      const lines = [...(composed ? [...composed.lines, ...res.lines] : res.lines), ...leadLines]
      if (lead) lead.used = true
      if (!saved.ok) {
        const unsaved = (reason) => ({ undoId: null, notes: [UNSAVED_NOTE[reason] || UNSAVED_NOTE['not-saved']], unsaved: true, saving: false })
        let settleLate = null
        if (saved.late) {
          const id = saying || nid()
          const still = { undoId: null, notes: [UNSAVED_NOTE.slow], saving: true }
          if (saying) patchItem(id, still)
          else push({ id, role: 'receipt', lines, ...still })
          const mark0 = readLocal(AGENT_INFLIGHT_KEY)
          settleLate = (s, conversationId) => {
            if (readLocal(AGENT_INFLIGHT_KEY) === mark0) writeLocal(AGENT_INFLIGHT_KEY, null)      // never a later change's mark
            if (s.ok && res.undo) {
              if (lockRef.current) lateUndoRef.current.push(res.undo)
              else undoRef.current = atCommitOrder(undoRef.current, res.undo)
            }
            patchItem(id, s.ok ? { saving: false, undoId: res.undo?.id || null, notes: receiptNotes() } : unsaved(s.reason))
            // this request's own conversation, and past record(): that feeds the tap of whatever step is running by now
            agentRecord({ conversationId, member: null, outcome: s.ok ? `Saved after a wait: ${lines.join(' · ')}` : `${lines.join(' · ')} · NOT SAVED (${s.reason})`, outcomeData: { kind: 'save-late', ok: !!s.ok, actions, ...(s.ok ? {} : { reason: s.reason }) }, telemetry: { path, actions, voice, ...(s.ok ? {} : { refused: true }) } })
          }
        } else if (saying) patchItem(saying, unsaved(saved.reason))
        else push({ role: 'receipt', lines, ...unsaved(saved.reason) })
        const row = record({ member, outcome: `${lines.join(' · ')} · NOT SAVED (${saved.reason})`, outcomeData: { kind: 'applied-unsaved', actions, lines, reason: saved.reason }, telemetry: { path, disposition: 'apply', actions, voice, refused: true } })
        // (the row above names a new chat: read after it, so the late row joins that conversation whatever is open by then)
        if (settleLate) Promise.all([saved.late, row.catch(() => {}).then(() => conversationRef.current)]).then(([s, c]) => settleLate(s, c))
        // it landed on this screen, so it IS the last change — with no Undo of its own (F1)
        rememberChange(memoryRef.current, host, ops, null, res.created || null)
        noteCreated(res.created)
        return
      }
      const next =[...(Array.isArray(res.followUps) ? res.followUps : []), ...landDeferred(deferred, res.created, pendingNames, suggested === 'approved')]
      // OWNER 2026-10-12: a Save followed by ONE chart add says both in ONE message — this receipt is
      // HELD and becomes the add's lead (said first in its message; said on its own if the add never runs)
      const holdForAdd = next.length === 1 && !!next[0].awaitDefinition && !deferred.length
      // what moved past the chart it names is read back, never promised up front (gridMode.watchGridSync)
      const afterNote = afterCommit ? await afterCommit() : null
      // a target UCT chose for the member (the chart they clicked) is NAMED on the receipt, so a bare
      // "switch to weekly" on a board of several charts never leaves them guessing which one changed
      const receiptId = saying || nid()
      const shown = receiptCharts(host, plan, res)
      watchChartFaults(plannedChartRefs(plan, res), { receiptId, undoId: res.undo?.id || null, startedAt: commitStartedAt, label: shown?.length === 1 ? shown[0].label : null, actions })
      if (saying) patchItem(saying, { undoId: res.undo?.id || null })
      else if (!holdForAdd) push({ id: receiptId, role: 'receipt', lines, undoId: res.undo?.id || null, charts: shown, ...(namePart ? { namePart: true } : {}), notes: receiptNotes(afterNote) })
      record({ member, outcome: lines.join(' · '), outcomeData: { kind: 'applied', actions, lines }, telemetry: { path, disposition: 'apply', actions, voice } })
      // ⭐ GATE C session memory: what was ACTUALLY committed (targets as chart refs) — "do the same on the
      // right one", "put a 20 EMA on it" resolve from here (agent/references.js), re-validated on use
      // with ITS Undo entry (pushed above only when the save was confirmed): a correction reverses
      // exactly this change or nothing (nl1/interpreter.correctionPlan)
      rememberChange(memoryRef.current, host, ops, res.undo?.id || null, res.created || null)
      noteCreated(res.created)
      if (next.length) return { followUps: next, ...(holdForAdd ? { held: { lines, used: false } } : {}), ...(mixedDeferred ? { mixed: true } : {}) }
    } else {
      // a failure that carries its own complete sentence (`say`) is said as-is — never wrapped twice
      const text = res.failed.every(f => f.say) ? res.failed.map(f => f.say).join(' ')
        : `Some of that didn't take effect: ${res.failed.map(f => f.say || `${f.label} ${f.reason}`).join('; ')}.`
      if (res.lines.length) push({ role: 'receipt', lines: res.lines, undoId: res.undo?.id || null })
      refusalPush(text)
      const gates = res.failed.map(f => f.gate).filter(Boolean)            // diagnostics only, never shown
      record({ member, outcome: [res.lines.join(' · '), text].filter(Boolean).join(' · '), outcomeData: { kind: 'failed', actions, ...(gates.length ? { gates } : {}) }, telemetry: { path, refused: true, actions, voice } })
    }
  }, [host, push, patchItem, record, capCtx, withdrawPending])

  // Every execution is traced (agent/trace.js): phase timestamps, memory only.
  const execute = useCallback(async (opsIn, { path, mode: suggested, member, voice, chosen = false, approval = null, card = null, onTarget = null, binding = null, subset = false, noDuplicates = null, more = false, words = null, proposedWords = null }) => {
    // ⛔ #988 (AUDIT GO): the words the excluded-chart gate reads — an approved card carries the words it was PROPOSED
    // from (its proposal stored them): "do it" / "yes" / the Apply click name no chart, so they could never re-check it.
    // (merge with #1029) `proposedWords` is its own option: #1029's `words` is the turn's message string for resolveArgs
    // (the which-widget guard); the two never share one name, so neither reads the other's shape.
    const gateWords = Array.isArray(proposedWords) ? proposedWords : [member, saidRef.current]
    // ⭐ Multi Chart: one gate for the instant, model and approved paths — what cannot run on the grid is said, and nothing runs
    const onGrid = gridMode ? screenGridOps(opsIn, host) : null
    if (onGrid?.refuse) {
      const text = `I didn't change anything: ${onGrid.refuse}`
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'refused', actions: (opsIn || []).map(o => o?.action) }, telemetry: { path, refused: true, voice } })
      return undefined
    }
    if (onGrid?.note) onTarget = onTarget ? `${onTarget} ${onGrid.note}` : onGrid.note
    // ⛔ #988 (pl-auto u14-g3-05, GO bar 1): ONE gate for every card and every apply, on every path (instant, model, a resumed
    // question): a chart the member's words EXCLUDE ("this row except the TSLA one") is dropped from the plan here — never on a
    // proposal card, never applied. An apply that loses a chart this way is only proposed; nothing left → asked, with no card.
    // (AUDIT, #988 GO) an APPROVED card is re-checked too (idempotent: its card was built behind this gate) — should it ever
    // carry an excluded chart, nothing of it runs; the follow-ups a change makes (runFollowUps) pass the same check
    {
      const g = withoutExcludedCharts(opsIn, gateWords, { host, getTargetKind, getCapability })
      if (g.dropped && path === 'approved') {
        const text = boundRefusal('it includes a chart your request excludes')
        push({ role: 'refusal', text })
        record({ member, outcome: text, outcomeData: { kind: 'refused-excluded', actions: (opsIn || []).map(o => o?.action) }, telemetry: { path, refused: true, voice } })
        return undefined
      }
      if (g.dropped) {
        if (!g.ops.length) {
          const text = 'Which chart do you mean? Click it (or say left, right…) and ask again — nothing has changed yet.'
          push({ role: 'agent', text })
          record({ member, outcome: text, outcomeData: { kind: 'clarify-excluded', actions: (opsIn || []).map(o => o?.action) }, telemetry: { path, disposition: 'clarify', voice } })
          return undefined
        }
        opsIn = g.ops
        if (suggested === 'apply') suggested = 'propose'
      }
    }
    // ⭐ PHASE 2 (agent/duplicates.js, owner decision 2026-10-29): an add of an indicator the chart already shows, same
    // settings, is not added a second time — the existing one is reused (and is what "make it a 9" means next); a hidden
    // one is shown instead. Never on an approved card, nor when the member asked for another copy ("add another RSI").
    if (noDuplicates ?? (path !== 'approved' && !wantsCopy(saidRef.current))) {
      const d = screenDuplicateAdds(opsIn, host)
      // the add the member asked for is in place — memory records it as this turn's change, on the instance reused
      // ("make it a 9" edits that one; "do the same on the right one" repeats the add there, screened again)
      if (d.reused.length) memoryRef.current?.noteChange({ ops: d.reused.map(t => ({ ...t.op, target: t.chartRef })), epoch: epochOf(host), undoId: null })
      for (const t of d.reused) {
        memoryRef.current?.noteIndicator({ chart: t.chartRef, instanceId: t.instanceId, defId: t.defId, label: t.name, epoch: epochOf(host) })
        memoryRef.current?.noteMention({ chart: t.chartRef, instanceId: t.instanceId, epoch: epochOf(host) })
      }
      if (d.note && !d.ops.length) {
        const text = d.note.replace(/ — not added again\.$/, ', so there was nothing to add.')
        push({ role: 'outcome', text })
        record({ member, outcome: text, outcomeData: { kind: 'noop', actions: opsIn.map(o => o?.action) }, telemetry: { path, disposition: 'apply', voice } })
        return undefined
      }
      if (d.note) { opsIn = d.ops; onTarget = onTarget ? `${onTarget} ${d.note}` : d.note }
      else opsIn = d.ops
    }
    // ⛔ M3: with several indicator drafts open, a request on one the member has not selected is
    // never planned — they are shown the drafts and pick one (chooseTarget), nothing changes.
    // ARGUMENT RESOLUTION: a capability may turn the member's WORDS in an argument into a real
    // resource (`resolveArgs`: one match → its id; several → ask which, with the real names). The
    // same rule for instant, model-planned and approved requests — never left to the model alone.
    if (!chosen) {
      for (let i = 0; i < opsIn.length; i++) {
        const cap = getCapability(opsIn[i]?.action)
        if (typeof cap?.resolveArgs !== 'function') continue
        let r = null
        try { r = cap.resolveArgs(opsIn[i].args || {}, host, words ?? member, { approved: suggested === 'approved' }) } catch { r = null }   // `words`: the turn's own message on the model path
        // F2 (AUDIT #1027): a widget the member's words set aside is never acted on, and with no other of its type nothing is: refused
        if (r?.refuse) {
          push({ role: 'refusal', text: r.refuse })
          record({ member, outcome: r.refuse, outcomeData: { kind: 'refused', actions: opsIn.map(o => o?.action) }, telemetry: { path, refused: true, voice } })
          return undefined
        }
        if (r?.ask) {
          pendingRef.current = { kind: 'target', ops: opsIn, path, mode: suggested, member, voice, epoch: epochOf(host), pickArg: { action: opsIn[i].action, arg: r.ask.arg } }
          push({ role: 'question', text: r.ask.text, choices: r.ask.choices, local: true })
          record({ member, outcome: r.ask.text, outcomeData: { kind: 'clarify-arg', actions: opsIn.map(o => o?.action) }, telemetry: { path, disposition: 'clarify', voice } })
          return undefined
        }
        if (r?.args) opsIn = opsIn.map((o, j) => (j === i ? { ...o, args: r.args } : o))
      }
      // F1 (AUDIT #1027): a LIST-VIEW op (its target is a list view, not a widget arg) acts on the widget the words name, by the same
      // rule (whichWidget.js); asked → the pick re-aims the op at that widget's view
      for (let i = 0; i < opsIn.length; i++) {
        if (!LIST_VIEW_WHICH.has(opsIn[i]?.action)) continue
        let r = null
        try { r = whichListView(opsIn[i], host, words ?? member, { approved: suggested === 'approved' }) } catch { r = null }
        if (r?.refuse) {
          push({ role: 'refusal', text: r.refuse })
          record({ member, outcome: r.refuse, outcomeData: { kind: 'refused', actions: opsIn.map(o => o?.action) }, telemetry: { path, refused: true, voice } })
          return undefined
        }
        if (r?.ask) {
          const action = opsIn[i].action, refOf = r.refOf
          const then = (filled) => filled.map(o => (o.action === action && o.args?.__widget != null ? { ...o, target: refOf(o.args.__widget) || o.target, args: Object.fromEntries(Object.entries(o.args).filter(([k]) => k !== '__widget')) } : o))
          pendingRef.current = { kind: 'target', ops: opsIn, path, mode: suggested, member, voice, epoch: epochOf(host), pickArg: { action, arg: '__widget', then } }
          push({ role: 'question', text: r.ask.text, choices: r.ask.choices, local: true })
          record({ member, outcome: r.ask.text, outcomeData: { kind: 'clarify-arg', actions: opsIn.map(o => o?.action) }, telemetry: { path, disposition: 'clarify', voice } })
          return undefined
        }
        if (r?.target) opsIn = opsIn.map((o, j) => (j === i ? { ...o, target: r.target } : o))
      }
    }
    const amb = chosen ? null : draftAmbiguity(host, opsIn)
    if (amb) {
      pendingRef.current = { kind: 'target', ops: opsIn, path, mode: suggested, member, voice, epoch: epochOf(host), draft: true }
      push({ role: 'question', text: amb.text, choices: amb.choices, local: true })
      record({ member, outcome: amb.text, outcomeData: { kind: 'clarify-draft', actions: opsIn.map(o => o?.action) }, telemetry: { path, disposition: 'clarify', voice } })
      return undefined
    }
    // refinement B: retrying the add of the definition the Agent just SAVED — refresh the member's
    // list first (bounded); if it still lags, say so truthfully. Never a second Save.
    const ls = lastSaved()
    const retry = ls && opsIn.find(o => o?.action === 'indicator.add' && o.args?.defId === ls.defId)
    if (retry && !(await definitionListed({ defId: ls.defId, version: ls.version }))) {
      const text = `${ls.name ? `“${ls.name}”` : 'It'} is saved, but your indicator list still hasn’t caught up, so I didn’t add it — try again in a moment (it won’t be saved twice).`
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'refused', actions: opsIn.map(o => o?.action) }, telemetry: { path, refused: true, voice } })
      return undefined
    }
    // ⭐ R1: "save it as X" — the rename is its own draft step FIRST (own receipt + Undo); the Save is
    // then proposed on the renamed draft, so the card shows the final name and its exact warning
    const split = suggested === 'approved' ? null : splitSaveAs(host, opsIn)
    if (split) {
      if (split.rename) {
        const r = renameBeforeSave(host, split.rename.target, split.rename.name)
        const entry = r.undoData ? undoEntryFor(host, { kind: 'indicatorDrafts', ref: split.rename.target, label: 'the draft', lines: [r.line || 'Renamed the draft'], undoData: r.undoData }) : null
        if (entry) undoRef.current = [...undoRef.current, entry].slice(-UNDO_MAX)
        if (!r.ok) {
          // refused, or (defence in depth) more than a rename: never a Save proposal over it
          push({ role: 'refusal', text: r.text, undoId: entry?.id || null })
          record({ member, outcome: r.text, outcomeData: { kind: 'refused', actions: ['indicator.saveDraft'] }, telemetry: { path, refused: true, voice } })
          return undefined
        }
        if (!r.skipped) {
          push({ role: 'receipt', lines: [r.line], undoId: entry?.id || null })
          record({ member, outcome: r.line, outcomeData: { kind: 'applied', actions: ['indicator.renameDraft'], lines: [r.line] }, telemetry: { path, disposition: 'apply', voice } })
        }
      }
      opsIn = [split.save]
    }
    turnPath(path)
    traceStart(`${path}:${suggested || 'apply'}`)
    const idsBefore = undoRef.current.map(e => e.id)
    let out
    try {
      out = await executeInner(opsIn, { path, mode: suggested, member, voice, approval, card, onTarget, binding, subset, more, afterCommit: gridMode ? watchGridSync(opsIn, host) : null })
    } finally { traceEnd('done') }
    // ⭐ MISSION 3: an add + change-existing request, run as its parts in the member's order — each part the SAME
    // executeInner (planning, protection, policy, board check, commit, persistence, receipt and its own Undo entry). A part
    // that does not land stops the rest; the member is told exactly which part was made and which wasn't — never a
    // success claim. The parts' Undo entries become ONE group: "undo" takes back the whole request (doUndo).
    if (out?.split) {
      const parts = out.split
      // review #771 (6): each part is named from its PLAN (what it is), never its past-tense receipt line
      const said = (p) => partLabel(p.ops, host)
      const outer = tapRef.current
      let done = 0
      for (let i = 0; i < parts.length; i++) {
        const kinds = []
        tapRef.current = kinds
        try {
          traceStart(`${path}:part${i + 1}`)
          let o
          try { o = await executeInner(parts[i].ops, { path, mode: 'apply', member: i ? null : member, voice, onTarget: i ? null : onTarget, namePart: true }) } finally { traceEnd('done') }
          await runFollowUps(o)
        } finally { tapRef.current = outer; if (outer) outer.push(...kinds) }
        const landed = kinds.includes('applied') || kinds.includes('noop')
        if (!landed || kinds.some(k => k !== 'applied' && k !== 'noop')) {
          const q = (xs) => xs.map(s => `“${s}”`).join(' and ')
          const made = parts.slice(0, i).map(said)
          const here = said(parts[i])
          const later = parts.slice(i + 1).map(said)
          const notStarted = later.length ? `, so I didn’t start ${q(later)}` : ''
          // review #771 (2): a part that is ON SCREEN but not saved is said exactly so — it has no Undo of its own
          const unsaved = kinds.includes('applied-unsaved')
          const text = unsaved
            ? `${made.length ? `I made ${q(made)} (above). ` : ''}${q([here])} is on your screen but wasn’t saved (see above)${notStarted}.${made.length ? ` Say “undo” to take back ${q(made)}.` : ''}`
            : made.length
              ? `I made ${q(made)} (above), then stopped: ${q([here])} didn’t go through (see above), so it isn’t on your board${notStarted}. Say “undo” to take back ${q(made)}.`
              : `I stopped there: ${q([here])} didn’t go through (see above)${notStarted}. Nothing else was changed.`
          push({ role: 'agent', text })
          record({ member: null, outcome: text, outcomeData: { kind: 'split-stopped', step: i, of: parts.length }, telemetry: { path, refused: true, voice } })
          break
        }
        done += 1
      }
      if (done === parts.length && groupFresh(idsBefore) > 1) push({ role: 'outcome', text: `Done in ${parts.length} steps (above) — say “undo” to take back the whole request.` })
      return undefined
    }
    await runFollowUps(out)
    // NLM-1 D2 (dark): a request whose sequential steps (an indicator change after a chart change) each made an entry is
    // ONE Undo group as well, not only a mixed new + existing one
    if (out?.mixed || routingV2Active()) groupFresh(idsBefore)
    return undefined

    // ⭐ M3: the confirmed Save's chart adds — ONE execution per op, each planned, permission-checked,
    // persisted, confirmed and receipted on its own (a failure never undoes another chart or the Save)
    async function runFollowUps(out) {
    const held = out?.held || null                    // a Save's receipt waiting to lead its chart add
    for (const { awaitDefinition, ...op } of out?.followUps || []) {
      if (awaitDefinition && !(await definitionListed(awaitDefinition))) {
        const chart = (() => { try { return host.charts.read(String(op.target).replace(/^ixe:/, ''))?.label || 'that chart' } catch { return 'that chart' } })()
        // refinement B: the SAVED definition is kept (context `lastSaved`) — a retry adds the same one, never a second Save
        const nm = awaitDefinition.name ? `“${awaitDefinition.name}”` : 'It'
        const text = `${nm} is saved, but your indicator list hasn’t caught up yet, so I didn’t add it to ${chart} — ask me to add it again in a moment (it won’t be saved twice).`
        if (held && !held.used) { held.used = true; push({ role: 'receipt', lines: held.lines, undoId: null }) }
        push({ role: 'refusal', text })
        record({ member, outcome: text, outcomeData: { kind: 'refused', actions: [op.action] }, telemetry: { path: 'followup', refused: true, voice } })
        continue
      }
      const { followNote, approvedStep, ...one0 } = op
      // NLM-1 step plans (dark): a step that changes the indicator an EARLIER step added runs on that step's result — the
      // instance it added, found by state; no result (failed, refused, dismissed, ambiguous) → this step does not run, said
      let one = one0
      if (stepPlanRef.current) {
        const r = resolveResultRefs(one0, stepPlanRef.current, host)
        if (r.skip) {
          push({ role: 'refusal', text: r.skip })
          record({ member, outcome: r.skip, outcomeData: { kind: 'refused-step-result', actions: [one0.action] }, telemetry: { path: 'followup', refused: true, voice } })
          continue
        }
        one = r.op
      }
      // ⛔ #988 (AUDIT GO): a follow-up never lands on a chart the member's words exclude (the same gate as execute's)
      if (withoutExcludedCharts([one], gateWords, { host, getTargetKind, getCapability }).dropped) {
        record({ member, outcome: 'excluded chart skipped', outcomeData: { kind: 'refused-excluded', actions: [one.action] }, telemetry: { path: 'followup', refused: true, voice } })
        continue
      }
      traceStart('followup:apply')
      try { await executeInner([one], { path: 'followup', mode: approvedStep ? 'approved' : 'apply', member, voice, note: followNote || null, lead: held }) } finally { traceEnd('done') }
    }
    // a held Save receipt is ALWAYS said — on its own if no step used it (never a silent save)
    if (held && !held.used) push({ role: 'receipt', lines: held.lines, undoId: null })
    }
  }, [executeInner, definitionListed, gridMode, host, push, record])

  // ⭐ W2 (review #771 HIGH): the charts the latest committing request CREATED — "the new one" / "the chart you just added"
  // names exactly one of them (never the conversation's subject, which a later step of the same request may have moved)
  // NLM-1 step plans (dark): read the plan back — or, while a card from it waits, say that instead of calling its steps missing
  readBackRef.current = async () => {
    const plan = stepPlanRef.current
    if (!plan) return
    if (pendingRef.current?.kind === 'proposal') {
      push({ role: 'outcome', text: 'Part of this plan waits for your approval on the card above — it runs only if you approve it.' })
      return
    }
    stepPlanRef.current = null
    try {
      const rb = await readBackStepPlan(plan, host)
      for (const line of rb.lines) push({ role: 'outcome', text: line })
    } catch { /* a read-back never breaks the panel; nothing is claimed */ }
  }

  function noteCreated(created) {
    const turn = memoryRef.current?.currentTurn?.() ?? null
    if (!createdRef.current || createdRef.current.turn !== turn) createdRef.current = { turn, refs: [] }
    for (const r of Object.values(created || {})) {
      try { if (host?.charts?.read?.(String(r)) && !createdRef.current.refs.includes(String(r))) createdRef.current.refs.push(String(r)) } catch { /* not a chart */ }
    }
  }

  // ⭐ MISSION 3: the Undo entries ONE request committed on a mix of new and existing widgets become one GROUP (doUndo
  // takes it back as a whole, newest first). → how many entries were grouped.
  function groupFresh(idsBefore) {
    const fresh = undoRef.current.filter(e => !idsBefore.includes(e.id)).map(e => e.id)
    if (fresh.length < 2) return fresh.length
    const gid = `g${fresh[0]}`
    undoRef.current = undoRef.current.map(e => (fresh.includes(e.id) ? { ...e, group: gid } : e))
    return fresh.length
  }

  // ONE Undo entry, exactly as before (the receipt's Undo). `doUndo` (below) is the entry point: it adds the turn-level
  // GROUP (mission 3) on top of this, never a different check.
  const doUndoOne = useCallback(async (undoId, { member, voice, about = null } = {}) => {
    lastUndoRef.current = 'refused'
    const stack = undoRef.current
    const entry = undoId ? stack.find(e => e.id === undoId) : stack[stack.length - 1]
    if (!entry) {
      const text = 'There is nothing of mine to undo in this session.'
      lastUndoRef.current = 'none'
      push({ role: 'outcome', text })
      record({ member, outcome: text, outcomeData: { kind: 'undo-none' }, telemetry: { path: 'fast', undo: true, voice } })
      return
    }
    // ⛔ F14: "undo that indicator removal" when my newest change was not an indicator change → nothing
    // is undone; the member hears what the newest change WAS (Undo never reaches past it to an older one)
    if (about && !undoMatches(about, entry)) {
      // ⭐ round 3 (pl-exec): a DESCRIBED Undo takes back the most recent change of that kind in this session, not only the
      // newest one; the changes after it stay, and the member is told so. Its read-back and every refusal are doUndoOne's own.
      const older = undoId ? null : [...stack].reverse().find(e => e.id !== entry.id && undoMatches(about, e))
      if (older) {
        const ok = await doUndoOne(older.id, { member, voice })
        const after = stack.length - 1 - stack.indexOf(older)
        if (ok !== false && lastUndoRef.current !== 'refused') push({ role: 'outcome', text: `That was an earlier change: ${after === 1 ? 'the change after it stays as it is' : `the ${after} changes after it stay as they are`}.` })
        return ok
      }
      const text = `My last change wasn't ${/^[aeiou]/.test(undoWordOf(about)) ? 'an' : 'a'} ${undoWordOf(about)} change — it was: ${entry.lines.join(' · ').replace(/[.]+$/, '') || 'something else'}. Nothing was undone; say “undo” to take that back.`
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'undo-refused-mismatch' }, telemetry: { path: 'fast', undo: true, refused: true, voice } })
      return false
    }
    const guarded = undoProtectionRefusal(host, entry)
    if (guarded) {
      const text = `I didn't undo anything: ${guarded}`
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'undo-refused-protected' }, telemetry: { path: 'fast', undo: true, refused: true, voice } })
      return
    }
    if (entry.epoch != null && host?.boardInSync) {
      const s = await host.boardInSync()
      if (!s.ok) {
        const text = `I didn't undo anything: ${s.reason}. Reload this page to see the current board.`
        push({ role: 'refusal', text })
        record({ member, outcome: text, outcomeData: { kind: 'undo-refused' }, telemetry: { path: 'fast', undo: true, refused: true, voice } })
        return
      }
    }
    const res = await undoEntry(host, entry)
    if (res.ok) {
      withdrawPending()
      undoRef.current = stack.filter(e => e.id !== entry.id)
      memoryRef.current.noteUndone(entry.id)   // an undone change is no longer "the last change" (F2)
      setItems(xs => xs.map(x => (x.undoId === entry.id ? { ...x, undone: true } : x)))
      let saved = entry.epoch != null && host?.persist && !selfSaved(entry.items)
        ? await (async () => { try { const r = await host.persist(); return r && r.ok ? { ok: true } : { ok: false, reason: (r && r.reason) || 'not-saved' } } catch { return { ok: false, reason: 'not-saved' } } })()
        : { ok: true }
      if (saved.ok) saved = await confirmDrawings(host, entry.items.filter(it => it.kind === 'drawing').map(it => it.ref))
      if (!saved.ok) {
        lastUndoRef.current = 'unsaved'
        push({ role: 'receipt', lines: res.lines, undoId: null, isUndo: true, unsaved: true, notes: [UNSAVED_NOTE[saved.reason] || UNSAVED_NOTE['not-saved']] })
        record({ member, outcome: `${res.lines.join(' · ')} · NOT SAVED (${saved.reason})`, outcomeData: { kind: 'undo-unsaved' }, telemetry: { path: 'fast', undo: true, voice, refused: true } })
        rerender()
        return false
      }
      lastUndoRef.current = 'ok'
      push({ role: 'receipt', lines: res.lines, undoId: null, isUndo: true })
      record({ member, outcome: res.lines.join(' · '), outcomeData: { kind: 'undo' }, telemetry: { path: 'fast', undo: true, voice } })
      rerender()
      return true                             // NL-1 corrections apply their new change only after this
    }
    push({ role: 'refusal', text: res.reason })
    record({ member, outcome: res.reason, outcomeData: { kind: 'undo-refused' }, telemetry: { path: 'fast', undo: true, refused: true, voice } })
    rerender()
    return false
  }, [host, push, record, withdrawPending])

  // review F4: a planned "…, then undo it" whose change is now WAITING (an approval card, a which-chart question) never
  // leaves that card or question behind — approving it later would commit the change with no Undo after it
  // #766 nit 2: a QUESTION this plan raised (which chart? — with or without a pending pick) is WITHDRAWN too: its choices
  // are taken away (status 'withdrawn'), so no click can later run something the member never asked for on its own
  const dropHeldForUndo = (before) => {
    const q = pendingRef.current
    const asked = lastQuestionRef.current && lastQuestionRef.current !== before?.question ? lastQuestionRef.current : null
    const heldNow = q && q !== before?.pending ? q : null
    if (!heldNow && !asked) return false
    if (heldNow) {
      pendingRef.current = null
      if (heldNow.kind === 'proposal' && heldNow.id) patchItem(heldNow.id, { status: 'replaced' })
    }
    if (asked?.id) { patchItem(asked.id, { status: 'withdrawn' }); lastQuestionRef.current = null }
    push({ role: 'refusal', text: UNDO_HELD })
    return true
  }

  // ⭐ PHASE 3: "undo all of that" — every change the LAST request committed (memory.lastTurn's Undo entries), newest first,
  // each through doUndo (its own refusals: protected, another board, changed since). The first that can't be undone
  // stops it there, and the member is told exactly how many were taken back — never a partial Undo said as a whole one.
  // newest first, each through doUndo (its refusals and receipt); stops at the first that can't be undone, said exactly.
  // `rest` (#766 nit 3): the Undo was planned FIRST in a request with more to do — a partial Undo then says, in the SAME
  // message, that the rest was not made (never "Took back 1 of 2" followed by a second "that Undo didn't go through")
  const undoIds = useCallback(async (ids, { member, voice, rest = false, what = 'from your last request' } = {}) => {
    let done = 0
    for (const id of [...ids].reverse()) {
      const ok = await doUndoOne(id, { member: done ? null : member, voice })
      if (!ok) break
      done += 1
    }
    if (done === 0) return false                    // doUndo's own refusal (above) says it — nothing was taken back
    const left = ids.length - done
    const text = !left ? `Took back all ${done} changes ${what}.`
      : `Took back ${done} of the ${ids.length} changes ${what}, then stopped (above) — the other ${left} ${left === 1 ? 'is' : 'are'} still in place${rest ? ', so I didn’t make the rest of your request' : ''}.`
    if (left) lastUndoRef.current = 'partial'
    push({ role: 'agent', text })
    record({ member: null, outcome: text, outcomeData: { kind: 'undo-turn', done, of: ids.length }, telemetry: { path: 'fast', undo: true, voice } })
    return !left
  }, [doUndoOne, push, record])
  // ⭐ MISSION 3 (turn-level Undo group): the steps of ONE grouped request (add + change existing, run in order) each keep
  // their own Undo entry, tagged with the same `group`. A bare Undo (the words, or the receipt's Undo) of the newest of them
  // takes back the WHOLE request, newest first, each entry through doUndoOne (every refusal unchanged); the first that can't
  // be undone stops it there, said exactly. A described Undo ("undo the timeframe change") takes back only the steps of
  // the group it describes. `single`: exactly the one entry (the group runner itself).
  const doUndo = useCallback(async (undoId, { member, voice, about = null, rest = false, single = false } = {}) => {
    const stack = undoRef.current
    const entry = undoId ? stack.find(e => e.id === undoId) : stack[stack.length - 1]
    // OWNER RULING (W2, 11-04: "undo" after "add the 9 and 20 EMAs" took back only one EMA): a PLAIN Undo of the newest
    // change takes back the WHOLE last request when that request committed several changes — the same turn-level group
    // as mission 3, newest first, each through doUndoOne (every refusal unchanged). A described Undo ("undo the colour
    // change") and an Undo of a named entry stay exactly one entry.
    if (!undoId && !about && !single && entry) {
      const turnIds = (memoryRef.current?.lastTurn?.(epochOf(host))?.undoIds || []).filter(id => stack.some(e => e.id === id))
      if (turnIds.length > 1 && turnIds.includes(entry.id)) return await undoIds(turnIds, { member, voice, rest, what: 'from that request' })
    }
    const group = !single && entry?.group ? stack.filter(e => e.group === entry.group) : null
    if (!group || group.length < 2) return await doUndoOne(undoId, { member, voice, about })
    const ids = about ? group.filter(e => undoMatches(about, e)).map(e => e.id) : group.map(e => e.id)
    if (!ids.length) return await doUndoOne(undoId, { member, voice, about })   // the mismatch refusal, as before
    if (ids.length === 1) return await doUndoOne(ids[0], { member, voice })
    return await undoIds(ids, { member, voice, rest, what: 'from that request' })
  }, [host, doUndoOne, undoIds])
  const undoTurn = useCallback(async ({ member, voice, rest = false } = {}) => {
    const ids = (memoryRef.current?.lastTurn?.(epochOf(host))?.undoIds || []).filter(id => undoRef.current.some(e => e.id === id))
    if (ids.length <= 1) return await doUndo(ids[0] || null, { member, voice })
    return await undoIds(ids, { member, voice, rest })
  }, [host, doUndo, undoIds])

  const approve = useCallback(async (count = null, { member, voice } = {}) => {
    const p = pendingRef.current
    if (!p || p.kind !== 'proposal') {
      const text = 'There is no proposal waiting.'
      push({ role: 'outcome', text })
      return
    }
    pendingRef.current = null
    // A proposal belongs to the board it was made on. If another layout is open now,
    // its refs (and "the workspace") would mean a different board: never apply it there.
    if (p.epoch != null && p.epoch !== epochOf(host)) {
      patchItem(p.id, { status: 'dismissed' })
      const text = "A different layout is open now, so I didn't apply that proposal — it was for the board you had open then. Nothing was changed. Ask again if you still want it."
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'refused-stale' }, telemetry: { path: 'approved', refused: true, voice } })
      return
    }
    // ⛔ F6: an expired proposal is never applied — the member asks again and approves the current version
    if (p.expiresAt != null && !(Date.now() <= p.expiresAt)) {
      patchItem(p.id, { status: 'expired' })
      const text = `That proposal expired (a proposal is good for 10 minutes), ${STALE_PROPOSAL}`
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'refused-expired', actions: p.ops.map(o => o?.action) }, telemetry: { path: 'approved', refused: true, voice } })
      return
    }
    // a sealed or fanned-out proposal is approved whole (its parts were approved together)
    if (count && p.card) {
      pendingRef.current = p
      push({ role: 'refusal', text: 'That proposal can only be applied as a whole — say “do it”, or dismiss it.' })
      return
    }
    // ⛔ an approval with nothing to bind it to is never run (fail closed)
    if (!p.binding) {
      patchItem(p.id, { status: 'expired' })
      const text = `That proposal can no longer be checked against what you approved, ${STALE_PROPOSAL}`
      push({ role: 'refusal', text })
      record({ member, outcome: text, outcomeData: { kind: 'refused-stale-proposal', actions: p.ops.map(o => o?.action) }, telemetry: { path: 'approved', refused: true, voice } })
      return
    }
    patchItem(p.id, { status: 'approved' })
    // PLANNER v2: the card is a step of a paused turn — its outcome joins THAT turn's Undo group (a fresh message
    // typed meanwhile started its own group; this re-opens the paused one only for the approval and what follows)
    if (v2Ref.current?.paused()) memoryRef.current.resumeTurn(v2Ref.current.memoryTurn())
    const ops = count ? p.ops.slice(0, count) : p.ops
    // ⭐ PHASE 3 acceptance: the card was one step of a whole workspace the member chose ("Replace current board" / "New
    // layout") — once it has landed in full, the rest of that request runs, each step through the same execute
    const kinds = p.then ? [] : null
    if (kinds) tapRef.current = kinds
    try {
      await execute(ops, { path: 'approved', mode: 'approved', member, voice, approval: p.seals || null, card: p.card || null, binding: p.binding, subset: !!count && count < p.ops.length, proposedWords: p.words || null })
    } finally { if (kinds) tapRef.current = null }
    // NLM-1 step plans (dark): the plan this card belonged to is read back now that it has run
    if (stepPlanRef.current) await readBackRef.current?.()
    // PLANNER v2: the card was a step of a paused turn — its outcome resumes the server's loop
    if (v2Ref.current?.paused()) { await v2Ref.current.afterCard(v2DepsRef.current()); return }
    if (!p.then) return
    const t = p.then
    if (!count && kinds.includes('applied') && kinds.every(k => k === 'applied' || k === 'noop')) {
      await runCompoundRef.current?.(t.steps, { member: t.member, voice: t.voice, working: t.grid ? chartsShowing(host, t.grid) : t.working })
    } else {
      const text = `I stopped there, so nothing after it was started: ${t.steps.map(x => `“${x.text}”`).join(', ')}.`
      push({ role: 'agent', text })
      record({ member, outcome: text, outcomeData: { kind: 'compound-stopped' }, telemetry: { path: 'approved', refused: true, voice } })
    }
  }, [execute, patchItem, push, record, host])

  const dismiss = useCallback(({ member } = {}) => {
    const p = pendingRef.current
    pendingRef.current = null
    if (p?.kind === 'proposal') patchItem(p.id, { status: 'dismissed' })
    const text = 'Okay — nothing changed.'
    push({ role: 'outcome', text })
    record({ member, outcome: text, outcomeData: { kind: 'dismissed' }, telemetry: { path: 'fast' } })
    // NLM-1 step plans (dark): a card dismissed mid-plan — what of the plan IS in place, read back (the rest never ran)
    if (stepPlanRef.current) readBackRef.current?.()
    // PLANNER v2: a dismissed card resumes the paused turn with a refusal (the model is told; nothing ran)
    if (v2Ref.current?.paused()) return v2Ref.current.afterCard(v2DepsRef.current())
    return undefined
  }, [patchItem, push, record])

  // A local "which one?" for fast-path ops when several targets of the kind exist.
  const chooseTarget = useCallback(async (ref, label) => {
    const p = pendingRef.current
    if (!p || p.kind !== 'target') return
    pendingRef.current = null
    push({ role: 'member', text: label })
    if (!p.draft && p.epoch !== epochOf(host)) {
      push({ role: 'refusal', text: "A different layout is open now, so I didn't change anything. Ask again." })
      return
    }
    if (p.setChoice) {
      // #988 (option 2): the whole "every chart except …" set, exactly — or nothing
      if (ref !== p.setChoice.ref) return
      lastActionsRef.current = p.setChoice.ops.map(o => o.action)
      return await execute(p.setChoice.ops, { path: p.path, mode: p.mode === 'propose' ? 'propose' : 'apply', member: `${p.member || ''} → ${label}`, voice: p.voice })
    }
    if (p.gridChoice) {
      // live train 4: the member's pick — replace the charts (a card: it removes charts) or add these beside them
      const ops = ref === 'grid:replace' ? p.gridChoice.replace : ref === 'grid:add' ? p.gridChoice.add : null
      if (!ops) return
      // ⛔ CHART RAIL: the member's pick is part of this request's words ("Replace my 2 charts with these 4" permits the replace)
      railWordsRef.current = [railWordsRef.current, label].filter(Boolean).join(' . ')
      lastActionsRef.current = ops.map(o => o.action)
      if (p.gridThen?.length) {
        // review t4 M5: the grid, then the per-chart changes — one request (runCompound; a card holds the rest until approved)
        const grid = ops[0]?.args?.symbols || []
        return await runCompoundRef.current?.([
          { text: `set up the ${grid.join(', ')} charts`, kind: 'planned', ops, grid, resume: true, fresh: ref === 'grid:add' },
          { text: 'the rest on those charts', kind: 'planned', each: p.gridThen },
        ], { member: `${p.member || ''} → ${label}`, voice: p.voice })
      }
      return await execute(ops, { path: 'fast', mode: 'apply', member: `${p.member || ''} → ${label}`, voice: p.voice })
    }
    if (p.workspace) {
      // ⭐ PHASE 3 acceptance: replace the board, or build the whole workspace in a new layout — then the WHOLE request runs
      if (ref === 'workspace:new' && !host?.layouts) {
        push({ role: 'refusal', text: 'Layouts aren’t available here, so I can’t build it in a new layout. Nothing changed.' })
        return
      }
      const entries = (() => { try { return host?.layouts?.snapshot?.()?.entries || [] } catch { return [] } })()
      return await runCompoundRef.current?.(workspaceSteps(p.workspace.steps, ref, host, entries), { member: `${p.member || ''} → ${label}`, voice: p.voice })
    }
    if (p.follow) {
      // ⭐ PHASE 2: "which one?" about the conversation's indicators — the same words, on the one picked
      const r = resolvePicked(p.follow.words, ref, { host, memory: memoryRef.current, epoch: epochOf(host) })
      if (r?.ops?.length) {
        memoryRef.current.notePick(r.ids)
        await execute(r.ops, { path: p.path, mode: 'apply', member: `${p.member || ''} → ${label}`, voice: p.voice })
      } else push({ role: 'refusal', text: r?.say || 'That indicator isn’t on the chart any more, so nothing changed.' })
      return
    }
    if (p.pickArg) {
      const { action, arg, then } = p.pickArg
      const filled = p.ops.map(o => (o.action === action ? { ...o, args: { ...o.args, [arg]: ref } } : o))
      // the chart picked for an indicator the member asked to CREATE: built, saved and added there (createWithSave)
      const ops = typeof then === 'function' ? then(filled, ref) : filled
      await execute(ops, { path: p.path, mode: p.mode === 'propose' && !explicitIndicatorCreate(ops) ? 'propose' : 'apply', member: `${p.member || ''} → ${label}`, voice: p.voice })
      return
    }
    if (p.draft) {
      // the member picked a draft: it becomes the selected one; only the draft ops are re-aimed
      if (!selectDraft(host, ref)) { push({ role: 'refusal', text: 'That draft is no longer available, so nothing changed.' }); return }
      await execute(p.ops.map(o => (isDraftAction(o.action) ? { ...o, target: ref } : o)), { path: p.path, mode: p.mode === 'propose' ? 'propose' : 'apply', member: `${p.member || ''} → ${label}`, voice: p.voice, chosen: true })
      return
    }
    // (a model PROPOSAL re-aimed by a "which chart?" pick stays a proposal; fast picks set no mode)
    await execute(p.ops.map(o => ({ ...o, target: ref })), { path: p.path, mode: p.mode === 'propose' ? 'propose' : 'apply', member: `${p.member} → ${label}`, voice: p.voice })
  }, [execute, push, host])

  // ⭐ PHASE 2 — A MULTI-STEP REQUEST (agent/compound.js): read in full before anything runs, then step by step on the
  // live board, each step through the ordinary execute (own plan, policy, receipt, Undo). A step that does not fully
  // land — refused, failed, asking, or waiting for approval — STOPS the request: what was done and what was not is
  // said plainly, never reported as the whole request.
  // How a step of a multi-step request is READ (no execution): the NLM-1 readers first (a step's own created chart, an
  // ordinal among this request's new charts), then the ordinary resolver, then the NLM-1 follow-up mechanisms. Shared by
  // runCompound and the NLM-1 whole-message pre-check (so the check reads each step exactly as the run would).
  const readStepRef = useRef(null)
  readStepRef.current = (step, working) => {
    // ⭐ NLM-1 D2 (dark): a step that refers to the chart IT creates ("…, add a chart for AMD and put the 21 ema on it, …")
    const made = routingV2Active() && step.kind === 'fast' ? planCreatedReference(step.text, host) : null
    // D2.1 (dark): "…, then make the second one weekly" — counted among the charts this request's grid step made
    const ord = !made?.ops && routingV2Active() ? rescopeOrdinal(step.text, { host, order: working || [] }) : null
    let r = made?.ops ? { ops: made.ops } : ord?.ops ? { ops: ord.ops } : resolveStep(step, { host, memory: memoryRef.current, epoch: epochOf(host), working })
    // D2.2 (dark): a step no reader takes ("…, add the 21 ema and make it orange": the indicator the step before added),
    // read by the NLM-1 mechanisms over what THIS request has committed so far (memory's current turn)
    if (routingV2Active() && (r.say || !r.ops?.length) && !r.noop) {
      const fo = resolveFollowUpOps(step.text, { host, memory: memoryRef.current, epoch: epochOf(host), created: createdRef.current?.refs || [], before: null })
      if (fo?.ops) r = { ops: fo.ops }
    }
    return r
  }

  // `whole` (NLM-1 multi-step REWRITES only): the steps are NLM-1's reading of ONE message the member typed, so they run all
  // or not at all — a step that is not read, or does not go through, never ends in "stopped at …": nothing run yet → the
  // run returns { fallback: true } (the caller hands the member's ORIGINAL message to the planner, exactly as v1 does);
  // steps already run → they are taken back first (this request's own Undo entries, newest first), then the same.
  // A step that waits on an approval card or an answer is not a failure: it stops there as before.
  const runCompound = useCallback(async (steps, { member, voice, working: working0 = null, whole = false }) => {
    const idsAtStart = undoRef.current.map(e => e.id)    // NLM-1 D2 (dark): the whole request's Undo entries, grouped at the end
    let working = working0
    let done = 0
    const fallBack = async () => {
      mark('nlm1:whole-fallback', String(done))
      const fresh = undoRef.current.map(e => e.id).filter(id => !idsAtStart.includes(id))
      if (!fresh.length) return { fallback: true, rolledBack: 0 }
      // #806 LOW-1: the request's own entries are taken back as ONE group (newest first, each through its own exact Undo
      // and checks; one receipt) — never entry by entry through the plain Undo, which already takes the whole request
      // and then said "nothing of mine to undo" for the rest
      const ok = fresh.length === 1 ? await doUndoOne(fresh[0], { member: null, voice }) : await undoIds(fresh, { member: null, voice, what: 'from the steps I had started' })
      const left = fresh.filter(id => undoRef.current.some(e => e.id === id))
      if (ok && !left.length && lastUndoRef.current !== 'unsaved') return { fallback: true, rolledBack: fresh.length }
      // the take-back did not fully go through: the board is NOT as the member left it, so the planner is never asked
      // to plan over it — said plainly, and nothing else runs
      const text = left.length
        ? `I couldn’t finish that request step by step, and ${left.length} of the changes I had started ${left.length === 1 ? 'is' : 'are'} still on your board (see above) — I couldn’t take ${left.length === 1 ? 'it' : 'them'} back. I stopped there and didn’t ask the model to try it, so nothing else will change. Check the board, then ask again.`
        : 'I couldn’t finish that request step by step. I took back what I had started, but that couldn’t be saved (see above). I stopped there and didn’t ask the model to try it. Check the board, then ask again.'
      push({ role: 'agent', text })
      record({ member, outcome: text, outcomeData: { kind: 'compound-takeback-failed', left: left.length, of: fresh.length }, telemetry: { path: 'fast', refused: true, voice } })
      return { done: true, takebackFailed: true }
    }
    const stop = (i, why) => {
      const rest = steps.slice(i).map(s => `“${s.text}”`)
      const text = done
        ? `Done ${done} of ${steps.length} steps, then stopped at ${rest[0]}: ${why}. Not done: ${rest.join(', ')}.`
        : `Stopped at ${rest[0]}: ${why}. ${rest.length > 1 ? `Nothing after it was started: ${rest.slice(1).join(', ')}.` : ''}`.trim()
      push({ role: 'agent', text })
      record({ member, outcome: text, outcomeData: { kind: 'compound-stopped', step: i, of: steps.length }, telemetry: { path: 'fast', refused: true, voice } })
    }
    let prevIds = null                        // the Undo entries the step before committed (null = no step yet)
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      // hotfix 2026-11-03: "change NVDA to weekly, then undo that" — the Undo of exactly what the step before committed,
      // through doUndo (its refusals and receipt); a first-step Undo is the ordinary Undo of the newest change
      if (step.kind === 'undo') {
        const about = fastParse(step.text, { host })?.about || null
        if (prevIds && !prevIds.length) { stop(i, 'the step before it didn’t make a change I could take back, so nothing was undone'); return }
        let ok = true
        if (!prevIds) ok = await doUndo(null, { member: null, voice, about })
        else for (const id of [...prevIds].reverse()) { ok = await doUndo(id, { member: null, voice, about }); if (!ok) break }
        if (!ok) { stop(i, lastUndoRef.current === 'unsaved' ? 'that Undo put things back but couldn’t be saved (see above)' : 'that Undo didn’t go through (see above)'); return }
        done += 1
        prevIds = []
        continue
      }
      const idsBefore = undoRef.current.map(e => e.id)
      const chartRefsBefore = (() => { try { return (host?.charts?.list?.() || []).map(c => c.ref) } catch { return [] } })()
      const r = readStepRef.current(step, working)
      if (whole && stepUnread(r)) return await fallBack()
      if (r.noop) { if (r.note) push({ role: 'outcome', text: r.note }); done += 1; prevIds = []; continue }
      if (r.note) push({ role: 'outcome', text: r.note })
      if (r.say || !r.ops?.length) { stop(i, String(r.say || 'there was nothing to do there').replace(/[.]+$/, '')); return }
      if (r.ops.length > MAX_STEP_OPS) { stop(i, `that step would make ${r.ops.length} changes, and UCT makes at most ${MAX_STEP_OPS} in one step`); return }
      if (r.pick) memoryRef.current.notePick(r.pick)
      lastActionsRef.current = r.ops.map(o => o.action)
      const kinds = []
      tapRef.current = kinds
      try { await execute(r.ops, { path: 'fast', mode: 'apply', member, voice, noDuplicates: true }) } finally { tapRef.current = null }
      const landed = kinds.includes('applied') || kinds.includes('noop')
      const off = kinds.filter(k => k !== 'applied' && k !== 'noop')
      if (!landed || off.length) {
        // ⭐ PHASE 3 acceptance: a step of the whole workspace the member chose that needs their approval (replacing the
        // board, creating the layout) — the rest waits on THAT card and runs when they approve it (approve())
        if (step.resume && off.length && off.every(k => k === 'proposed') && pendingRef.current?.kind === 'proposal') {
          const rest = steps.slice(i + 1)
          if (rest.length) {
            pendingRef.current = { ...pendingRef.current, then: { steps: rest, grid: r.grid || null, working, member, voice } }
            push({ role: 'outcome', text: `When you approve the card above, I'll carry on with the rest: ${rest.map(x => `“${x.text}”`).join(', ')}.` })
          }
          return
        }
        if (whole && !off.includes('proposed') && !off.some(k => k.startsWith('clarify'))) return await fallBack()
        const why = off.includes('proposed') ? 'that step needs your approval first — the card above'
          : off.some(k => k.startsWith('clarify')) ? 'that step needs your answer first'
            : 'that step didn’t fully go through (see above)'
        stop(i, why)
        return
      }
      done += 1
      prevIds = undoRef.current.map(e => e.id).filter(id => !idsBefore.includes(id))
      // review t4 M5: a grid that ADDED the charts beside others showing the same tickers ("Add 4 more") — the rest goes on the
      // NEW charts only (the charts that were already there are never the target)
      if (r.grid) {
        const showing = chartsShowing(host, r.grid)
        const added = showing.filter(ref => !(chartRefsBefore || []).includes(ref))
        working = step.fresh && added.length ? added : showing
      }
    }
    // one step ("put rsi underneath"): its own receipt says it all
    if (steps.length > 1) push({ role: 'agent', text: `All ${steps.length} steps done.` })
    // ⭐ NLM-1 D2 (dark): every step of ONE request is ONE Undo group — "undo" takes the whole request back, newest first
    // (doUndo's group path: each entry's own exact Undo and checks). Off: each step keeps its own entry, as before.
    if (routingV2Active()) groupFresh(idsAtStart)
    return { done: true }
  }, [host, execute, push, record, doUndo, doUndoOne, undoIds])
  runCompoundRef.current = runCompound
  // PLANNER v2: the runner reads the CURRENT closures on every call (never captured when the panel opened)
  v2DepsRef.current = () => ({ host, push, record, execute, memoryRef, conversationRef, setConversationId, capCtx, tapRef: v2TapRef, mark, patchItem, pendingRef,
    // v2-readiness-2: a v2 agent.undo step runs the receipt's own Undo (steps.js runUndoStep)
    doUndo, undoTurn, undoRef })

  const send = useCallback(async (raw, { voice = false, answering = false, asNew = false, echo = true } = {}) => {
    let text = String(raw || '').trim()       // NLM-1 D2/D3 may read it as its explicit form (below; dark)
    if (!text || lockRef.current) return
    lockRef.current = true
    // pl-teach round 6 (pl-auto new-command): a new request, from any input path, ends a walkthrough on screen (a guide request
    // then starts its own; "do it for me" still finds it: guideStore keeps what was last shown)
    endForNewRequest()
    turnStart('send')
    saidRef.current = text
    // ⛔ PENDING TASK: "yes" / "no" typed to "Is that your answer to my question about …?" — exactly as the two choices
    const held = !answering && !asNew ? pendingRef.current?.continuity : null
    if (held && /^(?:yes|yeah|yep|yup|y|continue|correct)\b|^(?:no|nope|nah|n)\b/i.test(text)) {
      pendingRef.current = null
      if (echo) push({ role: 'member', text, voice })
      const r = resumeRef.current(held, !/^(?:no|nope|nah|n)\b/i.test(text))
      answering = !!r.answering
      asNew = !!r.asNew
      echo = false
      text = held.text
      saidRef.current = text
    }
    let askedFor0 = askedForRef.current
    // ⛔ PENDING TASK (hotfix 2026-11-13, agent/pendingTask.js): the model's open question expires (QUESTION_TTL_MS) —
    // withdrawn, and the reply is read on its own (the chart rail still guards whatever it plans)
    if (askedFor0 && !answering && Date.now() - (askedAtRef.current || 0) > QUESTION_TTL_MS) {
      const old = lastQuestionRef.current
      if (old?.id && !old.local) { patchItem(old.id, { status: 'withdrawn' }); lastQuestionRef.current = null }
      pendingQuestionRef.current = null
      askedGroupsRef.current = null
      askedForRef.current = null
      askedFor0 = null
    }
    // ⭐ LT-5 / LT-6 (live 2026-11-03: "trendline on nvda from 2031-01-01 to today" typed while UCT still waited on its
    // October-lows question was answered ABOUT October): a message that is not an answer to the open question is a NEW
    // request. The question is WITHDRAWN (its choices go), nothing of it is carried (words, groups, a held plan), and the
    // model is told it was set aside — never merged into the new request.
    const qOpen = lastQuestionRef.current
    const localOpen = pendingRef.current?.kind === 'target'
    // ⛔ hotfix 2026-11-13 (live: "Add AAPL and MSFT as the other two charts" answering "which two tickers?" was set aside and run
    // ALONE): a reply that points back at the pending task, or gives the tickers the question asked for, ANSWERS it; one that
    // could fill the task or replace charts is ASKED about (never run alone) — pendingTask.replyRelation
    const relation = answering ? 'answer' : asNew ? 'new' : (askedFor0 || localOpen) ? replyRelation(text, qOpen, askedFor0, isNewRequest) : 'answer'
    // review #771 delta H1/L3: this message ANSWERS the model's open question (a choice, or a short reply) — else it is routed fresh
    // review gaps-5: an unclear reply is an ANSWER — it keeps carrying the original request (only a set-aside one is fresh)
    const carryAsked = !!askedFor0 && relation === 'answer'
    // the reply CONTINUES the model's pending task: it goes to the model with the question, never through the instant readers
    const continuing = carryAsked && !answering
    const setAside = (!!askedFor0 || localOpen || asNew) && relation === 'new'
    const askedFor = setAside ? null : askedFor0
    askedForRef.current = null
    railWordsRef.current = [carryAsked ? askedFor0 : null, text].filter(Boolean).join(' . ')
    if (relation === 'unclear') {
      // asked, never guessed: the reply and the pending task are both held; nothing runs until the member picks
      if (echo) push({ role: 'member', text, voice })
      pendingRef.current = { kind: 'target', ops: [], path: 'fast', member: text, voice, epoch: epochOf(host),
        continuity: { text, askedFor: askedFor0, at: askedAtRef.current, groups: askedGroupsRef.current, pq: pendingQuestionRef.current, qid: qOpen?.id || null } }
      const q = continueQuestion(askedFor0)
      push({ role: 'question', text: q, choices: [...CONTINUE_CHOICES, { label: 'Cancel', cancel: true }], local: true })
      record({ member: text, outcome: q, outcomeData: { kind: 'clarify-referent' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
      releaseLock()
      turnEnd()
      return
    }
    if (setAside) {
      if (localOpen) pendingRef.current = null
      pendingQuestionRef.current = null
      askedGroupsRef.current = null
      if (qOpen?.id) patchItem(qOpen.id, { status: 'withdrawn' })
      lastQuestionRef.current = null
      questionSetAsideRef.current = true
    }
    if (echo) push({ role: 'member', text, voice })
    setBusy(true)
    // ⭐ PHASE 2: everything this message commits is one turn of session memory ("do the same on the others")
    memoryRef.current.beginTurn()
    try {
      // a layout opened since the last turn drops the board's refs — on BOTH paths: NL-1 sends memory to the model
      memoryRef.current.seeBoard(visitOf(host))
      // ⭐ NLM-1 D2/D3 (dark, two keys — nlm1/flag.js): an elliptical request ("same for QQQ", "now the right one too",
      // "add a chart for AMD with RSI") is READ as its explicit form, made from the last committing message (the referent
      // tracker); only when no reader reads it as typed, and only when a reader reads the explicit form. Everything after
      // (readers, planner, policy, runtime, receipts, grouped Undo) is unchanged. The transcript keeps the member's words.
      if (routingV2Active()) {
        if (!answering && !continuing && !pendingRef.current) {
          // D2/D3.1: "make the first one weekly" right after a request that CREATED several charts — counted among them
          const ord = rescopeOrdinal(text, { host, order: createdRef.current?.refs || [] })
          if (ord?.ops) {
            mark('nlm1:ordinal', ord.rule)
            referentsRef.current.noteState(memoryRef.current.currentTurn(), snapshotOf(host))
            referentsRef.current.note(memoryRef.current.currentTurn(), text)
            lastActionsRef.current = ord.ops.map(o => o.action)
            return await execute(ord.ops, { path: 'fast', mode: 'apply', member: text, voice })
          }
          const last = memoryRef.current?.lastTurn?.(epochOf(host))
          // read as the panel reads it: "the new one" is "it" bound to the chart just created (asSubjectWords)
          const reads = (t0) => { const t = asSubjectWords(t0, createdRef.current?.refs || null, gridChanged(host)).text; try { return [fastParse(t, { host }), multiChartPlan(t, { host }), planCompound(t, { host })].some(r => r && r.kind !== 'say') } catch { return false } }
          const typed = reads(text)
          // D3.3: an explicit form counts as read when a reader OR an NLM-1 mechanism (a created-chart plan, a command at a
          // referent set, a swap, a follow-up over the request so far) takes it — "already read as typed" stays the readers only
          const nlmTakes = (t) => { try { return !!(planCreatedReference(t, host)?.ops || resolveFollowUpOps(t, { host, memory: memoryRef.current, epoch: epochOf(host), created: createdRef.current?.refs || [], before: null })?.ops) } catch { return false } }
          let nlm1FellBack = false
          let rw = nlm1Rewrite(text, { prev: last ? referentsRef.current.textOf(last.id) : null, claims: (t) => reads(t) || nlmTakes(t), originalClaimed: typed })
          // ⛔ ALL OR NOTHING (AUDIT, #806): a reading made of STEPS is taken only when EVERY step reads on this board now —
          // otherwise NLM-1 declines and the member's message goes on exactly as typed (to the planner, as v1 sends it).
          // NLM-1 never stops a request v1 would have handed to the planner.
          const unreadStep = rw?.steps?.length > 1 ? rw.steps.findIndex(x => preUnread({ kind: 'fast', text: x }, readStepRef.current)) : -1
          if (unreadStep >= 0) { mark('nlm1:rewrite-declined', `${rw.rule}:${unreadStep}`); rw = null }
          if (rw) { mark('nlm1:rewrite', rw.rule); text = rw.text }
          // D2.2: a request whose parts must each run on their own ("<request>, then do the same for QQQ": each part's "it" is
          // the chart THAT part creates) — the ordinary multi-step run (runCompound): each part read, executed, receipted,
          // one Undo group
          if (rw?.steps?.length > 1) {
            referentsRef.current.noteState(memoryRef.current.currentTurn(), snapshotOf(host))
            referentsRef.current.note(memoryRef.current.currentTurn(), rw.steps[rw.steps.length - 1])
            const ran = await runCompoundRef.current?.(rw.steps.map(x => ({ kind: 'fast', text: x })), { member: text, voice, whole: true })
            if (!ran?.fallback) return ran
            // a step did not go through after all (anything run was taken back): the member's ORIGINAL message, as v1 sends
            // it — never through the NLM-1 mechanisms again (#806 LOW-2); the taken-back request is no referent
            referentsRef.current.forget(memoryRef.current.currentTurn())
            text = String(raw || '').trim()
            nlm1FellBack = true
          }
          // D2/D3.1 (nlm1/followupOps.js): a follow-up no reader takes, as OPERATIONS — chart referent sets (positions,
          // ordinals, quantifiers), repeat / additive copies of the last request, "back to" inversion from the snapshot
          // taken before it, removal by position. Its ops go through the same execute (policy, runtime, receipts, Undo).
          const conv = (() => { try { return resolveFollowUp(text, { host, memory: memoryRef.current, epoch: epochOf(host) }) } catch { return null } })()
          // (D3.3: also when the message WAS rewritten to a form only an NLM-1 mechanism takes — "give AMD rsi" → "add rsi to
          // AMD" — the readers would hand that to the model)
          if (!nlm1FellBack && !(rw ? reads(text) : typed) && !conv) {
            const fo = resolveFollowUpOps(text, { host, memory: memoryRef.current, epoch: epochOf(host), created: createdRef.current?.refs || [],
              before: last ? referentsRef.current.stateBefore(last.id) : null })
            if (fo?.say) {
              referentsRef.current.noteState(memoryRef.current.currentTurn(), snapshotOf(host))
              push({ role: 'agent', text: fo.say })
              record({ member: text, outcome: fo.say, outcomeData: { kind: 'clarify-referent' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
              return
            }
            if (fo?.ops) {
              mark('nlm1:followup-ops', fo.rule)
              referentsRef.current.noteState(memoryRef.current.currentTurn(), snapshotOf(host))
              referentsRef.current.note(memoryRef.current.currentTurn(), text)
              lastActionsRef.current = fo.ops.map(o => o.action)
              return await execute(fo.ops, { path: 'fast', mode: 'apply', member: text, voice })
            }
          }
        }
        // the board as THIS message found it (the "back to …" inversion of a later message reads it)
        referentsRef.current.noteState(memoryRef.current.currentTurn(), snapshotOf(host))
        referentsRef.current.note(memoryRef.current.currentTurn(), text)
      }
      // ⭐ NL-1 (owner 2026-10-16; flag off by default): the MODEL reads the request. Only EXACT Undo /
      // Confirm / Cancel stay instant, and only when there is something for them to act on. Everything
      // else — references, corrections, a typed answer to a question — is read by the model (with the
      // question it answers: pending_question), then checked and executed by the same code as always.
      const nl1 = nl1Enabled()
      if (nl1) {
        const x = exactLane(text)
        if (x?.kind === 'undo') return await doUndo(null, { member: text, voice })
        if (x?.kind === 'confirm' && pendingRef.current?.kind === 'proposal') return await approve(null, { member: text, voice })
        if (x?.kind === 'dismiss' && (pendingRef.current || pendingQuestionRef.current)) { pendingQuestionRef.current = null; return await dismiss({ member: text }) }
        if (x?.kind === 'dismiss' && peekAuthoringIntent()) {
          // the Create Indicator door's question is set aside — nothing is built, no model call
          clearAuthoringIntent()
          const t = 'OK — nothing was built.'
          push({ role: 'agent', text: t })
          record({ member: text, outcome: t, outcomeData: { kind: 'authoring-cancelled' }, telemetry: { path: 'local', voice } })
          return
        }
      }
      if (!nl1) { // ── the legacy instant path: unchanged (not re-indented, so its diff stays empty) ──
      // A choice clicked under the MODEL's own question answers that question:
      // it goes back to the model (which has the conversation), never through the
      // fast path, which would act on the bare label ("Hide volume") out of context.
      // ⭐ GATE C REFERENCES (agent/references.js): "open the third one", "compare it to the others", "do
      // the same on the right one" — from session memory, re-validated against the live board. Never while
      // a question or an authoring answer is waiting (those words answer THAT). A reference that cannot hold
      // is said plainly (`say`); one it cannot read goes on to the instant path / the model as before.
      const epochNow = epochOf(host)
      // GATE C: the member CORRECTING the Agent ("no, I meant the weekly", "not that one") — kept as context
      // for the model (session memory → conversation_memory.recent_corrections); never acted on by itself
      if (CORRECTION.test(text)) memoryRef.current.noteCorrection(text)
      const memRef = (answering || continuing || pendingRef.current || peekAuthoringIntent()) ? null
        : resolveReference(text, { host, memory: memoryRef.current, epoch: epochNow })
      if (memRef?.kind === 'say') {
        push({ role: 'agent', text: memRef.text })
        record({ member: text, outcome: memRef.text, outcomeData: { kind: 'reference-refused' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
        return
      }
      // ⭐ PHASE 2 — DO IT FOR ME: "now do it for me" right after a walkthrough runs that feature's EXISTING capability
      // on the chart it showed (agent/capabilities/guide.doItForMe) — asked first when a value is needed (which
      // timeframe?), then planned, checked, receipted and undoable like any other request. Never with a proposal waiting.
      const guideDo = answering || continuing || memRef || pendingRef.current ? null : doItForMe(text, host)
      if (guideDo?.say) {
        push({ role: 'agent', text: guideDo.say })
        record({ member: text, outcome: guideDo.say, outcomeData: { kind: 'guide-do-say' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
        return
      }
      if (guideDo?.ask) {
        const a = guideDo.ask
        pendingRef.current = { kind: 'target', ops: a.ops, path: 'fast', mode: 'apply', member: text, voice, epoch: epochOf(host), pickArg: a.pickArg }
        push({ role: 'question', text: a.text, choices: a.choices, local: true })
        record({ member: text, outcome: a.text, outcomeData: { kind: 'clarify-arg', actions: a.ops.map(o => o.action) }, telemetry: { path: 'fast', clarified: true, voice } })
        return
      }
      // ⭐ PHASE 3: "actually, change the second chart instead" — my last change, moved: the existing Undo FIRST (it refuses
      // when the change is protected, on another board or changed since — then nothing else runs), then the same change
      // on the chart now named (references.retargetCorrection)
      const moveTo = answering || continuing || memRef || pendingRef.current ? null
        : retargetCorrection(text, { host, memory: memoryRef.current, epoch: epochNow, undoStack: undoRef.current })
      if (moveTo?.say) {
        push({ role: 'agent', text: moveTo.say })
        record({ member: text, outcome: moveTo.say, outcomeData: { kind: 'retarget-refused' }, telemetry: { path: 'fast', refused: true, voice } })
        return
      }
      if (moveTo?.ops) {
        const reversed = await doUndo(moveTo.undoId, { member: text, voice })
        if (!reversed) return
        lastActionsRef.current = moveTo.ops.map(o => o.action)
        return await execute(moveTo.ops, { path: 'fast', mode: 'apply', member: null, voice })
      }
      // ⭐ Charts operator P1: whole sentences that name SEVERAL charts — "NVDA on the left and AMD on the right",
      // "show NVDA and AMD side by side", "make the left chart look like the right one" (agent/multiChart.js). The
      // same registry ops through the same execute; anything it can't read with certainty goes on as before.
      const multi0 = (answering || continuing || memRef || pendingRef.current?.kind === 'target' || peekAuthoringIntent()) ? null : multiChartPlan(text, { host })
      const multi = multi0?.kind === 'ops' && !(await typedSymbolsKnown(multi0.ops, text)) ? null : multi0
      if (multi?.kind === 'say') {
        push({ role: 'agent', text: multi.text })
        record({ member: text, outcome: multi.text, outcomeData: { kind: 'clarify-multichart' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
        return
      }
      if (multi?.kind === 'ask') {
        // live train 4: replace the board's charts, or add these beside them — the member decides (chooseTarget gridChoice)
        pendingRef.current = { kind: 'target', ops: [], path: 'fast', member: text, voice, epoch: epochOf(host), gridChoice: multi.options }
        push({ role: 'question', text: multi.text, choices: [...multi.choices, { label: 'Cancel', cancel: true }], local: true })
        record({ member: text, outcome: multi.text, outcomeData: { kind: 'clarify-multichart' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
        return
      }
      if (multi?.kind === 'ops') {
        lastActionsRef.current = multi.ops.map(o => o.action)
        return await execute(multi.ops, { path: 'fast', mode: multi.mode, member: text, voice, onTarget: multi.note || null })
      }
      if (multi?.kind === 'steps') {
        // one chart reused, then a NEW chart proposed — the second step only if the first one landed
        const [first, second] = multi.steps
        lastActionsRef.current = [...first.ops, ...second.ops].map(o => o.action)
        await execute(first.ops, { path: 'fast', mode: first.mode, member: text, voice, more: true })
        const now = (() => { try { return host?.charts?.read?.(second.needs.ref) } catch { return null } })()
        if (String(now?.symbol || '').toUpperCase() !== second.needs.symbol) return
        return await execute(second.ops, { path: 'fast', mode: second.mode, member: text, voice })
      }
      // ⭐ PHASE 2 FOLLOW-UPS (agent/conversation.js): "make the first one green", "put those on my other charts",
      // "do the same on the others", "make all my charts match this one" — the conversation's indicators and charts,
      // re-checked on the live board. Tried FIRST when the words point back at the conversation (a fast phrase
      // would read "the first one" without it); otherwise only when nothing else read the message.
      // W1.1 R-03 (LT-9): "rename <a protected layout> to …" is refused by name here — listed or not, 0 model calls
      const protectedRename = answering ? null : protectedRenameRefusal(text)
      if (protectedRename) {
        const t = `I didn't change anything: ${protectedRename}`
        push({ role: 'refusal', text: t })
        record({ member: text, outcome: t, outcomeData: { kind: 'refused-protected', actions: ['layout.rename'] }, telemetry: { path: 'fast', refused: true, voice } })
        return
      }
      const followable = !answering && !continuing && !memRef && !pendingRef.current && !peekAuthoringIntent()
      const followFirst = followable && FOLLOW_CUES.test(text) ? resolveFollowUp(text, { host, memory: memoryRef.current, epoch: epochNow }) : null
      // "put a 20 EMA on it" with several charts and no click: `it` = the chart this conversation last changed
      // ⭐ W2 (context across turns): "make that one weekly", "add the 50 SMA to the new one" right after a chart was CREATED
      // name that chart — read as "it" (the conversation's subject chart, which a creation now sets: rememberChange)
      const subj = asSubjectWords(text, createdRef.current?.refs || null, gridChanged(host))
      // "make this one weekly" with a chart clicked is "this chart"; no model call is needed to say so
      const refText = selectedChart(host) ? subj.text.replace(/\bthis one\b/gi, 'this chart') : subj.text
      const memNow = withSubject(memoryRef.current, subj.subject)
      // "the one I just changed" names a cell outright, so a clicked chart does not outrank it here (it does outrank a bare "it")
      const subjHost = subj.changed ? { ...host, charts: { ...host.charts, selected: () => null } } : host
      const fast00 = answering || followFirst ? null : pluralTarget(subjectTarget(memRef || fastParse(refText, { host }), refText, { host: subjHost, memory: memNow, epoch: epochNow }), { host, memory: memNow, epoch: epochNow })
      // hotfix 11-13: an answer to the model's question is the model's — only Undo / confirm / cancel stay instant
      const fast0 = continuing && fast00 && !['undo', 'confirm', 'subset', 'dismiss'].includes(fast00.kind) ? null : fast00
      const follow = followFirst || (followable && !fast0 && !FOLLOW_CUES.test(text) ? resolveFollowUp(text, { host, memory: memoryRef.current, epoch: epochNow }) : null)
      if (follow?.kind === 'say') {
        push({ role: 'agent', text: follow.text })
        record({ member: text, outcome: follow.text, outcomeData: { kind: 'followup-refused' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
        return
      }
      if (follow?.kind === 'ask') {
        pendingRef.current = { kind: 'target', ops: [], path: 'fast', member: text, voice, epoch: epochOf(host), follow: { words: follow.words } }
        push({ role: 'question', text: follow.text, choices: follow.choices, local: true })
        record({ member: text, outcome: follow.text, outcomeData: { kind: 'clarify-referent' }, telemetry: { path: 'fast', clarified: true, voice } })
        return
      }
      // PACKAGE 3: a follow-up that needs ONE chart picked ("apply it to my other chart" with several): the pick runs its ops there
      if (follow?.kind === 'askTarget') {
        pendingRef.current = { kind: 'target', ops: follow.ops, path: 'fast', mode: 'apply', member: text, voice, epoch: epochOf(host) }
        push({ role: 'question', text: follow.text, choices: follow.choices, local: true })
        record({ member: text, outcome: follow.text, outcomeData: { kind: 'clarify-target', actions: follow.ops.map(o => o.action) }, telemetry: { path: 'fast', clarified: true, voice } })
        return
      }
      if (follow?.kind === 'ops') {
        if (follow.pick) memoryRef.current.notePick(follow.pick)
        lastActionsRef.current = follow.ops.map(o => o.action)
        return await execute(follow.ops, { path: 'fast', mode: 'apply', member: text, voice })
      }
      let fast = fast0
      if (fast?.kind === 'ops' && !(await typedSymbolsKnown(fast.ops, text))) { mark('fast:symbol-to-model'); fast = null }
      // F-16 widened (owner 2026-11-10): the Options Flow widget's own chips are never claimed as a screen (screener.js), so they
      // reach the planner and widget.setOption; a flow SCREEN with no chip word keeps the F-16 refusal. (The round-3 refusal block
      // that stood here is gone.)
      // round 3: clauses naming different charts are planned per clause by the model, never one instant target for all
      // (only several CHART changes read as one: a swap or a list add naming two charts is one op, read as before)
      if (fast?.kind === 'ops' && fast.ops.length > 1 && fast.ops.every(o => getCapability(o?.action)?.target === 'chart')
        && clausesNameDifferentCharts(text, host)) { mark('fast:clauses-to-model'); fast = null }
      if (fast?.kind === 'say') {
        push({ role: 'agent', text: fast.text })
        record({ member: text, outcome: fast.text, outcomeData: { kind: 'clarify-referent' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
        return
      }
      if (fast?.kind === 'undo' && fast.all) return await undoTurn({ member: text, voice })
      if (fast?.kind === 'undo') return await doUndo(null, { member: text, voice, about: fast.about || null })
      if (fast?.kind === 'confirm' && pendingRef.current?.kind === 'proposal') return await approve(null, { member: text, voice })
      if (fast?.kind === 'subset' && pendingRef.current?.kind === 'proposal') return await approve(fast.count, { member: text, voice })
      if (fast?.kind === 'dismiss' && pendingRef.current) return await dismiss({ member: text })
      // ⭐ INDICATORS ⇄ AGENT — the member is answering "What indicator would you like to build?"
      // (asked when the chart's Create Indicator / Modify door opened the Agent): THIS message is the
      // request, sent to the existing `indicator.draft` for that chart — before the fast path's actions, which
      // would read "a 20 EMA crossover…" as an indicator add, and before "nothing is waiting" (its
      // "never mind" sets THIS question aside). Undo and a pending proposal keep priority. One message answers it.
      const authoring = answering ? null : takeAuthoringIntent()
      if (authoring) {
        if (isCancelWords(text)) {
          const t = 'OK — nothing was built.'
          push({ role: 'agent', text: t })
          record({ member: text, outcome: t, outcomeData: { kind: 'authoring-cancelled' }, telemetry: { path: 'local', voice } })
          return
        }
        lastActionsRef.current = ['indicator.draft']
        return await execute([authoringOp(authoring, text)], { path: 'fast', mode: 'apply', member: text, voice })
      }
      // "do it" / "just the first two" with NOTHING pending never goes to the
      // model: after a reload or a chat switch the history still shows the old
      // proposal, and the model would REGENERATE and apply it. Approval only ever
      // executes a stored, re-validated plan.
      // OWNER 2026-10-12: "Apply it." with NO proposal waiting may be a capability's own phrase (apply the
      // indicator draft) — never an approval of anything; it runs only if that capability claims it.
      if (fast?.kind === 'confirm' && !pendingRef.current) {
        const alt = fastParse(text, { host, controlWords: false })
        if (alt?.kind === 'ops' && alt.ops.every(o => o.target)) {
          lastActionsRef.current = alt.ops.map(o => o.action)
          return await execute(alt.ops, { path: 'fast', mode: 'apply', member: text, voice })
        }
      }
      if (fast?.kind === 'confirm' || fast?.kind === 'subset' || fast?.kind === 'dismiss') {
        const t = fast.kind === 'dismiss' ? 'Nothing is waiting — nothing changed.'
          : "There is no proposal waiting to apply. Tell me what you'd like to change."
        push({ role: 'agent', text: t })
        record({ member: text, outcome: t, outcomeData: { kind: 'nothing-pending' }, telemetry: { path: 'fast', voice } })
        return
      }
      // Ops whose capability already resolved the target (a named saved list) run as-is.
      if (fast?.kind === 'ops' && fast.ops.every(o => o.target)) {
        lastActionsRef.current = fast.ops.map(o => o.action)
        return await execute(fast.ops, { path: 'fast', mode: 'apply', member: text, voice })
      }
      // ⭐ NLM-1 D2 (dark): a plan that refers to the chart it creates ("add a chart for QQQ and put RSI on it / on both")
      // on a board where no single target could be picked — Track A's bindCreated aims it at the new chart's alias
      if (routingV2Active() && fast?.kind === 'ops' && !fast.ops.every(o => o.target)) {
        // the binder reads the member's TYPED words (raw) when NLM-1 rewrote them — see nlm1/plans.js `said`
        const typedRaw = String(raw || '').trim()
        const made = planCreatedReference(refText, host, { said: typedRaw !== text ? typedRaw : null })
        if (made?.ask) {
          push({ role: 'agent', text: made.ask })
          record({ member: text, outcome: made.ask, outcomeData: { kind: 'clarify-referent' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
          return
        }
        if (made?.ops) {
          mark('nlm1:created-ref')
          lastActionsRef.current = made.ops.map(o => o.action)
          return await execute(made.ops, { path: 'fast', mode: 'apply', member: text, voice })
        }
      }
      // Phase 2: ops of SEVERAL kinds ("add VWAP and switch to 5 minutes") — each kind must name
      // exactly one target (after a position hint); otherwise the model decides.
      if (fast?.kind === 'ops' && kindsOf(fast.ops).length > 1 && !fast.target?.all) {
        // live train 4 (CG-37, binding v2): an UNTARGETED change after a create step in the same request goes on the chart
        // that step creates (its alias → the committed widget's id) — decided before any default target is picked
        // (createdBinding.js: plan structure; explicit existing references never re-targeted; ambiguous → asked)
        const bound0 = fast.target ? null : bindCreated(fast.ops, text, host)
        if (bound0?.ask) {
          push({ role: 'agent', text: bound0.ask })
          record({ member: text, outcome: bound0.ask, outcomeData: { kind: 'clarify-referent' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
          return
        }
        const fastOps = bound0?.ops || fast.ops
        const pick = {}
        for (const k of kindsOf(fastOps)) {
          let list = getTargetKind(k)?.list(host) || []
          if (fast.target?.position && list.length > 1) list = matchPosition(list, fast.target.position)
          // P1: "on the second chart" — the kind's entry for THAT chart (a kind that is not chart-backed drops out → the model)
          if (fast.target?.chart) list = list.filter(s => chartRefOf(getTargetKind(k), s) === fast.target.chart)
          if (fast.target?.ask) list = []
          if (list.length === 1) pick[k] = list[0].ref
        }
        if (fastOps.every(o => o.target || pick[getCapability(o.action)?.target])) {
          const ops = fastOps.map(o => (o.target ? o : { ...o, target: pick[getCapability(o.action).target] }))
          lastActionsRef.current = ops.map(o => o.action)
          return await execute(ops, { path: 'fast', mode: 'apply', member: text, voice })
        }
      }
      if (fast?.kind === 'ops' && kindsOf(fast.ops).length === 1) {
        const kind = getTargetKind(kindsOf(fast.ops)[0])
        const charts = kind ? kind.list(host) : []
        if (charts.length === 0) {
          // ⭐ Multi Chart: an instant board command finds no target here because the board is hidden, and says that
          const hidden = gridMode ? screenGridOps(fast.ops, host)?.refuse : null
          // fix-nothing-on-workspace: a host that does not PROVIDE this kind's source (a page without layouts, charts, …)
          // says the capability is not available HERE; a source that is there but empty names what is empty
          // (capabilities.noTargetSentence). Never "the workspace is empty" — and nothing runs either way.
          // The row reuses the existing 'refused' kind WITH its actions (named first, so the F-11 rail reads them): no new
          // outcome kind and no change to turn.ACTIONLESS_OUTCOME_KINDS. reason only says why; history never reads it.
          const why = hidden ? null : noTargetSentence(kind, host)
          const t = hidden ? `I didn't change anything: ${hidden}` : why.text
          push({ role: hidden || why.missing ? 'refusal' : 'agent', text: t })
          record({ member: text, outcome: t, outcomeData: { kind: 'refused', actions: fast.ops.map(o => o?.action), ...(why?.missing ? { reason: 'unavailable-here' } : {}) }, telemetry: { path: 'fast', refused: true, voice } })
          return
        }
        // "both / all" → one op set per target, applied as ONE change with one Undo
        // (policy.js, owner 2026-10-12). A position hint narrows by the positions the kind
        // publishes; anything still ambiguous asks. A lone target needs no hint.
        // ⭐ PHASE 3: "switch em to weekly" — `them` resolved to the charts the conversation last changed (pluralTarget)
        // (a set named by CHART refs — a whole line, AUDIT probe 17 F-a — matches each kind's entry through its chart)
        const allOf = fast.target?.refs ? charts.filter(c => fast.target.refs.includes(c.ref) || fast.target.refs.includes(chartRefOf(kind, c))) : charts
        if (fast.target?.all && allOf.length > 1 && fast.target?.refs) {
          return await execute(allOf.flatMap(c => fast.ops.map(o => ({ ...o, target: c.ref }))), { path: 'fast', mode: 'apply', member: text, voice })
        }
        // ⛔ a named set that does not reach two entries here is never widened to every chart below: it is asked
        if (fast.target?.all && fast.target?.line && allOf.length <= 1) {
          pendingRef.current = { kind: 'target', ops: fast.ops, path: 'fast', member: text, voice, epoch: epochOf(host) }
          push({ role: 'question', text: 'Which chart do you mean?', choices: (allOf.length ? allOf : charts).map(c => ({ ref: c.ref, label: c.label })), local: true })
          return
        }
        if (fast.target?.all && charts.length > 1) {
          // ⛔ P2-B: "all four charts" with three on the board (or "both" with four) — the member counted a
          // different set than UCT can reach: asked, never a silent partial (or wider) change
          if (fast.target.count && fast.target.count !== charts.length) {
            const t = `I can reach ${charts.length} charts here, not ${fast.target.count} — say “all charts” to change these ${charts.length}, or name the ones you mean. Nothing has changed yet.`
            push({ role: 'agent', text: t })
            record({ member: text, outcome: t, outcomeData: { kind: 'clarify-count', actions: fast.ops.map(o => o?.action) }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
            return
          }
          // charts on the board the Agent can't reach (inactive tabs, floating) are NAMED on the receipt
          const away = (() => { try { return host?.charts?.unreachableCount?.() || 0 } catch { return 0 } })()
          const awayNote = away ? `${away} other chart${away === 1 ? '' : 's'} on this board (an inactive chart tab, or a floating or popped-out chart) ${away === 1 ? 'was' : 'were'} not changed.` : null
          return await execute(charts.flatMap(c => fast.ops.map(o => ({ ...o, target: c.ref }))),
            { path: 'fast', mode: 'apply', member: text, voice, onTarget: awayNote })
        }
        let candidates = charts
        const noun = kind.noun || kind.name
        let ask = `Which ${noun}?`
        if (fast.target?.position && charts.length > 1) {
          const hit = matchPosition(charts, fast.target.position)
          if (hit.length) candidates = hit
          else ask = `I don't see a ${fast.target.position} ${noun}. Which one?`
        }
        // ⭐ P1: "the second chart", "chart 3", "the middle one" (fastPath.extractTarget, resolved on the live
        // board): exactly that chart's entry of this kind — or, when the words name no chart, the question
        let ordAsk = fast.target?.ask ? fast.target.ask.text : null
        if (fast.target?.chart) {
          const hit = charts.filter(c => chartRefOf(kind, c) === fast.target.chart)
          if (hit.length === 1) candidates = hit
          else ordAsk = ask
        }
        // Context & Awareness 1B: "this chart / this stock / it" → the chart the member last CLICKED
        // (agent/deixis.js). No live selection → the question below, exactly as before.
        let implicitTarget = null
        if (!fast.target?.position && !fast.target?.chart && !ordAsk && candidates.length > 1) {
          const d = resolveDeictic({ host, kind, candidates, text, chartOp: true })
          if (d?.ref) candidates = candidates.filter(c => c.ref === d.ref)
          // a description fitting several charts: the question offers those, not the whole board
          else if (d?.ask?.choices?.length) candidates = candidates.filter(c => d.ask.choices.some(x => x.ref === c.ref))
          if (d?.implicit && candidates.length === 1) implicitTarget = `On ${candidates[0].label || 'the chart you selected'} — the chart you last clicked.`
        }
        const unmatchedHint = fast.target?.position && charts.length > 1 && candidates === charts
        if (candidates.length > 1 || unmatchedHint || ordAsk) {
          pendingRef.current = { kind: 'target', ops: fast.ops, path: 'fast', member: text, voice, epoch: epochOf(host) }
          // an ask that names its own candidates (a named-anchor relation: never the anchor, AUDIT probe 17 F-b) offers only those
          const own = fast.target?.ask?.choices?.length ? charts.filter(c => fast.target.ask.choices.some(x => x.ref === c.ref || x.ref === chartRefOf(kind, c))) : []
          push({ role: 'question', text: ordAsk || ask, choices: (ordAsk ? (own.length ? own : charts) : candidates).map(c => ({ ref: c.ref, label: c.label })), local: true })
          record({ member: text, outcome: 'Asked which target.', outcomeData: { kind: 'clarify-target', actions: fast.ops.map(o => o?.action) }, telemetry: { path: 'fast', clarified: true, voice } })
          return
        }
        // W2-B3: the follow-up groups ride along after a lone-target fast op too ("describe this setup" → "and on the
        // weekly?"), as every other fast branch above already records
        lastActionsRef.current = fast.ops.map(o => o.action)
        return await execute(fast.ops.map(o => ({ ...o, target: candidates[0].ref })), { path: 'fast', mode: 'apply', member: text, voice, onTarget: implicitTarget })
      }

      // ⛔ F2b: "save it" with indicator drafts open but none selected — ask what to save (no model call)
      const ref = answering || continuing ? null : saveReferent(host, text)
      if (ref && ref.kind === 'ask') {
        push({ role: 'question', text: ref.text, choices: ref.choices, local: true })
        record({ member: text, outcome: ref.text, outcomeData: { kind: 'clarify-save-target' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
        return
      }
      // ⭐ PHASE 2: one message, several steps ("create four daily charts for …, put the 9 and 20 on all of them, make the
      // 9 green …") — only when EVERY clause reads as a step; otherwise the model reads the whole request, as before
      // ⭐ PHASE 3 acceptance (live 2026-10-31): a WHOLE workspace typed while an earlier card is still waiting is a new
      // request, not an answer to that card — it is read here (the card is set aside, nothing from it applied) instead of
      // going to the model with the card as context. Anything else typed over a card goes on exactly as before.
      const overCard = !followable && !fast && !answering && !continuing && !memRef && !peekAuthoringIntent() && pendingRef.current?.kind === 'proposal'
      // (words naming the one just changed are read by the gate below, which knows no clicked chart answers them; a step here would not)
      const compound0 = (followable || overCard) && !fast && !subj.changed ? planCompound(text, { host }) : null
      const compound = overCard && !(compound0?.steps?.[0]?.kind === 'grid' && isWorkspaceRequest(compound0.steps[0].text)) ? null : compound0
      if (compound?.say) {
        push({ role: 'agent', text: compound.say })
        record({ member: text, outcome: compound.say, outcomeData: { kind: 'compound-too-long' }, telemetry: { path: 'fast', refused: true, voice } })
        return
      }
      if (compound?.steps) {
        if (overCard) {
          const old = pendingRef.current
          pendingRef.current = null
          patchItem(old.id, { status: 'dismissed' })
          push({ role: 'outcome', text: 'I set the earlier proposal aside — nothing from it was applied.' })
        }
        // ⭐ PHASE 3 acceptance: a whole workspace on a board holding widgets it does not include — asked ONCE, locally
        const conflict = workspaceConflict(host, compound.steps)
        if (conflict) {
          const q = workspaceQuestion(conflict)
          pendingRef.current = { kind: 'target', ops: [], path: 'fast', member: text, voice, epoch: epochOf(host), workspace: { steps: compound.steps } }
          push({ role: 'question', text: q, choices: [...WORKSPACE_CHOICES, { label: 'Cancel', cancel: true }], local: true })
          record({ member: text, outcome: q, outcomeData: { kind: 'clarify-workspace' }, telemetry: { path: 'fast', disposition: 'clarify', voice } })
          return
        }
        // ⛔ ALL OR NOTHING for NLM-1's rewrites (AUDIT, #806): a message NLM-1 re-worded that now reads as several steps
        // runs only when EVERY step reads on this board now, and then all or nothing (runCompound `whole`); otherwise the
        // member's ORIGINAL message goes on to the model, exactly as v1 sends it — never "stopped at …" where v1 would ask
        const typed = String(raw || '').trim()
        const reworded = text !== typed
        const unread = reworded && compound.steps.some(st => preUnread(st, readStepRef.current))
        if (!unread) {
          const ran = await runCompound(compound.steps, { member: text, voice, whole: reworded })
          if (!ran?.fallback) return ran
        }
        mark('nlm1:rewrite-declined', 'compound')
        text = typed
      }
      } // ── end of the legacy instant path ──
      // ── model path ──
      // Context from every registered provider; actions from every AVAILABLE
      // capability's manifest. Nothing here names a feature. Data that can change outside
      // this panel is re-read first (bounded), so the model never targets a stale list.
      const p = pendingRef.current
      // Capability ROUTING (agent/routing.js): only the action groups this message needs, the
      // others named. If the model needs a group it wasn't given it plans NOTHING and says so
      // (need_groups); we ask ONCE more with those groups. Nothing has executed in between.
      // M2 indicator writes are offered only when some chart on this board can manage indicators.
      const manageIndicators = (() => { try { return host?.charts?.list().some(c => host.charts.canManageIndicators?.(c.ref) === true) } catch { return false } })()
      // PLANNER v2 (UCT_AGENT_PLANNER=v2 on the server): the step loop (agent/steps.js) — the v1 request below is untouched
      // (a COACH message stays on the v1 path: the server serves coach turns on v1 — review C1 — and only this path shows
      // the coach's actions, not just its reply; pre-activation, v2 stays off)
      if (!nl1 && serverPlanner() === 'v2' && !isCoachMessage(text)) {
        if (!v2Ref.current) v2Ref.current = createStepRunner()
        turnPath('model')
        await v2Ref.current.send({ text, voice, manageIndicators, pending: p?.kind === 'proposal' ? p : null }, v2DepsRef.current())
        return
      }
      let res, refMap, live, nl1Body = null, nl1Sel = null, rerouted = false
      let answeredRefs = []        // the chart a reply to UCT's own question picked (screenUnnamedTargets)
      if (nl1) {
        // NL-1: the request's actions (nl1/selection.js: the core, pinned groups, groups its words add — every
        // other group named), every context section (none gated on the member's words), the session memory
        // with the last change, and the question this message may answer
        turnPath('model')
        await refreshContext(1500)
        mark('context:refreshed')
        // a local question's stored plan is dropped: the model re-plans the request with the answer in view
        // (the chart's Create Indicator / Modify door asked "What indicator would you like to build?": the answer
        // is read by the model with that question — indicator.draft is in the catalog — never routed by words)
        const authoringAsked = !pendingQuestionRef.current && p?.kind !== 'target' && peekAuthoringIntent() ? (takeAuthoringIntent(), lastQuestionRef.current) : null
        const asked = pendingQuestionRef.current || (p?.kind === 'target' ? lastQuestionRef.current : null) || authoringAsked
        if (p?.kind === 'target') pendingRef.current = null
        pendingQuestionRef.current = null
        const picked = asked ? pickedChoice(text, asked.choices || []) : null
        if (picked) answeredRefs = [picked]
        const nl1Args = { host, text, capCtx, manageIndicators, memory: memoryRef.current, epoch: epochOf(host), isProtectedLayout: (e) => isProtected(e),
          pendingQuestion: asked ? { text: asked.text, choices: (asked.choices || []).map(c => ({ label: c.label, ref: c.ref || null })), groups: asked.groups || [] } : null,
          pendingProposal: p?.kind === 'proposal' ? p : null }
        const req = buildNl1Request(nl1Args)
        refMap = req.refMap
        nl1Sel = req.selection
        mark('route', nl1Sel.manifest.length === req.full.length ? 'full' : `${nl1Sel.manifest.length}/${req.full.length}`)
        mark('context:built')
        live = streamLine()
        const b = { ...req.body, conversationId: conversationRef.current, voice }
        nl1Body = b
        mark('turn:sent')
        res = await (serverStreams() ? agentTurnStream(b, live.onEvent) : agentTurn(b))
        mark('turn:received', res.ok ? stagesOf(res.data) : res.status || 'error')
        // ⭐ NL-1 REROUTE (owner 2026-10-20): the model asked for action groups it was not given (`need_groups`;
        // it planned nothing). ONE more call with them, inside the server's 2-call ceiling — it takes priority
        // over the repair, which a rerouted plan never gets. If they cannot be supplied (too many, no call left,
        // or they would not fit the 60-action limit beside the core), nothing runs and the member is told —
        // never a different action in their place.
        const need = res.ok ? (res.data.envelope?.need_groups || []).filter(g => !nl1Sel.selected.includes(g)) : []
        if (need.length) {
          if (res.data.conversationId !== conversationRef.current) setConversationId(res.data.conversationId)
          live.settle(null)
          const again = need.length <= NL1_MAX_NEED && (res.data.usage?.model_calls ?? 1) < 2 ? buildNl1Request({ ...nl1Args, need }) : null
          if (!again || !again.selection.needMet) {
            push({ role: 'agent', text: 'That touches too many parts of UCT for one request. Try asking for one part at a time.' })
            return
          }
          mark('reroute', need.join(','))
          refMap = again.refMap
          nl1Sel = again.selection
          nl1Body = { ...again.body, conversationId: res.data.conversationId, voice }
          rerouted = true
          const rb = { ...nl1Body, reroute: true }
          res = await (serverStreams() ? agentTurnStream(rb, live.onEvent) : agentTurn(rb))
          mark('reroute:received', res.ok ? stagesOf(res.data) : res.status || 'error')
          if (res.ok && (res.data.envelope?.need_groups || []).length) {
            live.settle(null)
            push({ role: 'agent', text: 'That needs more of UCT than I can plan in one step. Try asking for one part at a time.' })
            return
          }
        }
      }
      if (!nl1) { // ── the legacy routed request: unchanged (not re-indented) ──
      const full = manifestFor({ ...capCtx, manageIndicators })
      // limit = the server's per-request maximum; budget = what one routed request may carry.
      // Gate B (0C): the member's live names and the lexicon's typo readings route too (routing.js)
      const routeOpts = { enabled: routingEnabled(), pendingActions: p?.kind === 'proposal' ? p.ops.map(o => o.action) : [], recentActions: lastActionsRef.current, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold,
        names: routingNames(host), correct: (t) => (correctTypos(t, lexiconFor(host)) || []).map(v => v.text) }
      // ⭐ W2 AUDIT (live 2026-11-04: "Bottom-left chart (TSLA)" — a click on the model's own "which TSLA chart?" — was routed by
      // its own words, without indicatorAlerts, so the model had to ask need_groups and lost the thread): an ANSWER to the
      // model's question keeps the groups the question was asked with (they ride along; the answer's words still route too)
      // review #771 delta H1: ONLY the question's own groups, only for a short answer, packed AFTER this message's own groups
      const askedGroups = carryAsked && askedGroupsRef.current ? askedGroupsRef.current : []
      askedGroupsRef.current = null
      if (askedGroups.length) routeOpts.after = askedGroups
      const route = pickRouter()
      let routed = route(full, text, routeOpts)
      lastRoutedRef.current = routed.routing ? routed.routing.selected : null
      mark('route', routed.routing ? `${routed.manifest.length}/${full.length}` : 'full')
      // Data that can change outside this panel is re-read first (bounded) — Phase 2: only for the
      // action groups this message was routed to (a timeframe change no longer waits on alerts).
      turnPath('model')
      await refreshContext(1500, { groups: routed.routing ? (routed.refresh || routed.routing.selected) : null })
      mark('context:refreshed')
      let context;
      ({ context, refMap } = buildContext(host, { ...capCtx, message: text }))
      mark('context:built')
      const back = Object.fromEntries(Object.entries(refMap).map(([k, v]) => [v.ref, k]))
      const pending = p?.kind === 'proposal'
        // Transaction-local aliases (new1…) are not context refs: they pass through.
        ? { ops: p.ops.map(o => ({ ...o, target: back[o.target] || o.target })) }
        : null
      live = streamLine()
      // ⭐ GATE C: what this chat showed and did (tickers in the order shown, the last change's actions), so a
      // follow-up the instant path could not read still reaches the model with its referent. Never values.
      const memoryFor = () => {
        const m = memoryRef.current.forModel()
        // LT-6: the model's last question was set aside by this message — it is a NEW request (turn.py OPEN QUESTION rule)
        const aside = questionSetAsideRef.current ? { question_set_aside: true } : null
        if (!m) return aside
        return { ...withModelRefs(m, back), ...(aside || {}) }
      }
      const ask = (r, extra = {}) => {
        const mem = memoryFor()
        const b = {
          conversationId: conversationRef.current, message: text, voice, pending,
          context: mem ? { ...context, conversation_memory: mem } : context, capabilities: r.manifest, manifestVersion: MANIFEST_VERSION, routing: r.routing, ...extra,
        }
        return serverStreams() ? agentTurnStream(b, live.onEvent) : agentTurn(b)
      }
      mark('turn:sent')
      res = await ask(routed)
      mark('turn:received', res.ok ? stagesOf(res.data) : res.status || 'error')
      const need = res.ok ? (res.data.envelope?.need_groups || []).filter(g => !routed.routing?.selected?.includes(g)) : []
      if (res.ok && routed.routing && need.length) {
        if (res.data.conversationId !== conversationRef.current) setConversationId(res.data.conversationId)
        // The groups the model needs come first; whatever no longer fits the budget is dropped
        // from THIS request (named, not sent). If a needed group itself cannot fit, stop honestly.
        routed = route(full, text, routeOpts, need)
        lastRoutedRef.current = routed.routing ? routed.routing.selected : null
        live.settle(null)
        if (!need.every(g => routed.routing?.selected?.includes(g) || !routed.routing)) {
          push({ role: 'agent', text: 'That touches too many parts of UCT for one request. Try asking for one part at a time.' })
          return
        }
        mark('reroute', need.join(','))
        // the newly needed groups' data is read fresh, and the context rebuilt from it
        await refreshContext(1500, { groups: need });
        ({ context, refMap } = buildContext(host, { ...capCtx, message: text }))
        res = await ask(routed, { conversationId: res.data.conversationId, reroute: true })
        mark('reroute:received', res.ok ? stagesOf(res.data) : res.status || 'error')
        if (res.ok && (res.data.envelope?.need_groups || []).length) {
          live.settle(null)
          push({ role: 'agent', text: 'That needs more of UCT than I can plan in one step. Try asking for one part at a time.' })
          return
        }
      }
      } // ── end of the legacy routed request ──
      if (!res.ok) { live.settle(null); push({ role: 'error', text: res.error }); return }
      if (res.data.conversationId !== conversationRef.current) setConversationId(res.data.conversationId)
      let env = res.data.envelope
      // ⭐ NL-1 REPAIR (owner decision 6): if UCT's planner would refuse the model's plan, the plan goes back
      // to the model ONCE with the planner's reasons — as a reroute of this same request, so the server's
      // 2-call ceiling bounds it (and a plan the server already repaired is never repaired again). The new
      // plan then passes every check below exactly like a first answer, and never asks for less approval.
      // A REROUTED request has spent its second call: no repair (a refused plan is refused by the planner).
      if (nl1 && nl1Body && !rerouted && ['apply', 'propose'].includes(env.disposition) && res.data.usage?.repaired == null) {
        const refused = preflightRefusals(host, translateRefs(env.ops || [], refMap))
        if (refused.length) {
          mark('repair')
          const first = env.disposition
          const r2 = await agentTurn({ ...nl1Body, conversationId: res.data.conversationId, reroute: true, repair: { errors: refused, plan: env.ops } })
          mark('repair:received', r2.ok ? stagesOf(r2.data) : r2.status || 'error')
          if (r2.ok) {
            res = r2
            env = { ...r2.data.envelope, disposition: repairedDisposition(first, r2.data.envelope.disposition) }
          }
        }
      }
      // ⛔ NO SUBSTITUTION WITHOUT APPROVAL (owner 2026-10-20): the member's words pointed at a group of actions
      // this request could not carry (they did not fit beside the core). A plan made without them may be a
      // stand-in for what was asked — so it is only PROPOSED, never run at once. Words only ADD this caution.
      const unsentWords = nl1 && nl1Sel ? nl1Sel.wordsNotSent : []
      if (unsentWords.length && env.disposition === 'apply') {
        mark('escalate', unsentWords.join(','))
        env = { ...env, disposition: 'propose' }
      }
      const sources = res.data.usage?.citations || []
      const talk = env.disposition === 'answer' || env.disposition === 'unsupported'
      // the final reply replaces whatever streamed (or the streamed line goes, for anything else)
      const streamed = live.settle(talk ? { text: env.reply, sources } : null)
      if (talk) {
        if (!streamed) push({ role: 'agent', text: env.reply, sources })
        return
      }
      // the member's words this question is about stay with it, for the answer (screenUnnamedTargets)
      if (env.disposition === 'clarify') { askedForRef.current = [askedFor, text].filter(Boolean).join(' '); askedAtRef.current = Date.now() }
      if (env.disposition === 'clarify' && nl1) {
        // NL-1: choices carry the context ref they stand for; kept (as real refs) for the next message, so
        // a click on a choice — or "the right one", "2", "AMD" typed — is read against them
        const choices = clarifyChoices(env.question?.choices, refMap)
        pendingRef.current = p?.kind === 'proposal' ? p : null
        // the groups this request was given (beyond the core) stay with the question, so the answer has them too
        pendingQuestionRef.current = { text: env.question?.text || env.reply, choices, groups: nl1Sel ? nl1Sel.selected.filter(g => !nl1Sel.core.includes(g)) : [] }
        push({ role: 'question', text: env.question?.text || env.reply, choices: choices.map(c => ({ label: c.label })) })
        return
      }
      if (env.disposition === 'clarify') {
        pendingRef.current = p                     // a question doesn't drop a waiting proposal
        // W2 AUDIT: the groups this question was asked with go with its answer (the legacy routed request above)
        askedGroupsRef.current = questionGroups(`${askedFor || ''} ${text}`)
        push({ role: 'question', text: env.question?.text || env.reply, choices: clarifyChoices(env.question?.choices).map(c => ({ label: c.label })) })
        return
      }
      // ⛔ P2-A2: only a plan the server marked apply / propose ever reaches the planner (agentClient.turnReply
      // already fails any other reply — this is the second lock, at the point where a plan could run)
      if (env.disposition !== 'apply' && env.disposition !== 'propose') { push({ role: 'error', text: "UCT Agent couldn't complete that request. No changes were made." }); return }
      // ⛔ P1: a model plan over the shared op limit never reaches the planner (the server refuses one too)
      if ((env.ops || []).length > MAX_MODEL_OPS) {
        push({ role: 'error', text: TOO_MANY_OPS })
        record({ member: null, outcome: TOO_MANY_OPS, outcomeData: { kind: 'refused', actions: (env.ops || []).map(o => o?.action) }, telemetry: { path: 'model', refused: true, voice } })
        return
      }
      // ⭐ agent.undo (hotfix 2026-11-03): the planner asked for UCT's OWN Undo — the receipt's Undo (doUndo / undoTurn, with
      // every one of its refusals). The model's words never say what was undone (only doUndo's receipt does). Alone → the
      // Undo; FIRST in a plan → the Undo, then the rest only if it went through; LAST → the rest, then the Undo of exactly
      // what the rest committed (nothing older); anywhere else → nothing runs, said plainly.
      const undoOps = (env.ops || []).filter(o => o?.action === UNDO_ACTION)
      if (undoOps.length) {
        const all = env.ops
        const rest = all.filter(o => o?.action !== UNDO_ACTION)
        const at = all.findIndex(o => o?.action === UNDO_ACTION)
        const u = normalizeArgs(UNDO_ACTION, undoOps[0].args && typeof undoOps[0].args === 'object' ? undoOps[0].args : {}).args || {}
        const about = typeof u.about === 'string' ? u.about : null
        mark('undo', rest.length ? (at === 0 ? 'first' : 'last') : 'alone')
        lastActionsRef.current = all.map(o => o?.action)
        if (undoOps.length > 1 || (rest.length && at !== 0 && at !== all.length - 1)) {
          const t = 'I didn’t change or undo anything: I can undo before or after the other changes in one request, not in the middle of them. Ask for the change, then say “undo”.'
          push({ role: 'refusal', text: t })
          record({ member: null, outcome: t, outcomeData: { kind: 'undo-refused' }, telemetry: { path: 'model', undo: true, refused: true, voice } })
          return
        }
        if (!rest.length) {
          if (u.scope === 'all') await undoTurn({ member: null, voice })
          else await doUndo(null, { member: null, voice, about })
          return
        }
        // review F4: a change that waits for an approval can't be made AND undone in one request (approving it later would
        // commit it with no Undo after) — refused before anything runs
        if (at !== 0 && env.disposition !== 'apply') {
          push({ role: 'refusal', text: UNDO_HELD })
          record({ member: null, outcome: UNDO_HELD, outcomeData: { kind: 'undo-refused' }, telemetry: { path: 'model', undo: true, refused: true, voice } })
          return
        }
        if (at === 0) {
          const ok = u.scope === 'all' ? await undoTurn({ member: null, voice, rest: true }) : await doUndo(null, { member: null, voice, about, rest: true })
          if (ok) undoneFirstRef.current = true
          if (!ok && lastUndoRef.current === 'partial') {
            // #766 nit 3: the partial Undo's own message already said what was taken back and that the rest wasn't made
            undoneFirstRef.current = true
            return
          }
          if (!ok) {
            // review F5: an Undo that put things back but could not be saved says exactly that (its receipt is above)
            const t = lastUndoRef.current === 'unsaved' ? 'That Undo put things back but couldn’t be saved (see above), so I didn’t make the rest of the change.'
              : 'Because that Undo didn’t go through, I didn’t make the rest of the change either.'
            push({ role: 'agent', text: t })
            record({ member: null, outcome: t, outcomeData: { kind: 'undo-refused' }, telemetry: { path: 'model', undo: true, refused: true, voice } })
            return
          }
        } else {
          undoAfterRef.current = { about, before: undoRef.current.map(e => e.id), held: { pending: pendingRef.current, question: lastQuestionRef.current } }
        }
        env = { ...env, ops: rest, reply: '' }
      }
      // ⭐ W2 audit (live 2026-11-04: "…to weekly and email me a screenshot of it" said only the weekly receipt): the parts
      // of THIS request no planned action covers are said after whatever runs — fixed sentences (notDone.js), never prose
      notDoneRef.current = (env.ops || []).length ? notDoneLines(`${askedFor || ''} ${text}`, { actions: env.ops.map(o => o?.action) }) : []
      // ⛔ hotfix 2026-11-03 (live: "Put SPY, QQQ, NVDA, and TSLA on four charts…" planned as four TABS of the one chart,
      // overwriting its ticker): a plan that adds chart tabs when the member never said "tab" is a stand-in for what was
      // asked — nothing runs, said plainly (the member can ask for tabs, or for the charts again)
      // ("and a weekly one" on the very next message continues that request: see continuesTabs)
      if ((env.ops || []).some(o => TAB_ADDS.has(o?.action)) && !/\btabs?\b/i.test(`${askedFor || ''} ${text}`)
        && !continuesTabs(env.ops, memoryRef.current?.lastTurn?.(epochOf(host)), memoryRef.current?.currentTurn?.(), text)) {
        const t = 'I didn’t change anything: my plan would have added a chart tab, which you didn’t ask for. Ask again — and say “tab” if a tab is what you want.'
        push({ role: 'refusal', text: t })
        record({ member: null, outcome: t, outcomeData: { kind: 'refused', actions: (env.ops || []).map(o => o?.action) }, telemetry: { path: 'model', refused: true, voice } })
        return
      }
      // apply / propose: translate the context refs back to real target refs
      // ⛔ LOCAL-RESULT BOUNDARY: a plan holding a local-only lookup shows UCT's answer, never the
      // model's own words about it (the server blanks that reply too). The one exception is the
      // SERVER's own deterministic notice (`local_notice`) saying which part was not done.
      const localPlan = (env.ops || []).some(o => getCapability(o?.action)?.localOnly)
      // OWNER 2026-10-12: a bare acknowledgement ("On it.") before an APPLY's receipt is a second message
      // that says nothing — the receipt is the confirmation. Anything substantive still shows.
      const bareAck = env.disposition === 'apply' && BARE_ACK.test(String(env.reply || '').trim())
      // W2 AUDIT (live 2026-11-04): a PROPOSAL's reply ("Alert you when the 9 EMA crosses above the 20…") describes what the
      // card would do — when UCT then refuses the plan, the refusal REPLACES it (it is taken back below), never both
      const replyId = env.reply && !bareAck && (!localPlan || env.local_notice === true) ? nid() : null
      if (replyId) push({ id: replyId, role: 'agent', text: env.reply, sources })
      if (p?.kind === 'proposal') { pendingRef.current = null; patchItem(p.id, { status: 'replaced' }) }
      // A reference that names a context target (a saved list's ref) is bound to
      // that target's own read-only producer before the refs are translated.
      const bound1 = translateRefs(bindSourceRefs(env.ops, refMap, { host, message: text }), refMap)
      // binding v2: the model's UNTARGETED / unresolvable chart ops after a create go on the created chart (explicitly
      // targeted ones never re-targeted) — or asked about
      // ⭐ NLM-1 STRUCTURED STEP PLANS (dark, two keys; nlm1/stepPlans.js): a plan whose steps name earlier steps' RESULTS
      // ("$step1.chart") is validated WHOLE before anything runs (refused whole, never partly run) and every target is
      // explicit — so no binding re-aims anything (created-binding's structural rule)
      let stepPlan = null
      if (routingV2Active() && isStepPlan(bound1)) {
        const sp = prepareStepPlan(bound1)
        if (sp.error) {
          const t = `I didn't run any of that plan: ${sp.error.join('; ')}.`
          push({ role: 'refusal', text: t })
          record({ member: null, outcome: t, outcomeData: { kind: 'refused-step-plan', actions: bound1.map(o => o?.action) }, telemetry: { path: 'model', refused: true, voice } })
          return
        }
        stepPlan = { ...sp, before: snapshotInstances(host) }
        mark('nlm1:step-plan', String(sp.steps.length))
      }
      stepPlanRef.current = stepPlan
      const created1 = stepPlan ? null : bindCreated(bound1, text, host)
      if (created1?.ask) {
        push({ role: 'agent', text: created1.ask })
        record({ member: null, outcome: created1.ask, outcomeData: { kind: 'clarify-referent' }, telemetry: { path: 'model', disposition: 'clarify', voice } })
        return
      }
      const bound = created1?.ops || (stepPlan ? stepPlan.ops : bound1)
      // ⛔ S6 F1–F3: the model's plan is checked against the member's own words before anything runs
      const screened = screenModelOps(host, scopeChartOps(bound, host, `${carryAsked ? askedFor || '' : ''} ${text}`), text, capCtx)
      if (screened.ask) {
        // a pick that fills one argument of the planned ops (a new draft's chart): chooseTarget runs them with it
        if (screened.ask.pick) pendingRef.current = { kind: 'target', ops: screened.ask.pick.ops, path: 'model', mode: env.disposition, member: text, voice, epoch: epochOf(host), pickArg: screened.ask.pick }
        push({ role: 'question', text: screened.ask.text, choices: screened.ask.choices, local: true })
        record({ member: null, outcome: screened.ask.text, outcomeData: { kind: 'clarify-save-target', actions: bound.map(o => o?.action) }, telemetry: { path: 'model', disposition: 'clarify', voice } })
        return
      }
      for (const n of screened.notes) push({ role: 'agent', text: n })
      // "the nvidia chart": the ticker search says which chart a company's name means, before the gates read the sentence
      {
        const nameWord = chartNameWord(text, host?.charts?.list?.() || [])
        if (nameWord && !lexiconFor(host).words.has(nameWord.toLowerCase())) await nameSearch(nameWord)      // "price" is a word, not a name
      }
      // Context & Awareness 1B: a deictic request ("this chart", "this stock", "make it weekly") runs
      // only on the chart the member selected — never on a chart the model picked by itself. Nothing
      // executes before the member answers; their pick resumes THIS plan (no second model call).
      // ⭐ W2 (context across turns): "add the RSI to that one" / "make it weekly" right after a chart was made or changed —
      // the conversation's SUBJECT chart (memory, the same referent the instant path uses) identifies the chart, so a plan
      // whose every op is on exactly that chart is not asked about again. A clicked chart still outranks memory (S6).
      const sw0 = asSubjectWords(text, createdRef.current?.refs || null, gridChanged(host))
      const onSubject = (() => {
        try {
          if (host?.charts?.selected?.() && !sw0.changed) return false
          if (sw0.changed && !sw0.subject) return false
          const sw = sw0
          if (sw.text === text && !/\bit\b/i.test(text)) return false
          const s = sw.subject ? { ref: sw.subject } : memoryRef.current.subject('chart', epochOf(host))
          if (!s?.ref || !screened.ops.length) return false
          return screened.ops.every(o => {
            const k = getTargetKind(getCapability(o?.action)?.target)
            const snap = k?.list(host)?.find(x => x.ref === o.target)
            return !!snap && chartRefOf(k, snap) === s.ref
          })
        } catch { return false }
      })()
      if (onSubject) mark('subject', 'memory')
      // ⭐ Multi Chart: a plan aimed anywhere but "the one I just changed" is asked about, even when it aims at the clicked chart
      const deictic = onSubject ? null : sw0.changed
        ? { ask: { text: 'Which chart do you mean?', choices: (host?.charts?.list?.() || []).map(c => ({ ref: c.ref, label: c.label })) } }
        : screenDeicticOps({ host, ops: screened.ops, text, getTargetKind, getCapability, parse: fastParse })
      // ⛔ AUDIT probe 18 (G3) / GO bar (3): a chart the words EXCLUDE ("everything in this row except SPY"), or a relation's ANCHOR
      // that is not a target, is never offered by any question — the constraint check's own exclusions (spatialCheck)
      const dropExcluded = (ask) => {
        try {
          const live = host?.charts?.list?.() || []
          const exc = excludedCharts(text, live, selectedChart(host))
          // ⛔ (hotfix) …nor a chart an UNPLACED exclusion may mean (a ticker on several charts: `unoffered`)
          const ex = new Set([...exc, ...(exc.unoffered || []), ...spatialConstraints(text, live, selectedChart(host)).excluded])
          ex.delete(UNPLACED)
          if (!ex.size || !Array.isArray(ask?.choices)) return ask
          const k = getTargetKind(getCapability(screened.ops[0]?.action)?.target)
          const list = k?.list(host) || []
          return { ...ask, choices: ask.choices.filter(c => { const snap = list.find(s => s.ref === c.ref); return !ex.has(snap ? chartRefOf(k, snap) : c.ref) }) }
        } catch { return ask }
      }
      if (deictic?.ask) deictic.ask = dropExcluded(deictic.ask)
      if (deictic?.aim) screened.ops = deictic.aim
      if (deictic?.refuse) {
        const said = `I didn't change anything: ${deictic.refuse}`
        push({ role: 'refusal', text: said })
        record({ member: null, outcome: said, outcomeData: { kind: 'refused', actions: screened.ops.map(o => o?.action) }, telemetry: { path: 'model', refused: true, voice } })
        return
      }
      const askEveryExcept = (mode) => {
        const q = everyExceptQuestion(host, screened.ops, text)
        if (!q) return false
        pendingRef.current = { kind: 'target', ops: [], path: 'model', mode, member: text, voice, epoch: epochOf(host), setChoice: q.choice }
        push({ role: 'question', text: q.text, choices: [{ ref: q.choice.ref, label: q.choice.label }, { label: 'Cancel', cancel: true }], local: true })
        record({ member: null, outcome: q.text, outcomeData: { kind: 'clarify-every-except', actions: screened.ops.map(o => o?.action) }, telemetry: { path: 'model', disposition: 'clarify', voice } })
        return true
      }
      if (deictic?.ask && askEveryExcept(env.disposition)) return
      if (deictic?.ask) {
        const kinds = kindsOf(screened.ops)
        if (kinds.length === 1) {
          pendingRef.current = { kind: 'target', ops: screened.ops, path: 'model', mode: env.disposition, member: text, voice, epoch: epochOf(host) }
          push({ role: 'question', text: deictic.ask.text, choices: deictic.ask.choices, local: true })
        } else {
          push({ role: 'agent', text: 'Which chart do you mean? Click it (or say left, right…) and ask again — nothing has changed yet.' })
        }
        record({ member: null, outcome: deictic.ask.text, outcomeData: { kind: 'clarify-deictic', actions: screened.ops.map(o => o?.action) }, telemetry: { path: 'model', disposition: 'clarify', voice } })
        return
      }
      // ⛔ P2-B (owner decision 7, 2026-10-25): with several charts on the board, the model's plan changes only
      // charts the member identified (words, click, an answer). One unidentified chart → "Which chart?" (their
      // pick resumes THIS plan); several → the change is only proposed. Never the model's guess, never silent.
      let disposition = env.disposition
      // ⭐ LIVE PRODUCTION TEST 2026-10-28: "create a custom indicator that …" is the member's own instruction — the model
      // proposing it put a card in front of what they had just asked for. The explicit creation of a NEW indicator
      // (indicatorAuthoring.explicitIndicatorCreate: decided from their words, never by the model) is applied; its Save
      // still stops at a ready draft when an R1 condition fails after the build (an acknowledgement, a name they already use)
      if (!nl1 && disposition === 'propose' && explicitIndicatorCreate(screened.ops)) { mark('deescalate', 'explicit-create'); disposition = 'apply' }
      const unnamed = onSubject ? null : screenUnnamedTargets({ host, ops: screened.ops, text, context: askedFor, pickedRefs: answeredRefs, getTargetKind, getCapability })
      if (unnamed?.ask) unnamed.ask = dropExcluded(unnamed.ask)
      if (unnamed?.ask && askEveryExcept(disposition)) return
      if (unnamed?.ask) {
        const kinds = kindsOf(screened.ops)
        if (kinds.length === 1) {
          pendingRef.current = { kind: 'target', ops: screened.ops, path: 'model', mode: disposition, member: text, voice, epoch: epochOf(host) }
          push({ role: 'question', text: unnamed.ask.text, choices: unnamed.ask.choices, local: true })
        } else {
          push({ role: 'agent', text: 'Which chart do you mean? Click it (or say left, right…) and ask again — nothing has changed yet.' })
        }
        record({ member: null, outcome: unnamed.ask.text, outcomeData: { kind: 'clarify-unnamed-chart', actions: screened.ops.map(o => o?.action) }, telemetry: { path: 'model', disposition: 'clarify', voice } })
        return
      }
      // watchlist group A (Lead 2026-11-09): which Watchlist widget a showList acts on is decided by the WORDS — several widgets and
      // none named is asked, never guessed (watchlistTarget.js)
      const wlTarget = screenWatchlistWidget({ host, ops: screened.ops, text })
      if (wlTarget?.ask) {
        push({ role: 'agent', text: wlTarget.ask })
        record({ member: null, outcome: wlTarget.ask, outcomeData: { kind: 'clarify-watchlist-widget', actions: screened.ops.map(o => o?.action) }, telemetry: { path: 'model', disposition: 'clarify', voice } })
        return
      }
      if (wlTarget?.ops) screened.ops = wlTarget.ops
      // ⛔ #988 (AUDIT probe 17): the LAST safety net behind the resolvers — every spatial constraint the words state (a line, a
      // place, a relation from a named anchor or the click, a count), checked on the plan's own targets. A violation is asked
      // (only the cells that satisfy them are offered, never an anchor) and nothing runs. spatialCheck.js
      const spatial = onSubject ? null : checkSpatialConstraints({ host, ops: screened.ops, text, pickedRefs: answeredRefs, getTargetKind, getCapability })
      if (spatial?.ask && askEveryExcept(disposition)) return
      if (spatial?.ask) {
        const kinds = kindsOf(screened.ops)
        if (kinds.length === 1 && spatial.ask.choices.length) {
          pendingRef.current = { kind: 'target', ops: screened.ops, path: 'model', mode: disposition, member: text, voice, epoch: epochOf(host) }
          push({ role: 'question', text: spatial.ask.text, choices: spatial.ask.choices, local: true })
        } else {
          push({ role: 'agent', text: 'Which chart do you mean? Click it (or say left, right…) and ask again — nothing has changed yet.' })
        }
        record({ member: null, outcome: spatial.ask.text, outcomeData: { kind: 'clarify-spatial', actions: screened.ops.map(o => o?.action) }, telemetry: { path: 'model', disposition: 'clarify', voice } })
        return
      }
      // ⭐ AUDIT ruling (11-13): a ticker the words name as the TARGET outranks the only chart, the click and "the one left" — a plan
      // that writes a chart showing another symbol is asked, and nothing runs (a ticker that is a VALUE of the plan is no target).
      // A word NOT in capitals counts as a ticker only when the client knows it as one: a board symbol, or the ticker search's own
      // verdict (groundSymbols, cached; bounded like nameSearch — no answer in time is "not known here").
      let tgtTicker = null
      try {
        const known = new Map()
        const live = host?.charts?.list?.() || []
        const writesChart = (screened.ops || []).some(o => { const cap = getCapability(o?.action); return !!cap && !cap.query && !!getTargetKind(cap.target) })
        const lower = writesChart ? lowerTickerCandidates(text, live, (w) => plainSymbolWord(w, host)) : []
        if (lower.length) {
          await nameSearchAll(lower)
          for (const w of lower) { const v = groundingOf(w); if (v && (v.kind === 'ticker' || v.kind === 'name') && v.ticker) known.set(w, v.ticker) }
        }
        tgtTicker = targetTickerConflict({ host, ops: screened.ops, text, pickedRefs: answeredRefs, getTargetKind, getCapability, known })
      } catch {
        tgtTicker = { failed: true, ask: { text: TARGET_CHECK_FAILED } }        // ⛔ fail closed: an unread check never writes
      }
      if (tgtTicker?.ask) {
        push({ role: 'agent', text: tgtTicker.ask.text })
        record({ member: null, outcome: tgtTicker.ask.text, outcomeData: { kind: 'clarify-target-ticker', actions: screened.ops.map(o => o?.action) }, telemetry: { path: 'model', disposition: 'clarify', voice } })
        return
      }
      if (unnamed?.propose && disposition === 'apply') {
        mark('escalate', 'unnamed-charts')
        push({ role: 'agent', text: unnamed.note })
        disposition = 'propose'
      }
      // S6 F4: a new chart for a named ticker is born on it (not linked), even if the plan dropped the ticker
      // ⭐ live test 2026-10-28: "N charts for these tickers" planned as adds + tickers → ONE chart grid (reuses
      // the board's charts, re-tiles to make room) — never "there isn't enough open space"
      // W1.1 R-02 (LT-1): on an EMPTY board, chart ops the planner put on a target that is not a chart = one new chart on that symbol
      const gridded = screenChartGrid(screenEmptyBoardChart(screenNewChart(canonicalIndicatorAdds(screened.ops), text).ops, host).ops, text, host)
      // review t4 M1: the SAME replace-or-add question as the instant reader, for the model's plan on every path (NL-1 too) —
      // a grid of fewer tickers than the board's charts, with no new / add / replace in the member's words, is never guessed
      const gridAsk0 = gridChoiceFor(gridded.ops, `${askedFor || ''} ${text}`, host)
      // a grid that could not run either way (an unknown ticker, no room) is never asked about — its refusal is said as before
      const gridAsk = gridAsk0 && await (async () => {
        try { const a = gridAsk0.options.add; return planOps(collectTargets(host, kindsOf(a)), a, await prepareOps(a), capCtx).ok } catch { return false }
      })() ? gridAsk0 : null
      if (gridAsk) {
        // review t4 M5: "…charts, each with a 50 SMA" — the per-chart steps ride with BOTH choices (they run on the charts the
        // picked grid leaves showing those tickers; behind the replace card, once it is approved)
        pendingRef.current = { kind: 'target', ops: [], path: 'model', member: text, voice, epoch: epochOf(host), gridChoice: gridAsk.options,
          ...(gridded.then?.length && !env.correction ? { gridThen: gridded.then } : {}) }
        push({ role: 'question', text: gridAsk.text, choices: [...gridAsk.choices, { label: 'Cancel', cancel: true }], local: true })
        record({ member: null, outcome: gridAsk.text, outcomeData: { kind: 'clarify-multichart' }, telemetry: { path: 'model', disposition: 'clarify', voice } })
        return
      }
      // ⭐ acceptance 2026-10-29: the plan also changes the charts the grid makes ("…, each with a 50sma") — the grid runs,
      // then those changes, on the charts that now show their tickers: two steps of one request (runCompound — each step
      // the same execute, policy, receipts and Undo; a step that does not land stops the rest, said plainly)
      if (gridded.then?.length && !nl1 && !env.correction) {
        const grid = gridded.ops[0]?.args?.symbols || []
        const steps = [
          { text: `set up the ${grid.join(', ')} charts`, kind: 'planned', ops: gridded.ops, grid },
          { text: 'the rest on those charts', kind: 'planned', each: gridded.then },
        ]
        if (disposition === 'apply') return await runCompound(steps, { member: text, voice })
        push({ role: 'agent', text: 'Once those charts are there, ask me again for the rest — I can only plan it on charts that exist.' })
      }
      const screenedOps = gridded.ops
      // NL-1: no wording-dependent approval shortcut — every indicator save shows its approval card
      const ops = nl1 ? withoutWordingApprovals(screenedOps) : screenedOps
      lastActionsRef.current = ops.map(o => o.action)
      // ⭐ NL-1 CORRECTION ("no, I meant 15"): the Agent's previous change is reversed FIRST, through the
      // existing Undo — which refuses when the change is protected, on another board, or was modified since
      // (fingerprints). Only then does the corrected change run. If it cannot be reversed, nothing is undone
      // and the corrected change is only PROPOSED: the member decides, never silently.
      if (nl1 && env.correction) {
        // a plan held for approval (above) never reverses anything by itself: the earlier change stays
        const cp = unsentWords.length ? { ok: false, reason: 'part of your request needs actions I couldn’t include' }
          : unnamed?.propose ? { ok: false, reason: 'I wasn’t sure which charts you meant' }
          : correctionPlan({ env, memory: memoryRef.current, epoch: epochOf(host), undoStack: undoRef.current })
        const reversed = cp?.ok ? await doUndo(cp.undoId, { member: null, voice }) : false
        if (!reversed) {
          push({ role: 'agent', text: `I didn't reverse my earlier change${cp && !cp.ok ? ` (${cp.reason})` : ''}, so here is the corrected change on its own — apply it only if you still want it.` })
          await execute(ops, { path: 'model', mode: 'propose', member: null, voice, words: text })
          return
        }
      }
      {
        const outer = tapRef.current
        const kinds = []
        tapRef.current = kinds
        try { await execute(ops, { path: 'model', mode: disposition, member: null, voice, words: text }) } finally { tapRef.current = outer; if (outer) outer.push(...kinds) }
        // ⭐ NLM-1 STEP PLANS (dark): each step's postcondition read back from the board (and the touched charts' saved copy)
        // — one plain line: what is in place, what is not, what is not saved. A plan waiting on an approval card is read
        // back when the card is decided (approve) — nothing of it has run yet
        if (stepPlan) await readBackRef.current?.()
        if (replyId && env.disposition === 'propose' && kinds.length && kinds.every(k => /^refused/.test(k))) setItems(xs => xs.filter(x => x.id !== replyId))
      }
      // agent.undo LAST: exactly what THIS plan committed (its new Undo entries, newest first) — through doUndo
      const after = undoAfterRef.current
      undoAfterRef.current = null
      if (after) {
        const fresh = undoRef.current.filter(e => !after.before.includes(e.id))
        if (!fresh.length && dropHeldForUndo(after.held)) { /* review F4: said by dropHeldForUndo */ } else if (!fresh.length) {
          const t = UNDO_AFTER_NOTHING
          push({ role: 'agent', text: t })
          record({ member: null, outcome: t, outcomeData: { kind: 'undo-none' }, telemetry: { path: 'model', undo: true, voice } })
        } else {
          for (const e of [...fresh].reverse()) { if (!(await doUndo(e.id, { member: null, voice, about: after.about }))) break }
        }
      }
    } finally {
      // a planned "…, then undo it" whose change never ran (a question, a card, a refusal): nothing was undone — said
      if (undoAfterRef.current) {
        const held = undoAfterRef.current.held
        undoAfterRef.current = null
        if (!dropHeldForUndo(held)) push({ role: 'agent', text: UNDO_AFTER_NOTHING })
      }
      undoneFirstRef.current = false
      questionSetAsideRef.current = false
      // W2 audit: a partly-possible request never reads as complete — what wasn't done is said last, in UCT's own words
      for (const t of notDoneRef.current || []) push({ role: 'refusal', text: t })
      if (notDoneRef.current?.length) record({ member: null, outcome: notDoneRef.current.join(' '), outcomeData: { kind: 'not-done' }, telemetry: { path: 'model', voice } })
      notDoneRef.current = null
      releaseLock()
      setActivity(null)
      turnEnd()
    }
  }, [push, gridMode, host, record, doUndo, undoTurn, approve, dismiss, execute, runCompound, setConversationId, patchItem, capCtx, streamLine, releaseLock])

  // ⛔ PENDING TASK (hotfix 2026-11-13, pendingTask.js): the member's pick on "Is that your answer to my question about …?" —
  // Yes: the held reply goes to the model AS THE ANSWER (the pending task restored: its words, groups, NL-1 question);
  // No: it is a new request (the old question withdrawn, the model told it was set aside). Nothing ran before the pick.
  const pickContinuation = useCallback(async (ref, label) => {
    const p = pendingRef.current
    if (lockRef.current || !p?.continuity) return
    pendingRef.current = null
    push({ role: 'member', text: label })
    return await send(p.continuity.text, { ...resumeOf(p.continuity, ref === 'pending:continue'), echo: false })
  }, [send, push])
  // restores the pending task for a "yes" (its words, groups, NL-1 question) or withdraws it for a "no"
  const resumeOf = (c, yes) => {
    if (yes) {
      askedForRef.current = c.askedFor
      askedAtRef.current = Date.now()
      askedGroupsRef.current = c.groups || null
      pendingQuestionRef.current = c.pq || null
      return { answering: true }
    }
    if (c.qid) patchItem(c.qid, { status: 'withdrawn' })
    return { asNew: true }
  }
  resumeRef.current = resumeOf

  // ⭐ INDICATORS ⇄ AGENT — the chart's Create Indicator / Modify door opened the Agent on a chart:
  // ask the question and hold ONE intent (indicatorEntry.js). No model call; the member's answer is
  // what runs. Create offers the existing builder's doors beside it.
  const prompt = useCallback((request) => {
    if (!request || !request.chartRef || lockRef.current) return false
    const i = beginAuthoringIntent(request)
    if (!i) return false
    const text = authoringPrompt(i)
    push({ role: 'question', text, local: true, authoring: true,
      choices: i.defId ? [] : INDICATOR_DOORS.map(d => ({ label: d.label, door: d.door })) })
    record({ member: null, outcome: text, outcomeData: { kind: 'authoring-prompt', chart: i.chartRef, edit: i.defId }, telemetry: { path: 'local', disposition: 'clarify' } })
    return true
  }, [push, record])
  // A door beside the question: the existing builder, on the intent's chart (the intent is set aside).
  const openDoor = useCallback((door) => {
    const i = peekAuthoringIntent()
    if (!i) return false
    clearAuthoringIntent()
    const r = openIndicatorDoor(host, i.chartRef, door)
    push({ role: 'agent', text: r.text })
    return r.ok
  }, [host, push])

  const newChat = useCallback(() => {
    setConversationId(null)
    pendingRef.current = null
    memoryRef.current.clear()             // GATE C: memory belongs to one chat
    setItems([])
  }, [setConversationId])

  const openConversation = useCallback(async (id) => {
    const conv = await agentConversation(id)
    if (!conv) return
    pendingRef.current = null
    memoryRef.current.clear()             // a reopened chat's old rows are history, not live references
    setConversationId(id)
    setItems(itemsFromTurns(conv.turns))
  }, [setConversationId])

  const canUndo = (undoId) => undoRef.current.some(e => e.id === undoId)

  // ⭐ OPEN CHART (2026-10-13, owner rev. 2). A card's own typed target (present.chartTarget — set by the
  // capability from what it answered; never the card's words) opens by REUSING a chart:
  //   • one chart on the board   → that chart switches to it now (chart.setSymbol: the platform's own
  //                                symbol switch — timeframe, settings, size and place kept; linked
  //                                widgets follow exactly as a manual symbol search does) + Undo;
  //   • several charts           → "Which chart?" with one choice per chart (its position and what it
  //                                shows) and Cancel — only the chart picked changes;
  //   • no chart                 → the safe add (widget.addCharts: one new chart if there is room).
  // A chart already showing it is left as it is (no duplicate). Protected layouts, the symbol check
  // and Undo apply as for any request; a NEW chart only when there is none (or the member asks for one
  // in words: "open NASDAQ:A50 in a new chart").
  const openChart = useCallback(async (raw) => {
    const target = chartTarget(raw)
    if (!target) return
    const sym = target.symbol
    const charts = (() => { try { return host?.charts?.list?.() || [] } catch { return [] } })()
    const member = `Open chart: ${target.label}`
    const said = (text, kind, role = 'agent') => {
      push({ role, text })
      record({ member, outcome: text, outcomeData: { kind }, telemetry: { path: 'card', ...(role === 'refusal' ? { refused: true } : {}) } })
    }
    const shown = charts.find(c => String(c?.symbol || '').toUpperCase() === sym)
    if (shown) return said(`${target.label} is already on your board (${shown.label || 'a chart'}), so nothing changed.`, 'chart-already-open')
    if (!charts.length) {
      lastActionsRef.current = ['widget.addCharts']
      // The click IS the approval of exactly this: ONE new chart on this ONE series. `approved` re-plans
      // and re-validates like an Apply — the room, symbol and protection checks all still decide.
      return execute([{ action: 'widget.addCharts', target: 'workspace', args: { symbols: [sym], timeframe: null, chart_type: null, exact: null } }],
        { path: 'card', mode: 'approved', member, voice: false })
    }
    // a protected layout: said BEFORE asking which chart (the pick could only be refused)
    if (protectedOpenLayout(host)) {
      return said(protectionRefusal(host, { plans: [{ changed: true, kind: 'chart' }] }) || 'This layout is protected, so nothing changed.', 'refused-protected', 'refusal')
    }
    const op = { action: 'chart.setSymbol', args: { symbol: sym } }
    lastActionsRef.current = ['chart.setSymbol']
    if (charts.length === 1) return execute([{ ...op, target: charts[0].ref }], { path: 'card', mode: 'apply', member, voice: false })
    // several: the member picks — labels made unique when two charts read alike ("Top chart (QQQ)" ×2)
    // (each names what it shows now — the host's label carries it; added when a label does not)
    const named = charts.map((c, i) => {
      const base = c.label || `Chart ${i + 1}`
      return c.symbol && !base.includes(c.symbol) ? `${base} (${c.symbol})` : base
    })
    const seen = new Map()
    for (const l of named) seen.set(l, (seen.get(l) || 0) + 1)
    let n = 0
    const choices = charts.map((c, i) => ({ ref: c.ref, label: seen.get(named[i]) > 1 ? `${named[i]} · ${++n}` : named[i] }))
    pendingRef.current = { kind: 'target', ops: [op], path: 'card', member, voice: false, epoch: epochOf(host) }
    push({ role: 'question', text: `Which chart should show ${target.label}?`, choices: [...choices, { label: 'Cancel', cancel: true }], local: true })
    record({ member, outcome: 'Asked which chart.', outcomeData: { kind: 'clarify-target', actions: ['chart.setSymbol'] }, telemetry: { path: 'card', clarified: true } })
  }, [host, push, record, execute])

  return {
    items, busy, activity, restoring, conversationId, send, newChat, openConversation,
    undo: exclusive((undoId) => doUndo(undoId, { member: null })),
    approve: exclusive(() => approve(null, { member: null })), dismiss: () => { if (!lockRef.current) dismiss({ member: null }) },
    chooseTarget: (ref, label) => (String(ref || '').startsWith('pending:') ? pickContinuation(ref, label) : exclusive(chooseTarget)(ref, label)), canUndo, openChart: exclusive(openChart),
    prompt, openDoor,
    hasPending: !!pendingRef.current,
  }
}
