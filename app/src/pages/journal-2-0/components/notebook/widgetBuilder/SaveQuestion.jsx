import { useEffect, useId, useRef } from 'react'
import { PickerHead } from './sections/Section'
import styles from './WidgetBuilderSheet.module.css'

/**
 * Editing a widget that is in more than one note asks ONCE how to save (spec 5.2 step 4, §16.1):
 *
 *   "This widget is in 14 notes."   ( ) Update all 14 notes   ( ) Save as a new widget
 *
 * * Update all: the widget's placed revision moves; every placed copy (this note's included) keeps its snapshot and
 *   takes the new version on its next See it now. No note is written by the save.
 * * Save as a new widget: a new widget, used only by the note the builder was opened from.
 *
 * The preselected answer is the member's last answer for this widget; before there is one, a change to the name,
 * subtitle or colour only preselects "Update all", and a change to what is counted (filters, measures, split, range,
 * view) preselects "Save as a new widget" (`preselectAnswer`).
 */
export const UPDATE_ALL = 'update_all'
export const SAVE_NEW = 'save_new'

export function preselectAnswer({ lastAnswer, kind }) {
  if (lastAnswer === UPDATE_ALL || lastAnswer === SAVE_NEW) return lastAnswer
  return kind === 'display' ? UPDATE_ALL : SAVE_NEW
}

export const usedInSentence = (n) => `This widget is in ${n} notes.`

export default function SaveQuestion({ usedIn, answer, onAnswer, fromNote, busy, onConfirm, onBack }) {
  const setAnswer = onAnswer
  const name = useId()
  const first = useRef(null)
  useEffect(() => { first.current?.focus() }, [])
  return (
    <div>
      <PickerHead title="Save your changes" onBack={onBack} />
      <p className={styles.question} id={`${name}-q`}>{usedInSentence(usedIn)}</p>
      <div role="radiogroup" aria-labelledby={`${name}-q`} className={styles.optionGrid}>
        <label className={`${styles.option} ${answer === UPDATE_ALL ? styles.optionOn : ''}`}>
          <input ref={answer === UPDATE_ALL ? first : null} type="radio" className={styles.srOnlyInput} name={name}
            checked={answer === UPDATE_ALL} onChange={() => setAnswer(UPDATE_ALL)} />
          <span className={styles.optionLabel}>{`Update all ${usedIn} notes`}</span>
          <span className={styles.optionMeta}>Each note shows the new version the next time you press See it now.</span>
        </label>
        <label className={`${styles.option} ${answer === SAVE_NEW ? styles.optionOn : ''}`}>
          <input ref={answer === SAVE_NEW ? first : null} type="radio" className={styles.srOnlyInput} name={name}
            checked={answer === SAVE_NEW} onChange={() => setAnswer(SAVE_NEW)} />
          <span className={styles.optionLabel}>Save as a new widget</span>
          <span className={styles.optionMeta}>{fromNote ? 'Only this note changes. The other notes keep the widget as it was.' : 'The notes keep the widget as it was.'}</span>
        </label>
      </div>
      <div className={styles.pickerActions}>
        <button type="button" className={styles.btnPrimary} disabled={busy} aria-busy={busy}
          onClick={() => onConfirm(answer)} data-save-confirm="">
          {answer === UPDATE_ALL ? `Update all ${usedIn} notes` : 'Save as a new widget'}
        </button>
      </div>
    </div>
  )
}
