// ── UCT Agent MUTATION POLICY ────────────────────────────────────────────────
//
//   answer / clarify / unsupported -> never mutates (the runtime is not called)
//   apply    -> only a SMALL, explicitly requested, reversible, `local`-risk
//               change to ONE target: executes now, receipt + Undo
//   propose  -> anything broader, anything that needed interpretation, and
//               anything a capability declares `risk: 'confirm'` or
//               `reversible: false`: shown as a plan, executed only when the
//               member approves it (the STORED plan, re-validated)
//
// The model SUGGESTS apply vs propose; capability metadata + this module have
// the last word.

import { planShape } from './executor'

export const APPLY_MAX_OPS = 6

export function decideMode(suggested, plan) {
  if (suggested === 'propose') return 'propose'
  const s = planShape(plan)
  if (s.confirm || s.irreversible) return 'propose'
  if (s.targets > 1) return 'propose'
  if (s.ops > APPLY_MAX_OPS) return 'propose'
  return 'apply'
}
