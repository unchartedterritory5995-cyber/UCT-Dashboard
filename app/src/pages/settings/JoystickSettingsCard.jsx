// Settings → Joystick — the ONE control pulled forward from Phase 4.
//
// ⛔ WHY IT SHIPS EARLY. "Hide joystick" wrote the preference off, and the Settings toggle was
// scheduled for Phase 4 — so between the two there was no way back except an admin editing the
// database or the member pasting a `fetch()` into a devtools console. The owner hit that on the
// live admin preview the day it shipped.
//
// The rest of the Phase 4 settings UI stays in Phase 4. This card exists so that a PERSISTENT
// hide has a real re-enable path sitting beside it, which is the condition for allowing a
// persistent hide at all.

import { useContext, useState } from 'react'

import { AuthContext } from '../../context/AuthContext'
import TileCard from '../../components/TileCard'
import useHubSettings from '../../hub/useHubSettings'
import { clearSessionOverride } from '../../hub/hubSessionVisibility'
import { clearGestureTrace, gestureTraceJson, readGestureTrace } from '../../hub/gestureTrace'
import styles from '../Settings.module.css'

export default function JoystickSettingsCard() {
  const { settings, storedEnabled, updateHubSettings } = useHubSettings()
  const isAdmin = useContext(AuthContext)?.user?.role === 'admin'
  // ⛔ THE STATUS LINE LIVES HERE, ABOVE THE BUTTONS THAT WRITE IT, and neither button unmounts
  // this card. CLAUDE.md, "Assert user-facing feedback by RENDERED TEXT": the hub has already
  // shipped two toasts that were destroyed in the same commit that set them and rendered for zero
  // frames, with every structural assertion green.
  const [traceStatus, setTraceStatus] = useState('')
  const [traceFallback, setTraceFallback] = useState('')

  // ⛔ B6 — EXPOSURE, AND THE STRAND CASE THAT SHAPES IT.
  //
  // The hub itself is admin-default (`useHubSettings.js:147-150`: unset -> isAdmin), but THIS CARD
  // shipped to production ungated in PR #101 (`d3bf38f44`), so any member could open Settings and
  // switch the hub on. Hiding it from every member would therefore strand anyone already ON with
  // no way off — which is precisely the defect CLAUDE.md records against this feature:
  // "⛔ A dismissable control needs a recovery path IN THE SAME COMMIT — the joystick 'Hide'
  // defect". Removing someone's only way back is the same error as never giving them one.
  //
  // So: hidden from members who NEVER CHOSE, visible to anyone who has ever chosen either way.
  // That needs no count of who opted in — a number nobody can see from here — because the
  // condition is evaluated per user against their own preference.
  //
  // ⭐ `typeof === 'boolean'`, NOT `!== undefined`. "Never chosen" reaches this component in FIVE
  // shapes, all folded to `undefined` by `parsePref` (`usePreferences.js:24-28`) and the
  // `storedEnabled` derivation (`useHubSettings.js:~145`): the key absent, the value null, a value
  // that is not valid JSON, a value that parses to a non-object, and an object with no `enabled`.
  // A sixth — `{"enabled": null}` — yields `null`, which `!== undefined` would wrongly admit as a
  // deliberate choice. Only an actual boolean is a choice.
  //
  // ⚠️ THIS IS AN EXPOSURE DEFAULT, NOT A SECURITY BOUNDARY. `POST /api/auth/preferences`
  // (`api/routers/auth.py:1707-1711`) accepts any `{key, value}` from any authenticated user with
  // no validation, so a member can still set `joystick_hub.enabled` directly. Filed as an open
  // item; it is not this branch's to fix.
  const everChose = typeof storedEnabled === 'boolean'
  if (!isAdmin && !everChose) return null

  // ⛔ WRITES ONLY ON CHANGE, NEVER ON MOUNT. `hubHideRestore.test.jsx:205` asserts
  // `setPrefMerged` is called exactly once after a single toggle click; anything that wrote while
  // rendering would break that, and — worse — a member opening Settings would silently persist
  // whatever the defaults happen to be, converting "never chose" into a choice. B6's whole gate
  // reads `typeof storedEnabled === 'boolean'`, so a write-on-mount would show the card to every
  // member the moment they opened the page once.
  const set = (key) => (value) => updateHubSettings((cur) => ({ ...cur, [key]: value }))

  const onToggle = (checked) => {
    // ⭐ Clear any session override first. Without this, a member who hid the hub for the
    // session and then turned it ON here would see nothing change — the override would keep
    // outranking the preference they just set, and the toggle would look broken.
    clearSessionOverride()
    updateHubSettings((cur) => ({ ...cur, enabled: checked }))
  }

  const overrideCount = Object.keys(settings.overrides || {}).length

  /**
   * "Copy trace" — the ONE export path for the G0 buffer.
   *
   * ⛔ NO SINK. It reaches the clipboard and nowhere else: no endpoint, no upload, no beacon. Master
   * spec §8's "no analytics" is not suspended for a diagnostic.
   *
   * ⭐ AN EMPTY BUFFER SAYS SO, IN WORDS. Absence is not a pass (`glass-acceptance.md`'s own first
   * rule): a "Copied." message over zero rows would hand the owner an empty file that looks like a
   * clean device. The message also carries the window bounds, so a capture that overflowed the ring
   * cannot read as "that is everything that happened"
   * (`lesson_a_saturated_instrument_reports_zero`).
   */
  const onCopyTrace = async () => {
    const t = readGestureTrace()
    if (t.kept === 0) {
      setTraceFallback('')
      setTraceStatus(
        'Nothing recorded. Either "Record gesture trace" is off, or no pointer event has reached '
        + 'the joystick pad since the last clear.',
      )
      return
    }
    const summary = `${t.kept} event${t.kept === 1 ? '' : 's'}, seq ${t.firstSeq}-${t.lastSeq}`
      + (t.dropped > 0
        ? `, ${t.dropped} older dropped (the ring holds ${t.capacity})`
        : '')
    const json = gestureTraceJson()
    try {
      await navigator.clipboard.writeText(json)
      setTraceFallback('')
      setTraceStatus(`Copied ${summary}.`)
    } catch {
      // ⛔ THE RECOVERY PATH SHIPS IN THE SAME COMMIT. `navigator.clipboard` is
      // secure-context-only (`lesson_a_device_red_can_be_the_transport_not_the_product`), and a
      // capture the owner cannot get off the device is a run they have to perform again.
      setTraceFallback(json)
      setTraceStatus(
        `Could not reach the clipboard — select the box below and copy it by hand. ${summary}.`,
      )
    }
  }

  const onClearTrace = () => {
    clearGestureTrace()
    setTraceFallback('')
    setTraceStatus('Trace cleared. 0 events recorded.')
  }

  return (
    <TileCard icon="moveStop" title="Joystick">
      <div className={styles.voiceRow}>
        <label className={styles.voiceLabel}>
          <input
            type="checkbox"
            data-testid="joystick-enabled-toggle"
            checked={!!settings.enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          {' '}Joystick shortcuts (preview)
        </label>
      </div>
      <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>
        A drag-and-hold shortcut control in the bottom-right corner, on phones and tablets.
        Turning this off hides it everywhere until you turn it back on here.
      </div>

      {/* ⭐ The rest of §8's schema. Every one of these keys already existed in
          `useHubSettings`'s defaults and was persisted; none of them was reachable. */}
      <div style={{ marginTop: 14, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>

        <div className={styles.voiceRow}>
          <label className={styles.voiceLabel} htmlFor="joystick-handedness">Handedness</label>
          <select
            id="joystick-handedness"
            data-testid="joystick-handedness"
            value={settings.handedness}
            onChange={(e) => set('handedness')(e.target.value)}
          >
            <option value="right">Right — pad on the right</option>
            <option value="left">Left — pad on the left</option>
          </select>
        </div>

        <div className={styles.voiceRow}>
          <label className={styles.voiceLabel}>
            <input
              type="checkbox"
              data-testid="joystick-haptics"
              checked={!!settings.haptics}
              onChange={(e) => set('haptics')(e.target.checked)}
            />
            {' '}Haptics
          </label>
        </div>
        <div style={{ opacity: 0.7, fontSize: 12 }}>
          A short buzz on each step. iOS Safari exposes no vibration API, so this does nothing there.
        </div>

        <div className={styles.voiceRow}>
          <label className={styles.voiceLabel}>
            <input
              type="checkbox"
              data-testid="joystick-sticky-fan"
              checked={!!settings.stickyFan}
              onChange={(e) => set('stickyFan')(e.target.checked)}
            />
            {' '}Keep the fan open after opening it
          </label>
        </div>

        <div className={styles.voiceRow}>
          <label className={styles.voiceLabel}>
            <input
              type="checkbox"
              data-testid="joystick-high-contrast"
              checked={!!settings.highContrast}
              onChange={(e) => set('highContrast')(e.target.checked)}
            />
            {' '}High contrast
          </label>
        </div>

        <NumberSetting
          id="joystick-hold-ms" label="Hold to open" suffix="ms"
          min={300} max={1200} step={50}
          value={settings.holdMs} onChange={set('holdMs')}
          hint="How long a press waits before the fan opens."
        />
        <NumberSetting
          id="joystick-travel-px" label="Pad travel" suffix="px"
          min={16} max={48} step={2}
          value={settings.travelPx} onChange={set('travelPx')}
          hint="How far the knob moves. The open threshold and the ring split are fractions of this, not fixed pixels."
        />
        <NumberSetting
          id="joystick-double-tap-ms" label="Double-tap window" suffix="ms"
          min={200} max={600} step={20}
          value={settings.doubleTapMs} onChange={set('doubleTapMs')}
          hint="How close two taps must be to count as one double-tap."
        />

        {/* ⛔ `overrides` IS SHOWN, NOT EDITED — see the file header. */}
        <div className={styles.voiceRow}>
          <span className={styles.voiceLabel}>Action overrides</span>
          <span data-testid="joystick-overrides-count" style={{ opacity: 0.8 }}>
            {overrideCount === 0 ? 'none' : `${overrideCount} set`}
          </span>
          {overrideCount > 0 && (
            <button
              type="button"
              data-testid="joystick-overrides-reset"
              onClick={() => set('overrides')({})}
            >
              Reset to the registry
            </button>
          )}
        </div>
      </div>

      {/* ⛔⛔ ADMIN ONLY, AND OFF BY DEFAULT — the G0-1 gesture trace.
          `isAdmin` here decides what RENDERS. It is not the boundary: `useHubSettings` resolves
          `traceGestures` against `isAdmin` too, so a member who writes the key straight to the
          unvalidated preferences endpoint still records nothing. Two independent reasons, because
          an exposure default is not a security boundary and this file already says so about B6. */}
      {isAdmin && (
        <div
          data-testid="joystick-trace-section"
          style={{ marginTop: 14, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}
        >
          <div className={styles.voiceRow}>
            <label className={styles.voiceLabel}>
              <input
                type="checkbox"
                data-testid="joystick-trace-toggle"
                checked={!!settings.traceGestures}
                onChange={(e) => set('traceGestures')(e.target.checked)}
              />
              {' '}Record gesture trace
            </label>
          </div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>
            Diagnostic for the G0-1 flick question (docs/plans/joystick/g0-flick-trace-plan.md).
            While on, every pointer event on the pad is kept in memory — the last 500 — with both
            clocks, the travel, and the decision the engine reached. Nothing is sent anywhere; the
            only way it leaves this device is the button below. Leave it off when you are not
            capturing.
          </div>
          <div className={styles.voiceRow}>
            <button type="button" data-testid="joystick-trace-copy" onClick={onCopyTrace}>
              Copy trace
            </button>
            <button type="button" data-testid="joystick-trace-clear" onClick={onClearTrace}>
              Clear
            </button>
          </div>
          {traceStatus && (
            <div data-testid="joystick-trace-status" style={{ fontSize: 12, marginTop: 4 }}>
              {traceStatus}
            </div>
          )}
          {traceFallback && (
            <textarea
              data-testid="joystick-trace-fallback"
              readOnly
              rows={8}
              value={traceFallback}
              style={{ width: '100%', marginTop: 6, fontFamily: 'monospace', fontSize: 11 }}
            />
          )}
        </div>
      )}
    </TileCard>
  )
}

/**
 * One numeric setting: a range the thumb can drag plus the live value, both labelled.
 *
 * ⚠️ `e.target.value` from a range input is a STRING. Persisting it unconverted would put `"500"`
 * into the preference blob, and `holdMs` is compared numerically by the engine — `"500" > 1200` is
 * false but `"90" > "1200"` is TRUE under string comparison, so a stray string survives every
 * boundary check and misbehaves only at some values. Converted here, at the one boundary where the
 * string exists.
 */
function NumberSetting({ id, label, suffix, min, max, step, value, onChange, hint }) {
  return (
    <>
      <div className={styles.voiceRow}>
        <label className={styles.voiceLabel} htmlFor={id}>{label}</label>
        <input
          id={id}
          data-testid={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span data-testid={`${id}-value`}>{value}{suffix}</span>
      </div>
      {hint && <div style={{ opacity: 0.7, fontSize: 12 }}>{hint}</div>}
    </>
  )
}
