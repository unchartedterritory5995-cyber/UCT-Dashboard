// HubCommitNotice — the commit sheet's VISIBLE escalation, for the members whose phone cannot buzz.
//
// ⛔ THE DEFECT THIS EXISTS FOR. Increment 2 (B5) made the commit-sheet cue read the action's own
// `escalate` flag, so a write that asks the member to commit escalates `haptics.impact()` to
// `haptics.warn()`. That escalation is a VIBRATION and nothing else — and iOS Safari exposes no
// `navigator.vibrate` at all. `components/mobile/haptics.js:5-10` is explicit about it:
//
//     const canVibrate = () =>
//       typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
//     function fire(pattern) { if (!canVibrate()) return false; … }
//
// So on an iPhone `haptics.warn()` returns `false` and does nothing, and the member gets no signal
// whatsoever that this write is the serious kind. Every existing assertion stays green, because
// `actionsSheetHaptic.test.jsx` correctly asserts "the contract is the CALL, not a vibration" —
// the call is made, the escalation simply never arrives anywhere a person can perceive it. On the
// platform that is most of this product's phone traffic, the escalation shipped silent.
//
// ⭐ ONE NOTICE, ONE SENTENCE, THREE SHEETS. `HubConfirmSheet`, `StopConfirmSheet` and
// `PlanTradeSheet` all render THIS, rather than each growing its own warning — a second copy would
// drift into three different words for the same state, which is the defect D-29 and the buzz board
// both paid for. The text is exported so a test asserts the string the module owns, never a string
// retyped beside it.
//
// ⚠️ FILED FOR THE OWNER, NOT SILENTLY FIXED (deferred D-36). `scan.planTrade` and
// `chart.planTrade` are `kind:'run'` with `escalate: false`, so `PlanTradeSheet` — which POSTs a
// planned trade — is a commit sheet whose action does not escalate. It therefore does NOT render
// this notice: making the sheet escalate while its action says it does not would put a second
// authority on "is this the serious kind", which is the defect B5 exists for. Flipping the flag
// changes the haptic every member feels, and that is a product call.
//
// ⛔ IT IS TEXT, NOT COLOUR. A tone alone is invisible to a member with low vision, in bright sun,
// or with the colour tokens a high-contrast theme substitutes — and the RULE here is that
// user-facing feedback is asserted by RENDERED TEXT (owner ruling, 2026-09-09, after two joystick
// toasts shipped with every structural assertion green and nothing on screen). So the sentence is
// the signal and the treatment is the emphasis.

import UIcon from '../components/ui/UIcon'
import styles from './hub.module.css'

/**
 * The escalation, in words. Deliberately about the ACT rather than the feature: this same sentence
 * is shown above a stop write, a planned trade and a generic confirm, and "writes" is the one thing
 * all three have in common and the one thing that makes them different from every other bubble.
 */
export const COMMIT_NOTICE_TEXT = 'This one writes. Check the number before you confirm.'

/**
 * @param {{testId?: string}} props
 */
export default function HubCommitNotice({ testId = 'hub-commit-notice' }) {
  return (
    <p
      className={styles.commitNotice}
      role="note"
      // The visual STATE, readable from the DOM and from the stylesheet alike, so the sheet's
      // escalated appearance has one switch rather than a class per sheet.
      data-hub-commit="escalated"
      data-testid={testId}
    >
      <UIcon name="warning" size={16} />
      <span>{COMMIT_NOTICE_TEXT}</span>
    </p>
  )
}
