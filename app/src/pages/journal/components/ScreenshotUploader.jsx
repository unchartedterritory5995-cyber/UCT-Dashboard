// app/src/pages/journal/components/ScreenshotUploader.jsx
import { useState, useRef, useCallback } from 'react'
import useSWR from 'swr'
import styles from './ScreenshotUploader.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const SLOTS = [
  { key: 'pre_entry', label: 'Pre-Entry' },
  { key: 'in_trade', label: 'In-Trade' },
  { key: 'exit', label: 'Exit' },
  { key: 'higher_tf', label: 'Higher TF' },
  { key: 'lower_tf', label: 'Lower TF' },
]

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export default function ScreenshotUploader({ tradeId }) {
  const [uploading, setUploading] = useState(null) // slot key currently uploading
  const [lightbox, setLightbox] = useState(null) // screenshot object for lightbox
  const [error, setError] = useState(null)
  const fileInputRefs = useRef({})

  const { data, mutate } = useSWR(
    tradeId ? `/api/journal/${tradeId}/screenshots` : null,
    fetcher,
    { dedupingInterval: 10000, revalidateOnFocus: false }
  )

  const screenshots = Array.isArray(data) ? data : []

  // Map screenshots by slot
  const bySlot = {}
  screenshots.forEach(s => { bySlot[s.slot] = s })

  const validateFile = useCallback((file) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return 'Only JPEG, PNG, and WebP images are allowed.'
    }
    if (file.size > MAX_FILE_SIZE) {
      return 'File must be under 2MB.'
    }
    return null
  }, [])

  async function handleUpload(slot, file) {
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setUploading(slot)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('slot', slot)
      formData.append('label', '')

      const res = await fetch(`/api/journal/${tradeId}/screenshots`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || 'Upload failed')
      }
      mutate()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(null)
    }
  }

  async function handleDelete(screenshotId) {
    if (!window.confirm('Are you sure? This cannot be undone.')) return
    try {
      await fetch(`/api/journal/${tradeId}/screenshots/${screenshotId}`, {
        method: 'DELETE',
      })
      mutate()
      if (lightbox?.id === screenshotId) {
        setLightbox(null)
      }
    } catch (err) {
      console.error('Delete screenshot failed:', err)
    }
  }

  function handleDrop(slot, e) {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer?.files?.[0]
    if (file) handleUpload(slot, file)
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.stopPropagation()
  }

  function triggerFileInput(slot) {
    if (fileInputRefs.current[slot]) {
      fileInputRefs.current[slot].click()
    }
  }

  function handleFileChange(slot, e) {
    const file = e.target.files?.[0]
    if (file) handleUpload(slot, file)
    // Reset input so same file can be re-selected
    if (e.target) e.target.value = ''
  }

  return (
    <div className={styles.wrap}>
      {error && (
        <div className={styles.error}>
          <span>{error}</span>
          <button className={styles.errorClose} onClick={() => setError(null)}>x</button>
        </div>
      )}

      <div className={styles.grid}>
        {SLOTS.map(slot => {
          const screenshot = bySlot[slot.key]
          const isUploading = uploading === slot.key

          return (
            <div key={slot.key} className={styles.slot}>
              <div className={styles.slotLabel}>{slot.label}</div>

              {screenshot ? (
                <div className={styles.thumbnailWrap}>
                  <img
                    src={`/api/journal/${tradeId}/screenshots/${screenshot.id}`}
                    alt={slot.label}
                    className={styles.thumbnail}
                    onClick={() => setLightbox(screenshot)}
                    loading="lazy"
                  />
                  <button
                    className={styles.deleteBtn}
                    onClick={() => handleDelete(screenshot.id)}
                    title="Remove screenshot"
                  >
                    x
                  </button>
                </div>
              ) : (
                <div
                  className={`${styles.dropZone} ${isUploading ? styles.dropZoneUploading : ''}`}
                  onClick={() => triggerFileInput(slot.key)}
                  onDrop={e => handleDrop(slot.key, e)}
                  onDragOver={handleDragOver}
                >
                  {isUploading ? (
                    <div className={styles.uploadingIndicator}>
                      <div className={styles.uploadingDot} />
                      <span>Uploading...</span>
                    </div>
                  ) : (
                    <>
                      <div className={styles.dropIcon}>+</div>
                      <div className={styles.dropText}>Click or drag</div>
                    </>
                  )}
                  <input
                    ref={el => { fileInputRefs.current[slot.key] = el }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className={styles.fileInput}
                    onChange={e => handleFileChange(slot.key, e)}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Lightbox overlay */}
      {lightbox && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)}>
          <div className={styles.lightboxInner} onClick={e => e.stopPropagation()}>
            <img
              src={`/api/journal/${tradeId}/screenshots/${lightbox.id}`}
              alt={lightbox.label || lightbox.slot}
              className={styles.lightboxImg}
            />
            <div className={styles.lightboxFooter}>
              <span className={styles.lightboxLabel}>
                {SLOTS.find(s => s.key === lightbox.slot)?.label || lightbox.slot}
              </span>
              <button className={styles.lightboxClose} onClick={() => setLightbox(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
