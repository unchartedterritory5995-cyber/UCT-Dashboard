// The pre-entry checklist block (Notebook P2a, Task 7; spec §P2 item 1). The member picks a setup in
// the note; the block lists that setup's checklist (Journal settings) and, when `includeRules` is yes,
// the account's active rules marked "before entry". Ticks live in the block's params (`checked`, ids
// only) and change ONLY through setParams (one editor transaction, the note's own save path).
// ⛔ A checklist is the member's own discipline record: no tick, count or "you have none" appears that
// the member's data does not say, and none the member gave is erased: changing setup writes `setup`
// only, so switching back shows that setup's ticks again (R-T7-2). Loading and failed reads say so in
// words of their own. With no SPECIFIC account selected it lists nothing (C-1, as Log Trade does).
// It reads through hooks/useChecklistSources (data only; the hooks behind it also write) and the ONE
// copy of the item / toggle / "not ticked" logic in lib/blocks/checklistItems.
import { useId } from 'react'
import useChecklistSources from '../../../hooks/useChecklistSources'
import { BLOCK_KINDS } from '../../../lib/journalBlocks'
import {
  CHECKLIST_ACCOUNT_LINES, checklistItems, checklistSummary, toggleChecked, untickedLine,
} from '../../../lib/blocks/checklistItems'
import { BlockEmpty, BlockError, BlockLoading } from './blockStates'
import styles from './Blocks.module.css'

/** A setting the note never stored reads as the block catalog's default (lib/journalBlocks.js, the
 *  one authority the registry and journal_styles are pinned to), never as a guessed answer. */
const SETTINGS = BLOCK_KINDS.find((k) => k.id === 'preEntryChecklist')?.settings || []
function setting(params, key) {
  const s = SETTINGS.find((x) => x.key === key)
  const v = params?.[key]
  return s && s.options.includes(v) ? v : s?.default
}

const RULE_LINES = {
  loading: 'Loading your before-entry rules…',
  error: "Your rules couldn't load, so none are listed here.",
  // (with no specific account the whole checklist says why instead: CHECKLIST_ACCOUNT_LINES)
  // R-T7-2 concern 3: true today and stays true. The pointer to the control that marks a rule
  // "before entry" lands with that control (part b), never before it.
  none: 'No rules are marked "before entry" yet, so none are listed here.',
}

export default function PreEntryChecklistBlock({ params, setParams, editable }) {
  const headingId = useId()
  const includeRules = setting(params, 'includeRules')
  const requireAll = setting(params, 'requireAll')
  const wantRules = includeRules === 'yes'
  const { settings, settingsState, retrySettings, rules, rulesState } = useChecklistSources({ wantRules })
  const setup = typeof params?.setup === 'string' ? params.setup : ''

  if (settingsState === 'loading') return <BlockLoading />
  if (settingsState === 'error') return <BlockError onRetry={retrySettings} />
  // R-M2-1 (c), C-1: no specific account selected. The settings then are the legacy row, not this
  // member's setups, so nothing is listed or offered; the ticks in params are left exactly as they are.
  if (Object.hasOwn(CHECKLIST_ACCOUNT_LINES, settingsState)) {
    return <p className={styles.muted}>{CHECKLIST_ACCOUNT_LINES[settingsState]}</p>
  }

  const setups = Array.isArray(settings?.setups) ? settings.setups : []

  if (!setup) {
    if (!editable) return <p className={styles.muted}>No setup picked for this trade.</p>
    if (!setups.length) {
      return (
        <BlockEmpty title="You have no setups yet. Add your setups and their checklists in Journal settings, under Trade setups, then pick one here." />
      )
    }
    return (
      <label className={styles.row}>
        <span>Setup for this trade</span>
        <select aria-label="Setup for this trade" className={styles.tap} value=""
          onChange={(e) => setParams({ setup: e.target.value })}>
          <option value="" disabled>Pick a setup</option>
          {setups.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    )
  }

  const items = checklistItems({ settings, rules, setup, includeRules })
  const checked = Array.isArray(params?.checked) ? params.checked : []
  // ⛔ R-T7-2 I-2: an id this block cannot resolve RIGHT NOW is not a stale id. The rules may be
  // loading, failed or not listed (All Accounts, includeRules no); another setup's ticks wait for that
  // setup; another account's ids wait for that account. Such ids are never shown and never counted
  // (checklistSummary reads current items only), and a tick never erases them. The shared
  // toggleChecked keeps its contract (Task 8 sends one position's ticks); the block adds them back.
  // Setup rule ids are crypto.randomUUID (settings.py), so an old setup's tick can never land on a
  // new setup's item.
  const resolvable = new Set(items.map((i) => i.id))
  const unresolved = checked.filter((id) => !resolvable.has(id))
  const { done, total } = checklistSummary(items, checked)
  const hasRuleItem = items.some((i) => i.source === 'rule')
  let ruleLine = null
  if (wantRules && !hasRuleItem) ruleLine = RULE_LINES[rulesState === 'ready' ? 'none' : rulesState] || null
  const warn = requireAll === 'yes' ? untickedLine(total - done) : null
  const setupHasItems = items.some((i) => i.source === 'setup')
  const setupGone = !setups.includes(setup)
  let setupLine = null
  if (setupGone) setupLine = `${setup} is no longer one of your setups.${editable ? ' Change setup to pick another.' : ''}`
  else if (!setupHasItems) setupLine = `No checklist for ${setup} yet. Add its rules in Journal settings, under Trade setups.`

  return (
    <div role="group" aria-labelledby={headingId} className={styles.empty}>
      <p id={headingId} className={styles.emptyTitle}>{`Pre-entry checklist for ${setup}`}</p>
      {setupLine && <p className={styles.muted}>{setupLine}</p>}
      {items.map((i) => (
        <label key={i.id} className={styles.row}>
          <input type="checkbox" checked={checked.includes(i.id)} disabled={!editable}
            onChange={() => setParams({ checked: [...toggleChecked(items, checked, i.id), ...unresolved] })} />
          <span>{i.label}</span>
        </label>
      ))}
      {ruleLine && <p className={styles.muted}>{ruleLine}</p>}
      {total > 0 && <p className={styles.muted} aria-live="polite">{`${done} of ${total} ticked`}</p>}
      {warn && <p className={styles.muted} role="status">{warn}</p>}
      {editable && (
        <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={() => setParams({ setup: '' })}>
          Change setup
        </button>
      )}
    </div>
  )
}
