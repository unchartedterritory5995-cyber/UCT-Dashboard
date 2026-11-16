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
  noteContentGuardOptions, isUnreadable, useUnreadableNote,
} from '../../journal-2-0/lib/noteContentGuard'
import UnreadableNoteNotice from '../../journal-2-0/lib/UnreadableNoteNotice'
import {
  mergeNotebookWidgetSettings, notebookWidgetStyleVars, notebookDefaultsForTheme,
} from './notebookWidgetSettings'
import styles from './NotebookWidget.module.css'
import { useWidgetDoor } from '../widgetDoors'
import { createPortal } from 'react-dom'
import { useUctHeaderSlotAlways, useUctControlsSlot, useUctRowIsSub } from '../uctHeaderSlot'
// LOCAL PREVIEW fakes (dev only, only while the local account has no notes) — remove before shipping.

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
function NoteEditor({ noteId, journalUrl, onBack, board = false, meta = null }) {
  const { note, update } = useJ2Note(noteId)
  if (!note) return <div className={styles.empty}>Loading…</div>
  return <NoteEditorInner note={note} update={update} journalUrl={journalUrl} onBack={onBack} board={board} meta={meta} />
}

// The live, editable note — the Notebook's TipTap editor + autosave of title + body.
// `board` (the /charts UCT frame): the title in the display face with the note's folder
// path + last edit under it, and the footer as ‹ Notes · Saved · / Insert · Open in Journal.
function NoteEditorInner({ note, update, journalUrl, onBack, board = false, meta = null }) {
  const [title, setTitle] = useState(note.title || '')
  const [status, setStatus] = useState('')   // '' | 'saving' | 'saved'
  const titleRef = useRef(note.title || '')
  const saveTimer = useRef(null)
  const scheduleRef = useRef(() => {})
  const commitRef = useRef(async () => {})

  const editor = useEditor({
    extensions: buildExtensions(),
    // ⛔ S1/H14: content this bundle cannot read LOCKS the editor instead of
    // opening it empty -- this widget's save sends the body with NO baseline,
    // so an empty stand-in would overwrite the note outright.
    ...noteContentGuardOptions(),
    content: note.bodyJson || { type: 'doc', content: [] },
    onUpdate: () => scheduleRef.current(),
  }, [])
  const unreadable = useUnreadableNote(editor)

  // Ref-latched (updated in an effect, not during render) so the frozen onUpdate
  // closure + the setTimeout always run against the LATEST editor/update.
  useEffect(() => {
    scheduleRef.current = () => {
      if (isUnreadable(editor)) return        // S1: a locked note saves nothing
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

  if (board) {
    return (
      <div className={styles.editorPane}>
        {unreadable && <UnreadableNoteNotice editor={editor} />}
        <div className={styles.editorScroll} onClick={() => editor?.chain().focus().run()}>
          <input
            className={styles.uEdTitle}
            readOnly={unreadable}
            value={title}
            onChange={e => onTitle(e.target.value)}
            onClick={e => e.stopPropagation()}
            placeholder="Untitled note"
            aria-label="Note title"
          />
          {meta && <div className={styles.uEdMeta}>{meta}</div>}
          {editor
            ? <EditorContent editor={editor} className={styles.editorBody} />
            : <div className={styles.empty}>Loading…</div>}
        </div>
        <div className={styles.uFoot}>
          <button type="button" className={styles.uFootBtn} onClick={onBack}>
            <UIcon name="chevronLeft" size={12} gold={false} /> Notes
          </button>
          <span className={`${styles.uSaved}${status === 'saved' ? ' ' + styles.uSavedOn : ''}`} aria-live="polite">
            {status === 'saving' ? 'Saving…' : status === 'saved' ? <><UIcon name="check" size={11} gold={false} /> Saved</> : ''}
          </span>
          <span className={styles.spacer} />
          {!unreadable && (
            <button type="button" className={styles.uFootBtn} title="Insert a block (same as typing /)"
              onClick={() => editor?.chain().focus().insertContent('/').run()}>/ Insert</button>
          )}
          <a className={styles.uFootBtn} href={journalUrl} target="_blank" rel="noreferrer">
            <UIcon name="popOut" size={11} gold={false} /> Open in Journal
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.editorPane}>
      {unreadable && <UnreadableNoteNotice editor={editor} />}
      <input
        className={styles.editorTitle}
        readOnly={unreadable}
        value={title}
        onChange={e => onTitle(e.target.value)}
        placeholder="Untitled note"
        aria-label="Note title"
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

// ── Board (UCT frame) tree: the Watchlist library-rail look — 30px rows, the selected
// folder (where New puts a note) in the grey highlight with the gold rail, counts that
// include sub-folders, and each note's last edit on the right. Same data + handlers. ──
function fmtShort(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86400000)
  if (diff === 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}
function UFolderRow({ id, name, depth, open, canOpen, on, count, onClick }) {
  return (
    <button type="button" className={`${styles.uRow} ${styles.uFolder}${on ? ' ' + styles.uRowOn : ''}`}
      style={{ paddingLeft: 6 + depth * 14 }} onClick={onClick} aria-expanded={canOpen ? open : undefined}
      data-folder-id={id}>
      <span className={styles.uChev} aria-hidden="true">{canOpen && <Chevron open={open} />}</span>
      <FolderGlyph />
      <span className={styles.uName}>{name}</span>
      {on && <span className={styles.uTarget}>New notes go here</span>}
      {count > 0 && <span className={styles.uCount}>{count}</span>}
    </button>
  )
}
function UNoteRow({ note, depth, onOpen }) {
  const t = note.title?.trim() || 'Untitled note'
  return (
    <button type="button" className={`${styles.uRow} ${styles.uNote}`} style={{ paddingLeft: 22 + depth * 14 }}
      onClick={() => onOpen(note.id)} title={t}>
      <UIcon name="document" size={12} gold={false} />
      <span className={styles.uName}>{t}</span>
      <span className={styles.uWhen}>{fmtShort(note.updatedAt || note.createdAt)}</span>
    </button>
  )
}
function UFolderNode({ node, depth, expanded, onToggle, selectedFolder, onSelectFolder, notesByFolder, deepCount, onOpenNote }) {
  const folderNotes = notesByFolder.get(node.id) || []
  const isOpen = expanded.has(node.id)
  const canOpen = node.children.length > 0 || folderNotes.length > 0
  return (
    <>
      <UFolderRow id={node.id} name={node.name} depth={depth} open={isOpen} canOpen={canOpen}
        on={selectedFolder === node.id} count={deepCount.get(node.id) || 0}
        onClick={() => { onSelectFolder(node.id); onToggle(node.id) }} />
      {isOpen && node.children.map(child => (
        <UFolderNode key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle}
          selectedFolder={selectedFolder} onSelectFolder={onSelectFolder} notesByFolder={notesByFolder}
          deepCount={deepCount} onOpenNote={onOpenNote} />
      ))}
      {isOpen && folderNotes.map(n => <UNoteRow key={n.id} note={n} depth={depth + 1} onOpen={onOpenNote} />)}
    </>
  )
}
// The search term marked in a title / snippet (plain text in, React out — no HTML).
function Marked({ text, q }) {
  const s = String(text || '')
  const term = q.trim()
  if (!term) return s
  const parts = s.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'))
  return parts.map((p, i) => (i % 2 ? <mark key={i} className={styles.uMark}>{p}</mark> : p))
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
  // Owner 11-15: the WHOLE note set, not the server's default first 100 — the tree nests every
  // note, so pages of 500 (the server's cap) are pulled until there are no more; the footer
  // counts the server's true total.
  const { notes, refresh, total: notesTotal, hasMore: notesHasMore, loadMore: loadMoreNotes, isLoadingMore: notesLoadingMore, loadMoreError: notesLoadError } =
    useJ2Notes({ q: q.trim() || undefined, sort: 'updated', limit: 500 })
  useEffect(() => {
    if (notesHasMore && !notesLoadingMore && !notesLoadError) loadMoreNotes?.()
  }, [notesHasMore, notesLoadingMore, notesLoadError, loadMoreNotes])
  const noteCount = Number.isFinite(notesTotal) ? notesTotal : notes.length
  // UCT frame (/charts board): the title row and the window-control group to draw into.
  const uctRow = useUctHeaderSlotAlways('notebook')
  const uctCtrls = useUctControlsSlot()
  const uctRowIsSub = useUctRowIsSub()   // a tabbed slot: the tab says "Notebook"
  const onBoard = !!uctRow && !!uctCtrls
  const openNoteRow = useMemo(() => notes.find(n => n.id === openNoteId) || null, [notes, openNoteId])
  // C3-201 (pl-exec round 5): the notes this widget lists, as its own rows open them (openNote → opts.noteId), for the Agent
  // C3-202 (round 6): the notes as the widget lists them, and its New control (newNote, below) for a create
  useWidgetDoor(() => ({
    options: () => ({ note: notes.map(n => ({ value: n.id, label: n.title?.trim() || 'Untitled note' })) }),
    read: () => ({ notes: notes.map(n => ({ id: n.id, name: n.title?.trim() || 'Untitled note' })) }),
    // ONE operation, as its own New control (AUDIT S1-A: never a reconcile of the list it is handed)
    write: (key, v) => { if (key === 'notes' && v && v.op === 'create') newNoteRef.current?.() },
  }))

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
  // Board: a folder's count includes its sub-folders' notes; and a folder's path (root → it).
  const deepCount = useMemo(() => {
    const m = new Map()
    const walk = (node) => {
      let c = (notesByFolder.get(node.id) || []).length
      for (const ch of node.children) c += walk(ch)
      m.set(node.id, c)
      return c
    }
    tree.forEach(walk)
    return m
  }, [tree, notesByFolder])
  const folderPath = useCallback((fid) => {
    const byId = new Map(folders.map(f => [f.id, f]))
    const out = []
    let f = fid ? byId.get(fid) : null
    while (f && out.length < 20) { out.unshift(f); f = f.parentId != null ? byId.get(f.parentId) : null }
    return out
  }, [folders])

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
  const newNoteRef = useRef(null)
  // `target` (board New menu): a folder id, or '__unfiled__'; anything else (a click event,
  // the Agent's call) uses the selected folder as before.
  const newNote = async (target) => {
    if (creating) return
    setCreating(true)
    try {
      const f = typeof target === 'string' ? target : folderId
      const fid = f && f !== '__unfiled__' ? f : null
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

  newNoteRef.current = newNote
  const journalUrl = openNoteId ? `/journal/notebook?note=${encodeURIComponent(openNoteId)}` : '/journal/notebook'

  // Board New menu (New → in the selected folder, or pick another).
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const newMenuRef = useRef(null)
  useEffect(() => {
    if (!newMenuOpen) return undefined
    const onDown = (e) => { if (!newMenuRef.current?.contains(e.target)) setNewMenuOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setNewMenuOpen(false) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [newMenuOpen])

  if (onBoard) {
    const folderName = (fid) => (!fid || fid === '__unfiled__' ? 'Unfiled' : (folders.find(f => f.id === fid)?.name || 'Unfiled'))
    const targetName = folderName(folderId)
    const openPath = openNoteRow ? folderPath(openNoteRow.folderId) : []
    const goFolder = (fid) => {
      setExpanded(prev => { const next = new Set(prev); folderPath(fid).forEach(f => next.add(f.id)); return next })
      onOptsChange?.({ ...(opts || {}), folderId: fid, noteId: undefined })
    }
    const gearBtn = (
      <button
        ref={settingsBtnRef}
        type="button"
        className={`${styles.uIc}${settingsOpen ? ' ' + styles.uIcOn : ''}`}
        data-guide="widget.settings" onClick={() => setSettingsOpen(o => !o)}
        title="Notebook settings" aria-label="Notebook settings"
      ><UIcon name="gear" size={14} gold={false} /></button>
    )
    const titleRow = openNoteId ? (
      <nav className={styles.uCrumb} aria-label="Note location">
        <button type="button" className={styles.uCrumbBtn} onClick={() => openNote(null)} title="Back to notes" aria-label="Back to notes">
          <UIcon name="chevronLeft" size={12} gold={false} /><span className={styles.uCrumbBack}>Notes</span>
        </button>
        {openPath.map(f => (
          <span key={f.id} className={styles.uCrumbPath}>
            <span className={styles.uCrumbSep} aria-hidden="true">/</span>
            <button type="button" className={styles.uCrumbBtn} onClick={() => goFolder(f.id)}>{f.name}</button>
          </span>
        ))}
        <span className={styles.uCrumbSep} aria-hidden="true">/</span>
        <span className={styles.uCrumbCur}>{openNoteRow?.title?.trim() || 'Untitled note'}</span>
      </nav>
    ) : <span className={styles.uTitle}>Notebook</span>
    const otherFolders = [{ id: '__unfiled__', name: 'Unfiled' }, ...folders].filter(f => f.id !== (folderId || '__unfiled__'))
    const meta = openNoteRow ? (
      <>
        <span className={styles.uMetaPath}><FolderGlyph /> {openPath.map(f => f.name).join(' › ') || 'Unfiled'}</span>
        {(openNoteRow.updatedAt || openNoteRow.createdAt) && <span>Edited {fmtShort(openNoteRow.updatedAt || openNoteRow.createdAt)}</span>}
      </>
    ) : null

    return (
      <div ref={rootRef} className={`${styles.root} ${styles.uRoot}`} style={rootStyle}>
        {/* tabbed slot (owner 11-14): no plain "Notebook" row under the tab — only an open note's path */}
        {!(uctRowIsSub && !openNoteId) && createPortal(titleRow, uctRow)}
        {createPortal(gearBtn, uctCtrls)}
        {settingsOpen && (
          <NewsSettingsPanel
            title="Notebook settings"
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
            uct
          />
        )}

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
            <NoteEditor noteId={openNoteId} journalUrl={journalUrl} onBack={() => openNote(null)} board meta={meta} />
          </EditorBoundary>
        ) : (
          <>
            <div className={styles.uSearchRow}>
              <label className={styles.uSearch}>
                <UIcon name="search" size={13} gold={false} />
                <input placeholder="Search notes…" aria-label="Search notes" value={q} onChange={e => setQ(e.target.value)} />
              </label>
              <div className={styles.uNewWrap} ref={newMenuRef}>
                <button type="button" className={styles.uNewBtn} data-guide="notebook.new" disabled={creating}
                  onClick={() => setNewMenuOpen(o => !o)} aria-haspopup="menu" aria-expanded={newMenuOpen}
                  title={`New note in ${targetName}`}>
                  <UIcon name="plus" size={12} gold={false} /> New
                  <span className={styles.uNewInto}>· {targetName}</span>
                  <span className={styles.uNewCar} aria-hidden="true"><UIcon name="chevronDown" size={12} gold={false} /></span>
                </button>
                {newMenuOpen && (
                  <div className={styles.uMenu} role="menu" style={menuVars}>
                    <button type="button" role="menuitem" className={styles.uMenuItem}
                      onClick={() => { setNewMenuOpen(false); newNote(folderId || '__unfiled__') }}>
                      <span className={styles.uMenuGlyph}><UIcon name="plus" size={12} gold={false} /></span>
                      New note<small>in {targetName}</small>
                    </button>
                    {otherFolders.length > 0 && <div className={styles.uMenuSep} />}
                    {otherFolders.length > 0 && <div className={styles.uMenuLabel}>Or put it in</div>}
                    <div className={styles.uMenuScroll}>
                      {otherFolders.map(f => (
                        <button key={f.id} type="button" role="menuitem" className={styles.uMenuItem}
                          onClick={() => { setNewMenuOpen(false); newNote(f.id) }}>
                          <span className={styles.uMenuCheck}><FolderGlyph /></span>
                          <span className={styles.uName}>{folderPath(f.id).map(x => x.name).join(' › ') || f.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.uBody}>
              {q.trim() ? (
                notes.length === 0 ? (
                  <div className={styles.empty}>No notes match.</div>
                ) : (
                  <>
                    <div className={styles.uGroup}>{notes.length} {notes.length === 1 ? 'note matches' : 'notes match'} “{q.trim()}”<span>all folders</span></div>
                    {notes.map(n => (
                      <button key={n.id} type="button" className={styles.uResult} onClick={() => openNote(n.id)}>
                        <span className={styles.uResTitle}>
                          <span className={styles.uName}><Marked text={n.title?.trim() || 'Untitled note'} q={q} /></span>
                          <span className={styles.uWhen}>{fmtShort(n.updatedAt || n.createdAt)}</span>
                        </span>
                        {n.bodyPlain && <span className={styles.uResSnip}><Marked text={n.bodyPlain} q={q} /></span>}
                        <span className={styles.uResFolder}>{folderPath(n.folderId).map(f => f.name).join(' › ') || 'Unfiled'}</span>
                      </button>
                    ))}
                  </>
                )
              ) : (
                <div className={styles.uTree}>
                  <UFolderRow id="__unfiled__" name="Unfiled" depth={0} open={expanded.has('__unfiled__')}
                    canOpen={unfiledNotes.length > 0} on={folderId === '__unfiled__'} count={unfiledNotes.length}
                    onClick={() => { setFolder('__unfiled__'); toggleExpanded('__unfiled__') }} />
                  {expanded.has('__unfiled__') && unfiledNotes.map(n => <UNoteRow key={n.id} note={n} depth={0} onOpen={openNote} />)}
                  {tree.map(node => (
                    <UFolderNode key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggleExpanded}
                      selectedFolder={folderId} onSelectFolder={setFolder} notesByFolder={notesByFolder}
                      deepCount={deepCount} onOpenNote={openNote} />
                  ))}
                  {tree.length === 0 && unfiledNotes.length === 0 && (
                    <div className={styles.empty}>No notes yet. Start one with New.</div>
                  )}
                </div>
              )}
            </div>

            <div className={styles.uFoot}>
              <span className={styles.uFootCount}><b>{noteCount}</b> {noteCount === 1 ? 'note' : 'notes'}{!q.trim() && ` · ${folders.length} ${folders.length === 1 ? 'folder' : 'folders'}`}</span>
              <span className={styles.spacer} />
              <a className={styles.uFootBtn} href={journalUrl} target="_blank" rel="noreferrer">
                <UIcon name="popOut" size={11} gold={false} /> Open in Journal
              </a>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div ref={rootRef} className={styles.root} style={rootStyle}>
      {settingsOpen && (
        <NewsSettingsPanel
          title="Notebook settings"
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
          data-guide="widget.settings" onClick={() => setSettingsOpen(o => !o)}
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
            <input className={styles.search} placeholder="Search notes…" aria-label="Search notes" value={q} onChange={e => setQ(e.target.value)} />
            <button type="button" className={styles.newBtn} data-guide="notebook.new" onClick={newNote} disabled={creating} title="New note">
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
