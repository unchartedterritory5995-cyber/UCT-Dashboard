import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LOCAL_ONLY, PROMOTABLE, DURABLE, SOURCE_UNAVAILABLE, INVALID,
} from './engine/conditionCapability'
import { TRIGGER_POLICIES, DEFAULT_POLICY } from './engine/triggerPolicy'
import { tfLabel } from './timeframes'
import UIcon from '../ui/UIcon'
import styles from './ConditionAlertPopover.module.css'

// ─── "ALERT ME WHEN THIS HAPPENS" ───────────────────────────────────────────
//
// ⭐⭐ THE COMMON CASE IS ONE CLICK, AND THAT IS AN ARCHITECTURAL RESULT RATHER
// THAN A UI TRICK. By the time a member reaches this sheet the product already
// knows every field the endpoint takes:
//
//     WHAT       the condition they are looking at
//     WHERE      the chart's symbol
//     WHEN       the chart's drawn timeframe
//     HOW        `becomes_true`, the only trigger in the vocabulary
//     TIMING     bar close — the committed evaluator lane
//
// So none of them is a question. They are STATED, and the only control is the
// verb. A dropdown per field would be a form asking a member to re-enter what
// they are already looking at.
//
// ⛔ AND IT SHOWS NO CONTROL THAT DOES NOTHING. In UCT is stated rather than
// offered, because it is always on and a checkbox that cannot be unticked is a
// lie about who is in control. Email is a real choice and is OFF by default —
// creating an alert and subscribing to email are separate member decisions, and
// a one-click create must not quietly make the second one.
//
// ⚠️ AND AN ACCOUNT WITH NO ADDRESS GETS A SENTENCE, NOT A DEAD TOGGLE. An
// enabled control that silently never delivers is the defect this whole lane
// exists to prevent, one layer up.
//
// ⚠️ IT IS A LAUNCHER FOR EVERYTHING EXCEPT THE CREATE. Promotion, the Builder
// handoff and alert management all belong to the host; this sheet decides what to
// OFFER and hands back what the member chose.

/** Where the sheet sits relative to the bell that opened it.
 *
 *  ⭐ A DERIVATION, NOT AN EFFECT. The position is a pure function of the rect
 *  the click handed over, so computing it in an effect would mean one render at
 *  the wrong place followed by a second at the right one — a visible jump on a
 *  268px sheet. It does not follow a resize; the sheet closes on an outside
 *  click, and a member resizing the window mid-decision is not a case worth a
 *  listener. */
function anchoredPosition(anchorRect) {
  if (!anchorRect) return null
  const W = 268
  const GUTTER = 8
  const EST_H = 240
  // ⚠️ CLAMPED TO THE VIEWPORT, not merely placed. The bell can sit at the far
  // right of a narrow grid cell, where a naive left = rect.left would put the
  // sheet half off-screen with no scrollbar to recover it.
  const left = Math.max(
    GUTTER,
    Math.min(anchorRect.left - W + anchorRect.width, window.innerWidth - W - GUTTER),
  )
  const below = anchorRect.bottom + 6
  const flip = below + EST_H > window.innerHeight && anchorRect.top > EST_H + 20
  return { left, top: flip ? Math.max(GUTTER, anchorRect.top - 6 - EST_H) : below }
}

/**
 * @param {object} cond      the NORMALISED condition
 * @param {object} state     `bellState()` — capability, definition, armed rows
 * @param {string} sym
 * @param {string} tf        the timeframe actually DRAWN, not the raw prop
 * @param {Function} onCreate   `({cond, definition, policyId})` — the host POSTs
 * @param {Function} onPromote  `({cond})` — the host runs `promoteCondition`
 * @param {Function} onBuild    the Builder handoff for a chart-bound condition
 * @param {Function} onManage   `(alertId)` — open this alert in the Alert Center
 * @param {Function} onToggle   `(alertId)` — enable/disable an existing alert
 * @param {Function} onDelete   `(alertId)` — delete an existing alert
 */
