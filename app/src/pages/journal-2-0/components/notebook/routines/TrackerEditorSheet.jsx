import { useId } from 'react'
import ToolEditor from './ToolEditor'
import {
  CHECK, COPY, TRACKER_DAYS, charCount, TRACKER_KINDS, UNIT_MAX, blankTracker, checkTracker, kindWords, trackerBody, trackerDraft,
} from './toolEditorLib'
import styles from './routines.module.css'

/**
 * The tracker editor (spec 7, Task 9.16): the name, the type ("Yes / no", "Number", "1-5 scale", "Duration"; fixed
 * once the tracker is made, with the server's own sentence), a unit for a number (at most 16 characters, refused as
 * it is typed and never sent longer), and the days it logs ("Trading days", the default, or "Any day").
 * The check-in trackers (mood, focus) open read-only: "Mood and focus come from your check-ins."
 */
export const TRACKER_SPEC = Object.freeze({
  kind: 'tracker',
  titles: { new: COPY.newTracker, edit: COPY.editTracker, view: 'Tracker' },
  archivedText: COPY.archivedTracker,
  blank: blankTracker,
  fromTool: trackerDraft,
  body: trackerBody,
  check: checkTracker,
  // The unit's length is said as it is typed, beside the field, not only at Save.
  liveCheck: (d) => (d.kind === 'number' && charCount(d.unit.trim()) > UNIT_MAX ? { unit: checkTracker(d).unit } : null),
})

export default function TrackerEditorSheet({ trackerId = null, ...rest }) {
  return (
    <ToolEditor spec={TRACKER_SPEC} toolId={trackerId} {...rest}
      renderForm={(p) => <TrackerForm {...p} />}
      renderSummary={(tool) => <TrackerSummary tool={tool} />} />
  )
}

function TrackerSummary({ tool }) {
  const days = TRACKER_DAYS.find(([k]) => k === tool.settings?.days)?.[1] || TRACKER_DAYS[0][1]
  return (
    <div className={styles.summary}>
      <p className={styles.summaryName}>{tool.name}</p>
      <p className={styles.hint}>{`${kindWords(tool.kind)}${tool.unit ? ` (${tool.unit})` : ''} · ${days}`}</p>
      {tool.readOnly === true && <p className={styles.sentence}>{COPY.builtin}</p>}
    </div>
  )
}

const errProps = (e) => (e ? { 'aria-invalid': true, 'aria-describedby': e.id } : {})
const ErrorLine = ({ e }) => (e ? <p className={styles.fieldError} id={e.id}>{e.text}</p> : null)

function TrackerForm({ draft, setDraft, error, mode }) {
  const id = useId()
  const fixed = mode !== 'new'
  const errName = error('name')
  const errKind = error('kind')
  const errUnit = error('unit')
  const errDays = error('days')
  const kindDescribed = [fixed ? `${id}-fixed` : null, errKind?.id].filter(Boolean).join(' ') || undefined
  return (
    <div className={styles.form}>
      <div className={styles.field} data-field-box="">
        <label className={styles.fieldLabel} htmlFor={`${id}-name`}>Name</label>
        <input id={`${id}-name`} className={styles.input} value={draft.name} data-field="name" autoComplete="off"
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} {...errProps(errName)} />
        <ErrorLine e={errName} />
      </div>

      <fieldset className={styles.fieldset} data-field-box="">
        <legend className={styles.legend}>Type</legend>
        <div className={styles.radios}>
          {TRACKER_KINDS.map(([k, label]) => (
            <label key={k} className={styles.radioRow}>
              <input type="radio" name={`${id}-kind`} value={k} checked={draft.kind === k}
                data-field={draft.kind === k ? 'kind' : undefined} aria-disabled={fixed || undefined}
                aria-describedby={kindDescribed} aria-invalid={errKind ? true : undefined}
                onChange={() => { if (!fixed) setDraft((d) => ({ ...d, kind: k })) }} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {fixed && <p className={styles.hint} id={`${id}-fixed`}>{CHECK.kindFixed}</p>}
        <ErrorLine e={errKind} />
      </fieldset>

      {draft.kind === 'number' && (
        <div className={styles.field} data-field-box="">
          <label className={styles.fieldLabel} htmlFor={`${id}-unit`}>Unit</label>
          <input id={`${id}-unit`} className={styles.input} value={draft.unit} data-field="unit" autoComplete="off"
            aria-describedby={[`${id}-unit-hint`, errUnit?.id].filter(Boolean).join(' ')}
            aria-invalid={errUnit ? true : undefined}
            onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))} />
          <p className={styles.hint} id={`${id}-unit-hint`}>{`Optional, like hours or pages. Up to ${UNIT_MAX} characters.`}</p>
          <ErrorLine e={errUnit} />
        </div>
      )}

      <fieldset className={styles.fieldset} data-field-box="">
        <legend className={styles.legend}>Days it logs</legend>
        <div className={styles.radios}>
          {TRACKER_DAYS.map(([k, label]) => (
            <label key={k} className={styles.radioRow}>
              <input type="radio" name={`${id}-days`} value={k} checked={draft.days === k}
                data-field={draft.days === k ? 'days' : undefined} {...(draft.days === k ? errProps(errDays) : {})}
                onChange={() => setDraft((d) => ({ ...d, days: k }))} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <ErrorLine e={errDays} />
      </fieldset>
    </div>
  )
}
