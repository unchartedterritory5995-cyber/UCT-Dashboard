// app/src/components/chart/builder/authoring/authoringState.js
//
// ─── ⭐⭐ P2 — THE SMALLEST DURABLE AUTHORING STATE ────────────────────────────
//
// A conversation's state is the working canonical definition plus a compact
// record: revision, intent, pending consumer requests, disclosed assumptions,
// open questions, an undo stack and source metadata. The transcript is NOT
// needed for correctness: the next turn's model input is `compactView(state)`.
//
// The working copy is a proposal held client-side; once saved, the STORE's
// definition is the authority (`openAuthoringState` from the store's row). Save
// goes through the Builder's existing door — `prepareSave` only assembles and
// validates the document exactly as `BuilderSheet.save()` does.

import { applyPatch, EMPTY_REQUESTS } from './applyPatch'
import { defaultIntentFor } from '../authoringIntent'
import { validateUserDefinitions } from '../../engine/nativeRegistry'
import { readback } from './readback'

export const STATE_CONTRACT = 'uct.authoring.state/1'
export const HISTORY_MAX = 50

function mintLineage() {
  const bytes = new Uint8Array(6)
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return 'auth_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const freeze = (s) => Object.freeze(s)

export function newAuthoringState({ lineage = null } = {}) {
  return freeze({
    contract: STATE_CONTRACT,
    lineage: lineage || mintLineage(),
    defId: null,
    baseVersion: null,
    revision: 0,
    working: null,
    intent: null,
    requests: EMPTY_REQUESTS,
    assumptions: [],
    questions: [],
    history: [],
    source: { kind: 'conversation', replacedForeign: {} },
  })
}

/** Start a conversation from a STORED definition (the store's row is authority). */
export function openAuthoringState(def, { defId = null, version = null, lineage = null } = {}) {
  const intent = def ? defaultIntentFor(def) : null
  return freeze({
    ...newAuthoringState({ lineage }),
    defId: defId || (def && def.id) || null,
    baseVersion: Number.isInteger(version) ? version : (def && Number.isInteger(def.version) ? def.version : null),
    working: def || null,
    intent: intent && intent !== 'plot' ? { intent, output: null } : null,
    source: { kind: 'opened', replacedForeign: {} },
  })
}

/** Assumptions survive turns as SNAPSHOTS (label + value), because slot ids are
 *  only valid for one revision. One the member has since decided explicitly (a
 *  `set_slot` on the same output and label) is dropped. */
function carryAssumptions(prev, changes, fresh, revision) {
  const decided = changes.filter((c) => c.kind === 'slot-set')
  const removed = new Set(changes.filter((c) => c.kind === 'output-removed').map((c) => c.output))
  const kept = prev.filter((a) => !removed.has(a.output)
    && !decided.some((d) => a.label !== undefined && d.output === a.output && d.label === a.label && d.fromValue === a.value))
  return [...kept, ...fresh.map((a) => ({ ...a, revision }))]
}

/**
 * Apply one model turn. A refused patch returns the SAME state object.
 * @returns {{state, result, readback}}
 */
export function applyTurn(state, patch, ctx = {}) {
  const result = applyPatch(state.working, patch, {
    revision: state.revision, intent: state.intent, requests: state.requests,
    gateCtx: ctx.gateCtx, defId: ctx.defId,
  })
  if (result.status === 'refused') return { state, result, readback: readback(state.working, state, ctx.gateCtx) }
  if (result.status === 'question') {
    const next = freeze({ ...state, questions: result.questions })
    return { state: next, result, readback: readback(next.working, next, ctx.gateCtx) }
  }
  const revision = state.revision + 1
  const snapshot = freeze({
    revision: state.revision, working: state.working, intent: state.intent, requests: state.requests,
    assumptions: state.assumptions, questions: state.questions,
  })
  const next = freeze({
    ...state,
    revision,
    working: result.definition,
    intent: result.intent,
    requests: result.requests,
    assumptions: carryAssumptions(state.assumptions, result.changes, result.assumptions, revision),
    questions: [],
    history: [...state.history, snapshot].slice(-HISTORY_MAX),
    source: {
      ...state.source,
      replacedForeign: { ...state.source.replacedForeign, ...(result.replacedForeign || {}) },
    },
  })
  return { state: next, result, readback: readback(next.working, next, ctx.gateCtx) }
}

/** Restore the previous applied revision EXACTLY (the same definition object).
 *  The revision number moves FORWARD so a model view of the undone revision is
 *  stale and cannot patch the restored one by accident. */
export function undo(state) {
  if (!state.history.length) return state
  const prev = state.history[state.history.length - 1]
  return freeze({
    ...state,
    revision: state.revision + 1,
    working: prev.working,
    intent: prev.intent,
    requests: prev.requests,
    assumptions: prev.assumptions,
    questions: prev.questions,
    history: state.history.slice(0, -1),
    restoredFrom: prev.revision,
  })
}

/**
 * Assemble the document for the EXISTING save door, exactly as
 * `BuilderSheet.save()` does: an edit bumps `version` from the stored one, a
 * create starts at 1 under a draft id the server replaces; then the shipped
 * validation door. No semantics stamp — the store decides it.
 * @returns {{doc, defId: string|null, errors: string[], needsAck: string[], requests}}
 */
export function prepareSave(state, { draftId = null } = {}) {
  if (!state.working) return { doc: null, defId: null, errors: ['There is nothing to save yet.'], needsAck: [], requests: state.requests }
  const editing = !!state.defId && Number.isInteger(state.baseVersion)
  const doc = {
    ...state.working,
    id: editing ? state.defId : (draftId || state.working.id),
    version: editing ? state.baseVersion + 1 : 1,
  }
  const { errors } = validateUserDefinitions([doc])
  return { doc, defId: editing ? state.defId : null, errors, needsAck: readback(doc, state).needsAck, requests: state.requests }
}