export default function ConditionAlertPopover({
  cond, state, sym, tf, anchorRect, onClose,
  onCreate = null, onPromote = null, onBuild = null,
  onManage = null, onToggle = null, onDelete = null,
  busy = false, notice = null, email = null, onManageEmail = null,
}) {
  // ⛔ OFF BY DEFAULT, AND IT IS LOCAL STATE — the member's choice for THIS
  // create, not a remembered preference. There is no per-member channel default
  // to read, and inventing one here would be a preference nobody set.
  const [alsoEmail, setAlsoEmail] = useState(false)
  const pos = useMemo(() => anchoredPosition(anchorRect), [anchorRect])
  const ref = useRef(null)
  const firstRef = useRef(null)

  // Escape closes, and a click outside closes — the two ways every other UCT
  // popover closes, so this one needs no instructions.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.() } }
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  // ⚠️ FOCUS MOVES INTO THE SHEET. It opened from a keyboard-reachable bell, so
  // leaving focus behind would strand a keyboard member on a control whose
  // consequence is now off-screen.
  useEffect(() => { firstRef.current?.focus() }, [pos])

  if (!pos || !state) return null

  const { cap, definition, armed } = state
  const policy = TRIGGER_POLICIES[DEFAULT_POLICY]
  const canCreate = cap.capability === DURABLE
  const canPromote = cap.capability === PROMOTABLE

  const sheet = (children) => (
    <div
      ref={ref}
      className={styles.sheet}
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label={`Alerts for ${cond.name}`}
    >{children}</div>
  )

  // ─── the refusals, each with the one useful next move ────────────────────
  if (cap.capability === LOCAL_ONLY) {
    return sheet(
      <>
        <div className={styles.lede}>Cannot alert on this yet</div>
        <div className={styles.what}>{cond.name}</div>
        <div className={styles.refusal}>{cap.reason}</div>
        {cap.boundTo.length > 0 && (
          <div className={styles.bound}>{`Follows: ${cap.boundTo.join(', ')}`}</div>
        )}
        <div className={styles.actions}>
          {onBuild && (
            <button
              ref={firstRef}
              type="button"
              className={styles.create}
              onClick={() => onBuild({
                consumerKind: 'condition',
                prefill: cond.formula,
                boundTo: cap.boundTo,
                fromConditionId: cond.id,
              })}
            >Create alertable version…</button>
          )}
          <button type="button" className={styles.ghost} onClick={onClose}>Close</button>
        </div>
      </>,
    )
  }

  if (cap.capability === SOURCE_UNAVAILABLE || cap.capability === INVALID) {
    return sheet(
      <>
        <div className={styles.lede}>Cannot alert on this</div>
        <div className={styles.what}>{cond.name}</div>
        <div className={styles.refusal}>{cap.reason}</div>
        <div className={styles.actions}>
          <button ref={firstRef} type="button" className={styles.ghost} onClick={onClose}>Close</button>
        </div>
      </>,
    )
  }

  // ─── the offer ───────────────────────────────────────────────────────────
  return sheet(
    <>
      <div className={styles.lede}>{armed.length ? 'Alerts' : 'Alert me when'}</div>
      <div className={styles.what}>
        {cond.name} <span style={{ fontWeight: 400 }}>{policy.label.toLowerCase()}</span>
      </div>
      <div className={styles.when}>
        <b>{String(sym || '').toUpperCase()}</b>
        <span className={styles.dot}>·</span>
        <span>{tfLabel(tf) || tf}</span>
        <span className={styles.dot}>·</span>
        {/* ⭐ THE TIMING, SAID PLAINLY. It is the committed closed-bar lane and
            not a choice, so it is a statement — but it is stated, because "on
            bar close" is the difference between an alert a trader trusts and one
            they think is broken when it does not fire intrabar. */}
        <span>on bar close</span>
      </div>

      {armed.length > 0 && (
        <div className={styles.existing}>
          {armed.map((a) => (
            <div key={a.id} className={`${styles.row} ${a.active === false ? styles.rowOff : ''}`}>
              <div className={styles.rowMain}>
                <div className={styles.rowTop}>
                  {`${String(a.sym || '').toUpperCase()} · ${tfLabel(a.tf) || a.tf}`}
                </div>
                <div className={styles.rowSub}>
                  {a.active === false ? 'Paused' : (a.triggered_at ? 'Fired · waiting to reset' : 'Watching')}
                </div>
              </div>
              {onToggle && (
                <button
                  type="button" className={styles.iconBtn}
                  aria-label={a.active === false ? `Resume this alert` : `Pause this alert`}
                  title={a.active === false ? 'Resume' : 'Pause'}
                  onClick={() => onToggle(a.id)}
                ><UIcon name={a.active === false ? 'play' : 'pause'} size={12} /></button>
              )}
              {onDelete && (
                <button
                  type="button" className={styles.iconBtn}
                  aria-label="Delete this alert" title="Delete"
                  onClick={() => onDelete(a.id)}
                ><UIcon name="trash" size={12} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── NOTIFY ME ─────────────────────────────────────────────────────── */}
      <div className={styles.notify}>
        <div className={styles.notifyHead}>Notify me</div>
        {/* ⛔ IN UCT IS STATED, NOT OFFERED. It is always on; a checkbox that
            cannot be unticked would be a lie about who is in control. */}
        <div className={styles.channelFixed}>
          <UIcon name="bell" size={11} />
          <span>In UCT</span>
        </div>
        {email ? (
          <label className={styles.channel}>
            <input
              type="checkbox"
              checked={alsoEmail}
              onChange={(e) => setAlsoEmail(e.target.checked)}
            />
            <span>Email</span>
            <span className={styles.channelHint}>{email}</span>
          </label>
        ) : (
          <div className={styles.channelOff}>
            <span>Email</span>
            <span className={styles.channelHint}>no email address on your account</span>
            {onManageEmail && (
              <button type="button" className={styles.link} onClick={onManageEmail}>Add one</button>
            )}
          </div>
        )}
      </div>

      {canPromote && (
        <div className={styles.note}>
          This formula will be saved so it can keep running when the chart is closed.
        </div>
      )}

      {notice && (
        <div className={`${styles.refusal} ${notice.kind === 'error' ? styles.error : styles.ok}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </div>
      )}

      <div className={styles.actions}>
        <button
          ref={firstRef}
          type="button"
          className={styles.create}
          disabled={busy || (!canCreate && !canPromote)}
          onClick={() => {
            // ⭐ THE CHANNELS TRAVEL WITH THE CREATE, so the alert is stored with
            // the member's choice rather than saved and then patched — which would
            // leave a window in which it existed with the wrong delivery.
            const channels = alsoEmail ? ['in_app', 'email'] : ['in_app']
            if (canCreate) onCreate?.({ cond, definition, policyId: DEFAULT_POLICY, channels })
            else if (canPromote) onPromote?.({ cond, channels })
          }}
        >
          {busy ? 'Working…' : (armed.length ? 'Create another' : 'Create alert')}
        </button>
        <button type="button" className={styles.ghost} onClick={onClose}>Close</button>
      </div>

      {armed.length > 0 && onManage && (
        <button type="button" className={styles.link} onClick={() => onManage(armed[0].id)}>
          Manage in Alerts →
        </button>
      )}
    </>,
  )
}
