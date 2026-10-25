import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import UIcon from '../../../../../../components/ui/UIcon'
import Section, { PickerHead } from './Section'
import { THEMES, measuresFor, coverageText, reasonOf, propTypesOf } from '../builderCatalog'
import { measureLabel, measureId } from '../formulaFields'
import { loadVocabulary } from '../../../../lib/builtWidgets'
import { loadPropertyDefs } from '../propertyDefs'
import styles from '../WidgetBuilderSheet.module.css'

/**
 * "What to measure": the picked measures (1 to 3) as chips, each with its coverage on this member's data when it
 * needs a per-row value ("R known on 23 of 47 trades", from the last preview), and "+ Measure" to open the picker.
 * The last measure cannot be removed: a widget measures something. A measure may be one of the member's own fields
 * (wave 10, Task 10.16), named by its own name ("Exit efficiency (average)"); it is added and taken out from "Your own
 * fields", and its chip opens the same picker.
 */
export default function MeasureSection({ cat, plan, byNeed, toolNames, onOpen, onRemove }) {
  const lastId = useId()
  const only = plan.measures.length <= 1
  return (
    <Section id="measure" title="What to measure">
      <ul className={styles.filterList}>
        {plan.measures.map((pm, i) => {
          const m = pm.key ? cat.measures.get(pm.key) : null
          const label = measureLabel(cat, plan, pm, toolNames)
          const cov = coverageText(cat, m, byNeed)
          return (
            <li key={measureId(pm)} className={styles.measureItem}>
              <div className={styles.filterItem}>
                <button type="button" className={styles.chip} aria-label={`${label}. Change measures`}
                  onClick={(e) => onOpen(e.currentTarget)}>
                  <span>{label}</span>
                </button>
                <button type="button" className={styles.chipRemove} aria-label={`Remove measure: ${label}`}
                  disabled={only} aria-describedby={only ? lastId : undefined} onClick={() => onRemove(i)}>
                  <UIcon name="x" size={14} gold={false} aria-hidden="true" />
                </button>
              </div>
              {cov && <p className={styles.coverage}>{cov}</p>}
            </li>
          )
        })}
      </ul>
      {only && <p className={styles.srOnly} id={lastId}>{reasonOf(cat, 'no_measure')}</p>}
      <button type="button" className={styles.addBtn} onClick={(e) => onOpen(e.currentTarget)}>
        <UIcon name="plus" size={14} gold={false} aria-hidden="true" />
        <span>{plan.measures.length < cat.maxMeasures ? 'Measure' : 'Change measures'}</span>
      </button>
    </Section>
  )
}

const LONG_PRESS_MS = 450

/**
 * Wave 10 (Task 10.17): "Sum of a property" adds up ONE of the member's properties, picked here by name: the member's
 * properties (`GET /vocabulary?field=property`, the notes source's own rule, read again on each open) of a type the
 * measure's catalog row says it adds up (`prop.types`, W10-R66: be sources.PROP_SUM_TYPES). Each toggles a sum of that
 * property in or out (`{key, prop}`); several may be summed side by side. The definitions read with them are handed to
 * the builder so the chips name the property.
 */
