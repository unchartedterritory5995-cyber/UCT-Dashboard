// app/src/pages/journal/components/ImportWizard.jsx
import { useState, useCallback, useRef, useMemo } from 'react'
import styles from './ImportWizard.module.css'

const TARGET_FIELDS = [
  { key: 'sym', label: 'Symbol', required: true },
  { key: 'direction', label: 'Direction' },
  { key: 'entry_price', label: 'Entry Price' },
  { key: 'exit_price', label: 'Exit Price' },
  { key: 'shares', label: 'Shares' },
  { key: 'entry_date', label: 'Date', required: true },
  { key: 'entry_time', label: 'Time' },
  { key: 'fees', label: 'Fees' },
  { key: 'stop_price', label: 'Stop' },
  { key: 'notes', label: 'Notes' },
]

const STEP_LABELS = ['Upload', 'Map Fields', 'Review & Import']

export default function ImportWizard({ onClose, onComplete }) {
  const [step, setStep] = useState(1)
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [csvContent, setCsvContent] = useState('')
  const [mapping, setMapping] = useState({})
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)
  const dropRef = useRef(null)

  // ── Step 1: File upload ──

  const handleFileSelect = useCallback((selectedFile) => {
    if (!selectedFile) return
    if (!selectedFile.name.endsWith('.csv')) {
      setError('Please select a CSV file.')
      return
    }
    if (selectedFile.size > 5 * 1024 * 1024) {
      setError('File too large. Maximum 5MB.')
      return
    }
    setFile(selectedFile)
    setError(null)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    dropRef.current?.classList.remove(styles.dropZoneActive)
    const droppedFile = e.dataTransfer.files[0]
    handleFileSelect(droppedFile)
  }, [handleFileSelect])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    dropRef.current?.classList.add(styles.dropZoneActive)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    dropRef.current?.classList.remove(styles.dropZoneActive)
  }, [])

  const handleUpload = useCallback(async () => {
    if (!file) return
    setUploading(true)
    setError(null)

    try {
      // Read file content
      const text = await file.text()
      setCsvContent(text)

      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/journal/import', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || `Upload failed (${res.status})`)
      }

      const data = await res.json()
      setPreview(data)
      setMapping(data.auto_mapping || {})
      setStep(2)
    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }, [file])

  // ── Step 2: Field mapping ──

  const handleMappingChange = useCallback((targetField, sourceCol) => {
    setMapping(prev => {
      const next = { ...prev }
      if (sourceCol === '') {
        delete next[targetField]
      } else {
        next[targetField] = sourceCol
      }
      return next
    })
  }, [])

  const mappingValid = useMemo(() => {
    return TARGET_FIELDS
      .filter(f => f.required)
      .every(f => mapping[f.key])
  }, [mapping])

  // ── Step 3: Review & Import ──

  const dupeCount = preview?.duplicate_indices?.length || 0
  const totalRows = preview?.total_rows || 0
  const importCount = totalRows - dupeCount
  const warningCount = preview?.warnings?.length || 0

  const handleConfirmImport = useCallback(async () => {
    setImporting(true)
    setError(null)

    try {
      const res = await fetch('/api/journal/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv_content: csvContent,
          field_mapping: mapping,
          skip_duplicates: true,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || `Import failed (${res.status})`)
      }

      const data = await res.json()
      setResult(data)
    } catch (err) {
      setError(err.message || 'Import failed.')
    } finally {
      setImporting(false)
    }
  }, [csvContent, mapping])

  const handleDone = useCallback(() => {
    if (onComplete) onComplete()
    if (onClose) onClose()
  }, [onComplete, onClose])

  // ── Render ──

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.title}>Import Trades</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close">
            &times;
          </button>
        </div>

        {/* Step indicator */}
        <div className={styles.stepBar}>
          {STEP_LABELS.map((label, i) => {
            const stepNum = i + 1
            const isActive = step === stepNum
            const isDone = step > stepNum || result
            return (
              <div
                key={label}
                className={`${styles.stepItem} ${isActive ? styles.stepActive : ''} ${isDone ? styles.stepDone : ''}`}
              >
                <div className={styles.stepDot}>
                  {isDone ? '\u2713' : stepNum}
                </div>
                <span className={styles.stepLabel}>{label}</span>
              </div>
            )
          })}
        </div>

        {/* Error display */}
        {error && (
          <div className={styles.errorBox}>
            {error}
          </div>
        )}

        {/* Body */}
        <div className={styles.body}>
          {/* ── Step 1: Upload ── */}
          {step === 1 && !result && (
            <div className={styles.uploadStep}>
              <div
                ref={dropRef}
                className={styles.dropZone}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className={styles.fileInput}
                  onChange={e => handleFileSelect(e.target.files[0])}
                />
                {file ? (
                  <div className={styles.fileInfo}>
                    <span className={styles.fileIcon}>&#x1F4C4;</span>
                    <span className={styles.fileName}>{file.name}</span>
                    <span className={styles.fileSize}>
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ) : (
                  <div className={styles.dropPrompt}>
                    <span className={styles.dropIcon}>&#x2912;</span>
                    <span className={styles.dropText}>
                      Drop CSV file here or click to browse
                    </span>
                    <span className={styles.dropHint}>
                      Supports TD Ameritrade, Interactive Brokers, Schwab, TradeStation formats
                    </span>
                  </div>
                )}
              </div>

              <button
                className={styles.primaryBtn}
                onClick={handleUpload}
                disabled={!file || uploading}
              >
                {uploading ? 'Uploading...' : 'Upload & Analyze'}
              </button>
            </div>
          )}

          {/* ── Step 2: Map Fields ── */}
          {step === 2 && !result && preview && (
            <div className={styles.mapStep}>
              {preview.detected_broker && (
                <div className={styles.brokerDetected}>
                  Detected format: <strong>{preview.detected_broker.replace('_', ' ')}</strong>
                </div>
              )}

              <div className={styles.mapGrid}>
                <div className={styles.mapHeaderRow}>
                  <span className={styles.mapHeaderLabel}>Target Field</span>
                  <span className={styles.mapHeaderLabel}>CSV Column</span>
                </div>
                {TARGET_FIELDS.map(field => (
                  <div key={field.key} className={styles.mapRow}>
                    <span className={`${styles.mapTarget} ${field.required ? styles.mapRequired : ''}`}>
                      {field.label}
                      {field.required && <span className={styles.reqStar}>*</span>}
                    </span>
                    <select
                      className={styles.mapSelect}
                      value={mapping[field.key] || ''}
                      onChange={e => handleMappingChange(field.key, e.target.value)}
                    >
                      <option value="">-- Skip --</option>
                      {(preview.headers || []).map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Preview table */}
              {preview.preview_rows && preview.preview_rows.length > 0 && (
                <div className={styles.previewSection}>
                  <div className={styles.previewLabel}>
                    Preview (first {Math.min(5, preview.preview_rows.length)} rows)
                  </div>
                  <div className={styles.previewTableWrap}>
                    <table className={styles.previewTable}>
                      <thead>
                        <tr>
                          <th>#</th>
                          {Object.keys(mapping).filter(k => mapping[k]).map(k => (
                            <th key={k}>{TARGET_FIELDS.find(f => f.key === k)?.label || k}</th>
                          ))}
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.preview_rows.slice(0, 5).map((row, i) => {
                          const isDupe = (preview.duplicate_indices || []).includes(i)
                          return (
                            <tr key={i} className={isDupe ? styles.dupeRow : ''}>
                              <td className={styles.previewRowNum}>{i + 1}</td>
                              {Object.keys(mapping).filter(k => mapping[k]).map(k => (
                                <td key={k} className={styles.previewCell}>
                                  {row[k] != null ? String(row[k]) : '--'}
                                </td>
                              ))}
                              <td>
                                {isDupe && (
                                  <span className={styles.dupeBadge}>DUPLICATE</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className={styles.stepActions}>
                <button className={styles.backBtn} onClick={() => setStep(1)}>
                  Back
                </button>
                <button
                  className={styles.primaryBtn}
                  onClick={() => setStep(3)}
                  disabled={!mappingValid}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Review & Import ── */}
          {step === 3 && !result && (
            <div className={styles.reviewStep}>
              <div className={styles.reviewSummary}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryValue}>{totalRows}</span>
                  <span className={styles.summaryLabel}>Total rows</span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={`${styles.summaryValue} ${styles.summaryGain}`}>{importCount}</span>
                  <span className={styles.summaryLabel}>To import</span>
                </div>
                {dupeCount > 0 && (
                  <div className={styles.summaryItem}>
                    <span className={`${styles.summaryValue} ${styles.summaryWarn}`}>{dupeCount}</span>
                    <span className={styles.summaryLabel}>Duplicates (skip)</span>
                  </div>
                )}
                {warningCount > 0 && (
                  <div className={styles.summaryItem}>
                    <span className={`${styles.summaryValue} ${styles.summaryWarn}`}>{warningCount}</span>
                    <span className={styles.summaryLabel}>Warnings</span>
                  </div>
                )}
              </div>

              {/* Warnings */}
              {preview?.warnings && preview.warnings.length > 0 && (
                <div className={styles.warningPanel}>
                  <div className={styles.warningTitle}>Warnings</div>
                  {preview.warnings.slice(0, 10).map((w, i) => (
                    <div key={i} className={styles.warningRow}>{w}</div>
                  ))}
                  {preview.warnings.length > 10 && (
                    <div className={styles.warningMore}>
                      ...and {preview.warnings.length - 10} more
                    </div>
                  )}
                </div>
              )}

              {/* Mapping summary */}
              <div className={styles.mappingSummary}>
                <div className={styles.mappingSummaryTitle}>Field Mapping</div>
                {Object.entries(mapping).filter(([, v]) => v).map(([target, source]) => (
                  <div key={target} className={styles.mappingSummaryRow}>
                    <span className={styles.mappingSummaryTarget}>
                      {TARGET_FIELDS.find(f => f.key === target)?.label || target}
                    </span>
                    <span className={styles.mappingSummaryArrow}>&rarr;</span>
                    <span className={styles.mappingSummarySource}>{source}</span>
                  </div>
                ))}
              </div>

              <div className={styles.stepActions}>
                <button className={styles.backBtn} onClick={() => setStep(2)}>
                  Back
                </button>
                <button
                  className={styles.importBtn}
                  onClick={handleConfirmImport}
                  disabled={importing || importCount === 0}
                >
                  {importing ? (
                    <span className={styles.importingText}>
                      <span className={styles.spinner} />
                      Importing...
                    </span>
                  ) : (
                    `Import ${importCount} Trade${importCount !== 1 ? 's' : ''}`
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── Result ── */}
          {result && (
            <div className={styles.resultStep}>
              <div className={styles.resultIcon}>&#x2713;</div>
              <div className={styles.resultTitle}>Import Complete</div>
              <div className={styles.resultDetails}>
                <div className={styles.resultRow}>
                  <span>Created:</span>
                  <span className={styles.resultGain}>{result.imported}</span>
                </div>
                <div className={styles.resultRow}>
                  <span>Skipped:</span>
                  <span className={styles.resultMuted}>{result.duplicates}</span>
                </div>
                <div className={styles.resultRow}>
                  <span>Total:</span>
                  <span>{result.total}</span>
                </div>
              </div>
              {result.warnings && result.warnings.length > 0 && (
                <div className={styles.warningPanel}>
                  <div className={styles.warningTitle}>Warnings</div>
                  {result.warnings.slice(0, 5).map((w, i) => (
                    <div key={i} className={styles.warningRow}>{w}</div>
                  ))}
                </div>
              )}
              <button className={styles.primaryBtn} onClick={handleDone}>
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
