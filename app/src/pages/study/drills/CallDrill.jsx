/**
 * CallDrill — types 5 and 10 (spec §4.3): a Sunday Scans chart image, or an
 * archived call's chart, from a past date: take it, pass, or watch. Scored
 * against what price did afterwards under the fair-scoring rule (C17).
 *
 * prompt_json: { question, image_url?, image_alt?, choices?: ['Take','Pass','Watch'], framing? }
 * With `image_url` the body shows the image; otherwise the player shows the chart.
 * Answer: {choice} (lower-cased: take | pass | watch)
 */
import ChoiceList from './ChoiceList'
import { barsWord, choiceAnswerable, choicesFromPrompt, questionOf } from './types'
import styles from './drills.module.css'

export const CALL_CHOICES = ['Take', 'Pass', 'Watch']

export function choicesOf(item) {
  const list = choicesFromPrompt(item, CALL_CHOICES)
  return list.length ? list : CALL_CHOICES
}

export function framingOf(item) {
  const p = item?.prompt_json || {}
  if (p.framing) return p.framing
  if (p.image_url) return p.image_alt || 'A chart from a past Sunday Scans issue. The ticker is hidden until you answer.'
  const n = Array.isArray(item?.bars?.bars) ? item.bars.bars.length : Array.isArray(item?.bars) ? item.bars.length : 0
  return n ? `Daily chart, ${barsWord(n)} ending the night the call was made. The ticker is hidden until you answer.`
           : 'Daily chart ending the night the call was made. The ticker is hidden until you answer.'
}

export function Body({ item, state, setState, locked }) {
  const p = item?.prompt_json || {}
  return (
    <div>
      {p.image_url && (
        <img className={styles.image} src={p.image_url} alt={p.image_alt || 'Chart from the issue, ticker hidden'} />
      )}
      <ChoiceList
        choices={choicesOf(item)}
        value={state?.choice ?? null}
        onChange={(choice) => setState({ choice })}
        disabled={locked}
        label={questionOf(item) || 'Take it, pass, or watch?'}
      />
    </div>
  )
}

export function answerFromState(state) {
  const c = state?.choice
  return { choice: c == null ? null : String(c).trim().toLowerCase() }
}

export const isAnswerable = choiceAnswerable

export default { Body, answerFromState, isAnswerable, choicesOf, framingOf }
