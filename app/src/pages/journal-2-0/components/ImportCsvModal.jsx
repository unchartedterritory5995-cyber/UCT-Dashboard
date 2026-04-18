/**
 * Import CSV modal — Journal 2.0.
 * Spec §13 full flow.
 *
 * Steps:
 *   1. Drop — dropzone + template downloads; on file select → preview
 *   2. Mapping — shown only when backend returns format=unknown
 *   3. Preview — parsed trades + errors; user confirms
 *
 * On confirm: POST /api/j2/trades/import/confirm → toast + refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import CsvColumnMapper from './CsvColumnMapper'
import {
  downloadPreMatchedTemplate,
  downloadRawExecutionsTemplate,
} from '../lib/csvTemplates'
import { money, moneySigned, rMultiple as fmtR, dateShort } from '../../../lib/journal-2-0'
import shellStyles from './ModalShell.module.css'
import styles from './ImportCsvModal.module.css'

const MAX_BYTES = 10 * 1024 * 1024

function resultBadge(result) {
  const cls =
    result === 'Win'
      ? styles.badgeWin
      : result === 'Loss'
        ? styles.badgeLoss
        : styles.badgeBe
  return <span className={`${styles.badge} ${cls}`}>{result}</span>
}

export default function ImportCsvModal({ onConfirmed, onClose }) {
  const [step, setStep] = useState('drop') // drop | mapping | preview
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null) // backend response
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const postPreview = useCallback(async (f) => {
    setErrorMsg('')
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', f)
      const res = await fetch('/api/j2/trades/import/preview', {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(body || `${res.status}`)
      }
      const data = await res.json()
      setPreview(data)
      if (data.format === 'unknown') setStep('mapping')
      else setStep('preview')
    } catch (e) {
      setErrorMsg(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }, [])

  const postPreviewMapped = useCallback(async (mapping) => {
    setErrorMsg('')
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('mapping', JSON.stringify(mapping))
      const res = await fetch('/api/j2/trades/import/preview-mapped', {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(body || `${res.status}`)
      }
      const data = await res.json()
      setPreview(data)
      setStep('preview')
    } catch (e) {
      setErrorMsg(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }, [file])

  const handleFile = useCallback(
    (f) => {
      setErrorMsg('')
      if (!f) return
      if (f.size > MAX_BYTES) {
        setErrorMsg(`File exceeds ${MAX_BYTES / (1024 * 1024)} MB limit`)
        return
      }
      setFile(f)
      postPreview(f)
    },
    [postPreview],
  )

  const onDrop = useCallback(
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)
      const f = e.dataTransfer.files?.[0]
      handleFile(f)
    },
    [handleFile],
  )

  const handleConfirm = useCallback(async () => {
    if (!preview?.trades?.length) return
    setBusy(true)
    setErrorMsg('')
    try {
      const res = await fetch('/api/j2/trades/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ trades: preview.trades }),
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(body || `${res.status}`)
      }
      const data = await res.json()
      onConfirmed?.(data.imported, preview.errors?.length || 0)
      onClose?.()
    } catch (e) {
      setErrorMsg(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }, [preview, onConfirmed, onClose])

  const reset = () => {
    setFile(null)
    setPreview(null)
    setStep('drop')
  }

  const formatLabel =
    preview?.format === 'pre_matched'
      ? 'Pre-matched'
      : preview?.format === 'mapped'
        ? 'Mapped (user wizard)'
        : preview?.format
          ? preview.format.charAt(0).toUpperCase() + preview.format.slice(1)
          : ''

  return (
    <div
      className={shellStyles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      role="presentation"
    >
      <div
        className={`${shellStyles.modal} ${styles.wideModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-csv-title"
      >
        <div className={shellStyles.header}>
          <h2 id="import-csv-title" className={shellStyles.title}>
            Import Trades from CSV
          </h2>
          <button
            type="button"
            className={shellStyles.xBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={shellStyles.body}>
          {/* STEP 1: drop */}
          {step === 'drop' && (
            <>
              <div
                className={`${styles.dropzone} ${dragActive ? styles.dropzoneActive : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDragActive(true)
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                role="button"
                tabIndex={0}
                aria-label="CSV file drop zone"
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                  style={{ display: 'none' }}
                />
                <div className={styles.dropInner}>
                  <div className={styles.dropIcon}>📄</div>
                  <p>
                    <strong>Drop a CSV file here</strong> or click to browse.
                  </p>
                  <p className={styles.dropHint}>
                    Max 10 MB. UTF-8 or Windows-1252 text only.
                  </p>
                </div>
              </div>

              <div className={styles.formats}>
                <div className={styles.formatsTitle}>Supported formats</div>
                <ul className={styles.formatList}>
                  <li><strong>Pre-matched</strong> — canonical format, required columns: symbol, side, shares, entry_price, entry_date, exit_price, exit_date. ISO dates.</li>
                  <li><strong>Schwab</strong> — web-export Brokerage transactions download. Auto-detected.</li>
                  <li><strong>IBKR</strong> — Trade Confirmation Report, stocks only. Auto-detected.</li>
                  <li><strong>E*Trade</strong> — Portfolio download, Bought/Sold rows only. Auto-detected.</li>
                  <li><strong>Unknown</strong> — map columns manually via wizard.</li>
                </ul>
              </div>

              <div className={styles.templateRow}>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={downloadPreMatchedTemplate}
                >
                  ⬇ Pre-matched template
                </button>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={downloadRawExecutionsTemplate}
                >
                  ⬇ Raw executions template
                </button>
              </div>
            </>
          )}

          {/* STEP 2: mapping wizard */}
          {step === 'mapping' && preview && (
            <CsvColumnMapper
              headers={preview.headers}
              rawRows={preview.raw_rows}
              onMap={postPreviewMapped}
              onCancel={reset}
            />
          )}

          {/* STEP 3: preview */}
          {step === 'preview' && preview && (
            <>
              <div className={styles.summary}>
                <span>
                  <strong>Format:</strong> {formatLabel}
                </span>
                <span>
                  <strong>{preview.trades.length}</strong> ready to import
                </span>
                {preview.errors.length > 0 && (
                  <span className={styles.warn}>
                    {preview.errors.length} skipped
                  </span>
                )}
              </div>

              {preview.warnings?.length > 0 && (
                <div className={styles.warnings}>
                  {preview.warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              )}

              {preview.trades.length > 0 && (
                <div className={styles.previewTableWrap}>
                  <table className={styles.previewTable}>
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Side</th>
                        <th>Shares</th>
                        <th>Entry</th>
                        <th>Exit</th>
                        <th>Entry Date</th>
                        <th>Exit Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.trades.slice(0, 20).map((t, i) => (
                        <tr key={i}>
                          <td>{t.symbol}</td>
                          <td>{t.side}</td>
                          <td>{t.shares}</td>
                          <td>{money(t.entryPrice)}</td>
                          <td>{money(t.exitPrice)}</td>
                          <td>{dateShort(t.entryDate)}</td>
                          <td>{dateShort(t.exitDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.trades.length > 20 && (
                    <p className={styles.previewMore}>
                      … and {preview.trades.length - 20} more rows (all will import).
                    </p>
                  )}
                </div>
              )}

              {preview.errors.length > 0 && (
                <details className={styles.errorsDetails}>
                  <summary>
                    {preview.errors.length} row{preview.errors.length === 1 ? '' : 's'} skipped — show details
                  </summary>
                  <ul className={styles.errorsList}>
                    {preview.errors.slice(0, 50).map((e, i) => (
                      <li key={i}>
                        <strong>Row {e.row}:</strong> {e.message}
                      </li>
                    ))}
                    {preview.errors.length > 50 && (
                      <li className={styles.errorsMore}>
                        … and {preview.errors.length - 50} more
                      </li>
                    )}
                  </ul>
                </details>
              )}
            </>
          )}

          {errorMsg && (
            <div className={shellStyles.errorBanner} role="alert">
              {errorMsg}
            </div>
          )}
        </div>

        <div className={shellStyles.footer}>
          <button
            type="button"
            className={shellStyles.ghostBtn}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          {step === 'preview' && (
            <>
              <button
                type="button"
                className={shellStyles.ghostBtn}
                onClick={reset}
                disabled={busy}
              >
                Start over
              </button>
              <button
                type="button"
                className={shellStyles.primaryBtn}
                onClick={handleConfirm}
                disabled={busy || !preview.trades.length}
              >
                {busy
                  ? 'Importing…'
                  : `Import ${preview.trades.length} trade${preview.trades.length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
          {step === 'drop' && busy && (
            <span className={styles.busy}>Parsing…</span>
          )}
        </div>
      </div>
    </div>
  )
}
