import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import Sheet from '../../../components/mobile/Sheet'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { ExampleBlock, ExampleForm } from '../shared/ChartExampleKit'
import UpbRichEditor from './UpbRichEditor'
import styles from './BuilderView.module.css'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => r.json())

// JSON fetch that REJECTS on failure with err.status attached — the contract
// both UpbRichEditor (retry backoff keys off status) and the ChartExampleKit
// api wrappers depend on. Small enough to live in each builder file rather
// than force a shared-module import cycle.
async function upbFetch(url, method = 'GET', body) {
  const r = await fetch(url, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    let detail = ''
    try { detail = (await r.json())?.detail || '' } catch { /* non-JSON error body */ }
    const err = new Error(detail || `Request failed (${r.status})`)
    err.status = r.status
    throw err
  }
  return r.json()
}

const MAX_CHARTS_PER_ENTRY = 10   // mirrors the server cap (friendly disable, server enforces)
const MAX_NOTE_LINKS = 10

// Epoch seconds (server) or ms → short date.
function fmtDate(ts) {
  if (!ts) return ''
  const ms = ts > 1e12 ? ts : ts * 1000
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Note-link picker ──────────────────────────────────────────────────────────
// Modal listing the user's Notebook notes (GET /api/j2/notes?sort=updated&q=);
// Save replace-sets the entry's links (PUT note-links). Selection is seeded
// from the entry's LIVE links each time the sheet opens — dead (tombstone)
// links can't be re-submitted (their notes fail the server ownership check),
// so editing the set inherently clears them.
function NoteLinkPicker({ open, onClose, entryId, currentIds, onSaved }) {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250)
    return () => clearTimeout(t)
  }, [q])
  const { data } = useSWR(
    open ? `/api/j2/notes?sort=updated${debouncedQ ? `&q=${encodeURIComponent(debouncedQ)}` : ''}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )
  const notes = data?.notes || []

  const [selected, setSelected] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setSelected(new Set(currentIds))
      setQ('')
      setErr(null)
    }
    wasOpen.current = open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < MAX_NOTE_LINKS) next.add(id)
      return next
    })
  }

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      await upbFetch(`/api/upb/entries/${entryId}/note-links`, 'PUT', { note_ids: [...selected] })
      onSaved?.()
      onClose()
    } catch (e) {
      setErr(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Link Notebook notes"
      footer={(
        <div className={styles.pickerFooter}>
          <span className={styles.capNote}>{selected.size}/{MAX_NOTE_LINKS} linked</span>
          <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="button" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save links'}
          </button>
        </div>
      )}
    >
      <input
        className={styles.pickerSearch}
        type="search"
        value={q}
        placeholder="Search your notes…"
        onChange={e => setQ(e.target.value)}
        aria-label="Search notes"
      />
      {err && <div className={styles.pickerErr}>{err}</div>}
      <div className={styles.noteList}>
        {notes.map(n => {
          const on = selected.has(n.id)
          return (
            <button
              key={n.id}
              type="button"
              className={`${styles.noteRowBtn} ${on ? styles.noteRowOn : ''}`}
              onClick={() => toggle(n.id)}
              disabled={!on && selected.size >= MAX_NOTE_LINKS}
            >
              <span className={styles.noteRowCheck}>{on ? '✓' : ''}</span>
              <span className={styles.noteRowTitle}>{n.title || 'Untitled note'}</span>
              <span className={styles.noteRowDate}>{fmtDate(n.updatedAt)}</span>
            </button>
          )
        })}
        {notes.length === 0 && (
          <p className={styles.emptyNote}>
            {debouncedQ ? 'No notes match.' : 'No Notebook notes yet — write one in Journal → Notebook first.'}
          </p>
        )}
      </div>
    </Sheet>
  )
}

// ── Entry page ────────────────────────────────────────────────────────────────
// Title (debounced PUT) + rich write-up (UpbRichEditor autosave) on the left,
// Charted Examples (ChartExampleKit, canEdit always true — server enforces
// ownership) on the right, with "From my Notebook" chips up top. Phone gets
// the pane-switch treatment (Write-up ⇄ Charts) instead of stacked columns.
export default function UpbEntryPage({ entryId, onBack }) {
  const { data, mutate } = useSWR(`/api/upb/entries/${entryId}`, fetcher, { revalidateOnFocus: false })
  const entry = data?.entry || null
  const charts = entry?.charts || []
  const noteLinks = entry?.note_links || []

  const isPhone = useIsPhone()
  const [mobilePane, setMobilePane] = useState('write')

  // Title: local draft seeded once per entry, debounced PUT. The pending value
  // rides a ref so the unmount flush saves whatever was last typed.
  const [title, setTitle] = useState('')
  const seededFor = useRef(null)
  const titleTimer = useRef(null)
  const pendingTitle = useRef(null)
  useEffect(() => {
    if (entry && seededFor.current !== entry.id) {
      // Create-then-type race: text typed before the initial GET lands must not
      // be clobbered by that stale response — the debounced PUT already carries it.
      if (pendingTitle.current == null) setTitle(entry.title || '')
      seededFor.current = entry.id
    }
  }, [entry])
  function onTitleChange(v) {
    setTitle(v)
    pendingTitle.current = v
    clearTimeout(titleTimer.current)
    titleTimer.current = setTimeout(() => {
      const val = pendingTitle.current
      pendingTitle.current = null
      upbFetch(`/api/upb/entries/${entryId}`, 'PUT', { title: val })
        .catch(e => console.warn('playbook title save failed', e))
    }, 600)
  }
  useEffect(() => () => {
    clearTimeout(titleTimer.current)
    if (pendingTitle.current != null) {
      upbFetch(`/api/upb/entries/${entryId}`, 'PUT', { title: pendingTitle.current }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId])

  // Body autosave target for UpbRichEditor — rejections carry err.status so
  // the editor's retry backoff can tell 5xx (retry) from 4xx (stop).
  const saveBody = useCallback(async ({ bodyJson }) => {
    await upbFetch(`/api/upb/entries/${entryId}`, 'PUT', { body_json: bodyJson })
  }, [entryId])

  // ChartExampleKit api: create carries the parent entry context; patch and
  // update both hit the same PUT (the backend PUT is a partial patch —
  // model_dump(exclude_unset=True) — so the annotate save's single-field body
  // never nulls the other columns).
  const chartApi = useMemo(() => ({
    create: body => upbFetch(`/api/upb/entries/${entryId}/charts`, 'POST', body),
    update: (id, body) => upbFetch(`/api/upb/charts/${id}`, 'PUT', body),
    patch: (id, body) => upbFetch(`/api/upb/charts/${id}`, 'PUT', body),
    remove: id => upbFetch(`/api/upb/charts/${id}`, 'DELETE'),
  }), [entryId])

  const refresh = useCallback(() => { mutate() }, [mutate])
  const [addingChart, setAddingChart] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const liveNoteIds = useMemo(
    () => noteLinks.filter(l => l.live).map(l => l.noteId),
    [noteLinks],
  )

  return (
    <div className={styles.page}>
      <div className={styles.entryHead}>
        <button className={styles.backBtn} onClick={onBack}>‹ Back</button>
        <input
          className={styles.titleInput}
          value={title}
          placeholder="Name this entry…"
          onChange={e => onTitleChange(e.target.value)}
          aria-label="Entry title"
        />
      </div>

      {/* From my Notebook — chip href works under BOTH J2 shells (plain <a>,
          never the v5 path); dead links are muted tombstones. */}
      <div className={styles.noteRow}>
        <span className={styles.noteRowLabel}>From my Notebook</span>
        {noteLinks.map(l => l.live ? (
          <a key={l.noteId} className={styles.noteChip} href={`/journal?j2tab=notebook&note=${l.noteId}`}>
            {l.title || 'Untitled note'}
          </a>
        ) : (
          <span key={l.noteId} className={`${styles.noteChip} ${styles.noteChipDead}`} title="This note was deleted from your Notebook">
            {l.title || 'Deleted note'}
          </span>
        ))}
        <button className={styles.noteLinkBtn} onClick={() => setPickerOpen(true)}>+ Link note</button>
      </div>

      {isPhone && (
        <div className={styles.paneSwitch}>
          <button
            className={`${styles.paneBtn} ${mobilePane === 'write' ? styles.paneBtnActive : ''}`}
            onClick={() => setMobilePane('write')}
          >Write-up</button>
          <button
            className={`${styles.paneBtn} ${mobilePane === 'charts' ? styles.paneBtnActive : ''}`}
            onClick={() => setMobilePane('charts')}
          >Charts{charts.length ? ` (${charts.length})` : ''}</button>
        </div>
      )}

      <div className={styles.entryBody}>
        {(!isPhone || mobilePane === 'write') && (
          <div className={styles.editorCol}>
            {entry ? (
              <UpbRichEditor
                contentKey={entry.id}
                docJson={entry.body_json || null}
                placeholder="Write the play — or type / for blocks"
                onSave={saveBody}
              />
            ) : (
              <p className={styles.loadingNote}>Loading…</p>
            )}
          </div>
        )}

        {(!isPhone || mobilePane === 'charts') && (
          <div className={styles.chartsCol}>
            <div className={styles.chartsHead}>
              <h3 className={styles.chartsTitle}>Charted examples</h3>
              <button
                className="btn btn-primary"
                onClick={() => setAddingChart(a => !a)}
                disabled={!addingChart && charts.length >= MAX_CHARTS_PER_ENTRY}
                title={charts.length >= MAX_CHARTS_PER_ENTRY ? `Limit of ${MAX_CHARTS_PER_ENTRY} charts per entry` : undefined}
              >
                {addingChart ? 'Close' : '+ Add chart'}
              </button>
            </div>
            {addingChart && (
              <ExampleForm
                api={chartApi}
                onSaved={() => { setAddingChart(false); refresh() }}
                onCancel={() => setAddingChart(false)}
              />
            )}
            {charts.map(c => (
              <ExampleBlock key={c.id} ex={c} canEdit api={chartApi} onChanged={refresh} />
            ))}
            {charts.length === 0 && !addingChart && (
              <p className={styles.emptyNote}>
                No charts yet — add the textbook example of this setup, framed on its setup day.
              </p>
            )}
          </div>
        )}
      </div>

      <NoteLinkPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        entryId={entryId}
        currentIds={liveNoteIds}
        onSaved={refresh}
      />
    </div>
  )
}
