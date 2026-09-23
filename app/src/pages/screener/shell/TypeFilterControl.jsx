import { useEffect, useState } from 'react'
import styles from './ScannerShell.module.css'

// ── The Type filter — Include / Exclude a set of instrument types ────────────
// Renders for the `security_type` filter (meta `control: "typeset"`). Emits
//   Include → { op: 'in',     values: ['Stock','ADR'] }   (only these types)
//   Exclude → { op: 'not_in', values: ['ETF'] }           (everything but these)
// and `null` when nothing is checked (no filter). The bucket value stored is the
// singular `security_type` the rows carry ("Stock"/"ADR"/"ETF"); the label is
// pluralised for display only.
//
// ⛔ THE MODE IS LOCAL STATE, NOT DERIVED FROM `value`. Deriving it meant the
// Exclude tab could never light up until something was already checked (an empty
// selection emits `null`, and a null value read back as Include) — so a member
// could not pick Exclude first. Local state lets the toggle lead; a re-emit
// happens only when there is a selection to re-key.
const plural = (t) => (t.endsWith('s') ? t : `${t}s`)

export default function TypeFilterControl({ filter, value, onChange }) {
  const options = filter.options || []
  const [mode, setMode] = useState(value?.op === 'not_in' ? 'not_in' : 'in')
  // Follow an externally-changed value (a scan applied, Clear all) — but the
  // toggle may also lead the value, which is why mode is not derived outright.
  useEffect(() => {
    if (value?.op && value.op !== mode) setMode(value.op)
  }, [value?.op])  // eslint-disable-line react-hooks/exhaustive-deps

  const selected = new Set(value?.values || [])
  const emit = (m, sel) => onChange(sel.size ? { op: m, values: [...sel] } : null)
  const pickMode = (m) => { setMode(m); emit(m, selected) }
  const toggle = (opt) => {
    const next = new Set(selected)
    next.has(opt) ? next.delete(opt) : next.add(opt)
    emit(mode, next)
  }

  return (
    <div className={styles.typeCtl}>
      <div className={styles.typeToggle} role="group" aria-label="Include or exclude types">
        <button type="button" aria-pressed={mode === 'in'}
          className={`${styles.typeToggleBtn} ${mode === 'in' ? styles.typeToggleOn : ''}`}
          onClick={() => pickMode('in')}>Include</button>
        <button type="button" aria-pressed={mode === 'not_in'}
          className={`${styles.typeToggleBtn} ${mode === 'not_in' ? styles.typeToggleOn : ''}`}
          onClick={() => pickMode('not_in')}>Exclude</button>
      </div>
      <div className={styles.typeOpts}>
        {options.map(opt => (
          <label key={opt} className={styles.typeOpt}>
            <input type="checkbox" checked={selected.has(opt)}
              onChange={() => toggle(opt)}
              aria-label={`${mode === 'not_in' ? 'Exclude' : 'Include'} ${plural(opt)}`} />
            <span>{plural(opt)}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
