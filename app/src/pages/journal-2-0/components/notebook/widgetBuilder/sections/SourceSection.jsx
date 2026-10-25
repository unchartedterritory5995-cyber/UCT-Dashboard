import { useId, useRef, useState } from 'react'
import Section from './Section'
import { allAccountsOnly } from '../builderCatalog'
import styles from '../WidgetBuilderSheet.module.css'

/**
 * "What to look at": large tiles, one per kind of row, each with its one-line description (spec 5.2).
 *
 * ⛔ A ROVING-FOCUS RADIO GROUP, not native radios (fix 1, I-12). Choosing another kind of row RESETS the filters,
 * split and order, and a native radio group selects on every arrow key, so a keyboard member walking the tiles to
 * read them would wipe their work tile by tile. Here the arrow keys move FOCUS only (one Tab stop, the chosen tile);
 * Enter or Space chooses. Each tile is `role="radio"` with `aria-checked`, named by its label and described by its
 * line. "Accounts" sits here too: all of them (the default) or one, shown on the widget. A routine or tracker source
 * covers every account (plan.S_TOOL_ACCOUNTS), so there it is not shown at all (wave 9).
 */
export function RovingTiles({ label, options, value, onChoose }) {
  const ids = useId()
  const refs = useRef([])
  const chosen = Math.max(0, options.findIndex((o) => o.key === value))
  const [focusAt, setFocusAt] = useState(null)
  const tabAt = focusAt ?? chosen
  const move = (to) => {
    const n = options.length
    const i = ((to % n) + n) % n
    setFocusAt(i)
    refs.current[i]?.focus()
  }
  const onKeyDown = (e, i) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1) }
    else if (e.key === 'Home') { e.preventDefault(); move(0) }
    else if (e.key === 'End') { e.preventDefault(); move(options.length - 1) }
  }
  return (
    <div className={styles.tiles} role="radiogroup" aria-label={label}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusAt(null) }}>
      {options.map((o, i) => {
        const on = o.key === value
        const descId = `${ids}-${i}`
        return (
          <button key={o.key} type="button" role="radio" aria-checked={on} ref={(el) => { refs.current[i] = el }}
            tabIndex={i === tabAt ? 0 : -1} className={`${styles.tile} ${on ? styles.tileOn : ''}`}
            aria-label={o.label} aria-describedby={o.description ? descId : undefined}
            onKeyDown={(e) => onKeyDown(e, i)} onFocus={() => setFocusAt(i)}
            onClick={() => { if (!on) onChoose(o.key) }}>
            <span className={styles.tileTitle} aria-hidden="true">{o.label}</span>
            {o.description && <span className={styles.tileDesc} id={descId}>{o.description}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default function SourceSection({ cat, plan, accounts, onSource, onAccounts }) {
  const accId = useId()
  const sources = [...cat.sources.values()].map((s) => ({ key: s.key, label: s.label, description: s.description }))
  const accValue = plan.accounts && typeof plan.accounts === 'object' ? plan.accounts.id : ''
  return (
    <Section id="source" title="What to look at">
      <RovingTiles label="What to look at" options={sources} value={plan.source} onChoose={onSource} />
      {!allAccountsOnly(cat, plan.source) && <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={accId}>Accounts</label>
        <select id={accId} className={styles.select} value={accValue}
          onChange={(e) => onAccounts(e.target.value ? { id: e.target.value } : 'all')}>
          <option value="">All my accounts</option>
          {[...accounts.entries()].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          {accValue && !accounts.has(accValue) && <option value={accValue}>An account no longer in your Journal</option>}
        </select>
      </div>}
    </Section>
  )
}
