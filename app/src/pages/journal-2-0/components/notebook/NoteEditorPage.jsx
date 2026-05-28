import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { buildExtensions, uploadInlineImage } from '../../lib/tiptap'
import { useJ2Note } from '../../hooks/useJ2Notes'
import useJ2NoteFolders from '../../hooks/useJ2NoteFolders'
import HeroImagePicker from './HeroImagePicker'
import styles from './NoteEditorPage.module.css'

const AUTOSAVE_MS = 800
// Backoff schedule for transient (5xx / network) save failures.
// After the last entry, retries continue at the cap forever (or until the
// user edits / closes the tab). 4xx errors bypass retry entirely.
const RETRY_BACKOFFS_MS = [1000, 2000, 4000, 8000, 15000, 30000]

export default function NoteEditorPage({ noteId, onBack }) {
  const { note, isLoading, update, refresh } = useJ2Note(noteId)
  const { folders } = useJ2NoteFolders()
  const [saveStatus, setSaveStatus] = useState('saved')
  const [saveErrorMsg, setSaveErrorMsg] = useState('')
  const saveTimerRef = useRef(null)
  const retryTimerRef = useRef(null)
  const retryAttemptsRef = useRef(0)
  const fileInputRef = useRef(null)
  const lastSavedRef = useRef({ title: '', subtitle: '', bodyJson: null })

  // Local mirrors for fields the user edits inline.
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')

  useEffect(() => {
    if (note) {
      setTitle(note.title || '')
      setSubtitle(note.subtitle || '')
      lastSavedRef.current = {
        title: note.title || '',
        subtitle: note.subtitle || '',
        bodyJson: note.bodyJson,
      }
    }
  }, [note?.id])

  const scheduleAutosave = () => {
    setSaveStatus('dirty')
    setSaveErrorMsg('')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    // Fresh user edit supersedes any in-flight retry — reset the backoff
    // counter so we don't waste a 30s wait on content the user just changed.
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    retryAttemptsRef.current = 0
    saveTimerRef.current = setTimeout(() => commitSave(), AUTOSAVE_MS)
  }

  const handleImageInsert = async (file) => {
    if (!editor) return
    try {
      const { url } = await uploadInlineImage(noteId, file)
      editor.chain().focus().setImage({ src: url, alt: '' }).run()
    } catch (e) {
      alert(`Upload failed: ${e.message || e}`)
    }
  }

  const editor = useEditor({
    extensions: buildExtensions(),
    content: note?.bodyJson || { type: 'doc', content: [] },
    editorProps: {
      attributes: { class: styles.proseEditor },
      handlePaste(view, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            event.preventDefault()
            const file = item.getAsFile()
            if (file) handleImageInsert(file)
            return true
          }
        }
        return false
      },
      handleDrop(view, event) {
        const file = event.dataTransfer?.files?.[0]
        if (file && file.type.startsWith('image/')) {
          event.preventDefault()
          handleImageInsert(file)
          return true
        }
        return false
      },
    },
    onUpdate: () => scheduleAutosave(),
  }, [note?.id])

  // Push fresh body into editor when note loads (one-shot per note).
  useEffect(() => {
    if (editor && note?.bodyJson && !editor.isFocused) {
      const current = JSON.stringify(editor.getJSON())
      const fresh = JSON.stringify(note.bodyJson)
      if (current !== fresh) editor.commands.setContent(note.bodyJson, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id])

  const commitSave = async () => {
    if (!editor) return
    saveTimerRef.current = null
    retryTimerRef.current = null

    const bodyJson = editor.getJSON()
    const last = lastSavedRef.current
    const titleChanged = title !== last.title
    const subtitleChanged = (subtitle || '') !== (last.subtitle || '')
    const bodyChanged = JSON.stringify(bodyJson) !== JSON.stringify(last.bodyJson)
    if (!titleChanged && !subtitleChanged && !bodyChanged) {
      setSaveStatus('saved')
      retryAttemptsRef.current = 0
      return
    }
    const patch = {}
    if (titleChanged) patch.title = title
    if (subtitleChanged) patch.subtitle = subtitle || null
    if (bodyChanged) patch.bodyJson = bodyJson

    setSaveStatus(retryAttemptsRef.current === 0 ? 'saving' : 'reconnecting')
    try {
      await update(patch)
      lastSavedRef.current = { title, subtitle, bodyJson }
      setSaveStatus('saved')
      setSaveErrorMsg('')
      retryAttemptsRef.current = 0
    } catch (e) {
      const status = e?.status
      // No status = network/fetch error; 5xx = backend down or restarting.
      // Both are worth retrying. 4xx = real client/validation error — won't
      // get better on retry, so surface immediately.
      const retryable = !status || status >= 500
      if (!retryable) {
        console.error('autosave failed (non-retryable)', e)
        setSaveStatus('error')
        setSaveErrorMsg(e?.message || `HTTP ${status}`)
        retryAttemptsRef.current = 0
        return
      }
      const attempt = retryAttemptsRef.current
      const delay = RETRY_BACKOFFS_MS[Math.min(attempt, RETRY_BACKOFFS_MS.length - 1)]
      retryAttemptsRef.current = attempt + 1
      console.warn(`autosave failed (retry ${attempt + 1} in ${delay}ms)`, e)
      setSaveStatus('reconnecting')
      setSaveErrorMsg(e?.message || (status ? `HTTP ${status}` : 'Network error'))
      retryTimerRef.current = setTimeout(() => commitSave(), delay)
    }
  }

  // Save on unmount if dirty.
  useEffect(() => () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      commitSave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Slash menu's "Image" option dispatches this event so we can open the
  // native file picker from outside the editor's React tree.
  useEffect(() => {
    const onOpenPicker = () => fileInputRef.current?.click()
    window.addEventListener('uct:notebook-open-image-picker', onOpenPicker)
    return () => window.removeEventListener('uct:notebook-open-image-picker', onOpenPicker)
  }, [])

  const onHeroChange = async () => {
    // Hero update already persisted by HeroImagePicker — refresh local copy.
    await refresh()
  }

  const onFolderChange = async (folderId) => {
    await update({ folderId: folderId || null })
  }
  const onTickerChange = async (ticker) => {
    await update({ ticker: ticker || null })
  }
  const onTagsChange = async (tagsCsv) => {
    const tags = tagsCsv.split(',').map((t) => t.trim()).filter(Boolean)
    await update({ tags })
  }

  const onDelete = async () => {
    if (!confirm('Delete this note?')) return
    const res = await fetch(`/api/j2/notes/${noteId}`, {
      method: 'DELETE', credentials: 'include',
    })
    if (res.ok) onBack()
  }

  const ToolButton = ({ active, onClick, label }) => (
    <button
      type="button"
      className={`${styles.toolBtn} ${active ? styles.toolBtnActive : ''}`}
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
    >{label}</button>
  )

  if (isLoading || !note) {
    return <div className={styles.loading}>Loading…</div>
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          ← Notebook
        </button>
        <div
          className={styles.saveStatus}
          title={saveErrorMsg || undefined}
        >
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'dirty' && 'Editing'}
          {saveStatus === 'reconnecting' && 'Reconnecting…'}
          {saveStatus === 'error' && `⚠ Save failed${saveErrorMsg ? `: ${saveErrorMsg}` : ''}`}
        </div>
        <div className={styles.headerControls}>
          <select
            className={styles.headerSelect}
            value={note.folderId || ''}
            onChange={(e) => onFolderChange(e.target.value)}
          >
            <option value="">Unfiled</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <input
            className={styles.headerInput}
            placeholder="Ticker"
            defaultValue={note.ticker || ''}
            onBlur={(e) => onTickerChange(e.target.value)}
            style={{ width: 84 }}
          />
          <input
            className={styles.headerInput}
            placeholder="Tags (comma sep)"
            defaultValue={(note.tags || []).join(', ')}
            onBlur={(e) => onTagsChange(e.target.value)}
            style={{ width: 200 }}
          />
          <button type="button" className={styles.deleteBtn} onClick={onDelete}>
            Delete
          </button>
        </div>
      </header>

      <div className={styles.column}>
        <HeroImagePicker
          noteId={noteId}
          value={note.heroImageUrl}
          onChange={onHeroChange}
        />

        <input
          className={styles.titleInput}
          value={title}
          onChange={(e) => { setTitle(e.target.value); scheduleAutosave() }}
          placeholder="Title"
        />
        <input
          className={styles.subtitleInput}
          value={subtitle}
          onChange={(e) => { setSubtitle(e.target.value); scheduleAutosave() }}
          placeholder="Subtitle (optional)"
        />

        {editor && (
          <div className={styles.toolbar}>
            <ToolButton
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
              label="B"
            />
            <ToolButton
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              label="I"
            />
            <ToolButton
              active={editor.isActive('heading', { level: 1 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              label="H1"
            />
            <ToolButton
              active={editor.isActive('heading', { level: 2 })}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              label="H2"
            />
            <ToolButton
              active={editor.isActive('bulletList')}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              label="• List"
            />
            <ToolButton
              active={editor.isActive('orderedList')}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              label="1. List"
            />
            <ToolButton
              active={editor.isActive('blockquote')}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              label="❝"
            />
            <ToolButton
              active={editor.isActive('codeBlock')}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              label="</>"
            />
            <ToolButton
              onClick={() => {
                const url = prompt('Link URL (https only):')
                if (url) editor.chain().focus().setLink({ href: url }).run()
              }}
              label="🔗"
            />
            <ToolButton
              onClick={() => fileInputRef.current?.click()}
              label="🖼"
            />
            <ToolButton
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              label="―"
            />
          </div>
        )}

        <EditorContent editor={editor} />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleImageInsert(f)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
