// The pre-entry checklist block (Notebook P2a, Task 7; spec §P2 item 1). The member picks a setup in
// the note; the block lists that setup's checklist (Journal settings) and, when `includeRules` is yes,
// the account's active rules marked "before entry". Ticks live in the block's params (`checked`, ids
// only) and change ONLY through setParams (one editor transaction, the note's own save path).
// ⛔ A checklist is the member's own discipline record: no tick, count or "you have none" appears that
// the member's data does not say. Loading and failed reads say so in words of their own.
// It reads through hooks/useChecklistSources (data only; the hooks behind it also write) and the ONE
// copy of the item / toggle / "not ticked" logic in lib/blocks/checklistItems.
import { useId } from 'react'
import useChecklistSources from '../../../hooks/useChecklistSources'
import { BLOCK_KINDS } from '../../../lib/journalBlocks'
import { checklistItems, checklistSummary, toggleChecked, untickedLine } from '../../../lib/blocks/checklistItems'
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
  'no-account': 'Your before-entry rules show here when one account is selected.',
  none: 'No rules are marked "before entry" yet. Mark one in My rules to add it here.',
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

  const setups = Array.isArray(settings?.setups) ? settings.setups : []

  if (!setup) {
    if (!editable) return <p className={styles.muted}>No setup picked for this trade.</p>
    if (!setups.length) {
      return (
        <BlockEmpty title="You have no setups yet. Add your setups and their checklists in Journal settings, then pick one here." />
      )
    }
    return (
      <label className={styles.row}>
        <span>Setup for this trade</span>
        <select aria-label="Setup for this trade" className={styles.tap} value=""
          onChange={(e) => setParams({ setup: e.target.value, checked: [] })}>
          <option value="" disabled>Pick a setup</option>
          {setups.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    )
  }

  const items = checklistItems({ settings, rules, setup, includeRules })
  const checked = Array.isArray(params?.checked) ? params.checked : []
  const { done, total } = checklistSummary(items, checked)
  const hasRuleItem = items.some((i) => i.source === 'rule')
  let ruleLine = null
  if (wantRules && !hasRuleItem) ruleLine = RULE_LINES[rulesState === 'ready' ? 'none' : rulesState] || null
  const warn = requireAll === 'yes' ? untickedLine(total - done) : null
  const setupHasItems = items.some((i) => i.source === 'setup')

  return (
    <div role="group" aria-labelledby={headingId} className={styles.empty}>
      <p id={headingId} className={styles.emptyTitle}>{`Pre-entry checklist for ${setup}`}</p>
      {!setupHasItems && (
        <p className={styles.muted}>{`No checklist for ${setup} yet. Add its rules in Journal settings, under Setups.`}</p>
      )}
      {items.map((i) => (
        <label key={i.id} className={styles.row}>
          <input type="checkbox" checked={checked.includes(i.id)} disabled={!editable}
            onChange={() => setParams({ checked: toggleChecked(items, checked, i.id) })} />
          <span>{i.label}</span>
        </label>
      ))}
      {ruleLine && <p className={styles.muted}>{ruleLine}</p>}
      {total > 0 && <p className={styles.muted} aria-live="polite">{`${done} of ${total} ticked`}</p>}
      {warn && <p className={styles.muted} role="status">{warn}</p>}
      {editable && (
        <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={() => setParams({ setup: '', checked: [] })}>
          Change setup
        </button>
      )}
    </div>
  )
}
