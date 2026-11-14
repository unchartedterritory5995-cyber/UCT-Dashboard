// The Journal styles manager (Notebook P1, spec P1.4): Notebook > Styles, and the Settings door.
// Lists styles by kind; create, edit, duplicate, rename, set as default, soft-delete with Undo; add,
// rename and delete your own kinds; the one-shot "set Note type from Research Type" offer.
// ⛔ Everything here is a CREATING door: it renders nothing while journalStylesEnabled() is off, and the
// hook fails closed on the same gate. A note that already holds a style's blocks is never affected.
// ⛔ Offline (the list came from the saved copy): reading works, every write control is disabled.
// ⛔ A sentence the SERVER worded (a kind still in use, a refused name) is shown as written; the browser's
//    "Failed to fetch" and a bare "500" never are (./styleErrors.js).
// Focus: opening the editor moves focus to its heading and scrolls it into view (the one-column phone layout
// puts it far below the list); closing it returns focus to the button that opened it; after Delete focus
// lands on Undo, after Undo on the restored row. The status line is sticky, so it is seen where the member is.
// P3a Task 10 (the community style library, only while styleLibraryEnabled()): a member style row gains
// "Share to community" (ShareStyleForm), the list gains a "Community" door (LibraryDoor, opened at Styles) and,
// when an adopted copy is behind its listed version, "Updates (N)" with a list whose rows open LibraryUpdateSheet.
// ⛔ `?libraryUpdate=<styleId>` (the bell notice's link; NotebookTab opens this manager on `?styles=1` and strips
//    only `styles`) is read HERE, by LibraryUpdateParam, never in NotebookTab: it opens the update sheet for that
//    copy only when the copy is in this member's own Updates list, so a server-written link to someone else's
//    style, or to a copy already up to date, opens nothing and shows nothing broken. The param is then cleared.
//    ⛔ It matches against a FRESH read of that list (fix round 1, I-1): the list lives in the app-wide SWR cache,
//    so a copy that fell behind after the member last opened this manager is not in the cached answer.
// ⛔ After "Update my copy" focus goes to the updated copy's row (I-2): the Review update button that opened the
//    sheet is removed with its Updates row, and restoring focus to it would drop the member on <body>.
// ⛔ Share is not offered on any style that carries library provenance (`sourceGalleryId`): an adopted copy, its
//    duplicate, or a style saved from a note made with one (rulings P3a-T10-R3/R5/R6; the server refuses them too).
// P5 Task 5 (ruling P5-R-C12): "How do you trade?" (StarterPackOffer) sits at the top of the list column while
//    R-P5-5 holds, and a quiet "Starter packs" button beside New template and Community opens it whenever the
//    starter-packs switch is on, whatever the member answered before.
// Follow-up C (one room for templates): while wave 11 is on, a view switch at the top (a tablist: Active, Archived,
//    Recently deleted). Archived and Recently deleted render My tools' own list (myTools/TemplateList.jsx, ONE
//    implementation: its rows, Restore, Delete permanently with the typed name, "Kept until"). A member's own row in
//    Active gains Archive (with the hint that its notes keep it) and "Used in N notes" (the list of those notes, in
//    the editor column). Delete's Undo line names the template and says it moved to Recently deleted.
//    `show` / `showKey` (NotebookTab, from `?styles=1&show=` or a link in the New note sheet): read once per opening,
//    'archived' or 'deleted' opens that view; anything else opens Active.
import { useContext, useEffect, useRef, useState } from 'react'
import { useInRouterContext, useSearchParams } from 'react-router-dom'
import useSWR, { mutate as globalMutate } from 'swr'
import Sheet from '../../../../../components/mobile/Sheet'
import { focusableWithin } from '../../../../../components/mobile/useFocusTrap'
import UIcon, { UICON_NAMES } from '../../../../../components/ui/UIcon'
import usePreferences from '../../../../../hooks/usePreferences'
import { useIsPhone } from '../../../../../hooks/useBreakpoint'
import { widgetsWaveOn } from '../../../lib/notebookWidgetsFlags'
import { archiveTemplate, listTemplates } from '../../../lib/templateLibrary'
import TemplateList, { ArchivePanel, BACK_LABEL, usedOf } from '../myTools/TemplateList'
import UsedInList from '../myTools/UsedInList'
import { actionFailure, templateArchiveSentence, usedInText } from '../myTools/myToolsLib'
import { PlainTemplatesManage } from '../MemberTemplates'
import { AuthContext } from '../../../../../context/AuthContext'
import useJournalStyles from '../../../hooks/useJournalStyles'
import { journalStylesEnabled } from '../../../lib/journalStylesFlag'
import { styleLibraryEnabled } from '../../../lib/styleLibraryFlag'
import { useStyleUpdates } from '../../../lib/styleLibrary'
import { kindIcon } from '../../../lib/noteKinds'
import {
  applyMappingOffer, createJournalStyle, createKind, deleteJournalStyle, deleteKind, getJournalStyle,
  getMappingOffer, MAX_STYLE_NAME_CHARS as MAX_STYLE_NAME, restoreJournalStyle, setDefaultJournalStyle, stylesOfKind,
  updateKind,
} from '../../../lib/journalStyles'
import StyleEditor from './StyleEditor'
import LibraryDoor from './LibraryDoor'
import ShareStyleForm from './ShareStyleForm'
import LibraryUpdateSheet from './LibraryUpdateSheet'
import StarterPackOffer, { useStarterPackOffer } from './StarterPackOffer'
import { friendlyError, logIfUnexpected, reportError } from './styleErrors'
import { markOfferApplied, offerApplied } from './offerApplied'
import styles from './StylesManager.module.css'

