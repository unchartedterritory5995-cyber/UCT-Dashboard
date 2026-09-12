import { useRef, useState } from 'react'
import { settleNoteWrite } from '../../lib/offline/settleNoteWrite'
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
      // ⛔ THIS ROUTE ADVANCED THE NOTE'S REVISION. Record it before anything
      // else, or the drain forks the member's note over our own write.
      await settleNoteWrite(noteId, body.note)
      onChange(body.heroImageUrl)
    } catch (e) {
      console.error('[notebook] hero upload failed', e)
      setError("Couldn't upload that image. Your note is unchanged.")
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
      // ⛔ REMOVE ADVANCES THE REVISION TOO — it is an update_note, not a delete
      // of the note. Same door, same requirement.
      await settleNoteWrite(noteId, res)
      onChange(null)
    } catch (e) {
      console.error('[notebook] hero remove failed', e)
      setError("Couldn't remove that image. Your note is unchanged.")
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
      {/* ⛔⛔ THE CANARY CANNOT FIND THIS INPUT WITHOUT A STABLE HOOK, and for
          the whole of Wave Q1 it did not. The note editor renders THREE file
          inputs, and `NoteEditorPage`'s hidden inline-image input carries the
          BYTE-IDENTICAL accept list — so `input[type=file][accept*=image]`
          matched that one first, posted to `/images`, and the hero door was
          never driven at all. The rig then reported its own mis-selection as a
          product defect (`heroImageUrl = null` after a drain).
          ⭐ `hero` is the door that shipped unsettled BECAUSE no canary could
          reach it. `data-uct-hero-input` is what makes it reachable, and
          `HeroImagePicker.settle.test.jsx` asserts it is still here. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        data-uct-hero-input=""
        style={{ display: 'none' }}
        onChange={(e) => upload(e.target.files?.[0])}
      />
      {error && <div className={styles.error}>{error}</div>}
    </div>
  )
}
