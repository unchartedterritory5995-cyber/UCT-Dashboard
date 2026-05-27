import { useRef, useState } from 'react'
import styles from './HeroImagePicker.module.css'

export default function HeroImagePicker({ noteId, value, onChange }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  const upload = async (file) => {
    if (!file) return
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

  return (
    <div className={styles.wrap}>
      {value ? (
        <div className={styles.filled}>
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
        </div>
      ) : (
        <button
          type="button"
          className={styles.empty}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : 'Click to add a hero image'}
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
