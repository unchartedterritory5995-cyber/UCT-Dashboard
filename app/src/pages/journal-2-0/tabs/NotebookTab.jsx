import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import useJ2Notes from '../hooks/useJ2Notes'
import NoteCard from '../components/notebook/NoteCard'
import FolderSidebar from '../components/notebook/FolderSidebar'
import NoteEditorPage from '../components/notebook/NoteEditorPage'
import TemplatePicker from '../components/notebook/TemplatePicker'
import Sheet from '../../../components/mobile/Sheet'
import { getTemplate } from '../lib/notebookTemplates'
import { assembleTemplateContext } from '../lib/templateContext'
import styles from './NotebookTab.module.css'

export default function NotebookTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const noteId = searchParams.get('note')

  const [folderId, setFolderId] = useState(null)
  const [tag, setTag] = useState(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('updated')
  const [creating, setCreating] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const deepLinkRan = useRef(false)

  const { notes, isLoading, error, refresh } = useJ2Notes({
    folderId, tag, q: q || undefined, sort,
  })

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
  }

  // Create a note. Blank note passes no title/body; a template seeds both
  // (plus its preset tags and, when known, the ticker).
  const createNote = async ({ title = '', bodyJson, tags, ticker } = {}) => {
    setCreating(true)
    setPickerOpen(false)
    try {
      const res = await fetch('/api/j2/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          ...(bodyJson ? { bodyJson } : {}),
          ...(tags && tags.length ? { tags } : {}),
          ...(ticker ? { ticker } : {}),
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

  // Deep link: ?seg=notebook&new=<templateKey>[&ticker=SYM] — Today page, the
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

  if (noteId) {
    return <NoteEditorPage noteId={noteId} onBack={closeNote} />
  }

  return (
    <div className={styles.wrap}>
      <FolderSidebar
        notes={notes}
        activeFolderId={folderId}
        onSelectFolder={setFolderId}
        activeTag={tag}
        onSelectTag={setTag}
      />
      <div className={styles.main}>
        <div className={styles.toolbar}>
          <input
            type="text"
            className={styles.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes…"
          />
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

        <Sheet
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          title="New note"
          variant="auto"
          maxWidth={720}
        >
          <TemplatePicker onPick={handlePick} busy={creating} />
        </Sheet>

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
      </div>
    </div>
  )
}
