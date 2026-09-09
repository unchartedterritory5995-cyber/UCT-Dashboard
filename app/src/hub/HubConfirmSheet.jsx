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

  const firedRef = useRef(false)
  const [values, setValues] = useState(() => (
    Object.fromEntries((payload?.fields ?? []).map((f) => [f.name, f.value]))
  ))

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
