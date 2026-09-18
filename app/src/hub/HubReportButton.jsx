// W2 / R2 — the one-tap report. The owner's phone is the intake.
//
// ⛔⛔ IT IS NOT PART OF THE PRODUCT AND IT MUST NOT LOOK LIKE IT. This is scaffolding for the
// admin preview: a dashed outline and a plain label, deliberately outside the hub's visual
// language. A member never sees it (admin-gated at the mount), and an admin must never mistake it
// for a feature under evaluation — the whole point is to judge the hub, and a reporting control
// styled like the hub would be part of what is being judged.
//
// ⛔ NEVER IN THE FAN. The fan is the thing under test; a Report bubble would compete with the
// actions for the exact real estate the owner is complaining is overcrowded, and would be
// unreachable in the one state where reporting matters most (a gesture that went wrong and left the
// fan open). It sits outside, reachable in one tap from every state — hub visible, hub hidden.

import { useCallback, useRef, useState } from 'react'

import styles from './hub.module.css'
import { NOTE_MAX, buildReport, sendReport } from './hubReport'

const HUB_ROOT_SELECTOR = '[data-testid="hub-root"]'

/**
 * @param {object} props
 * @param {string|null} [props.mode] The hub mode under the thumb, if any.
 * @param {object} [props.flags] Which variants produced this report (W4 / W5).
 * @param {function} [props.onFiled] Called with a message once the report lands — the host owns
 *   the toast, because a message rendered inside a control its own action unmounts is a message
 *   that renders for zero frames. That defect has shipped in this feature twice.
 */
export default function HubReportButton({ mode = null, flags = {}, onFiled = null }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // ⛔ FROZEN AT TAP TIME. See hubReport.js — by the time this sheet is on screen the fan has
  // closed and the chip has re-rendered, so a payload built on Send would describe the report form
  // rather than the thing being reported.
  const frozen = useRef(null)

  const capture = useCallback(() => {
    const hubEl = typeof document !== 'undefined'
      ? document.querySelector(HUB_ROOT_SELECTOR)
      : null
    frozen.current = buildReport({ hubEl, mode, flags })
    setError(null)
    setNote('')
    setOpen(true)
  }, [mode, flags])

  const submit = useCallback(async () => {
    if (busy) return
    setBusy(true)
    const payload = { ...(frozen.current || buildReport({ mode, flags })), note: note.trim() || null }
    const res = await sendReport(payload)
    setBusy(false)
    if (res.ok) {
      setOpen(false)
      frozen.current = null
      if (onFiled) onFiled(`Report #${res.id} filed.`)
    } else {
      // ⛔ The failure is shown IN the sheet, not as a toast: the sheet is what holds the note the
      // owner just typed, and closing it on failure would throw his words away.
      setError(res.error || 'the report did not send')
    }
  }, [busy, note, mode, flags, onFiled])

  // ⛔ READ FROM THE REAL SHAPE, NOT A REMEMBERED ONE. `gestureTracePayload()` nests its counters
  // under `window` ({capacity, recorded, kept, dropped, firstSeq, lastSeq}); reading
  // `trace.recorded` returned undefined and the sheet cheerfully reported "no trace" while a trace
  // was attached — the third wrong-key read of a working tool in this session, and every one of
  // them failed in the flattering direction.
  const traceWindow = frozen.current?.trace?.window
  const traceRows = traceWindow?.kept ?? frozen.current?.trace?.rows?.length ?? 0
  const recorded = traceWindow?.recorded ?? 0

  return (
    <>
      <button
        type="button"
        className={styles.reportButton}
        data-testid="hub-report-button"
        onClick={capture}
        aria-label="Report a problem with the joystick"
      >
        Report
      </button>

      {open ? (
        <div className={styles.reportSheet} data-testid="hub-report-sheet" role="dialog"
             aria-label="Report a problem with the joystick">
          <div className={styles.reportSheetHead}>
            What went wrong? <span className={styles.reportOptional}>(optional)</span>
          </div>
          <input
            className={styles.reportInput}
            data-testid="hub-report-note"
            type="text"
            inputMode="text"
            maxLength={NOTE_MAX}
            autoFocus
            value={note}
            placeholder="e.g. flick opened the fan instead of firing"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          />
          {/* ⭐ The capture is stated, not implied. "500 events" and "recording was off" are
              different reports and the owner should know which one he is filing BEFORE he sends
              it — an instrument that cannot say what it measured is the shape of every vacuous
              gate in this repo. */}
          <div className={styles.reportMeta} data-testid="hub-report-meta">
            {recorded > 0
              ? `${traceRows} gesture events attached`
              : 'No gesture trace — recording is off in Settings → Joystick'}
          </div>
          {error ? (
            <div className={styles.reportError} data-testid="hub-report-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className={styles.reportActions}>
            <button type="button" className={styles.reportCancel} data-testid="hub-report-cancel"
                    onClick={() => { setOpen(false); frozen.current = null }}>
              Cancel
            </button>
            <button type="button" className={styles.reportSend} data-testid="hub-report-send"
                    onClick={submit} disabled={busy}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
