import { useEditor, EditorContent } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import useSWR, { mutate as globalMutate } from 'swr'
import {
  buildExtensions, uploadInlineImage, uploadNoteAttachment,
  ALLOWED_IMAGE_MIMES, ALLOWED_ATTACHMENT_MIMES,
} from '../../lib/tiptap'
import Toast from '../Toast'
import DocumentPreviewSheet from './DocumentPreviewSheet'
import CapturedSourceSheet from './CapturedSourceSheet'
import { targetFromParams, applyTargetToParams, excerptRevisitTarget, citationTarget,
         reviewTargetFromParams } from '../../lib/searchNavigation'
import useNoteDocuments from '../../hooks/useNoteDocuments'
import DocumentTextStatus from './DocumentTextStatus'
import useNoteExcerpts from '../../hooks/useNoteExcerpts'
import { useJ2Note, setNoteFavorite, recordNoteOpened } from '../../hooks/useJ2Notes'
import useJ2NoteFolders from '../../hooks/useJ2NoteFolders'
import ConfirmModal from '../ConfirmModal'
import HeroImagePicker from './HeroImagePicker'
import NoteVideoHero, { getNoteVideoTime } from './NoteVideoHero'
import { NoteRailLeft, NoteRailRight, seekNoteVideo } from './NoteVideoRails'
import TranscriptPanel from '../../../../components/video/TranscriptPanel'
import { useDeskVideoByYoutube } from '../../../../hooks/useDeskVideoByYoutube'
import { useVideoInsights } from '../../../../hooks/useVideoInsights'
import linkifyTimestamps from '../../lib/linkifyTimestamps'
import UIcon from '../../../../components/ui/UIcon'
import usePreferences from '../../../../hooks/usePreferences'
import { useAuth } from '../../../../context/AuthContext'
import { exportNoteAsPng, printNote } from '../../lib/exportNote'
import { useDurableNote, SESSION_ID } from '../../lib/offline/useDurableNote'
import { usableBaseline, isUsableBaseline } from '../../lib/offline/baseline'
import { stampChartSettings } from '../../lib/widgetEmbedCore'
import WidgetPalette from './WidgetPalette'
import { sharedNoteUrl } from '../../lib/noteShareLink'
import AskPanel from './AskPanel'
import { PRECISE_STATES } from '../../lib/askCitation'
import NoteFindBar from './NoteFindBar'
import NoteHistoryPanel from './NoteHistoryPanel'
import NoteBacklinksSection from './NoteBacklinksSection'
import PropertiesSection from './PropertiesSection'
import ThesisSection from './ThesisSection'
import { createNoteViaApi } from '../../lib/noteCreation'
import { refreshEvidenceCandidates } from '../../hooks/useEvidenceCandidates'
import { invalidateNoteLinkTarget } from '../../lib/noteLinkTargetsBatch'
import { SkeletonLine } from '../../../../components/Skeleton'
import styles from './NoteEditorPage.module.css'

// A note can carry its source video in heroImageUrl (set by the Desk "Save
// notes to Journal Notebook" export). When it does, we render an embedded
// player + link in the hero slot instead of the image picker.
function parseYouTubeId(url) {
  if (typeof url !== 'string') return null
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/)
  return m ? m[1] : null
}

const AUTOSAVE_MS = 800
// Backoff schedule for transient (5xx / network) save failures.
// After the last entry, retries continue at the cap forever (or until the
// user edits / closes the tab). 4xx errors bypass retry entirely.
const RETRY_BACKOFFS_MS = [1000, 2000, 4000, 8000, 15000, 30000]

// P1-1 fix: `update()` (useJ2Notes.js) throws `new Error(body.detail ||
// \`${res.status}\`)` -- a REAL backend-authored detail when the API
// supplied one (preserve it verbatim; it's already meaningful, e.g. a
// validation message), or just a bare numeric HTTP status code string
// (e.g. "500") when it didn't -- which means nothing to a member and used
// to render as-is ("Save failed: 500"). This only ever replaces the bare
// code, never a real detail.
function friendlySaveError(e, status, { retrying = false } = {}) {
  const msg = e?.message
  if (msg && !/^\d{3}$/.test(msg)) return msg
  if (!status || status >= 500) {
    return retrying
      ? "Couldn't reach the server — your note is unchanged, retrying automatically."
      : "Couldn't reach the server. Your note is unchanged — please try again."
  }
  if (status === 404) return 'This note could not be found.'
  if (status === 403) return "You don't have permission to edit this note."
  return 'Could not save. Please try again.'
}

// Wave 0 (P1-10) local draft safety net: the network autosave is debounced
// 800ms behind the last keystroke, so a tab closed WHILE still typing (or
// mid-backoff, offline) can lose everything after the last successful PUT —
// a page refresh, a crashed tab, or the OS closing the browser never runs
// React's unmount cleanup. This mirrors the in-progress edit to
// localStorage on every keystroke (synchronous, local-only, no network),
// so reopening the SAME note can recover it. Cleared the moment a real
// network save actually lands — the local copy is a safety net, never a
// second source of truth for content the server already has.
const DRAFT_KEY = (noteId) => `uct.j2.notedraft.${noteId}`

// ⛔⛔ `setContent(body, false)` STOPPED SUPPRESSING `onUpdate` AT TIPTAP v3, AND
// SAID NOTHING. In v2 the second argument WAS `emitUpdate`; in v3 it is an
// options OBJECT, destructured as `{ emitUpdate = true, … } = {}`. A `false`
// there is not `undefined`, so the default does not apply to the argument — it
// applies to the missing PROPERTY, and `emitUpdate` comes out **true**. Every
// call site in this file carried a comment claiming the update was suppressed,
// and every one of them had been emitting into `scheduleAutosave` since the v3
// upgrade — turning three deliberate "put the canonical copy on screen" moments
// (note load, draft restore, conflict reconcile) into autosaves of content the
// server had just handed us. Measured against the installed TipTap, both ways:
// `setContent(x, false)` emits, `setContent(x, EMIT_NOTHING)` does not.
// ⛔ One authority, named, so a fifth call site cannot quietly get it wrong.
const EMIT_NOTHING = { emitUpdate: false }

