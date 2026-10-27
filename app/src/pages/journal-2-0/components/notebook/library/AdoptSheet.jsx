// Notebook widgets phase 2, wave 11 (Task 11.17): the adoption sheet, "Make it yours".
//
// A shared template, widget, routine or tracker carries no member value: each one arrived as a typed "pick yours"
// choice (ruling W11-R5). This sheet shows a WORKING preview at once, with every choice at the member's suggested
// value (their most-used value of that type) or "Any", lets them change a choice, and makes it theirs with ONE tap of
// "Use" (spec §9, §16.7 item 7).
//
// ⛔ The SERVER builds the preview (`POST /{galleryId}/preview-mine`, Task 11.9/11.12, ruling W11-R12): ONE call on
//    open, with no answers (the server picks the suggestions), then one per change of a choice, 600 ms after the last
//    change, with at most one request in flight (a newer change waits for the answer, then asks once with the latest
//    answers). The cards, their sentences ("Pick a setup to see this widget.") and the "Sample data" label are the
//    server's; this sheet never computes a number, so it can never show a zero the server did not send.
// ⛔ Opening the sheet and changing choices WRITE NOTHING: the only POST before Use is `preview-mine`.
// ⛔ Use is ONE write per sheet (Review Focus 2): a ref is set before the request, so a double-click sends one
//    `use-template` (or `adopt-tool`), and the button stays off until the answer. A template's Use makes the note and
//    opens it; a tool's Use adopts it and says "Added to My tools."
// ⛔ Use is off while any choice that does not allow Any has no value, with "Pick a value for each choice, or Any."
//    beside it. A refusal (`unresolved`, `not_yours`, `count_cap`, ...) is shown in the server's own words.
// ⛔ LAZY. Reached only through `openAdoptSheet` (its own root).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Sheet from '../../../../../components/mobile/Sheet'
import { adoptTemplate, adoptTool, previewMine, updateTool, useTemplate } from '../../../lib/templateLibrary'
import { openNoteInPlace, noteHref } from '../../../lib/noteHref'
import { PreviewCard, PreviewTool } from './PreviewParts'
import SlotPicker, { anyWords, numberOf } from './SlotPicker'
import styles from './library.module.css'

export const TITLE = 'Make it yours'
export const USE_LABEL = 'Use'
export const CHANGE_LABEL = 'Change'
export const MISSING_HINT = 'Pick a value for each choice, or Any.'
export const ADDED_SENTENCE = 'Added to My tools.'
/** Task 11.19: an update of the member's copy (My tools' "Update from the library", when the new version asks). */
export const UPDATED_SENTENCE = 'Updated from the library.'
/** Ruling W11-R25b (Task 11.16 fix round 2): adopting a listed style takes a copy into the member's templates; it
 *  makes no note and goes nowhere. Neither brief names this sentence, so it is the coordinator's. */
export const ADDED_TEMPLATE_SENTENCE = 'Added to your templates.'
/** The kinds a copy can be updated (Task 11.8's `update_tool`): never a template, which updates in the styles manager. */
const UPDATABLE = new Set(['widget', 'routine', 'tracker'])
export const LOADING_SENTENCE = 'Getting your preview ready…'
export const UPDATING_SENTENCE = 'Updating the preview…'
export const UNPICKED = 'Not picked yet'
export const CHOICES_HEADING = 'Your choices'
export const PREVIEW_HEADING = 'Preview with your data'
export const DEBOUNCE_MS = 600

/** "Use your Morning routine" / "Create Pre-market routine from the template": the two answers to a reuse question. */
export const useYourWords = (name) => `Use your ${name}`
export const createWords = (name) => `Create ${name} from the template`

/**
 * The credit line (rulings W11-R7, W11-R24): ONLY the server's `credit` from the preview answer ("Based on UCT's ...",
 * "Based on a former member's ..."), shown as it came. The client never assembles it: no answer, or no `credit` in
 * it, is no line.
 */
export function creditLine(previewAnswer) {
  const c = isRecord(previewAnswer) ? previewAnswer.credit : null
  return typeof c === 'string' && c.trim() ? c.trim() : ''
}

/** A refusal as the sheet keeps it: `{code, message, slot}` (`slot` only when the server named one, W11-R24). */
const refusalOf = (out) => ({ code: out.code, message: out.message, slot: typeof out.slot === 'string' && out.slot ? out.slot : null })

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const listOf = (v) => (Array.isArray(v) ? v : [])
const text = (v) => (typeof v === 'string' ? v : '')
const isAnyAnswer = (a) => isRecord(a) && a.any === true

