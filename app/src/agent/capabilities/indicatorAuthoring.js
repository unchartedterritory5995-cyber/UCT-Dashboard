// ── INDICATORS (M3): conversational authoring through the Indicators specialist ────────────
//
// The Agent half of `docs/indicators/AGENT-M3-CONTRACT.md` (§3.5, §15, §16). Indicator
// Intelligence owns the draft — lineage, revision, history, Undo, the model call (/converse),
// validation, preview, Save and read-back — through `components/chart/builder/agentAuthoring.js`
// (contract `uct.indicators.authoring/1`). This file only ROUTES, TARGETS and RECEIPTS:
//
//   indicator.draft         one member turn on ONE draft (new or existing): advice, a question,
//                           or a change — the specialist decides which (`draftTurn`)
//   indicator.previewDraft  the draft as the tab's one live preview on a named chart (asked only)
//   indicator.saveDraft     the canonical Save (always proposed), then — as SEPARATE executions —
//                           an M2 `indicator.add` per requested chart
//   indicator.undoDraft     the draft's own last step, when the Agent's Undo stack has none
//                           (after a reload) — from `draftStatus().undoStepId`
//
// ⛔ NO SECOND ENGINE, NO SECOND STORE. The Agent never reads a tree or a formula, never calls
// /converse, never writes a definition, and never rebuilds a draft from chat. It keeps only the
// OPAQUE `draftRef`s the specialist returned (held as returned; the active one also survives a
// reload in this tab), and asks the specialist again on every call — `ctx` is rebuilt each time
// from the current access, the member's own definition rows and the target chart.
// ⛔ "DONE" ONLY FROM A TYPED OUTCOME. A question or advice reply changes nothing and says so;
// a change is reported from the specialist's own lines; Save only from its read-back-confirmed
// result. Preview is shown only when the member asks for it.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import {
  AUTHORING_CONTRACT, AUTHORING_REASONS as R, openDraft, draftTurn, draftUndo, draftStatus, listDrafts,
  saveDraft, showDraftPreview, renameDraft,
} from '../../components/chart/builder/agentAuthoring'

const NEW = 'draft:new'
const refOf = (key) => `draft:${key}`

// ── fresh sources (useAgent hands them in; read at EVERY call) ──
// `extra` is for tests only (the specialist's injectable `converse` / `store` / `readBack`).
let sources = { access: () => false, rows: () => [], extra: null }
export function setAuthoringSources(s) { sources = { ...sources, ...(s || {}) } }

/** The context for ONE specialist call, built now: access, own rows, and the symbol/tf of the
 *  chart the draft belongs to — ⛔ never a substitute: no chart → no symbol (refinement A). */
export function authoringCtx(host, chartRef = null) {
  const charts = (() => { try { return host?.charts?.list() || [] } catch { return [] } })()
  const c = (chartRef && charts.find(x => x.ref === chartRef)) || null
  let rows = []
  try { rows = [...(sources.rows() || [])] } catch { rows = [] }
  let canAuthor = false
  try { canAuthor = sources.access() === true } catch { canAuthor = false }
  return { canAuthor, definitionRows: rows, sym: c?.symbol || null, tf: c?.tf || null, ...(sources.extra || {}) }
}

// ── the ACTIVE draft of this Agent conversation: the opaque draftRef, as the specialist returned it ──
// per TAB (sessionStorage) — the same lifetime as the specialist's drafts (INDICATORS review N1)
const ACTIVE_KEY = 'uct.agent.activeDraft'
const store = () => globalThis.sessionStorage
let active = null
const readActive = () => {
  if (active) return active
  try { const v = store()?.getItem(ACTIVE_KEY); active = v ? JSON.parse(v) : null } catch { active = null }
  return active
}
function setActive(draftRef) {
  active = draftRef || null
  try {
    if (active) store()?.setItem(ACTIVE_KEY, JSON.stringify(active))
    else store()?.removeItem(ACTIVE_KEY)
  } catch { /* storage is a convenience: the specialist is the authority */ }
}
export function _resetAuthoring() { active = null; try { store()?.removeItem(ACTIVE_KEY); store()?.removeItem(LAST_KEY) } catch { /* */ } }

// ── refinement A: the chart a draft belongs to is the SPECIALIST's association (`status.chartRef`,
// recorded by openDraft). Used while that chart is on the board; otherwise the member names one. ──
const boardCharts = (host) => { try { return host?.charts?.list() || [] } catch { return [] } }
const originOf = (status) => (status && typeof status.chartRef === 'string' ? status.chartRef : null)
/** The chart for a draft request: {ref} or {ask} (a question — never a silent pick). */
/** A chart named through its own indicators / indicatorEdits entry ('ind:<chart>' / 'ixe:<chart>') IS that
 *  chart (S6 probe P9: the model passed the indicatorEdits ref for "add it to the SPY chart"). */
export const asChartRef = (r) => (typeof r === 'string' ? r.replace(/^(?:ind|ixe):/, '') : r)
export function chartForDraft(st, chartArg) {
  chartArg = chartArg == null ? chartArg : asChartRef(chartArg)
  const charts = st.charts || []
  const on = (r) => charts.some(c => c.ref === r)
  if (chartArg != null) return on(chartArg) ? { ref: chartArg } : { ask: 'That chart isn’t on the board — which chart is this indicator for?' }
  if (st.new) {
    if (charts.length === 1) return { ref: charts[0].ref }
    return { ask: charts.length ? 'Which chart is this indicator for?' : 'Open a chart first — an indicator is built on a chart.' }
  }
  const origin = originOf(st.status)
  if (origin && on(origin)) return { ref: origin }
  return { ask: origin ? 'The chart this draft was started on is no longer on the board — which chart should it use?' : 'Which chart is this draft for?' }
}
// the last definition the Agent SAVED (refinement B): kept so a delayed chart add is retried with the
// SAME definition — never a second Save
const LAST_KEY = 'uct.agent.lastSaved'
export function lastSaved() { try { return JSON.parse(store()?.getItem(LAST_KEY) || 'null') } catch { return null } }
function rememberSaved(v) { try { store()?.setItem(LAST_KEY, JSON.stringify(v)) } catch { /* convenience only */ } }

// ── ⛔ NEVER A SILENT PICK BETWEEN DRAFTS ──
// The SELECTED draft of this conversation (`active`) is set only by the member: the Agent made it
// for them (a new-draft request), they chose it from the "which one?" list, or they acted on it
// while it was the only one. With two or more usable drafts, a request on any OTHER draft (or with
// none selected) is not planned: the member is shown the drafts and picks one. Unrelated Agent
// actions never touch the selection.
const DRAFT_ACTIONS = new Set(['indicator.draft', 'indicator.previewDraft', 'indicator.saveDraft', 'indicator.undoDraft'])
const labelOf = (s) => (s.status?.name ? `“${s.status.name}” (draft)` : 'Untitled draft')
export function draftAmbiguity(host, ops) {
  const on = (ops || []).filter(o => o && DRAFT_ACTIONS.has(o.action) && o.target !== NEW)
  if (!on.length) return null
  let snaps
  try { snaps = snapshots(host) } catch { return null }
  const usable = snaps.filter(s => !s.new && !s.expired)
  if (usable.length < 2) return null
  if (on.every(o => snaps.some(s => s.ref === o.target && s.active && !s.expired))) return null
  return { text: `You have ${usable.length} indicator drafts open — which one do you mean?`, choices: usable.map(s => ({ ref: s.ref, label: labelOf(s) })) }
}
/** The member chose this draft (from the "which one?" list). */
export function selectDraft(host, ref) {
  const s = snapshots(host).find(x => x.ref === ref && x.draftRef && !x.expired)
  if (s) setActive(s.draftRef)
  return !!s
}
export const isDraftAction = (name) => DRAFT_ACTIONS.has(name)
/** Usable (not expired) drafts in this tab. */
export function hasUsableDraft(host) {
  try { return snapshots(host).some(s => !s.new && !s.expired) } catch { return false }
}

