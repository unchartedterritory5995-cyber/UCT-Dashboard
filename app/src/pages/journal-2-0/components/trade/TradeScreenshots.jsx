/**
 * TradeScreenshots — chart-screenshot gallery for the Journal 2.0 trade page.
 *
 * Mounted in TradeDetailPage's "story" section. Three upload paths — click to
 * browse, drag-and-drop, and PASTE (⌘V a screenshot straight from the clipboard).
 * Thumbnails are a 16/9 cover grid; click opens a lightbox, per-thumb ✕ deletes
 * (confirm-click, no window.confirm — dialog rule). Screenshots key on the trade
 * server-side (stable trade_ref), so this component only needs the route id.
 *
 * Endpoints (all cookie-auth, same-origin):
 *   GET    /api/j2/trades/{id}/attachments        → { attachments: [{id,url,label,createdAt}] }
 *   POST   /api/j2/trades/{id}/attachments         (multipart FormData field `file`) → attachment
 *   DELETE /api/j2/trades/attachments/{attachmentId}
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import UIcon from '../../../../components/ui/UIcon'
import styles from './TradeScreenshots.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { attachments: [] }))

// Keys the page's prev/next handler owns — while the zone is focused (so the
// user can paste), swallow these so a keystroke doesn't navigate away mid-paste.
const NAV_KEYS = new Set(['j', 'k', 'ArrowLeft', 'ArrowRight'])

export default function TradeScreenshots({ tradeId }) {
  const key = tradeId ? `/api/j2/trades/${encodeURIComponent(tradeId)}/attachments` : null
  const { data, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const attachments = data?.attachments || []

  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [lightbox, setLightbox] = useState(null)     // attachment being viewed
  const [pendingDelete, setPendingDelete] = useState(null)  // id armed for confirm
  const inputRef = useRef(null)
  const confirmTimer = useRef(null)

  useEffect(() => () => clearTimeout(confirmTimer.current), [])

  const upload = useCallback(
    async (file) => {
      if (!file) return
      setError(null)
      setUploading(true)
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`/api/j2/trades/${encodeURIComponent(tradeId)}/attachments`, {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
        if (!res.ok) {
          let msg = 'Upload failed. Try again.'
          try { const j = await res.json(); if (j?.detail) msg = j.detail } catch { /* non-JSON */ }
          setError(msg)
          return
        }
        await mutate()
        // fire-and-forget telemetry
        fetch('/api/j2/telemetry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ event: 'screenshot_added' }),
        }).catch(() => {})
      } catch {
        setError('Upload failed. Try again.')
      } finally {
        setUploading(false)
      }
    },
    [tradeId, mutate],
  )

  const remove = useCallback(
    async (id) => {
      setError(null)
      try {
        const res = await fetch(`/api/j2/trades/attachments/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (!res.ok) { setError('Couldn’t remove that screenshot.'); return }
        await mutate()
      } catch {
        setError('Couldn’t remove that screenshot.')
      }
    },
    [mutate],
  )

  const onDeleteClick = useCallback(
    (e, id) => {
      e.stopPropagation()
      if (pendingDelete === id) {
        clearTimeout(confirmTimer.current)
        setPendingDelete(null)
        remove(id)
      } else {
        setPendingDelete(id)
        clearTimeout(confirmTimer.current)
        confirmTimer.current = setTimeout(() => setPendingDelete(null), 3000)
      }
    },
    [pendingDelete, remove],
  )

  // Take the first image from a FileList (the endpoint stores one file per POST).
  const takeFiles = useCallback((files) => { if (files && files[0]) upload(files[0]) }, [upload])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragActive(false)
    takeFiles(e.dataTransfer?.files)
  }, [takeFiles])

  const onPaste = useCallback((e) => {
    const files = e.clipboardData?.files
    if (files && files.length) {
      e.preventDefault()
      takeFiles(files)
    }
  }, [takeFiles])

  // Esc / backdrop close the lightbox. Capture-phase + stopPropagation so the
  // page's own window Escape handler (navigate -1) doesn't ALSO fire and yank
  // the user off the trade page while they were only dismissing the preview.
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); setLightbox(null) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [lightbox])

  const zoneHandlers = {
    onPaste,
    onDrop,
    onDragOver: (e) => { e.preventDefault(); if (!dragActive) setDragActive(true) },
    onDragLeave: (e) => { if (e.currentTarget === e.target) setDragActive(false) },
    // Keep prev/next keys from firing while the zone is focused for pasting.
    onKeyDown: (e) => { if (NAV_KEYS.has(e.key)) e.stopPropagation() },
  }

  const openBrowse = () => inputRef.current?.click()

  return (
    <div
      className={`${styles.root} ${dragActive ? styles.rootDrag : ''}`}
      {...zoneHandlers}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className={styles.hiddenInput}
        onChange={(e) => { takeFiles(e.target.files); e.target.value = '' }}
      />

      {attachments.length === 0 ? (
        <button
          type="button"
          className={styles.emptyZone}
          onClick={openBrowse}
          aria-label="Add a screenshot"
        >
          <UIcon name="chart" size={22} className={styles.emptyIcon} />
          <span className={styles.emptyTitle}>Paste or drop a chart screenshot</span>
          <span className={styles.emptyHint}>or click to browse</span>
        </button>
      ) : (
        <div className={styles.grid}>
          {attachments.map((att) => (
            <div key={att.id} className={styles.thumb}>
              <button
                type="button"
                className={styles.thumbBtn}
                onClick={() => setLightbox(att)}
                aria-label={`View screenshot${att.label ? ` ${att.label}` : ''}`}
              >
                <img className={styles.thumbImg} src={att.url} alt={att.label || 'Trade screenshot'} />
              </button>
              <button
                type="button"
                className={`${styles.deleteBtn} ${pendingDelete === att.id ? styles.deleteArmed : ''}`}
                onClick={(e) => onDeleteClick(e, att.id)}
                aria-label={pendingDelete === att.id ? 'Click again to delete' : 'Remove screenshot'}
                title={pendingDelete === att.id ? 'Click again to delete' : 'Remove screenshot'}
              >
                <UIcon name="trash" size={13} gold={false} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.addTile}
            onClick={openBrowse}
            aria-label="Add another screenshot"
          >
            <UIcon name="plus" size={18} />
          </button>
        </div>
      )}

      {uploading && <div className={styles.status}>Uploading…</div>}
      {error && <div className={styles.errorLine} role="alert">{error}</div>}

      {lightbox && (
        <div
          className={styles.lightbox}
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot preview"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className={styles.lightboxClose}
            onClick={(e) => { e.stopPropagation(); setLightbox(null) }}
            aria-label="Close preview"
          >
            <UIcon name="x" size={18} gold={false} />
          </button>
          <img
            className={styles.lightboxImg}
            src={lightbox.url}
            alt={lightbox.label || 'Trade screenshot'}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