// Toolbar Font dropdown — a broad set of common web-safe families (each option
// previews in its own face). Value is a full CSS font-family stack; '' clears.
const FONT_OPTIONS = [
  { label: 'Default', value: '' },
  { label: 'Sans Serif', value: 'Instrument Sans, Arial, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Monospace', value: 'Consolas, "Courier New", monospace' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", Helvetica, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Candara, sans-serif' },
  { label: 'Century Gothic', value: '"Century Gothic", sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Garamond', value: 'Garamond, serif' },
  { label: 'Palatino', value: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
  { label: 'Cambria', value: 'Cambria, Georgia, serif' },
  { label: 'Baskerville', value: 'Baskerville, "Baskerville Old Face", serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Lucida Sans', value: '"Lucida Sans Unicode", "Lucida Grande", sans-serif' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", "Comic Sans", cursive' },
  { label: 'Impact', value: 'Impact, Haettenschweiler, sans-serif' },
  { label: 'Brush Script MT', value: '"Brush Script MT", cursive' },
]
const FONT_SIZES = [12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32, 36, 40, 48, 60, 72]

// The capture inbox tray: hotkey captures banked during the session, offered
// for placement while writing. Renders nothing when the inbox is empty (the
// common case costs one lightweight GET). Insert lands the embed at the
// cursor; the row is CONSUMED only after the save that persists the embed
// succeeds (onPlaced → the page's commitSave) — deleting on insert lost the
// capture on both ends whenever that save failed (panel finding). ✕ arms a
// two-step confirm: the delete is unrecoverable and sat one misclick from
// Insert (the 8/10 builder-sweep defect class).
const _inboxFetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { captures: [] }))
// Age suffix for a capture chip ≥24h old — a stale capture inserted as
// "today's" is wrong evidence (its capturedAt is honest; the CHIP wasn't).
function _capAgeText(capturedAt) {
  const t = Date.parse(capturedAt || '')
  if (!Number.isFinite(t)) return null
  const days = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000))
  return days >= 1 ? `${days}d ago` : null
}
export function CaptureInboxTray({ editor, onPlaced }) {
  const { data, mutate } = useSWR('/api/j2/inbox', _inboxFetcher, {
    revalidateOnFocus: true, dedupingInterval: 15000,
  })
  // Rows placed this session but not yet consumed (their DELETE waits on the
  // next successful save) — a focus revalidation must not resurrect them.
  const placedIdsRef = useRef(new Set())
  const [confirmId, setConfirmId] = useState(null)
  useEffect(() => {
    if (confirmId == null) return undefined
    const t = setTimeout(() => setConfirmId(null), 2500)
    return () => clearTimeout(t)
  }, [confirmId])
  const captures = (data?.captures || []).filter((c) => !placedIdsRef.current.has(c.id))
  if (!editor || !captures.length) return null

  const place = (cap) => {
    // Insert AT THE CURSOR when the user has one, at the END otherwise —
    // with two guards (both review-found):
    // 1. Never insert into a NodeSelection (or the untouched initial
    //    selection): insertContent REPLACES a selected node — the tray
    //    silently ate the trailing embed (rail: widgetEmbedInsert.test.jsx).
    // 2. Only fall back to 'end' in those cases — an unconditional 'end'
    //    dumped the capture off-screen at the bottom of long notes while the
    //    button said "insert at cursor".
    const sel = editor.state.selection
    const useCursor = !sel.node && sel.from > 1
    const ok = editor.chain().focus(useCursor ? undefined : 'end')
      .insertWidgetEmbed(cap.widgetId, cap.params, {
        capturedAt: cap.capturedAt,
        fallback: cap.fallbackUrl ? { url: cap.fallbackUrl } : null,
        // Capture-time drawings from the row — an explicit array (even empty)
        // wins over buildWidgetEmbedAttrs' live-store re-seed, so the embed
        // shows what was on screen at CAPTURE, not at placement (review
        // finding). Legacy rows without the field keep the re-seed.
        ...(Array.isArray(cap.annotations) ? { annotations: cap.annotations } : {}),
        // Wave 1 (P1-1): a comment/trade link typed before banking to the
        // inbox must still be there once the capture is placed into a note.
        ...(cap.caption ? { caption: cap.caption } : {}),
        ...(cap.tradeRef ? { tradeRef: cap.tradeRef, tradeRefType: cap.tradeRefType } : {}),
      }).run()
    if (!ok) return
    placedIdsRef.current.add(cap.id)
    onPlaced?.(cap.id)
    // Hide locally now; the authoritative DELETE fires after the save lands.
    mutate({ captures: (data?.captures || []).filter((c) => c.id !== cap.id) }, false)
  }
  const discard = async (cap) => {
    if (confirmId !== cap.id) {
      setConfirmId(cap.id)
      return
    }
    setConfirmId(null)
    await fetch(`/api/j2/inbox/${cap.id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
    mutate()
  }

  return (
    <div data-export-exclude style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
      margin: '8px 0 4px', padding: '7px 10px', borderRadius: 8,
      border: '1px solid var(--border, #2a2a2a)', background: 'var(--panel, #101010)',
      fontSize: 12,
    }}>
      <span style={{ color: 'var(--ut-gold, #c9a84c)', fontWeight: 700 }}>
        Notebook inbox ({captures.length})
      </span>
      {captures.map((cap) => {
        const age = _capAgeText(cap.capturedAt)
        return (
          <span key={cap.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <button
              type="button"
              onClick={() => place(cap)}
              title={`Insert at cursor${cap.capturedAt ? ` — captured ${new Date(cap.capturedAt).toLocaleDateString()}` : ''}`}
              style={{
                background: 'none', border: '1px solid var(--border, #333)', borderRadius: 6,
                color: 'var(--text, #cfcfcf)', padding: '2px 8px', cursor: 'pointer', font: 'inherit',
              }}
            >
              {cap.searchText || cap.widgetId}
              {age && <span style={{ color: 'var(--text-dim, #777)', marginLeft: 5, fontSize: 11 }}>· {age}</span>}
            </button>
            <button
              type="button"
              onClick={() => discard(cap)}
              aria-label={confirmId === cap.id ? 'Confirm discard' : 'Discard capture'}
              style={confirmId === cap.id
                ? { background: 'none', border: '1px solid var(--ut-gold, #c9a84c)', borderRadius: 6, color: 'var(--ut-gold, #c9a84c)', padding: '2px 7px', cursor: 'pointer', font: 'inherit', fontSize: 11 }
                : { background: 'none', border: 'none', color: 'var(--text-dim, #777)', cursor: 'pointer', font: 'inherit' }}
            >
              {confirmId === cap.id ? 'Discard?' : '✕'}
            </button>
          </span>
        )
      })}
    </div>
  )
}

const _tradeLinksFetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { links: [] }))

// Wave 3 (Thesis-Trade Link): renders this note's linked trade/strategy as
// clickable chips. Resolution comes ENTIRELY from the server
// (GET /notes/{id}/trade-ref/resolve) -- this component never re-derives or
// guesses a destination. A link whose resolution.kind is "ambiguous_legacy"
// or "unresolved" renders as an inert chip (see note_trade_links.py) rather
// than navigating to a possibly-wrong object.
export function NoteLinkedTradeChips({ noteId }) {
  const navigate = useNavigate()
  const { data } = useSWR(
    noteId ? `/api/j2/notes/${noteId}/trade-ref/resolve` : null,
    _tradeLinksFetcher,
    { revalidateOnFocus: false, dedupingInterval: 15000 },
  )
  const links = data?.links || []
  if (!links.length) return null

  return (
    <>
      {links.map((link, i) => {
        const res = link.resolution || {}
        const key = `${link.tradeRef}:${link.tradeRefType}:${i}`
        if (res.kind === 'equity_trade' || res.kind === 'option_strategy') {
          const label = res.symbol ? `${res.symbol} · trade` : 'Linked trade'
          const goto = () => {
            if (res.kind === 'equity_trade') {
              navigate(`/journal-2-0/trade/${res.id}`)
            } else {
              navigate(`/journal?j2tab=journal&openTrade=${res.id}`)
            }
          }
          return (
            <button
              key={key}
              type="button"
              className={styles.linkedTradeChip}
              onClick={goto}
              title={res.kind === 'equity_trade' ? 'Open the linked equity trade' : 'Open the linked option strategy'}
            >
              <UIcon name="link" size={12} gold={false} />
              {label}
            </button>
          )
        }
        if (res.kind === 'position') {
          // Still open (never graduated to a closed trade -- see
          // note_trade_links.py's resolve_trade_ref) -- Open Positions is
          // the one always-reachable destination; TradeDetailPage doesn't
          // exist for a position that hasn't closed.
          const label = res.symbol ? `${res.symbol} · open position` : 'Linked position'
          return (
            <button
              key={key}
              type="button"
              className={styles.linkedTradeChip}
              onClick={() => navigate('/journal?j2tab=positions')}
              title="Open Positions — this position hasn't closed into a trade yet"
            >
              <UIcon name="link" size={12} gold={false} />
              {label}
            </button>
          )
        }
        if (res.kind === 'ambiguous_legacy') {
          return (
            <span
              key={key}
              className={styles.linkedTradeChipMuted}
              title="This note's linked trade reference predates typed references and matches more than one record -- it can't be safely resolved. The note and its stored reference are unaffected."
            >
              Linked trade — ambiguous
            </span>
          )
        }
        if (res.kind === 'unresolved') {
          return (
            <span
              key={key}
              className={styles.linkedTradeChipMuted}
              title="This note's linked trade could not be found (it may have been deleted)."
            >
              Linked trade — not found
            </span>
          )
        }
        return null
      })}
    </>
  )
}

export default function NoteEditorPage({ noteId, onBack, showBack = true, onTitleChange = null }) {
  const { note, isLoading, error: loadError, update, refresh } = useJ2Note(noteId)
  // Diagnostic only -- never surfaced to the member (see the !note render
  // branch below for why raw fetch-error text doesn't belong in that UI).
  useEffect(() => {
    if (loadError) console.warn('note load failed', loadError)
  }, [loadError])
  const { folders } = useJ2NoteFolders()
  const { user } = useAuth()
  const [saveStatus, setSaveStatus] = useState('saved')
  const [saveErrorMsg, setSaveErrorMsg] = useState('')
  // Wave Q1: the durable local working copy. ⛔ The account is part of the
  // DATABASE NAME, not a predicate — a wrong name yields no data, a forgotten
  // filter yields another member's research. It degrades to `supported: false`
  // (private windows, old browsers) without taking the editor with it.
  const durable = useDurableNote({ accountId: user?.id, noteId })
  // Read through a ref for the same reason every other callback here does:
  // TipTap's onUpdate and every scheduled timeout close over an old render.
  const durableRef = useRef(durable)
  durableRef.current = durable

  // Wave B Recents: fire the "opened" beacon once per real note view (not on
  // every render, not while it's still loading, not on a failed load). Keyed
  // on noteId so switching notes without unmounting (NotebookTab reuses this
  // component across selections) records each one.
  useEffect(() => {
    if (noteId && note) recordNoteOpened(noteId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, Boolean(note)])

  // Wave B Favorites: local + optimistic, reverted on a failed write (§47 —
  // "restore truthful state" on failure). Re-syncs from the server's own
  // value whenever a DIFFERENT note's data lands (note.isFavorite for the
  // note currently open), so switching notes never carries the previous
  // note's star state onto the new one.
  const [isFavorite, setIsFavorite] = useState(false)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  useEffect(() => {
    setIsFavorite(Boolean(note?.isFavorite))
  }, [noteId, note?.isFavorite])
  // Wave B: find-in-note. Scoped to this page's own keydown (a React
  // synthetic handler bubbling from anywhere inside .page below) rather
  // than a global window listener — the browser's native Ctrl/Cmd+F is
  // untouched everywhere else in the app, since this handler only exists
  // while a note is actually mounted.
  const [findOpen, setFindOpen] = useState(false)
  const onPageKeyDown = (e) => {
    const key = e.key.toLowerCase()
    if ((e.metaKey || e.ctrlKey) && key === 'f') {
      e.preventDefault()
      setFindOpen(true)
    } else if (key === 'escape' && findOpen) {
      // Only when the find bar's OWN input isn't already handling it (its
      // handler calls stopPropagation on Escape) -- this is the fallback
      // for Escape pressed while focus is elsewhere on the page.
      setFindOpen(false)
      editor?.commands.noteFindClear()
    }
  }

  const onToggleFavorite = async () => {
    if (favoriteBusy) return
    const next = !isFavorite
    setIsFavorite(next) // optimistic
    setFavoriteBusy(true)
    try {
      await setNoteFavorite(noteId, next)
    } catch {
      setIsFavorite(!next) // revert -- never diverge silently from the server
    } finally {
      setFavoriteBusy(false)
    }
  }

  // Wave C: version history / trust panel.
  const [historyOpen, setHistoryOpen] = useState(false)
  // Restore is NOT reachable through the normal "note loaded" effects below
  // (both are gated on `[note?.id]` only -- a restore keeps the same note
  // id, so they never re-fire). This mirrors exactly what those effects
  // already do on note-open, so a restore behaves identically to "reopening
  // the note with fresh content": pushes the restored body into the live
  // editor, resyncs the title/subtitle inputs, and -- critically -- advances
  // `lastSavedRef` so the very next autosave tick sees nothing changed
  // (the server already has this content) instead of racing a stale
  // baseUpdatedAt into a spurious 409, or re-PUTting content that's already
  // saved.
  const onVersionRestored = (restoredNote) => {
    if (!restoredNote) return
    const t = restoredNote.title || ''
    const s = restoredNote.subtitle || ''
    setTitle(t)
    titleRef.current = t
    setSubtitle(s)
    subtitleRef.current = s
    lastSavedRef.current = {
      title: t, subtitle: s,
      bodyJson: restoredNote.bodyJson,
      updatedAt: restoredNote.updatedAt || null,
    }
    try {
      editorRef.current?.commands.setContent(restoredNote.bodyJson || { type: 'doc', content: [] }, EMIT_NOTHING)
    } catch {
      /* editor view not mounted yet -- next note-open effect will still show it */
    }
  }

  // ── Export + share (post-v1 round 2) ──────────────────────────────────────
  const columnRef = useRef(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [chromeMsg, setChromeMsg] = useState(null)
  // Widget palette (point-and-click inserts) — toggled from the toolbar row.
  const [paletteOpen, setPaletteOpen] = useState(false)
  // The sticky chrome's MEASURED height, published as --uct-chrome-h on the
  // page root: the watch rails' sticky offset reads it (a literal there goes
  // stale the moment the header wraps — review finding).
  const chromeRef = useRef(null)
  const pageRef = useRef(null)
  useEffect(() => {
    const chrome = chromeRef.current
    const page = pageRef.current
    if (!chrome || !page || typeof ResizeObserver === 'undefined') return undefined
    const set = () => page.style.setProperty('--uct-chrome-h', `${chrome.offsetHeight}px`)
    const ro = new ResizeObserver(set)
    ro.observe(chrome)
    set()
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (!chromeMsg) return undefined
    const t = setTimeout(() => setChromeMsg(null), 2400)
    return () => clearTimeout(t)
  }, [chromeMsg])
  const savePng = async () => {
    if (exportBusy) return
    setExportBusy(true)
    setChromeMsg('rendering…')
    try {
      const ok = await exportNoteAsPng(columnRef.current, title)
      setChromeMsg(ok ? 'PNG saved' : 'export failed')
    } catch {
      setChromeMsg('export failed')
    } finally {
      setExportBusy(false)
    }
  }
  // Wave C: portable single-note export (directive §46-58) -- unlike PNG/
  // Print above, this is a round-trippable .md/.zip a member can bring to
  // another app, matching the full-notebook export's own format
  // (build_single_note_export reuses that exact markdown+front-matter code
  // path). A bare fetch+blob download, not the ExportDialog machinery: one
  // note is bounded in size, so there's no multi-minute wait to progress-bar.
  const downloadMarkdown = async () => {
    if (exportBusy) return
    setExportBusy(true)
    setChromeMsg('preparing…')
    try {
      const res = await fetch(`/api/j2/notes/${noteId}/export`, { credentials: 'include' })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') || ''
      const m = /filename="([^"]+)"/.exec(cd)
      const filename = m ? m[1] : 'note.md'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setChromeMsg('downloaded')
    } catch {
      setChromeMsg('export failed')
    } finally {
      setExportBusy(false)
    }
  }
  // Share links: admin-only surface while the owner evaluates (the server
  // pair is additionally flag-gated). One active token per note; Unshare
  // revokes it — a leaked link dies instantly.
  const isAdmin = user?.role === 'admin'
  const [share, setShare] = useState(null)
  useEffect(() => {
    if (!isAdmin || !noteId) return undefined
    let alive = true
    fetch(`/api/j2/notes/${noteId}/share`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { share: null }))
      .then((b) => { if (alive) setShare(b.share) })
      .catch(() => {})
    return () => { alive = false }
  }, [isAdmin, noteId])
  const copyShareLink = async () => {
    try {
      let s = share
      if (!s) {
        const res = await fetch(`/api/j2/notes/${noteId}/share`, { method: 'POST', credentials: 'include' })
        if (!res.ok) throw new Error(String(res.status))
        s = (await res.json()).share
        setShare(s)
      }
      await navigator.clipboard.writeText(sharedNoteUrl(s.token))
      setChromeMsg('Share link copied')
    } catch {
      setChromeMsg('share failed')
    }
  }
  const unshare = async () => {
    await fetch(`/api/j2/notes/${noteId}/share`, { method: 'DELETE', credentials: 'include' }).catch(() => {})
    setShare(null)
    setChromeMsg('Link revoked')
  }
  const saveTimerRef = useRef(null)
  const retryTimerRef = useRef(null)
  const retryAttemptsRef = useRef(0)
  const fileInputRef = useRef(null)
  const attachFileInputRef = useRef(null)
  const lastSavedRef = useRef({ title: '', subtitle: '', bodyJson: null, updatedAt: null })
  // One reconcile-and-retry per conflict burst (A15 compare-and-set): a 409
  // means a server-side write (Send-to-Journal append, second tab) landed
  // after our baseline. We merge the missing embeds in and retry ONCE — a
  // second consecutive 409 surfaces as a save error instead of looping.
  const conflictRetriedRef = useRef(false)
  // Inbox rows placed into the doc this session, consumed only AFTER the
  // save that persists them succeeds — a failed save must leave the capture
  // recoverable in the inbox (panel finding; the tray hides them locally).
  const pendingInboxConsumeRef = useRef(new Set())
  const consumePlacedCaptures = () => {
    const ids = [...pendingInboxConsumeRef.current]
    if (!ids.length) return
    pendingInboxConsumeRef.current.clear()
    Promise.all(ids.map((id) =>
      fetch(`/api/j2/inbox/${id}`, { method: 'DELETE', credentials: 'include' }).catch(() => {}),
    )).then(() => globalMutate('/api/j2/inbox')).catch(() => {})
  }
  // Latest-callback refs. TipTap's useEditor freezes the `onUpdate` closure
  // at editor-creation time and React's setTimeout fires whichever closure
  // was scheduled — both routes capture stale `title`/`subtitle`. Reading
  // through these refs guarantees every save runs with the latest values
  // (the refs are updated after every render below).
  const scheduleAutosaveRef = useRef(() => {})
  const commitSaveRef = useRef(async () => {})

  // Local mirrors for fields the user edits inline.
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  // Wave 0 (P1-10): mirrored synchronously in the onChange handlers below
  // (never via a `useEffect` on `title`/`subtitle`) so the local-draft write
  // always sees the value from THIS event, not a stale one from before
  // React's setState batching commits — the same staleness `scheduleAutosave`
  // solves for the network path via the ref-reassignment pattern, one layer
  // earlier (a draft written from stale state would recover the SECOND-to-
  // last keystroke, not the last one).
  const titleRef = useRef('')
  const subtitleRef = useRef('')
  // A locally-drafted, never-successfully-saved version of THIS note,
  // detected on load — offered via the banner below, never auto-applied
  // (silently preferring a local draft over the server's copy could just as
  // easily clobber real, already-synced work from another tab/device).
  const [pendingDraft, setPendingDraft] = useState(null)
  // The reasoning behind `pendingDraft` — which copy won, and whether the two
  // local copies could be ordered at all. ⛔ An ambiguous answer is SAID so,
  // not smoothed over: the member is the only one who can settle it.
  const [recovery, setRecovery] = useState(null)
  // Re-entrancy guard for restoreDraft (see its own comment) — a plain ref,
  // not state, since it must be checked synchronously before any render.
  const restoringDraftRef = useRef(false)
  // ⛔⛔ NOTHING MAY BE PERSISTED BEFORE THE NOTE IS IN THE EDITOR.
  //
  // TipTap's `onUpdate` is NOT "the member typed" — it is "the document
  // changed", and a document changes without a member the moment an editor is
  // constructed with an EMPTY doc: `{type:'doc',content:[]}` violates the
  // schema's `block+`, so ProseMirror appends a repair transaction that inserts
  // an empty paragraph, synchronously, inside `new Editor(...)`. Measured, both
  // directions: an editor built with real content emits ZERO updates; one built
  // empty emits exactly one, and `getJSON()` is then `{doc,[paragraph]}`.
  //
  // `useEditor` is keyed on `[note?.id]`, so the editor is REBUILT when the note
  // arrives — and rebuilt EMPTY whenever the server's copy of that note is empty
  // (the server sends `{doc,content:[]}`, not null, for a blank body). That
  // rebuild happens in `useEditor`'s own effect, which is registered BEFORE the
  // effect below and therefore runs BEFORE it — so the repair fires while the
  // title/subtitle refs still hold their pre-load values, and the autosave path
  // ran with them. Reproduced end to end in `NoteEditorPage.slowload.test.jsx`:
  // an empty title, an empty subtitle and an empty document written to the
  // localStorage draft, the durable working copy AND the outbox, for a note the
  // member never touched.
  //
  // ⛔ This is a GATE, not a nicety: it is the one place that can distinguish
  // "the document changed because a person changed it" from "the document
  // changed because it was constructed". It also closes the long-standing
  // empty-localStorage-draft bug this predates Wave Q1.
  const hydratedRef = useRef(false)

  useEffect(() => {
    if (!note) return undefined
    setTitle(note.title || '')
    titleRef.current = note.title || ''
    setSubtitle(note.subtitle || '')
    subtitleRef.current = note.subtitle || ''
    lastSavedRef.current = {
      title: note.title || '',
      subtitle: note.subtitle || '',
      bodyJson: note.bodyJson,
      updatedAt: note.updatedAt || null,
    }

    // Wave 0 (P1-10) offered a draft this note's own last session never
    // successfully saved. Wave Q1 makes that a THREE-way decision — the
    // server, the durable working copy, and the synchronous draft — owned by
    // `chooseLocalRecovery`.
    //
    // ⛔ IT IS NOT "PREFER THE OFFLINE STORE". Within a session the draft is
    // written synchronously on the keystroke and the durable copy lags it by
    // the coalescing window, so reaching for IndexedDB because it is the
    // offline store would silently regress the member's last ~200ms of typing.
    // ⛔ And it is still OFFERED, never applied: silently preferring a local
    // copy can clobber real work another device already synced.
    let cancelled = false
    const decide = async () => {
      let raw = null
      let lsDraft = null
      try {
        raw = localStorage.getItem(DRAFT_KEY(note.id))
        lsDraft = raw ? JSON.parse(raw) : null
      } catch { lsDraft = null }
      let decision
      try {
        decision = await durableRef.current.recover({ server: note, lsDraft })
      } catch {
        // A store we cannot read is not a reason to lose the draft we can.
        decision = null
      }
      if (cancelled) return
      if (decision && decision.unsynced) {
        setPendingDraft({ ...decision.state, savedAt: lsDraft?.savedAt ?? null })
        setRecovery(decision)
        return
      }
      // Nothing local differs from the server: it saved fine (or was never
      // touched) and surfacing it is pure noise.
      if (raw) { try { localStorage.removeItem(DRAFT_KEY(note.id)) } catch { /* private mode */ } }
      setPendingDraft(null)
      setRecovery(null)
    }
    decide()
    return () => { cancelled = true }
  }, [note?.id])

  // Wave Q1: ONE snapshot per keystroke, shared by both local layers.
  // ⛔ Taken once on purpose: `getJSON()` walks the whole document, and the
  // draft and the durable copy must describe the SAME instant — two reads
  // could differ by a keystroke, which is exactly the disagreement the reopen
  // comparison would then have to resolve without being able to.
  const captureLocalState = () => {
    if (!noteId || !editorRef.current) return null
    return {
      title: titleRef.current,
      subtitle: subtitleRef.current,
      bodyJson: editorRef.current.getJSON(),
      baseUpdatedAt: lastSavedRef.current.updatedAt || null,
    }
  }
  const saveDraftLocally = (state) => {
    const snap = state || captureLocalState()
    if (!snap) return
    try {
      localStorage.setItem(DRAFT_KEY(noteId), JSON.stringify({
        title: snap.title, subtitle: snap.subtitle,
        bodyJson: snap.bodyJson, savedAt: Date.now(),
        // Wave Q1: which tab-session wrote it. On reopen that separates "the
        // durable copy from THIS session" (where the draft is written first and
        // can only be equal-or-newer — an exact structural answer) from one
        // left by a previous session (where only timestamps remain, and they
        // are a hint).
        // ⛔ Deliberately NO generation: that number is minted by the durable
        // writer, and taking it here would mean scheduling the durable write
        // BEFORE this synchronous line — reversing the one ordering that owns
        // the crash window.
        sessionId: SESSION_ID,
      }))
    } catch { /* private mode / storage full — the network autosave is still the primary path */ }
  }
  const clearDraftLocally = () => {
    try { localStorage.removeItem(DRAFT_KEY(noteId)) } catch { /* private mode */ }
  }

  const restoreDraft = async () => {
    // Re-entrancy guard: found via real browser E2E that a single click can
    // fire this handler twice in quick succession (both invocations reading
    // the SAME still-non-null `pendingDraft` before React commits the first
    // call's `setPendingDraft(null)`) — two concurrent PUTs to the same note
    // racing over the network, with the loser's stale patch sometimes
    // landing last. A restore is a deliberate, one-shot action; the second
    // invocation is never useful, so it's dropped outright rather than
    // trusting click de-duplication anywhere upstream.
    if (restoringDraftRef.current) return
    if (!pendingDraft || !editorRef.current) return
    restoringDraftRef.current = true
    const draftTitle = pendingDraft.title || ''
    const draftSubtitle = pendingDraft.subtitle || ''
    const draftBodyJson = pendingDraft.bodyJson
    setTitle(draftTitle)
    titleRef.current = draftTitle
    setSubtitle(draftSubtitle)
    subtitleRef.current = draftSubtitle
    // ⛔ `EMIT_NOTHING`, never a bare `false` — see its declaration. Until this
    // was fixed, this line ALSO re-armed the 800ms debounce and the durable
    // write, which is precisely what the comment below says a restore
    // deliberately does not do.
    if (draftBodyJson) editorRef.current.commands.setContent(draftBodyJson, EMIT_NOTHING)
    setPendingDraft(null)
    setRecovery(null)

    // Persist directly and immediately, from the local `draft*` values
    // captured above — NOT via the debounced scheduleAutosave path (a
    // setTimeout deref'd 800ms later through whichever render's `commitSave`
    // closure happens to be current then). A restore is a rare, deliberate
    // action, not a per-keystroke autosave — it doesn't need debouncing, and
    // going straight to the network keeps this one-shot action off that
    // shared, timing-sensitive machinery entirely.
    setSaveStatus('saving')
    try {
      const patch = { title: draftTitle, subtitle: draftSubtitle || null }
      if (draftBodyJson) patch.bodyJson = draftBodyJson
      // ⛔ The baseline is the revision this local work was WRITTEN ON, not
      // whatever the server holds now. They differ exactly when another device
      // saved in between — and that is the case where a restore must 409 and
      // fork rather than quietly overwrite the newer copy.
      const base = usableBaseline(recovery?.baseUpdatedAt, lastSavedRef.current.updatedAt)
      if (base) patch.baseUpdatedAt = base
      const saved = await update(patch)
      lastSavedRef.current = {
        title: draftTitle, subtitle: draftSubtitle,
        bodyJson: draftBodyJson || lastSavedRef.current.bodyJson,
        updatedAt: usableBaseline(saved?.updatedAt, lastSavedRef.current.updatedAt),
      }
      durableRef.current.markSynced({
        acked: { title: draftTitle, subtitle: draftSubtitle, bodyJson: draftBodyJson },
        current: captureLocalState() || { title: draftTitle, subtitle: draftSubtitle, bodyJson: draftBodyJson },
        updatedAt: lastSavedRef.current.updatedAt,
      })
      setSaveStatus('saved')
      setSaveErrorMsg('')
      clearDraftLocally()
    } catch (e) {
      setSaveStatus('error')
      setSaveErrorMsg(friendlySaveError(e, e?.status))
    } finally {
      restoringDraftRef.current = false
    }
  }
  const discardDraft = () => {
    clearDraftLocally()
    // ⛔ And the durable copy has to hear about it too. Clearing only the
    // localStorage draft would leave a dirty working copy and a queued sync
    // intent behind, and the next reconnect would push work the member just
    // declined. This states the truth instead: what is on this device now is
    // what the server has.
    const server = {
      title: note?.title || '',
      subtitle: note?.subtitle || '',
      bodyJson: note?.bodyJson ?? null,
    }
    durableRef.current.markSynced({ acked: server, current: server, updatedAt: note?.updatedAt || null })
    setPendingDraft(null)
    setRecovery(null)
  }

  const scheduleAutosave = () => {
    // ⛔ See `hydratedRef`. Before the note is in the editor there is nothing of
    // the member's to save, and everything to lose — so this refuses BEFORE it
    // touches the status, the draft, the durable copy or the save timer.
    if (!hydratedRef.current) return
    setSaveStatus('dirty')
    setSaveErrorMsg('')
    // Wave 0 (P1-10): mirror to localStorage on EVERY edit, synchronously —
    // not on the 800ms debounce below. A tab closed mid-keystroke (before
    // the debounce ever fires) must still have a local copy of what was
    // just typed; gating this on the same timer would leave exactly that
    // window unprotected, which is the gap this safety net exists to close.
    const snapshot = captureLocalState()
    saveDraftLocally(snapshot)
    // Wave Q1: then — and only then — hand the SAME snapshot to the durable
    // working copy, which coalesces it into an IndexedDB write ~200ms behind
    // the last keystroke. ⛔ Second, never first: localStorage is the
    // synchronous layer that owns the crash window, and IndexedDB's measured
    // p95 (800.7ms in Chrome 152) is as long as the whole server autosave
    // debounce. It is also NOT the network — a durable local write is not a
    // save, and nothing here tells the member otherwise.
    if (snapshot) durableRef.current.schedule(snapshot)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    // Fresh user edit supersedes any in-flight retry — reset the backoff
    // counter so we don't waste a 30s wait on content the user just changed.
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    retryAttemptsRef.current = 0
    conflictRetriedRef.current = false // fresh edit = fresh conflict budget
    saveTimerRef.current = setTimeout(() => commitSaveRef.current(), AUTOSAVE_MS)
  }

  // The editor is read through a ref, NOT the `editor` const: handlePaste /
  // handleDrop are captured in editorProps at editor-CREATION time, when the
  // `editor` const is still null — so closing over it directly made paste throw
  // "Cannot read properties of null (reading 'chain')". The ref is always fresh.
  const editorRef = useRef(null)
  // Wave I: a single toast for both image and file-attachment upload
  // failures — an alert() blocks the whole tab for the multi-second span a
  // PDF upload can take, which is a worse experience than the image case
  // this was copied from.
  const [uploadToast, setUploadToast] = useState(null)
  // Wave I: { href, name } of the PDF currently open in the preview Sheet, or
  // null. Wave J extends it with `documentId` (needed to save an excerpt
  // against) and `page`/`emphasizeExcerptId` (click-to-source targeting --
  // the preview may open at an arbitrary document NOT attached to the
  // currently-open note, e.g. from a thesis-evidence row referencing an
  // excerpt captured in a different note).
  const [previewDoc, setPreviewDoc] = useState(null)
  // Wave N §9 — a captured web passage is revisited AS a captured passage,
  // never as a document. See CapturedSourceSheet for what that means.
  const [capturedSource, setCapturedSource] = useState(null)
  const { documents: noteDocuments, refresh: refreshDocuments } = useNoteDocuments(noteId)
  const { excerpts: noteExcerpts, refresh: refreshExcerpts } = useNoteExcerpts(noteId)

  // ⭐ WAVE M — SEARCH LANDS ON THE OBJECT IT NAMED. A search hit that reads
  // "NVDA 10-Q · p.47" carries `?doc=&page=` alongside `?note=`, and this opens
  // the SAME `previewDoc` shape Wave J's click-to-source above already uses —
  // one document-navigation contract, reached from either door.
  //
  // ⛔ It waits for `noteDocuments`: the target names a document id, and the
  // preview needs that document's href. Firing before the list resolves would
  // silently drop the deep link and look exactly like "search only opens the
  // note", which is the defect this closes.
  //
  // ⛔ AND IT CLEARS THE PARAMS ONCE CONSUMED, so a refresh, a Back, or simply
  // closing the sheet does not reopen it — the same once-only discipline the
  // mobile share handoff needed.
  const [searchParams, setSearchParams] = useSearchParams()
  const navTarget = targetFromParams(searchParams)
  const navTargetKey = navTarget
    ? `${navTarget.documentId}:${navTarget.page || ''}:${navTarget.excerptId || ''}`
    : null
  const consumedTargetRef = useRef(null)
  useEffect(() => {
    if (!navTarget || !noteDocuments?.length) return
    if (consumedTargetRef.current === navTargetKey) return
    const doc = noteDocuments.find((d) => d.id === navTarget.documentId)
    if (!doc) return
    consumedTargetRef.current = navTargetKey
    const localExcerpt = navTarget.excerptId
      ? noteExcerpts.find((e) => e.id === navTarget.excerptId) || null
      : null
    setPreviewDoc({
      href: doc.attachmentUrl, name: doc.name, documentId: doc.id,
      page: navTarget.page || undefined,
      emphasizeExcerptId: navTarget.excerptId || undefined,
      emphasizeExcerpt: localExcerpt,
    })
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const k of ['doc', 'page', 'excerpt']) next.delete(k)
      return next
    }, { replace: true })
  }, [navTargetKey, navTarget, noteDocuments, noteExcerpts, setSearchParams])

  // ⭐ O6 §4: the same routing contract, one param further. A review is NOT a
  // document, so it deliberately does not go through `targetFromParams` /
  // `previewDoc` above — that path opens a viewer, and a viewer handed a
  // review would have nothing to render. The anchor is passed down to the
  // review panel, which owns the only place a review can truthfully be shown.
  const reviewAnchor = reviewTargetFromParams(searchParams)
  const clearReviewParam = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('review')
      return next
    }, { replace: true })
  }, [setSearchParams])
  const handleImageInsert = async (file) => {
    const ed = editorRef.current
    if (!ed || !file) return
    try {
      const { url } = await uploadInlineImage(noteId, file)
      ed.chain().focus().setImage({ src: url, alt: '' }).run()
    } catch (e) {
      setUploadToast({ message: `Couldn't upload ${file.name || 'image'}. Your note is unchanged.`, tone: 'error' })
    }
  }
  // Wave I: the non-image counterpart — the backend endpoint
  // (POST /notes/{id}/attachments) has existed since before this wave; this
  // is its first live-editor caller. Inserts a real AttachmentChip node
  // (already used by every import adapter), never a bare markdown link.
  const handleAttachmentInsert = async (file) => {
    const ed = editorRef.current
    if (!ed || !file) return
    try {
      const { url, name, size } = await uploadNoteAttachment(noteId, file)
      ed.chain().focus().insertContent({
        type: 'attachmentChip', attrs: { href: url, name, size },
      }).run()
      // Wave J, found live in the browser: a PDF uploaded HERE creates its
      // j2_note_documents row server-side, but `useNoteDocuments` was fetched
      // at note-open and never revalidates on its own -- so the brand-new
      // document's id was unresolvable, previewDoc.documentId came back null,
      // and "Save excerpt" on the PDF a member had JUST attached silently did
      // nothing until a full page reload. Refresh the list so the id exists
      // the moment the chip does.
      refreshDocuments()
    } catch (e) {
      // ⚰️ WAVE P POST-CLOSURE — THE SERVER'S REASON WAS BEING THROWN AWAY.
      // `uploadNoteAttachment` already preserves it (`body.detail`), and the
      // server already says something a member can act on: "File is larger
      // than the 25 MB limit…". This catch replaced it with "Couldn't upload",
      // so someone attaching a 30 MB scan could not tell whether to split the
      // file, retry, or report a bug — and with OCR now live, the natural
      // (wrong) guess is that the SCAN failed rather than the upload.
      //
      // ⛔ AND IT GOES THROUGH `friendlySaveError`, NOT THROUGH `e.message`.
      // The first attempt built the sentence from the exception and
      // `rawErrorSurface.test.js` caught it — correctly: a bare "500" or a
      // "Failed to fetch" is not member-facing copy. That mapper already
      // returns the server-authored detail when there is one and a real
      // sentence when there is not, so this reuses the product's ONE
      // error-to-copy authority instead of adding a second.
      // ⛔ The mapping happens FIRST, on its own line. The rail is
      // ancestor-based: `e` anywhere beneath a template literal or a `+` is a
      // violation even when it is only being handed to a function — which is
      // the right conservatism, because "it is only passed to a helper" is
      // exactly what the next unsafe version would also claim.
      const why = friendlySaveError(e, e?.status)
      setUploadToast({
        message: `Couldn't upload ${file.name || 'file'} — ${why}`,
        tone: 'error',
      })
    }
  }

  // Wave I: a PDF AttachmentChip opens the in-context preview Sheet instead
  // of downloading. A CAPTURE-phase React handler on the editor's own
  // wrapper, not TipTap's `handleClickOn` — AttachmentChip.renderHTML()
  // emits a real `download="..."` attribute on the <a> (pre-existing,
  // relied on by every import adapter for the "just download it" case), and
  // a native `<a download>` click is handled by the browser ahead of
  // ProseMirror's own synthetic click routing, so `handleClickOn` never
  // fired. Capture phase + preventDefault() here runs before that native
  // download activates.
  const handleEditorClickCapture = (event) => {
    // Wave J: a documentExcerpt card's citation button (see ExcerptView.jsx)
    // -- click-to-source, the directive's own highest-value exit gate.
    // Reuses this same capture-phase bridge Wave I established for the
    // attachmentChip case, rather than a second click-handling mechanism.
    const citation = event.target.closest?.('button[data-type="documentExcerptCitation"]')
    if (citation) {
      const documentId = citation.getAttribute('data-document-id')
      const page = Number(citation.getAttribute('data-page'))
      const excerptId = citation.getAttribute('data-excerpt-id')
      const doc = noteDocuments.find((d) => d.id === documentId)
      const localExcerpt = noteExcerpts.find((e) => e.id === excerptId)
      if (doc) {
        setPreviewDoc({
          href: doc.attachmentUrl, name: doc.name, documentId, page,
          emphasizeExcerptId: excerptId, emphasizeExcerpt: localExcerpt || null,
        })
      } else if (localExcerpt?.attachmentUrl) {
        // The excerpt's own document isn't one of THIS note's attachments
        // (an excerpt saved from elsewhere but inserted here) -- the
        // excerpt row itself already carries everything needed.
        setPreviewDoc({
          href: localExcerpt.attachmentUrl, name: localExcerpt.documentName,
          documentId, page, emphasizeExcerptId: excerptId, emphasizeExcerpt: localExcerpt,
        })
      }
      return
    }

    // Wave I: a PDF AttachmentChip opens the in-context preview Sheet instead
    // of downloading. AttachmentChip.renderHTML() emits a real
    // `download="..."` attribute on the <a> (pre-existing, relied on by
    // every import adapter for the "just download it" case), and a native
    // `<a download>` click is handled by the browser ahead of ProseMirror's
    // own synthetic click routing, so `handleClickOn` never fired. Capture
    // phase + preventDefault() here runs before that native download
    // activates.
    const chip = event.target.closest?.('a[data-type="attachmentChip"]')
    if (!chip) return
    const href = chip.getAttribute('href')
    const name = chip.getAttribute('data-name')
    if (!/\.pdf$/i.test(name || '') && !/\.pdf$/i.test(href || '')) return
    event.preventDefault()
    // Wave J: resolve this attachment's documentId (needed to save an
    // excerpt against it) from the note's own already-fetched document
    // list -- the chip's own attrs never carried an id (attachments have
    // none of their own, per Wave I's filesystem-path identity model).
    const doc = noteDocuments.find((d) => d.attachmentUrl === href)
    setPreviewDoc({ href, name, documentId: doc?.id || null })
  }

  // Wave J: create the excerpt AND insert its node, in that order -- the
  // combined backend endpoint already does both atomically, so this is
  // just the client-side mirror (insert the returned excerptId) plus the
  // upload-failure toast idiom every other capture path in this file uses.
  /**
   * Land on a cited passage -- or honestly decline to.
   *
   * The panel has already re-read the text at the destination in the LIVE
   * doc (unsaved edits included). A state outside PRECISE_STATES means the
   * passage moved, was duplicated, or is gone.
   *
   * NEVER JUMP TO AN UNVERIFIED POSITION. A failed precise citation is
   * preferable to a confident mis-navigation: landing on the wrong paragraph
   * looks exactly like landing on the right one.
   */
  const jumpToCitation = useCallback((source, resolved) => {
    // ⭐ O6 §4: a cited REVIEW is not a passage in the note body — it lives
    // in the review panel's history, and it may belong to a different note
    // entirely (Ask My Notebook and Ask Security Research both span theses).
    // So it routes through the SAME `?note=` contract Search uses rather than
    // through the editor, and lands on the review itself.
    // ⛔ A citation that cannot name both the note and the review navigates
    // NOWHERE, rather than opening a note and leaving the member to hunt.
    if (source?.navigation?.kind === 'review') {
      const nid = source.navigation.note_id
      const rid = source.navigation.review_id
      if (!nid || !rid) return
      setSearchParams(
        (prev) => applyTargetToParams(prev, { noteId: nid, reviewId: rid, depth: 'review' }),
        { replace: false },
      )
      return
    }
    // ⚰️ WAVE P3 §12 — A CITED DOCUMENT PAGE USED TO GO NOWHERE. This handler
    // knew about reviews and about the note body, and returned silently for
    // `kind: 'document'` — so Ask could say "q3-filing.pdf · p.1", the member
    // could click it, and nothing at all would happen. Search has reached the
    // page since Wave M; the Ask citation never learned the same contract.
    // Found by driving the real UI, because every unit rail below asserts the
    // TARGET and none of them clicks the row in the editor.
    //
    // ⛔ THE SAME `?note=&doc=&page=` CONTRACT, never a second route shape —
    // and never an OCR-specific one: a scanned page opens exactly the way a
    // native page does, which is what makes the scanned page authoritative.
    if (source?.navigation?.kind === 'document') {
      // The decision lives in `searchNavigation`, beside the one Search uses,
      // so the two can never answer differently about the same document.
      const target = citationTarget(source, { fallbackNoteId: noteId })
      if (!target) return
      setSearchParams((prev) => applyTargetToParams(prev, target),
                      { replace: false })
      return
    }
    const ed = editorRef.current
    if (!ed || source?.navigation?.kind !== 'note') return
    if (!resolved || !PRECISE_STATES.has(resolved.state)) return
    ed.chain().focus()
      .setTextSelection({ from: resolved.from, to: resolved.to })
      .scrollIntoView()
      .run()
  }, [setSearchParams, noteId])

  const handleSaveExcerpt = async ({ pageNumber, capturedText, quotePrefix, quoteSuffix, charStart, charEnd }) => {
    const ed = editorRef.current
    if (!ed) return
    try {
      // Wave J, found live: previewDoc.documentId is resolved from a list
      // fetched at note-open, so ANY document created after that (the common
      // case: attach a PDF, then immediately excerpt it) resolved to null and
      // this handler returned silently. Re-resolve from the server at save
      // time rather than trusting the snapshot -- this closes the whole race
      // class, not just the upload one. A failure past this point surfaces
      // the toast below; it must never be silent again.
      let documentId = previewDoc?.documentId
      if (!documentId && previewDoc?.href) {
        const fresh = await fetch(`/api/j2/notes/${noteId}/documents`, { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : { documents: [] }))
        documentId = fresh.documents?.find((d) => d.attachmentUrl === previewDoc.href)?.id || null
        // Carry the resolution back onto the open preview, or the highlight
        // overlay (previewExcerpts, keyed on previewDoc.documentId) stays
        // empty and the excerpt a member just saved renders no mark on the
        // page it came from until they reopen the document.
        if (documentId) setPreviewDoc((p) => (p && p.href === previewDoc.href ? { ...p, documentId } : p))
      }
      if (!documentId) throw new Error('document not resolvable')
      const res = await fetch(`/api/j2/notes/${noteId}/excerpts`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId, pageNumber, capturedText,
          quotePrefix, quoteSuffix, charStart, charEnd,
        }),
      })
      if (!res.ok) throw new Error('save failed')
      const { excerpt } = await res.json()
      // ⛔ insertContentAt(selection.to), NOT insertContent -- found live in
      // the browser, and it DESTROYED the member's attachment. Clicking a PDF
      // chip to open the preview leaves ProseMirror holding a NodeSelection
      // on that chip (it renders with .ProseMirror-selectednode), and
      // insertContent REPLACES the selection: saving the first excerpt from
      // a document silently deleted the chip that document was attached by.
      // Verified against the persisted body afterwards -- the attachmentChip
      // node was simply gone, leaving [documentExcerpt, paragraph].
      // Inserting AT the selection's end preserves a selected node and is
      // identical to the old behaviour for an ordinary caret.
      //
      // Same hazard CaptureInboxTray.place() guards above (see its comment).
      // It resolves differently — falling back to 'end' — because a banked
      // capture has no anchor in the note; an excerpt does: the chip the
      // member just clicked. Landing it right after that chip is the point,
      // and 'end' would be the "dumped off-screen" failure that comment's
      // own second guard exists to prevent.
      ed.chain().focus().insertContentAt(ed.state.selection.to, {
        type: 'documentExcerpt', attrs: { excerptId: excerpt.id },
      }).run()
      await refreshExcerpts()
      // ⛔ WAVE P5 — and the EVIDENCE PICKER's list, which is a different
      // subscription. Without this the passage a member just saved is
      // absent from Add evidence until they reload the note; the picker
      // then tells them to "save an excerpt from a PDF in this note
      // first", about the excerpt they are looking at. Measured on a
      // phone, end to end, in one sitting.
      refreshEvidenceCandidates(noteId)
    } catch (e) {
      setUploadToast({ message: "Couldn't save that excerpt. Your note is unchanged.", tone: 'error' })
    }
  }

  // Wave J: opens the preview Sheet for a document_excerpt evidence row in
  // ThesisSection -- the excerpt may belong to a DIFFERENT note than the
  // one open here, so it's resolved via GET /excerpts/{id} (carries the
  // source document's attachmentUrl directly, no second lookup) rather
  // than assuming it's among this note's own documents/excerpts.
  const handleOpenExcerptSource = async (excerptId) => {
    try {
      const res = await fetch(`/api/j2/excerpts/${excerptId}`, { credentials: 'include' })
      if (!res.ok) return
      const { excerpt } = await res.json()
      if (!excerpt?.attachmentUrl) return
      // ⛔⛔ WAVE N §9. `attachmentUrl` alone does NOT mean "there is a document
      // to open": a captured web source carries `web:<sha256>`, an IDENTITY
      // string, not a file. This used to hand that straight to
      // DocumentPreviewSheet, so revisiting a captured Reuters paragraph opened
      // a FULLSCREEN PDF VIEWER over a non-URL, with "Open in new tab" and
      // "Download" controls that could not work — a fake document viewer, which
      // §9 forbids by name.
      // ⭐ THE DECISION ALREADY EXISTS AND SEARCH ALREADY OBEYS IT. Wave M's
      // depth rule answers 'note' for a web capture ("there is no viewer to
      // scroll"); `excerptRevisitTarget` is that same rule for one excerpt, so
      // these two surfaces cannot disagree about one object.
      const target = excerptRevisitTarget(excerpt)
      if (!target) return
      if (target.kind === 'captured_source') {
        // The deepest TRUTHFUL destination: the passage itself and where it
        // came from. We hold one paragraph; only the publisher has the rest.
        setCapturedSource(excerpt)
        return
      }
      setPreviewDoc({ ...target, emphasizeExcerpt: excerpt })
    } catch (e) { /* noop -- opening evidence is best-effort, never blocks the thesis view */ }
  }

  const previewExcerpts = useMemo(() => {
    if (!previewDoc?.documentId) return []
    const fromNote = noteExcerpts.filter((e) => e.documentId === previewDoc.documentId)
    if (previewDoc.emphasizeExcerpt && !fromNote.some((e) => e.id === previewDoc.emphasizeExcerpt.id)) {
      return [...fromNote, previewDoc.emphasizeExcerpt]
    }
    return fromNote
  }, [noteExcerpts, previewDoc])

  const ytId = parseYouTubeId(note?.heroImageUrl)
  // Video notes whose video is a Desk library session get the Desk theater's
  // watch rails on the edges — chapters + setups + recap poster (left), key
  // takeaways + tickers covered (right), and search-the-transcript under the
  // player. Plain/external videos resolve to null and keep the simple column.
  const { video: deskVideo } = useDeskVideoByYoutube(ytId)
  const insights = useVideoInsights(deskVideo?.id ?? null)
  const hasLeftRail = !!deskVideo && (insights.loading ||
    insights.chapters.length > 0 || insights.setups.length > 0 || !!insights.posterUrl)
  const hasRightRail = !!deskVideo && (insights.loading ||
    insights.summary.length > 0 || insights.tickerMoments.length > 0)
  // When the note carries a YouTube hero, upgrade any legacy bold "[MM:SS]"
  // text prefixes into clickable videoTimestamp chips before the editor sees them.
  const bodyForEditor = useMemo(
    () => (ytId && note?.bodyJson ? linkifyTimestamps(note.bodyJson) : note?.bodyJson),
    [ytId, note?.bodyJson],
  )

  const editor = useEditor({
    extensions: buildExtensions(),
    content: bodyForEditor || { type: 'doc', content: [] },
    // Node views can't take React props from the page; the widgetEmbed view
    // reads the note id off editor storage for its archive upload
    // (see WidgetEmbedView's self-archive effect).
    onCreate: ({ editor: ed }) => {
      ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), noteId }
      // "Send to Journal" from the charts page targets the LAST-ACTIVE note
      // (owner decision #9) — opening a note for editing is what makes it the
      // target. Title rides along for the capture toast.
      try {
        localStorage.setItem('uct.jw.lastNote', JSON.stringify({
          id: noteId, ts: Date.now(),
          title: (note?.title || '').trim() || null,
        }))
      } catch { /* private mode */ }
    },
    editorProps: {
      attributes: { class: styles.proseEditor },
      handlePaste(view, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.kind !== 'file') continue
          if (ALLOWED_IMAGE_MIMES.has(item.type)) {
            event.preventDefault()
            const file = item.getAsFile()
            if (file) handleImageInsert(file)
            return true
          }
          if (ALLOWED_ATTACHMENT_MIMES.has(item.type)) {
            event.preventDefault()
            const file = item.getAsFile()
            if (file) handleAttachmentInsert(file)
            return true
          }
        }
        return false
      },
      handleDrop(view, event) {
        const file = event.dataTransfer?.files?.[0]
        if (!file) return false
        if (ALLOWED_IMAGE_MIMES.has(file.type)) {
          event.preventDefault()
          handleImageInsert(file)
          return true
        }
        if (ALLOWED_ATTACHMENT_MIMES.has(file.type)) {
          event.preventDefault()
          handleAttachmentInsert(file)
          return true
        }
        return false
      },
    },
    onUpdate: () => scheduleAutosaveRef.current(),
  }, [note?.id])
  // Keep the ref current so the paste/drop handlers (captured at creation) always
  // reach the live editor instance.
  editorRef.current = editor
  // TipTap v3's useEditor does NOT re-render on transactions, so toolbar state
  // read in render (font/size dropdowns, bold/italic active) goes stale. Bump a
  // counter on every selection/mark change to keep the toolbar in sync.
  const [, bumpToolbar] = useReducer((x) => x + 1, 0)
  useEffect(() => {
    if (!editor) return undefined
    const update = () => bumpToolbar()
    editor.on('transaction', update)
    editor.on('selectionUpdate', update)
    return () => { editor.off('transaction', update); editor.off('selectionUpdate', update) }
  }, [editor])

  // Push fresh body into editor when note loads (one-shot per note).
  // Depends on `editor` (not just note.id) so it re-runs once the editor
  // instance is actually ready. When a content-bearing note opens, the editor
  // is re-created (useEditor keyed on note.id) and for a tick `editor.commands`
  // can throw "Cannot read properties of null (reading 'commands')" because the
  // ProseMirror view/commandManager isn't mounted yet — that TypeError crashed
  // the whole page (empty notes never hit it: their content already matches the
  // empty editor so setContent is skipped). Guard + try/catch make it safe; the
  // editor was already created with this content via useEditor's `content`
  // option, so a swallowed first attempt still shows the note.

  // The user's RESOLVED own-chart settings ride editor storage so the SLASH
  // paths can freeze them at insert (the door captures always did — only
  // typed inserts drifted; panel finding). Re-stamped whenever prefs
  // land/change: onCreate alone raced the prefs fetch. The stamp lives in
  // widgetEmbedCore (one authority) and resolves the workspace WIDGET
  // settings, not the bare chart_settings seed — stamping the seed here was
  // how journal charts lost the user's MAs/legend/colors (chart-parity round).
  // ⛔ Gate on !loading: stamping while the SWR fetch is pending would freeze
  // pure DEFAULTS as "the user's chart" — an insert/Sync in that window ships
  // the exact defect this stamp exists to fix (review finding). And key the
  // effect on the RAW pref values, not the prefs object: usePreferences hands
  // back a new object every render, and this page re-renders per keystroke —
  // an object dep re-parses the whole multi-KB workspace layout on every
  // caret move (review finding).
  const { prefs, loading: prefsLoading } = usePreferences()
  useEffect(() => {
    if (prefsLoading) return
    stampChartSettings(editor, prefs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, prefsLoading, prefs.charts_workspace_layout, prefs.charts_default_chart_widget, prefs.chart_settings])

  useEffect(() => {
    if (!editor || editor.isDestroyed || !note?.bodyJson || editor.isFocused) return
    try {
      const current = JSON.stringify(editor.getJSON())
      const fresh = JSON.stringify(bodyForEditor)
      if (current !== fresh) editor.commands.setContent(bodyForEditor, EMIT_NOTHING)
    } catch {
      /* editor view not mounted yet — content already loaded via useEditor */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, editor])

  // ⛔ The arming half of `hydratedRef` — see its declaration for the defect.
  // Declared AFTER `useEditor` on purpose: effects run in the order their hooks
  // were called, so `useEditor`'s own rebuild effect runs first and its
  // construction-time repair transaction is refused by a ref that is still
  // false. It is armed here, one effect later, once `editor` and `note` are
  // both the ones this render is about.
  // ⛔ NOT gated on `note.bodyJson` (as the sync effect above is): a note the
  // server holds with no body at all must still be editable, and gating on the
  // body would leave that member typing into a page that saves nothing.
  useEffect(() => {
    hydratedRef.current = Boolean(editor && !editor.isDestroyed && note)
  }, [note?.id, editor, note])

  // A15 conflict reconcile: pull the fresh note, append any widgetEmbed the
  // server holds that the local doc lacks (the only server-side bodyJson
  // writer is the Send-to-Journal append, so "missing locally" ≈ "appended
  // after our baseline"; an embed the user deleted locally in that same
  // window gets resurrected rather than lost — the safe direction), then
  // advance the baseline so the caller's retry wins cleanly.
  const embedKeyOf = (a) => `${a?.widgetId}|${a?.capturedAt}|${a?.searchText}`

  /** Is the server's change provably nothing but APPENDED widget embeds?
   *
   * ⛔⛔ THE WHOLE SAFETY OF THE MERGE BRANCH RESTS ON THIS BEING A PROOF, NOT
   * A GUESS. It compares the server's document against our BASE (what we last
   * saw), not against our working copy: strip the widget embeds the server has
   * that the base did not, and if what remains is byte-identical to the base —
   * and the title and subtitle never moved — then the server's ONLY change was
   * appending those embeds, and merging them cannot lose anything.
   *
   * Anything else, including a change we simply cannot characterise, is NOT
   * safe to merge (§6: preserve both when safe reconciliation cannot be
   * PROVEN). */
  const serverChangeIsAppendOnlyEmbeds = (fresh, base) => {
    if ((fresh.title || '') !== (base.title || '')) return false
    if ((fresh.subtitle || '') !== (base.subtitle || '')) return false
    if (!base.bodyJson || !fresh.bodyJson) return false
    const baseKeys = new Set()
    const collect = (node) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'widgetEmbed') baseKeys.add(embedKeyOf(node.attrs))
      for (const child of node.content || []) collect(child)
    }
    collect(base.bodyJson)
    const strip = (node) => {
      if (!node || typeof node !== 'object') return node
      const out = { ...node }
      if (Array.isArray(node.content)) {
        out.content = node.content
          .filter((c) => !(c && c.type === 'widgetEmbed' && !baseKeys.has(embedKeyOf(c.attrs))))
          .map(strip)
      }
      return out
    }
    return JSON.stringify(strip(fresh.bodyJson)) === JSON.stringify(base.bodyJson)
  }

  /** ⚰️⚰️ WAVE Q1 ENTRY GATE — THIS USED TO OVERWRITE THE SERVER.
   *
   * The old handler appended the widget embeds it was missing, advanced the
   * baseline, and let `commitSave` retry with the LOCAL document — so any
   * newer server prose, title or subtitle was replaced. It was built for the
   * Send-to-Journal server-side append (its comment says so) and it is correct
   * for exactly that case. Against two humans it was last-write-wins, and it
   * had no rail.
   *
   * Wave Q makes the stale-baseline case ORDINARY rather than rare — an
   * offline outbox manufactures it on purpose — so the handler now proves the
   * merge is safe or preserves both versions.
   *
   * Returns true when the caller may retry, false when the conflict has been
   * resolved by forking (and the retry must NOT happen).
   */
  const reconcileConflict = async () => {
    const res = await fetch(`/api/j2/notes/${noteId}`, { credentials: 'include' })
    if (!res.ok) throw new Error(`${res.status}`)
    const fresh = (await res.json())?.note
    if (!fresh) throw new Error('empty note on reconcile')
    const base = lastSavedRef.current

    if (serverChangeIsAppendOnlyEmbeds(fresh, base)) {
      const localKeys = new Set()
      editor.state.doc.descendants((n) => {
        if (n.type.name === 'widgetEmbed') localKeys.add(embedKeyOf(n.attrs))
        return true
      })
      const missing = []
      const walk = (node) => {
        if (!node || typeof node !== 'object') return
        if (node.type === 'widgetEmbed' && !localKeys.has(embedKeyOf(node.attrs))) missing.push(node)
        for (const child of node.content || []) walk(child)
      }
      walk(fresh.bodyJson)
      // focus('end') — the appends rail (widgetEmbedInsert.test.jsx): a text
      // position, never a NodeSelection that would swallow a trailing atom.
      // caretAfterWidgetEmbed: nor may the INSERT leave one armed (the typing-
      // after-insert trap).
      if (missing.length) editor.chain().focus('end').insertContent(missing).caretAfterWidgetEmbed().run()
      lastSavedRef.current.updatedAt = fresh.updatedAt || null
      return true
    }

    // ⛔ PRESERVE BOTH. The server keeps its version untouched; the member's
    // version becomes a sibling, using the vocabulary the connectors already
    // taught members (`sync-conflict`, a titled copy) rather than a second,
    // offline-only conflict system.
    const localTitle = titleRef.current || ''
    const localSubtitle = subtitleRef.current || ''
    const localBody = editor.getJSON()
    await createNoteViaApi({
      title: `${localTitle} (conflicted copy)`.trim(),
      bodyJson: localBody,
      tags: ['sync-conflict'],
      folderId: note?.folderId || undefined,
    })
    if (localSubtitle) {
      // The create endpoint takes no subtitle; the copy carries it in the body
      // only if the member had one. Recorded here rather than silently dropped.
      console.info('[note-conflict] subtitle not carried onto the conflicted copy')
    }

    // The editor now shows what the SERVER has — the canonical version — so the
    // member is not typing into a document that no longer exists anywhere.
    setTitle(fresh.title || '')
    titleRef.current = fresh.title || ''
    setSubtitle(fresh.subtitle || '')
    subtitleRef.current = fresh.subtitle || ''
    if (fresh.bodyJson) editor.commands.setContent(fresh.bodyJson, EMIT_NOTHING)
    lastSavedRef.current = {
      title: fresh.title || '', subtitle: fresh.subtitle || '',
      bodyJson: fresh.bodyJson, updatedAt: fresh.updatedAt || null,
    }
    clearDraftLocally()
    setSaveStatus('conflict')
    setSaveErrorMsg('')
    return false
  }

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
    // Compare-and-set baseline (A15): the server 409s instead of letting this
    // full-doc PUT silently delete a write that landed after our baseline.
    if (isUsableBaseline(last.updatedAt)) patch.baseUpdatedAt = last.updatedAt

    setSaveStatus(retryAttemptsRef.current === 0 ? 'saving' : 'reconnecting')
    try {
      const saved = await update(patch)
      lastSavedRef.current = {
        title, subtitle, bodyJson,
        updatedAt: usableBaseline(saved?.updatedAt, lastSavedRef.current.updatedAt),
      }
      // Wave Q1: the server now holds `bodyJson`. ⛔ `current` is read AGAIN
      // here rather than reusing what we sent: if the member typed during the
      // PUT, the durable copy is ahead of this ack and its sync intent must
      // SURVIVE — an acknowledgement of older words has never been permission
      // to forget newer ones.
      durableRef.current.markSynced({
        acked: { title, subtitle, bodyJson },
        current: captureLocalState() || { title, subtitle, bodyJson },
        updatedAt: lastSavedRef.current.updatedAt,
      })
      conflictRetriedRef.current = false
      setSaveStatus('saved')
      setSaveErrorMsg('')
      retryAttemptsRef.current = 0
      // The embeds this save just persisted are safe — consume their inbox rows.
      consumePlacedCaptures()
      // Wave 0 (P1-10): the server now has this content — the local safety
      // net for it is no longer needed.
      clearDraftLocally()
    } catch (e) {
      const status = e?.status
      if (status === 409 && !conflictRetriedRef.current) {
        conflictRetriedRef.current = true
        try {
          const mayRetry = await reconcileConflict()
          // ⛔ A FORK IS A RESOLUTION, NOT A REASON TO TRY AGAIN. Retrying
          // after one would push the local document over the server version
          // the fork exists to protect — the exact overwrite this gate closes.
          if (!mayRetry) return
          retryTimerRef.current = setTimeout(() => commitSaveRef.current(), 50)
          return
        } catch (re) {
          console.warn('conflict reconcile failed', re)
          // fall through: surfaces as a non-retryable save error below
        }
      }
      // No status = network/fetch error; 5xx = backend down or restarting.
      // Both are worth retrying. 4xx = real client/validation error — won't
      // get better on retry, so surface immediately.
      const retryable = !status || status >= 500
      if (!retryable) {
        console.error('autosave failed (non-retryable)', e)
        setSaveStatus('error')
        setSaveErrorMsg(friendlySaveError(e, status))
        retryAttemptsRef.current = 0
        return
      }
      const attempt = retryAttemptsRef.current
      const delay = RETRY_BACKOFFS_MS[Math.min(attempt, RETRY_BACKOFFS_MS.length - 1)]
      retryAttemptsRef.current = attempt + 1
      console.warn(`autosave failed (retry ${attempt + 1} in ${delay}ms)`, e)
      setSaveStatus('reconnecting')
      setSaveErrorMsg(friendlySaveError(e, status, { retrying: true }))
      retryTimerRef.current = setTimeout(() => commitSaveRef.current(), delay)
    }
  }

  // Keep latest-callback refs pointed at the freshest closures every render.
  // Anything that captured these earlier (TipTap onUpdate, scheduled timeouts,
  // unmount cleanup) will dereference through the ref and get the current
  // title/subtitle — fixing the "first keystroke not saved" + "body save
  // clobbers title" + "unmount saves stale empty values" bugs.
  scheduleAutosaveRef.current = scheduleAutosave
  commitSaveRef.current = commitSave

  // Save on unmount if dirty.
  useEffect(() => () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      commitSaveRef.current()
    }
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

  // Wave B: native confirm() replaced with the shared ConfirmModal (G-103) —
  // request opens the modal, confirm performs the actual mutation. Wave 0
  // trash: this is a soft delete, restorable from the sidebar's Trash entry
  // for 30 days, so the copy stays proportional rather than "permanently".
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const onDeleteRequest = () => setConfirmingDelete(true)
  const onDeleteConfirm = async () => {
    const res = await fetch(`/api/j2/notes/${noteId}`, {
      method: 'DELETE', credentials: 'include',
    })
    if (res.ok) {
      // This note's target status just flipped active -> trashed -- same
      // "a noteLink chip elsewhere in this tab is now stale" class as a
      // rename (Wave D closure pass finding), so the same cache-bust applies.
      invalidateNoteLinkTarget(noteId)
      onBack()
    }
  }

  const ToolButton = ({ active, onClick, label, title }) => (
    <button
      type="button"
      className={`${styles.toolBtn} ${active ? styles.toolBtnActive : ''}`}
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      aria-label={title}
    >{label}</button>
  )

  if (isLoading) {
    // Wave B (G-106 adoption): a skeleton approximating the note page's own
    // layout (title, then body lines) — reduces layout shift vs. a bare
    // spinner and matches every other high-frequency structural load's
    // treatment in this wave.
    return (
      <div className={styles.loading} role="status" aria-label="Loading…">
        <SkeletonLine width="45%" height={26} />
        <div style={{ height: 20 }} />
        <SkeletonLine width="92%" height={14} />
        <SkeletonLine width="88%" height={14} />
        <SkeletonLine width="70%" height={14} />
      </div>
    )
  }

  // P0-2 fix: `error` is real and returned by useJ2Note, but was never
  // consumed here -- so a failed fetch (transient network blip, a stale
  // link to a deleted note, anything) left `note` permanently null while
  // `isLoading` settled false, and the page hung on "Loading…" forever
  // with no way forward. `noteId` is always truthy for every real mount of
  // this component (NotebookTab only renders it once a note is selected),
  // so once loading has settled, `!note` here always means the fetch
  // failed -- never a normal transient state -- and is the right signal to
  // branch on (unlike `loadError` alone, which SWR can also set on a LATER
  // background revalidation failure while a perfectly good `note` from an
  // earlier successful fetch is still on screen; that case must keep
  // rendering the note, not this error card).
  if (!note) {
    return (
      <div className={styles.loadError} role="alert">
        <p>Couldn't load this note.</p>
        <p className={styles.loadErrorHint}>
          Nothing here has been changed or lost — this looks like a connection
          problem, not a save problem.
        </p>
        <div className={styles.loadErrorActions}>
          <button type="button" className="btn btn-primary" onClick={refresh}>
            Try again
          </button>
          {showBack && (
            <button type="button" className="btn btn-ghost" onClick={onBack}>
              ← Notebook
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page} ref={pageRef} onKeyDown={onPageKeyDown}>
      <Toast
        message={uploadToast?.message}
        tone={uploadToast?.tone}
        onDismiss={() => setUploadToast(null)}
      />
      <DocumentPreviewSheet
        open={!!previewDoc}
        href={previewDoc?.href}
        name={previewDoc?.name}
        page={previewDoc?.page}
        onClose={() => setPreviewDoc(null)}
        excerpts={previewExcerpts}
        onSaveExcerpt={handleSaveExcerpt}
        emphasizeExcerptId={previewDoc?.emphasizeExcerptId}
        documentId={previewDoc?.documentId}
      />
      <CapturedSourceSheet
        open={!!capturedSource}
        excerpt={capturedSource}
        onClose={() => setCapturedSource(null)}
        onOpenOwningNote={
          capturedSource && capturedSource.noteId !== noteId
            ? () => {
                // ⛔ The app's ONE routing idiom for a note — the same `?note=`
                // param NotebookTab owns and Search writes through
                // `applyTargetToParams`. Never a second route shape.
                const nid = capturedSource.noteId
                setCapturedSource(null)
                setSearchParams((prev) => {
                  const next = applyTargetToParams(prev, { noteId: nid, depth: 'note' })
                  return next
                })
              }
            : null
        }
      />
      <div className={styles.chrome} ref={chromeRef}>
      <header className={styles.header}>
        {showBack && (
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← Notebook
          </button>
        )}
        {/* Only surface a PROBLEM (reconnecting / save failed) — the steady
            "Saved"/"Saving"/"Editing" chatter is dropped so the formatting
            toolbar sits at the far left of the header. */}
        {/* ⛔ CSS-module classes are hashes, not strings: `styles.saveState`
            would have compiled to `undefined` and rendered unstyled. Reuse the
            class the other save states already use. */}
        {/* Wave Q1 — PERMANENT RULE: SAVED ON THIS DEVICE ≠ SYNCED TO UCT.
            Shown only while the server does NOT have the work (the healthy
            path already stays quiet), and only once the durable write has
            actually COMMITTED — never while it is pending, in flight, or
            failed. `durable.unsynced` is that commit, not an intention.

            ⛔ AND THE NOUN NARROWS WHEN THE PLATFORM WILL NOT PROMISE RETENTION.
            "This device" implies the words outlive the browsing session; only a
            granted `persisted()` supports that. Everywhere else — a private
            window, a fresh profile, Safari and Firefox as measured — the honest
            claim is "in this browser", which is true in every environment in the
            §32 matrix.

            ⛔ THIS IS NOT PRIVATE-MODE DETECTION AND MUST NEVER BECOME IT.
            `persisted() === false` is equally true of a brand-new ordinary
            profile; it means only that persistent-storage protection has not
            been positively granted. No badge, no claim, no behaviour change. */}
        {durable.unsynced && (saveStatus === 'error' || saveStatus === 'reconnecting') && (
          <div className={styles.saveStatus} role="status">
            <UIcon name="check" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {durable.persisted === true
              ? 'Saved on this device · waiting to sync'
              : 'Saved in this browser · waiting to sync'}
          </div>
        )}
        {saveStatus === 'conflict' && (
          <div className={styles.saveStatus} role="status">
            <UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {'Conflict — this note changed elsewhere. Your version was kept as a conflicted copy.'}
          </div>
        )}
        {(saveStatus === 'error' || saveStatus === 'reconnecting') && (
          <div className={styles.saveStatus} title={saveErrorMsg || undefined}>
            {saveStatus === 'reconnecting' && 'Reconnecting…'}
            {saveStatus === 'error' && <><UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />{`Save failed${saveErrorMsg ? `: ${saveErrorMsg}` : ''}`}</>}
          </div>
        )}
        <div className={styles.headerControls}>
          <button
            type="button"
            className={styles.chromeBtn}
            onClick={onToggleFavorite}
            disabled={favoriteBusy}
            aria-pressed={isFavorite}
            aria-label={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
            title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
          >
            <UIcon name={isFavorite ? 'star-fill' : 'star'} size={15} gold={isFavorite} />
          </button>
          <NoteLinkedTradeChips noteId={noteId} />
          <AskPanel
            scope="note"
            target={noteId}
            /* The LIVE doc, unsaved edits included -- it is where the member
               would actually land, so it is what a citation must verify
               against. */
            getEditorDoc={() => editorRef.current?.state?.doc}
            onNavigate={jumpToCitation}
          />
          <button
            type="button"
            className={styles.chromeBtn}
            onClick={() => setHistoryOpen(true)}
            title="See earlier versions of this note and restore one"
            aria-label="Version history"
          >
            <UIcon name="clock" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            History
          </button>
          {isAdmin && (
            <>
              <button type="button" className={styles.chromeBtn} onClick={copyShareLink}
                title={share ? 'Copy the public link to this note' : 'Create a public read-only link and copy it'}>
                {share ? 'Copy link' : 'Share'}
              </button>
              {share && (
                <button type="button" className={styles.chromeBtn} onClick={unshare}
                  title="Revoke the public link — it stops working immediately">
                  Unshare
                </button>
              )}
            </>
          )}
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
          <button type="button" className="btn btn-danger" onClick={onDeleteRequest}>
            Delete
          </button>
        </div>
      </header>

      {confirmingDelete && (
        <ConfirmModal
          title="Delete this note?"
          body="It moves to Trash and can be restored for 30 days before it's permanently removed."
          confirmLabel="Delete"
          tone="danger"
          onConfirm={onDeleteConfirm}
          onClose={() => setConfirmingDelete(false)}
        />
      )}

      {/* Wave 0 (P1-10): a locally-drafted version of this note from a
          session that never actually saved it to the server (tab closed,
          crashed, or offline mid-edit). Offered, never auto-applied — the
          member decides whether it's worth more than what's on screen. */}
      {pendingDraft && (
        <div className={styles.draftBanner} data-export-exclude role="status">
          <span>
            {recovery?.ambiguous
              ? 'Two unsaved copies of this note were found on this device and they cannot be put in order. Restore uses the most recent one.'
              : 'Unsaved changes from a previous session were found for this note.'}
          </span>
          <div className={styles.draftBannerActions}>
            <button
              type="button"
              className={`${styles.draftBannerBtn} ${styles.draftBannerBtnPrimary}`}
              onClick={restoreDraft}
            >
              Restore
            </button>
            <button type="button" className={styles.draftBannerBtn} onClick={discardDraft}>
              Discard
            </button>
          </div>
        </div>
      )}

      {/* The editor toolbar ROW (owner ask, chart-parity round): the font/
          formatting cluster and the PNG/Print exports grouped as ONE
          discoverable surface, full-width under the header instead of split
          across a crowded header line. Sticky via the shared .chrome wrapper;
          data-export-exclude keeps the row out of the PNG rasterization. */}
      {editor && (
        <div className={styles.toolbarRow} role="toolbar" aria-label="Editor toolbar" data-export-exclude>
            <select
              className={styles.fontSelect}
              value={editor.getAttributes('textStyle').fontFamily || ''}
              onChange={(e) => {
                const v = e.target.value
                if (v) editor.chain().focus().setFontFamily(v).run()
                else editor.chain().focus().unsetFontFamily().run()
              }}
              title="Font"
              aria-label="Font family"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.label} value={f.value} style={f.value ? { fontFamily: f.value } : undefined}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              className={styles.fontSizeSelect}
              value={editor.getAttributes('textStyle').fontSize || ''}
              onChange={(e) => {
                const v = e.target.value
                if (v) editor.chain().focus().setFontSize(v).run()
                else editor.chain().focus().unsetFontSize().run()
              }}
              title="Text size"
              aria-label="Text size"
            >
              <option value="">Size</option>
              {FONT_SIZES.map((s) => <option key={s} value={`${s}px`}>{s}</option>)}
            </select>
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
              label={<UIcon name="link" size={14} />}
            />
            <ToolButton
              onClick={() => fileInputRef.current?.click()}
              label={<UIcon name="document" size={14} />}
              title="Insert image"
            />
            <ToolButton
              onClick={() => attachFileInputRef.current?.click()}
              label={<UIcon name="paperclip" size={14} />}
              title="Attach a file"
            />
            <ToolButton
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              label="―"
            />
          {/* Widget palette door — point-and-click inserts for people who
              don't reach for slash commands (owner ask). */}
          <button
            type="button"
            className={`${styles.toolBtn} ${paletteOpen ? styles.toolBtnActive : ''}`}
            onClick={() => setPaletteOpen((o) => !o)}
            title="Insert a chart or preset — pick ticker and timeframe by clicking"
            aria-label="Insert widget"
          >
            ⊞ Insert
          </button>
          <div className={styles.toolbarExports}>
            {chromeMsg && <span className={styles.chromeMsg} role="status">{chromeMsg}</span>}
            {/* Export: PNG rasterizes the note column (charts included); Print
                rides the browser's Save-as-PDF via the print stylesheet. */}
            <button type="button" className={styles.chromeBtn} onClick={savePng} disabled={exportBusy}
              title="Download this note as a PNG image">
              PNG
            </button>
            <button type="button" className={styles.chromeBtn} onClick={printNote}
              title="Print — or Save as PDF from the print dialog">
              Print
            </button>
            {/* Wave C: portable markdown export -- unlike PNG/Print, this
                round-trips back into this product (or Obsidian/any
                markdown-aware app), matching the full-notebook export's
                own format. */}
            <button type="button" className={styles.chromeBtn} onClick={downloadMarkdown} disabled={exportBusy}
              title="Download this note as portable Markdown — the same format the full notebook export uses">
              Markdown
            </button>
          </div>
        </div>
      )}
      {/* Absolute child of the sticky chrome — anchored to its bottom edge,
          so it follows the pinned chrome regardless of how many rows the
          header wraps to (review finding: a fixed viewport offset here
          duplicated the chrome height by hand). */}
      {paletteOpen && editor && (
        <WidgetPalette editor={editor} onClose={() => setPaletteOpen(false)} />
      )}
      </div>

      <div
        className={
          `${styles.watchWrap} ${hasLeftRail ? styles.hasLeft : ''} ${hasRightRail ? styles.hasRight : ''}`
        }
      >
        {hasLeftRail && (
          <div className={styles.railLeft}><NoteRailLeft insights={insights} /></div>
        )}
        <div className={styles.column} ref={columnRef} data-print-root>
        {ytId ? (
          <>
            <NoteVideoHero youtubeId={ytId} watchUrl={note.heroImageUrl} />
            {deskVideo && (
              <div className={styles.noteTranscript}>
                <TranscriptPanel
                  videoId={deskVideo.id}
                  hasTranscript={insights.hasTranscript}
                  onSeek={seekNoteVideo}
                  getTime={getNoteVideoTime}
                />
              </div>
            )}
          </>
        ) : note.heroImageUrl ? (
          // A note that already has a hero image keeps showing it (it's content,
          // still editable via the picker's controls). Notes without one start
          // straight at the title — no empty drop-zone.
          <HeroImagePicker
            noteId={noteId}
            value={note.heroImageUrl}
            onChange={onHeroChange}
          />
        ) : null}

        <input
          className={styles.titleInput}
          value={title}
          onChange={(e) => {
            const v = e.target.value
            setTitle(v)
            titleRef.current = v
            scheduleAutosave()
            onTitleChange?.(noteId, v)
          }}
          placeholder="Title"
        />
        <input
          className={styles.subtitleInput}
          value={subtitle}
          onChange={(e) => {
            const v = e.target.value
            setSubtitle(v)
            subtitleRef.current = v
            scheduleAutosave()
          }}
          placeholder="Subtitle (optional)"
        />

        {/* Wave E: below title/subtitle, above the body (checkpoint §21) --
            a note with nothing set renders only a small "+ Add property"
            link, never a permanent header (progressive disclosure). */}
        <PropertiesSection noteId={noteId} updateNote={update} ticker={note?.ticker} />

        {/* Wave P1 §23: why Search/Ask cannot read an attachment yet. Renders
            NOTHING when every document's text is complete — the common case
            gets no chrome. */}
        <DocumentTextStatus documents={noteDocuments} />

        {/* Wave G: Thesis Evidence + Changelog -- below Properties, above the
            body (checkpoint §39); renders nothing for a note that isn't
            being used as a thesis. */}
        <ThesisSection noteId={noteId} note={note} onOpenExcerptSource={handleOpenExcerptSource}
                       anchorReviewId={reviewAnchor?.reviewId || null}
                       onReviewAnchorConsumed={clearReviewParam} />

        <CaptureInboxTray editor={editor} onPlaced={(id) => pendingInboxConsumeRef.current.add(id)} />

        {findOpen && (
          <NoteFindBar editor={editor} onClose={() => { setFindOpen(false); editor?.commands.noteFindClear() }} />
        )}

        <div onClickCapture={handleEditorClickCapture}>
          <EditorContent editor={editor} />
        </div>

        {/* Wave D: "Linked from" backlinks -- renders nothing until this
            note has at least one real backlink (directive §70/§16). */}
        <NoteBacklinksSection noteId={noteId} />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          aria-label="Upload image"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleImageInsert(f)
            e.target.value = ''
          }}
        />
        <input
          ref={attachFileInputRef}
          type="file"
          accept=".pdf,.txt,.csv,.md,.zip,.mp3,.m4a,.docx,.xlsx"
          aria-label="Upload file attachment"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleAttachmentInsert(f)
            e.target.value = ''
          }}
        />
        </div>
        {hasRightRail && (
          <div className={styles.railRight}><NoteRailRight insights={insights} /></div>
        )}
      </div>
      <NoteHistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        noteId={noteId}
        currentNote={note}
        onRestored={onVersionRestored}
      />
    </div>
  )
}
