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
  saveDraft, showDraftPreview,
} from '../../components/chart/builder/agentAuthoring'

const NEW = 'draft:new'
const refOf = (key) => `draft:${key}`

// ── fresh sources (useAgent hands them in; read at EVERY call) ──
// `extra` is for tests only (the specialist's injectable `converse` / `store` / `readBack`).
let sources = { access: () => false, rows: () => [], extra: null }
export function setAuthoringSources(s) { sources = { ...sources, ...(s || {}) } }

/** The context for ONE specialist call, built now: access, own rows, the chart's symbol/tf. */
export function authoringCtx(host, chartRef = null) {
  const charts = (() => { try { return host?.charts?.list() || [] } catch { return [] } })()
  const c = (chartRef && charts.find(x => x.ref === chartRef)) || charts[0] || null
  let rows = []
  try { rows = [...(sources.rows() || [])] } catch { rows = [] }
  let canAuthor = false
  try { canAuthor = sources.access() === true } catch { canAuthor = false }
  return { canAuthor, definitionRows: rows, sym: c?.symbol || null, tf: c?.tf || null, ...(sources.extra || {}) }
}

// ── the ACTIVE draft of this Agent conversation: the opaque draftRef, as the specialist returned it ──
const ACTIVE_KEY = 'uct.agent.activeDraft'
let active = null
const readActive = () => {
  if (active) return active
  try { const v = globalThis.localStorage?.getItem(ACTIVE_KEY); active = v ? JSON.parse(v) : null } catch { active = null }
  return active
}
function setActive(draftRef) {
  active = draftRef || null
  try {
    if (active) globalThis.localStorage?.setItem(ACTIVE_KEY, JSON.stringify(active))
    else globalThis.localStorage?.removeItem(ACTIVE_KEY)
  } catch { /* storage is a convenience: the specialist is the authority */ }
}
export function _resetAuthoring() { active = null; pinned.clear(); try { globalThis.localStorage?.removeItem(ACTIVE_KEY) } catch { /* */ } }

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

const nameOf = (s) => (s?.status?.name ? `“${s.status.name}”` : 'the draft')

// ── proposal-time pins: a Save is always proposed, and the proposal's Apply RE-PLANS. The pins
// (revision, acknowledgement, the builder's summary) must be the ones the member SAW, so the first
// plan of a Save request keeps them, briefly, per draft + request; Apply uses them, and the
// specialist refuses (`stale-revision`) if the draft moved since. Dropped once the Save runs. ──
const PIN_TTL_MS = 10 * 60 * 1000
const pinned = new Map()
const pinKey = (st, req) => `${st.draftRef.key}|${st.draftRef.lineage}|${JSON.stringify(req)}`
function pinFor(st, req) {
  const key = pinKey(st, req)
  const hit = pinned.get(key)
  if (hit && Date.now() - hit.at < PIN_TTL_MS) return { key, ...hit }
  const p = { revision: st.status.revision, ackShown: st.status.ackText.slice(), lines: (st.status.lines || []).slice(), outputs: mathsOf(st.status), name: st.status.name || null, at: Date.now() }
  pinned.set(key, p)
  return { key, ...p }
}
export function _resetSavePins() { pinned.clear() }

// "Save it as Bullish Trend": the rename turn may change ONLY names. Judged from the builder's
// own documented readback (never the tree): every output's key, type, maths-in-words and repaint
// mode identical, and the summary lines identical once every name — the indicator's and each
// output's (a rename can re-derive an output's label) — is blanked out.
const mathsOf = (status) => ((status && status.readback && status.readback.outputs) || [])
  .map(o => ({ key: o.key, type: o.type || null, sentence: o.sentence || null, mode: o.mode || null, name: o.name || null }))
