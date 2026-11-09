/**
 * ScenarioDrill — type 15 (spec §4.3): a short story in the mentor's voice with
 * a decision at the end.
 *
 * prompt_json: { story, question, choices: [..] }
 * Answer: {choice}
 */
import ChoiceList, { revealLabels } from './ChoiceList'
import { brandWords, choiceAnswer, choiceAnswerable, choicesFromPrompt, questionOf } from './types'
import styles from './drills.module.css'

export function choicesOf(item) {
  return choicesFromPrompt(item)
}

export function Body({ item, state, setState, locked, reveal }) {
  const story = item?.prompt_json?.story
  return (
    <div>
      {story && <p className={styles.story}>{brandWords(story)}</p>}
      <ChoiceList {...revealLabels(reveal, state)}
        choices={choicesOf(item)}
        value={state?.choice ?? null}
        onChange={(choice) => setState({ choice })}
        disabled={locked}
        label={questionOf(item) || 'What do you do?'}
      />
    </div>
  )
}

export const answerFromState = choiceAnswer
export const isAnswerable = choiceAnswerable

export default { Body, answerFromState, isAnswerable, choicesOf }