const MAX_KIND_NAME = 40                           // note_kinds.MAX_KIND_NAME_CHARS
/** The manager's three views (follow-up C), keyed as My tools' list reads them. */
export const MANAGER_VIEWS = Object.freeze([['live', 'Active'], ['archived', 'Archived'], ['deleted', 'Recently deleted']])
const VIEW_KEYS = MANAGER_VIEWS.map(([k]) => k)
/** What `show` may open as a view; anything else (unknown, absent) opens Active. */
const viewOf = (show) => (show === 'archived' || show === 'deleted' ? show : 'live')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const dismissed = (v) => String(v ?? '').replace(/^"|"$/g, '') === 'dismissed'
const newDraftStyle = (kindId) => ({ id: null, name: '', kindId, outlineTemplateId: null, outlineBodyJson: null, blocks: [], properties: {} })
const iconFor = (kind) => (UICON_NAMES.includes(kindIcon(kind)) ? kindIcon(kind) : 'document')
const copyName = (name) => {
  const suffix = ' copy'
  return name.length + suffix.length > MAX_STYLE_NAME ? name.slice(0, MAX_STYLE_NAME - suffix.length) + suffix : name + suffix
}

/** Reads `?libraryUpdate=<styleId>` once, hands it up, and takes it out of the URL (replace, no new entry).
 *  Rendered only inside a router, so the manager itself still renders without one. */
function LibraryUpdateParam({ onFound }) {
  const [params, setParams] = useSearchParams()
  const id = params.get('libraryUpdate')
  useEffect(() => {
    if (!id) return
    onFound(id)
    setParams((prev) => { const p = new URLSearchParams(prev); p.delete('libraryUpdate'); return p }, { replace: true })
  }, [id, onFound, setParams])
  return null
}