// ── ⛔ S6 F1–F3: the EXECUTION BOUNDARY for model-planned ops (useAgent.send, before anything is
// planned or proposed). Deterministic, from the member's own words — the model's choice is checked,
// never trusted, for the three intents real-model acceptance got wrong. ──
const PANEL_WORDS = /\b(create indicator|indicator (?:builder|panel|editor|window)|(?:visual|the) builder|builder (?:panel|window|interface|view)|panel|dock|editor|interface)\b/i
const LAYOUT_WORDS = /\b(layouts?|workspace|board|setup)\b/i
const INDICATOR_WORDS = /\b(indicators?|draft|study|formula)\b/i
const APPLY_WORDS = /\b(add|apply|put|place|attach|load|plot|show)\b[^.;!?]*\b(charts?|both|all of them)\b|\b(?:to|on|onto) (?:my|the|both|all|this|that|these|those)\b[^.;!?]*\bcharts?\b/i
const NEGATION = /\b(don['’]?t|do not|not|no|without|never|neither|nor)\b/i
/** Did the member ask, in THIS message, to put the indicator on a chart? (a negated clause is not a request) */
export function asksToApply(text) {
  return String(text || '').split(/[.;!?\n]+|,\s*(?:but|then)\b/i).some(c => APPLY_WORDS.test(c) && !NEGATION.test(c))
}

// ── OWNER 2026-10-12: an explicit "apply it" / "save it" needs no second click (policy.js `explicitOk`).
// Indicators' conditions (2026-10-12): decided ONLY from the member's OWN words in THIS message, here,
// never because the model planned a save; one usable draft (draftAmbiguity still asks first); the name
// is theirs or the draft's; a chart they named (or the one they clicked, still valid); an
// acknowledgement, a new version of a saved indicator or a duplicate name keeps the card (confirmIf). ──
const APPLY_IT = /\b(?:apply|add|put|place|attach)\s+(?:it|this|that|this one|the indicator|the draft|my indicator)\b/i
/** Did the member's own words in THIS message ask to save or apply the indicator? */
export function explicitSaveWords(text) {
  const t = String(text || '').trim()
  if (LAYOUT_WORDS.test(t) && !INDICATOR_WORDS.test(t)) return false
  if (GENERIC_SAVE.test(t) || INDICATOR_SAVE.test(t)) return true
  if (/\bsave\b/i.test(t) && /\b(indicator|draft|it|this)\b/i.test(t) && !NEGATION.test(t)) return true
  return asksToApply(t) || t.split(/[.;!?\n]+|,\s*(?:but|then)\b/i).some(c => APPLY_IT.test(c) && !NEGATION.test(c))
}
// "Apply it." / "add it to my chart" / "ok, put it on the chart" — the WHOLE message (fast path)
const APPLY_IT_WHOLE = /^(?:(?:ok(?:ay)?|now|great|perfect|nice|cool|yes|yep|sure|looks good)[,!.]?\s+)*(?:please\s+)?(?:apply|add|put|place)\s+(?:it|this|that|this one|the indicator|the draft|my indicator)(?:\s+(?:to|on|onto)\s+(?:my|the|this)\s+chart)?(?:,?\s*please)?[.!]?$/i
/** The valid clicked chart (still on this board / layout) — host.charts.selected() — or null. */
const clickedChart = (host) => { try { return host?.charts?.selected?.() || null } catch { return null } }
/** Did the member NAME this chart (its symbol, its position) — or click it (owner decision)? */
function chartNamed(host, chartRef, words) {
  const charts = boardCharts(host)
  if (charts.length <= 1) return true
  if (clickedChart(host) === chartRef) return true
  const c = charts.find(x => x.ref === chartRef)
  if (!c) return false
  const w = String(words || '').toLowerCase()
  if (c.symbol && new RegExp(`\\b${String(c.symbol).toLowerCase().replace(/[.^$*+?()[\]{}|\\]/g, '\\$&')}\\b`).test(w)) return true
  return !!c.position && c.position.split('-').every(p => new RegExp(`\\b${p}\\b`).test(w))
}
/** The board's charts already showing this saved definition (a new version updates them in place). */
function showsDefinition(host, defId) {
  if (!defId) return []
  return boardCharts(host).filter(c => (c.cs?.indicatorInstances || []).some(i => i && !i.deleted && i.defId === defId)).map(c => c.ref)
}
/** The member's own saved indicator names (lower-case), for the duplicate-name rule. */
function ownNames() {
  let rows = []
  try { rows = sources.rows() || [] } catch { rows = [] }
  return rows.map(r => String(r?.definition?.meta?.name || r?.definition?.name || r?.name || '').trim().toLowerCase()).filter(Boolean)
}
/** ONE line that says what the draft does (Indicators' order): the colour / paint rule or signal
 *  line first, else the first VISIBLE output — never a hidden one. */
// Indicators 10-12: the builder's derived names can read like formulas ("EMA 9 > EMA 20") — never put one in chat
const FORMULA_NAME = /[<>=+*^[\]·]|&&|\|\|/
export const looksLikeFormula = (name) => FORMULA_NAME.test(String(name || ''))
/** “Name” for chat, or the fallback when the name is missing or reads like a formula. */
export const shownName = (name, fallback) => (name && !looksLikeFormula(name) ? `“${name}”` : fallback)
export function oneLineOf(status) {
  const rb = status?.readback || {}
  const look = (rb.presentation || []).filter(l => typeof l === 'string' && !/: hidden \(still calculated\)$/.test(l))
  const paint = look.find(l => /^(candles painted|background shaded)\b/.test(l))
  if (paint) return paint
  if (rb.intent) return rb.intent
  const ruled = look.find(l => / coloured | while /.test(l))
  if (ruled) return ruled
  const o = (rb.outputs || []).find(x => x && x.name && x.phrase)
  if (o) return looksLikeFormula(o.name) ? o.phrase : `${o.name} — ${o.phrase}`
  return look[0] || shownName(status?.name, 'your indicator')
}
const sentence = (s) => { const t = String(s || '').trim(); return t ? `${t[0].toUpperCase()}${t.slice(1)}`.replace(/[.\s]+$/, '') : t }
/** The lines a member must always see after a turn (Indicators (d)): questions, refusals, unavailable. */
const mustShow = (lines) => (lines || []).filter(l => /^Question:|cannot be used|couldn’t|could not|not understood|isn’t available|is not available/i.test(String(l)))
// ⛔ F2b — WHAT "SAVE IT" MEANS. One deterministic rule, shared by the fast path (layout.js and
// indicator.saveDraft's own phrase) and the model path (useAgent): with an indicator draft open, a
// generic "save it / save this / save it as X" is NEVER a layout save.
//   explicit layout / workspace / board wording → not decided here (the layout capabilities)
//   no usable draft                              → not decided here (unchanged behaviour)
//   the SELECTED draft is usable                 → that draft (a Save proposal, as always)
//   drafts open, none selected                   → ask: the indicator, or the workspace?
const GENERIC_SAVE = /^(?:please\s+|ok(?:ay)?,?\s+|now\s+)?save\s+(?:it|this|that|this one|my work|the changes|my changes|these changes)?\s*(?:as\s+(?:a\s+)?(?:new\s+)?(?:indicator\s+)?(?:called\s+|named\s+)?["“]?(.+?)["”]?)?\s*(?:,?\s*please)?[.!]?$/i
const INDICATOR_SAVE = /^(?:please\s+)?save\s+(?:the|this|my)\s+(?:indicator|draft|indicator draft)(?:\s+draft)?\s*(?:as\s+(?:a\s+)?(?:new\s+)?(?:called\s+|named\s+)?["“]?(.+?)["”]?)?\s*[.!]?$/i
export const SAVE_ASK_TEXT = 'Do you want to save the indicator you’re building, or this workspace as a layout?'
const saveChoices = (name) => [{ label: name ? `Save the indicator draft as ${name}` : 'Save the indicator draft' },
  { label: name ? `Save this workspace as a new layout called ${name}` : 'Save this workspace layout' }]
/** @returns null (not this rule's to decide) | {kind:'draft', target, name} | {kind:'ask', text, choices} */
export function saveReferent(host, raw) {
  const t = String(raw || '').trim()
  if (LAYOUT_WORDS.test(t)) return null
  const g = GENERIC_SAVE.exec(t)
  const i = g ? null : INDICATOR_SAVE.exec(t)
  if (!g && !i) return null
  const name = ((g ? g[1] : i[1]) || '').trim() || null
  if (g && !/\b(it|this|that|work|changes)\b/i.test(t) && !name) return null      // a bare "save" is not this rule's
  let snaps
  try { snaps = snapshots(host).filter(x => !x.new && !x.expired) } catch { return null }
  if (!snaps.length) return null
  const active = snaps.find(x => x.active)
  if (active) return { kind: 'draft', target: active.ref, name }
  // "save the indicator" with exactly one draft open IS that draft; anything vaguer asks
  if (i && snaps.length === 1) return { kind: 'draft', target: snaps[0].ref, name }
  return { kind: 'ask', text: SAVE_ASK_TEXT, choices: saveChoices(name) }
}

// ⛔ M1 — a preview is shown only when the member asks for one in THIS message
const PREVIEW_WORDS = /\b(preview|previewing|show (?:me )?(?:it|the (?:draft|preview|indicator)|what it looks like|how it looks)|let me see|see (?:it|the draft|how it looks|what it looks like)|display it)\b/i
export function asksToPreview(text) {
  return String(text || '').split(/[.;!?\n]+|,\s*(?:but|then)\b/i).some(c => PREVIEW_WORDS.test(c) && !/\b(no|don['’]?t|do not|without|never|skip)\b[^.;!?]*\bpreview/i.test(c))
}

/** F5: null when "both / all charts" names exactly the charts the plan adds to; else the question to ask. */
export function multiChartAmbiguity(host, adds, text) {
  // every chart on the board (a chart that can't take it is refused by the add itself, by name)
  const charts = boardCharts(host)
  const targets = [...new Set(adds.map(o => asChartRef(o.target)))]
  const both = /\bboth\b/i.test(text)
  const ask = both ? 'Which two charts should it go on?' : 'Which charts should it go on?'
  if (targets.length < 2 || !targets.every(t => charts.some(c => c.ref === t))) return ask
  if (both && targets.length !== 2) return ask
  // "all charts" = every chart here; "both" on a two-chart board is those two
  if (targets.length === charts.length) return null
  // otherwise the member must have named each one (its symbol or its position)
  const named = (c) => [c.symbol, c.position].filter(Boolean).some(w => new RegExp(`\\b${String(w).replace(/[^A-Za-z0-9]/g, '')}\\b`, 'i').test(text))
  return targets.every(t => named(charts.find(c => c.ref === t))) ? null : ask
}
// ⭐ R1 — "Save it as X": the rename is the specialist's own name-only draft step (local, undoable,
// receipted like any draft change), done FIRST; the Save is then proposed on the RENAMED draft, so the
// card shows the final name and that name's exact acknowledgement (a rename can relabel an output,
// and with it the warning). The approval (F6 seal) is of what the member will actually save.
/** @returns null, or `{ rename: op, save: op }` — run the rename, then plan the save (name null). */
export function splitSaveAs(host, ops) {
  if (!Array.isArray(ops) || ops.length !== 1) return null
  const o = ops[0]
  if (o?.action !== 'indicator.saveDraft' || typeof o.args?.name !== 'string' || !o.args.name.trim()) return null
  let snap
  try { snap = snapshots(host).find(x => x.ref === o.target) } catch { return null }
  if (!snap || snap.new || snap.expired || !snap.status) return null
  const name = o.args.name.trim()
  if ((snap.status.name || '') === name) return { rename: null, save: { ...o, args: { ...o.args, name: null } } }
  return {
    // the specialist's TYPED rename (renameDraft: name-only by construction, never a model call —
    // INDICATORS review: a "Name it X" draft turn can fall through to the model on an unusual name)
    rename: { target: o.target, name },
    save: { ...o, args: { ...o.args, name: null } },
  }
}
/**
 * R1 step 1 — rename the draft with `renameDraft`, pinned to its current revision. Refusals stop the
 * Save (never a proposal over them); `name-unchanged` just skips to the Save. The engine may clip a
 * long name: `to` is the name it actually got (the card then shows it).
 * @returns `{ok:true, skipped:true}` | `{ok:true, to, line, undoData}` | `{ok:false, text, undoData?}`
 */
export function renameBeforeSave(host, ref, name) {
  let snap
  try { snap = snapshots(host).find(x => x.ref === ref) } catch { snap = null }
  if (!snap || !snap.draftRef || !snap.status) return { ok: false, text: 'That draft is no longer available, so nothing was renamed or saved.' }
  const u = usable(snap); if (u) return { ok: false, text: u }
  const ctx = authoringCtx(host, originOf(snap.status))
  const r = renameDraft(snap.draftRef, name, { expectedRevision: snap.status.revision }, ctx)
  if (!r.ok) {
    if (r.reason === R.NAME_UNCHANGED) return { ok: true, skipped: true }
    return { ok: false, text: `${refusalSentence(r)} Nothing was renamed or saved.` }
  }
  const undoData = r.stepId ? { draftRef: snap.draftRef, stepId: r.stepId } : null
  // defence in depth: renameDraft is name-only by construction (its typed marker says so)
  if (r.renameOnly !== true) return { ok: false, undoData, text: 'That wasn’t only a rename, so I didn’t propose saving it — check the draft (Undo puts it back), then ask me to save it again.' }
  setActive(snap.draftRef)
  const to = (r.rename && r.rename.to) || name
  return { ok: true, to, undoData, line: `Renamed the draft to “${to}” (draft — not saved).` }
}
/**
 * @returns `{ ops, ask?: {text, choices}, notes: string[] }` — ops possibly corrected; `ask` = do not
 *          plan anything, ask this instead (nothing changes).
 */
export function screenModelOps(host, ops, text, capCtx = {}) {
  const notes = []
  const words = String(text || '')
  let out = (ops || []).map(o => ({ ...o, args: o && o.args ? { ...o.args } : o?.args }))
  // F1 — a plain "build me an indicator" is built HERE (indicator.draft), not handed to the panel —
  // only for a member who CAN author (else the op is left alone and refused exactly as before)
  const canAuthor = capCtx.surface === 'charts' && capCtx.createIndicator === true
  out = out.map(o => {
    if (!canAuthor || o?.action !== 'indicator.openCreate' || o.args?.defId != null || PANEL_WORDS.test(words)) return o
    const chartRef = typeof o.target === 'string' && o.target.startsWith('ind:') ? o.target.slice(4) : null
    notes.push('Building it with you here in the chat (say “open Create Indicator” if you want the panel instead).')
    return { action: 'indicator.draft', target: NEW, args: { message: words.trim(), chart: chartRef, edit: null } }
  })
  // F2 — "save it as X" with an indicator draft open: never a silent layout save (and never the reverse)
  const usable = hasUsableDraft(host)
  const layoutSave = out.find(o => o?.action === 'layout.saveAs' || o?.action === 'layout.saveCurrent')
  const draftSave = out.find(o => o?.action === 'indicator.saveDraft')
  const explicitLayout = LAYOUT_WORDS.test(words)
  const explicitIndicator = INDICATOR_WORDS.test(words)
  if ((layoutSave && usable && !explicitLayout) || (draftSave && explicitLayout && !explicitIndicator)) {
    const name = (layoutSave && layoutSave.args && layoutSave.args.name) || (draftSave && draftSave.args && draftSave.args.name) || null
    return { ops: [], notes, ask: { text: SAVE_ASK_TEXT, choices: saveChoices(name) } }
  }
  // R1 — the model's two-op form ("Name it X" turn + Save) becomes ONE "save as X", so the rename is
  // the specialist's typed renameDraft (never a draft turn that could reach the model)
  if (out.length === 2 && out[0]?.action === 'indicator.draft' && out[1]?.action === 'indicator.saveDraft'
    && out[0].target === out[1].target && out[1].args?.name == null) {
    const m = /^\s*(?:please\s+)?(?:name|call|rename|title)\s+it\s+(?:to\s+|as\s+)?["“]?(.+?)["”]?\s*[.!]?\s*$/i.exec(String(out[0].args?.message || ''))
    if (m && m[1].trim()) out = [{ ...out[1], args: { ...out[1].args, name: m[1].trim() } }]
  }
  // M1 — a preview nobody asked for is never part of the plan (the draft itself still runs)
  if (out.some(o => o?.action === 'indicator.previewDraft') && !asksToPreview(words)) {
    out = out.filter(o => o?.action !== 'indicator.previewDraft')
    notes.push('I won’t show a preview unless you ask for one.')
    if (!out.length) return { ops: [], notes }
  }
  // S6 nit — a NEW draft with no chart on a board of several: ask with the charts as choices (the
  // member's pick fills `chart`; nothing is sent to the builder until then)
  // ⛔ only for a member who CAN author: without access the op is left alone and refused, never asked about
  const unplaced = out.find(o => o?.action === 'indicator.draft' && o.target === NEW && o.args?.chart == null)
  // owner decision 2026-10-12: the chart the member CLICKED (still valid) is the chart they mean
  if (canAuthor && unplaced && boardCharts(host).length > 1 && clickedChart(host)) {
    out = out.map(o => (o === unplaced ? { ...o, args: { ...o.args, chart: clickedChart(host) } } : o))
  }
  if (canAuthor && unplaced && out.length === 1 && out[0].args?.chart == null) {
    const charts = boardCharts(host)
    if (charts.length > 1) {
      return { ops: [], notes, ask: { text: 'Which chart is this indicator for?',
        choices: charts.map(c => ({ ref: c.ref, label: c.label })), pick: { ops: out, action: 'indicator.draft', arg: 'chart' } } }
    }
  }
  // F5 — "add it to both / all charts": the charts must be unambiguous before anything is proposed
  const adds = out.filter(o => o?.action === 'indicator.add')
  const many = /\b(both|all|every|each)\b[^.;!?]*\bcharts?\b/i.test(words)
  if (adds.length && many) {
    const why = multiChartAmbiguity(host, adds, words)
    if (why) return { ops: [], notes, ask: { text: why, choices: [] } }
  }
  // F3 — Save and "add to a chart" are separate intents: an unrequested chart add is dropped
  out = out.map(o => {
    if (o?.action !== 'indicator.saveDraft' || !Array.isArray(o.args?.addTo) || !o.args.addTo.length || asksToApply(words)) return o
    notes.push('Saving only — I won’t add it to a chart unless you ask.')
    return { ...o, args: { ...o.args, addTo: [] } }
  })
  return { ops: markExplicitSaves(host, out, words, notes), notes }
}

/** OWNER 2026-10-12 + Indicators' conditions: a Save is EXPLICIT (no second click) only when the
 *  member's own words in THIS message ask for it — decided here, never by the model. A Save riding
 *  with a draft change (R1) is kept only for a NEW draft this message builds AND asks to apply/save;
 *  otherwise the change runs and the Save waits for "apply it". */
function markExplicitSaves(host, ops, words, notes) {
  void notes
  const explicit = explicitSaveWords(words)
  const turn = ops.find(o => o?.action === 'indicator.draft')
  // the build runs before its save, whatever order the model listed them in
  if (turn) ops = [...ops.filter(o => o?.action !== 'indicator.saveDraft'), ...ops.filter(o => o?.action === 'indicator.saveDraft')]
  return ops.flatMap(o => {
    if (o?.action !== 'indicator.saveDraft') return [o]
    if (turn && turn.target === o.target && !(explicit && o.target === NEW && o.args?.name == null)) {
      // R1 is not met: the change runs alone; the draft stays ready for "apply it" (no second model
      // call) — its receipt already ends with "Want me to apply it…", so no extra note
      return []
    }
    // a NEW VERSION of a saved indicator updates every chart already showing it — never a second copy there
    let st = null
    try { st = snapshots(host).find(s => s.ref === o.target)?.status || null } catch { st = null }
    if (st?.mode === 'edit' && Array.isArray(o.args?.addTo) && o.args.addTo.length) {
      const has = new Set(showsDefinition(host, st.defId))
      o = { ...o, args: { ...o.args, addTo: o.args.addTo.filter(r => !has.has(asChartRef(r))) } }
    }
    if (!explicit) return [o]                                                   // the card decides
    const nm = o.args?.name
    if (nm != null && !String(words).toLowerCase().includes(String(nm).trim().toLowerCase())) return [o]  // a name they didn't say
    const charts = (o.args?.addTo || []).map(asChartRef)
    if (charts.some(c => !chartNamed(host, c, words))) return [o]               // a chart they didn't name
    return [{ ...o, explicit: true }]
  })
}

// ── what the member is told when the specialist refuses (every reason in §10/§16) ──
export function refusalSentence(res) {
  const r = res && res.reason
  const gate = res?.detail?.gate || ''
  switch (r) {
    case R.ACCESS: return 'Create Indicator isn’t available for your account.'
    case R.DRAFT_EXPIRED: return 'That draft has expired — drafts are kept only in this browser tab. Start a new one and I’ll pick it up from there.'
    case R.DRAFT_STALE: return 'That indicator was saved again elsewhere since this draft was opened, so I won’t change the old draft — reopen it to continue.'
    case R.DRAFT_OPEN_IN_DOCK: return 'That draft is open in Create Indicator — continue there, or close it and ask me again.'
    case R.STALE_REVISION: return 'The draft changed since I planned this, so I didn’t send anything — ask again to work on the current draft.'
    case R.STALE_STEP: return 'The draft changed since that step, so it can’t be undone exactly — nothing was undone.'
    case R.NOTHING_TO_UNDO: return 'There is no change to undo in that draft.'
    case R.NOT_DIRTY: return 'There is nothing new to save in that draft.'
    case R.NEEDS_ACK: return `Saving it needs your acknowledgement first: ${(res?.detail?.ackText || []).map(t => (/[.!?]$/.test(t) ? t : `${t}.`)).join(' ')} Ask me to save it again and approve that.`
    case R.VALIDATION: return `UCT refused to save it — it isn’t valid yet${res?.detail?.error ? `: ${res.detail.error}` : ''}.`
    case R.SAVE_CONFLICT: return `That indicator was saved elsewhere in the meantime${res?.detail?.conflict?.currentVersion ? ` (now version ${res.detail.conflict.currentVersion})` : ''} — nothing was overwritten.`
    case R.SAVE_REFUSED: return `UCT refused to save it${res?.detail?.error ? `: ${res.detail.error}` : ''}.`
    case R.SAVED_UNCONFIRMED: return 'It was sent to the store, but UCT could not read it back, so I am not reporting it as saved. The draft is closed — check your indicators before saving again.'
    case R.NAME_UNCHANGED: return 'It already has that name.'
    case R.NOTHING_TO_RENAME: return 'The draft has nothing to name yet — describe the indicator first.'
    case R.NOTHING_TO_PREVIEW: return 'The draft has nothing to preview yet.'
    case R.PREVIEW_READONLY: return 'That chart can’t show a preview.'
    case R.PREVIEW_BUSY: return 'Create Indicator is open and holds this tab’s preview — close it first.'
    case R.PREVIEW_INVALID: return 'The draft isn’t valid enough to draw yet.'
    case R.UNKNOWN_DEFINITION: return 'I don’t know that indicator on your account.'
    case R.TURN_REFUSED:
      if (/^rate:hour|^http:429/.test(gate)) return 'The indicator builder’s hourly limit is reached — nothing changed. Try again later.'
      if (gate === 'rate:busy') return 'The indicator builder is still working on another request — nothing changed. Try again in a moment.'
      if (gate === 'cost:user') return 'Today’s indicator-builder allowance is used up — nothing changed.'
      if (gate === 'cost:global') return 'The indicator builder is paused for today — nothing changed.'
      if (/^network|^http:/.test(gate)) return 'The indicator builder couldn’t be reached — nothing changed.'
      return `The indicator builder refused that${gate ? ` (${gate})` : ''} — nothing changed.`
    case R.BAD_REQUEST: return 'That isn’t a valid request for the indicator builder.'
    default: return 'That did not work — nothing changed.'
  }
}

const nameOf = (s) => shownName(s?.status?.name, 'the draft')

// ── ⛔ F6 — APPROVAL INTEGRITY. A Save is always proposed, and the proposal's Apply RE-PLANS. What
// the member approved is SEALED when the card is made (`sealSave`, kept by useAgent with the
// proposal — never in a cache that can lapse into a fresh read): the draft's identity and
// revision, the operation and requested name, the target definition, the exact acknowledgement,
// the builder's summary, the charts to add it to, and an expiry. Apply plans FROM the seal and
// refuses (`validateSaveSeal`) unless the draft is still exactly that — before any rename, turn,
// Save or chart add. Nothing is ever rebuilt from the draft as it is now. ──
export const PROPOSAL_TTL_MS = 10 * 60 * 1000
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])
const sortedRefs = (xs) => [...new Set((xs || []).map(asChartRef))].sort()
/** The approval-critical facts of ONE planned Save (the indicatorDrafts plan's after-state). */
export function sealSave(snap, after, now = Date.now()) {
  const op = (after?.ops || []).find(o => o.type === 'save')
  if (!op || !snap?.draftRef || !snap.status) return null
  const turn = after.ops.find(o => o.type === 'turn')
  const s = snap.status
  return Object.freeze({
    action: 'indicator.saveDraft', ref: snap.ref,
    draft: { key: snap.draftRef.key, lineage: snap.draftRef.lineage },
    revision: op.pinRevision, name: op.name, turn: turn ? turn.message : null,
    target: { mode: s.mode, defId: s.defId ?? null, baseVersion: s.baseVersion ?? null },
    addTo: sortedRefs(op.addTo),
    ackShown: op.ackShown.slice(), linesShown: op.linesShown.slice(), nameShown: op.nameShown,
    issuedAt: now, expiresAt: now + PROPOSAL_TTL_MS,
  })
}
const STALE_SAVE = 'so nothing was saved or added to a chart — ask me to save it again and I’ll show you the current version.'
/** null when the draft is still EXACTLY what the member approved; else the refusal sentence. */
export function validateSaveSeal(seal, snap, req, now = Date.now()) {
  if (!seal || seal.action !== 'indicator.saveDraft') return `I can’t check that approval any more, ${STALE_SAVE}`
  if (!(now <= seal.expiresAt)) return `That proposal expired (a proposal is good for 10 minutes), ${STALE_SAVE}`
  const s = snap?.status
  if (!snap?.draftRef || !s || snap.ref !== seal.ref || snap.draftRef.key !== seal.draft.key || snap.draftRef.lineage !== seal.draft.lineage) return `That proposal was for a different draft, ${STALE_SAVE}`
  if (s.revision !== seal.revision) return `The draft changed since you approved it (revision ${seal.revision} → ${s.revision}), ${STALE_SAVE}`
  if (s.mode !== seal.target.mode || (s.defId ?? null) !== seal.target.defId || (s.baseVersion ?? null) !== seal.target.baseVersion) return `The indicator it would save to changed since you approved it, ${STALE_SAVE}`
  if ((req.name ?? null) !== seal.name || (req.turn ?? null) !== seal.turn) return `That isn’t the save you approved, ${STALE_SAVE}`
  if (!sameList(sortedRefs(req.addTo), seal.addTo)) return `The charts it would be added to changed since you approved it, ${STALE_SAVE}`
  if (!sameList(s.ackText, seal.ackShown)) return `The repainting warning changed since you approved it, ${STALE_SAVE}`
  if (!sameList(s.lines || [], seal.linesShown) || (s.name || null) !== seal.nameShown) return `The draft’s summary changed since you approved it, ${STALE_SAVE}`
  return null
}
const sealFor = (env, ref) => (Array.isArray(env?.approval) ? env.approval.find(x => x && x.ref === ref && x.action === 'indicator.saveDraft') : null) || null

// "Save it as Bullish Trend": a rename is trusted ONLY from the specialist's typed marker
// `renameOnly === true` (contract §16.1) — from `renameDraft`, or from `draftTurn`'s local
// name-only path. ⛔ NEVER from `changes` containing 'renamed': a model turn can rename AND change
// the maths while reporting only that (the specialist's own test proves it).
const fail = (msg, extra = {}) => Object.assign(new Error(msg), extra)

// ── target kind: one snapshot per draft in this tab, plus the "new draft" entry ──
function snapshots(host) {
  const ctx = authoringCtx(host)
  const act = readActive()
  const charts = (() => { try { return host?.charts?.list() || [] } catch { return [] } })().map(c => ({
    ref: c.ref, label: c.label,
    canPreview: (() => { try { return host.charts.canManageIndicators?.(c.ref) === true && host.charts.canCreateIndicator?.(c.ref) === true } catch { return false } })(),
    canAdd: (() => { try { return host.charts.canManageIndicators?.(c.ref) === true } catch { return false } })(),
  }))
  const list = (() => { try { return listDrafts(ctx) } catch { return [] } })()
  const out = [{ ref: NEW, label: 'New indicator draft', new: true, charts }]
  for (const st of list) {
    out.push({ ref: refOf(st.draftRef.key), label: st.name ? `Draft “${st.name}”` : 'Untitled draft', draftRef: st.draftRef, status: st,
      active: !!act && act.key === st.draftRef.key && act.lineage === st.draftRef.lineage, charts })
  }
  // the active draft the specialist no longer holds (expired, new tab): kept so it can be SAID
  if (act && !out.some(s => s.draftRef && s.draftRef.key === act.key && s.draftRef.lineage === act.lineage)) {
    const st = draftStatus(act, ctx)
    if (st && st.draftRef) out.push({ ref: refOf(act.key), label: st.name ? `Draft “${st.name}”` : 'Untitled draft', draftRef: st.draftRef, status: st, active: true, charts })
    else out.push({ ref: refOf(act.key), label: 'Your earlier draft', draftRef: act, expired: true, expiredReason: st?.reason || R.DRAFT_EXPIRED, active: true, charts })
  }
  return out
}

export const indicatorDraftsKind = {
  name: 'indicatorDrafts',
  boardScoped: false,        // a draft lives in this tab, not on a board (survives layout switches)
  selfDescribing: true,
  list: (host) => snapshots(host),
  read: (host, ref) => snapshots(host).find(s => s.ref === ref) || null,
  stateOf: (s) => ({ ...s, ops: [] }),
  patch: (before, after) => (after.ops.length ? { ops: after.ops } : null),
  async commit(host, ref, patch) {
    // ── authoring Undo (from the Agent's Undo stack): the exact step, or refused ──
    if (patch.undo) {
      const st0 = draftStatus(patch.undo.draftRef, authoringCtx(host))
      const ctx = authoringCtx(host, originOf(st0))
      const st = st0
      const out = draftUndo(patch.undo.draftRef, { expectedStepId: patch.undo.stepId }, ctx)
      if (!out.ok) throw fail(refusalSentence(out))
      return { lines: [`Undid the last change to ${shownName(st?.name, 'the draft')} (draft — not saved).`, ...(out.lines || [])] }
    }
    const snap = snapshots(host).find(s => s.ref === ref)
    if (!snap) throw fail('that draft is no longer available')
    // ⛔ F6: an approved Save is re-checked against its seal HERE, before the first op runs (a
    // rename turn in the same request included) — the planner's check ran a moment ago, this is the
    // last word before anything is written
    const sealedSave = patch.ops.find(o => o.type === 'save' && o.seal)
    if (sealedSave) {
      const t = patch.ops.find(o => o.type === 'turn')
      const why = validateSaveSeal(sealedSave.seal, snap, { name: sealedSave.name, turn: t ? t.message : null, addTo: sealedSave.addTo })
      if (why) throw fail(why)
    }
    let draftRef = snap.draftRef || null
    let revision = snap.status ? snap.status.revision : null
    let name = snap.status?.name || null
    const lines = []
    let undoData = null
    const followUps = []
    for (const op of patch.ops) {
      if (op.type === 'turn') {
        if (!op.chartRef || !boardCharts(host).some(c => c.ref === op.chartRef)) throw fail('That chart is no longer on the board, so nothing was sent — say which chart this indicator is for.')
        const ctx = authoringCtx(host, op.chartRef)
        const opened = !draftRef
        if (!draftRef) {
          const o = openDraft(op.edit ? { edit: { defId: op.edit }, chartRef: op.chartRef } : { create: true, chartRef: op.chartRef }, ctx)
          if (!o.ok) throw fail(refusalSentence(o))
          draftRef = o.draftRef
          revision = o.status.revision
          name = o.status.name || name
        }
        setActive(draftRef)
        const out = await draftTurn(draftRef, op.message, { expectedRevision: op.pinRevision ?? revision }, ctx)
        if (!out.ok) throw fail(refusalSentence(out), lines.length ? { unreverted: true } : {})
        revision = out.revision
        op.outcome = out.kind
        op.renameOnly = out.ok && out.kind === 'applied' && out.renameOnly === true
        const st = draftStatus(draftRef, authoringCtx(host))
        name = st?.name || name
        if (out.kind === 'applied') {
          // OWNER 2026-10-12: ONE short line (Indicators (d)): what it does + "not saved yet"; the builder's
          // full read-back stays in the context for "how does it work?". Questions / refusals / unavailable
          // parts are never collapsed. A Save riding in this request (R1) answers the "apply it?" itself.
          const rides = patch.ops.some(o => o.type === 'save')
          lines.push(`${opened ? 'Draft ready' : 'Draft updated'} (not saved yet): ${sentence(oneLineOf(st))}.${rides ? '' : ' Want me to apply it or change anything?'}`, ...mustShow(out.lines))
          undoData = { draftRef, stepId: out.stepId }
        } else if (out.kind === 'question') {
          lines.push(...(out.reply ? [out.reply] : []), ...(out.questions || []), 'No change was made to the draft.')
        } else {
          lines.push(...(out.reply ? [out.reply] : out.lines || []), 'No change was made to the draft.')
        }
      } else if (op.type === 'preview') {
        const ctx = authoringCtx(host, op.chartRef)
        const ph = host?.charts?.previewHost?.(op.chartRef) || null
        if (!ph) throw fail('that chart can’t show a preview')
        const out = showDraftPreview(draftRef, { host: ph, chartRef: op.chartRef }, ctx)
        if (!out.ok) throw fail(refusalSentence(out))
        setActive(draftRef)
        // movedFrom is the preview channel's chart id (a widget id); Agent refs are `<id>` / `<id>~<tab>`
        const label = (c) => {
          try {
            const all = host.charts.list() || []
            return (all.find(x => x.ref === c) || all.find(x => String(x.ref).split('~')[0] === c))?.label || 'another chart'
          } catch { return 'another chart' }
        }
        lines.push(`Showing ${shownName(name, 'the draft')} as a preview on ${label(op.chartRef)} — a preview only, not saved${out.movedFrom ? ` (moved from ${label(out.movedFrom)})` : ''}.`)
      } else if (op.type === 'save') {
        const ctx = authoringCtx(host, originOf(draftStatus(draftRef, authoringCtx(host))))
        const st = draftStatus(draftRef, ctx)
        const keep = lines.length ? { unreverted: true } : {}
        const turn = patch.ops.find(o => o.type === 'turn')
        let renamedTo = null
        // a refusal AFTER a rename landed (dock opened, access lost, conflict…) says so plainly
        const notSaved = (m) => (renamedTo || (turn && turn.outcome === 'applied')
          ? fail(`Renamed it to “${renamedTo || (st && st.name) || name || 'the new name'}” (draft — not saved), but didn’t save it: ${m}`, { ...keep, keptNote: 'the draft keeps its new name; nothing was saved' })
          : fail(m, keep))
        if (!st || !st.draftRef) throw notSaved(refusalSentence(st))
        let pin = op.pinRevision
        // ⭐ R1 (Indicators-acked 2026-10-12): "build X and apply it" in ONE message — the save of the NEW
        // draft this message built runs only if every condition holds; otherwise it STOPS at a ready draft
        // (still active: "apply it" next finishes it, no second model call).
        if (turn && op.r1) {
          const why = (() => {
            if (turn.outcome !== 'applied') return 'the builder didn’t build it as asked'
            if (!st || st.revision !== revision) return 'the draft changed while I was working'
            if ((st.questions || []).length) return 'the builder has a question first'
            if ((st.readback?.outputs || []).some(o => o && o.status === 'refused' && !o.pending)) return 'part of it can’t be used this way'
            if ((st.ackText || []).length) return `it needs your acknowledgement first: ${st.ackText.join(' ')}`
            if (st.name && ownNames().includes(String(st.name).trim().toLowerCase())) return `you already have an indicator named “${st.name}”`
            return null
          })()
          if (why) {
            lines.push(`Not saved or applied yet — ${why}. Say “apply it” when you’re ready.`)
            continue
          }
          pin = st.revision
        } else if (turn) {
          // the two-op form ("Name it X" turn, then Save): only the typed rename-only marker counts
          if (turn.outcome !== 'applied') throw fail('The builder didn’t rename it, so I didn’t save it — say the name again, then ask me to save.', keep)
          if (st.revision !== op.pinRevision + 1) throw notSaved(refusalSentence({ reason: R.STALE_REVISION }))
          if (turn.renameOnly !== true) throw notSaved('that wasn’t only a rename — check the draft, then ask me to save it again.')
          pin = st.revision
        } else if (op.name) {
          // "Save it as X": the specialist's own name-only step (no model call), pinned to the approved revision
          const r = renameDraft(draftRef, op.name, { expectedRevision: pin }, ctx)
          if (!r.ok && r.reason !== R.NAME_UNCHANGED) throw fail(`${refusalSentence(r)} Nothing was renamed or saved.`, keep)
          if (r.ok) {
            if (r.renameOnly !== true || r.revision !== pin + 1) throw fail('That wasn’t a rename only, so I didn’t save it — check the draft, then ask me to save it again.', keep)
            renamedTo = (r.rename && r.rename.to) || op.name
            lines.push(`Renamed it to “${renamedTo}” (draft).`)
            pin = r.revision
          }
        }
        const now = renamedTo ? draftStatus(draftRef, ctx) : st
        if (!now || !now.draftRef) throw notSaved(refusalSentence(now))
        // ⛔ acknowledged only if the approval showed EXACTLY the acknowledgement the draft needs now
        const shown = op.ackShown || []
        const ackNow = now === st ? st.ackText : now.ackText
        const acknowledged = !ackNow.length || (ackNow.length === shown.length && ackNow.every((t, i) => t === shown[i]))
        if (!acknowledged) throw notSaved(refusalSentence({ reason: R.NEEDS_ACK, detail: { ackText: ackNow } }))
        const out = await saveDraft(draftRef, { expectedRevision: pin, acknowledged: ackNow.length > 0 }, ctx)
        if (!out.ok) {
          if (out.reason === R.SAVED_UNCONFIRMED) setActive(null)
          throw notSaved(refusalSentence(out))
        }
        setActive(null)
        rememberSaved({ defId: out.defId, version: out.version, name: out.name || name || null })
        // OWNER 2026-10-12: ONE short, honest line (Indicators (c)): saved = permanent; R1 also says WHAT
        // was saved (its line + the builder's assumptions). With chart adds, the add's receipt follows
        // in the same message (useAgent holds this one as its lead).
        const saved = out.name || name || 'the indicator'
        // the builder's own ASSUMPTIONS (Indicators condition 8: "Assumed: 20-bar lookback") — not the
        // engine's presentation defaults
        const assumed = (st.readback?.assumptions || []).filter(a => /^(Assumed|UCT Intelligence assumed)/.test(String(a)))
        const what = op.r1 ? ` — ${sentence(oneLineOf(st))}${assumed.length ? ` (${assumed.join('; ')})` : ''}` : ''
        lines.length = op.r1 ? 0 : lines.length                                // R1: this line replaces the draft line
        lines.push(op.addTo?.length
          ? `Saved to your indicators${what} — that’s permanent; Undo takes it off the chart, the saved indicator stays.`
          : !out.created && showsDefinition(host, out.defId).length
            ? `Updated ${shownName(saved, 'your indicator')} to version ${out.version} — every chart using it shows the change now. That’s permanent (no Undo).`
            : `Saved ${shownName(saved, 'it')} to your indicators${what} — permanent. It isn’t on a chart yet; say “apply it” to add it.`)
        // the specialist's own outcomes that matter (never its chart outcome — Save attaches no chart, §16)
        const chartTexts = new Set((out.outcomes || []).filter(o => o && o.kind === 'chart').map(o => o.text))
        for (const t of (out.outcomes || []).map(o => o && o.text)) {
          if (t && !chartTexts.has(t) && !lines.includes(t) && /warning|limit|not|can’t|cannot/i.test(t)) lines.push(t)
        }
        for (const c of op.addTo || []) followUps.push({ action: 'indicator.add', target: `ixe:${c}`, args: { defId: out.defId, inputs: null }, awaitDefinition: { defId: out.defId, version: out.version, name: out.name || name || null } })
        undoData = null
      }
    }
    return { lines, ...(undoData ? { undoData } : {}), ...(followUps.length ? { followUps } : {}) }
  },
  landed: () => true,
  // ⛔ F6: what an approval of this plan binds to (useAgent keeps it with the proposal card)
  seal: (p) => sealSave(p.snap, p.after),
  // Authoring Undo = the specialist's exact step (stepId); a Save has none (D7); advice/questions none.
  undoPatch: (item) => (item.undoData ? { undo: item.undoData } : null),
  // staleness is the specialist's (expectedRevision / expectedStepId at call time)
  fingerprint: (s) => (s ? s.ref : 'gone'),     // a saved draft is gone (read → null)
}

const common = { target: 'indicatorDrafts', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts' && ctx.createIndicator === true }
function usable(st) {
  if (st.expired) return refusalSentence({ reason: st.expiredReason || R.DRAFT_EXPIRED })
  if (st.status?.openInDock) return refusalSentence({ reason: R.DRAFT_OPEN_IN_DOCK })
  return null
}
const has = (st, type) => st.ops.some(o => o.type === type)

let registered = false
export function registerIndicatorAuthoringCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(indicatorDraftsKind)
  registerContextProvider({
    key: 'indicatorDrafts',
    // every item publishes its `ref` (the server accepts only published refs as targets)
    build: (host, refFor) => {
      const list = indicatorDraftsKind.list(host)
      let own = []
      try { own = (sources.rows() || []).slice(0, 50).map(r => ({ defId: r.def_id, name: r.definition?.meta?.name || null })) } catch { own = [] }
      const last = lastSaved()
      const chartLabel = (r) => (s0) => (s0.charts || []).find(c => c.ref === r)?.label || null
      return list.map(s => (s.new ? { ref: refFor('indicatorDrafts', s.ref), new: true, label: 'start a NEW indicator draft (or edit one of yourIndicators)', yourIndicators: own, ...(last ? { lastSaved: last } : {}) }
        : { ref: refFor('indicatorDrafts', s.ref), name: s.status?.name || null, mode: s.status?.mode || null, active: !!s.active,
          chart: originOf(s.status) ? chartLabel(originOf(s.status))(s) || 'not on this board' : null,
          ...(s.expired ? { expired: true } : {
            revision: s.status.revision, dirty: s.status.dirty, canSave: s.status.canSave, canUndo: s.status.canUndo,
            needsAcknowledgement: s.status.ackText.length > 0, openQuestions: s.status.questions, openInCreateIndicator: s.status.openInDock,
            summary: (s.status.lines || []).slice(0, 6),
          }) }))
    },
    compact: (sec) => (sec || []).map(e => ({ ref: e.ref, name: e.name || null, new: e.new || undefined, active: e.active || undefined })),
  })

  registerCapability({
    ...common,
    name: 'indicator.draft',
    exclusive: true,
    exclusiveReason: 'Work on one indicator draft at a time, on its own — ask for anything else separately.',
    summary: 'THE DEFAULT for building a custom indicator: build it WITH the member right here in this chat ("build/make me an indicator that…", "also require RSI above 50", "what would you add?") — one draft, through Create Indicator\'s own engine. Questions and advice change nothing. Never saves (indicator.saveDraft does).',
    hints: 'target = the ACTIVE draft\'s ref to continue it (follow-ups like "also…", "make it…", "what would you add?" go to the active draft); the NEW-draft entry only when the member starts a different indicator or edits one of yourIndicators (edit = its defId, else null). With an active draft, "this indicator" / "the indicator" / "it" means that draft — do not ask which. If several drafts could be meant and none is active or named, ask which. chart = the ref of the chart the member names for it, else null (a draft keeps its own chart). message = the member\'s words, verbatim — never your own formula or interpretation. NEVER add indicator.previewDraft unless the member asked in this message to see/preview it.',
    argRefs: { chart: ['chart', 'indicators', 'indicatorEdits'] },
    args: { type: 'object', properties: { message: { type: 'string' }, chart: { type: ['string', 'null'] }, edit: { type: ['string', 'null'] } }, required: ['message', 'chart', 'edit'], additionalProperties: false },
    check(st, { message, chart, edit }) {
      if (!String(message || '').trim()) return 'Say what the indicator should do.'
      if (!st.new) { const u = usable(st); if (u) return u }
      if (edit != null) {
        if (!st.new) return 'To edit one of your saved indicators, start from the new-draft entry.'
        let own = []
        try { own = (sources.rows() || []).map(r => r && r.def_id) } catch { own = [] }
        if (!own.includes(edit)) return refusalSentence({ reason: R.UNKNOWN_DEFINITION })
      }
      const c = chartForDraft(st, chart ?? null)
      if (c.ask) return c.ask
      if (has(st, 'turn')) return 'One message to the indicator builder at a time.'
      if (has(st, 'save') || has(st, 'preview')) return 'Ask for the change first, then preview or save it.'
      return null
    },
    apply(st, { message, chart, edit }) {
      const c = chartForDraft(st, chart ?? null)
      return { ...st, ops: [...st.ops, { type: 'turn', message: String(message).trim(), chartRef: c.ref, edit: edit || null, pinRevision: st.status ? st.status.revision : null }] }
    },
    describe: (b, a) => {
      const op = a.ops.find(o => o.type === 'turn')
      const where = (b.charts || []).find(c => c.ref === op?.chartRef)?.label
      return op ? `Ask the indicator builder${b.new ? (op.edit ? ' (editing your saved indicator)' : ' (new draft)') : ` about ${nameOf(b)}`}${where ? ` on ${where}` : ''}: “${op.message}”` : null
    },
  })

  registerCapability({
    ...common,
    name: 'indicator.previewDraft',
    undo: 'none',
    exclusive: true,
    exclusiveReason: 'Show the preview on its own — ask for anything else separately.',
    argRefs: { chart: ['chart', 'indicators', 'indicatorEdits'] },
    summary: 'Show an indicator draft as this tab\'s ONE live preview on a chart (not saved; moves off any other chart). Only when the member asks to see it.',
    hints: 'target = the draft\'s ref (usually the active one). chart = the ref of the chart to preview on — the one the member names, or the only chart; if several charts and none named, ask which. Never preview unasked.',
    args: { type: 'object', properties: { chart: { type: 'string' } }, required: ['chart'], additionalProperties: false },
    check(st, { chart }) {
      if (st.new) return 'There is no draft to preview yet — describe the indicator first.'
      const u = usable(st); if (u) return u
      const c = st.charts.find(x => x.ref === asChartRef(chart))
      if (!c) return 'Which chart should I show the preview on?'
      if (!c.canPreview) return `${c.label} can’t show a preview.`
      if (st.ops.length) return 'Show the preview on its own.'
      return null
    },
    apply: (st, { chart }) => ({ ...st, ops: [{ type: 'preview', chartRef: asChartRef(chart) }] }),
    describe: (b, a) => {
      const op = a.ops[0]
      const c = b.charts.find(x => x.ref === op?.chartRef)
      return op ? `Show ${nameOf(b)} as a preview on ${c ? c.label : 'the chart'} (not saved)` : null
    },
  })

  registerCapability({
    ...common,
    name: 'indicator.saveDraft',
    risk: 'confirm',             // always proposed: the member approves the exact draft and revision
    undo: 'none',                // a saved version is permanent history (D7)
    reversible: false,
    exclusive: true,
    exclusiveReason: 'Save the indicator on its own — ask for anything else separately.',
    argRefs: { addTo: ['chart', 'indicators', 'indicatorEdits'] },
    // ⛔ F2b: "save it / save this / save it as X" with the SELECTED draft usable = that draft (a proposal)
    fast: ({ raw, host }) => {
      // OWNER 2026-10-12: these phrases ARE the member's own words asking → explicit (policy.js)
      const r = saveReferent(host, raw)
      if (r && r.kind === 'draft') return { addTo: [], name: r.name, __target: r.target, __explicit: true }
      // "Apply it." / "add it to my chart" with the ACTIVE draft: the board's one chart, or the chart
      // the member clicked (still valid); with several and none clicked → the model (which may ask)
      if (!APPLY_IT_WHOLE.test(String(raw || '').trim())) return null
      let active = null
      try { active = snapshots(host).find(x => x.active && !x.new && !x.expired) || null } catch { active = null }
      if (!active) return null
      const charts = boardCharts(host)
      // a NEW VERSION of a saved indicator a chart already shows updates it there — never a second copy
      if (active.status?.mode === 'edit' && showsDefinition(host, active.status.defId).length) return { addTo: [], name: null, __target: active.ref, __explicit: true }
      const chart = charts.length === 1 ? charts[0].ref : (charts.some(c => c.ref === clickedChart(host)) ? clickedChart(host) : null)
      return chart ? { addTo: [chart], name: null, __target: active.ref, __explicit: true } : null
    },
    // OWNER 2026-10-12 (+ Indicators' conditions): an explicit save/apply runs without a card…
    explicitOk: true,
    // …except when this draft needs the member's eyes: an acknowledgement of ANY kind (shown verbatim),
    // a NEW VERSION of a saved indicator (it changes every chart, layout and armed alert using it), or
    // a new indicator under a name they already have.
    confirmIf(st, { name }) {
      if (st.new || !st.status) return false
      if ((st.status.ackText || []).length) return true
      if (st.status.mode === 'edit') return true
      const nm = String(name || st.status.name || '').trim().toLowerCase()
      return !!nm && ownNames().includes(nm)
    },
    summary: 'Save an indicator draft as one of the member\'s indicators (Create Indicator\'s own Save; a new indicator, or a new version of the one being edited) — always shown as a proposal with the builder\'s own summary first. addTo: charts to add the SAVED indicator to afterwards (each added separately, with its own receipt).',
    hints: 'Use when the member saves THE INDICATOR: "save it", "save it as X", "save the indicator/draft" while an indicator draft is active (the active indicatorDrafts entry) — that "it" is the draft, NOT the workspace layout (layout.saveAs is only for an explicit layout/workspace/board). target = the draft\'s ref (usually the active one). name = the name the member gave ("save it as Bullish Trend" → "Bullish Trend"), else null — never a separate indicator.draft op for the name. addTo = [] UNLESS the member asked in this message to add/apply/put it on a chart; then only the charts\' refs from the charts section that they named. Saving and adding to a chart are separate intents. "Save the indicator" with one active draft is that draft — do not ask which.',
    args: { type: 'object', properties: { addTo: { type: 'array', items: { type: 'string' } }, name: { type: ['string', 'null'] } }, required: ['addTo', 'name'], additionalProperties: false },
    check(st, { addTo, name }, env) {
      // ⭐ R1 (Indicators-acked 2026-10-12): the NEW draft this message builds, when the member's own words
      // asked to apply/save it (env.explicit — markExplicitSaves). Its conditions are checked after the
      // build (commit); a failing one stops at a ready draft.
      const r1 = st.new && env?.explicit === true && has(st, 'turn') && name == null
      if (st.new && !r1) return 'There is no draft to save yet — describe the indicator first.'
      if (name != null && (typeof name !== 'string' || !name.trim() || name.length > 120)) return 'Say the name to save it as.'
      if (name != null && has(st, 'turn')) return 'Name it in the save itself, not as a separate change.'
      // ⛔ renameDraft is the ONLY rename path: a draft turn (which can reach the model) never rides
      // inside a Save — change the draft first, or name it with "save it as …" (R1 above aside)
      if (has(st, 'turn') && !r1) return 'Change the draft first, then ask me to save it — or say “save it as …” to name it as you save.'
      if (!r1) { const u = usable(st); if (u) return u }
      if (has(st, 'save')) return 'One save at a time.'
      if (!r1 && !has(st, 'turn') && !st.status.canSave) return refusalSentence({ reason: R.NOT_DIRTY })
      for (const r of addTo || []) {
        const c = (st.charts || []).find(x => x.ref === asChartRef(r))
        if (!c) return 'That isn’t a chart on this board, so nothing was saved or added — name the chart (or just say “save it”).'
        if (!c.canAdd) return `Indicators on ${c.label} can’t be changed from here.`
      }
      // ⛔ F6: an APPROVAL is only of what the card showed — checked before anything is planned
      if (env?.approved) {
        const turn = st.ops.find(o => o.type === 'turn')
        const nm = typeof name === 'string' && name.trim() ? name.trim() : null
        return validateSaveSeal(sealFor(env, st.ref), st, { name: nm, turn: turn ? turn.message : null, addTo })
      }
      return null
    },
    apply(st, { addTo, name }, env) {
      const add = [...new Set((addTo || []).map(asChartRef))]
      const nm = typeof name === 'string' && name.trim() ? name.trim() : null
      // approved: EXACTLY the sealed values (check() proved the draft still matches them);
      // proposing: the draft as it is now, which is what the card will show and the seal will keep
      // R1: the new draft does not exist yet — its revision is the one the build produces (commit)
      if (st.new) return { ...st, ops: [...st.ops, { type: 'save', addTo: add, name: null, pinRevision: null, ackShown: [], linesShown: [], nameShown: null, r1: true }] }
      const seal = env?.approved ? sealFor(env, st.ref) : null
      const s = st.status
      const pin = seal
        ? { revision: seal.revision, ackShown: seal.ackShown.slice(), lines: seal.linesShown.slice(), name: seal.nameShown }
        : { revision: s.revision, ackShown: s.ackText.slice(), lines: (s.lines || []).slice(), name: s.name || null }
      // a rename in the same request is pinned to the revision the member saw, too
      const ops = st.ops.map(o => (o.type === 'turn' ? { ...o, pinRevision: pin.revision } : o))
      return { ...st, ops: [...ops, { type: 'save', addTo: add, name: nm, pinRevision: pin.revision, ackShown: pin.ackShown, linesShown: pin.lines, nameShown: pin.name, ...(seal ? { seal } : {}) }] }
    },
    // OWNER 2026-10-12: the card (when one is still needed) is SHORT — what is saved and where, plus any
    // acknowledgement verbatim (Indicators (b)); the builder's full read-back is no longer pasted in.
    describe: (b, a) => {
      const op = a.ops.find(o => o.type === 'save')
      if (!op) return null
      const where = op.addTo.length ? ` and add it to ${op.addTo.map(r => (b.charts || []).find(c => c.ref === r)?.label || r).join(', ')}` : ''
      if (op.r1) return `Save it as a new indicator${where}`
      const s = b.status
      const nm = op.name ? `“${op.name}”` : nameOf(b)
      const ack = op.ackShown.length ? ` · You are also acknowledging: ${op.ackShown.join(' ')}` : ''
      if (s.mode === 'edit') return `This updates ${op.name ? nm : shownName(s.name, 'your saved indicator')} everywhere it’s used — save version ${Number.isInteger(s.baseVersion) ? s.baseVersion + 1 : 'new'}${where}${ack}`
      return `Save ${nm} as a new indicator${where}${ack}`
    },
  })

  registerCapability({
    ...common,
    name: 'indicator.undoDraft',
    undo: 'none',
    exclusive: true,
    summary: 'Undo the last change in an indicator draft, exactly, when there is nothing of mine to Undo (e.g. after a reload). Never touches a chart or a saved indicator.',
    hints: 'target = the draft\'s ref. Only for "undo the last change to my draft" when the normal Undo has nothing.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    check(st) {
      if (st.new) return 'There is no draft to undo.'
      const u = usable(st); if (u) return u
      if (!st.status.canUndo || !st.status.undoStepId) return refusalSentence({ reason: R.NOTHING_TO_UNDO })
      return null
    },
    apply: (st) => ({ ...st, ops: [{ type: 'undoStep', stepId: st.status.undoStepId }] }),
    describe: (b) => `Undo the last change to ${nameOf(b)}`,
  })
}

// `undoStep` (indicator.undoDraft) is the same exact Undo as the stack's: route it through commit.
const _commit = indicatorDraftsKind.commit
indicatorDraftsKind.commit = async function commit(host, ref, patch) {
  const step = patch?.ops?.find?.(o => o.type === 'undoStep')
  if (step) {
    const snap = snapshots(host).find(s => s.ref === ref)
    if (!snap?.draftRef) throw fail('that draft is no longer available')
    const res = await _commit.call(this, host, ref, { undo: { draftRef: snap.draftRef, stepId: step.stepId } })
    setActive(snap.draftRef)
    return res
  }
  return _commit.call(this, host, ref, patch)
}

export { AUTHORING_CONTRACT }
