// ── NL-1: MODEL-FIRST INTERPRETATION (behind a flag that is OFF by default) ───────────────────
//
// With NL-1 on, the member's words are interpreted by the model: no instant phrase matching, no
// regex routing, no keyword-gated context. Code keeps everything that is about SAFETY, not meaning:
// the registry re-validation, argument resolution against live state, the planner, the approval
// policy, the product writers, readback receipts, stale-state checks and Undo — unchanged.
//
// What stays instant (owner decision 2026-10-16): EXACT Undo, Confirm and Cancel, and only when
// there is something for them to act on (exactLane). Everything else is the model's reading.
//
// Flag: localStorage `uct.agent.nl1 = '1'` (this browser) AND the server's UCT_AGENT_NL1=1. With
// either off, the request is the legacy request and the server treats it as one.
//
// This module builds the NL-1 request. The SAME function is used by the panel (useAgent) and by the
// eval capture (eval/capture.js), so what is measured is what would be sent.

import { buildContext, manifestFor, getCapability, isRef, MANIFEST_VERSION } from '../capabilities'
import { planOps, collectTargets } from '../executor'

export const NL1_KEY = 'uct.agent.nl1'
export const INTERPRETER = 'nl1'

export function nl1Enabled() {
  try { return globalThis.localStorage?.getItem(NL1_KEY) === '1' } catch { return false }
}

// ── the exact lane ────────────────────────────────────────────────────────────
// Whole-message matches only, after trimming case, spaces and end punctuation. No synonyms, no
// fillers, no typo tolerance: anything else is the model's to read. Each acts only when there is
// something to act on (the caller checks: a proposal to confirm, something pending to cancel).
const EXACT = {
  undo: new Set(['undo', 'undo that', 'undo it', 'undo the last change']),
  confirm: new Set(['confirm', 'do it', 'apply', 'apply it', 'yes', 'yes do it', 'go ahead']),
  dismiss: new Set(['cancel', 'cancel it', 'cancel that', 'never mind', 'nevermind']),
}
const norm = (s) => String(s || '').toLowerCase().replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').trim()

/** { kind: 'undo' | 'confirm' | 'dismiss' } for an exact control message, else null. */
export function exactLane(text) {
  const t = norm(text)
  for (const [kind, words] of Object.entries(EXACT)) if (words.has(t)) return { kind }
  return null
}

const MAX_ARGS_CHARS = 300

/**
 * The NL-1 /api/agent/turn body (without conversationId / voice, which the panel adds).
 *   memory   the session memory (agent/memory.js); its last change is sent WITH its targets and
 *            arguments, so "make it 15 minutes instead" can be read as a correction of it
 *   pendingQuestion  { text, choices: [{ label, ref? }] } — a question UCT asked and is waiting on;
 *            a TYPED answer is read by the model with the question in front of it
 *   pendingProposal  { ops } with real refs, as the legacy request sends it
 * Returns { body, refMap }.
 */
export function buildNl1Request({ host, text, capCtx = {}, manageIndicators = false, memory = null, epoch = null,
  pendingQuestion = null, pendingProposal = null, isProtectedLayout = null }) {
  const manifest = manifestFor({ ...capCtx, manageIndicators })
  // context: every provider, never gated on the member's words (`nl1: true`; a provider that would
  // send its detail only for certain words sends it — compacted by the budget — instead)
  const { context, refMap } = buildContext(host, { ...capCtx, message: text, nl1: true })
  const back = Object.fromEntries(Object.entries(refMap).map(([k, v]) => [v.ref, k]))
  const ctx = { ...context }
  // PROTECTED layouts (no rename / delete / overwrite) are marked for the model, so it explains instead of
  // planning what the protection refuses (proxy smoke, 2026-10-16). The check is the guard's own, passed in by
  // the caller: only useAgent imports protectedLayouts (release audit); enforcement at execution is unchanged.
  if (typeof isProtectedLayout === 'function' && Array.isArray(ctx.layouts) && Array.isArray(ctx.layouts[0]?.layouts)) {
    ctx.layouts = [{ ...ctx.layouts[0], layouts: ctx.layouts[0].layouts.map(e => {
      let p = false
      try { p = isProtectedLayout(e) === true } catch { p = false }
      return p ? { ...e, protected: true } : e
    }) }, ...ctx.layouts.slice(1)]
  }
  const mem = memoryForModel(memory, epoch, back)
  if (mem) ctx.conversation_memory = mem
  if (pendingQuestion?.text) {
    ctx.pending_question = {
      text: String(pendingQuestion.text).slice(0, 300),
      choices: (pendingQuestion.choices || []).slice(0, 12).map(c => ({ label: String(c.label || '').slice(0, 120), ref: (c.ref && back[c.ref]) || null })),
    }
  }
  const pending = pendingProposal ? { ops: pendingProposal.ops.map(o => ({ ...o, target: back[o.target] || o.target })) } : null
  const reference = splitReference(ctx)
  return {
    body: { message: text, context: ctx, capabilities: manifest, manifestVersion: MANIFEST_VERSION, routing: null, pending, interpreter: INTERPRETER,
      ...(reference ? { reference } : {}) },
    refMap,
  }
}

