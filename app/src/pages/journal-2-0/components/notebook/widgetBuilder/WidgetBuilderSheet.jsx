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
 *     note's widget. In one note or none: saved without asking (`update_all`).
 *   * a ready-made (`shelf:`) or adopted widget: "Save as a copy" — a new widget that replaces the placed one in ONE
 *     transaction (one undo brings the original back), or is inserted at the caret from /build.
 *   * a refusal (a conflict, the count cap, offline) keeps everything and says why; a conflict also keeps the draft.
 *
 * Escape goes back one picker level, then asks "Keep your changes?" only when something changed; a kept draft is
 * offered again ("Resume your unsaved widget") within 24 h. Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes,
 * Ctrl/Cmd+Enter saves.
 *
 * ⛔ Member words: this file's copy never says "definition", "shelf", "built widget", "source", "plan" or "scope".
 */
export const PREVIEW_DEBOUNCE_MS = 400
/** After "Pausing the preview for a moment", the preview tries again on its own after this long. */
export const RATE_RETRY_MS = 10000
/** The soft keyboard is open when the visual viewport is under this share of the window's height. */
export const KEYBOARD_RATIO = 0.75

export const KEEP_QUESTION = 'Keep your changes?'
export const RESUME_OFFER = 'Resume your unsaved widget'
export const SAVED_NOT_PLACED = 'Your widget is saved, but it could not be added to the note yet.'
export const OFFLINE_SAVE = "Offline. Your changes are kept here; save when you're back."
export const LOAD_FAILED = "Couldn't open the widget builder."

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The keyboard is open (visualViewport shorter than KEYBOARD_RATIO of the window). Read at once and on every
 *  resize against the CURRENT window height, so a rotation is never compared with a stale baseline. */
function useKeyboardOpen(active) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined
    const vv = window.visualViewport
    if (!vv) return undefined
    const read = () => setOpen(vv.height < KEYBOARD_RATIO * window.innerHeight)
    read()
    vv.addEventListener('resize', read)
    return () => vv.removeEventListener('resize', read)
  }, [active])
  return open
}

