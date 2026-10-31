// app/src/components/chart/supportLoop/ReportMismatchDialog.jsx
//
// ─── A3 — "DOESN'T MATCH TRADINGVIEW?", THE OPT-IN REPORT ───────────────────
//
// Spec: `docs/pine/support-loop/PHASE-A.md`. Lazy-loaded (`LazyReportMismatchDialog`)
// so the import box and the chart chunk pay nothing for it until a member opens it.
//
// ⛔⛔ THE ONE PLACE A MEMBER'S SCRIPT IS SENT, AND ONLY BY THEIR CHOICE. The dialog
// says in plain words that the code goes to UCT and is kept to improve support, and
// the Send button stays disabled until the consent box is ticked. The server holds
// the same line independently (`indicator_support.create_report` refuses without
// `consent: true`, and the table has `CHECK (consent = 1)`), so a client bug here
// cannot store a script on its own.
//
// ⭐ AND THE MEMBER CAN TAKE IT BACK. Earlier reports are listed under the form with
// their status, each with a Withdraw button that deletes it.

import { useCallback, useEffect, useId, useState } from 'react'
import Sheet from '../../mobile/Sheet'
import { submitReport, myReports, withdrawReport } from './supportApi'
import styles from './ReportMismatchDialog.module.css'

const STATUS_LABEL = Object.freeze({
  new: 'Received',
  triaged: 'Being looked at',
  fixed: 'Fixed',
  wontfix: 'Closed, can’t be supported',
})

function shortDate(iso) {
  if (typeof iso !== 'string') return ''
  return iso.slice(0, 10)
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string|null} [props.source]  the script's code, when the caller has it;
 *        absent (a saved formula keeps only its compiled tree) the member pastes it
 * @param {string|null} [props.sym]  the symbol the member is viewing
 * @param {string|null} [props.tf]   the timeframe the member is viewing
 * @param {Array<{name: string, kind: string}>} [props.gaps] the translator's gap list
 *        (allowlisted names only — `gapLogPayload(...).gaps`)
 * @param {string|null} [props.name] the indicator's name, for the title line
 * @param {number} [props.maxSourceBytes]
 */
