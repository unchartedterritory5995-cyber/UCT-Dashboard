// Notebook export dialog — the exit that makes the entrance possible. Every note this
// member owns, in ONE archive, in the format they choose (wave 8 lane 8C adds the choice:
// Markdown — the default, and the SAME shape the import wizard reads back — a web page,
// lossless JSON, or Word). Nobody moves a decade of notes into a product they cannot
// leave, so this must be as easy to find as the import affordance it sits next to in
// NotebookTab's toolbar.
//
// The server build can take real time on a large library (the export routes stream a temp
// file back rather than holding the whole archive in memory) — this dialog exists
// specifically so that wait is never silent: a spinner + status text runs the whole time,
// matching the import wizard's own scanning/running steps.
//
// ⛔ The format choice is a REAL radio group (native inputs, one name, one legend): arrow
// keys move between formats and a screen reader announces "Format, radio group, 1 of 4".
// Each option says what it keeps (exportFormats.js). The radio's NAME is the format alone
// (`aria-labelledby`) and what it keeps is its DESCRIPTION (`aria-describedby`) — the whole
// row is still the click target, but a name that swallowed the sentence would be read in full
// on every arrow key.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import UIcon from '../../../../../components/ui/UIcon'
import {
  DEFAULT_EXPORT_FORMAT, EXPORT_FORMATS, notebookExportUrl, saveResponse,
} from './exportFormats'
import styles from './ExportDialog.module.css'

async function readErrorMessage(res) {
  if (res.status === 429) {
    return 'An export is already running for your account. Please wait a moment and try again.'
  }
  try {
    const body = await res.json()
    if (body?.detail) return String(body.detail)
  } catch {
    // not JSON — fall through to the generic message
  }
  return `Something went wrong while preparing your export (server returned ${res.status}).`
}

export default function ExportDialog({ open, onClose }) {
  const [step, setStep] = useState('idle') // idle | running | done | error
  const [error, setError] = useState('')
  const [format, setFormat] = useState(DEFAULT_EXPORT_FORMAT)
  const groupId = useId()
  // Guards a slow response landing after the dialog was closed and reopened
  // — same shape as ImportWizard's generationRef.
  const generationRef = useRef(0)

  const reset = useCallback(() => {
    generationRef.current += 1
    setStep('idle')
    setError('')
  }, [])

  // Fresh state every time the dialog is reopened (the format choice is kept for the
  // session: a member who exports twice usually wants the same format twice).
  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  // Sheet calls this unconditionally on Escape — no-op it mid-download so a
  // stray Escape can't make the export look abandoned (the browser download
  // itself is unaffected either way; this is purely about not showing a
  // dialog that silently vanished while the member is still waiting on it).
  const handleClose = useCallback(() => {
    if (step === 'running') return
    onClose?.()
  }, [step, onClose])

  const handleDownload = useCallback(async () => {
    const gen = generationRef.current
    setStep('running')
    setError('')
    try {
      const res = await fetch(notebookExportUrl(format), { credentials: 'include' })
      if (generationRef.current !== gen) return
      if (!res.ok) throw new Error(await readErrorMessage(res))
      if (generationRef.current !== gen) return
      await saveResponse(res, 'notebook-export.zip')
      setStep('done')
    } catch (err) {
      if (generationRef.current !== gen) return
      setError(err?.message || 'Something went wrong while preparing your export.')
      setStep('error')
    }
  }, [format])

  const chosen = EXPORT_FORMATS.find((f) => f.id === format) || EXPORT_FORMATS[0]

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title="Export your notebook"
      variant="auto"
      maxWidth={520}
      dismissOnBackdrop={step !== 'running'}
    >
      <div className={styles.wrap}>
        {step === 'idle' && (
          <>
            <p className={styles.body}>
              Downloads every note in your notebook as one zip archive, organized by your
              folders, with images and attachments included.
            </p>
            <fieldset className={styles.formats}>
              <legend className={styles.legend}>Format</legend>
              {EXPORT_FORMATS.map((f) => {
                const id = `${groupId}-${f.id}`
                return (
                  <label key={f.id} htmlFor={id}
                    className={`${styles.option} ${format === f.id ? styles.optionOn : ''}`}>
                    <input
                      id={id}
                      type="radio"
                      name={`${groupId}-format`}
                      value={f.id}
                      checked={format === f.id}
                      onChange={() => setFormat(f.id)}
                      aria-labelledby={`${id}-label`}
                      aria-describedby={`${id}-keeps`}
                      className={styles.radio}
                    />
                    <span className={styles.optionText}>
                      <span id={`${id}-label`} className={styles.optionLabel}>{f.label}</span>
                      <span id={`${id}-keeps`} className={styles.optionKeeps}>{f.keeps}</span>
                    </span>
                  </label>
                )
              })}
            </fieldset>
            <p className={styles.hint}>
              For a PDF, open a note and choose Print, then Save as PDF.
            </p>
            <div className={styles.actions}>
              <button type="button" className={`btn btn-secondary ${styles.action}`} onClick={handleClose}>
                Cancel
              </button>
              <button type="button" className={`btn btn-primary ${styles.action}`} onClick={handleDownload}>
                <UIcon name="download" size={16} gold={false} />
                Download {chosen.label}
              </button>
            </div>
          </>
        )}

        {step === 'running' && (
          <div className={styles.statusWrap} role="status">
            <div className={styles.spinner} aria-hidden="true" />
            <p>Preparing your export — this can take a moment for large notebooks…</p>
          </div>
        )}

        {step === 'done' && (
          <div className={styles.statusWrap} role="status">
            <UIcon name="check" size={26} gold={false} className={styles.successIcon} />
            <p>Your download has started.</p>
            <button type="button" className={`btn btn-primary ${styles.action}`} onClick={handleClose}>
              Done
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className={styles.statusWrap} role="alert">
            <UIcon name="warning" size={26} gold={false} className={styles.errorIcon} />
            <p>{error}</p>
            <button type="button" className={`btn btn-secondary ${styles.action}`} onClick={() => setStep('idle')}>
              Try again
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