export function PropertyMeasurePicker({ cat, plan, measureKey, onToggle, onToolNames, onBack }) {
  const [state, setState] = useState(null)       // null while loading, then {list, failed}
  const [tick, setTick] = useState(0)
  const fullId = useId()
  const types = propTypesOf(cat.measures.get(measureKey)) || []
  useEffect(() => {
    let alive = true
    setState(null)
    Promise.allSettled([loadVocabulary('property', { fresh: true }), loadPropertyDefs()]).then(([v, d]) => {
      if (!alive) return
      if (d.status === 'fulfilled') onToolNames?.('propertyDefs', d.value)
      const list = v.status === 'fulfilled' && Array.isArray(v.value)
        ? v.value.filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id && types.includes(x.type)
          && typeof x.name === 'string' && x.name)
        : []
      setState({ list, failed: v.status !== 'fulfilled' })
    })
    return () => { alive = false }
    // onToolNames is the sheet's merge; a new identity must not re-read the lists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])
  const m = cat.measures.get(measureKey)
  const on = (id) => plan.measures.some((x) => x.key === measureKey && x.prop === id)
  const full = plan.measures.length >= cat.maxMeasures
  return (
    <div>
      <PickerHead title={m?.label || measureKey} onBack={onBack} />
      {m?.meaning && <p className={styles.sectionHint}>{m.meaning}</p>}
      {full && <p className={styles.reason} id={fullId}>{reasonOf(cat, 'too_many_measures')}</p>}
      {state === null && <p className={styles.sectionHint} role="status">Loading your properties…</p>}
      {state?.failed && (
        <div>
          <p className={styles.reason} role="alert">{"Couldn't load your properties."}</p>
          <button type="button" className={styles.btn} onClick={() => setTick((n) => n + 1)}>Try again</button>
        </div>
      )}
      {state && !state.failed && state.list.length === 0 && (
        <p className={styles.sectionHint}>{"You don't have a property this can add up yet."}</p>
      )}
      {state && state.list.length > 0 && (
        <ul className={styles.pickerList} aria-label="Properties to add up">
          {state.list.map((x) => {
            const picked = on(x.id)
            const only = picked && plan.measures.length <= 1
            const disabled = (!picked && full) || only
            return (
              <li key={x.id}>
                <button type="button" className={`${styles.option} ${picked ? styles.optionOn : ''}`}
                  aria-pressed={picked} aria-disabled={disabled || undefined}
                  aria-describedby={disabled && !picked ? fullId : undefined}
                  onClick={() => { if (!disabled) onToggle({ key: measureKey, prop: x.id }) }}>
                  <span className={styles.optionLabel}>{x.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className={styles.pickerActions}>
        <button type="button" className={styles.btnPrimary} onClick={onBack}>Done</button>
      </div>
    </div>
  )
}

/**
 * The measure picker, grouped by theme (Results, Win/loss, Risk, Time, Process). Each measure toggles in or out
 * (at most three). Its one-line meaning shows on hover and on focus, and a long press shows it on touch without
 * picking the measure; it is also the button's description, so a screen reader hears it either way. A measure that
 * adds up one of the member's properties (wave 10) opens its property list instead (`PropertyMeasurePicker`).
 */
export function MeasurePicker({ cat, plan, byNeed, onToggle, onToolNames, onBack }) {
  const [propFor, setPropFor] = useState(null)
  // Fix 1, I-3: opening a property list puts focus on its heading; leaving it, back on the measure that opened it.
  const rootRef = useRef(null)
  const lastFor = useRef(null)
  const first = useRef(true)
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return }
    const root = rootRef.current
    if (!root) return
    const back = !propFor && lastFor.current
      ? [...root.querySelectorAll('[data-measure-key]')].find((b) => b.getAttribute('data-measure-key') === lastFor.current)
      : null
    ;(back || root.querySelector('[data-picker-heading]'))?.focus()
    if (propFor) lastFor.current = propFor
  }, [propFor])
  const [revealed, setRevealed] = useState(null)
  const press = useRef({ timer: null, fired: false })
  const fullId = useId()
  const picked = new Set(plan.measures.map((m) => m.key))
  const full = plan.measures.length >= cat.maxMeasures
  const all = measuresFor(cat, plan.source)
  const byTheme = new Map(THEMES.map(([k]) => [k, []]))
  for (const m of all) {
    if (!byTheme.has(m.theme)) byTheme.set(m.theme, [])
    byTheme.get(m.theme).push(m)
  }
  const themeLabel = new Map(THEMES)

  const startPress = (key) => {
    press.current.fired = false
    clearTimeout(press.current.timer)
    press.current.timer = setTimeout(() => { press.current.fired = true; setRevealed(key) }, LONG_PRESS_MS)
  }
  const endPress = () => clearTimeout(press.current.timer)

  if (propFor) {
    return (
      <div ref={rootRef}>
        <PropertyMeasurePicker cat={cat} plan={plan} measureKey={propFor} onToggle={onToggle}
          onToolNames={onToolNames} onBack={() => setPropFor(null)} />
      </div>
    )
  }
  return (
    <div ref={rootRef}>
      <PickerHead title="What to measure" onBack={onBack} />
      <p className={styles.sectionHint}>{`Pick up to ${cat.maxMeasures}. Picked ${plan.measures.length}.`}</p>
      {full && <p className={styles.reason} id={fullId}>{reasonOf(cat, 'too_many_measures')}</p>}
      {[...byTheme.entries()].filter(([, list]) => list.length).map(([theme, list]) => (
        <div key={theme} className={styles.group} role="group" aria-label={themeLabel.get(theme) || theme}>
          <h4 className={styles.groupHeading}>{themeLabel.get(theme) || theme}</h4>
          <ul className={styles.pickerList}>
            {list.map((m) => {
              const on = picked.has(m.key)
              // A property sum is picked per property, in its own list: never full or the last one here.
              const perProp = propTypesOf(m) !== null
              const only = !perProp && on && plan.measures.length <= 1
              const disabled = !perProp && ((!on && full) || only)
              const cov = coverageText(cat, m, byNeed)
              const meaningId = `wb-meaning-${m.key}`
              // ⛔ aria-disabled, never `disabled`: a disabled button cannot take focus, and its meaning (the
              // description) would be unreadable from the keyboard exactly when the member asks why.
              return (
                <li key={m.key}>
                  <button type="button"
                    className={`${styles.option} ${on ? styles.optionOn : ''}`}
                    aria-pressed={on} aria-disabled={disabled || undefined}
                    aria-describedby={[meaningId, disabled && !on ? fullId : null].filter(Boolean).join(' ')}
                    data-reveal={revealed === m.key ? '' : undefined} data-measure-key={m.key}
                    onPointerDown={() => startPress(m.key)} onPointerUp={endPress} onPointerLeave={endPress}
                    onPointerCancel={endPress}
                    onContextMenu={(e) => { if (press.current.fired) e.preventDefault() }}
                    onClick={() => {
                      if (press.current.fired) { press.current.fired = false; return }
                      if (perProp) setPropFor(m.key)
                      else if (!disabled) onToggle(m.key)
                    }}>
                    <span className={styles.optionLabel}>{m.label}</span>
                    <span className={styles.meaning} id={meaningId}>{m.meaning}</span>
                    {cov && <span className={styles.optionMeta}>{cov}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <div className={styles.pickerActions}>
        <button type="button" className={styles.btnPrimary} onClick={onBack}>Done</button>
      </div>
    </div>
  )
}
