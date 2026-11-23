// ── LAYER A: which fast plans are SAFE REFUSALS (Gate C, AUDIT ruling 2026-11-22) ─────────────────────────────
//
// A fast plan that UCT refuses before anything runs changes nothing, so layer A scores it `fast-refuses` (the visible
// `refused` column): never success, never dropped. The scorer already does this for an unknown ticker and for the
// planner's own `check`. This adds ONE declared rule, and only that rule:
//
//   the Screener's hidden-field refusal (owner F-16, SC-1 §2d) — screener.run builds its spec through
//   scanRefine.refineRefusal BEFORE the catalog, any scan or any model call, so a screen, sort or rank that names a
//   UCT proprietary rating or flow field (scanHidden RATING_FIELDS / FLOW_FIELDS) is refused whole.
//
// ⛔ Every op of the plan must be refused by that rule. A plan that would also RUN anything (another op, or a screen
// whose fields are all public) is not a refusal and stays as the scorer judged it.

import { refineRefusal } from '../capabilities/scanRefine'

const HIDDEN_FIELD_RULE = { 'screener.run': (args = {}) => [
  ...(args.filters || []).flatMap(f => [f?.field, f?.key, f?.other]),
  ...(Array.isArray(args.rank) ? args.rank.map(c => c?.field) : []),
  args.sort_field,
].filter(Boolean).map(String) }

/** 'hidden-field' when the capability's declared hidden-field rule refuses EVERY op of the fast plan, else null. */
export function fastRefusalRule(ops) {
  if (!Array.isArray(ops) || !ops.length) return null
  return ops.every(o => HIDDEN_FIELD_RULE[o?.action] && refineRefusal(HIDDEN_FIELD_RULE[o.action](o.args)) != null) ? 'hidden-field' : null
}

/** A layer-A outcome after the declared refusal rule: a fast-WRONG ops plan the rule refuses is `fast-refuses`. */
export function withDeclaredRefusal(outcome, fast) {
  return outcome === 'fast-WRONG' && fast?.kind === 'ops' && fastRefusalRule(fast.ops) ? 'fast-refuses' : outcome
}
