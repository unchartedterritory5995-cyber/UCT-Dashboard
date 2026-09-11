// Joystick hub — the confirm sheet. Phase 3's ONLY write path.
//
// ⛔ A GESTURE NEVER COMMITS DIRECTLY. Every Phase 3 write — adjust a stop, plan a trade — is
// proposed by a gesture and performed here. Two reasons, and the second is the load-bearing one:
//
//   1. A drag is not a decision. The member should see the number they are about to write.
//   2. WCAG 2.5.1. The steppers and the numeric field are the EQUAL path, not a fallback: a
//      member with a tremor, a prosthetic, or one hand on a train must be able to reach the same
//      value at the same precision. That requirement is the reason this sheet exists at all
//      rather than the release of a drag writing straight through.
//
// ⭐ `onConfirm` FIRES AT MOST ONCE PER SHEET, and that is enforced here rather than trusted to
// the caller. A double-tap on a slow network is the ordinary case, and for the Journal scrub the
// write is `PUT /api/j2/positions/{id}` — firing twice is not idempotent in any way the member
// would recognise as safe.

import { useCallback, useRef, useState } from 'react'
import Sheet from '../components/mobile/Sheet'
import HubCommitNotice from './HubCommitNotice'
import { validateConfirmPayload } from './contracts'
import styles from './hub.module.css'

/**
 * @param {{payload: import('./contracts').HubConfirmPayload|null, onClose: () => void}} props
 */
export default function HubConfirmSheet({ payload, onClose }) {
  // Validated on RENDER, at the boundary — the payload is built by a section, and a sheet with a
  // blank body or a dead primary button is exactly the silent failure this validator exists for.
  // Cheap: once per open, not per keystroke.
  if (payload) validateConfirmPayload(payload, 'HubConfirmSheet')

  // ⛔ THE LATCH AND THE FIELD VALUES ARE PER-SHEET, NOT PER-MOUNT — and they were not.
  //
  // `HubRoot` mounts this component ONCE and permanently, passing `payload` in and out. The
  // original `useRef(false)` therefore latched for the LIFETIME OF THE PAGE: the first confirm
  // anywhere in the session set it, and every later confirm hit the early return — never calling
  // `onConfirm`, and never calling `onClose` either, so the sheet sat open with a dead primary
  // button until a full reload. On /journal/trades that is Move stop, Breakeven and Close sharing
  // one use between them.
  //
  // `useState`'s lazy initialiser had the same shape: it ran once, at mount, when `payload` was
  // `null` — so `values` was `{}` forever and any payload with `fields` rendered `value={undefined}`.
  // That is the real cause of R-14: the "EQUAL path" steppers were structurally dead, not merely
  // unwired.
  //
  // ⭐ EVERY TEST WAS BLIND TO BOTH, because each mounts a fresh component with a payload already
  // in hand — the harness reproducing a shape the product does not use. Found by the Architecture
  // lead, and it is the same failure this file's own header describes.
  const firedRef = useRef(false)
  const [seeded, setSeeded] = useState(null)
  const [values, setValues] = useState({})
  if (payload !== seeded) {
    // React's documented "adjust state when a prop changes" pattern — a render-phase set on this
    // component only, which React re-runs immediately without committing the stale pass.
    setSeeded(payload)
    setValues(Object.fromEntries((payload?.fields ?? []).map((f) => [f.name, f.value])))
    firedRef.current = false
  }

  const confirm = useCallback(() => {
    // The once-only latch. A ref, not state: state needs a render to reach a callback, and the
    // second tap of a double-tap arrives before that render — the stale-closure defect this repo
    // has already paid for in the drawing quick-bar.
    if (firedRef.current) return
    firedRef.current = true
    payload?.onConfirm?.(values)
    onClose?.()
  }, [payload, values, onClose])

  if (!payload) return null

  const step = (name, delta, field) => setValues((v) => {
    const next = Number(v[name]) + delta
    const clamped = Math.min(
      field.max ?? Number.POSITIVE_INFINITY,
      Math.max(field.min ?? Number.NEGATIVE_INFINITY, next),
    )
    // 2dp everywhere (A2): the tick is 0.01 and float addition would otherwise show 178.10000000001.
    return { ...v, [name]: Number(clamped.toFixed(2)) }
  })

  return (
    <Sheet open onClose={onClose} variant="auto" title={payload.title} ariaLabel={payload.title}>
      {/* ⛔ THE ESCALATION A PHONE CANNOT BUZZ. `escalate` reaches this sheet from the action that
          opened it (HubRoot's confirm branch), the SAME flag `useJoystick.js:197` reads for the
          haptic — one authority, two organs. iOS Safari has no `navigator.vibrate`, so without
          this the escalation exists only for Android. */}
      {payload.escalate ? <HubCommitNotice /> : null}
      <div className={styles.confirmBody} data-testid="hub-confirm-body">{payload.body}</div>

      {(payload.fields ?? []).map((field) => (
        <div key={field.name} className={styles.confirmField}>
          <label htmlFor={`hub-cf-${field.name}`}>{field.name}</label>
          <div className={styles.confirmStepper}>
            <button
              type="button"
              aria-label={`Decrease ${field.name}`}
              onClick={() => step(field.name, -(field.step ?? 0.01), field)}
            >−</button>
            <input
              id={`hub-cf-${field.name}`}
              data-testid={`hub-confirm-field-${field.name}`}
              type={field.type === 'number' ? 'number' : 'text'}
              inputMode={field.type === 'number' ? 'decimal' : undefined}
              step={field.step}
              min={field.min}
              max={field.max}
              value={values[field.name]}
              onChange={(e) => setValues((v) => ({
                ...v,
                [field.name]: field.type === 'number' ? e.target.value : e.target.value,
              }))}
            />
            <button
              type="button"
              aria-label={`Increase ${field.name}`}
              onClick={() => step(field.name, field.step ?? 0.01, field)}
            >+</button>
          </div>
        </div>
      ))}

      <button
        type="button"
        data-testid="hub-confirm-primary"
        className={styles.confirmPrimary}
        onClick={confirm}
      >
        {payload.primaryLabel}
      </button>
    </Sheet>
  )
}
