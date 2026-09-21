import styles from './ScannerShell.module.css'

// ── The Type filter — Include / Exclude a set of instrument types ────────────
// Renders for the `security_type` filter (meta `control: "typeset"`). Emits
//   Include → { op: 'in',     values: ['Stock','ADR'] }   (only these types)
//   Exclude → { op: 'not_in', values: ['ETF'] }           (everything but these)
// and `null` when nothing is checked (no filter). The bucket value stored is the
// singular `security_type` the rows carry ("Stock"/"ADR"/"ETF"); the label is
// pluralised for display only.
const plural = (t) => (t.endsWith('s') ? t : `${t}s`)

export default function TypeFilterControl({ filter, value, onChange }) {
  const options = filter.options || []
  const mode = value?.op === 'not_in' ? 'not_in' : 'in'   // default Include
  const selected = new Set(value?.values || [])

  const emit = (m, sel) => onChange(sel.size ? { op: m, values: [...sel] } : null)
  const setMode = (m) => { if (m !== mode) emit(m, selected) }
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
          onClick={() => setMode('in')}>Include</button>
        <button type="button" aria-pressed={mode === 'not_in'}
          className={`${styles.typeToggleBtn} ${mode === 'not_in' ? styles.typeToggleOn : ''}`}
          onClick={() => setMode('not_in')}>Exclude</button>
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
