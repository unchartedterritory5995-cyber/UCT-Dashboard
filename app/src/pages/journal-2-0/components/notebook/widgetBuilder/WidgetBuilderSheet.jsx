import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import UIcon from '../../../../../components/ui/UIcon'
import { useHasCoarsePointer, useIsPhone } from '../../../../../hooks/useBreakpoint'
import { normalizeParams, paramsPlainText } from '../../../../../widgets/registry'
import {
  BUILT_KIND, DEFS_URL, FAILED_SENTENCE, FAILURE_COPY, builtRefreshParams, failureText, getJson, loadAccounts,
  loadCatalog, loadVocabulary, postJson, putJson, runBuilt, newIdempotencyKey, outcomeConfirmed,
} from '../../../lib/builtWidgets'
import { reducer, initState, blankPlan, nameOf, changeKind, DEFAULT_RANGE } from './builderState'
import {
  indexCatalog, defaultMeasuresFor, fitView, sourceOf, coverageByNeed, isRightNow, refKindOf, planRefs, kindsNamed, NAMES_FAILED,
  allAccountsOnly, rangeRefused,
} from './builderCatalog'
import {
  readDraft, writeDraft, clearOwnDraft, draftKey, newSession, settleDraft, trackSave, saveInFlight,
  pendingOf, slotHeldByOther, RESUME_OFFER,
} from './builderDraft'
import SourceSection from './sections/SourceSection'
import WhichOnesSection, { RangePicker, FieldPicker, FilterEditor } from './sections/WhichOnesSection'
import MeasureSection, { MeasurePicker } from './sections/MeasureSection'
import SplitSection, { SplitPicker } from './sections/SplitSection'
import RefPicker from './sections/RefPicker'
import ViewSection from './sections/ViewSection'
import NameSection from './sections/NameSection'
import FormulaSection from './sections/FormulaSection'
import {
  catalogFields, compiledOf, formulaProblems, withFormulaFields, withoutFormulaRefs, formulasOf, measureId,
} from './formulaFields'
import PreviewPane from './PreviewPane'
import ExamplesGallery from './ExamplesGallery'
import SaveQuestion, { UPDATE_ALL, SAVE_NEW, preselectAnswer } from './SaveQuestion'
import styles from './WidgetBuilderSheet.module.css'

/**
 * Notebook widgets phase 2 (wave 8, Task 8.15): the widget builder (spec 5.2, 5.9-5.11).
 *
 * ONE Sheet, sections top to bottom (What to look at · Which ones · What to measure · Split it by · Show it as ·
 * Name it) beside a live preview: on the right, 40% wide, from 641 px; a one-line sticky summary at 640 px and
 * narrower. Pickers PUSH IN PLACE inside the same sheet with a Back control, so there is only ever one sheet, one
 * focus trap and one swipe-to-dismiss. The sections stay mounted (hidden) under a picker, so Back returns focus to
 * the very control that opened it.
 *
 * Preview: `POST /preview` 400 ms after the last change; only the NEWEST answer is applied (a request counter), and
 * the last good result stays, dimmed, under any failure with that failure's own sentence. Save stays enabled in
 * every engine state: the widget is valid whether or not the preview could run.
 *
 * Save:
 *   * new: `POST ""`, then, opened from a note, the saved widget is run and inserted at the caret. The POST carries
 *     `Idempotency-Key` (rulings R-43, R-48): a fresh key per request, kept in the draft with that request, and reused
 *     only to send the SAME unconfirmed request again (a timeout, a reload), so it answers the widget it already made;
 *     edits made since are then saved to that widget. A `save_new` PUT is keyed the same way (R-49).
 *   * edit, in more than one note: SaveQuestion ("This widget is in 14 notes."). "Update all" PUTs `apply:
 *     update_all` and writes NO note; "Save as a new widget" PUTs `apply: save_new` and replaces only the source
 *     note's widget. In one note or none (ruling R-36): saved without asking (`update_all`), and when the builder was
 *     opened from that placed widget, the new version is run and replaces it, so the member sees their change.
 *   * a ready-made (`shelf:`) or adopted widget, or a placed widget whose saved widget is gone (a 404: deleted, or a
 *     note copied from another account): "Save as a copy" — a new widget that replaces the placed one in ONE
 *     transaction (one undo brings the original back), or is inserted at the caret from /build.
 *   * a refusal (a conflict, the count cap, offline) keeps everything and says why; a conflict also keeps the draft.
 *   * saved but not yet placed (the run failed): Save places it; edits made since are saved first (fix 1, I-2).
 *
 * Start (Task 8.16): opened with `start: 'examples'` for a NEW widget, the sheet first shows "Start from an example"
 * (ExamplesGallery: the ready-made widgets as cards, plus "Start blank"). Opening a card loads its plan into the builder
 * as a NEW widget (one that is saved, inserted at the caret from a note); "Back to examples" returns while nothing has
 * been edited. No preview runs and nothing saves while the gallery shows. Focus moves to the builder's first heading on
 * the way in and back to the card (or Start blank) on the way out. A kept draft is offered on the gallery itself.
 *
 * Your own fields (wave 10, Task 10.16): "Your own fields" sits under "What to measure" (FormulaSection). Its row
 * formulas join the source's fields for "Which ones" and "Split it by" (`withFormulaFields`), a formula measure is
 * named by its own name, and no preview runs while the formula twin refuses one of them (it has already said why,
 * without a request). The server's `formula` error, by formula id and position, and the preview's `probe` reach the
 * field they name. Save settles the boxes first. Escape closes an open autocomplete list before anything else.
 *
 * Escape goes back one picker level, then asks "Keep your changes?" only when something changed; a kept draft is
 * offered again ("Resume your unsaved widget") within 24 h, and a draft of a widget that changed since is saved
 * only as a new widget (fix 1, I-7). Saved work is never a draft: once a widget is saved (its placement still owed),
 * only the edits made SINCE count, and they are kept for THAT widget, so resuming them edits it and never saves a
 * second one (fix 4, NEW-1). A draft is stamped with the open that kept it, and a later open holds its resume offer
 * while that open's save is still out (fix 4, NEW-5). "Discard them" drops only the member's own changes (this open's
 * draft, or the one it resumed), never a draft that was offered and not chosen (8.16 N1). A held offer never reloads,
 * resumes over, or takes focus from a member at work in the sheet: edited, or focus moved from where it was at open
 * (8.15 M-1, M-2). Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes, at the top
 * level and outside a text field (a field keeps its own undo); Ctrl/Cmd+Enter saves, except while a filter is being
 * edited.
 *
 * ⛔ Member words: this file's copy never says "definition", "shelf", "built widget", "source", "plan" or "scope".
 */
export const PREVIEW_DEBOUNCE_MS = 400
/** After "Pausing the preview for a moment", the preview tries again on its own after this long. */
export const RATE_RETRY_MS = 10000
/** The soft keyboard is open when the visual viewport is under this share of the tallest height seen. */
export const KEYBOARD_RATIO = 0.75

export const KEEP_QUESTION = 'Keep your changes?'
/** M-2: "Keep my changes" would replace the unsaved widget another open kept (the member keeps one). */
export const KEEP_REPLACES = 'This replaces your other unsaved widget.'
export const KEEP_FAILED = "Couldn't keep your changes in this browser. Save them, or they are lost when you close."
export { RESUME_OFFER }
export const STALE_DRAFT = 'This widget changed since you left. Save your version as a new widget?'
export const SAVED_NOT_PLACED = 'Your widget is saved, but it could not be added to the note yet.'
export const OFFLINE_SAVE = "Offline. Your changes are kept here; save when you're back."
export const LOAD_FAILED = "Couldn't open the widget builder."
/** Spec 5.10, "Definition missing": the placed widget runs, and is edited, from the copy the note carries. */
export const SAVED_COPY_SENTENCE = 'Running from the saved copy in this note.'
/** Fix 2, R-39: saved, but the placed widget it was meant to replace is gone (or is another widget now). */
export const SAVED_NOT_IN_NOTE = 'Saved in My tools. It is no longer in this note.'
/** Task 8.16: from the builder back to "Start from an example", while nothing has been edited. */
export const BACK_TO_EXAMPLES = 'Back to examples'
/** Fix 1, I-2: Back is held only once the widget is saved and its place in the note is still owed. */
export const BACK_HELD_SAVED = 'Your widget is saved. Add it to the note, or close.'
/** Fix 1, m-6: said when a card opens in the builder. */
const openedText = (name) => `Opened ${name}.`
/** Consolidation (8.15 M-4): opened to resume a draft whose save was still out, and that save landed as a new widget.
 *  The member is told where their widget is, never handed a blank builder with nothing said. */
const savedInMyToolsText = (name) => (name ? `Saved in My tools as “${name}”.` : 'Saved in My tools.')
/** ...and the edits made after it went out were kept for that widget: they are offered from its own Edit. */
export const SAVED_EDITS_KEPT = 'Your later changes are kept with it. Open it from My tools to resume them.'

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
/** Edits that make a saved widget out of date: the plan and the name, as one value. */
const planKeyOf = (st) => draftKey(st.plan, st.nameTouched)

