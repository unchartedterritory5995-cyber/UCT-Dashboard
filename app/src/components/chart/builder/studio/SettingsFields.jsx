// app/src/components/chart/builder/studio/SettingsFields.jsx
//
// THE NUMBERS OF THE INDICATOR BEING BUILT, AS FIELDS (`authoring/derivedSettings.js`).
//
// One row per tunable number: where it sits, in plain words; what it is (a length, a level, a
// multiple); and the number, editable. A change is committed on Enter or on leaving the field,
// never per keystroke: each commit is one step of the indicator's history (one Undo), and the
// preview on the chart redraws once.
//
// ⛔ PURE PROPS. The caller owns the change (`onSet(setting, value)` answers `{ok, message?,
// stale?}`); this file holds only what is being typed and the last refusal's words.
//
// ⭐ THE SAME NUMBER IN SEVERAL PLACES (Indicators backlog 45c). "50 days" in two different sums is
// two settings, because the formula does not say they are one idea and two different ideas can
// share a number (an RSI of 14 and an ATR of 14). They are NEVER merged here. Instead, when a
// number is changed and other settings of the same kind still hold the OLD value, one line offers
// to move those too. The member decides; saying nothing leaves them alone.
import { useEffect, useRef, useState } from 'react'
import styles from './SettingsFields.module.css'

/** "length" -> "lengths"; the one role that is already a phrase reads as one. */
const PLURAL = Object.freeze({ 'bars back': 'bars-back values' })
const many = (role) => PLURAL[role] || `${role}s`

/** The other settings of `changed`'s kind that hold the value it had before the change. */
export function sameNumberElsewhere(settings, changed) {
  if (!Array.isArray(settings) || !changed) return []
  return settings.filter((s) => s && s.id !== changed.id && s.role === changed.role && s.value === changed.value)
}

/** The offer's sentence: how many, what kind, which, and the number they still hold. */
export function linkSentence(others, role, from) {
  const n = others.length
  if (!n) return ''
  const names = others.slice(0, 2).map((s) => s.caption).join(', ') + (n > 2 ? `, and ${n - 2} more` : '')
  return n === 1
    ? `1 other ${role} is also ${from}: ${names}.`
    : `${n} other ${many(role)} are also ${from}: ${names}.`
}

function Row({ setting, onSet, disabled }) {
  const [draft, setDraft] = useState(null)
  const [problem, setProblem] = useState(null)
  const shown = draft === null ? String(setting.value) : draft

  const commit = () => {
    if (draft === null) return
    const raw = draft.trim()
    if (raw === '' || raw === String(setting.value)) { setDraft(null); setProblem(null); return }
    const value = Number(raw)
    const out = onSet(setting, value) || { ok: false }
    if (out.ok || out.stale) { setDraft(null); setProblem(null); return }
    setProblem(out.message || 'That value could not be applied.')
  }

  const fieldId = `setting-${setting.id}`
  return (
    <div className={styles.settingRow} data-testid="studio-setting" data-role={setting.role}>
      <label className={styles.settingCaption} htmlFor={fieldId} title={setting.captionFull || setting.caption}>
        <span>{setting.caption}</span>
        <span className={styles.settingRole}>{setting.role}{setting.slots.length > 1 ? ` · ${setting.slots.length} places` : ''}</span>
      </label>
      <input
        id={fieldId}
        className={styles.settingInput}
        type="text"
        inputMode={setting.whole ? 'numeric' : 'decimal'}
        autoComplete="off"
        spellCheck={false}
        value={shown}
        disabled={disabled}
        aria-invalid={problem ? 'true' : undefined}
        aria-describedby={problem ? `${fieldId}-problem` : undefined}
        onChange={(e) => { setDraft(e.target.value); if (problem) setProblem(null) }}
        onBlur={commit}
        // ⛔ Enter only. Escape is the window's: the sheet these fields sit in listens for it on the
        // document in the capture phase, so a field cannot keep it. A field that "reverted" on Escape
        // also raised the window's close prompt (seen on production, 2026-11-17).
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      />
      {problem && <span id={`${fieldId}-problem`} className={styles.settingProblem} role="alert">{problem}</span>}
    </div>
  )
}

export default function SettingsFields({ settings, onSet, disabled = false, label = 'Settings' }) {
  // The offer made after a change: the kind, the value the others still hold, the value to move
  // them to, and which settings it is about. Dropped by the next change, by "Leave them", and
  // when none of them holds the old value any more.
  const [offer, setOffer] = useState(null)
  // The settings the member said yes about, still to be moved. One per render: each change goes
  // through the caller's own door with the state that change produced, never two in one pass.
  const [queue, setQueue] = useState(null)
  const list = Array.isArray(settings) ? settings : []
  // ⛔ THE NEXT MOVE WAITS FOR THE CALLER'S LIST TO SHOW THE LAST ONE. A caller may re-derive its
  // settings a render after its text changes (the form parses its formulas); a move made against
  // the list from before the last move would be built from the old formula and undo it. This is
  // the list the last applied move was made against: nothing more is applied while it is still
  // the one on screen.
  const appliedOn = useRef(null)

  useEffect(() => {
    if (!queue || disabled) return
    if (appliedOn.current === settings) return
    const [id, ...rest] = queue.ids
    const next = list.find((s) => s.id === id)
    // compare-and-set, like the field itself: only a setting that still shows the old value moves
    if (next && next.value === queue.from) {
      const out = onSet(next, queue.to)
      if (out && out.ok) appliedOn.current = settings
    }
    setQueue(rest.length ? { ...queue, ids: rest } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, settings, disabled])

  if (list.length === 0) return null

  const set = (setting, value) => {
    const out = onSet(setting, value) || { ok: false }
    if (out.ok) {
      const others = sameNumberElsewhere(list, setting)
      setOffer(others.length ? { role: setting.role, from: setting.value, to: value, ids: others.map((s) => s.id) } : null)
    }
    return out
  }
  const offered = offer && !queue
    ? list.filter((s) => offer.ids.includes(s.id) && s.value === offer.from) : []   // which ones: `sameNumberElsewhere`, once

  return (
    <div className={styles.section} data-testid="studio-settings">
      <span className={styles.sectionLabel}>{label}</span>
      {/* keyed on the places the number sits: stable while its value changes, new when the formula's shape does */}
      {list.map((s) => <Row key={s.id} setting={s} onSet={set} disabled={disabled || !!queue} />)}
      {offered.length > 0 && (
        <div className={styles.linkOffer} role="status" data-testid="studio-settings-link">
          <span className={styles.linkText}>{linkSentence(offered, offer.role, offer.from)}</span>
          <span className={styles.linkActions}>
            <button type="button" className={styles.linkBtn} disabled={disabled} data-testid="studio-settings-link-yes"
              onClick={() => { setQueue({ from: offer.from, to: offer.to, ids: offered.map((s) => s.id) }); setOffer(null) }}>
              {offered.length === 1 ? `Set it to ${offer.to} too` : `Set them to ${offer.to} too`}</button>
            <button type="button" className={styles.linkBtn} data-testid="studio-settings-link-no"
              onClick={() => setOffer(null)}>{offered.length === 1 ? 'Leave it' : 'Leave them'}</button>
          </span>
        </div>
      )}
      <span className={styles.settingNote}>Changing a number here changes this indicator everywhere it is used, once you save.</span>
    </div>
  )
}
