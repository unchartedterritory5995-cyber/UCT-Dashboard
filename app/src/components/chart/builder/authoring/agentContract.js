// app/src/components/chart/builder/authoring/agentContract.js
//
// ─── ⭐ OVERNIGHT H — THE UCT AGENT ⇄ UCT INTELLIGENCE DELEGATION CONTRACT ─────────
//
// UCT Agent (the general product operator, `app/src/agent`) recognises INDICATOR intent
// and DELEGATES it; UCT Intelligence (this authoring system) owns the maths, the patch
// contract, validation, preview, revisions and save. The Agent never builds a tree,
// never edits a definition, never saves one — its capabilities README already says
// "no indicator.* capabilities" and this contract keeps that true.
//
//   AGENT                          INTELLIGENCE (Create Indicator dock)       MEMBER
//   ─────                          ───────────────────────────────────        ──────
//   indicator.create {prompt}  →   opens the dock, request PREFILLED      →   sends it, previews,
//   indicator.modify {defId,       opens the dock ON that definition,         refines, and SAVES
//                     prompt}      request prefilled (revision-aware save)    (or cancels)
//   indicator.import {dialect,  →  NOT WIRED YET: the import box opens empty, so the
//                     source}      script would be dropped — refused, by name
//   ←  {status: 'opened'} | {status: 'refused', reason}
//
// ⛔ NOTHING IS SAVED OR ADDED TO A CHART WITHOUT THE MEMBER'S OWN SAVE IN THE DOCK.
// The dock's save adds the indicator to the chart through the existing
// `attachConversation` door; an Agent that wants it on ANOTHER chart uses its own
// existing, authorised chart actions afterwards, with the saved `defId`.
//
// ⛔ NO SECOND REPRESENTATION. A request carries the member's WORDS (or source text),
// never a tree, a patch or a definition — the specialist interprets them.
//
// This module is the indicator side's half: the typed shapes and their validator, and
// the one seam (`openCreateIndicator({prompt})`, ChartToolbar) they map onto. Wiring a
// capability into the Agent's registry is the Agent team's change, by agreement.

export const INDICATOR_ACTIONS = Object.freeze(['create', 'modify', 'import'])
export const IMPORT_DIALECTS = Object.freeze(['pine', 'thinkscript', 'pcf', 'formula'])
export const AGENT_LIMITS = Object.freeze({ maxPrompt: 1000, maxSource: 200000 })

const DEF_ID_RE = /^u_[0-9a-f]{12}$/

/**
 * Validate an Agent → Intelligence request. Returns `null` when valid, else a reason a
 * member can read. Closed: an unknown field is refused, never ignored.
 * @param {{action: string, prompt?: string, defId?: string, dialect?: string, source?: string}} req
 */
export function indicatorRequestProblem(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) return 'The indicator request is not an object.'
  const allowed = { create: ['action', 'prompt'], modify: ['action', 'defId', 'prompt'], import: ['action', 'dialect', 'source'] }
  if (!INDICATOR_ACTIONS.includes(req.action)) return `"${req.action}" is not an indicator action.`
  const extra = Object.keys(req).filter((k) => !allowed[req.action].includes(k))
  if (extra.length) return `An indicator ${req.action} request does not take ${extra.join(', ')}.`
  if (req.action !== 'import') {
    if (typeof req.prompt !== 'string' || !req.prompt.trim()) return 'Say what the indicator should do.'
    if (req.prompt.length > AGENT_LIMITS.maxPrompt) return `The request is longer than ${AGENT_LIMITS.maxPrompt} characters.`
  }
  if (req.action === 'modify' && !DEF_ID_RE.test(String(req.defId || ''))) return 'That is not one of your saved indicators.'
  if (req.action === 'import') {
    if (!IMPORT_DIALECTS.includes(req.dialect)) return `"${req.dialect}" is not an import language UCT reads.`
    if (typeof req.source !== 'string' || !req.source.trim()) return 'There is no script to import.'
    if (req.source.length > AGENT_LIMITS.maxSource) return 'The script is too long to import here.'
  }
  return null
}

/**
 * Map a VALID request onto the chart toolbar's existing doors. `api` is the toolbar's
 * imperative handle (`openCreateIndicator`, `openFormulaBuilder`). Returns the contract's
 * result shape. ⛔ It opens a dock; it never saves.
 */
export function delegateIndicatorRequest(req, api) {
  const problem = indicatorRequestProblem(req)
  if (problem) return { status: 'refused', reason: problem }
  if (!api) return { status: 'refused', reason: 'No chart here can create indicators.' }
  let ok = false
  if (req.action === 'create') ok = !!(api.openCreateIndicator && api.openCreateIndicator({ prompt: req.prompt.trim() }))
  else if (req.action === 'modify') ok = !!(api.openCreateIndicator && api.openCreateIndicator({ defId: req.defId, prompt: req.prompt.trim() }))
  else {
    // ⛔ The import box opens with nothing in it (`openFormulaBuilder` takes no source),
    // so a delegated script would be DROPPED; say so instead of opening it empty.
    return { status: 'refused', reason: 'Importing a script through UCT Agent is not wired yet — open Formula → Import and paste it there.' }
  }
  return ok ? { status: 'opened' } : { status: 'refused', reason: req.action === 'modify'
    ? 'That indicator is not available to edit on this chart.' : 'This chart cannot open the indicator studio.' }
}
