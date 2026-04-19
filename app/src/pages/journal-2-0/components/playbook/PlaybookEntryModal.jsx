/**
 * Playbook entry modal — create a new observation or edit an existing one.
 * Supports all fields: symbol, date, setup, thesis, levels, status,
 * attachments (screenshots + links), and notes.
 */

import { useEffect, useRef, useState } from 'react'
import useJ2Settings from '../../hooks/useJ2Settings'
import { todayET } from '../../lib/calendar'
import styles from './PlaybookEntryModal.module.css'

const STATUS_OPTIONS = [
  { key: 'watching',  label: '👀 Watching' },
  { key: 'triggered', label: '⚡ Triggered' },
  { key: 'traded',    label: '📈 Traded' },
  { key: 'passed',    label: '⏭ Passed' },
  { key: 'dead',      label: '💀 Dead' },
]

const LEVEL_FIELDS = [
  { key: 'trigger',    label: 'Trigger' },
  { key: 'support',    label: 'Support' },
  { key: 'resistance', label: 'Resistance' },
  { key: 'stop',       label: 'Stop' },
  { key: 'target',     label: 'Target' },
]

export default function PlaybookEntryModal({ entry, onClose, prefillSymbol }) {
  const { settings } = useJ2Settings()
  const isEdit = Boolean(entry && entry.id)
  const [symbol, setSymbol] = useState(entry?.symbol || prefillSymbol || '')
  const [observedDate, setObservedDate] = useState(entry?.observedDate || todayET())
  const [setup, setSetup] = useState(entry?.setup || '')
  const [thesis, setThesis] = useState(entry?.thesis || '')
  const [notes, setNotes] = useState(entry?.notes || '')
  const [status, setStatus] = useState(entry?.status || 'watching')
  const [levels, setLevels] = useState(() => {
    const l = entry?.levels || {}
    const out = {}
    for (const f of LEVEL_FIELDS) out[f.key] = l[f.key] != null ? String(l[f.key]) : ''
    return out
  })
  const [attachments, setAttachments] = useState(entry?.attachments || [])
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setupOptions = settings?.setups || []

  const buildPayload = () => {
    const levelsOut = {}
    for (const f of LEVEL_FIELDS) {
      const v = levels[f.key]
      if (v !== '' && Number.isFinite(Number(v))) {
        levelsOut[f.key] = Number(v)
      }
    }
    return {
      symbol: symbol.trim().toUpperCase(),
      observedDate,
      setup: setup.trim() || null,
      thesis: thesis.trim() || '',
      notes: notes.trim() || '',
      status,
      levels: levelsOut,
      attachments,
    }
  }

  const handleSave = async () => {
    const payload = buildPayload()
    if (!payload.symbol) {
      setError('Symbol is required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const url = isEdit ? `/api/j2/playbook/${entry.id}` : '/api/j2/playbook'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `${res.status}`)
      }
      onClose?.()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!isEdit) return
    if (!confirm(`Delete this ${entry.symbol} playbook entry?`)) return
    setSaving(true)
    try {
      await fetch(`/api/j2/playbook/${entry.id}`, {
        method: 'DELETE', credentials: 'include',
      })
      onClose?.()
    } finally {
      setSaving(false)
    }
  }

  const addLink = () => {
    if (!linkUrl.trim()) return
    setAttachments((prev) => [
      ...prev,
      { kind: 'link', url: linkUrl.trim(), label: linkLabel.trim(),
        addedAt: new Date().toISOString() },
    ])
    setLinkUrl('')
    setLinkLabel('')
  }

  const removeAttachment = (idx) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }

  const onFileChosen = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be < 5 MB.')
      e.target.value = ''
      return
    }
    if (!isEdit) {
      // Need to save first to get an entry ID
      setError('Save the entry first, then upload screenshots.')
      e.target.value = ''
      return
    }
    setError(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`/api/j2/playbook/${entry.id}/screenshots`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const uploaded = await res.json()
      setAttachments((prev) => [...prev, uploaded])
    } catch (e) {
      setError(`Upload failed: ${e.message}`)
    }
    e.target.value = ''
  }

  return (
    <div className={styles.backdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            {isEdit ? `Edit ${entry.symbol}` : 'New Playbook Entry'}
          </h2>
          <button type="button" className={styles.xBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.body}>
          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.label}>Symbol *</span>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="e.g. NVDA"
                maxLength={16}
                className={styles.input}
                autoFocus={!isEdit}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Observed Date *</span>
              <input
                type="date"
                value={observedDate}
                onChange={(e) => setObservedDate(e.target.value)}
                className={styles.input}
              />
            </label>
          </div>

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.label}>Setup</span>
              <select
                value={setup}
                onChange={(e) => setSetup(e.target.value)}
                className={styles.input}
              >
                <option value="">— none —</option>
                {setupOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={styles.input}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Thesis</span>
            <textarea
              value={thesis}
              onChange={(e) => setThesis(e.target.value)}
              placeholder="Why did this catch your eye?"
              rows={3}
              maxLength={5000}
              className={styles.textarea}
            />
          </label>

          <div className={styles.levelsRow}>
            <span className={styles.label}>Key Levels</span>
            <div className={styles.levelsGrid}>
              {LEVEL_FIELDS.map((f) => (
                <label key={f.key} className={styles.levelField}>
                  <span className={styles.levelLabel}>{f.label}</span>
                  <div className={styles.prefixInput}>
                    <span className={styles.prefix}>$</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={levels[f.key]}
                      onChange={(e) => setLevels((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className={styles.levelInput}
                    />
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Screenshots & Links</span>
            {attachments.length > 0 && (
              <ul className={styles.attachList}>
                {attachments.map((a, i) => (
                  <li key={i} className={styles.attachItem}>
                    {a.kind === 'image' ? (
                      <a href={a.url} target="_blank" rel="noreferrer">
                        <img src={a.url} alt="" className={styles.thumb} />
                      </a>
                    ) : (
                      <a href={a.url} target="_blank" rel="noreferrer" className={styles.linkChip}>
                        🔗 {a.label || a.url}
                      </a>
                    )}
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => removeAttachment(i)}
                      aria-label="Remove attachment"
                    >×</button>
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.linkRow}>
              <input
                type="text"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="Paste TradingView link or any URL…"
                className={styles.linkInput}
              />
              <input
                type="text"
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="label"
                className={styles.labelInput}
              />
              <button type="button" className={styles.addBtn} onClick={addLink}>
                Add link
              </button>
            </div>
            <div className={styles.uploadRow}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className={styles.fileInput}
                onChange={onFileChosen}
              />
              <button
                type="button"
                className={styles.uploadBtn}
                onClick={() => fileInputRef.current?.click()}
                disabled={!isEdit}
                title={!isEdit ? 'Save entry first, then upload screenshots' : ''}
              >
                📷 Upload screenshot
              </button>
              {!isEdit && (
                <span className={styles.hint}>Save first to enable uploads</span>
              )}
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Additional Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything else?"
              rows={2}
              maxLength={5000}
              className={styles.textarea}
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}
        </div>

        <div className={styles.footer}>
          {isEdit && (
            <button
              type="button"
              className={styles.dangerBtn}
              onClick={handleDelete}
              disabled={saving}
            >
              Delete
            </button>
          )}
          <button type="button" className={styles.ghost} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={handleSave}
            disabled={saving || !symbol.trim()}
          >
            {saving ? 'Saving…' : (isEdit ? 'Save' : 'Create Entry')}
          </button>
        </div>
      </div>
    </div>
  )
}
