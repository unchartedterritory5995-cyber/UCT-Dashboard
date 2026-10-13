/**
 * Adherence card (Journal A+ P5-A4) — mounts in the Trade page's "story"
 * section next to the setup select. Given the trade's `setup`, it renders that
 * setup's rule checklist (`settings.setupRules[setup]`, authored in P5-A2) as
 * checkboxes; the checked set persists to `PUT /api/j2/trades/{id}/adherence`
 * optimistically (via `useJ2Adherence`) and a summary shows
 * "N of M rules followed · adherence X%".
 *
 * Gated on `useFeatureFlag('adherence')` — renders null when off so it is
 * instantly revertible per-browser. Mirrors DayRulesChecklist's checkbox-row
 * idiom, but writes to the adherence side-table (not day-notes).
 *
 * Robust to setup edits: only CURRENT setup items render, and a stored setup
 * item id whose item was later deleted/renamed simply drops out (never
 * rendered, never inflates the count).
 *
 * ⛔ Notebook P2b Task 8 (R-T8-1 I-3, ruling R-PF-B9): once a rule can be marked
 * "before entry", the list is the pre-entry checklist's list — the setup's items,
 * then the account's before-entry rules as `rule:<id>` — built by the ONE copy,
 * lib/blocks/checklistItems (includeRules yes), from the checklist's ONE read seam.
 * Log Trade stores exactly that set, so the card, Log Trade and the analytics
 * (which average the stored adherencePct) count one set, and a trade never
 * carries two adherence numbers. A stored `rule:` tick for a rule this list no
 * longer shows (un-marked, dismissed, or another account's) is a tick the member
 * made: it is KEPT on every write, counted as followed in both the count and
 * `totalRules`, and said in a line, never erased. While the rules are still
 * loading the boxes wait, so no write counts a set it has not read.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFeatureFlag } from '../../featureFlags'
import useChecklistSources from '../../hooks/useChecklistSources'
import useJ2Adherence from '../../hooks/useJ2Adherence'
import { RULE_PREFIX, checklistItems } from '../../lib/blocks/checklistItems'
import styles from './AdherenceChecklist.module.css'

export default function AdherenceChecklist({ trade, settings }) {
  const flagOn = useFeatureFlag('adherence')
  const tradeId = trade?.id || null
  const setup = trade?.setup || ''

  // Skip the fetch entirely when the flag is off (pass null → hook no-ops).
  const { adherence, save } = useJ2Adherence(flagOn ? tradeId : null)
  const { rules: accountRules, rulesState } = useChecklistSources({ wantRules: flagOn })

  // No setup, no list: Log Trade lists nothing before a setup is picked either.
  const rules = useMemo(
    () => (setup ? checklistItems({ settings, rules: accountRules, setup, includeRules: 'yes' }) : []),
    [settings, accountRules, setup],
  )
  const ruleIds = useMemo(() => rules.map((r) => r.id), [rules])

  // Local optimistic checked set, seeded from the stored record.
  const [checked, setChecked] = useState(() => new Set())

  // Reseed whenever the trade changes OR the stored record arrives/changes.
  // Keyed on tradeId + an order-independent serialization of the stored ids so
  // an async record load (or prev/next nav) repopulates the boxes, while an
  // optimistic write (same ids) is a harmless no-op reseed.
  const serverKey = `${tradeId}|${(adherence?.checkedRuleIds || [])
    .slice()
    .sort()
    .join(',')}`
  const seededRef = useRef(null)
  useEffect(() => {
    if (seededRef.current === serverKey) return
    seededRef.current = serverKey
    setChecked(new Set(adherence?.checkedRuleIds || []))
  }, [serverKey, adherence])

  if (!flagOn) return null

  // Stored rule ticks this list does not show: kept, and counted as followed (see the header).
  const kept = [...checked].filter((id) => id.startsWith(RULE_PREFIX) && !ruleIds.includes(id))
  const waiting = rulesState === 'loading'
  const total = rules.length + kept.length
  const checkedCount = ruleIds.filter((id) => checked.has(id)).length + kept.length
  const pct = total > 0 ? Math.round((checkedCount / total) * 100) : 0

  const toggle = (id) => {
    if (waiting) return
    const next = new Set(checked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChecked(next)
    // The listed ids that are ticked, then the kept rule ticks; a stale setup item id drops out.
    const nextChecked = [...ruleIds.filter((rid) => next.has(rid)), ...kept]
    save({ setup, checkedRuleIds: nextChecked, totalRules: total })
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>Adherence</span>
        {total > 0 && (
          <span className={styles.summary}>
            {`${checkedCount} of ${total} rules followed · adherence ${pct}%`}
          </span>
        )}
      </div>

      {rules.length === 0 ? (
        <p className={styles.affordance}>
          {setup
            ? `Define rules for ${setup} in Settings`
            : 'Tag a setup to track adherence'}
        </p>
      ) : (
        <ul className={styles.list}>
          {rules.map((r) => {
            const isChecked = checked.has(r.id)
            return (
              <li
                key={r.id}
                className={`${styles.item} ${isChecked ? styles.itemChecked : ''}`}
              >
                <label className={styles.itemLabel}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={isChecked}
                    disabled={waiting}
                    onChange={() => toggle(r.id)}
                  />
                  <span className={styles.text}>{r.label}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      {kept.length > 0 && (
        <p className={styles.affordance}>
          {`Also counted as followed: ${kept.length} ${kept.length === 1 ? 'rule' : 'rules'} ticked earlier that ${kept.length === 1 ? 'is' : 'are'} not listed here.`}
        </p>
      )}
    </div>
  )
}
