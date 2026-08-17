import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useJ2Notes from '../hooks/useJ2Notes'
import NoteCard from '../components/notebook/NoteCard'
import FolderSidebar from '../components/notebook/FolderSidebar'
import NoteEditorPage from '../components/notebook/NoteEditorPage'
import TemplatePicker from '../components/notebook/TemplatePicker'
import ImportWizard from '../components/notebook/import/ImportWizard'
import NoteConnectorsTrustStrip from '../components/connectors/NoteConnectorsTrustStrip'
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import { getTemplate } from '../lib/notebookTemplates'
import { assembleTemplateContext } from '../lib/templateContext'
import useAppFocus from '../../../hooks/useAppFocus'
import styles from './NotebookTab.module.css'

// Folders panel resize bounds (px).
const SB_MIN = 190
const SB_MAX = 520
const SB_DEFAULT = 260

// Obsidian-style "toggle left panel" glyph — a rounded frame with the left
// column filled, matching the button the user referenced.
function SidebarToggleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4.75" width="18" height="14.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <line x1="9.5" y1="4.75" x2="9.5" y2="19.25" stroke="currentColor" strokeWidth="1.7" />
      <rect x="4.9" y="6.4" width="3.1" height="11.2" rx="1" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

export default function NotebookTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const noteId = searchParams.get('note')

  const [folderId, setFolderId] = useState(null)
  const [tag, setTag] = useState(null)
  const [sort, setSort] = useState('updated')
  const [creating, setCreating] = useState(false)
  // App focus (= charts Group A) seeds a new entry's ticker.
  const { symbol: focusSymbol } = useAppFocus()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  // Bumped on a successful import to force-remount FolderSidebar, which owns
  // its own useJ2NoteFolders() SWR hook — an import can create new folders
  // and there's no other handle on that hook's mutate() from up here.
  const [folderRefreshKey, setFolderRefreshKey] = useState(0)
  const deepLinkRan = useRef(false)

  // Folders panel: open/closed + width, persisted locally so it survives reloads.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem('uct.j2.nb.sidebarOpen') !== '0' } catch { return true }
  })
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem('uct.j2.nb.sidebarWidth'), 10)
      return Number.isFinite(v) ? Math.min(SB_MAX, Math.max(SB_MIN, v)) : SB_DEFAULT
    } catch { return SB_DEFAULT }
  })
  const [dragging, setDragging] = useState(false)
  const wrapRef = useRef(null)
  const dragWidthRef = useRef(sidebarWidth)

  const toggleSidebar = () => setSidebarOpen((open) => {
    const next = !open
    try { localStorage.setItem('uct.j2.nb.sidebarOpen', next ? '1' : '0') } catch { /* private mode */ }
    return next
  })

  // Divider drag. The live width is written straight to a CSS variable on the
  // wrap element (no React state per move) so the panel tracks the pointer 1:1
  // with zero render lag; state + localStorage are committed once, on release.
  const startResize = (e) => {
    e.preventDefault()
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setDragging(true)
    const onMove = (ev) => {
      const w = Math.min(SB_MAX, Math.max(SB_MIN, ev.clientX - rect.left))
      dragWidthRef.current = w
      wrap.style.setProperty('--nb-sb-w', `${w}px`)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      setDragging(false)
      const w = dragWidthRef.current
      setSidebarWidth(w)
      try { localStorage.setItem('uct.j2.nb.sidebarWidth', String(w)) } catch { /* private mode */ }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const { notes, isLoading, error, refresh } = useJ2Notes({
    folderId, tag, sort,
  })
  // The folder sidebar renders every folder's notes as leaf rows AND runs its
  // own search, so it needs the COMPLETE note set — not the filtered view above
  // (which only holds the selected folder's notes). Separate unfiltered fetch.
  const { notes: allNotes, refresh: refreshAll } = useJ2Notes({ sort: 'title' })
  const hasActiveFilters = Boolean(folderId || tag)

  const openNote = (note) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('note', note.id)
      // Deep-link params ride along in `prev` when a template create opened
      // this note (setSearchParams' functional prev can be a render stale) —
      // drop them here so the final URL is always clean.
      next.delete('new')
      next.delete('ticker')
      return next
    }, { replace: false })
  }
  const closeNote = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('note')
      return next
    }, { replace: false })
    refresh()
    refreshAll()
  }

  // Selecting a folder / tag from the (now always-present) sidebar while a note
  // is open should leave the note and show that filtered grid.
  const clearNoteParam = () => setSearchParams((prev) => {
    const next = new URLSearchParams(prev)
    next.delete('note')
    return next
  }, { replace: false })
  const handleSelectFolder = (id) => { setFolderId(id); if (noteId) clearNoteParam() }
  const handleSelectTag = (t) => { setTag(t); if (noteId) clearNoteParam() }

  // Create a note. Blank note passes no title/body; a template seeds both
  // (plus its preset tags and, when known, the ticker).
  const createNote = async ({ title = '', bodyJson, tags, ticker } = {}) => {
    setCreating(true)
    setPickerOpen(false)
    try {
      // App focus (= charts Group A): charting AMD and then starting an entry
      // should not make you retype AMD. An explicit ticker always wins; focus
      // only fills the blank.
      const seededTicker = ticker || focusSymbol || null
      const res = await fetch('/api/j2/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          ...(bodyJson ? { bodyJson } : {}),
          ...(tags && tags.length ? { tags } : {}),
          ...(seededTicker ? { ticker: seededTicker } : {}),
          ...(folderId && folderId !== '__unfiled__' ? { folderId } : {}),
        }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const body = await res.json()
      openNote(body.note)
    } catch (e) {
      alert(`Could not create note: ${e.message || e}`)
    } finally {
      setCreating(false)
    }
  }

  // Data-aware create: assemble the context a template declares it needs
  // (regime / positions / today's game plan), then seed title + body from it.
  // Every context source is best-effort — no data still yields the scaffold.
  const createFromTemplate = async (tpl, { ticker } = {}) => {
    setCreating(true)
    setPickerOpen(false)
    let ctx
    try {
      ctx = await assembleTemplateContext({ ticker, needs: tpl.needs })
    } catch {
      ctx = { ticker: ticker || null }
    }
    await createNote({
      title: tpl.defaultTitle(ctx),
      bodyJson: tpl.build(ctx),
      tags: tpl.tags,
      ticker: ctx.ticker,
    })
  }

  const handlePick = (tplOrNull) =>
    tplOrNull ? createFromTemplate(tplOrNull) : createNote()

  // A successful import can create notes AND folders — refresh both. Notes
  // come back through useJ2Notes' own refresh(); folders live behind
  // FolderSidebar's own useJ2NoteFolders() hook with no exposed handle up
  // here, so a key bump remounts it and its SWR hook re-fetches fresh.
  const handleImported = () => {
    refresh()
    refreshAll()
    setFolderRefreshKey((k) => k + 1)
  }

  // Deep link: /journal/notebook?new=<templateKey>[&ticker=SYM] — Today page, the
  // EOD recap, and TradeDrawer open a pre-seeded template directly (plan §4).
  // Runs once; params are stripped either way so a stale key can't loop.
  const newKey = searchParams.get('new')
  useEffect(() => {
    if (!newKey || noteId || creating || deepLinkRan.current) return
    deepLinkRan.current = true
    const tpl = getTemplate(newKey)
    const ticker = searchParams.get('ticker')
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('new')
      next.delete('ticker')
      return next
    }, { replace: true })
    if (tpl) createFromTemplate(tpl, { ticker })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newKey])

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${sidebarOpen ? '' : styles.collapsed} ${dragging ? styles.dragging : ''}`}
      style={{ '--nb-sb-w': `${sidebarWidth}px` }}
    >
      {/* When the panel is hidden, a single floating button brings it back. When
          open, the collapse control lives in the panel's own header toolbar. */}
      {!sidebarOpen && (
        <button
          type="button"
          className={styles.sidebarToggle}
          onClick={toggleSidebar}
          aria-label="Show folders panel"
          title="Show folders"
        >
          <SidebarToggleIcon />
        </button>
      )}

      <div className={styles.sidebarSlot}>
        <div className={styles.sidebarInner}>
          <FolderSidebar
            key={folderRefreshKey}
            notes={allNotes}
            activeFolderId={folderId}
            onSelectFolder={handleSelectFolder}
            activeTag={tag}
            onSelectTag={handleSelectTag}
            onOpenNote={openNote}
            activeNoteId={noteId}
            onToggleSidebar={toggleSidebar}
          />
        </div>
      </div>

      <div
        className={styles.divider}
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize folders panel"
      />

      <div className={styles.main}>
        {noteId ? (
          // Key by noteId so switching notes from the persistent sidebar remounts
          // the editor fresh (TipTap state + autosave), same as opening from the grid.
          <NoteEditorPage key={noteId} noteId={noteId} onBack={closeNote} showBack={false} />
        ) : (
          <>
        <div className={styles.toolbar}>
          <select
            className={styles.sortSelect}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="updated">Recently updated</option>
            <option value="created">Recently created</option>
            <option value="title">Title</option>
          </select>
          {(folderId || tag) && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => { setFolderId(null); setTag(null) }}
            >
              Clear filter
            </button>
          )}
          <div className={styles.newWrap}>
            <button
              type="button"
              className={styles.importBtn}
              onClick={() => setImportOpen(true)}
              aria-haspopup="dialog"
            >
              <UIcon name="upload" size={16} gold={false} />
              Import
            </button>
            <button
              type="button"
              className={styles.templatesBtn}
              onClick={() => setPickerOpen(true)}
              disabled={creating}
              aria-haspopup="dialog"
            >
              Templates
            </button>
            <button
              type="button"
              className={styles.newBtn}
              onClick={() => createNote()}
              disabled={creating}
            >
              + New note
            </button>
          </div>
        </div>

        <NoteConnectorsTrustStrip />

        <Sheet
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title="New note"
          variant="auto"
          maxWidth={720}
        >
          <TemplatePicker onPick={handlePick} busy={creating} />
        </Sheet>

        <ImportWizard
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={handleImported}
        />

        {error && (
          <div className={styles.error}>
            Couldn't load notes: {String(error.message || error)}
          </div>
        )}

        {isLoading && notes.length === 0 ? (
          <div className={styles.empty}>Loading…</div>
        ) : notes.length === 0 ? (
          <div className={styles.empty}>
            <p>Your notebook is empty.</p>
            <p className={styles.emptyHint}>
              Start from a template — or a blank page.
            </p>
            {!hasActiveFilters && (
              <div className={styles.emptyImportPitch}>
                <p className={styles.emptyHint}>
                  Bring your notes from Notion, Obsidian, Evernote, or anywhere else.
                </p>
                <button
                  type="button"
                  className={`${styles.importBtn} ${styles.importBtnEmphasized}`}
                  onClick={() => setImportOpen(true)}
                  aria-haspopup="dialog"
                >
                  <UIcon name="upload" size={16} gold={false} />
                  Import notes
                </button>
              </div>
            )}
            <div className={styles.emptyPicker}>
              <TemplatePicker onPick={handlePick} busy={creating} />
            </div>
          </div>
        ) : (
          <div className={styles.grid}>
            {notes.map((n) => (
              <NoteCard key={n.id} note={n} onOpen={openNote} />
            ))}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  )
}