/** Whether a choice has an answer the server can take: Any (where allowed), a number for a number, else a value. */
export function answered(slot, a) {
  if (a === undefined || a === null) return false
  if (isAnyAnswer(a)) return slot?.any === true
  if (slot?.type === 'number') return numberOf(a) !== null
  if (typeof a === 'string') return a.trim() !== ''
  return Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'string' && x.trim())
}

/**
 * The first answer of each choice: the SERVER's own `value` for it (F-FE-1 F3; template_preview, W11-R27b: the
 * member's suggestion, else Any where allowed, else none), the value the first preview ran with. The client never
 * re-derives that rule, and never reads `sampleValue` (what a Sample data card ran with instead) or a card's payload:
 * Use sends exactly these values and the member's own changes. A value the sheet cannot send leaves the choice unpicked.
 */
function firstAnswers(slots) {
  const answers = {}
  const labels = {}
  for (const s of slots) {
    const v = s.value
    if (!answered(s, v)) continue
    answers[s.id] = v
    const sug = isRecord(s.suggested) ? s.suggested : null
    if (!isAnyAnswer(v)) labels[s.id] = (sug && JSON.stringify(sug.value) === JSON.stringify(v) && text(sug.label)) || ''
  }
  return { answers, labels }
}

/** The reuse questions' first answers: "Use your <name>" when the server found one, else "Create … from the template". */
function firstChoices(questions) {
  const out = {}
  for (const q of questions) out[q.slot] = isRecord(q.use) && q.use.id != null ? { use: String(q.use.id) } : { create: true }
  return out
}

function valueWords(slot, a, labels) {
  if (!answered(slot, a)) return UNPICKED
  if (isAnyAnswer(a)) return anyWords(slot.label)
  if (slot.type === 'number') return String(numberOf(a))
  if (Array.isArray(a)) return a.join(', ')
  return labels[slot.id] || String(a)
}

const slotsOf = (data) => listOf(data?.slots).filter((s) => isRecord(s) && typeof s.id === 'string' && s.id)
const questionsOf = (data) => listOf(data?.questions).filter((q) => isRecord(q) && typeof q.slot === 'string' && q.slot)

/** A refusal, in the server's own words. */
function Refusal({ p }) {
  return <p className={styles.notice} role="alert" data-refusal={p.code} data-refusal-slot={p.slot || undefined}>{p.message}</p>
}

// ── the preview: the server's words and numbers only, drawn by the ONE renderer (PreviewParts.jsx) ──

/**
 * @param galleryId the listed item
 * @param kind      'template' | 'widget' | 'routine' | 'tracker'
 * @param navigate  the app router's navigate, when the door has one; else the note opens through history in place
 * @param onClose   Cancel, Done, Escape or the Sheet's own close
 * @param editor    the editor the door was opened from, handed back to `onDone` as it came (the sheet never writes it)
 * @param onDone    `(answer) => void` once the item is the member's: `{kind, editor, ...server answer}`
 * @param mode      'use' (the default: a template's Use makes a note through `useTemplate`; a tool's adopts it), or
 *                  'adopt' (ruling W11-R25b: a template's Use takes a COPY into the member's templates through
 *                  `adoptTemplate`, says "Added to your templates." and navigates nowhere; a tool adopts as ever), or
 *                  'update' (Task 11.19: Use takes the listed version into the member's copy `copyId` through
 *                  `updateTool`, never a new copy; a widget, routine or tracker only, anything else stays a use)
 * @param copyId    the member's copy, for mode 'update'
 * @param landNote  `(note) => void`, when the door's host opens notes itself (the New note sheet, 11.20 walk D1): a
 *                  template's Use hands it the new note INSTEAD of navigating, so the host closes its own sheet and
 *                  opens the note through the same door its other picks use (focus in the new note)
 */
