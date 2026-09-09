// app/src/hub/StopConfirmSheet.jsx — the Journal scrub's write door (Phase 3 §3.4 / §4 A3).
//
// ⛔ A GESTURE NEVER COMMITS DIRECTLY. The drag PROPOSES a stop; this sheet is the only thing
// that writes one, and `onConfirm` fires AT MOST ONCE per sheet (a ref latch, not state — the
// second tap of a double-tap arrives before a state write can reach the callback).
//
// ⛔ THE STEPPERS AND THE FIELD ARE THE EQUAL PATH, NOT A FALLBACK (WCAG 2.5.1). A member with
// a tremor, a prosthetic, or one hand on a train must reach the SAME stop at the SAME precision
// as the drag. That requirement is the reason this sheet exists at all rather than the release
// of a drag writing straight through — so the +/- buttons and the numeric input operate on the
// same value the gesture produced, at the same 0.01 tick.
//
// ⛔ WHY THIS IS NOT `HubConfirmSheet`. That sheet renders a `HubConfirmPayload`: a title, a
// body string, a primary label and generic number fields. It cannot refuse a value. This one
// must — a stop that flips the position's side is not "a very wide stop", it means the position
// is no longer the trade it was — and the refusal has to be a sentence about the member's trade,
// recomputed as they step, with the primary button DISABLED while it stands. `HubConfirmSheet`
// is Director-owned; widening it mid-wave would put a second authority on what a confirm sheet
// is. The payload SHAPE is still honoured: `validateConfirmPayload` runs on the same four fields
// this sheet renders, so a drift in the contract fails here too.
//
// ⭐ EVERY NUMBER THE MEMBER READS IS DERIVED, NOT RESTATED. R comes from
// `calculations.rAtStop` (D-34) — nothing in the hub computes R — and the side-flip sentence and
// the tick clamp come from `journalSection.js`, the same functions the gesture uses. A second
// opinion here would be invisible: a wrong R still renders as a plausible number.

import { useCallback, useMemo, useRef, useState } from 'react'
import Sheet from '../components/mobile/Sheet'
import { validateConfirmPayload } from './contracts'
import {
  STOP_TICK, clampStopToSide, formatR, rForCandidate, round2, sideFlipRefusal,
} from './sections/journalSection'
import styles from './hub.module.css'

const money = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—')

/**
 * @param {Object} props
 * @param {string} props.symbol
 * @param {'Long'|'Short'} props.side
 * @param {number|null} props.entry
 * @param {number|null} props.shares
 * @param {number|null} props.currentStop   the stop the position has right now
 * @param {number|null} props.originalStop  the RISK BASIS for R (the stored stop)
 * @param {number} props.stop               the candidate the gesture (or the fan) proposed
 * @param {string} [props.title]
 * @param {(price: number) => void} props.onConfirm
 * @param {() => void} props.onClose
 */
export default function StopConfirmSheet({
  symbol,
  side,
  entry,
  shares,
  currentStop,
  originalStop,
  stop,
  title = 'Set stop',
  onConfirm,
  onClose,
}) {
  const [value, setValue] = useState(() => round2(stop).toFixed(2))
  const firedRef = useRef(false)

  const numeric = Number(value)
  const parsed = Number.isFinite(numeric) ? round2(numeric) : null

  // The same risk basis the scrub readout uses, so the sheet and the chip can never disagree
  // about what R the member is about to lock in.
  const rCtx = useMemo(
    () => ({ entry, originalStop, side, shares }),
    [entry, originalStop, side, shares],
  )
  const r = parsed === null ? null : rForCandidate(rCtx, parsed)
  const refusal = parsed === null ? null : sideFlipRefusal({ stop: parsed, entry, side })
  const blocked = parsed === null || refusal !== null

  const primaryLabel = `Set stop ${parsed === null ? '—' : parsed.toFixed(2)}`
  const body = `${symbol} ${String(side).toLowerCase()} — current stop ${money(currentStop)}, `
    + `new stop ${parsed === null ? '—' : parsed.toFixed(2)}`

  // Validated at the boundary, on the payload shape the contract declares. Cheap: once per
  // render of an open sheet, and it is the one check that catches a blank body or a dead
  // primary button — the silent failures this validator exists for.
  validateConfirmPayload({
    title,
    body,
    primaryLabel,
    onConfirm: () => {},
    fields: [{ name: 'stop', type: 'number', value: value, step: STOP_TICK, min: STOP_TICK }],
  }, 'StopConfirmSheet')

  const step = useCallback((direction) => {
    setValue((cur) => {
      const base = Number.isFinite(Number(cur)) ? Number(cur) : Number(stop)
      // Clamped through the SAME function the gesture uses, so the accessible path cannot
      // reach a value the drag refuses (and vice versa).
      const nextValue = clampStopToSide({
        stop: base + direction * STOP_TICK, entry, side,
      })
      return (nextValue === null ? base : nextValue).toFixed(2)
    })
  }, [stop, entry, side])

  const confirm = useCallback(() => {
    if (firedRef.current || blocked || parsed === null) return
    firedRef.current = true
    onConfirm?.(parsed)
  }, [blocked, parsed, onConfirm])

  return (
    <Sheet open onClose={onClose} variant="auto" title={title} ariaLabel={title}>
      <div className={styles.confirmBody} data-testid="hub-stop-body">
        <p data-testid="hub-stop-symbol">{symbol} {String(side).toLowerCase()}</p>
        <p data-testid="hub-stop-current">Current stop {money(currentStop)}</p>
        <p data-testid="hub-stop-new">New stop {parsed === null ? '—' : parsed.toFixed(2)}</p>
        <p data-testid="hub-stop-r">New R {formatR(r)}</p>
      </div>

      <div className={styles.confirmField}>
        <label htmlFor="hub-stop-input">Stop price</label>
        <div className={styles.confirmStepper}>
          <button type="button" aria-label="Decrease stop" onClick={() => step(-1)}>−</button>
          <input
            id="hub-stop-input"
            data-testid="hub-stop-input"
            type="number"
            inputMode="decimal"
            step={STOP_TICK}
            min={STOP_TICK}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="button" aria-label="Increase stop" onClick={() => step(1)}>+</button>
        </div>
      </div>

      {refusal && (
        // A sentence about their trade, not a validation code. Rendered TEXT is what the test
        // asserts: a refusal the member never sees is the same as no refusal at all.
        <p role="alert" data-testid="hub-stop-refusal" className={styles.confirmBody}>{refusal}</p>
      )}

      <button
        type="button"
        data-testid="hub-stop-primary"
        className={styles.confirmPrimary}
        disabled={blocked}
        onClick={confirm}
      >
        {primaryLabel}
      </button>
      <button type="button" data-testid="hub-stop-cancel" onClick={onClose}>Cancel</button>
    </Sheet>
  )
}
