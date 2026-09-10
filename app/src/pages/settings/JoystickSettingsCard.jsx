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

import { useContext } from 'react'

import { AuthContext } from '../../context/AuthContext'
import TileCard from '../../components/TileCard'
import useHubSettings from '../../hub/useHubSettings'
import { clearSessionOverride } from '../../hub/hubSessionVisibility'
import styles from '../Settings.module.css'

export default function JoystickSettingsCard() {
  const { settings, storedEnabled, updateHubSettings } = useHubSettings()
  const isAdmin = useContext(AuthContext)?.user?.role === 'admin'

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

  const onToggle = (checked) => {
    // ⭐ Clear any session override first. Without this, a member who hid the hub for the
    // session and then turned it ON here would see nothing change — the override would keep
    // outranking the preference they just set, and the toggle would look broken.
    clearSessionOverride()
    updateHubSettings((cur) => ({ ...cur, enabled: checked }))
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
    </TileCard>
  )
}
