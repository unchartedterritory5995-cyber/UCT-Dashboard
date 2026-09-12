import { LOCAL_ONLY, PROMOTABLE, DURABLE } from './engine/conditionCapability'
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
  cond, state, expanded = false, busy = false,
  onArm = null, onPromote = null, onExplain = null,
}) {
  const { cap, definition, armed, action, enabled } = state
  const isOn = cap.capability === DURABLE && armed.length > 0
  const policy = TRIGGER_POLICIES[DEFAULT_POLICY]

  // ⚠️ THE HOST'S ABSENCE DISABLES THE ACTION, NOT THE EXPLANATION. A surface
  // that cannot arm should still be able to say WHY a condition is local-only —
  // the sentence is the part that teaches, and it costs nothing to render.
  const canAct = (action === 'arm' && !!onArm)
    || (action === 'promote' && !!onPromote)
    || (action === 'explain' && !!onExplain)

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
      aria-label={isOn ? `Alerts on for ${cond.name}` : `Alert me — ${cond.name}`}
      aria-pressed={cap.capability === DURABLE ? isOn : undefined}
      aria-expanded={action === 'explain' ? expanded : undefined}
      disabled={!enabled || !canAct || busy}
      title={title}
      onClick={() => {
        if (busy) return
        if (action === 'arm') { onArm?.({ cond, definition, policyId: DEFAULT_POLICY, existing: armed }); return }
        if (action === 'promote') { onPromote?.({ cond }); return }
        if (action === 'explain') onExplain?.(cond)
      }}
    ><UIcon name="bell" size={12} /></button>
  )
}

/** The refusal, in the member's words, with the useful next move. */
export function ConditionAlertNote({ cond, state, onBuild = null }) {
  const { cap } = state
  if (cap.capability !== LOCAL_ONLY) return null
  return (
    <div className={styles.indRow} role="note">
      <span className={styles.indLabel} />
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, opacity: 0.85 }}>{cap.reason}</span>
        {/* ⭐ WHAT IT FOLLOWS, NAMED. It is the fact that makes the sentence above
            concrete, and it is what a member needs in hand to author the
            standalone version deliberately. */}
        {cap.boundTo.length > 0 && (
          <span style={{ fontSize: 11, opacity: 0.65 }}>{`Follows: ${cap.boundTo.join(', ')}`}</span>
        )}
        {onBuild && (
          <button
            type="button"
            className={styles.chip}
            aria-label={`Create an alertable version of ${cond.name}`}
            // ⛔⛔ THE ORIGINAL IS NOT TOUCHED AND THE FORMULA IS NOT REWRITTEN FOR
            // THEM. The Builder opens on the member's own text with the bound
            // sources named beside it; what `a` should become is a decision only
            // they can make, because `rsi(close, 14)` and "the RSI on this chart"
            // are different sentences.
            onClick={() => onBuild({
              consumerKind: 'condition',
              prefill: cond.formula,
              boundTo: cap.boundTo,
              fromConditionId: cond.id,
            })}
          >Create alertable version…</button>
        )}
      </span>
    </div>
  )
}

export default ConditionAlertBell
