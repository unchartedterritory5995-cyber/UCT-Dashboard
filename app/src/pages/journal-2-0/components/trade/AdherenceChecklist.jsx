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
 * Robust to setup edits: only CURRENT rules render, and only current-rule ids
 * are ever persisted, so a stored `checkedRuleId` whose rule was later
 * deleted/renamed simply drops out (never rendered, never inflates the count).
 * `totalRules` is always the current `rules.length`.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFeatureFlag } from '../../featureFlags'
import useJ2Adherence from '../../hooks/useJ2Adherence'
import styles from './AdherenceChecklist.module.css'

export default function AdherenceChecklist({ trade, settings }) {
  const flagOn = useFeatureFlag('adherence')
  const tradeId = trade?.id || null
  const setup = trade?.setup || ''

  // Skip the fetch entirely when the flag is off (pass null → hook no-ops).
  const { adherence, save } = useJ2Adherence(flagOn ? tradeId : null)

  const rules = useMemo(() => {
    const r = settings?.setupRules?.[setup]
    return Array.isArray(r) ? r : []
  }, [settings, setup])
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

  const total = rules.length
  const checkedCount = ruleIds.filter((id) => checked.has(id)).length
  const pct = total > 0 ? Math.round((checkedCount / total) * 100) : 0

  const toggle = (id) => {
    const next = new Set(checked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChecked(next)
    // Persist only current-rule ids (drops any stale stored id).
    const nextChecked = ruleIds.filter((rid) => next.has(rid))
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

      {total === 0 ? (
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
                    onChange={() => toggle(r.id)}
                  />
                  <span className={styles.text}>{r.label}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
