import { PROMOTABLE, DURABLE } from './engine/conditionCapability'
import { TRIGGER_POLICIES, DEFAULT_POLICY } from './engine/triggerPolicy'
import UIcon from '../ui/UIcon'
import styles from './ChartSettingsModal.module.css'

// ─── THE BELL ON A CONDITION ROW ────────────────────────────────────────────
//
// ⭐⭐ ONE CONTROL, FOUR ANSWERS, AND EVERY ONE OF THEM IS A SENTENCE. A member
// looking at a condition asks "can this tell me?" — and the honest answers are
// not "yes/no". They are:
//
//   DURABLE            Alert me — and once armed, the bell says it is on.
//   PROMOTABLE         Alert me. One extra step happens (the formula is saved so
//                      it can run without the chart) and the member is told so
//                      BEFORE it happens, in the title, not after it in a toast.
//   LOCAL_ONLY         It cannot, because it follows an indicator on this chart —
//                      and here is the thing to do instead.
//   SOURCE_UNAVAILABLE / INVALID
//                      It cannot, and this is not something to work around.
//
// ⛔ A DISABLED CONTROL WITH NO SENTENCE IS THE FAILURE THIS AVOIDS. A greyed
// bell teaches a member that alerts "sometimes don't work"; the refusal that names
// what they built teaches them the difference between the two kinds of condition,
// which is the whole product idea this phase is trying to land.
//
// ⛔⛔ AND IT IS A LAUNCHER, NOT A CLIENT. It does no fetching and imports no
// persistence — the host arms, the host promotes, the host opens the Builder. The
// same rule `onCreateFormula` follows, for the same reason: two surfaces creating
// alerts is two spellings of one request.
//
// ⚠️ IT IS IN TWO PIECES BECAUSE THE ROW IS. The button belongs in the row's
// HEAD, beside the move and remove controls; the explanation belongs BELOW it, at
// full width, where a sentence can be read. One component rendering both would put
// a paragraph inside a flex head — so the state that joins them is the row's, and
// `bellState` is the single derivation both pieces read.

/**
 * @param {Function|null} onArm      `({cond, definition, policyId, existing})` — the host POSTs
 * @param {Function|null} onPromote  `({cond})` — the host runs `promoteCondition`
 * @param {Function|null} onExplain  toggles the note below; the ROW owns that state
 */
export function ConditionAlertBell({
  cond, state, expanded = false, busy = false, onOpen = null,
}) {
  const { cap, armed, enabled } = state
  const isOn = cap.capability === DURABLE && armed.length > 0
  const policy = TRIGGER_POLICIES[DEFAULT_POLICY]

  // ⭐⭐ ONE CLICK, ONE DESTINATION. The bell used to branch three ways — arm,
  // promote, explain — which meant the same control did something different
  // depending on a capability the member could not see. It now always opens the
  // sheet, and the SHEET says what this condition can do. A member learns one
  // gesture instead of three outcomes.
  //
  // ⛔ THE DISABLED CASES STAY DISABLED. `source_unavailable` and `invalid` have
  // nothing to offer and no next move, so the bell reports that in its title
  // rather than opening a sheet whose only content is a refusal.
  const canAct = enabled && !!onOpen

  // ⭐ THE TITLE IS THE REFUSAL WHEN THERE IS ONE. `cap.reason` is null for the
  // two capabilities that can act, and for those it says what WILL happen —
  // including the extra step, said before it happens rather than after.
  const title = cap.reason
    || (isOn ? `Alerting when this ${policy.label.toLowerCase()}` : null)
    || (cap.capability === PROMOTABLE
      ? 'Saves this formula so it can run when the chart is closed, then alerts you.'
      : policy.blurb)

  return (
    <button
      type="button"
      className={`${styles.actRowRemove} ${isOn ? styles.toggleOn : ''}`}
      data-capability={cap.capability}
      data-armed={isOn ? 'yes' : 'no'}
      aria-label={isOn
        ? `Alerts on for ${cond.name} — ${armed.length} alert${armed.length === 1 ? '' : 's'}`
        : `Alert me — ${cond.name}`}
      aria-pressed={cap.capability === DURABLE ? isOn : undefined}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      disabled={!canAct || busy}
      title={title}
      onClick={(e) => {
        if (busy) return
        // The sheet anchors to THIS button, so the rect travels with the event
        // rather than being re-measured from an id after the fact.
        onOpen?.(cond, e.currentTarget.getBoundingClientRect())
      }}
    >
      <UIcon name="bell" size={12} />
      {/* ⭐ THE COUNT ONLY WHEN IT SAYS SOMETHING. One alert is already reported
          by the bell being ON; a "1" beside it is noise on a row that has to stay
          compact. Two or more is a fact the member cannot otherwise see. */}
      {armed.length > 1 && <span className={styles.bellCount}>{armed.length}</span>}
    </button>
  )
}

export default ConditionAlertBell
