import { useRef, useState } from 'react'
import styles from './HeroImagePicker.module.css'

export default function HeroImagePicker({ noteId, value, onChange }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  const upload = async (file) => {
    if (!file) return
    if (!file.type?.startsWith('image/')) {
      setError('Only images can be set as hero.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be < 5 MB.')
      return
    }
    setError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/j2/notes/${noteId}/hero`, {
        method: 'POST', credentials: 'include', body: fd,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `${res.status}`)
      }
      const body = await res.json()
      onChange(body.heroImageUrl)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setUploading(false)
    }
  }

  const remove = async () => {
    setUploading(true)
    try {
      const res = await fetch(`/api/j2/notes/${noteId}/hero`, {
        method: 'DELETE', credentials: 'include',
      })
      if (!res.ok) throw new Error(`${res.status}`)
      onChange(null)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setUploading(false)
    }
  }

  // Drag-drop handlers — accept files dropped anywhere on the hero region.
  const onDragEnter = (e) => {
    if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
      e.preventDefault()
      setDragOver(true)
    }
  }
  const onDragOver = (e) => {
    if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
      e.preventDefault()
      setDragOver(true)
    }
  }
  const onDragLeave = (e) => {
    // Only clear when leaving the wrap entirely, not when crossing children.
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragOver(false)
  }
  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) upload(file)
  }

  // Paste handler — works when this region (or a focused child button) is the
  // active element. Pasting a screenshot anywhere with hero focused → hero.
  const onPaste = (e) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) upload(file)
        return
      }
    }
  }

  const dragOverCls = dragOver ? styles.dragOver : ''

  return (
    <div
      className={styles.wrap}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      {value ? (
        <div
          className={`${styles.filled} ${dragOverCls}`}
          tabIndex={0}
          title="Click image, then paste (Ctrl+V) to replace · or drag a file here"
        >
          <img src={value} alt="" />
          <div className={styles.overlay}>
            <button
              type="button" className={styles.iconBtn}
              onClick={() => inputRef.current?.click()}
              title="Replace"
            >↻</button>
            <button
              type="button" className={styles.iconBtn}
              onClick={remove} title="Remove"
            >×</button>
          </div>
          {dragOver && <div className={styles.dropHint}>Drop to replace hero</div>}
        </div>
      ) : (
        <button
          type="button"
          className={`${styles.empty} ${dragOverCls}`}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading
            ? 'Uploading…'
            : dragOver
              ? 'Drop image to set as hero'
              : 'Click, drag an image here, or focus + paste'}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => upload(e.target.files?.[0])}
      />
      {error && <div className={styles.error}>{error}</div>}
    </div>
  )
}