/** "about 3 hours ago" for the resume offer. */
function keptAgo(at, now = Date.now()) {
  const min = Math.max(0, Math.round((now - at) / 60000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const h = Math.round(min / 60)
  return `${h} hour${h === 1 ? '' : 's'} ago`
}

export default function WidgetBuilderSheet({ editor = null, from = null, start, uid, onClose }) {
  const phone = useIsPhone()
  const keyboardOpen = useKeyboardOpen(phone)
  const [phase, setPhase] = useState('loading')          // loading | ready | failed | tooNew
  const [loadCode, setLoadCode] = useState('')
  const [loadTick, setLoadTick] = useState(0)
  const [cat, setCat] = useState(null)
  const [accounts, setAccounts] = useState(() => new Map())
  const [target, setTarget] = useState({ mode: 'new', def: null })
  const [tooNew, setTooNew] = useState('')
  const [state, dispatch] = useReducer(reducer, undefined, () => initState(blankPlan()))
  const [level, setLevel] = useState({ kind: 'main' })
  const [offer, setOffer] = useState(null)
  const [preview, setPreview] = useState({ payload: null, status: 'idle', error: null })
  const [retryTick, setRetryTick] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [answer, setAnswer] = useState(UPDATE_ALL)
  const rootRef = useRef(null)
  const opener = useRef(null)
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
          if (!got.ok) throw Object.assign(new Error(got.code), { code: got.code })
          if (got.data.tooNew) {
            if (!alive) return
            setTooNew(typeof got.data.summary === 'string' ? got.data.summary : '')
            setPhase('tooNew')
            return
          }
          def = got.data
          plan = got.data.plan
          mode = got.data.sourceGalleryId ? 'copy' : 'edit'
        } else {
          plan = { ...blankPlan(), measures: defaultMeasuresFor(c, 'closed_trades').map((k) => ({ key: k })) }
        }
        if (!alive) return
        setCat(c)
        setAccounts(new Map((accs || []).map((a) => [a.id, a.name])))
        setTarget({ mode, def })
        dispatch({ type: 'loadPlan', plan, autoName: '' })
        const kept = readDraft(uid, draftTarget)
        if (kept && start === 'resume') dispatch({ type: 'loadPlan', plan: kept.plan, keepBase: true })
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
  const close = useCallback(() => { onClose?.() }, [onClose])
  const requestClose = () => {
    if (saving) return
    if (phase === 'ready' && stateRef.current.dirty) {
      if (level.kind !== 'ask') push({ kind: 'ask' }, null)
      return
    }
    close()
  }
  const keepDraft = () => {
    const st = stateRef.current
    writeDraft(uid, { plan: st.plan, nameTouched: st.nameTouched, target: draftTarget })
  }

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
  const onRemoveFilterAt = (i) => {
    dispatch({ type: 'removeFilter', index: i })
    // The chip and its remove button are gone: focus goes to the section's own heading.
    rootRef.current?.querySelector('[data-builder-section="which"] [data-builder-heading]')?.focus()
  }

  // ── save ───────────────────────────────────────────────────────────────────────────────────────
  const finish = () => {
    clearDraft(uid, draftTarget)
    savedRef.current = null
    setSaving(false)
    close()
  }
  const refused = (got) => {
    setSaving(false)
    setLevel({ kind: 'main' })
    if (got.code === 'offline') { setSaveMsg(OFFLINE_SAVE); return }
    if (got.code === 'conflict') keepDraft()
    setSaveMsg(failureText(got.code, got.message) || FAILED_SENTENCE)
  }
  const insertNode = (payload) => editor.chain().insertWidgetEmbed(BUILT_KIND, payload).run()
  const replaceNode = (payload) => {
    const pos = getPos ? getPos() : null
    const node = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null
    if (!node || node.type.name !== 'widgetEmbed') return insertNode(payload)
    const params = normalizeParams(BUILT_KIND, builtRefreshParams(node.attrs.params, payload))
    const attrs = {
      ...node.attrs, widgetId: BUILT_KIND, params, searchText: paramsPlainText(BUILT_KIND, params), fallback: null,
      ...(typeof payload.asOf === 'string' && payload.asOf ? { capturedAt: payload.asOf } : {}),
    }
    // ONE transaction: one undo brings the original widget back.
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, attrs))
    return true
  }
  const placeSaved = async () => {
    const s = savedRef.current
    if (!s?.how || !canWriteNote) { finish(); return }
    setSaving(true)
    const got = await runBuilt({ defId: s.defId, defRev: s.defRev })
    if (!mounted.current) return
    if (!got.ok) {
      setSaving(false)
      setLevel({ kind: 'main' })
      setSaveMsg(`${SAVED_NOT_PLACED} ${failureText(got.code, got.message) || FAILED_SENTENCE}`)
      return
    }
    if (s.how === 'replace') replaceNode(got.data)
    else insertNode(got.data)
    finish()
  }
  const save = async (choice) => {
    if (saving || phase !== 'ready' || !cat) return
    setSaveMsg('')
    if (savedRef.current) { await placeSaved(); return }
    const st = stateRef.current
    const plan = st.plan
    const name = st.nameTouched && plan.display.title.trim() ? plan.display.title.trim() : null
    const { mode, def } = target
    if (mode === 'edit') {
      if (!st.dirty) { finish(); return }
      const usedIn = Number.isInteger(def?.usedIn) ? def.usedIn : 0
      if (usedIn > 1 && !choice) {
        setAnswer(preselectAnswer({ lastAnswer: def.lastAnswer, kind: changeKind(def.plan, plan) }))
        push({ kind: 'question' }, null)
        return
      }
      const apply = usedIn > 1 ? choice : UPDATE_ALL
      setSaving(true)
      const got = await putJson(`/${encodeURIComponent(def.id)}`,
        { plan, ...(name ? { name } : {}), apply, ...(noteId ? { origin: noteId } : {}) }, def.etag)
      if (!mounted.current) return
      if (!got.ok) { refused(got); return }
      if (apply === SAVE_NEW) {
        savedRef.current = { defId: got.data.id, defRev: got.data.rev, how: getPos && canWriteNote ? 'replace' : null }
        await placeSaved()
        return
      }
      finish()
      return
    }
    setSaving(true)
    const got = await postJson('', { plan, ...(name ? { name } : {}) })
    if (!mounted.current) return
    if (!got.ok) { refused(got); return }
    let how = null
    if (canWriteNote) how = mode === 'copy' && getPos ? 'replace' : 'insert'
    savedRef.current = { defId: got.data.id, defRev: got.data.rev, how }
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
        e.preventDefault()
        k.save(k.level.kind === 'question' ? k.answer : undefined)
      } else if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      }
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
  const saveLabel = target.mode === 'copy' ? 'Save as a copy' : 'Save'

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
            opener.current = rootRef.current?.querySelector('[data-builder-section="which"] [data-builder-heading]') || null
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
            <button type="button" className={styles.btnPrimary} onClick={() => { keepDraft(); close() }}>
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
                <button type="button" className={styles.btnPrimary}
                  onClick={() => { dispatch({ type: 'loadPlan', plan: offer.plan, keepBase: true }); setOffer(null) }}>
                  Resume
                </button>
                <button type="button" className={styles.btn}
                  onClick={() => { clearDraft(uid, draftTarget); setOffer(null) }}>
                  Start fresh
                </button>
              </div>
            </div>
          )}
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
          <ViewSection cat={cat} plan={plan} onView={onView} onCompare={onCompare} onDisplay={onDisplay} />
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
        <button type="button" className={styles.iconBtn} onClick={() => dispatch({ type: 'undo' })}
          disabled={phase !== 'ready' || !state.past.length} aria-keyshortcuts="Control+Z Meta+Z">
          Undo
        </button>
        <button type="button" className={styles.iconBtn} onClick={() => dispatch({ type: 'redo' })}
          disabled={phase !== 'ready' || !state.future.length} aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z">
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
    <Sheet open onClose={requestClose} title={title} labelledByTitle maxWidth={1080}
      className={styles.panel} bodyClassName={styles.body} footer={phase === 'tooNew' ? null : footer}>
      <div ref={rootRef} className={styles.layout} data-testid="widget-builder">
        {phone && pane}
        <div className={styles.controls}>{content}</div>
        {!phone && pane && <div className={styles.previewCol}>{pane}</div>}
      </div>
    </Sheet>
  )
}
