/**
 * Notebook widget — an in-charts window onto the user's Journal 2.0 Notebook, so
 * they can read AND edit their notes (and start new ones in existing folders) while
 * other widgets are up. Opening a note fetches the FULL note (the list endpoint
 * returns summaries with no body) and mounts the same TipTap editor the Notebook
 * uses, with autosave — so typing here writes straight to the real note. If the
 * editor can't mount, it degrades to a read-only render + an "Open in Journal" link.
 *
 * Appearance (canvas + text color) is a per-widget ⚙ blob like the other widgets;
 * the selected folder + open note persist per-widget via opts, and the widget
 * follows the app theme until customized.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { generateHTML } from '@tiptap/core'
import usePreferences from '../../../hooks/usePreferences'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import NewsSettingsPanel from './NewsSettingsPanel'
import useJ2Notes, { useJ2Note } from '../../journal-2-0/hooks/useJ2Notes'
import useJ2NoteFolders from '../../journal-2-0/hooks/useJ2NoteFolders'
import { buildExtensions } from '../../journal-2-0/lib/tiptap'
import {
  mergeNotebookWidgetSettings, notebookWidgetStyleVars, notebookDefaultsForTheme,
} from './notebookWidgetSettings'
import styles from './NotebookWidget.module.css'

const AUTOSAVE_MS = 800

function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// If the TipTap editor throws while mounting (missing provider, bad node), fall back
// to a read-only render + the Journal deep-link instead of crashing the widget.
class EditorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

// Static, read-only render of a note's TipTap doc (fallback path — no editor).
function NoteHtml({ bodyJson }) {
  const html = useMemo(() => {
    try {
      const doc = bodyJson && typeof bodyJson === 'object' ? bodyJson : { type: 'doc', content: [] }
      return generateHTML(doc, buildExtensions())
    } catch { return '' }
  }, [bodyJson])
  if (!html) return <div className={styles.empty}>This note is empty.</div>
  return <div className={styles.prose} dangerouslySetInnerHTML={{ __html: html }} />
}

// Fetches the FULL note (the list gives summaries with no body), then mounts the
// live editor once it's loaded (so the title/body init synchronously — no state-sync
// effect). Keyed on noteId by the caller, so switching notes remounts cleanly.
function NoteEditor({ noteId, journalUrl, onBack }) {
  const { note, update } = useJ2Note(noteId)
  if (!note) return <div className={styles.empty}>Loading…</div>
  return <NoteEditorInner note={note} update={update} journalUrl={journalUrl} onBack={onBack} />
}

// The live, editable note — the Notebook's TipTap editor + autosave of title + body.
function NoteEditorInner({ note, update, journalUrl, onBack }) {
  const [title, setTitle] = useState(note.title || '')
  const [status, setStatus] = useState('')   // '' | 'saving' | 'saved'
  const titleRef = useRef(note.title || '')
  const saveTimer = useRef(null)
  const scheduleRef = useRef(() => {})
  const commitRef = useRef(async () => {})

  const editor = useEditor({
    extensions: buildExtensions(),
    content: note.bodyJson || { type: 'doc', content: [] },
    onUpdate: () => scheduleRef.current(),
  }, [])

  // Ref-latched (updated in an effect, not during render) so the frozen onUpdate
  // closure + the setTimeout always run against the LATEST editor/update.
  useEffect(() => {
    scheduleRef.current = () => {
      setStatus('saving')
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => commitRef.current(), AUTOSAVE_MS)
    }
    commitRef.current = async () => {
      if (!editor) return
      try {
        await update({ title: titleRef.current, bodyJson: editor.getJSON() })
        setStatus('saved')
      } catch { setStatus('') }
    }
  })

  const onTitle = (v) => { setTitle(v); titleRef.current = v; scheduleRef.current() }

  // Flush any pending save on unmount / note switch (this instance is per-note).
  useEffect(() => () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); commitRef.current() }
  }, [])

  return (
    <div className={styles.editorPane}>
      <input
        className={styles.editorTitle}
        value={title}
        onChange={e => onTitle(e.target.value)}
        placeholder="Untitled note"
      />
      <div className={styles.editorScroll} onClick={() => editor?.chain().focus().run()}>
        {editor
          ? <EditorContent editor={editor} className={styles.editorBody} />
          : <div className={styles.empty}>Loading…</div>}
      </div>
      <div className={styles.editorFoot}>
        <button type="button" className={styles.footBack} onClick={onBack}>‹ Notes</button>
        <span className={styles.saveStatus}>{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : ''}</span>
        <a className={styles.editLink} href={journalUrl} target="_blank" rel="noreferrer">
          <UIcon name="link" size={12} /> Open in Journal
        </a>
      </div>
    </div>
  )
}

export default function NotebookWidget({ opts, onOptsChange }) {   // `color` unused — not symbol-scoped
  // ── Appearance settings (⚙), theme-adaptive like the other widgets ──
  const { prefs } = usePreferences()
  const placedTheme = usePlacedTheme()
  const settings = useMemo(
    () => mergeNotebookWidgetSettings(opts?.settings ?? notebookDefaultsForTheme(placedTheme)),
    [opts?.settings, prefs.theme],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const rootRef = useRef(null)
  const patchSettings = useCallback(
    (patch) => onOptsChange?.({ ...(opts || {}), settings: { ...settings, ...patch } }),
    [opts, settings, onOptsChange],
  )
  const resetSettings = useCallback(() => onOptsChange?.({ ...(opts || {}), settings: null }), [opts, onOptsChange])
  const rootStyle = useMemo(() => notebookWidgetStyleVars(settings), [settings])
  const menuVars = useMemo(() => {
    const canvas = settings.bgMode === 'gradient' ? (settings.bgGradient?.top || settings.bg) : settings.bg
    return menuThemeVars(canvas) || {}
  }, [settings])

  // ── Per-widget navigation state (persisted via opts) ──
  const folderId = opts?.folderId || ''      // '' = all notes
  const openNoteId = opts?.noteId || null
  const setFolder = useCallback(
    (fid) => onOptsChange?.({ ...(opts || {}), folderId: fid || undefined, noteId: undefined }),
    [opts, onOptsChange],
  )
  const openNote = useCallback(
    (id) => onOptsChange?.({ ...(opts || {}), noteId: id || undefined }),
    [opts, onOptsChange],
  )

  const { folders } = useJ2NoteFolders()
  const [q, setQ] = useState('')
  const { notes, refresh } = useJ2Notes({ folderId: folderId || undefined, q: q.trim() || undefined, sort: 'updated' })
  const openNoteRow = useMemo(() => notes.find(n => n.id === openNoteId) || null, [notes, openNoteId])

  // ── New blank note → open it straight in the editor ──
  const [creating, setCreating] = useState(false)
  const newNote = async () => {
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/j2/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(folderId ? { folderId } : {}),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const body = await res.json()
      await refresh()
      if (body?.note?.id) openNote(body.note.id)
    } catch (e) {
      alert(`Could not create note: ${e.message || e}`)
    } finally {
      setCreating(false)
    }
  }

  const journalUrl = openNoteId ? `/journal/notebook?note=${encodeURIComponent(openNoteId)}` : '/journal/notebook'

  return (
    <div ref={rootRef} className={styles.root} style={rootStyle}>
      {settingsOpen && (
        <NewsSettingsPanel
          title="Notebook Settings"
          widgetType="notebook"
          textHint="notes & headers"
          showPerf={false}
          extraSections={[{ label: 'Header', rows: [{ key: 'headerColor', label: 'Header color', hint: 'folder & title' }] }]}
          settings={settings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={rootRef.current}
          themeVars={menuVars}
        />
      )}

      {/* ── Header ── */}
      <div className={styles.bar}>
        {openNoteId ? (
          <button type="button" className={styles.backBtn} onClick={() => openNote(null)} title="Back to notes">
            <UIcon name="collapse" size={13} /> Notes
          </button>
        ) : (
          <>
            <span className={styles.brand}><UIcon name="journal" size={15} /> Notebook</span>
            <select className={styles.folderSelect} value={folderId} onChange={e => setFolder(e.target.value)} title="Folder">
              <option value="">All notes</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </>
        )}
        <span className={styles.spacer} />
        <a className={styles.gearBtn} href={journalUrl} target="_blank" rel="noreferrer" title="Open in the Journal notebook">
          <UIcon name="link" size={13} />
        </a>
        <button
          ref={settingsBtnRef}
          type="button"
          className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="Notebook widget settings"
        ><UIcon name="gear" size={13} /></button>
      </div>

      {/* ── Body ── */}
      {openNoteId ? (
        <EditorBoundary
          key={openNoteId}
          fallback={
            <div className={styles.reader}>
              <div className={styles.readerTitle}>{openNoteRow?.title || 'Untitled note'}</div>
              <div className={styles.empty}>The in-widget editor couldn’t open this note.</div>
              <a className={styles.editLink} href={journalUrl} target="_blank" rel="noreferrer">
                <UIcon name="link" size={12} /> Open in Journal
              </a>
            </div>
          }
        >
          <NoteEditor noteId={openNoteId} journalUrl={journalUrl} onBack={() => openNote(null)} />
        </EditorBoundary>
      ) : (
        <>
          <div className={styles.toolbar}>
            <input className={styles.search} placeholder="Search notes…" value={q} onChange={e => setQ(e.target.value)} />
            <button type="button" className={styles.newBtn} onClick={newNote} disabled={creating} title="New note">
              <UIcon name="plus" size={13} /> New
            </button>
          </div>
          {notes.length === 0 ? (
            <div className={styles.empty}>
              {q.trim() ? 'No notes match.' : (folderId ? 'No notes in this folder yet.' : 'No notes yet — start one with New.')}
            </div>
          ) : (
            <div className={styles.list}>
              {notes.map(n => (
                <button key={n.id} type="button" className={styles.noteRow} onClick={() => openNote(n.id)}>
                  <span className={styles.noteTitle}>{n.title?.trim() || 'Untitled note'}</span>
                  {n.bodyPlain && <span className={styles.noteSnippet}>{n.bodyPlain}</span>}
                  <span className={styles.noteMeta}>
                    {n.ticker && <span className={styles.noteTicker}>{n.ticker}</span>}
                    {fmtWhen(n.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