/** A text field, where Ctrl/Cmd+Z belongs to the field (fix 1, I-6). */
export function isTextControl(el) {
  if (!el || typeof el !== 'object') return false
  if (el.isContentEditable) return true
  // A contenteditable (the note itself) by its attribute too, where `isContentEditable` is not implemented.
  const ce = typeof el.closest === 'function' ? el.closest('[contenteditable]') : null
  if (ce && String(ce.getAttribute('contenteditable')).toLowerCase() !== 'false') return true
  const tag = String(el.tagName || '').toUpperCase()
  if (tag === 'TEXTAREA') return true
  if (tag !== 'INPUT') return false
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(String(el.type || 'text'))
}

/**
 * The visual viewport, for the soft keyboard (fix 1, I-3): `{keyboardOpen, height, inset}`.
 *
 * * A baseline is kept PER ORIENTATION: the tallest height seen in it. iOS keeps `innerHeight` and shrinks the
 *   visual viewport; Android with resizes-content shrinks BOTH, so comparing the two with each other (the old
 *   reading) never saw an Android keyboard. Against the baseline both read as open.
 * * `height` and `inset` (how far the visual viewport's bottom sits above the layout viewport's: the keyboard on
 *   iOS) become `--vvh` / `--vv-inset` on the panel, so the footer with Save stays above the keyboard.
 */
/** The DEVICE's orientation (fix 2): `screen.orientation`. Where that is missing, the orientation media query,
 *  which is VIEWPORT-based (it compares the viewport's width and height, so a resizes-content keyboard can flip it),
 *  and last the window's aspect. Only `screen.orientation` is immune to the keyboard. */
export function orientationOf() {
  const type = typeof screen !== 'undefined' ? screen.orientation?.type : null
  if (typeof type === 'string' && type) return type.startsWith('landscape') ? 'landscape' : 'portrait'
  try {
    if (typeof window.matchMedia === 'function') return window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait'
  } catch { /* no media queries */ }
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
}

/** The tallest the viewport can be in an orientation, from the screen. Used ONLY when a text field is focused as the
 *  builder opens (the keyboard can already be up then), never otherwise: a desktop or tablet window is routinely
 *  shorter than its screen, and a seed there would read a keyboard that does not exist (fix 3, I-2). And only where a
 *  soft keyboard can exist at all: a coarse pointer, or a visual viewport already shorter than the window (the iOS
 *  keyboard). A narrow desktop window opened from the note (a contenteditable) with a mouse is neither (fix 4, NEW-3). */
function screenSeed(orient) {
  const w = typeof screen !== 'undefined' ? Number(screen.width) || 0 : 0
  const h = typeof screen !== 'undefined' ? Number(screen.height) || 0 : 0
  if (!w || !h) return 0
  return orient === 'landscape' ? Math.min(w, h) : Math.max(w, h)
}

export function useViewport(coarse = false) {
  const [view, setView] = useState({ keyboardOpen: false, height: null, inset: 0 })
  const base = useRef({ portrait: 0, landscape: 0 })
  // Only the reading at open matters: the screen may seed the baseline on the first read alone.
  const coarseAtOpen = useRef(coarse)
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const vv = window.visualViewport || null
    // A text field focused as the builder opens, on a device that can have a soft keyboard: the only time the screen
    // may seed the baseline.
    let seedOnce = isTextControl(document.activeElement)
      && (!!coarseAtOpen.current || (!!vv && vv.height < (window.innerHeight || 0)))
    const read = () => {
      const h = vv ? vv.height : window.innerHeight
      const orient = orientationOf()
      const b = base.current
      b[orient] = Math.max(b[orient], seedOnce ? screenSeed(orient) : 0, window.innerHeight || 0, h || 0)
      seedOnce = false
      const inset = vv ? Math.max(0, Math.round(window.innerHeight - (vv.offsetTop || 0) - vv.height)) : 0
      // A soft keyboard is up only while a text field has focus: a short viewport alone is a short window.
      const keyboardOpen = isTextControl(document.activeElement) && !!b[orient] && h < KEYBOARD_RATIO * b[orient]
      setView((v) => (v.keyboardOpen === keyboardOpen && v.height === h && v.inset === inset ? v
        : { keyboardOpen, height: h, inset }))
    }
    read()
    vv?.addEventListener('resize', read)
    vv?.addEventListener('scroll', read)
    window.addEventListener('resize', read)
    document.addEventListener('focusin', read)
    document.addEventListener('focusout', read)
    return () => {
      vv?.removeEventListener('resize', read)
      vv?.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
      document.removeEventListener('focusin', read)
      document.removeEventListener('focusout', read)
    }
  }, [])
  return view
}

