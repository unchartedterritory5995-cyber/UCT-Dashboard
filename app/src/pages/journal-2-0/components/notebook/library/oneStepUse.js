// Audit 2026-11-05, spec S9 (the audit's M8): "Use" makes the note AT ONCE.
//
// It was four steps (Preview, "Use this template", a second sheet "Make it yours", Use), the note came out untitled,
// and a routine and a style were added behind the member's back. Now one press:
//   * the server's own first answers for every choice (ONE `previewMine`, exactly the values "Make it yours" opens
//     with: `firstAnswers`, shared with AdoptSheet, never a second reading of them);
//   * each reuse question answered without asking: the member's own routine or tracker when the server found one
//     (`use`), a new one ONLY when "Also start this every weekday" is ticked (`create`), else "not now" (`skip`, the
//     slot lands as plain note content and nothing is made: slot_fill.is_skip_choice);
//   * the note titled "{Template} · {Ddd, Mon D}" (`templateNoteTitle`), made through the ONE keyed `useTemplate`.
// A choice the server could not answer (no suggestion and no Any) cannot be guessed: the answer is
// `{ok: false, customize: true}` and the caller opens Customize first (the adoption sheet) for it.
// ⛔ LAZY. Reached only by dynamic import (the Template library's Use) and by AdoptSheet, itself lazy.
import { previewMine, useTemplate } from '../../../lib/templateLibrary'
import { numberOf } from './SlotPicker'

/** M8's checkbox, unticked by default: the one way a Use starts a routine or tracker. */
export const START_EVERY_WEEKDAY = 'Also start this every weekday'
/** The optional second door beside Use: the adoption sheet, with every choice. */
export const CUSTOMIZE_FIRST = 'Customize first'

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
 * re-derives that rule, and never reads `sampleValue` (what a Sample data card ran with instead) or a card's payload.
 * A value the sheet cannot send leaves the choice unpicked.
 */
export function firstAnswers(slots) {
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

export const slotsOf = (data) => listOf(data?.slots).filter((s) => isRecord(s) && typeof s.id === 'string' && s.id)
export const questionsOf = (data) => listOf(data?.questions).filter((q) => isRecord(q) && typeof q.slot === 'string' && q.slot)

/** A reuse question's answer: the member's own when the server found one, else start one only when asked to. */
export function questionChoice(q, startEveryWeekday) {
  if (isRecord(q.use) && q.use.id != null) return { use: String(q.use.id) }
  return startEveryWeekday ? { create: true } : { skip: true }
}

/** "Thu, Nov 5": the day the note is made, in New York (the Notebook's day). */
export function noteDayWords(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
    .formatToParts(now)
  const get = (t) => parts.find((p) => p.type === t)?.value || ''
  return `${get('weekday')}, ${get('month')} ${get('day')}`
}

/** "Pre-market plan · Thu, Nov 5". A template with no name gives the day alone. */
export function templateNoteTitle(name, now = new Date()) {
  const n = text(name).trim()
  return n ? `${n} · ${noteDayWords(now)}` : noteDayWords(now)
}

/**
 * Use a listed template in one press. Answers `{ok: true, data}` (the server's `{note, ...}`), `{ok: false,
 * customize: true}` when a choice needs the member, or the library's own refusal `{ok: false, code, message}`.
 */
export async function useTemplateNow(galleryId, { name, startEveryWeekday = false, now } = {}) {
  const pre = await previewMine(galleryId)
  if (!pre.ok) return pre
  const slots = slotsOf(pre.data)
  const { answers } = firstAnswers(slots)
  if (slots.some((s) => !answered(s, answers[s.id]))) return { ok: false, customize: true }
  const choices = {}
  for (const q of questionsOf(pre.data)) choices[q.slot] = questionChoice(q, startEveryWeekday)
  return useTemplate(galleryId, { answers, choices, title: templateNoteTitle(name, now) })
}
