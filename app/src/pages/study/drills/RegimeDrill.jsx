/**
 * RegimeDrill — type 4 (spec §4.3): a breadth snapshot or an index chart from
 * a real past date; pick the tier the firm called.
 *
 * prompt_json: { question, facts?: [{label, value}], choices: [tier words], framing? }
 * With `facts` the item is text-only; without them the player shows the chart.
 * Answer: {choice}
 */
import ChoiceList from './ChoiceList'
import { barsWord, choiceAnswer, choiceAnswerable, choicesFromPrompt, questionOf } from './types'
import styles from './drills.module.css'

export function choicesOf(item) {
  return choicesFromPrompt(item)
}

export function framingOf(item) {
  const p = item?.prompt_json || {}
  if (p.framing) return p.framing
  if (Array.isArray(p.facts) && p.facts.length) return ''
  const n = Array.isArray(item?.bars?.bars) ? item.bars.bars.length : Array.isArray(item?.bars) ? item.bars.length : 0
  return n ? `Index chart, ${barsWord(n)} ending on the date in question.` : 'Index chart ending on the date in question.'
}

export function Body({ item, state, setState, locked }) {
  const facts = item?.prompt_json?.facts
  return (
    <div>
      {Array.isArray(facts) && facts.length > 0 && (
        <dl className={styles.facts}>
          {facts.map((f, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <ChoiceList
        choices={choicesOf(item)}
        value={state?.choice ?? null}
        onChange={(choice) => setState({ choice })}
        disabled={locked}
        label={questionOf(item) || 'Which tier?'}
      />
    </div>
  )
}

export const answerFromState = choiceAnswer
export const isAnswerable = choiceAnswerable

export default { Body, answerFromState, isAnswerable, choicesOf, framingOf }
