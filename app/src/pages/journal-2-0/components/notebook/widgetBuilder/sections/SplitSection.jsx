import { useEffect, useId, useState } from 'react'
import UIcon from '../../../../../../components/ui/UIcon'
import Section, { PickerHead } from './Section'
import { splitFields, reasonOf, thenAllowed, refKindOf, refName } from '../builderCatalog'
import { measureLabel } from '../formulaFields'
import styles from '../WidgetBuilderSheet.module.css'

/**
 * "Split it by": optional, one field, and a second ("then by") for tables only. With a split the member can order
 * the groups by a measure and keep the top N (at most 40). A second split is offered while the view is a table or
 * still the suggested one (it then becomes a table); otherwise it is disabled with the engine's own sentence.
 * The member's own row fields that give text or yes/no split too (wave 10, Task 10.16): the sheet hands this section
 * a catalog whose fields include them (`formulaFields.withFormulaFields`), and they read by their own names.
 */
export default function SplitSection({ cat, plan, toolNames, onOpen, onClear, onSort }) {
  const thenReasonId = useId()
  const sortId = useId()
  const topId = useId()
  const fields = new Map(splitFields(cat, plan).map((f) => [f.key, f]))
  const split = plan.split
  // A field that names a routine or tracker reads as that one ("Split by Sleep"), wave 9.
  const labelOf = (key, ref) => {
    const f = fields.get(key)
    return refKindOf(f) && ref ? refName(f, ref, toolNames) : f?.label || key
  }
  const byLabel = split ? labelOf(split.by, split.ref) : null
  const thenLabel = split?.then ? labelOf(split.then, split.ref2) : null
  const thenOk = thenAllowed(cat, plan)
  const sortValue = plan.sort ? `${plan.sort.measure}:${plan.sort.dir}` : ''
  return (
    <Section id="split" title="Split it by" hint="Optional.">
      <div className={styles.chipRow}>
        <button type="button" className={styles.chip} onClick={(e) => onOpen('by', e.currentTarget)}
          aria-label={split ? `Split by ${byLabel}. Change` : 'No split. Pick one'}>
          <span>{split ? byLabel : 'No split'}</span>
        </button>
        {split && (
          <button type="button" className={styles.chipRemove} aria-label={`Remove split: ${byLabel}`}
            onClick={() => onClear('by')}>
            <UIcon name="x" size={14} gold={false} aria-hidden="true" />
          </button>
        )}
      </div>
      {split && (
        <>
          <div className={styles.chipRow}>
            <span className={styles.fieldLabel}>Then by</span>
            <button type="button" className={styles.chip} disabled={!thenOk && !split.then}
              aria-describedby={!thenOk && !split.then ? thenReasonId : undefined}
              onClick={(e) => onOpen('then', e.currentTarget)}
              aria-label={split.then ? `Then by ${thenLabel}. Change` : 'No second split. Pick one'}>
              <span>{split.then ? thenLabel : 'Nothing'}</span>
            </button>
            {split.then && (
              <button type="button" className={styles.chipRemove} aria-label={`Remove second split: ${thenLabel}`}
                onClick={() => onClear('then')}>
                <UIcon name="x" size={14} gold={false} aria-hidden="true" />
              </button>
            )}
          </div>
          {!thenOk && !split.then && (
            <p className={styles.reason} id={thenReasonId}>{reasonOf(cat, 'then_table_only')}</p>
          )}
          <div className={styles.pair}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={sortId}>Order</label>
              <select id={sortId} className={styles.select} value={sortValue}
                onChange={(e) => {
                  if (!e.target.value) { onSort(null); return }
                  const [mi, dir] = e.target.value.split(':')
                  onSort({ measure: Number(mi), dir, top: plan.sort?.top ?? 10 })
                }}>
                <option value="">In their own order</option>
                {plan.measures.map((pm, i) => {
                  const label = measureLabel(cat, plan, pm, toolNames)
                  return [
                    <option key={`${i}d`} value={`${i}:desc`}>{`${label}, highest first`}</option>,
                    <option key={`${i}a`} value={`${i}:asc`}>{`${label}, lowest first`}</option>,
                  ]
                })}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={topId}>Show the top</label>
              <TopInput id={topId} max={cat.topMax} disabled={!plan.sort} value={plan.sort?.top ?? 10}
                onCommit={(n) => onSort({ ...plan.sort, top: n })} />
            </div>
          </div>
        </>
      )}
    </Section>
  )
}

/** The split picker: "No split" (for the first) or "Nothing" (for the second), then every field that can split. */
export function SplitPicker({ cat, plan, slot, onPick, onBack }) {
  const fields = splitFields(cat, plan).filter((f) => slot === 'by' || f.key !== plan.split?.by)
  const current = slot === 'by' ? plan.split?.by || null : plan.split?.then || null
  return (
    <div>
      <PickerHead title={slot === 'by' ? 'Split it by' : 'Then split by'} onBack={onBack} />
      <ul className={styles.pickerList} aria-label="Fields">
        <li>
          <button type="button" className={`${styles.option} ${current === null ? styles.optionOn : ''}`}
            aria-pressed={current === null} onClick={() => onPick(null)}>
            <span className={styles.optionLabel}>{slot === 'by' ? 'No split' : 'Nothing'}</span>
          </button>
        </li>
        {fields.map((f) => (
          <li key={f.key}>
            <button type="button" className={`${styles.option} ${current === f.key ? styles.optionOn : ''}`}
              aria-pressed={current === f.key} onClick={() => onPick(f.key)}>
              <span className={styles.optionLabel}>{f.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** "Show the top": what was typed is kept while it is typed (a box that snaps back on every key cannot be cleared to
 *  type 25); a whole number from 1 to the cap is applied, anything else goes back to the last good value on blur. */
function TopInput({ id, max, disabled, value, onCommit }) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  const valid = (t) => /^\d+$/.test(t) && Number(t) >= 1 && Number(t) <= max
  return (
    <input id={id} type="number" inputMode="numeric" min={1} max={max} className={styles.input} disabled={disabled}
      value={text}
      onChange={(e) => { setText(e.target.value); if (valid(e.target.value)) onCommit(Number(e.target.value)) }}
      onBlur={() => { if (!valid(text)) setText(String(value)) }} />
  )
}
