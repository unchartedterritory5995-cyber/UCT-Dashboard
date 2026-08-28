/**
 * Notebook widget — an in-charts window onto the user's Journal 2.0 Notebook, so
 * they can read AND edit their notes (and start new ones in existing folders) while
 * other widgets are up. Opening a note fetches the FULL note (the list endpoint
 * returns summaries with no body) and mounts the same TipTap editor the Notebook
 * uses, with autosave — so typing here writes straight to the real note. If the
 * editor can't mount, it degrades to a read-only render + an "Open in Journal" link.
 *
 * The list view mirrors the Journal notebook's NESTED folder tree (folders inside
 * folders, notes as leaf rows) rather than a flat dropdown, so a deep structure like
 * "Model Books By Year › 1700's › <notes>" shows the same way it does in the Journal.
 *
 * Appearance (canvas + text color) is a per-widget ⚙ blob like the other widgets;
 * the selected folder + open note persist per-widget via opts, and the widget
 * follows the app theme until customized.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import usePreferences from '../../../hooks/usePreferences'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import NewsSettingsPanel from './NewsSettingsPanel'
import useJ2Notes, { useJ2Note } from '../../journal-2-0/hooks/useJ2Notes'
import useJ2NoteFolders from '../../journal-2-0/hooks/useJ2NoteFolders'
import { buildFolderTree } from '../../journal-2-0/components/notebook/FolderSidebar'
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

// ── Nested folder tree (mirrors the Journal notebook's FolderSidebar) ──
function Chevron({ open }) {
  return (
    <svg className={`${styles.chevron}${open ? ' ' + styles.chevronOpen : ''}`} width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function FolderGlyph() {
  return (
    <svg className={styles.folderGlyph} width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6.5a2 2 0 0 1 2-2h3.3l1.8 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

function NoteLeaf({ note, depth, active, onOpen }) {
  return (
    <button
      type="button"
      className={`${styles.treeNote}${active ? ' ' + styles.treeRowActive : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onOpen(note.id)}
      title={note.title?.trim() || 'Untitled note'}
    >
      <UIcon name="journal" size={11} gold={false} />
      <span className={styles.treeNoteTitle}>{note.title?.trim() || 'Untitled note'}</span>
    </button>
  )
}

function FolderNode({ node, depth, expanded, onToggle, selectedFolder, onSelectFolder, notesByFolder, openNoteId, onOpenNote }) {
  const folderNotes = notesByFolder.get(node.id) || []
  const isOpen = expanded.has(node.id)
  const hasChildren = node.children.length > 0 || folderNotes.length > 0
  return (
    <div className={styles.treeNodeWrap}>
      <div className={styles.treeFolderRow} style={{ paddingLeft: depth * 14 }}>
        {hasChildren ? (
          <button type="button" className={styles.treeChevBtn} onClick={() => onToggle(node.id)} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`} aria-expanded={isOpen}>
            <Chevron open={isOpen} />
          </button>
        ) : <span className={styles.treeChevSpacer} aria-hidden="true" />}
        <button
          type="button"
          className={`${styles.treeFolder}${selectedFolder === node.id ? ' ' + styles.treeRowActive : ''}`}
          onClick={() => { onSelectFolder(node.id); onToggle(node.id) }}
        >
          <FolderGlyph />
          <span className={styles.treeFolderName}>{node.name}</span>
          {folderNotes.length > 0 && <span className={styles.treeCount}>{folderNotes.length}</span>}
        </button>
      </div>
      {isOpen && hasChildren && (
        <div>
          {node.children.map(child => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedFolder={selectedFolder}
              onSelectFolder={onSelectFolder}
              notesByFolder={notesByFolder}
              openNoteId={openNoteId}
              onOpenNote={onOpenNote}
            />
          ))}
          {folderNotes.map(n => (
            <NoteLeaf key={n.id} note={n} depth={depth + 1} active={openNoteId === n.id} onOpen={onOpenNote} />
          ))}
        </div>
      )}
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
  // folderId = which folder is the "new note" target + highlighted (or '__unfiled__').
  const folderId = opts?.folderId || ''
  const openNoteId = opts?.noteId || null
  const setFolder = useCallback(
    (fid) => onOptsChange?.({ ...(opts || {}), folderId: fid || undefined }),
    [opts, onOptsChange],
  )
  const openNote = useCallback(
    (id) => onOptsChange?.({ ...(opts || {}), noteId: id || undefined }),
    [opts, onOptsChange],
  )

  const { folders } = useJ2NoteFolders()
  const [q, setQ] = useState('')
  // Fetch the WHOLE note set (no folder filter) so the tree can nest every note
  // under its folder. Server-side search still narrows when a query is typed.
  const { notes, refresh } = useJ2Notes({ q: q.trim() || undefined, sort: 'updated' })
  const openNoteRow = useMemo(() => notes.find(n => n.id === openNoteId) || null, [notes, openNoteId])

  const tree = useMemo(() => buildFolderTree(folders), [folders])
  const notesByFolder = useMemo(() => {
    const m = new Map()
    for (const n of notes) {
      if (!n.folderId) continue
      if (!m.has(n.folderId)) m.set(n.folderId, [])
      m.get(n.folderId).push(n)
    }
    for (const list of m.values()) list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
    return m
  }, [notes])
  const unfiledNotes = useMemo(() => notes.filter(n => !n.folderId), [notes])

  // Folder expand/collapse (local; the widget re-mounts rarely).
  const [expanded, setExpanded] = useState(() => new Set())
  const toggleExpanded = useCallback((id) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  // ── New blank note → open it straight in the editor (in the selected folder) ──
  const [creating, setCreating] = useState(false)
  const newNote = async () => {
    if (creating) return
    setCreating(true)
    try {
      const fid = folderId && folderId !== '__unfiled__' ? folderId : null
      const res = await fetch('/api/j2/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fid ? { folderId: fid } : {}),
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
          <span className={styles.brand}><UIcon name="journal" size={15} /> Notebook</span>
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

          {q.trim() ? (
            // Flat search results across every folder.
            notes.length === 0 ? (
              <div className={styles.empty}>No notes match.</div>
            ) : (
              <div className={styles.list}>
                {notes.map(n => (
                  <button key={n.id} type="button" className={styles.noteRow} onClick={() => openNote(n.id)}>
                    <span className={styles.noteTitle}>{n.title?.trim() || 'Untitled note'}</span>
                    {n.bodyPlain && <span className={styles.noteSnippet}>{n.bodyPlain}</span>}
                    <span className={styles.noteMeta}>{fmtWhen(n.createdAt)}</span>
                  </button>
                ))}
              </div>
            )
          ) : (
            // Nested folder tree (matches the Journal notebook layout).
            <div className={styles.tree}>
              {/* Unfiled — folderless notes, togglable like a folder. */}
              <div className={styles.treeFolderRow}>
                {unfiledNotes.length > 0 ? (
                  <button type="button" className={styles.treeChevBtn} onClick={() => toggleExpanded('__unfiled__')} aria-label="Toggle unfiled" aria-expanded={expanded.has('__unfiled__')}>
                    <Chevron open={expanded.has('__unfiled__')} />
                  </button>
                ) : <span className={styles.treeChevSpacer} aria-hidden="true" />}
                <button
                  type="button"
                  className={`${styles.treeFolder}${folderId === '__unfiled__' ? ' ' + styles.treeRowActive : ''}`}
                  onClick={() => { setFolder('__unfiled__'); toggleExpanded('__unfiled__') }}
                >
                  <FolderGlyph />
                  <span className={styles.treeFolderName}>Unfiled</span>
                  {unfiledNotes.length > 0 && <span className={styles.treeCount}>{unfiledNotes.length}</span>}
                </button>
              </div>
              {expanded.has('__unfiled__') && unfiledNotes.map(n => (
                <NoteLeaf key={n.id} note={n} depth={1} active={openNoteId === n.id} onOpen={openNote} />
              ))}

              {tree.map(node => (
                <FolderNode
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  onToggle={toggleExpanded}
                  selectedFolder={folderId}
                  onSelectFolder={setFolder}
                  notesByFolder={notesByFolder}
                  openNoteId={openNoteId}
                  onOpenNote={openNote}
                />
              ))}

              {tree.length === 0 && unfiledNotes.length === 0 && (
                <div className={styles.empty}>No notes yet — start one with New.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
