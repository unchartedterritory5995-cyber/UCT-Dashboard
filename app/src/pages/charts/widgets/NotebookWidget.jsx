/**
 * Notebook widget — an in-charts window onto the user's Journal 2.0 Notebook, so
 * they can browse/read their notes and jot new ones (into their existing folders)
 * while other widgets are up. Reading renders the note's TipTap doc to static HTML
 * (generateHTML — no live editor mount, so it's light + safe in a widget); rich
 * editing lives in the real Notebook via a one-click "Edit in Journal" deep-link.
 *
 * Appearance (canvas + text color) is a per-widget ⚙ blob like the other widgets;
 * the selected folder + open note persist per-widget via opts, and the widget
 * follows the app theme until customized.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { generateHTML } from '@tiptap/core'
import usePreferences from '../../../hooks/usePreferences'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import NewsSettingsPanel from './NewsSettingsPanel'
import useJ2Notes from '../../journal-2-0/hooks/useJ2Notes'
import useJ2NoteFolders from '../../journal-2-0/hooks/useJ2NoteFolders'
import { buildExtensions } from '../../journal-2-0/lib/tiptap'
import {
  mergeNotebookWidgetSettings, notebookWidgetStyleVars, notebookDefaultsForTheme,
} from './notebookWidgetSettings'
import styles from './NotebookWidget.module.css'

// Build a TipTap doc from plain textarea text (each non-empty line → a paragraph).
function textToDoc(text) {
  const lines = String(text || '').split('\n')
  const content = lines.map(l => (l.trim()
    ? { type: 'paragraph', content: [{ type: 'text', text: l }] }
    : { type: 'paragraph' }))
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Static, read-only render of a note's TipTap doc (no editor instance).
function NoteHtml({ bodyJson }) {
  const html = useMemo(() => {
    try {
      const doc = bodyJson && typeof bodyJson === 'object' ? bodyJson : { type: 'doc', content: [] }
      return generateHTML(doc, buildExtensions())
    } catch {
      return ''
    }
  }, [bodyJson])
  if (!html) return <div className={styles.empty}>This note is empty.</div>
  return <div className={styles.prose} dangerouslySetInnerHTML={{ __html: html }} />
}

export default function NotebookWidget({ opts, onOptsChange }) {   // `color` (symbol group) unused — the notebook isn't symbol-scoped
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

  // ── New-note inline composer ──
  const [composing, setComposing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [saving, setSaving] = useState(false)
  const startCompose = () => { setDraftTitle(''); setDraftBody(''); setComposing(true) }
  const saveNote = async () => {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/j2/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle.trim(),
          bodyJson: textToDoc(draftBody),
          ...(folderId ? { folderId } : {}),
        }),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const body = await res.json()
      setComposing(false)
      await refresh()
      if (body?.note?.id) openNote(body.note.id)   // land on the new note
    } catch (e) {
      alert(`Could not save note: ${e.message || e}`)
    } finally {
      setSaving(false)
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
            <select
              className={styles.folderSelect}
              value={folderId}
              onChange={e => setFolder(e.target.value)}
              title="Folder"
            >
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
        <div className={styles.reader}>
          <div className={styles.readerTitle}>{openNoteRow?.title || 'Untitled note'}</div>
          {openNoteRow?.updatedAt && <div className={styles.readerMeta}>Updated {fmtWhen(openNoteRow.updatedAt)}</div>}
          <NoteHtml bodyJson={openNoteRow?.bodyJson} />
          <a className={styles.editLink} href={journalUrl} target="_blank" rel="noreferrer">
            <UIcon name="link" size={12} /> Edit in Journal
          </a>
        </div>
      ) : composing ? (
        <div className={styles.composer}>
          <input
            className={styles.composerTitle}
            placeholder="Note title"
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            autoFocus
          />
          <textarea
            className={styles.composerBody}
            placeholder="Jot your note…"
            value={draftBody}
            onChange={e => setDraftBody(e.target.value)}
          />
          <div className={styles.composerActions}>
            <button type="button" className={styles.ghostBtn} onClick={() => setComposing(false)} disabled={saving}>Cancel</button>
            <button type="button" className={styles.primaryBtn} onClick={saveNote} disabled={saving || (!draftTitle.trim() && !draftBody.trim())}>
              {saving ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <input
              className={styles.search}
              placeholder="Search notes…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <button type="button" className={styles.newBtn} onClick={startCompose} title="New note">
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
