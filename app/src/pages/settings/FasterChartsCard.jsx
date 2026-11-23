// Settings → Faster charts on this device: the member's own switch for the on-device bar store (review of #2537 head
// f16a87dd98, Q-4, "The member-facing off setting: where it writes and what it must not do").
//
// The store (data/deviceStore) keeps about 80 MB of recent chart data in this browser, so a chart paints its first frame
// from it. Since #2537 it is ON by default for a desktop browser (a window wider than a tablet, a mouse or trackpad, a
// connection that is not metered) and for the desktop app (the same key, in the app's own web storage).
//
// ⭐ ONE KEY, IN THIS BROWSER, WRITTEN ONLY ON A CHOICE. data/deviceStore/switch.js owns the rule this follows:
//   "Automatic"  REMOVES localStorage['uct.deviceStore']: the desktop default decides, today and as it changes. NEVER '1':
//                '1' is a tester's hand switch (diagnostics on every chart switch, and a storage-permission request).
//   "Off"        writes exactly '0' (the switch's 'member-off'): off, and source.js deletes the stored packs once, at idle
//                after the next page load's first chart paint. Nothing here deletes anything.
//   a stored '1' shows as "On (testing mode)", a read-only third state, kept until the member picks Automatic or Off.
//   any other stored value shows as "Off" (the switch reads it as off and keeps the packs).
// ⛔ Opening Settings writes nothing: rendering only reads, and the dropdown calls back only for a DIFFERENT value.
// ⛔ No server preference and no sync: storage and disk are per device, and an "Off" synced from a laptop would delete a
// desktop's packs. ⛔ The kill cookies are read only through the switch (never written), the neighbour frames and
// lib/chartSpeed.js are untouched.
// ⭐ THE STATE LINE IS THIS PAGE LOAD'S. deviceStoreEnabled() / deviceStoreOffReason() are latched once per load (the kills
// too, lib/chartSpeed.js), and the key as stored NOW is read beside them (deviceStoreKeyNow), so a change says when it
// applies instead of pretending it already did.
// ⛔ FIRST-OPEN BYTES: this card is the only importer of switch.js outside chart code, and Settings is lazy
// (App.jsx: `lazy(() => import('./pages/Settings'))`). FasterChartsCard.test.jsx walks the entry's and the Notebook's
// static closures to keep it that way.
//
// UCT Signature style (docs/uct-signature-style.md): one card row with the label left and the house dropdown right,
// sentence case, two greys, no gold of its own (the dropdown's ✓ is the mark).
import { useCallback, useState } from 'react'
import TileCard from '../../components/TileCard'
import ChoiceMenu from '../../components/chart/ChoiceMenu'
import {
  DEVICE_STORE_KEY, deviceStoreEnabled, deviceStoreKeyNow, deviceStoreKeyState, deviceStoreOffReason,
} from '../../data/deviceStore/switch'
import { isDesktopApp } from '../../lib/desktopBridge'
import styles from './FasterChartsCard.module.css'

export const TITLE = 'Faster charts on this device'

const AUTO = 'auto'
const OFF = 'off'
const TESTING = 'testing'

const CHOICES = [
  { value: AUTO, label: 'Automatic', hint: 'On for a computer with a mouse or trackpad on a connection that is not metered. Off on phones and tablets.' },
  { value: OFF, label: 'Off', hint: 'Turns it off and removes the stored chart data (about 80 MB) from this device.' },
]
const TESTING_CHOICE = { value: TESTING, label: 'On (testing mode)', disabled: true, hint: 'Switched on by hand for testing. Choose Automatic or Off to change it.' }

/** The dropdown's value for a key state (switch.js's names: 'on' | 'off' | 'not-a-choice' | 'absent' | 'unreadable'). */
export function choiceOf(key) {
  if (key === 'on') return TESTING
  if (key === 'off' || key === 'not-a-choice') return OFF
  return AUTO
}

/** The line under the control: on or off on THIS page load, and why, in the member's words. */
export function stateLine({ enabled, reason, desktopApp = false }) {
  if (enabled) return 'On for this device.'
  switch (reason) {
    case 'device-purge':
    case 'device-kill':
    case 'chart-speed-kill':
      return 'Temporarily unavailable.'
    case 'member-off':
      return 'Off: you turned it off. The stored chart data is removed the next time a chart loads.'
    case 'default-off':
      return desktopApp
        ? 'Off on this device: it needs a connection that is not metered.'
        : 'Off on this device: it needs a window wider than a tablet, a mouse or trackpad, and a connection that is not metered.'
    case 'unreadable':
      return 'Unavailable: this browser does not let the site keep data.'
    default:
      return 'Off on this device.'
  }
}

/** What a change made since this page loaded will do, or '' when the stored key is still the one this load used. */
export function pendingLine(keyAtLoad, keyNow) {
  if (keyNow === keyAtLoad) return ''
  return keyNow === 'off'
    ? 'Changes apply the next time the page loads, and the stored chart data is removed after that.'
    : 'Changes apply the next time the page loads.'
}

export default function FasterChartsCard() {
  // This page load's answer (latched in the switch, so reading it here decides nothing new) and the key it used.
  const [load] = useState(() => ({
    enabled: deviceStoreEnabled(),
    reason: deviceStoreOffReason(),
    key: deviceStoreKeyState(),
    desktopApp: isDesktopApp(),
  }))
  const [keyNow, setKeyNow] = useState(() => deviceStoreKeyNow())
  const [failed, setFailed] = useState(false)

  const choose = useCallback((value) => {
    let ok = true
    try {
      if (value === AUTO) localStorage.removeItem(DEVICE_STORE_KEY)
      else if (value === OFF) localStorage.setItem(DEVICE_STORE_KEY, '0')
      else return
    } catch {
      ok = false
    }
    setFailed(!ok)
    setKeyNow(deviceStoreKeyNow())
  }, [])

  const options = keyNow === 'on' ? [...CHOICES, TESTING_CHOICE] : CHOICES
  const note = failed ? 'Could not save. Nothing was changed.' : pendingLine(load.key, keyNow)

  return (
    <TileCard icon="bolt" title={TITLE}>
      <p className={styles.lede}>Keeps recent chart data on this device (about 80 MB) so charts open instantly.</p>
      <div className={styles.card}>
        <div className={styles.row}>
          <div className={styles.text}>
            <span className={styles.label}>Keep chart data on this device</span>
            <span className={styles.hint} data-testid="faster-charts-state">{stateLine(load)}</span>
          </div>
          <ChoiceMenu
            ariaLabel={TITLE}
            value={choiceOf(keyNow)}
            options={options}
            onChange={choose}
            disabled={keyNow === 'unreadable'}
          />
        </div>
      </div>
      <p className={styles.note} role="status" aria-live="polite" data-testid="faster-charts-next">{note}</p>
    </TileCard>
  )
}
