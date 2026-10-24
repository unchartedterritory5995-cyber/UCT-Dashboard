import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import { useIsPhone } from '../../../../../hooks/useBreakpoint'
import { normalizeParams, paramsPlainText } from '../../../../../widgets/registry'
import {
  BUILT_KIND, DEFS_URL, FAILED_SENTENCE, FAILURE_COPY, builtRefreshParams, failureText, getJson, loadAccounts,
  loadCatalog, postJson, putJson, runBuilt,
} from '../../../lib/builtWidgets'
import { reducer, initState, blankPlan, nameOf, changeKind, DEFAULT_RANGE } from './builderState'
import {
  indexCatalog, defaultMeasuresFor, fitView, sourceOf, coverageByNeed, isRightNow,
} from './builderCatalog'
import { readDraft, writeDraft, clearDraft } from './builderDraft'
import SourceSection from './sections/SourceSection'
import WhichOnesSection, { RangePicker, FieldPicker, FilterEditor } from './sections/WhichOnesSection'
import MeasureSection, { MeasurePicker } from './sections/MeasureSection'
import SplitSection, { SplitPicker } from './sections/SplitSection'
import ViewSection from './sections/ViewSection'
import NameSection from './sections/NameSection'
import PreviewPane from './PreviewPane'
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
 *   * new: `POST ""`, then, opened from a note, the saved widget is run and inserted at the caret.
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
 * Escape goes back one picker level, then asks "Keep your changes?" only when something changed; a kept draft is
 * offered again ("Resume your unsaved widget") within 24 h, and a draft of a widget that changed since is saved
 * only as a new widget (fix 1, I-7). Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes, at the top level and outside a
 * text field (a field keeps its own undo); Ctrl/Cmd+Enter saves, except while a filter is being edited.
 *
 * ⛔ Member words: this file's copy never says "definition", "shelf", "built widget", "source", "plan" or "scope".
 */
export const PREVIEW_DEBOUNCE_MS = 400
/** After "Pausing the preview for a moment", the preview tries again on its own after this long. */
export const RATE_RETRY_MS = 10000
/** The soft keyboard is open when the visual viewport is under this share of the tallest height seen. */
export const KEYBOARD_RATIO = 0.75

export const KEEP_QUESTION = 'Keep your changes?'
export const KEEP_FAILED = "Couldn't keep your changes in this browser. Save them, or they are lost when you close."
export const RESUME_OFFER = 'Resume your unsaved widget'
export const STALE_DRAFT = 'This widget changed since you left. Save your version as a new widget?'
export const SAVED_NOT_PLACED = 'Your widget is saved, but it could not be added to the note yet.'
export const OFFLINE_SAVE = "Offline. Your changes are kept here; save when you're back."
export const LOAD_FAILED = "Couldn't open the widget builder."
/** Spec 5.10, "Definition missing": the placed widget runs, and is edited, from the copy the note carries. */
export const SAVED_COPY_SENTENCE = 'Running from the saved copy in this note.'
/** Fix 2, R-39: saved, but the placed widget it was meant to replace is gone (or is another widget now). */
export const SAVED_NOT_IN_NOTE = 'Saved in My tools. It is no longer in this note.'

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
/** Edits that make a saved widget out of date: the plan and the name, as one value. */
const planKeyOf = (st) => JSON.stringify([st.plan, st.nameTouched])

