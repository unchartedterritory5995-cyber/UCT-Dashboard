import { useId } from 'react'
import Section from './Section'
import styles from '../WidgetBuilderSheet.module.css'

/**
 * "What to look at": large tiles, one per kind of row, each with its one-line description (spec 5.2). The tiles are
 * a RADIO GROUP of native radios (spec 5.11: arrow keys move, the choice follows), styled as tiles; the radio itself
 * is visually hidden, never removed, so the group keeps its keyboard and screen-reader behaviour for free.
 * "Accounts" sits here too: all of them (the default) or one, shown on the widget.
 */
export default function SourceSection({ cat, plan, accounts, onSource, onAccounts }) {
  const name = useId()
  const accId = useId()
  const sources = [...cat.sources.values()]
  const accValue = plan.accounts && typeof plan.accounts === 'object' ? plan.accounts.id : ''
  return (
    <Section id="source" title="What to look at">
      <div className={styles.tiles} role="radiogroup" aria-label="What to look at">
        {sources.map((s) => {
          const on = plan.source === s.key
          return (
            <label key={s.key} className={`${styles.tile} ${on ? styles.tileOn : ''}`}>
              <input type="radio" className={styles.srOnlyInput} name={name} value={s.key} checked={on}
                aria-label={s.label} aria-describedby={s.description ? `${name}-${s.key}` : undefined}
                onChange={() => onSource(s.key)} />
              <span className={styles.tileTitle} aria-hidden="true">{s.label}</span>
              {s.description && <span className={styles.tileDesc} id={`${name}-${s.key}`}>{s.description}</span>}
            </label>
          )
        })}
      </div>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={accId}>Accounts</label>
        <select id={accId} className={styles.select} value={accValue}
          onChange={(e) => onAccounts(e.target.value ? { id: e.target.value } : 'all')}>
          <option value="">All my accounts</option>
          {[...accounts.entries()].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          {accValue && !accounts.has(accValue) && <option value={accValue}>An account no longer in your Journal</option>}
        </select>
      </div>
    </Section>
  )
}
