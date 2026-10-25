import { useEffect, useId, useState } from 'react'
import Section from './Section'
import { VIEW_LABELS, viewReason, autoView, rangeIsUnbounded, reasonOf } from '../builderCatalog'
import styles from '../WidgetBuilderSheet.module.css'
import { ViewGlyph } from './ViewGlyph'

/**
 * "Show it as": the view thumbnails, a RADIO GROUP (native radios, styled), with the suggested one marked
 * "Suggested". A view that cannot show the shape is disabled with the engine's own one-line reason, read beside it
 * and named as its description. Then the view's own settings: what a comparison is against, a progress bar's
 * target, the accent colour and whether each figure shows its count.
 */
export default function ViewSection({ cat, plan, unit = 'trades', onView, onCompare, onDisplay }) {
  const noun = unit === 'days' ? 'days' : unit === 'positions' ? 'positions' : 'trades'
  const name = useId()
  const accentName = useId()
  const targetId = useId()
  const fromId = useId()
  const toId = useId()
  const prevReasonId = useId()
  const suggested = autoView(cat, plan)
  const views = VIEW_LABELS.filter(([k]) => cat.views.includes(k))
  const cmp = plan.compare || null
  // "Dates I pick" is applied only once both dates make a span: an unfinished pair never reaches the preview.
  const [picking, setPicking] = useState(false)
  const rangeOn = cmp?.mode === 'range' || picking
  const unbounded = rangeIsUnbounded(cat, plan.range)
  const [target, setTarget] = useState(plan.display.target === null ? '' : String(plan.display.target))
  useEffect(() => { setTarget(plan.display.target === null ? '' : String(plan.display.target)) }, [plan.display.target])
  const accentNames = new Map([
    ['gold', 'Gold'], ['green', 'Green'], ['red', 'Red'], ['blue', 'Blue'], ['purple', 'Purple'], ['teal', 'Teal'],
    ['orange', 'Orange'],
  ])
  return (
    <Section id="view" title="Show it as">
      <div className={styles.thumbs} role="radiogroup" aria-label="Show it as">
        {views.map(([key, label]) => {
          const reason = viewReason(cat, plan, key)
          const on = plan.view.type === key
          const rid = `${name}-${key}-why`
          return (
            <label key={key} className={`${styles.thumb} ${on ? styles.thumbOn : ''} ${reason ? styles.thumbOff : ''}`}>
              <input type="radio" className={styles.srOnlyInput} name={name} value={key} checked={on}
                disabled={!!reason} aria-describedby={reason ? rid : undefined}
                aria-label={key === suggested ? `${label}, suggested` : label}
                onChange={() => onView(key)} />
              <ViewGlyph view={key} />
              <span className={styles.thumbLabel}>{label}</span>
              {key === suggested && <span className={styles.suggested}>Suggested</span>}
              {reason && <span className={styles.thumbReason} id={rid}>{reason}</span>}
            </label>
          )
        })}
      </div>

      {plan.view.type === 'compare' && (
        <fieldset className={styles.fieldset}>
          <legend className={styles.fieldLabel}>Compare with</legend>
          <div role="radiogroup" className={styles.optionGrid}>
            <label className={`${styles.option} ${cmp?.mode === 'previous' && !picking ? styles.optionOn : ''}`}>
              <input type="radio" className={styles.srOnlyInput} name={`${name}-cmp`}
                checked={cmp?.mode === 'previous' && !picking}
                disabled={unbounded} aria-describedby={unbounded ? prevReasonId : undefined}
                onChange={() => { setPicking(false); onCompare({ mode: 'previous' }) }} />
              <span className={styles.optionLabel}>The period before</span>
            </label>
            <label className={`${styles.option} ${cmp?.mode === 'all' && !picking ? styles.optionOn : ''}`}>
              <input type="radio" className={styles.srOnlyInput} name={`${name}-cmp`}
                checked={cmp?.mode === 'all' && !picking}
                onChange={() => { setPicking(false); onCompare({ mode: 'all' }) }} />
              <span className={styles.optionLabel}>All time</span>
            </label>
            <label className={`${styles.option} ${rangeOn ? styles.optionOn : ''}`}>
              <input type="radio" className={styles.srOnlyInput} name={`${name}-cmp`} checked={rangeOn}
                onChange={() => setPicking(cmp?.mode !== 'range')} />
              <span className={styles.optionLabel}>Dates I pick</span>
            </label>
          </div>
          {unbounded && <p className={styles.reason} id={prevReasonId}>{reasonOf(cat, 'no_earlier')}</p>}
          {rangeOn && (
            <CompareDates cat={cat} cmp={cmp?.mode === 'range' ? cmp : null} fromId={fromId} toId={toId}
              onCompare={(c) => { setPicking(false); onCompare(c) }} />
          )}
        </fieldset>
      )}

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor={targetId}>Target for a progress bar</label>
        <input id={targetId} type="number" inputMode="decimal" className={styles.input} value={target}
          onChange={(e) => {
            setTarget(e.target.value)
            const raw = e.target.value.trim()
            if (raw === '') onDisplay({ target: null })
            else if (Number.isFinite(Number(raw))) onDisplay({ target: Number(raw) })
          }} />
      </div>

      {cat.accents.length > 0 && (
        <div className={styles.field}>
          <span className={styles.fieldLabel} id={`${accentName}-l`}>Colour</span>
          <div className={styles.swatches} role="radiogroup" aria-labelledby={`${accentName}-l`}>
            {cat.accents.map((a) => (
              <label key={a} className={`${styles.swatch} ${plan.display.accent === a ? styles.swatchOn : ''}`}
                data-accent={a}>
                <input type="radio" className={styles.srOnlyInput} name={accentName} checked={plan.display.accent === a}
                  onChange={() => onDisplay({ accent: a })} aria-label={accentNames.get(a) || a} />
                <span className={styles.swatchDot} aria-hidden="true" />
              </label>
            ))}
          </div>
        </div>
      )}

      <label className={styles.check}>
        <input type="checkbox" checked={plan.display.showN} onChange={(e) => onDisplay({ showN: e.target.checked })} />
        <span>{`Show how many ${noun} each figure is from`}</span>
      </label>
      <p className={styles.sectionHint}>Averages and rates always show it.</p>
    </Section>
  )
}

function CompareDates({ cat, cmp, fromId, toId, onCompare }) {
  const [from, setFrom] = useState(cmp?.from || '')
  const [to, setTo] = useState(cmp?.to || '')
  const bad = from && to && from > to
  const badId = `${fromId}-bad`
  const apply = (f, t) => { if (f && t && f <= t) onCompare({ mode: 'range', from: f, to: t }) }
  return (
    <>
      <div className={styles.pair}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={fromId}>From</label>
          <input id={fromId} type="date" className={styles.input} value={from}
            aria-describedby={bad ? badId : undefined}
            onChange={(e) => { setFrom(e.target.value); apply(e.target.value, to) }} />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={toId}>To</label>
          <input id={toId} type="date" className={styles.input} value={to}
            onChange={(e) => { setTo(e.target.value); apply(from, e.target.value) }} />
        </div>
      </div>
      {bad && <p className={styles.reason} id={badId}>{reasonOf(cat, 'start_after_end')}</p>}
    </>
  )
}