/** A text field, where Ctrl/Cmd+Z belongs to the field (fix 1, I-6). */
export function isTextControl(el) {
  if (!el || typeof el !== 'object') return false
  if (el.isContentEditable) return true
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
/** The DEVICE's orientation (fix 2): `screen.orientation`, else the orientation media query. Never the window's
 *  aspect, which a resizes-content keyboard flips (a 390 x 300 window is a portrait phone with its keyboard up). */
export function orientationOf() {
  const type = typeof screen !== 'undefined' ? screen.orientation?.type : null
  if (typeof type === 'string' && type) return type.startsWith('landscape') ? 'landscape' : 'portrait'
  try {
    if (typeof window.matchMedia === 'function') return window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait'
  } catch { /* no media queries */ }
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
}

/** The tallest the viewport can be in an orientation, from the screen: so a builder that OPENS with the keyboard
 *  already up (focus was in a field) still reads it as up, instead of taking the shortened height as the baseline. */
function screenSeed(orient) {
  const w = typeof screen !== 'undefined' ? Number(screen.width) || 0 : 0
  const h = typeof screen !== 'undefined' ? Number(screen.height) || 0 : 0
  if (!w || !h) return 0
  return orient === 'landscape' ? Math.min(w, h) : Math.max(w, h)
}

export function useViewport() {
  const [view, setView] = useState({ keyboardOpen: false, height: null, inset: 0 })
  const base = useRef({ portrait: 0, landscape: 0 })
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const vv = window.visualViewport || null
    const read = () => {
      const h = vv ? vv.height : window.innerHeight
      const orient = orientationOf()
      const b = base.current
      b[orient] = Math.max(b[orient], screenSeed(orient), window.innerHeight || 0, h || 0)
      const inset = vv ? Math.max(0, Math.round(window.innerHeight - (vv.offsetTop || 0) - vv.height)) : 0
      const keyboardOpen = !!b[orient] && h < KEYBOARD_RATIO * b[orient]
      setView((v) => (v.keyboardOpen === keyboardOpen && v.height === h && v.inset === inset ? v
        : { keyboardOpen, height: h, inset }))
    }
    read()
    vv?.addEventListener('resize', read)
    vv?.addEventListener('scroll', read)
    window.addEventListener('resize', read)
    return () => {
      vv?.removeEventListener('resize', read)
      vv?.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
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

export default function WidgetBuilderSheet({ editor = null, from = null, start, uid, onClose, registerLeave }) {
  const phone = useIsPhone()
  const viewport = useViewport()
  const keyboardOpen = phone && viewport.keyboardOpen
  const [phase, setPhase] = useState('loading')          // loading | ready | failed | tooNew
  const [loadCode, setLoadCode] = useState('')
  const [loadTick, setLoadTick] = useState(0)
  const [cat, setCat] = useState(null)
  const [accounts, setAccounts] = useState(() => new Map())
  const [target, setTarget] = useState({ mode: 'new', def: null, missing: false })
  const [tooNew, setTooNew] = useState('')
  const [state, dispatch] = useReducer(reducer, undefined, () => initState(blankPlan()))
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
        }
        if (!alive) return
        setCat(c)
        setAccounts(new Map((accs || []).map((a) => [a.id, a.name])))
        setTarget({ mode, def, missing })
        dispatch({ type: 'loadPlan', plan, autoName: '' })
        const kept = readDraft(uid, draftTarget)
        if (kept && start === 'resume') resumeDraft(kept, def)
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

  /** Resume a kept draft. A draft of a widget that has been saved since (its etag moved) is never saved over the
   *  newer version: it can only become a new widget (fix 1, I-7). */
  function resumeDraft(kept, def = target.def) {
    dispatch({ type: 'loadPlan', plan: kept.plan, keepBase: true })
    const was = Number.isInteger(kept.etag) ? kept.etag : null
    const isStale = !!def && was !== null && Number.isInteger(def.etag) && def.etag !== was
    staleEtag.current = isStale ? was : null
    setStale(isStale)
  }

  // The resume offer takes focus when it appears, so it is read out (fix 1: "announce and focus").
  useEffect(() => {
    if (phase === 'ready' && offer) offerRef.current?.focus()
  }, [phase, offer])

  // ── the live preview ──────────────────────────────────────────────────────────────────────────
  // The name and subtitle do not change what is counted, so typing them never re-runs the preview.
  const previewKey = useMemo(() => {
    const p = state.plan
    return JSON.stringify({ ...p, display: { ...p.display, title: '', titleAuto: true, subtitle: '' } })
  }, [state.plan])

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
      if (typeof got.data.defaultName === 'string') dispatch({ type: 'followName', name: got.data.defaultName })
      return
    }
    // A newer preview replaced this one on the server: say nothing; the newer one answers.
    if (got.code === 'superseded') {
      setPreview((p) => ({ ...p, status: p.payload ? 'ok' : 'idle' }))
      return
    }
    setPreview((p) => ({ ...p, status: 'error', error: { code: got.code, message: got.message } }))
  }, [])

  useEffect(() => {
    if (phase !== 'ready') return undefined
    const t = setTimeout(runPreview, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [phase, previewKey, retryTick, runPreview])

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

  // ── closing, and the kept draft ───────────────────────────────────────────────────────────────
  const close = useCallback((focusTo) => { onClose?.(focusTo) }, [onClose])
  const requestClose = () => {
    if (saving) return
    if (gone) { close(); return }
    if (phase === 'ready' && stateRef.current.dirty) {
      if (level.kind !== 'ask') push({ kind: 'ask' }, null)
      return
    }
    close()
  }
  const keepDraft = () => {
    const st = stateRef.current
    // N-2: a stale draft keeps the etag it was KEPT at, so it stays stale (and save-as-new only) when resumed again.
    const etag = staleEtag.current !== null ? staleEtag.current : target.def?.etag
    return writeDraft(uid, { plan: st.plan, nameTouched: st.nameTouched, target: draftTarget, etag })
  }
  // R-38: leaving without closing (browser navigation, the note's editor destroyed) keeps unsaved edits as a draft,
  // offered again on the next open. The door asks through `registerLeave`; a clean builder writes nothing.
  const leaveRef = useRef(null)
  leaveRef.current = () => {
    if (phase === 'ready' && !gone && stateRef.current.dirty) keepDraft()
  }
  useEffect(() => {
    if (typeof registerLeave === 'function') registerLeave(() => leaveRef.current?.())
  }, [registerLeave])

  // ── edits: each change carries the view it forces, so the change and its view are ONE undo step ──
  const fitted = (patch) => fitView(cat, { ...stateRef.current.plan, ...patch })
  const edit = (action, patch) => {
    const next = fitted(patch)
    dispatch({ ...action, view: next.view, compare: next.compare })
  }
  const onSource = (key) => {
    if (key === state.plan.source) return
    const measures = defaultMeasuresFor(cat, key)
    edit({ type: 'setSource', source: key, measures },
      { source: key, measures: measures.map((k) => ({ key: k })), filters: [], split: null, sort: null, compare: null,
        view: { type: 'number', auto: true } })
  }
  const onRange = (range) => {
    edit({ type: 'setRange', range }, { range })
    back()
  }
  const onToggleMeasure = (key) => {
    const cur = state.plan.measures.map((m) => m.key)
    let keys
    if (cur.includes(key)) {
      if (cur.length <= 1) return
      keys = cur.filter((k) => k !== key)
    } else {
      if (cur.length >= cat.maxMeasures) return
      keys = [...cur, key]
    }
    const s = state.plan.sort
    const sort = s && s.measure >= keys.length ? { ...s, measure: 0 } : s
    const next = fitted({ measures: keys.map((k) => ({ key: k })), sort })
    dispatch({ type: 'setMeasures', measures: keys, sort, view: next.view, compare: next.compare })
  }
  const onRemoveMeasure = (i) => onToggleMeasure(state.plan.measures[i]?.key)
  const onSplit = (slot, key) => {
    const cur = state.plan.split
    let split
    if (slot === 'by') split = key ? { by: key, then: cur?.then && cur.then !== key ? cur.then : null } : null
    else split = cur ? { ...cur, then: key } : null
    const sort = split ? state.plan.sort : null
    const next = fitted({ split, sort })
    dispatch({ type: 'setSplit', split, sort, view: next.view, compare: next.compare })
    back()
  }
  const onClearSplit = (slot) => {
    const cur = state.plan.split
    const split = slot === 'by' ? null : (cur ? { ...cur, then: null } : null)
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
  const finish = (focusTo) => {
    clearDraft(uid, draftTarget)
    savedRef.current = null
    setSaving(false)
    close(focusTo)
  }
  const refused = (got) => {
    setSaving(false)
    setLevel({ kind: 'main' })
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
      const put = await putJson(`/${encodeURIComponent(s.defId)}`,
        { plan: st.plan, ...nameFor(st), apply: UPDATE_ALL, ...(noteId ? { origin: noteId } : {}) }, s.etag)
      if (!mounted.current) return
      if (!put.ok) { refused(put); return }
      s = { ...s, defRev: put.data.rev, etag: put.data.etag, planKey: planKeyOf(st) }
      savedRef.current = s
    }
    if (!s.how || !canWriteNote) { finish(); return }
    setSaving(true)
    const got = await runBuilt({ defId: s.defId, defRev: s.defRev })
    if (!mounted.current) return
    if (!got.ok) {
      setSaving(false)
      setLevel({ kind: 'main' })
      setSaveMsg(`${SAVED_NOT_PLACED} ${failureText(got.code, got.message) || FAILED_SENTENCE}`)
      return
    }
    if (s.how === 'replace' && !replaceNode(got.data)) {
      // R-39: the widget is saved, but the placed widget it was to replace is gone. Say so, in the open sheet (the
      // footer's alert, read out); Save becomes Close. Nothing is written to the note.
      clearDraft(uid, draftTarget)
      savedRef.current = null
      setSaving(false)
      setLevel({ kind: 'main' })
      setGone(true)
      setSaveMsg(SAVED_NOT_IN_NOTE)
      return
    }
    if (s.how !== 'replace') insertNode(got.data)
    finish(placedDom(s.defId))
  }
  const owed = (data, how, st) => ({
    defId: data.id, defRev: data.rev, etag: data.etag, how, planKey: planKeyOf(st),
  })
  const save = async (choice) => {
    if (gone) { close(); return }
    if (saving || phase !== 'ready' || !cat) return
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
      setSaving(true)
      const got = await putJson(`/${encodeURIComponent(def.id)}`,
        { plan, ...nameFor(st), apply, ...(noteId ? { origin: noteId } : {}) }, def.etag)
      if (!mounted.current) return
      if (!got.ok) { refused(got); return }
      if (apply === SAVE_NEW) {
        savedRef.current = owed(got.data, fromNode ? 'replace' : null, st)
        await placeSaved()
        return
      }
      // Ruling R-36: in one note or none, opened from that placed widget, the member sees the new version there.
      if (usedIn <= 1 && fromNode) {
        savedRef.current = owed(got.data, 'replace', st)
        await placeSaved()
        return
      }
      finish()
      return
    }
    setSaving(true)
    const got = await postJson('', { plan, ...nameFor(st) })
    if (!mounted.current) return
    if (!got.ok) { refused(got); return }
    let how = null
    if (canWriteNote) how = mode === 'copy' && getPos ? 'replace' : 'insert'
    savedRef.current = owed(got.data, how, st)
    await placeSaved()
  }

  // ── keys: Escape backs out one level; Ctrl/Cmd+Z / Shift+Z / Enter ─────────────────────────────
  const keysRef = useRef(null)
  keysRef.current = { level, back, save, answer, phase }
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
        if (k.level.kind !== 'main') { e.preventDefault(); e.stopPropagation(); k.back() }
        return
      }
      if (k.phase !== 'ready' || !(e.ctrlKey || e.metaKey)) return
      if (e.key === 'Enter') {
        // A filter being edited is not the widget: Enter there applies the filter, never saves half of it.
        if (k.level.kind === 'filter' || k.level.kind === 'field') return
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
  // Undo and Redo belong to the top level: inside a picker they are shown but say they are not available.
  const historyOff = level.kind !== 'main'

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
      picker = <FieldPicker cat={cat} plan={plan} onBack={back}
        onPick={(field) => setLevel({ kind: 'filter', field, index: undefined })} />
    } else if (k === 'filter') {
      const initial = Number.isInteger(level.index) ? { ...plan.filters[level.index], index: level.index } : undefined
      picker = (
        <FilterEditor key={`${level.field}-${level.index ?? 'new'}`} cat={cat} plan={plan} fieldKey={level.field}
          initial={initial} accounts={accounts} onApply={onApplyFilter} onBack={back}
          onRemove={() => {
            dispatch({ type: 'removeFilter', index: level.index })
            opener.current = whichHeading()
            back()
          }} />
      )
    } else if (k === 'measure') {
      picker = <MeasurePicker cat={cat} plan={plan} byNeed={byNeed} onToggle={onToggleMeasure} onBack={back} />
    } else if (k === 'split') {
      picker = <SplitPicker cat={cat} plan={plan} slot={level.slot} onPick={(key) => onSplit(level.slot, key)} onBack={back} />
    } else if (k === 'question') {
      picker = (
        <SaveQuestion usedIn={target.def?.usedIn || 0} answer={answer} onAnswer={setAnswer} fromNote={!!getPos}
          busy={saving} onConfirm={(a) => save(a)} onBack={back} />
      )
    } else if (k === 'ask') {
      picker = (
        <div>
          <h3 className={styles.pickerTitle} tabIndex={-1} data-picker-heading="">{KEEP_QUESTION}</h3>
          <p className={styles.sectionHint}>You can come back to them for a day.</p>
          <div className={styles.pickerActions}>
            <button type="button" className={styles.btnPrimary}
              onClick={() => { if (keepDraft()) close(); else setSaveMsg(KEEP_FAILED) }}>
              Keep my changes
            </button>
            <button type="button" className={styles.btn} onClick={() => { clearDraft(uid, draftTarget); close() }}>
              Discard them
            </button>
            <button type="button" className={styles.btn} onClick={back}>Keep editing</button>
          </div>
        </div>
      )
    }
    content = (
      <>
        <div hidden={k !== 'main'} className={styles.sections}>
          {offer && (
            <div className={styles.offer} role="group" aria-label={RESUME_OFFER}>
              <p className={styles.offerText}>{RESUME_OFFER}</p>
              <p className={styles.sectionHint}>{`Kept ${keptAgo(offer.at)}.`}</p>
              <div className={styles.pickerActions}>
                <button type="button" className={styles.btnPrimary} ref={offerRef}
                  onClick={() => { resumeDraft(offer); setOffer(null) }}>
                  Resume
                </button>
                <button type="button" className={styles.btn}
                  onClick={() => { clearDraft(uid, draftTarget); setOffer(null) }}>
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
          <SourceSection cat={cat} plan={plan} accounts={accounts} onSource={onSource}
            onAccounts={(acc) => dispatch({ type: 'setAccounts', accounts: acc })} />
          <WhichOnesSection cat={cat} plan={plan} accounts={accounts}
            onOpenRange={(el) => push({ kind: 'range' }, el)}
            onAddFilter={(el) => push({ kind: 'field' }, el)}
            onEditFilter={(i, el) => push({ kind: 'filter', field: plan.filters[i].field, index: i }, el)}
            onRemoveFilter={onRemoveFilterAt} />
          <MeasureSection cat={cat} plan={plan} byNeed={byNeed} onOpen={(el) => push({ kind: 'measure' }, el)}
            onRemove={onRemoveMeasure} />
          <SplitSection cat={cat} plan={plan} onOpen={(slot, el) => push({ kind: 'split', slot }, el)}
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

  const pane = phase === 'ready' ? (
    <PreviewPane payload={preview.payload} status={preview.status} error={preview.error} name={name} unit={unit}
      phone={phone} keyboardOpen={keyboardOpen} onRetry={() => setRetryTick((n) => n + 1)}
      canSuggestRange={!isRightNow(cat, plan) && plan.range?.token !== DEFAULT_RANGE.token}
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
      <button type="button" className={styles.btnPrimary} onClick={() => save()}
        disabled={saving || phase !== 'ready'} aria-busy={saving} aria-keyshortcuts="Control+Enter Meta+Enter"
        data-testid="builder-save">
        {saving ? 'Saving…' : saveLabel}
      </button>
    </div>
  )

  return (
    <Sheet open onClose={requestClose} title={<h2 className={styles.dialogTitle}>{title}</h2>} labelledByTitle
      maxWidth={1080} className={styles.panel} bodyClassName={styles.body} footer={phase === 'tooNew' ? null : footer}>
      <div ref={rootRef} className={styles.layout} data-testid="widget-builder">
        {phone && pane}
        <div className={styles.controls}>{content}</div>
        {!phone && pane && <div className={styles.previewCol}>{pane}</div>}
      </div>
    </Sheet>
  )
}
