/**
 * MakeRuleButton — turn a recurring mistake into a personal rule (P6-6).
 *
 * Sits on each Cost-of-Mistakes row in the Psychology section. Click → a compact
 * inline confirm PREFILLED with a sensible default rule label (derived from the
 * mistake tag) + a read-only evidence line ("{mistake} tagged {count}× ·
 * {money} lifetime"). The label is EDITABLE. Confirm → persists the rule via
 * `useJournalRules(accountId).create(...)`, shows a subtle "Rule saved", closes,
 * and calls `onCreated?.()`.
 *
 * SUGGESTION-ONLY: this just STORES a reminder — it never changes trading
 * behavior, never auto-arms anything. One confirm, one write.
 *
 * Gated by `useFeatureFlag('makeRule')` (default ON; instant per-browser
 * kill-switch `window.__uctJ2Feature('makeRule', false)`). Renders nothing when
 * the flag is off, or when there's no single account to attach the rule to
 * (the per-account rules endpoint has no "all accounts" path). NO emoji —
 * every glyph is a `<UIcon>`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { useFeatureFlag } from '../../featureFlags'
import useJournalRules from '../../hooks/useJournalRules'
import styles from './MakeRuleButton.module.css'

// Sensible default rule text per mistake tag (the J2 mistake taxonomy). The
// label is only a STARTING point — the user edits it in the confirm.
const RULE_LABELS = {
  no_stop: 'Always log a stop before entry',
  revenge: 'No re-entry within 30 min of a loss',
  oversized: 'Never exceed my max size',
  overtrading: 'Cap my daily trade count',
  chasing: 'No chasing extended entries',
  fomo: 'No FOMO entries',
  late_entry: 'No late entries — take the trigger or pass',
  early_exit: 'Hold winners to my planned target',
  cut_winner: 'Let winners run to target',
  added_to_loser: 'Never add to a loser',
  countertrend: 'No countertrend trades',
  ignored_thesis: 'Honor my written thesis',
  broke_loss_rule: 'Respect my daily loss limit',
  broke_size_rule: 'Respect my max position size',
  broke_checklist: 'Complete my checklist before entry',
  boredom: 'No boredom trades',
  hesitation: 'Take the setup the moment it triggers',
}

function defaultLabelFor(mistake) {
  return RULE_LABELS[mistake] || `Avoid ${mistake}`
}

// Match the Psychology section's dollar formatter so the evidence reads the same.
const money = (v) => {
  if (!v) return '$0'
  return `${v > 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`
}

export default function MakeRuleButton({ mistake, count, total, accountId, onCreated }) {
  const on = useFeatureFlag('makeRule')
  // Read the flag FIRST and only pass an accountId when the surface is on, so a
  // flag-off render fires NO `GET /accounts/{id}/rules` (matches tagSuggest /
  // verdictScore). The `if (!on || !accountId) return null` guard below still
  // renders nothing.
  const { create } = useJournalRules(on && accountId ? accountId : null)

  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(() => defaultLabelFor(mistake))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const closeTimer = useRef(null)

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const evidence = `${mistake} tagged ${count}× · ${money(total)} lifetime`

  const openConfirm = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setLabel(defaultLabelFor(mistake))
    setSaved(false)
    setOpen(true)
  }, [mistake])

  const confirm = useCallback(async () => {
    const text = label.trim()
    if (!text || saving) return
    setSaving(true)
    const res = await create({
      label: text,
      evidence,
      sourceType: 'psychology',
      sourceId: mistake,
    })
    setSaving(false)
    if (res) {
      setSaved(true)
      onCreated?.()
      // Subtle "Rule saved" beat, then close.
      closeTimer.current = setTimeout(() => setOpen(false), 1100)
    }
  }, [label, saving, create, evidence, mistake, onCreated])

  if (!on || !accountId) return null

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => (open ? setOpen(false) : openConfirm())}
        aria-expanded={open}
        aria-label={`Make a rule from ${mistake}`}
      >
        <UIcon name="shield" size={13} className={styles.triggerGlyph} />
        <span>Make this a rule</span>
      </button>

      {open && (
        <div className={styles.pop} role="dialog" aria-label={`Make a rule from ${mistake}`}>
          {saved ? (
            <div className={styles.savedRow}>
              <UIcon name="check" size={15} gold={false} className={styles.savedGlyph} />
              <span>Rule saved</span>
            </div>
          ) : (
            <>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor={`rule-input-${mistake}`}>
                  Your rule
                </label>
                <input
                  id={`rule-input-${mistake}`}
                  type="text"
                  className={styles.input}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  autoFocus
                  maxLength={140}
                />
              </div>
              <p className={styles.evidence}>{evidence}</p>
              <div className={styles.actions}>
                <button type="button" className={styles.cancel} onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.save}
                  onClick={confirm}
                  disabled={saving || !label.trim()}
                >
                  {saving ? 'Saving…' : 'Save rule'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
