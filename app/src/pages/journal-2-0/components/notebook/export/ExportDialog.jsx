// Notebook export dialog — the exit that makes the entrance possible. One
// click, no configuration: every note this member owns, as markdown + front
// matter (+ bundled attachments), in the SAME shape the import wizard reads
// back in (see ../import/ImportWizard.jsx). Nobody moves a decade of notes
// into a product they cannot leave, so this must be as easy to find as the
// import affordance it sits next to in NotebookTab's toolbar.
//
// The server build can take real time on a large library (GET
// /api/j2/notes/export streams a temp file back rather than holding the
// whole archive in memory) — this dialog exists specifically so that wait is
// never silent: a spinner + status text runs the whole time, matching the
// import wizard's own scanning/running steps.
import { useCallback, useEffect, useRef, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import UIcon from '../../../../../components/ui/UIcon'
import styles from './ExportDialog.module.css'

function filenameFromDisposition(header) {
  const m = /filename="([^"]+)"/.exec(header || '')
  return m ? m[1] : 'notebook-export.zip'
}

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
  // Guards a slow response landing after the dialog was closed and reopened
  // — same shape as ImportWizard's generationRef.
  const generationRef = useRef(0)

  const reset = useCallback(() => {
    generationRef.current += 1
    setStep('idle')
    setError('')
  }, [])

  // Fresh state every time the dialog is reopened.
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
      const res = await fetch('/api/j2/notes/export', { credentials: 'include' })
      if (generationRef.current !== gen) return
      if (!res.ok) throw new Error(await readErrorMessage(res))
      const blob = await res.blob()
      if (generationRef.current !== gen) return
      const filename = filenameFromDisposition(res.headers.get('content-disposition'))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Give the click a tick to hand off to the browser's download manager
      // before the object URL is revoked.
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setStep('done')
    } catch (err) {
      if (generationRef.current !== gen) return
      setError(err?.message || 'Something went wrong while preparing your export.')
      setStep('error')
    }
  }, [])

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title="Export your notebook"
      variant="auto"
      maxWidth={480}
      dismissOnBackdrop={step !== 'running'}
    >
      <div className={styles.wrap}>
        {step === 'idle' && (
          <>
            <p className={styles.body}>
              Downloads every note in your notebook as Markdown files, organized by
              your folders, with images and attachments bundled into one zip archive
              — the same format the importer reads, so you can bring your notes to
              another app any time.
            </p>
            <div className={styles.actions}>
              <button type="button" className="btn btn-secondary" onClick={handleClose}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleDownload}>
                <UIcon name="download" size={16} gold={false} />
                Download
              </button>
            </div>
          </>
        )}

        {step === 'running' && (
          <div className={styles.statusWrap}>
            <div className={styles.spinner} aria-hidden="true" />
            <p>Preparing your export — this can take a moment for large notebooks…</p>
          </div>
        )}

        {step === 'done' && (
          <div className={styles.statusWrap}>
            <UIcon name="check" size={26} gold={false} className={styles.successIcon} />
            <p>Your download has started.</p>
            <button type="button" className="btn btn-primary" onClick={handleClose}>
              Done
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className={styles.statusWrap}>
            <UIcon name="warning" size={26} gold={false} className={styles.errorIcon} />
            <p>{error}</p>
            <button type="button" className="btn btn-secondary" onClick={() => setStep('idle')}>
              Try again
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
