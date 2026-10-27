/**
 * SpotDrill — type 2 (spec §4.3): a real chart, ticker hidden. "Which setup is
 * this, or none?" The chart is the player's ONE StockChart; this body is the
 * setup choices under it, always ending in a "none" option.
 *
 * prompt_json: { question, choices: [setup names], none_label?: 'None of these',
 *                tf?: 'D', framing?: 'Daily chart, 120 bars to the cutoff' }
 * Answer: {choice}
 */
import ChoiceList from './ChoiceList'
import { barsWord, choiceAnswer, choiceAnswerable, choicesFromPrompt, questionOf } from './types'
import { hasStudyOverlay, studyAnnotations } from '../studyOverlays'

export const NONE_LABEL = 'None of these'

export function choicesOf(item) {
  const list = choicesFromPrompt(item)
  const none = item?.prompt_json?.none_label || NONE_LABEL
  const hasNone = list.some((c) => /^none/i.test(String(c)))
  return hasNone ? list : [...list, none]
}

export function framingOf(item) {
  const p = item?.prompt_json || {}
  if (p.framing) return p.framing
  const n = Array.isArray(item?.bars?.bars) ? item.bars.bars.length : Array.isArray(item?.bars) ? item.bars.length : 0
  const tf = p.tf || item?.bars?.tf || 'D'
  const tfWord = tf === 'W' ? 'Weekly' : tf === 'M' ? 'Monthly' : 'Daily'
  return n ? `${tfWord} chart, ${barsWord(n)} ending at the cutoff date. The ticker is hidden until you answer.`
           : `${tfWord} chart ending at the cutoff date. The ticker is hidden until you answer.`
}

export function Body({ item, state, setState, locked }) {
  return (
    <ChoiceList
      choices={choicesOf(item)}
      value={state?.choice ?? null}
      onChange={(choice) => setState({ choice })}
      disabled={locked}
      label={questionOf(item) || 'Which setup is this?'}
    />
  )
}

export const answerFromState = choiceAnswer
export const isAnswerable = choiceAnswerable

/**
 * Drawings for the player's ONE chart, on reveal only: a High Volume Edge item
 * carries the HVC ray + AVWAP (owner ruling 2026-10-25), a Gap Support item the
 * gap top + gap-day low rays (studyOverlays.js). Before the reveal the chart
 * stays bare: the question is whether the setup is there at all, and a level
 * drawn on the cutoff bar would answer it.
 */
export function annotationsFor(state, item, reveal, bars) {
  if (!reveal || !hasStudyOverlay(item)) return null
  return studyAnnotations(item, bars)
}

export default { Body, answerFromState, isAnswerable, choicesOf, framingOf, annotationsFor }
