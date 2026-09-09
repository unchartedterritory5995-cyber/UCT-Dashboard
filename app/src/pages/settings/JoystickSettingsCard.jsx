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

import TileCard from '../../components/TileCard'
import useHubSettings from '../../hub/useHubSettings'
import { clearSessionOverride } from '../../hub/hubSessionVisibility'
import styles from '../Settings.module.css'

export default function JoystickSettingsCard() {
  const { settings, updateHubSettings } = useHubSettings()

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