export default function ReportMismatchDialog({
  open, onClose, source = null, sym = null, tf = null, gaps = [], name = null,
  maxSourceBytes = 131072, maxNoteChars = 1000,
}) {
  const uid = useId()
  const [consent, setConsent] = useState(false)
  const [note, setNote] = useState('')
  const [link, setLink] = useState('')
  const [pasted, setPasted] = useState('')
  const [state, setState] = useState({ phase: 'idle', error: null, report: null })
  const [mine, setMine] = useState([])

  // ⭐ The host mounts this only while open (`LazyReportMismatchDialog`), so every
  // opening starts from the initial state above; only the member's list is fetched.
  const refresh = useCallback(() => { myReports().then(setMine) }, [])
  useEffect(() => { if (open) refresh() }, [open, refresh])

  const code = (typeof source === 'string' && source.trim()) ? source : pasted
  const codeBytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(code).length : code.length
  const tooBig = codeBytes > maxSourceBytes
  const canSend = consent && code.trim() !== '' && !tooBig && state.phase !== 'busy'

  const send = useCallback(async () => {
    if (!canSend) return
    setState({ phase: 'busy', error: null, report: null })
    const res = await submitReport({
      consent: true,
      source: code,
      note: note.trim() || null,
      tradingview_link: link.trim() || null,
      symbol: sym || null,
      timeframe: tf || null,
      gaps: (gaps || []).map((g) => ({ name: g.name, kind: g.kind })),
    })
    if (res.ok) {
      setState({ phase: 'done', error: null, report: res.report })
      refresh()
    } else {
      setState({ phase: 'idle', error: res.error, report: null })
    }
  }, [canSend, code, note, link, sym, tf, gaps, refresh])

  const withdraw = useCallback(async (id) => {
    const ok = await withdrawReport(id)
    if (ok) setMine((rows) => rows.filter((r) => r.id !== id))
  }, [])

  return (
    <Sheet open={open} onClose={onClose} variant="auto" title="Doesn’t match TradingView?" labelledByTitle maxWidth={520}>
      <div className={styles.root} data-testid="report-mismatch-dialog">
        {state.phase === 'done' ? (
          <p className={styles.done} role="status" data-testid="report-mismatch-done">
            Thanks, your report was sent{state.report && state.report.duplicate ? ' (you had already sent this script, so it was not stored twice)' : ''}.
            Its status is shown below, and you can withdraw it at any time.
          </p>
        ) : (
          <>
            <p className={styles.lead}>
              Tell us where {name ? <b>{name}</b> : 'this indicator'} looks different from TradingView and
              we’ll use it to improve support.
            </p>
            <p className={styles.privacy} data-testid="report-mismatch-privacy">
              Sending this report sends the script’s code to UCT. We keep it only to improve
              support for TradingView scripts, and you can withdraw the report, which deletes it,
              at any time.
            </p>
            {!(typeof source === 'string' && source.trim()) && (
              <div className={styles.field}>
                <label htmlFor={`${uid}-code`}>The script’s code</label>
                <textarea
                  id={`${uid}-code`} className={styles.code} rows={5}
                  value={pasted} onChange={(e) => setPasted(e.target.value)}
                  data-testid="report-mismatch-code"
                  placeholder="Paste the script from TradingView’s Pine editor"
                />
              </div>
            )}
            {tooBig && (
              <p className={styles.err} role="alert">
                This script is larger than the {Math.round(maxSourceBytes / 1024)} KB a report can carry.
              </p>
            )}
            <div className={styles.field}>
              <label htmlFor={`${uid}-note`}>What looks different? <span className={styles.opt}>(optional)</span></label>
              <textarea
                id={`${uid}-note`} rows={3} maxLength={maxNoteChars}
                value={note} onChange={(e) => setNote(e.target.value)}
                data-testid="report-mismatch-note"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor={`${uid}-link`}>TradingView link <span className={styles.opt}>(optional)</span></label>
              <input
                id={`${uid}-link`} type="url" inputMode="url" maxLength={300}
                placeholder="https://www.tradingview.com/script/…"
                value={link} onChange={(e) => setLink(e.target.value)}
                data-testid="report-mismatch-link"
              />
            </div>
            <p className={styles.meta} data-testid="report-mismatch-context">
              {sym ? `Symbol ${sym}` : 'No symbol'}{tf ? ` · timeframe ${tf}` : ''}
              {gaps && gaps.length ? ` · unsupported: ${gaps.map((g) => g.name).join(', ')}` : ''}
            </p>
            <label className={styles.ack}>
              <input
                type="checkbox" checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                data-testid="report-mismatch-consent"
              />
              <span>Send this script’s code to UCT and keep it to improve support</span>
            </label>
            {state.error && <p className={styles.err} role="alert">{state.error}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={onClose}>Cancel</button>
              <button
                type="button" className={`${styles.btn} ${styles.primary}`}
                disabled={!canSend} onClick={send}
                data-testid="report-mismatch-send"
              >
                {state.phase === 'busy' ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </>
        )}
        {mine.length > 0 && (
          <section className={styles.mine} aria-label="Your reports">
            <h3 className={styles.mineHead}>Your reports</h3>
            <ul data-testid="report-mismatch-mine">
              {mine.map((r) => (
                <li key={r.id} className={styles.mineRow}>
                  <span>{shortDate(r.created_at)}{r.symbol ? ` · ${r.symbol}` : ''}</span>
                  <span className={styles.status} data-status={r.status}>{STATUS_LABEL[r.status] || r.status}</span>
                  <button type="button" className={styles.linkBtn} onClick={() => withdraw(r.id)}>
                    Withdraw
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  )
}