/**
 * STABLE catalogs leave the per-request context and travel as `reference` (the server caches them in their
 * own system block): the indicator catalog (what indicator.add can add) and the Screener's field catalog.
 * They carry no refs — every target the model may use stays in the context. Mutates `ctx`; returns the
 * reference object, or null when there is nothing to move.
 */
export function splitReference(ctx) {
  const ref = {}
  if (Array.isArray(ctx.indicatorCatalog) && ctx.indicatorCatalog.length) {
    ref.indicatorCatalog = ctx.indicatorCatalog
    delete ctx.indicatorCatalog
  }
  const scr = Array.isArray(ctx.screener) ? ctx.screener[0] : null
  if (scr && typeof scr.fields === 'string' && scr.fields.length > 200) {
    ref.screenerFields = scr.fields
    ctx.screener = [{ ...scr, fields: 'see reference_data.screenerFields' }, ...ctx.screener.slice(1)]
  }
  return Object.keys(ref).length ? ref : null
}

/** Gate C memory as the model reads it, plus (NL-1) the last change's targets and arguments. */
export function memoryForModel(memory, epoch, back) {
  if (!memory) return null
  const m = memory.forModel() || {}
  const out = { ...m }
  if (m.subject_chart) out.subject_chart = back[m.subject_chart] || null
  const last = memory.lastChange?.(epoch)
  if (last) {
    out.last_change_detail = last.ops.map(o => {
      const args = JSON.stringify(o.args || {})
      return { action: o.action, target: (o.target && back[o.target]) || null, args: args.length <= MAX_ARGS_CHARS ? o.args : null }
    })
  }
  return Object.keys(out).length ? out : null
}

/**
 * The ONE repair (owner decision 6, 2026-10-16): would UCT's planner refuse this plan? Returns the refusal
 * sentences (UCT's own words, at most 5, 200 chars each) — empty when the plan plans, or when it cannot be
 * judged ahead of execution (a plan that consumes another op's result, or creates what it then targets:
 * those resolve only at apply). A non-empty list is sent back to the model once; whatever it returns goes
 * through every check again (registry, planner, policy, approval, stale state, execution).
 */
export function preflightRefusals(host, ops) {
  try {
    if (!Array.isArray(ops) || !ops.length) return []
    if (ops.some(o => Object.values(o?.args || {}).some(isRef) || getCapability(o?.action)?.creates)) return []
    const kinds = [...new Set(ops.map(o => getCapability(o?.action)?.target).filter(Boolean))]
    const plan = planOps(collectTargets(host, kinds), ops)
    if (plan.ok) return []
    return [...new Set((plan.refusals || []).map(r => String(r.reason || '').replace(/[\u0000-\u001f<>`]+/g, ' ').trim().slice(0, 200)).filter(Boolean))].slice(0, 5)
  } catch { return [] }
}

/** A repaired plan never asks for LESS approval than the plan it replaces: a proposal stays a proposal. */
export function repairedDisposition(first, second) {
  return first === 'propose' && second === 'apply' ? 'propose' : second
}

/**
 * NL-1 has no wording-dependent approval shortcut (owner decision 5): the `explicit` mark that lets an
 * indicator save skip its card when the member's own words named it is removed, so every save shows the
 * existing approval card. (The legacy path keeps it unchanged.)
 */
export const withoutWordingApprovals = (ops) => (ops || []).map(o => {
  if (!o || !('explicit' in o)) return o
  const { explicit, ...rest } = o
  void explicit
  return rest
})

/**
 * A CORRECTION ("no, I meant 15 minutes") may reverse the Agent's previous change only when ALL hold:
 *   • the envelope says so (`correction.replaces === 'last_change'`) and plans the new change;
 *   • the session's last change is fresh and on this board (memory.lastChange);
 *   • the newest Undo entry exists — the change was reversible and is the Agent's own.
 * Whether it is UNCHANGED since is decided by the Undo itself (fingerprints, protection, board sync):
 * a refusal there means nothing is undone and the new change is only proposed.
 */
export function correctionPlan({ env, memory, epoch, undoStack }) {
  if (env?.correction?.replaces !== 'last_change') return null
  if (!['apply', 'propose'].includes(env.disposition) || !(env.ops || []).length) return null
  const last = memory?.lastChange?.(epoch)
  const entry = (undoStack || [])[undoStack?.length - 1] || null
  if (!last) return { ok: false, reason: "there's no recent change of mine in this chat to replace" }
  if (!entry) return { ok: false, reason: "my last change can't be undone" }
  return { ok: true, undoId: entry.id }
}
