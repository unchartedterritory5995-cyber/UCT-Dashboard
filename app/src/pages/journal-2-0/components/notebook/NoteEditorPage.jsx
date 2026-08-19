import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import { buildExtensions, uploadInlineImage } from '../../lib/tiptap'
import { useJ2Note } from '../../hooks/useJ2Notes'
import useJ2NoteFolders from '../../hooks/useJ2NoteFolders'
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
import { stampChartSettings } from '../../lib/widgetEmbedCore'
import WidgetPalette from './WidgetPalette'
import { sharedNoteUrl } from '../../lib/noteShareLink'
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

export default function NoteEditorPage({ noteId, onBack, showBack = true, onTitleChange = null }) {
  const { note, isLoading, update, refresh } = useJ2Note(noteId)
  const { folders } = useJ2NoteFolders()
  const { user } = useAuth()
  const [saveStatus, setSaveStatus] = useState('saved')
  const [saveErrorMsg, setSaveErrorMsg] = useState('')
  // ── Export + share (post-v1 round 2) ──────────────────────────────────────
  const columnRef = useRef(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [chromeMsg, setChromeMsg] = useState(null)
  // Widget palette (point-and-click inserts) — toggled from the toolbar row.
  const [paletteOpen, setPaletteOpen] = useState(false)
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

  useEffect(() => {
    if (note) {
      setTitle(note.title || '')
      setSubtitle(note.subtitle || '')
      lastSavedRef.current = {
        title: note.title || '',
        subtitle: note.subtitle || '',
        bodyJson: note.bodyJson,
        updatedAt: note.updatedAt || null,
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
    conflictRetriedRef.current = false // fresh edit = fresh conflict budget
    saveTimerRef.current = setTimeout(() => commitSaveRef.current(), AUTOSAVE_MS)
  }

  // The editor is read through a ref, NOT the `editor` const: handlePaste /
  // handleDrop are captured in editorProps at editor-CREATION time, when the
  // `editor` const is still null — so closing over it directly made paste throw
  // "Cannot read properties of null (reading 'chain')". The ref is always fresh.
  const editorRef = useRef(null)
  const handleImageInsert = async (file) => {
    const ed = editorRef.current
    if (!ed || !file) return
    try {
      const { url } = await uploadInlineImage(noteId, file)
      ed.chain().focus().setImage({ src: url, alt: '' }).run()
    } catch (e) {
      alert(`Upload failed: ${e.message || e}`)
    }
  }

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
  const { prefs } = usePreferences()
  useEffect(() => {
    stampChartSettings(editor, prefs)
  }, [editor, prefs])

  useEffect(() => {
    if (!editor || editor.isDestroyed || !note?.bodyJson || editor.isFocused) return
    try {
      const current = JSON.stringify(editor.getJSON())
      const fresh = JSON.stringify(bodyForEditor)
      if (current !== fresh) editor.commands.setContent(bodyForEditor, false)
    } catch {
      /* editor view not mounted yet — content already loaded via useEditor */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, editor])

  // A15 conflict reconcile: pull the fresh note, append any widgetEmbed the
  // server holds that the local doc lacks (the only server-side bodyJson
  // writer is the Send-to-Journal append, so "missing locally" ≈ "appended
  // after our baseline"; an embed the user deleted locally in that same
  // window gets resurrected rather than lost — the safe direction), then
  // advance the baseline so the caller's retry wins cleanly.
  const reconcileConflict = async () => {
    const res = await fetch(`/api/j2/notes/${noteId}`, { credentials: 'include' })
    if (!res.ok) throw new Error(`${res.status}`)
    const fresh = (await res.json())?.note
    if (!fresh) throw new Error('empty note on reconcile')
    const embedKey = (a) => `${a?.widgetId}|${a?.capturedAt}|${a?.searchText}`
    const localKeys = new Set()
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'widgetEmbed') localKeys.add(embedKey(n.attrs))
      return true
    })
    const missing = []
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'widgetEmbed' && !localKeys.has(embedKey(node.attrs))) missing.push(node)
      for (const child of node.content || []) walk(child)
    }
    walk(fresh.bodyJson)
    // focus('end') — the appends rail (widgetEmbedInsert.test.jsx): a text
    // position, never a NodeSelection that would swallow a trailing atom.
    // caretAfterWidgetEmbed: nor may the INSERT leave one armed (the typing-
    // after-insert trap).
    if (missing.length) editor.chain().focus('end').insertContent(missing).caretAfterWidgetEmbed().run()
    lastSavedRef.current.updatedAt = fresh.updatedAt || null
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
    if (last.updatedAt) patch.baseUpdatedAt = last.updatedAt

    setSaveStatus(retryAttemptsRef.current === 0 ? 'saving' : 'reconnecting')
    try {
      const saved = await update(patch)
      lastSavedRef.current = {
        title, subtitle, bodyJson,
        updatedAt: saved?.updatedAt ?? lastSavedRef.current.updatedAt,
      }
      conflictRetriedRef.current = false
      setSaveStatus('saved')
      setSaveErrorMsg('')
      retryAttemptsRef.current = 0
      // The embeds this save just persisted are safe — consume their inbox rows.
      consumePlacedCaptures()
    } catch (e) {
      const status = e?.status
      if (status === 409 && !conflictRetriedRef.current) {
        conflictRetriedRef.current = true
        try {
          await reconcileConflict()
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
      <div className={styles.chrome}>
      <header className={styles.header}>
        {showBack && (
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← Notebook
          </button>
        )}
        {/* Only surface a PROBLEM (reconnecting / save failed) — the steady
            "Saved"/"Saving"/"Editing" chatter is dropped so the formatting
            toolbar sits at the far left of the header. */}
        {(saveStatus === 'error' || saveStatus === 'reconnecting') && (
          <div className={styles.saveStatus} title={saveErrorMsg || undefined}>
            {saveStatus === 'reconnecting' && 'Reconnecting…'}
            {saveStatus === 'error' && <><UIcon name="warning" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />{`Save failed${saveErrorMsg ? `: ${saveErrorMsg}` : ''}`}</>}
          </div>
        )}
        <div className={styles.headerControls}>
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
          <button type="button" className={styles.deleteBtn} onClick={onDelete}>
            Delete
          </button>
        </div>
      </header>

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
          </div>
        </div>
      )}
      </div>

      {paletteOpen && editor && (
        <WidgetPalette editor={editor} onClose={() => setPaletteOpen(false)} />
      )}

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
          onChange={(e) => { setTitle(e.target.value); scheduleAutosave(); onTitleChange?.(noteId, e.target.value) }}
          placeholder="Title"
        />
        <input
          className={styles.subtitleInput}
          value={subtitle}
          onChange={(e) => { setSubtitle(e.target.value); scheduleAutosave() }}
          placeholder="Subtitle (optional)"
        />

        <CaptureInboxTray editor={editor} onPlaced={(id) => pendingInboxConsumeRef.current.add(id)} />

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
        {hasRightRail && (
          <div className={styles.railRight}><NoteRailRight insights={insights} /></div>
        )}
      </div>
    </div>
  )
}
