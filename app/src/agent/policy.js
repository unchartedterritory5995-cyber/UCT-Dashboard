// ── UCT Agent MUTATION POLICY ────────────────────────────────────────────────
//
//   answer / clarify / unsupported -> never mutates (the runtime is not called)
//   apply    -> what the member EXPLICITLY asked for (the model's `apply`, the fast path, a picked
//               choice) when every change is `local`-risk and reversible: executes now, receipt +
//               Undo — on one target or several ("make both charts weekly"), one new resource or
//               several ("add two charts"). Asking them to click Apply again would only repeat them.
//               (Owner decision 2026-10-12: no redundant approval for routine explicit changes.)
//   propose  -> anything that needed interpretation or taste (the model's `propose`), and anything
//               a capability declares `risk: 'confirm'` or `reversible: false`, or flags for THIS
//               state (`confirmIf`): shown as a plan, executed only when the member approves it
//               (the STORED plan, re-validated)
//
// One narrow exception, opt-in per capability (`explicitOk`): an irreversible CREATE that the
// member's own words in this message asked for — the op carries `explicit: true`, set only by
// deterministic checks of their text (the fast path, or the capability's screen of a model plan),
// never by the model (executor.planShape). The capability's `confirmIf` still sends it to a
// proposal when its state needs one (indicator.saveDraft: an acknowledgement, a new version of an
// indicator used elsewhere, a duplicate name).
//
// The model SUGGESTS apply vs propose; capability metadata + this module have the last word.

import { planShape } from './executor'

/** Kept for importers; explicit plans are no longer capped by op count here (the server caps a
 *  plan at 12 ops). */
export const APPLY_MAX_OPS = 6

export function decideMode(suggested, plan) {
  if (suggested === 'propose') return 'propose'
  const s = planShape(plan)
  if (s.confirm || s.irreversible) return 'propose'
  return 'apply'
}
