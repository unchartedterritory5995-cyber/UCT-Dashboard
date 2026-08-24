import { useEffect, useId, useState } from 'react'
import ColumnDesc from './ColumnDesc'
import FilterBand from './FilterBand'
import styles from './ScannerShell.module.css'

const currentLabel = (filter, value, customOpen) => {
  if (customOpen) return 'Custom…'
  if (!value) return 'Any'
  const match = (filter.presets || []).find(o =>
    o.op === value.op && o.value === value.value && o.min === value.min && o.max === value.max)
  return match ? match.label : 'Custom…'
}

export default function FilterControl({ filter, value, onChange, basis = null }) {
  const [customOpen, setCustomOpen] = useState(false)
  const [minV, setMinV] = useState(value?.min ?? '')
  const [maxV, setMaxV] = useState(value?.max ?? '')

  // A spec applied from outside (saved screen, URL) re-seeds the inputs.
  useEffect(() => { setMinV(value?.min ?? ''); setMaxV(value?.max ?? '') }, [value])

  const commit = (lo = minV, hi = maxV) => {
    const hasMin = lo !== '' && lo != null
    const hasMax = hi !== '' && hi != null
    if (!hasMin && !hasMax) { setCustomOpen(false); onChange(null); return }
    if (hasMin && hasMax) onChange({ op: 'between', min: +lo, max: +hi })
    else if (hasMin) onChange({ op: 'gte', min: +lo })
    else onChange({ op: 'lte', max: +hi })
  }

  const onSelect = label => {
    if (label === 'Custom…') { setCustomOpen(true); return }
    setCustomOpen(false)
    const p = (filter.presets || []).find(o => o.label === label)
    if (!p || label === 'Any') { onChange(null); return }
    const spec = { op: p.op }
    if (p.value !== undefined) spec.value = p.value
    if (p.min !== undefined) spec.min = p.min
    if (p.max !== undefined) spec.max = p.max
    // The label rides into saved/shared specs; K9 — preset re-find above
    // compares only op/value/min/max, so this extra field is invisible to
    // currentLabel and can never cause a preset to mismatch itself.
    if (filter.key === 'scan' && p.label && p.label !== 'Any') spec.label = p.label
    onChange(spec)
  }

  const options = (filter.presets || []).map(p => p.label)
  if (filter.allow_custom && !options.includes('Custom…')) options.push('Custom…')
  const onKey = e => { if (e.key === 'Enter') commit() }

  // ⛔ THE MEASUREMENT MUST BE ASSOCIATED WITH THE CONTROL, NOT JUST NEAR IT.
  // A member moving select-to-select through the rail is in a screen reader's
  // FORMS mode — the natural way to work a filter panel — where nothing but the
  // control's own name, value and DESCRIPTION is spoken. Without this the
  // measured band and the refusal sentence below are both silent at exactly the
  // moment they matter: while a threshold is being chosen. Same idiom as
  // `ColumnDesc`'s `aria-describedby`, deliberately, rather than a second one.
  //
  // ⭐ The id is `useId`-scoped like ColumnDesc's panel id, not `fb_${key}`:
  // below 1024px `.railSlot` is `display:none` but still IN THE DOM while
  // `FiltersSheet` re-hosts a second copy of the whole rail, so a key-derived
  // id would be duplicated and the association would resolve to whichever copy
  // came first — quite possibly the hidden one.
  const uid = useId()
  const bandId = `fb${uid}${filter.key}`
  const speaks = FilterBand.speaks(filter.distribution, basis)

  return (
    <div className={styles.filterRow}>
      {/* The honesty text belongs HERE as much as on the results header: the
          misreading that matters happens when a member picks a threshold, not
          when they read a cell back. `meta()` ships no description of its own,
          so the join is filter.key → COLUMN_DEFS[key] — the registry keys the
          snapshot column of the same name for every filter but one (`pattern`,
          whose column is `patterns` and which carries no `desc`). `ColumnDesc`
          renders nothing when the column has none, so most rows are unchanged. */}
      {/* `tapTarget` is set HERE and nowhere else. Below 1024px this rail is
          `display:none` and its whole content is re-hosted inside FiltersSheet,
          so the rail IS the touch surface for filters — and the row has slack
          beside the label, which the 112px results-header track does not. The
          span is `align-items:center`, so a 44px trigger raises the span (and
          the row with it) instead of overflowing anything. */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <label className={styles.filterLabel} htmlFor={`fc_${filter.key}`}>{filter.label}</label>
        <ColumnDesc colKey={filter.key} name={filter.label} tapTarget />
      </span>
      <select id={`fc_${filter.key}`} aria-label={filter.label}
        aria-describedby={speaks ? bandId : undefined}
        className={`${styles.filterSelect} ${value ? styles.filterSelectActive : ''}`}
        value={currentLabel(filter, value, customOpen)}
        onChange={e => onSelect(e.target.value)}>
        {options.map(o => <option key={o}>{o}</option>)}
      </select>
      {/* ⭐ THE MEASUREMENT, ON SCREEN, WHERE THE THRESHOLD IS SET. `meta()` has
          shipped p5/p25/p50/p75/p95 per range control since the bands lane, and
          for one commit nothing rendered them — the payload existed and the
          member still saw a blank box, which is the very finding that lane was
          opened to answer. It sits BELOW the select on purpose: the numbers are
          context for the value you are about to type, not a value to pick, and
          nothing about them may look like an option in the list. */}
      <FilterBand band={filter.distribution} basis={basis} unit={filter.unit}
        id={bandId} />
      {customOpen && (
        <div className={styles.customRange}>
          <input type="number" placeholder="min" aria-label={`${filter.label} min`}
            value={minV} onChange={e => setMinV(e.target.value)}
            onKeyDown={onKey} onBlur={() => commit()} />
          <input type="number" placeholder="max" aria-label={`${filter.label} max`}
            value={maxV} onChange={e => setMaxV(e.target.value)}
            onKeyDown={onKey} onBlur={() => commit()} />
        </div>
      )}
    </div>
  )
}
