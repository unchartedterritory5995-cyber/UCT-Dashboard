import { useId, useRef, useState } from 'react'
import UIcon from '../../../../../../components/ui/UIcon'
import Section, { PickerHead } from './Section'
import { THEMES, measuresFor, coverageText, reasonOf } from '../builderCatalog'
import styles from '../WidgetBuilderSheet.module.css'

/**
 * "What to measure": the picked measures (1 to 3) as chips, each with its coverage on this member's data when it
 * needs a per-row value ("R known on 23 of 47 trades", from the last preview), and "+ Measure" to open the picker.
 * The last measure cannot be removed: a widget measures something.
 */
export default function MeasureSection({ cat, plan, byNeed, onOpen, onRemove }) {
  const lastId = useId()
  const only = plan.measures.length <= 1
  return (
    <Section id="measure" title="What to measure">
      <ul className={styles.filterList}>
        {plan.measures.map((pm, i) => {
          const m = cat.measures.get(pm.key)
          const label = m?.label || pm.key
          const cov = coverageText(cat, m, byNeed)
          return (
            <li key={pm.key} className={styles.measureItem}>
              <div className={styles.filterItem}>
                <button type="button" className={styles.chip} onClick={(e) => onOpen(e.currentTarget)}>
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
 * The measure picker, grouped by theme (Results, Win/loss, Risk, Time, Process). Each measure toggles in or out
 * (at most three). Its one-line meaning shows on hover and on focus, and a long press shows it on touch without
 * picking the measure; it is also the button's description, so a screen reader hears it either way.
 */
export function MeasurePicker({ cat, plan, byNeed, onToggle, onBack }) {
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

  return (
    <div>
      <PickerHead title="What to measure" onBack={onBack} />
      <p className={styles.sectionHint}>{`Pick up to ${cat.maxMeasures}. Picked ${plan.measures.length}.`}</p>
      {full && <p className={styles.reason} id={fullId}>{reasonOf(cat, 'too_many_measures')}</p>}
      {[...byTheme.entries()].filter(([, list]) => list.length).map(([theme, list]) => (
        <div key={theme} className={styles.group} role="group" aria-label={themeLabel.get(theme) || theme}>
          <h4 className={styles.groupHeading}>{themeLabel.get(theme) || theme}</h4>
          <ul className={styles.pickerList}>
            {list.map((m) => {
              const on = picked.has(m.key)
              const only = on && plan.measures.length <= 1
              const disabled = (!on && full) || only
              const cov = coverageText(cat, m, byNeed)
              const meaningId = `wb-meaning-${m.key}`
              return (
                <li key={m.key}>
                  <button type="button"
                    className={`${styles.option} ${on ? styles.optionOn : ''}`}
                    aria-pressed={on} disabled={disabled}
                    aria-describedby={[meaningId, disabled && !on ? fullId : null].filter(Boolean).join(' ')}
                    data-reveal={revealed === m.key ? '' : undefined}
                    onPointerDown={() => startPress(m.key)} onPointerUp={endPress} onPointerLeave={endPress}
                    onPointerCancel={endPress}
                    onContextMenu={(e) => { if (press.current.fired) e.preventDefault() }}
                    onClick={() => {
                      if (press.current.fired) { press.current.fired = false; return }
                      onToggle(m.key)
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
