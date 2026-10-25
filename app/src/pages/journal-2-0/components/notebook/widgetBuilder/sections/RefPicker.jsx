import { useEffect, useId, useState } from 'react'
import { PickerHead } from './Section'
import { refQuestion, reasonOf } from '../builderCatalog'
import { loadVocabulary } from '../../../../lib/builtWidgets'
import styles from '../WidgetBuilderSheet.module.css'

/**
 * Wave 9 (Task 9.17): "Which routine" / "Which tracker", the step a filter or split on a field that names one asks
 * first. The list is the member's own (`GET /vocabulary?field=routine|tracker`, `{id, name}`), read again on each
 * open so a routine made in My tools since is there.
 *
 * A widget can look at one routine and one tracker (plan.py `_one_ref_per_kind`): when the plan already names one of
 * this kind (`taken`), every other is aria-disabled with the engine's own sentence. ⛔ aria-disabled, never
 * `disabled`: a disabled button cannot take focus, so the reason would be unreadable from the keyboard exactly when
 * the member asks why.
 */
export default function RefPicker({ cat, kind, taken = null, current = null, onLoaded, onPick, onBack }) {
  const reasonId = useId()
  const [state, setState] = useState(null)        // null while loading, then {list, failed}
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setState(null)
    loadVocabulary(kind, { fresh: true }).then(
      (values) => {
        if (!alive) return
        const list = (Array.isArray(values) ? values : [])
          .filter((v) => v && typeof v === 'object' && v.id != null)
          .map((v) => ({ id: String(v.id), name: typeof v.name === 'string' && v.name ? v.name : String(v.id) }))
        setState({ list, failed: false })
        onLoaded?.(kind, list)
      },
      () => { if (alive) setState({ list: [], failed: true }) },
    )
    return () => { alive = false }
    // onLoaded is the sheet's merge; a new identity must not re-read the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, tick])
  const noun = kind === 'tracker' ? 'trackers' : 'routines'
  const blocked = (id) => !!taken && taken !== id
  const anyBlocked = !!state?.list.some((r) => blocked(r.id))
  return (
    <div>
      <PickerHead title={refQuestion(kind)} onBack={onBack} />
      {state === null && <p className={styles.sectionHint} role="status">{`Loading your ${noun}…`}</p>}
      {state?.failed && (
        <div>
          <p className={styles.reason} role="alert">{`Couldn't load your ${noun}.`}</p>
          <button type="button" className={styles.btn} onClick={() => setTick((n) => n + 1)}>Try again</button>
        </div>
      )}
      {state && !state.failed && state.list.length === 0 && (
        <p className={styles.sectionHint}>{`You don't have a ${kind} yet. Make one in My tools.`}</p>
      )}
      {state && state.list.length > 0 && (
        <ul className={styles.pickerList} aria-label={kind === 'tracker' ? 'Trackers' : 'Routines'}>
          {state.list.map((r) => {
            const off = blocked(r.id)
            const on = current === r.id
            return (
              <li key={r.id}>
                <button type="button" className={`${styles.option} ${on ? styles.optionOn : ''}`} aria-pressed={on}
                  aria-disabled={off || undefined} aria-describedby={off ? reasonId : undefined}
                  onClick={() => { if (!off) onPick(r.id, r.name) }}>
                  <span className={styles.optionLabel}>{r.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {anyBlocked && <p className={styles.reason} id={reasonId}>{reasonOf(cat, 'one_ref')}</p>}
    </div>
  )
}
