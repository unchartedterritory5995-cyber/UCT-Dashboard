import { useRef, useState, useEffect } from 'react'
import UIcon from '../ui/UIcon'
import styles from './VisionAttachButton.module.css'

/**
 * Paperclip on the orb cluster — attach a chart screenshot (file upload OR
 * clipboard paste) and get GPT-4o vision analysis inline. Posts to the
 * existing /api/voice/vision/upload endpoint.
 *
 * The returned analysis is shown in a popover near the orb so the user can
 * read it AND say "what do you think of that breakout?" — Compass then has
 * the visual context via the user's verbal recap.
 *
 * UX:
 *  - Click → file picker
 *  - Cmd/Ctrl+V while button is hovered/focused → paste image from clipboard
 *  - "Analyzing..." spinner while the upload + GPT-4o pass runs
 *  - Result panel shows: pattern, key levels, recommendation, confidence
 */
export default function VisionAttachButton() {
  const fileRef = useRef(null)
  const wrapRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [previewSrc, setPreviewSrc] = useState(null)

  async function upload(file) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('Image too large (max 5MB).')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    setOpen(true)
    try {
      // Local preview
      const reader = new FileReader()
      reader.onload = (e) => setPreviewSrc(e.target.result)
      reader.readAsDataURL(file)

      const fd = new FormData()
      fd.append('image', file)
      const r = await fetch('/api/voice/vision/upload', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      })
      if (!r.ok) {
        const t = await r.text()
        throw new Error(t || `HTTP ${r.status}`)
      }
      const data = await r.json()
      setResult(data)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  // Clipboard paste while the popover is open or the button is focused
  useEffect(() => {
    function onPaste(e) {
      if (!open && document.activeElement !== wrapRef.current?.querySelector('button')) return
      const items = e.clipboardData?.items || []
      for (const item of items) {
        if (item.type?.startsWith('image/')) {
          const blob = item.getAsFile()
          if (blob) {
            e.preventDefault()
            upload(blob)
            return
          }
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [open])

  // Click outside / Escape closes
  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (f) upload(f)
    if (fileRef.current) fileRef.current.value = ''
  }

  const onButtonClick = () => {
    if (busy) return
    if (open && result) {
      setOpen(false)
      return
    }
    fileRef.current?.click()
  }

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={styles.btn}
        onClick={onButtonClick}
        aria-label="Attach a chart screenshot for vision analysis (or paste from clipboard)"
        title="Attach chart for vision analysis · paste from clipboard supported"
      >
        <UIcon name="link" size={16} />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onFile}
      />
      {open && (
        <div className={styles.popover} role="dialog" aria-label="Chart vision result">
          {busy && (
            <div className={styles.busy}>
              <div className={styles.spinner} />
              <div className={styles.busyLabel}>Analyzing chart...</div>
            </div>
          )}
          {!busy && error && (
            <div className={styles.error}>
              <div className={styles.errorTitle}>Vision failed</div>
              <div className={styles.errorBody}>{error}</div>
            </div>
          )}
          {!busy && result && (
            <div className={styles.result}>
              {previewSrc && (
                <img src={previewSrc} alt="" className={styles.preview} />
              )}
              <div className={styles.header}>
                <div className={styles.title}>
                  {result.pattern || result.recommendation || 'Chart analysis'}
                </div>
                {result.confidence != null && (
                  <div className={styles.confidence}>
                    {Math.round(Number(result.confidence) * 100)}% conf
                  </div>
                )}
              </div>
              {result.narration && (
                <div className={styles.narration}>{result.narration}</div>
              )}
              {result.key_levels && (
                <div className={styles.levels}>
                  {result.key_levels.entry != null && (
                    <span>Entry: ${result.key_levels.entry}</span>
                  )}
                  {result.key_levels.stop != null && (
                    <span>Stop: ${result.key_levels.stop}</span>
                  )}
                  {result.key_levels.target != null && (
                    <span>Target: ${result.key_levels.target}</span>
                  )}
                </div>
              )}
              {result.recommendation && (
                <div className={styles.rec}>{result.recommendation}</div>
              )}
              <div className={styles.hint}>
                Now say to Compass: "What do you think of that chart?" — it
                has the analysis fresh in context.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