function sameButName(before, st) {
  const after = mathsOf(st)
  const was = before.outputs || []
  const strip = (o) => JSON.stringify({ ...o, name: null })
  if (was.length !== after.length || was.some((o, i) => strip(o) !== strip(after[i]))) return false
  const names = [before.name, st.name, ...was.map(o => o.name), ...after.map(o => o.name)]
    .filter(Boolean).sort((x, y) => y.length - x.length)
  const blank = (l) => names.reduce((s, n) => s.split(n).join('⁣'), String(l))
  const a = before.lines || []
  const b = st.lines || []
  return a.length === b.length && a.every((l, i) => blank(l) === blank(b[i]))
}
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
      const ctx = authoringCtx(host)
      const st = draftStatus(patch.undo.draftRef, ctx)
      const out = draftUndo(patch.undo.draftRef, { expectedStepId: patch.undo.stepId }, ctx)
      if (!out.ok) throw fail(refusalSentence(out))
      return { lines: [`Undid the last change to ${st?.name ? `“${st.name}”` : 'the draft'} (draft — not saved).`, ...(out.lines || [])] }
    }
    const snap = snapshots(host).find(s => s.ref === ref)
    if (!snap) throw fail('that draft is no longer available')
    let draftRef = snap.draftRef || null
    let revision = snap.status ? snap.status.revision : null
    let name = snap.status?.name || null
    const lines = []
    let undoData = null
    const followUps = []
    for (const op of patch.ops) {
      if (op.type === 'turn') {
        const ctx = authoringCtx(host, op.chartRef || null)
        if (!draftRef) {
          const o = openDraft({ create: true, ...(op.chartRef ? { chartRef: op.chartRef } : {}) }, ctx)
          if (!o.ok) throw fail(refusalSentence(o))
          draftRef = o.draftRef
          revision = o.status.revision
        }
        setActive(draftRef)
        const out = await draftTurn(draftRef, op.message, { expectedRevision: op.pinRevision ?? revision }, ctx)
        if (!out.ok) throw fail(refusalSentence(out), lines.length ? { unreverted: true } : {})
        revision = out.revision
        op.outcome = out.kind
        const st = draftStatus(draftRef, authoringCtx(host))
        name = st?.name || name
        if (out.kind === 'applied') {
          lines.push(`Updated ${name ? `“${name}”` : 'the draft'} (draft — not saved).`, ...(out.lines || []))
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
        lines.push(`Showing ${name ? `“${name}”` : 'the draft'} as a preview on ${label(op.chartRef)} — a preview only, not saved${out.movedFrom ? ` (moved from ${label(out.movedFrom)})` : ''}.`)
      } else if (op.type === 'save') {
        pinned.delete(op.pinKey)        // used once: a new ask is a new proposal
        const ctx = authoringCtx(host)
        const st = draftStatus(draftRef, ctx)
        const keep = lines.length ? { unreverted: true } : {}
        // "Save it as …": the approved rename must have APPLIED, as exactly one step on the approved
        // revision, and changed nothing but the name — else the draft is renamed and NOT saved.
        const turn = patch.ops.find(o => o.type === 'turn')
        // a refusal AFTER the rename landed (dock opened, access lost, conflict…) says so plainly
        const notSaved = (m) => (turn && turn.outcome === 'applied'
          ? fail(`Renamed it to “${(st && st.name) || name || 'the new name'}” (draft — not saved), but didn’t save it: ${m}`, keep)
          : fail(m, keep))
        if (!st || !st.draftRef) throw notSaved(refusalSentence(st))
        let pin = op.pinRevision
        if (turn) {
          if (turn.outcome !== 'applied') throw fail('The builder didn’t rename it, so I didn’t save it — say the name again, then ask me to save.', keep)
          if (st.revision !== op.pinRevision + 1) throw notSaved(refusalSentence({ reason: R.STALE_REVISION }))
          if (!sameButName({ lines: op.linesShown, outputs: op.outputsShown, name: op.nameShown }, st)) {
            throw notSaved('the builder changed more than the name — check the draft, then ask me to save it again.')
          }
          pin = st.revision
        }
        // ⛔ acknowledged only if the approval showed EXACTLY the acknowledgement the draft needs now
        const shown = op.ackShown || []
        const acknowledged = !st.ackText.length || (st.ackText.length === shown.length && st.ackText.every((t, i) => t === shown[i]))
        if (!acknowledged) throw notSaved(refusalSentence({ reason: R.NEEDS_ACK, detail: { ackText: st.ackText } }))
        const out = await saveDraft(draftRef, { expectedRevision: pin, acknowledged: st.ackText.length > 0 }, ctx)
        if (!out.ok) {
          if (out.reason === R.SAVED_UNCONFIRMED) setActive(null)
          throw notSaved(refusalSentence(out))
        }
        setActive(null)
        lines.push(`Saved “${out.name || name || 'the indicator'}” (version ${out.version}${out.created ? ', a new indicator' : ''}) — confirmed by reading it back from your saved indicators.`)
        // the specialist's own receipt + outcomes, once each — but NOT its chart outcome: Save never
        // attaches a chart here (§16), so "no chart is open here" would contradict the adds below
        const chartTexts = new Set((out.outcomes || []).filter(o => o && o.kind === 'chart').map(o => o.text))
        for (const t of [...(out.receipt?.items || []), ...(out.outcomes || []).map(o => o && o.text)]) {
          if (t && !chartTexts.has(t) && !lines.includes(t)) lines.push(t)
        }
        if (!op.addTo?.length) lines.push('It is not on a chart — ask me to add it to one.')
        for (const c of op.addTo || []) followUps.push({ action: 'indicator.add', target: `ixe:${c}`, args: { defId: out.defId }, awaitDefinition: { defId: out.defId, version: out.version } })
        if (op.addTo?.length) lines.push(`Next: adding it to ${op.addTo.length === 1 ? 'the chart' : `${op.addTo.length} charts`} — each gets its own receipt.`)
        undoData = null
      }
    }
    return { lines, ...(undoData ? { undoData } : {}), ...(followUps.length ? { followUps } : {}) }
  },
  landed: () => true,
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
      return list.map(s => (s.new ? { ref: refFor('indicatorDrafts', s.ref), new: true, label: 'start a NEW indicator draft' }
        : { ref: refFor('indicatorDrafts', s.ref), name: s.status?.name || null, mode: s.status?.mode || null, active: !!s.active,
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
    summary: 'Talk to the indicator builder (Create Indicator\'s engine) about ONE indicator draft: start a new one, ask for advice, answer its questions, or change it ("highlight candles when the 9 EMA is above the 20 EMA", "also require RSI above 50", "what would you recommend adding?"). The builder decides what the turn is; questions and advice change nothing. Never saves.',
    hints: 'target = the ACTIVE draft\'s ref to continue it (follow-ups like "also…", "make it…", "what would you add?" go to the active draft); the NEW-draft entry only when the member starts a different indicator. If several drafts could be meant and none is active or named, ask which. message = the member\'s words, verbatim — never your own formula or interpretation.',
    args: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false },
    check(st, { message }) {
      if (!String(message || '').trim()) return 'Say what the indicator should do.'
      if (!st.new) { const u = usable(st); if (u) return u }
      if (has(st, 'turn')) return 'One message to the indicator builder at a time.'
      if (has(st, 'save') || has(st, 'preview')) return 'Ask for the change first, then preview or save it.'
      return null
    },
    apply(st, { message }) {
      return { ...st, ops: [...st.ops, { type: 'turn', message: String(message).trim(), pinRevision: st.status ? st.status.revision : null }] }
    },
    describe: (b, a) => {
      const op = a.ops.find(o => o.type === 'turn')
      return op ? `Ask the indicator builder${b.new ? ' (new draft)' : ` about ${nameOf(b)}`}: “${op.message}”` : null
    },
  })

  registerCapability({
    ...common,
    name: 'indicator.previewDraft',
    undo: 'none',
    exclusive: true,
    exclusiveReason: 'Show the preview on its own — ask for anything else separately.',
    argRefs: { chart: 'chart' },
    summary: 'Show an indicator draft as this tab\'s ONE live preview on a chart (not saved; moves off any other chart). Only when the member asks to see it.',
    hints: 'target = the draft\'s ref (usually the active one). chart = the ref of the chart to preview on — the one the member names, or the only chart; if several charts and none named, ask which. Never preview unasked.',
    args: { type: 'object', properties: { chart: { type: 'string' } }, required: ['chart'], additionalProperties: false },
    check(st, { chart }) {
      if (st.new) return 'There is no draft to preview yet — describe the indicator first.'
      const u = usable(st); if (u) return u
      const c = st.charts.find(x => x.ref === chart)
      if (!c) return 'Which chart should I show the preview on?'
      if (!c.canPreview) return `${c.label} can’t show a preview.`
      if (st.ops.length) return 'Show the preview on its own.'
      return null
    },
    apply: (st, { chart }) => ({ ...st, ops: [{ type: 'preview', chartRef: chart }] }),
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
    argRefs: { addTo: 'chart' },
    summary: 'Save an indicator draft as one of the member\'s indicators (Create Indicator\'s own Save; a new indicator, or a new version of the one being edited) — always shown as a proposal with the builder\'s own summary first. addTo: charts to add the SAVED indicator to afterwards (each added separately, with its own receipt).',
    hints: 'target = the draft\'s ref (usually the active one). addTo = refs of the charts to add it to after it is saved ([] for none) — only charts the member asked for. To name it ("save it as Bullish Trend"), put an indicator.draft op "Name it Bullish Trend" on the SAME draft before this op.',
    args: { type: 'object', properties: { addTo: { type: 'array', items: { type: 'string' } } }, required: ['addTo'], additionalProperties: false },
    check(st, { addTo }) {
      if (st.new) return 'There is no draft to save yet — describe the indicator first.'
      const u = usable(st); if (u) return u
      if (has(st, 'save')) return 'One save at a time.'
      if (!has(st, 'turn') && !st.status.canSave) return refusalSentence({ reason: R.NOT_DIRTY })
      for (const r of addTo || []) {
        const c = st.charts.find(x => x.ref === r)
        if (!c) return 'Which chart should I add it to?'
        if (!c.canAdd) return `Indicators on ${c.label} can’t be changed from here.`
      }
      return null
    },
    apply(st, { addTo }) {
      const add = [...new Set(addTo || [])]
      const turn = st.ops.find(o => o.type === 'turn')
      const p = pinFor(st, { addTo: add, turn: turn ? turn.message : null })
      // a rename in the same request is pinned to the revision the member saw, too
      const ops = st.ops.map(o => (o.type === 'turn' ? { ...o, pinRevision: p.revision } : o))
      return { ...st, ops: [...ops, { type: 'save', addTo: add, pinKey: p.key, pinRevision: p.revision, ackShown: p.ackShown, linesShown: p.lines, outputsShown: p.outputs, nameShown: p.name }] }
    },
    describe: (b, a) => {
      const op = a.ops.find(o => o.type === 'save')
      if (!op) return null
      const s = b.status
      const turn = a.ops.find(o => o.type === 'turn')
      const what = s.mode === 'edit' ? `a new version of ${nameOf(b)}` : `${nameOf(b)} as a new indicator`
      const after = op.addTo.length ? ` — then add it to ${op.addTo.map(r => b.charts.find(c => c.ref === r)?.label || r).join(', ')}, each separately` : ''
      const summary = op.linesShown.length ? ` · The builder's summary: ${op.linesShown.join(' / ')}` : ''
      const ack = op.ackShown.length ? ` · You are also acknowledging: ${op.ackShown.join(' ')}` : ''
      return `Save ${what} (draft revision ${op.pinRevision}${turn ? ', after that rename only' : ''})${after}${summary}${ack}`
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
