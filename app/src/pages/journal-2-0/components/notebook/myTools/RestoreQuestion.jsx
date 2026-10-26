import { useId } from 'react'
import { UPDATE_ALL, SAVE_NEW, usedInSentence } from '../widgetBuilder/SaveQuestion'
import PanelHead from './PanelHead'
import styles from './myTools.module.css'

/**
 * After a version restore, when the widget is in more than one note: the builder's question (spec 5.2 step 4), asked
 * in My tools' own terms and sizes. The answer constants and the "This widget is in N notes." sentence are the
 * builder's (SaveQuestion), so the two places ask the same thing.
 *
 *   "Restore this version?"   This widget is in 14 notes.
 *     ( ) Update all 14 notes       each note takes this version on its next See it now
 *     ( ) Save as a new widget      the notes keep the widget as it was
 *
 * Back ("Back to versions") keeps the restored version as this widget's newest and leaves the notes as they are. A
 * stale tab gets the server's sentence and a Reload button.
 */
export default function RestoreQuestion({ usedIn, answer, onAnswer, busy, onConfirm, onBack, error, onReload }) {
  const name = useId()
  return (
    <div className={styles.pushPanel} data-testid="my-tools-history-question">
      <PanelHead title="Restore this version?" onBack={onBack} backLabel="Back to versions" />
      <p className={styles.sentence} id={`${name}-q`}>{usedInSentence(usedIn)}</p>
      <div role="radiogroup" aria-labelledby={`${name}-q`} className={styles.options}>
        <label className={`${styles.option} ${answer === UPDATE_ALL ? styles.optionOn : ''}`}>
          <input type="radio" className={styles.radio} name={name} checked={answer === UPDATE_ALL}
            onChange={() => onAnswer(UPDATE_ALL)} />
          <span className={styles.optionText}>
            <span className={styles.optionLabel}>{`Update all ${usedIn} notes`}</span>
            <span className={styles.hint}>Each note takes this version the next time you press See it now.</span>
          </span>
        </label>
        <label className={`${styles.option} ${answer === SAVE_NEW ? styles.optionOn : ''}`}>
          <input type="radio" className={styles.radio} name={name} checked={answer === SAVE_NEW}
            onChange={() => onAnswer(SAVE_NEW)} />
          <span className={styles.optionText}>
            <span className={styles.optionLabel}>Save as a new widget</span>
            <span className={styles.hint}>The notes keep the widget as it was.</span>
          </span>
        </label>
      </div>
      {error && <p className={styles.inlineError}>{error.text}</p>}
      <div className={styles.actions}>
        {error?.conflict && <button type="button" className={styles.btn} aria-disabled={busy || undefined} onClick={() => { if (!busy) onReload() }}>Reload</button>}
        <button type="button" className={styles.btnPrimary} aria-disabled={busy || undefined} aria-busy={busy || undefined}
          data-question-confirm="" onClick={() => { if (!busy) onConfirm(answer) }}>
          {answer === UPDATE_ALL ? `Update all ${usedIn} notes` : 'Save as a new widget'}
        </button>
      </div>
    </div>
  )
}
