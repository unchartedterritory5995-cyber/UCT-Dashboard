// Log Trade's pre-entry checklist, the body (Notebook P2a, Task 8; spec §P2 item 1, §7.5). Loaded on
// demand by LogTradeChecklistSlot inside AddPositionModal / AddTradeModal, and only when the journal
// styles switch is on and the member opted in. It never writes: ticks go up through `onChange`, and
// the ids of the items on screen through `onItems`, so the dialog can save them under the row it
// creates (lib/blocks/logTradeChecklist.js, the one file that writes).
// ⛔ A soft warning only: nothing here disables, hides or delays logging the trade.
// ⛔ A checklist is the member's own discipline record. It reads settings, the selected account and
// rules through the ONE read seam (hooks/useChecklistSources; this file is scanned by
// lib/blocks/blockDoors.test.js), and with no single account selected it lists nothing: the settings
// served then are not one account's (C-1), so no setup or rule is shown as the member's own.
// A tick keeps another setup's ticks (R-T7-2 I-2); changing setup never touches them.
import { useEffect } from 'react'
import useChecklistSources from '../hooks/useChecklistSources'
import { checklistItems, toggleChecked, uncheckedItems } from '../lib/blocks/checklistItems'
import { softWarning } from '../lib/blocks/logTradeChecklist'
import styles from './notebook/blocks/Blocks.module.css'

const LOADING = 'Loading your pre-entry checklist…'
const ACCOUNT_LINES = {
  loading: LOADING,
  'no-account': 'Your pre-entry checklist shows here when one account is selected.',
  'no-accounts': 'Your pre-entry checklist shows here once you have a Journal account.',
  'accounts-error': "Your accounts couldn't load, so your pre-entry checklist isn't shown.",
}
const NO_IDS = []

// N-3 (R-T8-2): `disabled` while the dialog shows a failed save, so the boxes stay exactly what
// "Try again" re-sends.
export default function LogTradeChecklist({ setup, requireAll, checked, onChange, onItems, disabled = false }) {
  const { settings, settingsState, retrySettings, rules, rulesState } = useChecklistSources({ wantRules: true })
  // One account's data, read: its settings are in, and its rules answered (or failed, which leaves
  // the setup's own items standing). Any other rules state is "no single account" or still loading.
  const oneAccount = rulesState === 'ready' || rulesState === 'error'
  const usable = settingsState === 'ready' && oneAccount && !!setup
  const items = usable ? checklistItems({ settings, rules, setup, includeRules: 'yes' }) : NO_IDS
  const idsKey = items.map((i) => i.id).join('\n')

  // The dialog saves only what is on screen; it learns the ids here. Keyed on their joined text, so the
  // same list is reported once, however often this renders.
  useEffect(() => {
    if (typeof onItems === 'function') onItems(idsKey ? idsKey.split('\n') : NO_IDS)
  }, [idsKey, onItems])

  if (settingsState === 'loading') return <p className={styles.muted}>{LOADING}</p>
  if (settingsState === 'error') {
    return (
      <div className={styles.error}>
        <span>Your setups couldn&apos;t load, so your pre-entry checklist isn&apos;t shown.</span>
        <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={retrySettings}>Retry</button>
      </div>
    )
  }
  if (!oneAccount) return <p className={styles.muted}>{ACCOUNT_LINES[rulesState] || LOADING}</p>
  if (!setup) return <p className={styles.muted}>Pick a setup to see its pre-entry checklist.</p>

  const ruleLine = rulesState === 'error' && !items.some((i) => i.source === 'rule')
    ? "Your rules couldn't load, so none are listed here." : null
  if (!items.length) {
    return (
      <>
        <p className={styles.muted}>{`No checklist for ${setup} yet. Add its rules in Journal settings, under Trade setups.`}</p>
        {ruleLine && <p className={styles.muted}>{ruleLine}</p>}
      </>
    )
  }

  const ticked = Array.isArray(checked) ? checked : NO_IDS
  const shown = new Set(items.map((i) => i.id))
  const kept = ticked.filter((id) => !shown.has(id))
  const on = new Set(ticked)
  const warn = softWarning({ requireAll, unticked: uncheckedItems(items, ticked).length })

  return (
    <div role="group" aria-label="Pre-entry checklist" className={styles.empty}>
      <p className={styles.emptyTitle}>{`Pre-entry checklist for ${setup}`}</p>
      {items.map((i) => (
        <label key={i.id} className={styles.row}>
          <input type="checkbox" checked={on.has(i.id)} disabled={disabled}
            onChange={() => { if (!disabled) onChange([...toggleChecked(items, ticked, i.id), ...kept], items.length) }} />
          <span>{i.label}</span>
        </label>
      ))}
      {ruleLine && <p className={styles.muted}>{ruleLine}</p>}
      {requireAll === 'yes' && <p role="status" className={styles.muted}>{warn || ''}</p>}
    </div>
  )
}