export default function StylesManager({ open, onClose, blockedNoteIds = [], show = null, showKey = 0, onUsePlain = null }) {
  const on = journalStylesEnabled()
  const libraryOn = styleLibraryEnabled()
  // Read per render (the flag is latched per tab, so it never flips under an open manager), as MyToolsSheet does.
  const viewsOn = widgetsWaveOn(11)
  const phone = useIsPhone()
  const inRouter = useInRouterContext()
  const { data, error, isLoading, mutate } = useJournalStyles({ enabled: open })
  // The member's own templates with their "Used in" counts (the picker's list has none): My tools' live list.
  const { data: usage, mutate: refreshUsage } = useSWR(open && on && viewsOn ? 'journal-styles:usage' : null,
    async () => {
      const got = await listTemplates('live')
      return got.ok && Array.isArray(got.data.styles) ? got.data.styles : []
    }, { shouldRetryOnError: false, revalidateOnFocus: false })
  const usedById = new Map((usage || []).filter((s) => s && s.id).map((s) => [s.id, usedOf(s)]))
  const [view, setView] = useState(() => viewOf(show))
  const [aside, setAside] = useState(null)             // { kind: 'usedIn' | 'archive', s } in the editor column
  const [asideError, setAsideError] = useState('')
  const tabRefs = useRef({})
  const [plainServed, setPlainServed] = useState(-1)   // the ask (`showKey`) the Plain templates group already landed
  // `show` is read once per opening (and again when a door asks again: `showKey`).
  useEffect(() => {
    if (!open) return
    setView(viewOf(show))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showKey])
  const { updates, refresh: refreshUpdates } = useStyleUpdates({ enabled: open && on })
  const [sharing, setSharing] = useState(null)          // the style row a Share form is open for
  const [updating, setUpdating] = useState(null)        // the adopted copy whose update sheet is open
  const [showUpdates, setShowUpdates] = useState(false)
  const [linkedUpdate, setLinkedUpdate] = useState(null) // ?libraryUpdate=, waiting for the Updates list
  // The deep link opens the sheet only for a copy in this member's own Updates list (never another's style), read
  // afresh: a cached answer can predate the update the bell is about. Cleared after one look, so a dismissed
  // sheet never reopens on a later render.
  useEffect(() => {
    if (!linkedUpdate) return undefined
    let live = true
    const want = linkedUpdate
    Promise.resolve(refreshUpdates()).then(
      (fresh) => {
        if (!live) return
        if ((fresh?.updates || []).some((u) => u.styleId === want)) setUpdating(want)
        setLinkedUpdate(null)
      },
      () => { if (live) setLinkedUpdate(null) },
    )
    return () => { live = false }
  }, [linkedUpdate, refreshUpdates])
  const { data: offerData } = useSWR(
    open && on ? 'journal-styles:mapping-offer' : null, () => getMappingOffer(), { shouldRetryOnError: false })
  const { prefs, setPref } = usePreferences()
  const starter = useStarterPackOffer(open ? data : undefined, open)
  const userId = useContext(AuthContext)?.user?.id

  const [editing, setEditing] = useState(null)          // { style, seq } while the editor is open
  const openSeq = useRef(0)                             // a new number per opening: Discard must remount the editor even for the same style
  const [editorDirty, setEditorDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(null)   // { then } while the discard question is up
  const [undo, setUndo] = useState(null)                // { id } of the style just deleted
  const [status, setStatus] = useState('')
  const [problem, setProblem] = useState('')
  const [kindProblem, setKindProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [newKind, setNewKind] = useState({ name: '', icon: 'document' })
  const [renaming, setRenaming] = useState(null)        // { id, name }
  const [confirmKind, setConfirmKind] = useState(null)  // id of the kind a Delete is waiting on
  // Focus ENTERS the dialog through its first tabbable control (the Sheet's Close button, as the
  // Keyboard Shortcuts dialog does), so NVDA says "Journal styles dialog": focused on the Sheet's panel
  // itself it spoke the name with no role (NVDA row 28, 2026-10-14, production). NOT the title heading:
  // a tabIndex=-1 element is outside useFocusTrap's list, so a first Shift+Tab escaped the modal. The
  // Sheet only focuses its panel when nothing inside already has focus, so this wins its frame.
  const titleRef = useRef(null)
  useEffect(() => {
    if (!open) return
    if (show === 'plain' || show === 'daily') return     // follow-up C: a door asked for the Plain templates group
    const dialog = titleRef.current?.closest('[role="dialog"]')
    focusableWithin(dialog)[0]?.focus()
  }, [open])
  const [offerDone, setOfferDone] = useState(false)     // the offer was applied (also kept in offerApplied.js, which outlives this tab)

  const editorHeadRef = useRef(null)
  const openerRef = useRef(null)
  const undoRef = useRef(null)
  const keepEditingRef = useRef(null)
  const rowEls = useRef({})
  const kindRowEls = useRef({})
  const kindDeleteBtns = useRef({})
  const confirmYesRef = useRef(null)
  const newBtnRef = useRef(null)
  const pendingFocus = useRef(null)                     // { type: 'opener' | 'undo' | 'row' | 'kindDelete' | 'kindRow' | 'addKind' | 'newTemplate', id? }

  // The editor opened: bring it to the member. (On a phone it sits below the whole list.)
  useEffect(() => {
    const h = editorHeadRef.current
    if (!editing || !h) return
    h.focus()
    h.scrollIntoView?.({ block: 'start' })
  }, [editing])
  useEffect(() => { if (confirmDiscard) keepEditingRef.current?.focus() }, [confirmDiscard])
  useEffect(() => { if (error) logIfUnexpected(error) }, [error])        // a first-load bug of ours: logged once, not per render
  useEffect(() => { if (confirmKind) confirmYesRef.current?.focus() }, [confirmKind])
  // Focus a moved target once it exists (Undo appears, a restored row comes back, the opener is still there).
  useEffect(() => {
    const pf = pendingFocus.current
    if (!pf) return
    if (pf.type === 'opener') {
      pendingFocus.current = null
      if (openerRef.current?.isConnected) openerRef.current.focus()
    } else if (pf.type === 'undo') {
      if (undoRef.current) { pendingFocus.current = null; undoRef.current.focus() }
    } else if (pf.type === 'row') {
      const li = rowEls.current[pf.id]
      if (li) { pendingFocus.current = null; (li.querySelector('button:not(:disabled)') || li).focus() }
    } else if (pf.type === 'kindDelete') {
      const b = kindDeleteBtns.current[pf.id]
      if (b) { pendingFocus.current = null; b.focus() }
    } else if (pf.type === 'kindRow') {
      const li = kindRowEls.current[pf.id]
      if (li) { pendingFocus.current = null; (li.querySelector('button:not(:disabled)') || li).focus() }
    } else if (pf.type === 'addKind') {
      pendingFocus.current = null
      document.getElementById('js-kind-name')?.focus()
    } else if (pf.type === 'newTemplate') {
      if (newBtnRef.current) { pendingFocus.current = null; newBtnRef.current.focus() }
    }
  })

  if (!on) return null

  const shownView = viewsOn ? view : 'live'
  const kinds = data?.kinds || []
  const ownKinds = kinds.filter((k) => !k.builtin)
  const offline = data?.fromCache === true
  const locked = busy || offline
  const offer = offerData?.offer
  const showOffer = Boolean(offer) && !offline && !offerDone && !offerApplied(userId) && !dismissed(prefs?.notebook_kind_mapping)

  /** Any action but Undo ends the Undo line ("kept until the next action or close"). */
  const run = async (fn, { keepUndo = false } = {}) => {
    setBusy(true); setProblem(''); setKindProblem(''); setStatus('')
    pendingFocus.current = null
    if (!keepUndo) setUndo(null)
    try { await fn() } catch (e) { setProblem(reportError(e)) } finally { setBusy(false) }
  }
  const finish = () => {
    setUndo(null); setStatus(''); setProblem(''); setKindProblem(''); setEditing(null); setConfirmDiscard(null); setConfirmKind(null)
    setAside(null); setAsideError('')
    starter.reset()
    onClose()
  }
  /** Closing over an editor with unsaved changes asks first, in the page (never window.confirm). */
  const close = () => guard(finish)
  /** Anything that would replace or close the editor asks first when it holds unsaved changes. */
  const guard = (then) => {
    if (editing && editorDirty) { setConfirmDiscard({ then }); return }
    then()
  }
  const closeEditor = () => {
    setEditing(null); setEditorDirty(false); setConfirmDiscard(null)     // a waiting discard question has nothing left to ask about
    pendingFocus.current = { type: 'opener' }
  }
  const discard = () => {
    const then = confirmDiscard?.then
    setConfirmDiscard(null); setEditorDirty(false)
    then?.()
  }

  const openEditor = (style, opener) => { setAside(null); openerRef.current = opener || null; openSeq.current += 1; setEditing({ style, seq: openSeq.current }) }
  const editStyle = (s, opener) => run(async () => {
    const out = await getJournalStyle(s.id)
    openEditor(out.style, opener)
  })
  const duplicate = (s, opener, { thenEdit = true } = {}) => run(async () => {
    const full = (await getJournalStyle(s.id)).style
    const body = { name: copyName(full.name), kindId: full.kindId, blocks: full.blocks || [], properties: full.properties || {} }
    if (full.outlineTemplateId) body.outlineTemplateId = full.outlineTemplateId
    if (full.outlineBodyJson) body.outlineBodyJson = full.outlineBodyJson
    // P3a-T10-R6: the server carries the original's community-library provenance to the copy.
    if (!full.builtin) body.duplicateOf = full.id
    const out = await createJournalStyle(body, { via: 'duplicate' })
    await mutate()
    if (viewsOn) refreshUsage()
    if (thenEdit) openEditor(out.style, opener); else setStatus('Template duplicated.')
  })
  const makeDefault = (s) => run(async () => {
    await setDefaultJournalStyle(s.id)
    await mutate()
    setStatus(`${s.name} is now the default.`)
  })
  const remove = (s) => run(async () => {
    await deleteJournalStyle(s.id)
    await mutate()
    if (viewsOn) refreshUsage()
    if (editing?.style?.id === s.id) { setEditing(null); setEditorDirty(false); setConfirmDiscard(null) }
    if (aside?.s?.id === s.id) setAside(null)
    pendingFocus.current = { type: 'undo' }            // the row that held focus is gone: Undo is the next stop
    setUndo({ id: s.id, name: s.name })
  })
  // Follow-up C: Archive (My tools' action, now in the one room). A template in notes asks first, with the sentence
  // that says its notes keep it (ArchivePanel, in the editor column); one in no note archives at once.
  const archiveNow = (s) => run(async () => {
    setAsideError('')
    const list = stylesOfKind(data, s.kindId)
    const at = list.findIndex((x) => x.id === s.id)
    const next = list[at + 1] || list[at - 1]
    const got = await archiveTemplate(s.id)
    if (!got.ok) {
      const text = actionFailure(got)
      if (aside?.kind === 'archive') setAsideError(text); else setProblem(text)
      return
    }
    if (editing?.style?.id === s.id) { setEditing(null); setEditorDirty(false); setConfirmDiscard(null) }
    setAside(null)
    await mutate()
    refreshUsage()
    pendingFocus.current = next ? { type: 'row', id: next.id } : { type: 'newTemplate' }
    setStatus(`Archived “${s.name}”. Restore it from Archived.`)
  })
  const askArchive = (s, opener) => guard(() => {
    if ((usedById.get(s.id) || 0) > 0) openAside('archive', s, opener)
    else archiveNow(s)
  })
  /** The editor column shows one panel at a time: the editor, or a row's "Used in" list or Archive question. */
  const openAside = (kind, s, opener) => {
    setEditing(null); setEditorDirty(false); setConfirmDiscard(null); setAsideError('')
    openerRef.current = opener || null
    setAside({ kind, s: { ...s, usedIn: usedById.get(s.id) || 0 } })
  }
  const closeAside = () => {
    setAside(null); setAsideError('')
    pendingFocus.current = { type: 'opener' }
  }
  /** Another view: the Undo line and any panel belong to the view left behind. */
  const showView = (v) => guard(() => {
    setEditing(null); setEditorDirty(false); setConfirmDiscard(null)
    setAside(null); setUndo(null); setStatus(''); setProblem('')
    setView(v)
  })
  const onTabsKey = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' }[e.key]
    if (step == null) return
    e.preventDefault()
    const at = VIEW_KEYS.indexOf(shownView)
    const to = step === 'first' ? 0 : step === 'last' ? VIEW_KEYS.length - 1 : (at + step + VIEW_KEYS.length) % VIEW_KEYS.length
    const asks = Boolean(editing && editorDirty)      // the discard question takes focus instead
    showView(VIEW_KEYS[to])
    if (!asks) tabRefs.current[VIEW_KEYS[to]]?.focus()
  }
  const restore = () => run(async () => {
    await restoreJournalStyle(undo.id)
    await mutate()
    if (viewsOn) refreshUsage()
    pendingFocus.current = { type: 'row', id: undo.id }
    setUndo(null)
    setStatus('Template restored.')
  }, { keepUndo: true })
  const saved = (s) => {
    setUndo(null); setProblem('')
    setStatus(`Saved ${s?.name || 'the template'}.`)
    closeEditor()
    mutate()
    if (viewsOn) refreshUsage()
  }

  const addKind = (e) => {
    e.preventDefault()
    if (!newKind.name.trim()) { setKindProblem('Give the note type a name.'); return }
    run(async () => {
      try {
        await createKind({ name: newKind.name.trim(), icon: newKind.icon })
      } catch (err) { setKindProblem(reportError(err)); return }
      setNewKind({ name: '', icon: 'document' })
      await mutate()
      setStatus('Note type added.')
    })
  }
  const saveRename = (e) => {
    e.preventDefault()
    run(async () => {
      try {
        await updateKind(renaming.id, { name: renaming.name.trim() })
      } catch (err) { setKindProblem(reportError(err)); return }
      setRenaming(null)
      await mutate()
      setStatus('Note type renamed.')
    })
  }
  const removeKind = (k) => run(async () => {
    setConfirmKind(null)
    const at = ownKinds.findIndex((x) => x.id === k.id)
    const next = ownKinds[at + 1] || ownKinds[at - 1]
    let out
    try { out = await deleteKind(k.id) } catch (err) { setKindProblem(reportError(err)); pendingFocus.current = { type: 'kindDelete', id: k.id }; return }       // the server's own sentence
    await mutate()
    pendingFocus.current = next ? { type: 'kindRow', id: next.id } : { type: 'addKind' }
    const n = out?.purgedDeletedStyles || 0
    setStatus(n ? `Note type deleted. ${plural(n, 'template you had deleted', 'templates you had deleted')} for it ${n === 1 ? 'was' : 'were'} removed for good.` : 'Note type deleted.')
  })

  const applyOffer = () => run(async () => {
    const ids = Array.from(blockedNoteIds || [])
    const asked = offer?.total ?? 0
    const out = await applyMappingOffer(ids)
    const count = out.count ?? (out.notes || []).length
    const skipped = out.skipped || []
    const lockedN = skipped.filter((s) => (s.reason ?? 'locked') === 'locked').length
    // Held back for unsent offline work: what the response says, and whatever it left unaccounted for
    // among the notes the offer counted (the excluded ids are never sent to the server's count).
    const unsent = skipped.length - lockedN + (ids.length ? Math.max(0, asked - count - skipped.length) : 0)
    setOfferDone(true)                                  // never ask again: the server still counts the notes it skipped
    markOfferApplied(userId)                            // ...and not on the next visit either (this tab remounts)
    globalMutate((k) => typeof k === 'string' && k.startsWith('/api/j2/notes'))
    setStatus(
      `Set the note type on ${plural(count, 'note', 'notes')}.`
      + (lockedN ? ` ${plural(lockedN, 'locked note', 'locked notes')} ${lockedN === 1 ? 'was' : 'were'} left as ${lockedN === 1 ? 'it was' : 'they were'}.` : '')
      + (unsent ? ` ${plural(unsent, 'note', 'notes')} with unsent changes ${unsent === 1 ? 'was' : 'were'} left for later.` : ''))
  })
  // A literal key, so usePreferences.additionsOnly can see which preference this writes (both the read and
  // the write are pinned by StylesManager.test.jsx's "Not now" case).
  const notNow = () => { setPref('notebook_kind_mapping', 'dismissed') }

  return (
    <Sheet open={open} onClose={close} title={<h2 ref={titleRef} style={{ margin: 0, font: 'inherit' }} data-tour="styles-manager">Manage templates</h2>}
      labelledByTitle variant="auto" maxWidth={960}>
      <div className={styles.wrap}>
        {open && libraryOn && inRouter && <LibraryUpdateParam onFound={setLinkedUpdate} />}
        <p className={styles.hint}>
          A template is how a note type starts: its outline, its blocks and the properties it fills. Changing a template never changes a note you already made unless you choose to update it.
        </p>

        {viewsOn && (
          <div role="tablist" aria-label="Show" className={styles.views} onKeyDown={onTabsKey}>
            {MANAGER_VIEWS.map(([k, label]) => (
              <button key={k} type="button" role="tab" id={`js-view-${k}`} aria-selected={shownView === k}
                aria-controls="js-view-panel" tabIndex={shownView === k ? 0 : -1}
                ref={(el) => { if (el) tabRefs.current[k] = el; else delete tabRefs.current[k] }}
                className={`${styles.viewTab} ${shownView === k ? styles.viewTabOn : ''}`} onClick={() => showView(k)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className={styles.viewPanel} id="js-view-panel" role={viewsOn ? 'tabpanel' : undefined}
          aria-labelledby={viewsOn ? `js-view-${shownView}` : undefined}>
        {shownView !== 'live' ? (
          <TemplateList filter={shownView} phone={phone} onCloseAll={finish}
            onChanged={() => { mutate(); refreshUsage() }} />
        ) : (
        <>
        <div className={styles.stickyTop} data-empty={undo || status || confirmDiscard ? undefined : 'true'}>
          <div role="status" aria-live="polite">
            {undo ? (
              <p className={styles.notice}>
                <span>{viewsOn ? `Deleted “${undo.name}”. Moved to Recently deleted.` : `Deleted “${undo.name}”.`}</span>
                <button type="button" ref={undoRef} className={styles.btn} onClick={restore} disabled={busy}>Undo</button>
              </p>
            ) : status ? <p className={styles.notice}>{status}</p> : null}
          </div>
          {confirmDiscard && (
            <section className={styles.notice} aria-label="Unsaved changes">
              <span>Discard your unsaved changes to this template?</span>
              <button type="button" ref={keepEditingRef} className={styles.btn}
                onClick={() => { setConfirmDiscard(null); document.getElementById('js-name')?.focus() }}>Keep editing</button>
              <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={discard}>Discard changes</button>
            </section>
          )}
        </div>
        {problem && <p role="alert" className={styles.error}>{problem}</p>}
        {offline && (
          <p className={styles.notice}>You are offline. These are the templates saved on this device. Making or changing a template needs a connection.</p>
        )}

        {showOffer && (
          <section className={styles.notice} aria-label="Set Note type from Research Type">
            <span>{`You have ${plural(offer.total, 'note', 'notes')} with a Research Type. Set their Note type to match?`}</span>
            <button type="button" className={styles.btn} onClick={applyOffer} disabled={locked}>Set note types</button>
            <button type="button" className={styles.btn} onClick={notNow}>Not now</button>
          </section>
        )}

        {isLoading && !data && <p className={styles.hint}>Loading your templates…</p>}
        {error && !data && (
          <p role="alert" className={styles.error}>
            {friendlyError(error)}{' '}
            <button type="button" className={styles.btn} onClick={() => mutate()}>Try again</button>
          </p>
        )}

        {data && (
          <div className={styles.layout}>
            <div className={styles.listCol} data-starter-offer={starter.settled ? 'settled' : 'deciding'}>
              {starter.show && <StarterPackOffer onClose={starter.close} offline={offline} />}
              <div className={styles.rowActions}>
                <button type="button" ref={newBtnRef} className={`${styles.btn}`} disabled={locked || !kinds.length} data-tour="styles-new"
                  onClick={(e) => { const opener = e.currentTarget; guard(() => { setUndo(null); openEditor(newDraftStyle(kinds[0]?.id), opener) }) }}>
                  <UIcon name="plus" size={14} gold={false} /> New template
                </button>
                {starter.on && (
                  <button type="button" className={`${styles.btn} ${styles.quiet}`} onClick={starter.open}>Starter packs</button>
                )}
                {libraryOn && <LibraryDoor label="Template library" className={styles.btn} />}
                {libraryOn && updates.length > 0 && (
                  <button type="button" className={styles.btn} aria-expanded={showUpdates} aria-controls="js-library-updates"
                    onClick={() => setShowUpdates((v) => !v)}>{`Updates (${updates.length})`}</button>
                )}
              </div>
              {libraryOn && showUpdates && updates.length > 0 && (
                <section id="js-library-updates" className={styles.kindGroup} aria-label="Updates from the Template library">
                  <ul className={styles.styleList}>
                    {updates.map((u) => (
                      <li key={u.styleId} className={styles.styleRow}>
                        <div className={styles.rowTop}>
                          <span className={styles.rowName}>{u.styleName}</span>
                          <span className={styles.version}>{`version ${u.fromVersion} to ${u.toVersion}`}</span>
                        </div>
                        <div className={styles.rowActions}>
                          <button type="button" className={styles.btn} disabled={locked} onClick={() => setUpdating(u.styleId)}
                            aria-label={`Review the update to ${u.styleName}`}>Review update</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* P5 tour anchor (Journal styles, step 3): the styles grouped by kind of note */}
              <div className={styles.kindGroups} data-tour="styles-kinds">
              {kinds.map((k) => {
                const list = stylesOfKind(data, k.id)
                return (
                  <section key={k.id} className={styles.kindGroup} aria-labelledby={`js-kind-${k.id}`}>
                    <h3 id={`js-kind-${k.id}`} className={styles.kindHead}>
                      <UIcon name={iconFor(k)} size={14} gold={false} />{k.name}
                    </h3>
                    {list.length === 0 ? <p className={styles.hint}>No templates for this note type yet.</p> : (
                      <ul className={styles.styleList}>
                        {list.map((s) => (
                          <li key={s.id} className={styles.styleRow} tabIndex={-1}
                            ref={(el) => { if (el) rowEls.current[s.id] = el; else delete rowEls.current[s.id] }}>
                            <div className={styles.rowTop}>
                              <span className={styles.rowName}>{s.name}</span>
                              {s.isDefault && <span className={styles.badge}>Default</span>}
                              <span className={styles.version}>{`v${s.version}`}</span>
                            </div>
                            {viewsOn && !s.builtin && usedById.has(s.id) && (
                              <div className={styles.rowMeta}>
                                {usedById.get(s.id) > 0 ? (
                                  <button type="button" className={styles.linkBtn}
                                    onClick={(e) => { const opener = e.currentTarget; guard(() => openAside('usedIn', s, opener)) }}
                                    aria-label={`${usedInText(usedById.get(s.id))}: list the notes made with ${s.name}`}>
                                    {usedInText(usedById.get(s.id))}
                                  </button>
                                ) : <span>{usedInText(0)}</span>}
                              </div>
                            )}
                            <div className={styles.rowActions}>
                              {s.builtin ? (
                                <button type="button" className={styles.btn} disabled={locked} onClick={(e) => { const opener = e.currentTarget; guard(() => duplicate(s, opener)) }}
                                  aria-label={`Duplicate ${s.name} to edit`}>Duplicate to edit</button>
                              ) : (
                                <button type="button" className={styles.btn} disabled={locked} onClick={(e) => { const opener = e.currentTarget; guard(() => editStyle(s, opener)) }}
                                  aria-label={`Edit ${s.name}`}>Edit</button>
                              )}
                              {!s.builtin && (
                                <button type="button" className={styles.btn} disabled={locked} onClick={(e) => duplicate(s, e.currentTarget, { thenEdit: false })}
                                  aria-label={`Duplicate ${s.name}`}>Duplicate</button>
                              )}
                              {libraryOn && !s.builtin && !s.sourceGalleryId && (
                                <button type="button" className={styles.btn} disabled={locked} onClick={() => setSharing(s)}
                                  aria-label={`Share ${s.name} to the Template library`}>Share to the Template library</button>
                              )}
                              {!s.isDefault && (
                                <button type="button" className={styles.btn} disabled={locked} onClick={() => makeDefault(s)}
                                  aria-label={`Set ${s.name} as default`}>Set as default</button>
                              )}
                              {viewsOn && !s.builtin && (
                                <button type="button" className={styles.btn} disabled={locked}
                                  onClick={(e) => askArchive(s, e.currentTarget)} aria-label={`Archive ${s.name}`}
                                  title={templateArchiveSentence(usedById.get(s.id) || 0)}
                                  aria-description={templateArchiveSentence(usedById.get(s.id) || 0)}>Archive</button>
                              )}
                              {!s.builtin && (
                                <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={locked} onClick={() => remove(s)}
                                  aria-label={`Delete ${s.name}`}>Delete</button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )
              })}
              </div>

              {/* Follow-up C: the member's plain templates ("Save as template" copies), below the per-note-type lists,
                  managed in this one room (MemberTemplates.jsx holds their rows and handlers, shared with the picker). */}
              <PlainTemplatesManage busy={locked}
                onUse={onUsePlain ? (t) => guard(() => { finish(); onUsePlain(t) }) : null}
                focusAsk={(show === 'plain' || show === 'daily') && plainServed !== showKey ? { target: show, n: showKey } : null}
                onLanded={() => setPlainServed(showKey)}
                classes={{ section: styles.kindGroup, head: styles.kindHead, lead: styles.hint }} />

              <section className={styles.kindGroup} aria-labelledby="js-own-kinds">
                <h3 id="js-own-kinds" className={styles.kindHead}>Your note types</h3>
                {ownKinds.length === 0 && <p className={styles.hint}>You have no note types of your own yet. Add one below.</p>}
                <ul className={styles.kindList}>
                  {ownKinds.map((k) => (
                    <li key={k.id} className={styles.kindRow} tabIndex={-1}
                      ref={(el) => { if (el) kindRowEls.current[k.id] = el; else delete kindRowEls.current[k.id] }}>
                      {renaming?.id === k.id ? (
                        <form className={styles.kindForm} onSubmit={saveRename} aria-label={`Rename ${k.name}`}>
                          <input type="text" aria-label={`New name for ${k.name}`} value={renaming.name} maxLength={MAX_KIND_NAME}
                            onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} />
                          <button type="submit" className={styles.btn} disabled={locked}>Save name</button>
                          <button type="button" className={styles.btn} onClick={() => setRenaming(null)}>Cancel</button>
                        </form>
                      ) : confirmKind === k.id ? (
                        <>
                          <p className={styles.hint}>{`Delete the note type ${k.name}? Templates you deleted that used it are removed permanently.`}</p>
                          <div className={styles.rowActions}>
                            <button type="button" ref={confirmYesRef} className={`${styles.btn} ${styles.danger}`} disabled={locked}
                              onClick={() => removeKind(k)}>{`Yes, delete note type ${k.name}`}</button>
                            <button type="button" className={styles.btn}
                              onClick={() => { pendingFocus.current = { type: 'kindDelete', id: k.id }; setConfirmKind(null) }}>{`Keep note type ${k.name}`}</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className={styles.rowTop}>
                            <UIcon name={iconFor(k)} size={14} gold={false} />
                            <span className={styles.rowName}>{k.name}</span>
                          </div>
                          <div className={styles.rowActions}>
                            <button type="button" className={styles.btn} disabled={locked} aria-label={`Rename ${k.name}`}
                              onClick={() => { setKindProblem(''); setRenaming({ id: k.id, name: k.name }) }}>Rename</button>
                            <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={locked}
                              ref={(el) => { if (el) kindDeleteBtns.current[k.id] = el; else delete kindDeleteBtns.current[k.id] }}
                              aria-label={`Delete note type ${k.name}`} onClick={() => { setKindProblem(''); setConfirmKind(k.id) }}>Delete</button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <form className={styles.kindForm} onSubmit={addKind} aria-label="Add a note type">
                  <div className={styles.field}>
                    <label htmlFor="js-kind-name">New note type name</label>
                    <input id="js-kind-name" type="text" value={newKind.name} maxLength={MAX_KIND_NAME}
                      onChange={(e) => setNewKind({ ...newKind, name: e.target.value })} />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="js-kind-icon">Icon</label>
                    <select id="js-kind-icon" value={newKind.icon} onChange={(e) => setNewKind({ ...newKind, icon: e.target.value })}>
                      {UICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <button type="submit" className={styles.btn} disabled={locked}>Add note type</button>
                </form>
                {kindProblem && <p role="alert" className={styles.error}>{kindProblem}</p>}
              </section>
            </div>

            <div className={styles.editorCol}>
              {editing ? (
                <>
                  <h3 className={styles.kindHead} tabIndex={-1} ref={editorHeadRef}>{editing.style.id ? 'Edit template' : 'New template'}</h3>
                  <StyleEditor key={editing.seq} style={editing.style} kinds={kinds} offline={offline}
                    onSaved={saved} onCancel={closeEditor} onDirtyChange={setEditorDirty} />
                </>
              ) : aside?.kind === 'usedIn' ? (
                <UsedInList d={aside.s} kind="template" onBack={closeAside} onNavigate={finish} backLabel={BACK_LABEL} />
              ) : aside?.kind === 'archive' ? (
                <ArchivePanel d={aside.s} onBack={closeAside} onArchive={archiveNow} busy={busy} error={asideError} />
              ) : (
                <p className={styles.hint}>Pick a template to edit, or make a new one.</p>
              )}
            </div>
          </div>
        )}
        </>
        )}
        </div>
        {sharing && (
          <ShareStyleForm style={sharing} onClose={() => setSharing(null)}
            onShared={(sentence) => { setSharing(null); setUndo(null); setProblem(''); setStatus(sentence) }} />
        )}
        {updating && (
          <LibraryUpdateSheet styleId={updating} onClose={() => setUpdating(null)}
            onApplied={(st) => {
              setUpdating(null); setUndo(null); setProblem('')
              pendingFocus.current = { type: 'row', id: st?.id || updating }
              const name = st?.name || 'your copy'
              setStatus(st?.sourceVersion ? `Updated ${name} to the author's version ${st.sourceVersion}.` : `Updated ${name}.`)
            }} />
        )}
      </div>
    </Sheet>
  )
}
