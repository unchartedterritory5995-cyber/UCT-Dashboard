import { useId } from 'react'
import Section from './Section'
import styles from '../WidgetBuilderSheet.module.css'

/**
 * "Name it": pre-filled from what was picked ("Net P&L by setup, last 90 days", the server's own `defaultName`), and
 * following the picks until the member types in it; from then on it is theirs (spec 5.2). Clearing it hands it back.
 */
export default function NameSection({ name, nameTouched, subtitle, onName, onSubtitle }) {
  const nameId = useId()
  const hintId = useId()
  const subId = useId()
  return (
    <Section id="name" title="Name it">
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={nameId}>Name</label>
        <input id={nameId} className={styles.input} value={name} maxLength={200} aria-describedby={hintId}
          autoComplete="off" onChange={(e) => onName(e.target.value)} />
        <p className={styles.sectionHint} id={hintId}>
          {nameTouched ? 'Your name. Clear it to follow what you pick again.' : 'Follows what you pick until you type your own.'}
        </p>
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={subId}>Subtitle (optional)</label>
        <input id={subId} className={styles.input} value={subtitle} maxLength={200} autoComplete="off"
          onChange={(e) => onSubtitle(e.target.value)} />
      </div>
    </Section>
  )
}