export default function AdoptSheet({ galleryId, kind, navigate = null, editor = null, onClose, onDone, mode = 'use', copyId = null, landNote = null }) {
  const uid = useId()
  const isUpdate = mode === 'update' && UPDATABLE.has(kind) && (typeof copyId === 'string' ? copyId !== '' : Number.isFinite(copyId))
  const isTemplate = kind === 'template' && !isUpdate
  // W11-R25b: a template adopted as a copy (the style card's Adopt), never a note.
  const isTemplateCopy = isTemplate && mode === 'adopt'
  const [answer, setAnswer] = useState(null)             // the latest preview: {slots, cards, tools, questions, credit?}
  const [slots, setSlots] = useState(null)               // the choices, from the first answer
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [labels, setLabels] = useState({})
  const [choices, setChoices] = useState({})
  const [problem, setProblem] = useState(null)           // {code, message} of the last refused preview
  const [asking, setAsking] = useState(true)
  const [waiting, setWaiting] = useState(false)          // a change is waiting out the 600 ms before its ask
  const [picking, setPicking] = useState(null)           // the slot id whose picker is open
  const [using, setUsing] = useState(false)
  const [useProblem, setUseProblem] = useState(null)
  const [added, setAdded] = useState(false)

  const latest = useRef(undefined)                        // the answers the next ask sends (undefined: the first)
  const inFlight = useRef(false)
  const again = useRef(false)
  const timer = useRef(null)
  const alive = useRef(true)
  const primed = useRef(false)
  const useLock = useRef(false)
  const changeRefs = useRef({})                           // each slot's Change button, where focus returns
  const refocus = useRef(null)                            // the slot whose Change takes focus once its picker is gone
  const doneRef = useRef(null)

  const ask = useCallback(async () => {
    if (inFlight.current) { again.current = true; return }
    inFlight.current = true
    setAsking(true)
    const out = await previewMine(galleryId, latest.current)
    inFlight.current = false
    if (!alive.current) return
    if (out.ok) {
      setAnswer(out.data)
      setProblem(null)
      if (!primed.current) {
        primed.current = true
        const s = slotsOf(out.data)
        const q = questionsOf(out.data)
        const first = firstAnswers(s)
        setSlots(s)
        setQuestions(q)
        setAnswers(first.answers)
        setLabels(first.labels)
        setChoices(firstChoices(q))
        // The server already previewed the suggestions: the next ask is only for a change.
        latest.current = first.answers
      }
    } else {
      setProblem(refusalOf(out))
    }
    if (again.current) {
      again.current = false
      ask()
      return
    }
    setAsking(false)
  }, [galleryId])

  useEffect(() => {
    alive.current = true
    ask()
    return () => { alive.current = false; clearTimeout(timer.current) }
  }, [ask])

  // Focus returns to the Change control that opened a picker once the picker has closed (Done, Cancel, Enter, Escape).
  useEffect(() => {
    if (picking !== null || !refocus.current) return
    changeRefs.current[refocus.current]?.focus()
    refocus.current = null
  }, [picking])
  // After a tool's Use, focus moves to the Done button that replaced the Use button.
  useEffect(() => { if (added) doneRef.current?.focus() }, [added])

  const closePicker = (id) => {
    refocus.current = id
    setPicking(null)
  }

  /** A changed choice: the row moves at once; the preview is asked again 600 ms after the last change. */
  const pick = (slot, value, words) => {
    const next = { ...answers, [slot.id]: value }
    setAnswers(next)
    setLabels({ ...labels, [slot.id]: words })
    closePicker(slot.id)
    setUseProblem(null)
    latest.current = next
    clearTimeout(timer.current)
    setWaiting(true)
    timer.current = setTimeout(() => { timer.current = null; setWaiting(false); ask() }, DEBOUNCE_MS)
  }

  const missing = useMemo(() => listOf(slots).filter((s) => !answered(s, answers[s.id])), [slots, answers])
  const ready = slots !== null
  const canUse = ready && missing.length === 0 && !using && !added

  const use = async () => {
    if (useLock.current || !canUse) return
    useLock.current = true
    setUsing(true)
    setUseProblem(null)
    const body = { answers: { ...answers } }
    if (isTemplate) body.choices = { ...choices }
    const out = isUpdate ? await updateTool(kind, copyId, body)
      : isTemplateCopy ? await adoptTemplate(galleryId, body)
        : isTemplate ? await useTemplate(galleryId, body) : await adoptTool(galleryId, body)
    if (!alive.current) return
    if (!out.ok) {
      useLock.current = false
      setUsing(false)
      setUseProblem(refusalOf(out))
      return
    }
    // ⛔ The lock stays held: this sheet has made its one item. A throwing `onDone` never strands the member: the
    //    close and the move to the note (or the "Added" line) run whatever it does.
    if (isTemplate && !isTemplateCopy) {
      const noteId = isRecord(out.data.note) ? out.data.note.id : null
      try { onDone?.({ kind, editor, ...out.data }) } catch { /* the note is made: the close and the move still run */ }
      onClose?.()
      if (noteId != null && noteId !== '') {
        if (typeof landNote === 'function') landNote(out.data.note)
        else if (typeof navigate === 'function') navigate(noteHref(noteId))
        else openNoteInPlace({ button: 0, preventDefault() {} }, noteId)
      }
      return
    }
    setUsing(false)
    setAdded(true)
    try { onDone?.({ kind, editor, ...out.data }) } catch { /* the copy is made, and the sheet says so */ }
  }

  /** The Sheet's own close (Escape, the backdrop, a drag): ignored while Use is in flight (its answer must land);
   *  with a picker open it closes the picker, never the whole sheet and every pick with it. */
  const dismiss = () => {
    if (useLock.current && !added) return
    if (picking !== null) { closePicker(picking); return }
    onClose?.()
  }

  const credit = creditLine(answer)
  const busy = asking || waiting
  const ids = new Set(listOf(slots).map((s) => s.id))
  const atSlot = (p) => (p && p.slot && ids.has(p.slot) ? p.slot : null)
  const cards = listOf(answer?.cards).filter(isRecord)
  const tools = listOf(answer?.tools).filter(isRecord)

  return (
    <Sheet open onClose={dismiss} title={TITLE} labelledByTitle variant="auto" maxWidth={600}>
      <div className={styles.sheet} data-adopt-sheet={kind}>
        {credit && <p className={styles.credit} data-credit="">{credit}</p>}
        {problem && !atSlot(problem) && <Refusal p={problem} />}
        {useProblem && !atSlot(useProblem) && <Refusal p={useProblem} />}
        {added ? (
          <>
            <p className={styles.sent} role="status">{isUpdate ? UPDATED_SENTENCE : isTemplateCopy ? ADDED_TEMPLATE_SENTENCE : ADDED_SENTENCE}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.btnPrimary} ref={doneRef} onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            {!ready && !problem && <p className={styles.hint} role="status">{LOADING_SENTENCE}</p>}
            {ready && slots.length > 0 && (
              <section className={styles.section} aria-labelledby={`${uid}-choices`}>
                <h3 className={styles.subheading} id={`${uid}-choices`}>{CHOICES_HEADING}</h3>
                <ul className={styles.list}>
                  {slots.map((s) => {
                    const label = text(s.label) || 'Choice'
                    const open = picking === s.id
                    return (
                      <li key={s.id} className={styles.slotItem} data-slot={s.id}>
                        <div className={styles.slotRow}>
                          <span className={styles.slotText}>{`${label}: ${valueWords(s, answers[s.id], labels)}`}</span>
                          <button type="button" className={styles.btn} aria-expanded={open}
                            ref={(el) => { if (el) changeRefs.current[s.id] = el; else delete changeRefs.current[s.id] }}
                            aria-label={`${CHANGE_LABEL} ${label.toLowerCase()}`}
                            onClick={() => setPicking(open ? null : s.id)}>{CHANGE_LABEL}</button>
                        </div>
                        {atSlot(problem) === s.id && <Refusal p={problem} />}
                        {atSlot(useProblem) === s.id && <Refusal p={useProblem} />}
                        {open && (
                          <SlotPicker slot={s} answer={answers[s.id]} onCancel={() => closePicker(s.id)}
                            onPick={(value, words) => pick(s, value, words)} />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
            {ready && questions.map((q) => {
              const name = text(q.createName) || (q.kind === 'tracker' ? 'Tracker' : 'Routine')
              const c = choices[q.slot] || {}
              const has = isRecord(q.use) && q.use.id != null
              return (
                <fieldset key={q.slot} className={styles.section} data-question={q.slot}>
                  <legend className={styles.subheading}>{name}</legend>
                  {has && (
                    <label className={styles.choice}>
                      <input type="radio" name={`${uid}-${q.slot}`} checked={c.use === String(q.use.id)}
                        onChange={() => setChoices({ ...choices, [q.slot]: { use: String(q.use.id) } })} />
                      <span>{useYourWords(text(q.use.name) || name)}</span>
                    </label>
                  )}
                  <label className={styles.choice}>
                    <input type="radio" name={`${uid}-${q.slot}`} checked={c.create === true}
                      onChange={() => setChoices({ ...choices, [q.slot]: { create: true } })} />
                    <span>{createWords(name)}</span>
                  </label>
                </fieldset>
              )
            })}
            {answer && (cards.length > 0 || tools.length > 0) && (
              <section className={styles.section} aria-labelledby={`${uid}-preview`} aria-busy={busy || undefined}>
                <h3 className={styles.subheading} id={`${uid}-preview`}>{PREVIEW_HEADING}</h3>
                {busy && <p className={styles.hint} role="status">{UPDATING_SENTENCE}</p>}
                <ul className={styles.previewList}>
                  {cards.map((c, i) => <PreviewCard key={`c${i}`} card={c} />)}
                  {tools.map((t, i) => <PreviewTool key={`t${i}`} tool={t} />)}
                </ul>
              </section>
            )}
            <div className={styles.actions}>
              {ready && missing.length > 0 && <p className={styles.hint} id={`${uid}-missing`} data-missing="">{MISSING_HINT}</p>}
              <button type="button" className={styles.btn} onClick={onClose} disabled={using}>Cancel</button>
              {problem && !ready && (
                <button type="button" className={styles.btn} onClick={() => ask()}>Try again</button>
              )}
              <button type="button" className={styles.btnPrimary} disabled={!canUse} onClick={use}
                aria-describedby={ready && missing.length > 0 ? `${uid}-missing` : undefined}>
                {using ? 'Working…' : USE_LABEL}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
