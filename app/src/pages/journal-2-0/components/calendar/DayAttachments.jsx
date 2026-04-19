/**
 * Day attachments — TradingView-style links + image upload (max 5 total).
 * Persists via the shared day-notes mutation.
 */

import { useRef, useState } from 'react'
import styles from './DayAttachments.module.css'

const MAX_ATTACHMENTS = 5

export default function DayAttachments({
  date,
  notes = '',
  prepNotes = '',
  midDayNotes = '',
  recapNotes = '',
  attachments = [],
  rules = [],
  onSave,
  saving,
}) {
  const narrativeBundle = { notes, prepNotes, midDayNotes, recapNotes }
  const fileInputRef = useRef(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [error, setError] = useState(null)

  const isFull = attachments.length >= MAX_ATTACHMENTS

  const addLink = async () => {
    const url = linkUrl.trim()
    if (!url) return
    if (isFull) {
      setError(`Max ${MAX_ATTACHMENTS} attachments per day.`)
      return
    }
    setError(null)
    const next = [
      ...attachments,
      { kind: 'link', url, label: linkLabel.trim(), addedAt: new Date().toISOString() },
    ]
    const ok = await onSave({ ...narrativeBundle, attachments: next, rules })
    if (ok) {
      setLinkUrl('')
      setLinkLabel('')
    } else {
      setError("Couldn't save link.")
    }
  }

  const removeAttachment = async (idx) => {
    const next = attachments.filter((_, i) => i !== idx)
    const ok = await onSave({ ...narrativeBundle, attachments: next, rules })
    if (!ok) setError("Couldn't remove attachment.")
  }

  const onFileChosen = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (isFull) {
      setError(`Max ${MAX_ATTACHMENTS} attachments per day.`)
      e.target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be < 5 MB.')
      e.target.value = ''
      return
    }
    const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
    if (!allowed.includes(file.type)) {
      setError('Allowed: PNG, JPG, GIF, WebP.')
      e.target.value = ''
      return
    }
    setError(null)

    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`/api/j2/calendar/day/${date}/attachments`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `${res.status}`)
      }
      const uploaded = await res.json() // { kind, url, label, addedAt }
      const next = [...attachments, uploaded]
      await onSave({ ...narrativeBundle, attachments: next, rules })
    } catch (e) {
      setError(`Upload failed: ${e.message}`)
    }
    e.target.value = ''
  }

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Attachments</h3>
        <span className={styles.count}>{attachments.length} / {MAX_ATTACHMENTS}</span>
      </div>

      {attachments.length > 0 && (
        <ul className={styles.list}>
          {attachments.map((a, i) => (
            <li key={i} className={styles.item}>
              {a.kind === 'image' ? (
                <a href={a.url} target="_blank" rel="noreferrer" className={styles.thumb}>
                  <img src={a.url} alt={a.label || 'attached image'} />
                </a>
              ) : (
                <a href={a.url} target="_blank" rel="noreferrer" className={styles.linkChip}>
                  <span className={styles.linkIcon}>🔗</span>
                  <span className={styles.linkText}>
                    {a.label || a.url}
                  </span>
                </a>
              )}
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => removeAttachment(i)}
                aria-label={`Remove ${a.label || a.url}`}
                disabled={saving}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.linkRow}>
        <input
          type="text"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="Paste TradingView chart link or any URL…"
          className={styles.linkInput}
          disabled={isFull}
        />
        <input
          type="text"
          value={linkLabel}
          onChange={(e) => setLinkLabel(e.target.value)}
          placeholder="label (optional)"
          className={styles.labelInput}
          disabled={isFull}
        />
        <button
          type="button"
          className={styles.addBtn}
          onClick={addLink}
          disabled={isFull || !linkUrl.trim() || saving}
        >
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
          disabled={isFull}
        />
        <button
          type="button"
          className={styles.uploadBtn}
          onClick={() => fileInputRef.current?.click()}
          disabled={isFull || saving}
        >
          📷 Upload image
        </button>
        <span className={styles.hint}>PNG / JPG / GIF / WebP · max 5 MB</span>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </section>
  )
}