/** "about 3 hours ago" for the resume offer. */
function keptAgo(at, now = Date.now()) {
  const min = Math.max(0, Math.round((now - at) / 60000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const h = Math.round(min / 60)
  return `${h} hour${h === 1 ? '' : 's'} ago`
}

export default function WidgetBuilderSheet({ editor = null, from = null, start, uid, onClose, registerLeave, navigate = null }) {
  const phone = useIsPhone()
  const viewport = useViewport(useHasCoarsePointer())
  const keyboardOpen = phone && viewport.keyboardOpen
  const [phase, setPhase] = useState('loading')          // loading | ready | failed | tooNew
  const [loadCode, setLoadCode] = useState('')
  const [loadTick, setLoadTick] = useState(0)
  const [cat, setCat] = useState(null)
  const [accounts, setAccounts] = useState(() => new Map())
  // Wave 9 (Task 9.17): the member's routine and tracker names by id, for the chips that name one. Filled by
  // "Which routine" / "Which tracker" as they load, and read once per kind a plan already names (an opened widget).
  const [toolNames, setToolNames] = useState(() => ({}))
  // A failed read (`list === null`) records NAMES_FAILED (W9-R51), but never overwrites a list already read.
  const mergeToolNames = useCallback((kind, list) => {
    setToolNames((cur) => {
      if (list === null) return cur[kind] instanceof Map ? cur : { ...cur, [kind]: NAMES_FAILED }
      return { ...cur, [kind]: new Map(list.map((r) => [String(r.id), r.name])) }
    })
  }, [])
  const [target, setTarget] = useState({ mode: 'new', def: null, missing: false })
  const [tooNew, setTooNew] = useState('')
  const [state, rawDispatch] = useReducer(reducer, undefined, () => initState(blankPlan()))
  // Fix 3, minor 4: once saved-but-gone (R-39), the widget is saved and edits would go nowhere, so none are taken.
  const goneRef = useRef(false)
  const dispatch = useCallback((a) => { if (!goneRef.current) rawDispatch(a) }, [])
  const [level, setLevel] = useState({ kind: 'main' })
  const [offer, setOffer] = useState(null)
  const [stale, setStale] = useState(false)
  const [preview, setPreview] = useState({ payload: null, status: 'idle', error: null })
  const [retryTick, setRetryTick] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [answer, setAnswer] = useState(UPDATE_ALL)
  const [gone, setGone] = useState(false)       // R-39: saved, but the placed widget is no longer in the note
  const staleEtag = useRef(null)                // N-2: a stale draft keeps the etag it was kept at
  const rootRef = useRef(null)
  const opener = useRef(null)
  const offerRef = useRef(null)
  const seq = useRef(0)
  const mounted = useRef(true)
  const savedRef = useRef(null)       // a widget saved whose place in the note is still owed
  const stateRef = useRef(state)
  stateRef.current = state
  // Fix 4, NEW-5: this open's token, stamped on the draft it keeps and on the saves it sends.
  const session = useRef(null)
  if (session.current === null) session.current = newSession()
  // Consolidation (8.16 N1): the session of the draft this open RESUMED (undefined: none). That draft is the member's
  // own choice, so "Discard them" may drop it; a draft merely offered, and never chosen, is not theirs to drop.
  const resumedFrom = useRef(undefined)
  // Consolidation (8.15 M-2): what had focus when the builder became ready. Focus anywhere else in the sheet means the
  // member is at work there (a half-typed date, the top-N box, arrowing a radio group), dirty or not.
  const openFocus = useRef(null)
  const [notice, setNotice] = useState('')     // M-4: "Saved in My tools as ..." after a held save landed
  // Rulings R-43, R-48, R-49: the open's one UNCONFIRMED save that makes a widget (the create POST or a `save_new`
  // PUT): `{key, kind, body, planKey, defId, etag}`. Its Idempotency-Key is fresh for every new request and is reused
  // only to send that SAME request again (a retry after a timeout; the draft resumed after a reload), so the server
  // answers the widget it may already have made. Cleared as soon as an answer confirms the outcome (it landed, or the
  // server refused it), and whenever the builder starts a new widget (a card, Start blank, back to the examples).
  const pendingSave = useRef(null)
  const leftRef = useRef(false)       // the member left (R-38): the builder is going, whatever a save answers later
  const saveBtnRef = useRef(null)
  const away = () => !mounted.current || leftRef.current
  // Task 8.16: the start screen. 'examples' only for a NEW widget opened with `start: 'examples'`.
  const [screen, setScreen] = useState(() => (start === 'examples' && !from?.defId && !from?.shelfId ? 'examples' : 'builder'))
  const onGallery = screen === 'examples'
  const [fromGallery, setFromGallery] = useState(false)
  const galleryOpener = useRef(null)    // the card (or Start blank) that opened the builder: focus returns to it
  const blankRef = useRef(null)         // the plan "Start blank" starts from
  const screenSeen = useRef(screen)
  const backHeldId = useId()
  const [opened, setOpened] = useState('')      // "Opened Win rate." (fix 1, m-6), read out on the way in
  const clearSearchRef = useRef(null)           // the gallery's "Escape clears a non-empty search" (fix 1, m-4)
  // Task 10.16: "Your own fields". The section closes its autocomplete list on Escape (`formulaEscRef`) and settles its
  // boxes before a save (`formulaFlushRef`); the preview's `probe` and the server's `formula` errors reach it here.
  const formulaEscRef = useRef(null)
  const formulaFlushRef = useRef(null)
  const [formulaFeedback, setFormulaFeedback] = useState(() => ({ probes: new Map(), errors: new Map() }))
  const [flushSave, setFlushSave] = useState(null)

  useEffect(() => () => { mounted.current = false }, [])

  const rawId = from?.defId || from?.shelfId || null
  const defId = typeof rawId === 'string' && rawId ? rawId : null
  const shelfId = defId && defId.startsWith('shelf:') ? defId : null
  const getPos = typeof from?.getPos === 'function' ? from.getPos : null
  const draftTarget = defId
  const noteId = editor?.storage?.uctJournalWidgets?.noteId || null
  const canWriteNote = !!editor && !editor.isDestroyed && editor.isEditable !== false

  /** The placed widget this builder was opened from, if it is still where it was and still that widget. */
  const placedNode = () => {
    if (!getPos || !editor?.state?.doc) return null
    try {
      const pos = getPos()
      const node = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null
      if (!node || node.type?.name !== 'widgetEmbed' || node.attrs?.widgetId !== BUILT_KIND) return null
      if (defId && node.attrs?.params?.defId !== defId) return null
      return { pos, node }
    } catch {
      return null      // the node view was destroyed (getPos throws): nothing to replace
    }
  }

  // ── open: the catalog, the member's accounts, and the widget being edited (if any) ──────────────
  useEffect(() => {
    let alive = true
    setPhase('loading')
    ;(async () => {
      try {
        const [raw, accs] = await Promise.all([loadCatalog(), loadAccounts().catch(() => [])])
        const c = indexCatalog(raw)
        let mode = 'new'
        let def = null
        let missing = false
        let plan
        if (shelfId) {
          const got = await getJson(`${DEFS_URL}/shelf`)
          if (!got.ok) throw Object.assign(new Error(got.code), { code: got.code })
          const ex = (Array.isArray(got.data.examples) ? got.data.examples : []).find((e) => isRecord(e) && e.id === shelfId)
          if (!ex || !isRecord(ex.plan)) throw Object.assign(new Error('missing'), { code: 'unavailable' })
          mode = 'copy'
          plan = ex.plan
        } else if (defId) {
          const got = await getJson(`${DEFS_URL}/${encodeURIComponent(defId)}`)
          if (!got.ok) {
            // Fix 1, I-10: the saved widget is gone (deleted, or the note came from another account), but the
            // placed widget carries its plan: edit that, and save it as the member's own copy.
            const frozen = got.code === 'unavailable' ? placedNode()?.node.attrs.params.def : null
            if (!isRecord(frozen)) throw Object.assign(new Error(got.code), { code: got.code })
            mode = 'copy'
            missing = true
            plan = frozen
          } else if (got.data.tooNew) {
            if (!alive) return
            setTooNew(typeof got.data.summary === 'string' ? got.data.summary : '')
            setPhase('tooNew')
            return
          } else {
            def = got.data
            plan = got.data.plan
            mode = got.data.sourceGalleryId ? 'copy' : 'edit'
          }
        } else {
          plan = { ...blankPlan(), measures: defaultMeasuresFor(c, 'closed_trades').map((k) => ({ key: k })) }
          blankRef.current = plan
        }
        if (!alive) return
        setCat(c)
        setAccounts(new Map((accs || []).map((a) => [a.id, a.name])))
        setTarget({ mode, def, missing })
        dispatch({ type: 'loadPlan', plan, autoName: '' })
        const kept = readDraft(uid, draftTarget)
        const pending = kept ? saveInFlight(kept.session) : null
        if (pending) holdOffer(pending, def)
        else if (kept && start === 'resume') resumeDraft(kept, def)
        else if (kept) setOffer(kept)
        setPhase('ready')
      } catch (e) {
        if (!alive) return
        setLoadCode(typeof e?.code === 'string' ? e.code : 'failed')
        setPhase('failed')
      }
    })()
    return () => { alive = false }
  }, [loadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Fix 4, NEW-5 (the choice: HOLD the offer, never label it). The draft was kept by an earlier open whose save is
   *  still out: offering it now could save the same widget twice. Wait for that save, then offer what is left: no
   *  draft once it landed (or one retargeted to the widget it saved), the draft itself if it failed. When it landed
   *  on the widget this builder opened, the builder reopens, so it edits the newer version. */
  function holdOffer(pending, def, auto = start === 'resume') {
    pending.then((res) => {
      if (away()) return
      const landed = !!res?.landed
      // Consolidation (8.15 M-1, M-2): "clean" is not just "nothing dispatched". A member at work in the sheet (focus
      // moved inside it) keeps what they have: no reload under them, and no draft resumed over them.
      const clean = !typing()
      if (landed && def && clean) { setLoadTick((n) => n + 1); return }
      const again = readDraft(uid, draftTarget)
      if (!again) {
        // M-4: asked to resume, and the held save landed as a NEW widget: say where it is (and where its later edits
        // went, when they were kept for it), rather than a blank builder that says nothing.
        if (landed && !def && auto && res.id) {
          const kept = readDraft(uid, res.id)
          setNotice(kept ? `${savedInMyToolsText(res.name)} ${SAVED_EDITS_KEPT}` : savedInMyToolsText(res.name))
        }
        return
      }
      if (auto && clean) resumeDraft(again, def)
      else setOffer(again)
    })
  }

  /** The kept draft offered again (after "Keep my changes" or "Discard them" on the way back to the examples): held,
   *  exactly as at open, while the open that kept it still has a save out (NEW-5); never resumed on its own. */
  function reoffer() {
    const kept = readDraft(uid, draftTarget)
    const pending = kept ? saveInFlight(kept.session) : null
    if (pending) {
      setOffer(null)
      holdOffer(pending, target.def, false)
      return
    }
    setOffer(kept)
  }

  /** The member is at work in the sheet: something is edited, or focus has moved inside the sheet from where it was
   *  when the builder became ready (8.15 M-2: a half-entered date, the top-N box, arrowing a radio group, none of which
   *  is dispatched yet). The sheet's own panel, which the Sheet focuses on open, is not work. */
  function typing() {
    if (stateRef.current.dirty) return true
    const a = typeof document !== 'undefined' ? document.activeElement : null
    const panel = rootRef.current?.closest('[data-sheet-panel]') || rootRef.current
    if (!a || !panel || a === panel || !panel.contains(a)) return false
    return a !== openFocus.current
  }

  /** Resume a kept draft. A draft of a widget that has been saved since (its etag moved) is never saved over the
   *  newer version: it can only become a new widget (fix 1, I-7). */
  function resumeDraft(kept, def = target.def) {
    resumedFrom.current = typeof kept.session === 'string' && kept.session ? kept.session : null
    // R-48: a resumed draft brings back its OWN unconfirmed request (or none): never another widget's.
    pendingSave.current = pendingOf(kept.pending)
    dispatch({ type: 'loadPlan', plan: kept.plan, keepBase: true })
    const was = Number.isInteger(kept.etag) ? kept.etag : null
    const isStale = !!def && was !== null && Number.isInteger(def.etag) && def.etag !== was
    staleEtag.current = isStale ? was : null
    setStale(isStale)
  }

  // M-2: where focus was when the builder became ready. Declared BEFORE the offer's focus effect, so an offer shown
  // at open (which takes focus next) is not mistaken for the member's own move.
  useEffect(() => {
    if (phase === 'ready') openFocus.current = typeof document !== 'undefined' ? document.activeElement : null
  }, [phase])

  // The resume offer takes focus when it appears, so it is read out (fix 1: "announce and focus"); an offer held
  // back (NEW-5) never takes it from a member who has started editing, or who is at work in the sheet (M-2).
  useEffect(() => {
    if (phase === 'ready' && offer && !typing()) offerRef.current?.focus()
  }, [phase, offer])

  // Fix 4, NEW-2: saved but gone, the sections are inert, so focus goes to the one thing left to do: Close.
  useEffect(() => {
    if (gone) saveBtnRef.current?.focus()
  }, [gone])

  // ── the live preview ──────────────────────────────────────────────────────────────────────────
  // The name and subtitle do not change what is counted, so typing them never re-runs the preview.
  const previewKey = useMemo(() => {
    const p = state.plan
    return JSON.stringify({ ...p, display: { ...p.display, title: '', titleAuto: true, subtitle: '' } })
  }, [state.plan])

  // Task 10.16: the formulas compiled against the source's fields (the twin), the catalog the sections read (the
  // source's fields plus the plan's row formulas), and whether the twin refuses one (then no preview is asked for).
  const formulaKey = JSON.stringify(state.plan.formulas || [])
  const formulaFields = useMemo(() => (cat ? catalogFields(cat, state.plan) : new Map()),
    [cat, state.plan.source]) // eslint-disable-line react-hooks/exhaustive-deps
  const compiled = useMemo(() => (cat ? compiledOf(cat, state.plan) : new Map()),
    [cat, state.plan.source, formulaKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const viewCat = useMemo(() => (cat ? withFormulaFields(cat, state.plan, compiled) : cat),
    [cat, state.plan.source, compiled]) // eslint-disable-line react-hooks/exhaustive-deps
  const previewBlocked = !!cat && formulaProblems(cat, state.plan, compiled).size > 0

  /** The server's `formula` refusal, on the field it names, with the text it was sent (its `pos` counts into that). */
  const formulaRefused = (got, plan) => {
    if (got?.code !== 'formula' || typeof got.formulaId !== 'string') return
    const sent = formulasOf(plan).find((f) => f.id === got.formulaId)
    if (!sent) return
    setFormulaFeedback((fb) => ({
      probes: fb.probes,
      errors: new Map([[got.formulaId, { sentence: got.message, pos: got.pos, sent: sent.expr }]]),
    }))
  }

  const runPreview = useCallback(async () => {
    seq.current += 1
    const n = seq.current
    const plan = stateRef.current.plan
    setPreview((p) => ({ ...p, status: 'loading' }))
    const got = await postJson('/preview', { plan, settings: {} })
    // Only the newest request's answer is applied: an older one arriving later is dropped.
    if (!mounted.current || n !== seq.current) return
    if (got.ok) {
      setPreview({ payload: got.data, status: 'ok', error: null })
      // Each formula's first-row line, kept with the text it was run for (a changed box waits for the next preview).
      const sent = new Map(formulasOf(plan).map((f) => [f.id, f.expr]))
      const probes = new Map()
      for (const p of Array.isArray(got.data.probe) ? got.data.probe : []) {
        if (p && typeof p.id === 'string' && sent.has(p.id)) probes.set(p.id, { probe: p, sentExpr: sent.get(p.id) })
      }
      setFormulaFeedback({ probes, errors: new Map() })
      if (typeof got.data.defaultName === 'string') dispatch({ type: 'followName', name: got.data.defaultName })
      return
    }
    // A newer preview replaced this one on the server: say nothing; the newer one answers.
    if (got.code === 'superseded') {
      setPreview((p) => ({ ...p, status: p.payload ? 'ok' : 'idle' }))
      return
    }
    setPreview((p) => ({ ...p, status: 'error', error: { code: got.code, message: got.message } }))
    formulaRefused(got, plan)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Task 8.16: no preview runs while the start screen shows (the cards carry their own results).
    if (phase !== 'ready' || onGallery) return undefined
    // Task 10.16: a formula the twin refuses has its sentence already; asking the server would be a request for it.
    if (previewBlocked) return undefined
    const t = setTimeout(runPreview, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [phase, previewKey, retryTick, runPreview, onGallery, previewBlocked])

  // "Pausing the preview for a moment" resumes on its own; offline resumes when the browser is back.
  const errCode = preview.status === 'error' ? preview.error?.code : null
  useEffect(() => {
    if (errCode !== 'rate_preview') return undefined
    const t = setTimeout(() => setRetryTick((n) => n + 1), RATE_RETRY_MS)
    return () => clearTimeout(t)
  }, [errCode])
  useEffect(() => {
    const back = () => setRetryTick((n) => n + 1)
    window.addEventListener('online', back)
    return () => window.removeEventListener('online', back)
  }, [])

  // The keyboard-aware height (fix 1, I-3b): the panel is sized from the visual viewport, never under the keyboard.
  useEffect(() => {
    const panel = rootRef.current?.closest('[data-sheet-panel]')
    if (!panel) return
    if (typeof viewport.height === 'number' && viewport.height > 0) panel.style.setProperty('--vvh', `${Math.round(viewport.height)}px`)
    panel.style.setProperty('--vv-inset', `${viewport.inset || 0}px`)
  }, [viewport.height, viewport.inset, phase])

  // ── levels (pickers push in place) and focus ──────────────────────────────────────────────────
  const push = (next, el) => {
    opener.current = el || (typeof document !== 'undefined' ? document.activeElement : null)
    setLevel(next)
  }
  const back = useCallback(() => setLevel({ kind: 'main' }), [])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (level.kind === 'main') {
      const el = opener.current
      opener.current = null
      if (el && el.isConnected && root.contains(el)) el.focus()
      return
    }
    const head = root.querySelector('[data-builder-level] [data-picker-heading]')
      || root.querySelector('[data-builder-level] button, [data-builder-level] input')
    head?.focus()
  }, [level])

  // ── the start screen (Task 8.16) ───────────────────────────────────────────────────────────────
  // Focus follows the screen, before paint: into the builder, its first section's heading; back out, the card that
  // opened the builder, else the gallery's heading. (A draft just kept is offered, and the offer's own effect above
  // focuses its Resume after this one, once.)
  useLayoutEffect(() => {
    if (screenSeen.current === screen) return
    screenSeen.current = screen
    const root = rootRef.current
    if (!root) return
    if (screen === 'builder') root.querySelector('[data-builder-section] [data-builder-heading]')?.focus()
    else {
      const el = galleryOpener.current
      if (el && el.isConnected && root.contains(el)) el.focus()
      else root.querySelector('[data-gallery-heading]')?.focus()
    }
    // M-2: the builder put focus here, not the member, so this is where "at work" is measured from on this screen.
    openFocus.current = document.activeElement
  }, [screen])
  const galleryRef = useRef(null)
  galleryRef.current = {
    open: (ex, el) => {
      galleryOpener.current = el || null
      // A ready-made widget as the start of a NEW one: its plan, history empty, nothing edited yet.
      dispatch({ type: 'loadPlan', plan: ex.plan, autoName: typeof ex.name === 'string' ? ex.name : '' })
      setOpened(typeof ex.name === 'string' && ex.name ? openedText(ex.name) : '')
      setFromGallery(true)
      setScreen('builder')
    },
    blank: (el) => {
      galleryOpener.current = el || null
      if (blankRef.current) dispatch({ type: 'loadPlan', plan: blankRef.current, autoName: '' })
      setOpened('')
      setFromGallery(true)
      setScreen('builder')
    },
    resume: () => {
      const kept = offer
      if (!kept) return
      galleryOpener.current = null
      resumeDraft(kept)
      setOffer(null)
      setOpened('')
      setFromGallery(true)
      setScreen('builder')
    },
    fresh: () => {
      // M-3: the draft that was OFFERED goes, never one another tab kept since in the same slot.
      if (offer) clearOwnDraft(uid, [offer.session || null])
      setOffer(null)
      rootRef.current?.querySelector('[data-gallery-heading]')?.focus()
    },
    link: (to, e) => {
      // A modified click (a new tab) is the browser's. Otherwise the builder closes and the app goes there: through
      // the router's navigate when the door was given one (fix 1, R-45), else the anchor follows its own href.
      if (e && (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return
      if (typeof navigate === 'function') {
        e?.preventDefault()
        close()
        navigate(to)
        return
      }
      close()
    },
  }
  // Stable for the (memoized) gallery: it never re-renders because the builder did.
  const galleryProps = useMemo(() => ({
    onOpen: (ex, el) => galleryRef.current.open(ex, el),
    onBlank: (el) => galleryRef.current.blank(el),
    onResume: () => galleryRef.current.resume(),
    onFresh: () => galleryRef.current.fresh(),
    onLink: (to, e) => galleryRef.current.link(to, e),
  }), [])
  const galleryResume = useMemo(() => (offer ? { text: RESUME_OFFER, kept: `Kept ${keptAgo(offer.at)}.` } : null), [offer])
  // Fix 1, I-2: held only once a widget is saved (its place is still owed, or it is gone): there is nothing to go back
  // to then. Edits are never a dead end: Back asks "Keep your changes?" (keep -> the gallery offers Resume).
  const backOwed = !!savedRef.current && !gone
  const backHeld = gone || !!savedRef.current
  /** To the gallery, clean: the builder starts over from the blank plan, so a later close asks nothing. */
  const toGallery = () => {
    opener.current = null
    // R-48: back to the examples, whatever starts next (a card, Start blank) is a NEW widget and a new request: nothing
    // an earlier start sent may answer for it. (The gallery is reached only here or at open, so this is the one guard.)
    pendingSave.current = null
    setLevel({ kind: 'main' })
    if (blankRef.current) dispatch({ type: 'loadPlan', plan: blankRef.current, autoName: '' })
    setOpened('')
    setScreen('examples')
  }
  const backToExamples = (el) => {
    if (backHeld) return
    if (stateRef.current.dirty) { push({ kind: 'ask', to: 'gallery' }, el || null); return }
    toGallery()
  }

  // ── closing, and the kept draft ───────────────────────────────────────────────────────────────
  const close = useCallback((focusTo) => { onClose?.(focusTo) }, [onClose])
  /** Edits that are not saved: since the save, once a widget is saved with its placement owed (fix 4, NEW-1);
   *  else since the builder opened. Saved but gone (R-39) takes no edits, so it has none. */
  const unsaved = () => {
    if (phase !== 'ready' || gone) return false
    const s = savedRef.current
    return s ? planKeyOf(stateRef.current) !== s.planKey : !!stateRef.current.dirty
  }
  const requestClose = () => {
    if (saving) return
    if (unsaved()) {
      // 8.16 N2: X or the backdrop while "Back to examples" asks: the member now wants to CLOSE, so the question
      // becomes the closing one, whose "Keep my changes" closes the sheet (never a trip back to the gallery).
      if (level.kind === 'ask' && level.to) setLevel({ kind: 'ask' })
      else if (level.kind !== 'ask') push({ kind: 'ask' }, null)
      return
    }
    close()
  }
  const keepDraft = () => {
    const st = stateRef.current
    const s = savedRef.current
    // Fix 4, NEW-1: after a save whose placement is owed, the edits since belong to THAT widget: the draft targets it,
    // with its etag, so resuming it edits that widget (a PUT) and never saves a second one.
    // N-2: a stale draft keeps the etag it was KEPT at, so it stays stale (and save-as-new only) when resumed again.
    const to = s ? s.defId : draftTarget
    const etag = s ? s.etag : staleEtag.current !== null ? staleEtag.current : target.def?.etag
    return writeDraft(uid, {
      plan: st.plan, nameTouched: st.nameTouched, target: to, etag, session: session.current,
      pending: s ? null : pendingSave.current,
    })
  }
  /** "Discard them" (8.16 N1), and every finish (ruling R-47): only the member's OWN changes go: a draft this open kept
   *  (its session) or the one it resumed. A draft another open kept, offered and never chosen, stays and is offered
   *  again. */
  const ownSessions = () => {
    const own = new Set([session.current])
    if (resumedFrom.current !== undefined) own.add(resumedFrom.current)
    return own
  }
  const dropOwnDrafts = () => clearOwnDraft(uid, ownSessions())
  // R-38: leaving without closing (browser navigation, the note's editor destroyed) keeps unsaved edits as a draft,
  // offered again on the next open. The door asks through `registerLeave`; a clean builder writes nothing.
  const leaveRef = useRef(null)
  leaveRef.current = () => {
    leftRef.current = true
    // Fix 3, I-1: a widget already saved (its placement owed) is not a draft; keeping it would save it twice. Fix 4,
    // NEW-1: but the edits made since that save are, kept for that widget (also while they are being saved: a save
    // that then fails leaves them kept).
    if (unsaved()) keepDraft()
  }
  useEffect(() => {
    if (typeof registerLeave === 'function') registerLeave(() => leaveRef.current?.())
  }, [registerLeave])

  // ── names for the routines or trackers a plan already names (an opened widget, a Routine filter) ────
  const neededKinds = cat
    ? kindsNamed(cat, state.plan).filter((k) => toolNames[k] === undefined).join(',') : ''
  useEffect(() => {
    if (!neededKinds) return undefined
    let alive = true
    for (const kind of neededKinds.split(',')) {
      loadVocabulary(kind).then(
        (values) => {
          if (!alive) return
          const list = (Array.isArray(values) ? values : []).filter((v) => v && typeof v === 'object' && v.id != null)
            .map((v) => ({ id: String(v.id), name: typeof v.name === 'string' && v.name ? v.name : String(v.id) }))
          mergeToolNames(kind, list)
        },
        () => { if (alive) mergeToolNames(kind, null) },     // the chips say the list couldn't be loaded
      )
    }
    return () => { alive = false }
  }, [neededKinds, mergeToolNames])

  // ── edits: each change carries the view it forces, so the change and its view are ONE undo step ──
  const fitted = (patch) => fitView(cat, { ...stateRef.current.plan, ...patch })
  const edit = (action, patch) => {
    const next = fitted(patch)
    dispatch({ ...action, view: next.view, compare: next.compare })
  }
  const onSource = (key) => {
    if (key === state.plan.source) return
    const measures = defaultMeasuresFor(cat, key)
    // Wave 9/10: what the new source refuses, as the catalog serves it (`allAccountsOnly`, `refusedRanges`): a
    // routine or tracker source covers every account, and a source that counts days or notes takes no "last N
    // trades" range, so the plan starts from all accounts and the default range: in the same undo step as the source.
    const reset = {
      ...(allAccountsOnly(cat, key) ? { accounts: 'all' } : {}),
      ...(rangeRefused(cat, key, state.plan.range) ? { range: { ...DEFAULT_RANGE } } : {}),
    }
    edit({ type: 'setSource', source: key, measures, ...reset },
      { source: key, measures: measures.map((k) => ({ key: k })), filters: [], split: null, sort: null, compare: null,
        view: { type: 'number', auto: true }, ...reset })
  }
  const onRange = (range) => {
    edit({ type: 'setRange', range }, { range })
    back()
  }
  /** A measure in or out: a catalog one (`{key}`) or one of the member's own fields (`{formula, agg?}`). */
  const toggleMeasure = (m) => {
    const cur = state.plan.measures
    const id = measureId(m)
    let measures
    if (cur.some((x) => measureId(x) === id)) {
      if (cur.length <= 1) return
      measures = cur.filter((x) => measureId(x) !== id)
    } else {
      if (cur.length >= cat.maxMeasures) return
      measures = [...cur, m]
    }
    const s = state.plan.sort
    const sort = s && s.measure >= measures.length ? { ...s, measure: 0 } : s
    const next = fitted({ measures, sort })
    dispatch({ type: 'setMeasures', measures, sort, view: next.view, compare: next.compare })
  }
  const onToggleMeasure = (key) => toggleMeasure({ key })
  const onRemoveMeasure = (i) => { const m = state.plan.measures[i]; if (m) toggleMeasure(m) }
  // ── your own fields (Task 10.16) ──
  const formulasHeading = () => rootRef.current?.querySelector('[data-builder-section="formulas"] [data-builder-heading]') || null
  const onFormulaAdd = (format) => dispatch({ type: 'formula/add', formula: { name: '', expr: '', format } })
  const onFormulaEdit = (id, patch) => dispatch({ type: 'formula/edit', id, patch })
  const onFormulaRemove = (id) => {
    const p = stateRef.current.plan
    const refs = withoutFormulaRefs(p, id)
    // The widget measured only this field: it falls back to what a new widget starts with, in the same step.
    const fallback = refs.measures.length ? undefined : defaultMeasuresFor(cat, p.source)
    const measures = refs.measures.length ? refs.measures : fallback.map((k) => ({ key: k }))
    const next = fitted({ ...refs, measures, sort: refs.split ? p.sort : null })
    dispatch({ type: 'formula/remove', id, measures: fallback, view: next.view, compare: next.compare })
    // The field and its Remove are gone: focus goes to the section's own heading.
    formulasHeading()?.focus()
  }
  const onFormulaSplit = (key) => {
    if (state.plan.split?.by === key) onClearSplit('by')
    else onSplit('by', key)
  }
  const onFormulaFilter = (key, el) => push({ kind: 'filter', field: key }, el)
  const onSplit = (slot, key, ref = null) => {
    const cur = state.plan.split
    let split
    if (slot === 'by') {
      const keepThen = !!cur?.then && cur.then !== key
      split = key ? {
        by: key, then: keepThen ? cur.then : null,
        ...(ref ? { ref } : {}), ...(keepThen && cur.ref2 ? { ref2: cur.ref2 } : {}),
      } : null
    } else if (cur) {
      // `ref` names the routine or tracker of `by`, `ref2` the one of `then` (be Task 9.8).
      const rest = { ...cur }
      delete rest.ref2
      split = { ...rest, then: key, ...(key && ref ? { ref2: ref } : {}) }
    } else split = null
    const sort = split ? state.plan.sort : null
    const next = fitted({ split, sort })
    dispatch({ type: 'setSplit', split, sort, view: next.view, compare: next.compare })
    back()
  }
  const onClearSplit = (slot) => {
    const cur = state.plan.split
    let split = null
    if (slot !== 'by' && cur) {
      split = { ...cur, then: null }
      delete split.ref2
    }
    const sort = split ? state.plan.sort : null
    const next = fitted({ split, sort })
    dispatch({ type: 'setSplit', split, sort, view: next.view, compare: next.compare })
  }
  const onView = (type) => {
    const next = fitView(cat, { ...state.plan, view: { type, auto: false } })
    dispatch({ type: 'setView', view: next.view, compare: next.compare })
  }
  const onCompare = (compare) => dispatch({ type: 'setView', view: state.plan.view, compare })
  const onDisplay = (patch) => {
    const display = { ...state.plan.display, ...patch }
    const next = fitted({ display })
    dispatch({ type: 'setDisplay', display: patch, view: next.view, compare: next.compare })
  }
  const onApplyFilter = (filter) => {
    if (level.kind === 'filter' && Number.isInteger(level.index)) dispatch({ type: 'editFilter', index: level.index, filter })
    else dispatch({ type: 'addFilter', filter })
    back()
  }
  const whichHeading = () => rootRef.current?.querySelector('[data-builder-section="which"] [data-builder-heading]') || null
  const onRemoveFilterAt = (i) => {
    dispatch({ type: 'removeFilter', index: i })
    // The chip and its remove button are gone: focus goes to the section's own heading.
    whichHeading()?.focus()
  }

  // ── save ───────────────────────────────────────────────────────────────────────────────────────
  /** Every save is recorded as this open's save in flight, so a later open can wait for it (NEW-5). */
  const sent = (promise) => trackSave(session.current, promise)
  /** A save landed: the draft it made redundant goes. Saved work is never a draft, even when the builder closed
   *  while the save was out (fix 3, I-1). Once the builder has gone, only THIS open's draft is settled, and edits it
   *  holds beyond what was saved are kept for the saved widget (fix 4, NEW-1, NEW-5). Ruling R-47: in every case only
   *  this open's own draft goes (its session, or the draft it resumed); a draft another open kept is never this
   *  save's to clear, and is still offered. */
  const settleSaved = (savedId, etag, st, savedKey = planKeyOf(st)) => {
    if (away()) {
      settleDraft(uid, { session: session.current, savedKey, target: savedId, etag })
      return
    }
    dropOwnDrafts()
  }
  const finish = (focusTo) => {
    dropOwnDrafts()
    savedRef.current = null
    setSaving(false)
    close(focusTo)
  }
  /** A save refused. `sent` is the plan that request carried (fix 1, m-3): a `formula` refusal's position counts into
   *  ITS text, never into an edit that settled while the request was out. */
  const refused = (got, sent) => {
    setSaving(false)
    setLevel({ kind: 'main' })
    formulaRefused(got, sent)
    if (got.code === 'offline') { setSaveMsg(OFFLINE_SAVE); return }
    let text = failureText(got.code, got.message) || FAILED_SENTENCE
    if (got.code === 'conflict' && !keepDraft()) text = `${text} ${KEEP_FAILED}`
    setSaveMsg(text)
  }
  /** The placed widget for `id` as a focusable element (fix 1, I-9): focus lands on what was just placed. */
  const placedDom = (id) => {
    try {
      let at = null
      editor.state.doc.descendants((n, p) => {
        if (n.type.name === 'widgetEmbed' && n.attrs?.params?.defId === id) at = p
      })
      const dom = at === null ? null : editor.view?.nodeDOM?.(at)
      if (!dom || typeof dom.focus !== 'function') return null
      if (!dom.hasAttribute?.('tabindex')) dom.setAttribute?.('tabindex', '-1')
      return dom
    } catch {
      return null
    }
  }
  const insertNode = (payload) => editor.chain().insertWidgetEmbed(BUILT_KIND, payload).run()
  const replaceNode = (payload) => {
    // The placed widget moved away or is another widget now: write nothing (the widget is saved, never a stray copy).
    const hit = placedNode()
    if (!hit) return false
    const { pos, node } = hit
    const params = normalizeParams(BUILT_KIND, builtRefreshParams(node.attrs.params, payload))
    const attrs = {
      ...node.attrs, widgetId: BUILT_KIND, params, searchText: paramsPlainText(BUILT_KIND, params), fallback: null,
      ...(typeof payload.asOf === 'string' && payload.asOf ? { capturedAt: payload.asOf } : {}),
    }
    // ONE transaction: one undo brings the original widget back.
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, attrs))
    return true
  }
  const nameFor = (st) => (st.nameTouched && st.plan.display.title.trim() ? { name: st.plan.display.title.trim() } : {})
  const placeSaved = async () => {
    let s = savedRef.current
    // Fix 1, I-2: the member edited after the widget was saved (while its placement had failed): save those edits
    // to the same widget first, so what goes into the note is the newest version.
    const st = stateRef.current
    if (planKeyOf(st) !== s.planKey) {
      setSaving(true)
      const put = await sent(putJson(`/${encodeURIComponent(s.defId)}`,
        { plan: st.plan, ...nameFor(st), apply: UPDATE_ALL, ...(noteId ? { origin: noteId } : {}) }, s.etag))
      if (put.ok) settleSaved(s.defId, put.data.etag, st)
      if (away()) return
      if (!put.ok) { refused(put, st.plan); return }
      s = { ...s, defRev: put.data.rev, etag: put.data.etag, planKey: planKeyOf(st) }
      savedRef.current = s
    }
    if (!s.how || !canWriteNote) { finish(); return }
    setSaving(true)
    const got = await runBuilt({ defId: s.defId, defRev: s.defRev })
    if (away()) return
    if (!got.ok) {
      setSaving(false)
      setLevel({ kind: 'main' })
      setSaveMsg(`${SAVED_NOT_PLACED} ${failureText(got.code, got.message) || FAILED_SENTENCE}`)
      return
    }
    if (s.how === 'replace' && !replaceNode(got.data)) {
      // R-39: the widget is saved, but the placed widget it was to replace is gone. Say so, in the open sheet (the
      // footer's alert, read out); Save becomes Close. Nothing is written to the note.
      dropOwnDrafts()
      savedRef.current = null
      setSaving(false)
      setLevel({ kind: 'main' })
      goneRef.current = true
      setGone(true)
      setSaveMsg(SAVED_NOT_IN_NOTE)
      return
    }
    if (s.how !== 'replace') insertNode(got.data)
    finish(placedDom(s.defId))
  }
  /** A widget saved whose place is still owed. `planKey`: the edits it holds (what the request that made it sent).
   *  A replayed request answers the widget as it is now; its etag is the one it was MADE at, so saving later edits to
   *  it meets a change made since in another tab as a conflict, never overwrites it. */
  const owed = (data, how, planKey) => ({
    defId: data.id, defRev: data.rev, how, planKey,
    etag: data.replayed === true && Number.isInteger(data.createdEtag) ? data.createdEtag : data.etag,
  })
  const confirmed = outcomeConfirmed
  /**
   * Send the open's save that MAKES a widget (`kind`: 'create' | 'save_new'), keyed (rulings R-43, R-48, R-49). The
   * unconfirmed request still pending for the same thing is sent AGAIN AS IT WAS (same key, same body), never with
   * newer edits under its key: if it had landed, the server answers that widget, and the edits since are saved to it
   * next (placeSaved). If the server refuses it, the newer edits go as a NEW request with a fresh key. Any confirmed
   * answer ends the pending request; a lost one keeps it, in the draft too, to be sent again.
   */
  const sendKeyed = async (kind, body, st, { defId = null, etag = null } = {}) => {
    const fresh = () => ({ key: newIdempotencyKey(), kind, body, planKey: planKeyOf(st), defId, etag })
    let p = pendingSave.current
    if (!p || p.kind !== kind || (kind === 'save_new' && p.defId !== defId)) p = fresh()
    const go = (q) => {
      pendingSave.current = q
      const req = q.kind === 'create'
        ? postJson('', q.body, { idempotencyKey: q.key })
        : putJson(`/${encodeURIComponent(q.defId)}`, q.body, q.etag, { idempotencyKey: q.key })
      // The landed save settles its draft BEFORE the save counts as settled for a later open waiting on it (NEW-5).
      return sent(req.then((got) => {
        if (got.ok) settleSaved(got.data.id, owed(got.data, null, q.planKey).etag, st, q.planKey)
        return got
      }))
    }
    let got = await go(p)
    if (!got.ok && confirmed(got) && p.planKey !== planKeyOf(st) && !away()) {
      p = fresh()
      got = await go(p)
    }
    if (confirmed(got) && pendingSave.current === p) pendingSave.current = null
    return { got, p }
  }
  const save = async (choice) => {
    if (gone) { close(); return }
    if (saving || phase !== 'ready' || !cat) return
    // Task 10.16: a box still settling is settled first, and the save runs on the plan that holds it.
    if (formulaFlushRef.current?.()) { setFlushSave({ choice }); return }
    setSaveMsg('')
    if (savedRef.current) { await placeSaved(); return }
    const st = stateRef.current
    const plan = st.plan
    const { mode, def } = target
    const fromNode = !!getPos && canWriteNote
    if (mode === 'edit') {
      if (!st.dirty) { finish(); return }
      const usedIn = Number.isInteger(def?.usedIn) ? def.usedIn : 0
      // A draft of a widget that changed since is saved only as a new widget (I-7): never over the newer one.
      if (stale) choice = SAVE_NEW
      if (usedIn > 1 && !choice) {
        setAnswer(preselectAnswer({ lastAnswer: def.lastAnswer, kind: changeKind(def.plan, plan) }))
        push({ kind: 'question' }, null)
        return
      }
      const apply = choice || UPDATE_ALL
      const body = { plan, ...nameFor(st), apply, ...(noteId ? { origin: noteId } : {}) }
      setSaving(true)
      if (apply === SAVE_NEW) {
        // Ruling R-49: a save as a new widget MAKES a widget, so it is keyed like the create POST.
        const { got, p } = await sendKeyed('save_new', body, st, { defId: def.id, etag: def.etag })
        if (away()) return
        if (!got.ok) { refused(got, p.body?.plan || plan); return }
        // 8.15 M-5: the stale draft is now its own new widget. Its question is answered: the banner goes and Save
        // stops saying "Save as a new widget" (it places the saved widget, if its place is still owed).
        staleEtag.current = null
        setStale(false)
        savedRef.current = owed(got.data, fromNode ? 'replace' : null, p.planKey)
        await placeSaved()
        return
      }
      const got = await sent(putJson(`/${encodeURIComponent(def.id)}`, body, def.etag))
      if (got.ok) settleSaved(got.data.id || def.id, got.data.etag, st)
      if (away()) return
      if (!got.ok) { refused(got, plan); return }
      // Ruling R-36: in one note or none, opened from that placed widget, the member sees the new version there.
      if (usedIn <= 1 && fromNode) {
        savedRef.current = owed(got.data, 'replace', planKeyOf(st))
        await placeSaved()
        return
      }
      finish()
      return
    }
    setSaving(true)
    // R-43 / R-48: keyed. A request that had landed (a reload, a retry after a timeout) answers the widget it made; the
    // edits made since are then saved to it (placeSaved), and a builder that has gone keeps them as its draft.
    const { got, p } = await sendKeyed('create', { plan, ...nameFor(st) }, st)
    if (away()) return
    // The request that went out: a resent unconfirmed one carries its own (older) plan.
    if (!got.ok) { refused(got, p.body?.plan || plan); return }
    let how = null
    if (canWriteNote) how = mode === 'copy' && getPos ? 'replace' : 'insert'
    savedRef.current = owed(got.data, how, p.planKey)
    await placeSaved()
  }

  useEffect(() => {
    if (!flushSave) return
    setFlushSave(null)
    save(flushSave.choice)
  }, [flushSave]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── keys: Escape backs out one level; Ctrl/Cmd+Z / Shift+Z / Enter ─────────────────────────────
  const keysRef = useRef(null)
  keysRef.current = {
    level, back, save, answer, phase: onGallery ? 'gallery' : phase,
    // Fix 1, m-4: Escape goes back ONE level. A non-empty search clears first; a builder opened from a card goes
    // back to the gallery (asking first when edited), unless a saved widget's place is still owed.
    escape: (target) => {
      if (onGallery) return !!clearSearchRef.current?.(target)
      // Task 10.16: an open autocomplete list is the level Escape leaves first.
      if (formulaEscRef.current?.()) return true
      if (!fromGallery || phase !== 'ready' || backHeld || level.kind !== 'main') return false
      backToExamples(rootRef.current?.querySelector('[data-builder-back]') || null)
      return true
    },
  }
  useEffect(() => {
    const isTop = () => {
      const panel = rootRef.current?.closest('[data-sheet-panel]')
      const panels = document.querySelectorAll('[data-sheet-panel]')
      return !!panel && panels[panels.length - 1] === panel
    }
    const onKey = (e) => {
      const k = keysRef.current
      if (!k || !isTop()) return
      if (e.key === 'Escape') {
        // A picker (or a question) goes back one level; at the top the Sheet's own Escape asks to close.
        if (k.level.kind !== 'main') { e.preventDefault(); e.stopPropagation(); k.back(); return }
        if (k.escape?.(e.target)) { e.preventDefault(); e.stopPropagation() }
        return
      }
      if (k.phase !== 'ready' || !(e.ctrlKey || e.metaKey)) return
      if (e.key === 'Enter') {
        // A filter being edited is not the widget: Enter there applies the filter, never saves half of it.
        if (k.level.kind === 'filter' || k.level.kind === 'field' || k.level.kind === 'ref') return
        e.preventDefault()
        k.save(k.level.kind === 'question' ? k.answer : undefined)
        return
      }
      const z = e.key === 'z' || e.key === 'Z'
      const y = e.key === 'y' || e.key === 'Y'
      if (!z && !y) return
      // The builder's history is the top level's; a text field keeps its own undo.
      if (k.level.kind !== 'main' || isTextControl(e.target)) return
      e.preventDefault()
      dispatch({ type: z && !e.shiftKey ? 'undo' : 'redo' })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // ── render ─────────────────────────────────────────────────────────────────────────────────────
  const title = target.mode === 'edit' ? 'Edit widget' : target.mode === 'copy' ? 'Edit a copy' : 'Build a widget'
  const plan = state.plan
  const name = nameOf(state)
  const unit = cat ? sourceOf(cat, plan)?.unit || 'trades' : 'trades'
  const byNeed = cat ? coverageByNeed(cat, plan, preview.payload) : new Map()
  const saveLabel = gone ? 'Close' : stale ? 'Save as a new widget' : target.mode === 'copy' ? 'Save as a copy' : 'Save'
  // Undo and Redo belong to the top level: inside a picker they are shown but say they are not available; so too
  // once saved but gone (NEW-2), where no edit is taken.
  const historyOff = level.kind !== 'main' || gone

  let content
  if (phase === 'loading') {
    content = <p className={styles.sectionHint} role="status">Opening the widget builder…</p>
  } else if (phase === 'failed') {
    content = (
      <div className={styles.loadFail}>
        <p className={styles.previewMsg} role="alert">
          {loadCode === 'unavailable' || loadCode === 'offline' ? failureText(loadCode) : LOAD_FAILED}
        </p>
        <button type="button" className={styles.btn} onClick={() => setLoadTick((n) => n + 1)}>Try again</button>
      </div>
    )
  } else if (phase === 'tooNew') {
    content = (
      <div className={styles.loadFail}>
        <p className={styles.previewMsg} role="alert">{FAILURE_COPY.too_new}</p>
        {tooNew && <p className={styles.summary}>{tooNew}</p>}
      </div>
    )
  } else {
    const k = level.kind
    let picker = null
    if (k === 'range') picker = <RangePicker cat={cat} plan={plan} onPick={onRange} onBack={back} />
    else if (k === 'field') {
      picker = <FieldPicker cat={viewCat} plan={plan} onBack={back}
        onPick={(field) => {
          // A field that names a routine or tracker asks which one first (Task 9.17).
          const kind = refKindOf(sourceOf(viewCat, plan)?.fields.get(field))
          setLevel(kind ? { kind: 'ref', refKind: kind, for: 'filter', field, index: undefined }
            : { kind: 'filter', field, index: undefined })
        }} />
    } else if (k === 'ref') {
      const forFilter = level.for === 'filter'
      const skip = forFilter ? (Number.isInteger(level.index) ? { filter: level.index } : {}) : { split: level.slot }
      const current = forFilter
        ? (level.ref ?? (Number.isInteger(level.index) ? plan.filters[level.index]?.ref : null))
        : (level.slot === 'then' ? plan.split?.ref2 : plan.split?.ref)
      picker = (
        <RefPicker key={`${level.refKind}-${level.field}`} cat={cat} kind={level.refKind}
          taken={planRefs(cat, plan, skip).get(level.refKind) || null} current={current || null}
          onLoaded={mergeToolNames} onBack={back}
          onPick={(id) => {
            if (forFilter) setLevel({ kind: 'filter', field: level.field, index: level.index, ref: id, draft: level.draft })
            else onSplit(level.slot, level.field, id)
          }} />
      )
    } else if (k === 'filter') {
      const initial = Number.isInteger(level.index) ? { ...plan.filters[level.index], index: level.index } : undefined
      const refKind = refKindOf(sourceOf(viewCat, plan)?.fields.get(level.field))
      picker = (
        <FilterEditor key={`${level.field}-${level.index ?? 'new'}-${level.ref ?? ''}`} cat={viewCat} plan={plan}
          fieldKey={level.field} initial={initial} draft={level.draft} refValue={level.ref} accounts={accounts}
          toolNames={toolNames} onToolNames={mergeToolNames} onApply={onApplyFilter} onBack={back}
          onChangeRef={refKind ? (draft) => setLevel({
            kind: 'ref', refKind, for: 'filter', field: level.field, index: level.index,
            ref: level.ref ?? initial?.ref, draft,
          }) : undefined}
          onRemove={() => {
            dispatch({ type: 'removeFilter', index: level.index })
            opener.current = whichHeading()
            back()
          }} />
      )
    } else if (k === 'measure') {
      picker = <MeasurePicker cat={cat} plan={plan} byNeed={byNeed} onToggle={onToggleMeasure} onBack={back} />
    } else if (k === 'split') {
      picker = <SplitPicker cat={viewCat} plan={plan} slot={level.slot} onBack={back}
        onPick={(key) => {
          const kind = key ? refKindOf(sourceOf(viewCat, plan)?.fields.get(key)) : null
          if (kind) setLevel({ kind: 'ref', refKind: kind, for: 'split', slot: level.slot, field: key })
          else onSplit(level.slot, key)
        }} />
    } else if (k === 'question') {
      picker = (
        <SaveQuestion usedIn={target.def?.usedIn || 0} answer={answer} onAnswer={setAnswer} fromNote={!!getPos}
          busy={saving} onConfirm={(a) => save(a)} onBack={back} />
      )
    } else if (k === 'ask') {
      // Fix 1, I-2: asked by "Back to examples" (`to: 'gallery'`), the choices lead to the gallery, never close.
      const toG = level.to === 'gallery'
      // M-2: the member keeps ONE unsaved widget; keeping this one replaces another open's, so the question says so.
      const replacesOther = slotHeldByOther(uid, ownSessions()) !== undefined
      picker = (
        <div>
          <h3 className={styles.pickerTitle} tabIndex={-1} data-picker-heading="">{KEEP_QUESTION}</h3>
          <p className={styles.sectionHint}>You can come back to them for a day.</p>
          {replacesOther && <p className={styles.sectionHint} data-testid="keep-replaces">{KEEP_REPLACES}</p>}
          <div className={styles.pickerActions}>
            <button type="button" className={styles.btnPrimary}
              onClick={() => {
                if (!keepDraft()) { setSaveMsg(KEEP_FAILED); return }
                if (!toG) { close(); return }
                reoffer()
                toGallery()
              }}>
              Keep my changes
            </button>
            <button type="button" className={styles.btn}
              onClick={() => {
                dropOwnDrafts()
                if (!toG) { close(); return }
                // 8.16 N1: a draft the member never chose (offered on the gallery before they opened a card) is still
                // there, so the gallery offers it again.
                reoffer()
                toGallery()
              }}>
              Discard them
            </button>
            <button type="button" className={styles.btn} onClick={back}>Keep editing</button>
          </div>
        </div>
      )
    }
    content = (
      <>
        {screen === 'examples' || fromGallery ? (
          <ExamplesGallery hidden={!onGallery} resume={onGallery ? galleryResume : null} resumeRef={offerRef}
            clearSearchRef={clearSearchRef} {...galleryProps} />
        ) : null}
        <div hidden={k !== 'main' || onGallery} className={styles.sections} inert={gone || undefined}
          aria-disabled={gone || undefined} data-testid="builder-sections">
          {fromGallery && (
            <div className={styles.backRow}>
              <button type="button" className={styles.btn} onClick={(e) => backToExamples(e.currentTarget)}
                data-builder-back="" aria-disabled={backHeld || undefined}
                aria-describedby={backOwed ? backHeldId : undefined}>
                <UIcon name="chevronLeft" size={16} gold={false} aria-hidden="true" />
                <span>{BACK_TO_EXAMPLES}</span>
              </button>
              {backOwed && <p className={styles.sectionHint} id={backHeldId}>{BACK_HELD_SAVED}</p>}
            </div>
          )}
          {offer && !onGallery && (
            <div className={styles.offer} role="group" aria-label={RESUME_OFFER}>
              <p className={styles.offerText}>{RESUME_OFFER}</p>
              <p className={styles.sectionHint}>{`Kept ${keptAgo(offer.at)}.`}</p>
              <div className={styles.pickerActions}>
                <button type="button" className={styles.btnPrimary} ref={offerRef}
                  onClick={() => { resumeDraft(offer); setOffer(null) }}>
                  Resume
                </button>
                <button type="button" className={styles.btn}
                  onClick={() => { clearOwnDraft(uid, [offer.session || null]); setOffer(null) }}>
                  Start fresh
                </button>
              </div>
            </div>
          )}
          {stale && (
            <div className={styles.offer} role="group" aria-label={STALE_DRAFT}>
              <p className={styles.offerText}>{STALE_DRAFT}</p>
              <div className={styles.pickerActions}>
                <button type="button" className={styles.btnPrimary} onClick={() => save(SAVE_NEW)} disabled={saving}>
                  Save as a new widget
                </button>
              </div>
            </div>
          )}
          {target.missing && <p className={styles.notice}>{SAVED_COPY_SENTENCE}</p>}
          {/* Always mounted, so the sentence is read out when it arrives (a late, held save). */}
          <p className={notice ? styles.notice : styles.srOnly} role="status" data-testid="builder-notice">{notice}</p>
          <SourceSection cat={cat} plan={plan} accounts={accounts} onSource={onSource}
            onAccounts={(acc) => dispatch({ type: 'setAccounts', accounts: acc })} />
          <WhichOnesSection cat={viewCat} plan={plan} accounts={accounts} toolNames={toolNames}
            onOpenRange={(el) => push({ kind: 'range' }, el)}
            onAddFilter={(el) => push({ kind: 'field' }, el)}
            onEditFilter={(i, el) => push({ kind: 'filter', field: plan.filters[i].field, index: i }, el)}
            onRemoveFilter={onRemoveFilterAt} />
          <MeasureSection cat={cat} plan={plan} byNeed={byNeed} onOpen={(el) => push({ kind: 'measure' }, el)}
            onRemove={onRemoveMeasure} />
          {(cat.formats.length > 0 || formulasOf(plan).length > 0) && (
            <FormulaSection cat={cat} plan={plan} compiled={compiled} fields={formulaFields} unit={unit}
              settleMs={PREVIEW_DEBOUNCE_MS} probes={formulaFeedback.probes} serverErrors={formulaFeedback.errors}
              onAdd={onFormulaAdd} onEdit={onFormulaEdit} onRemove={onFormulaRemove} onMeasure={toggleMeasure}
              onSplit={onFormulaSplit} onFilter={onFormulaFilter} escapeRef={formulaEscRef} flushRef={formulaFlushRef} />
          )}
          <SplitSection cat={viewCat} plan={plan} toolNames={toolNames} onOpen={(slot, el) => push({ kind: 'split', slot }, el)}
            onClear={onClearSplit} onSort={(sort) => dispatch({ type: 'setSort', sort })} />
          <ViewSection cat={cat} plan={plan} unit={unit} onView={onView} onCompare={onCompare} onDisplay={onDisplay} />
          <NameSection name={name} nameTouched={state.nameTouched} subtitle={plan.display.subtitle}
            onName={(v) => dispatch({ type: 'setName', name: v })}
            onSubtitle={(v) => dispatch({ type: 'setDisplay', display: { subtitle: v } })} />
        </div>
        {picker && <div className={styles.level} data-builder-level="">{picker}</div>}
      </>
    )
  }

  const pane = phase === 'ready' && !onGallery ? (
    <PreviewPane payload={preview.payload} status={preview.status} error={preview.error} name={name} unit={unit}
      stale={previewBlocked}
      phone={phone} keyboardOpen={keyboardOpen} onRetry={() => setRetryTick((n) => n + 1)}
      canSuggestRange={!isRightNow(cat, plan) && plan.range?.token !== DEFAULT_RANGE.token} suggestOff={gone}
      onSuggestRange={() => edit({ type: 'setRange', range: { ...DEFAULT_RANGE } }, { range: { ...DEFAULT_RANGE } })} />
  ) : null

  const footer = (
    <div className={styles.footer}>
      <div className={styles.history}>
        <button type="button" className={styles.iconBtn} onClick={() => { if (!historyOff) dispatch({ type: 'undo' }) }}
          disabled={phase !== 'ready' || !state.past.length} aria-disabled={historyOff || undefined}
          aria-keyshortcuts="Control+Z Meta+Z">
          Undo
        </button>
        <button type="button" className={styles.iconBtn} onClick={() => { if (!historyOff) dispatch({ type: 'redo' }) }}
          disabled={phase !== 'ready' || !state.future.length} aria-disabled={historyOff || undefined}
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">
          Redo
        </button>
      </div>
      {saveMsg && <p className={styles.footerMsg} role="alert">{saveMsg}</p>}
      <button type="button" className={styles.btnPrimary} onClick={() => save()} ref={saveBtnRef}
        disabled={saving || phase !== 'ready'} aria-busy={saving} aria-keyshortcuts="Control+Enter Meta+Enter"
        data-testid="builder-save">
        {saving ? 'Saving…' : saveLabel}
      </button>
    </div>
  )

  return (
    <Sheet open onClose={requestClose} title={<h2 className={styles.dialogTitle}>{title}</h2>} labelledByTitle
      maxWidth={1080} className={styles.panel} bodyClassName={styles.body}
      footer={phase === 'tooNew' || (phase === 'ready' && onGallery) ? null : footer}>
      <div ref={rootRef} className={`${styles.layout} ${phase === 'ready' && onGallery ? styles.layoutGallery : ''}`}
        data-testid="widget-builder">
        <p className={styles.srOnly} role="status" data-testid="builder-opened">{opened}</p>
        {phone && pane}
        <div className={styles.controls} data-builder-controls="">{content}</div>
        {!phone && pane && <div className={styles.previewCol}>{pane}</div>}
      </div>
    </Sheet>
  )
}
