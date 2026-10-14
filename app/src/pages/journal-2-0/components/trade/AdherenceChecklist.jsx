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
 * item id whose item was later deleted/renamed simply drops out of a write.
 *
 * ⛔ Notebook P2b Task 8 (R-T8-1 I-3, ruling R-PF-B9): once a rule can be marked
 * "before entry", the list is the pre-entry checklist's list — the setup's items,
 * then the account's before-entry rules as `rule:<id>` — built by the ONE copy,
 * lib/blocks/checklistItems (includeRules yes), from the checklist's ONE read seam,
 * so the card, Log Trade and the analytics (which average the stored
 * adherencePct) count one set. A stored `rule:` tick for a rule this list does not
 * show is a tick the member made: it is KEPT on every write, counted as followed,
 * and said in a line, never erased.
 *
 * ⛔ Fix round 1, R-T8-2: a stored record is never silently re-scored. Until the
 * member answers a box on THIS card, the summary is the record's own count, total
 * and percentage. A before-entry rule the record does not hold (switched on since,
 * or never ticked; a record stores ticks only, so the two cannot be told apart, R-T8-2a) sits in its
 * own group, "Not answered on this trade", and enters the
 * count, and a write, only once the member answers it here. A trade with no record
 * counts the whole list, as before.
 * ⛔ R-T8-3: the rules are the SELECTED account's. On a trade whose `accountId` is
 * another account, none of them is listed or counted; a sentence says why, and the
 * record's stored rule ticks pass through a write untouched. The setup items work.
 * ⛔ m1: while the rules are loading, or failed to load, the boxes wait, so no write
 * counts a set it has not read.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFeatureFlag } from '../../featureFlags'
import useChecklistSources from '../../hooks/useChecklistSources'
import useJ2Adherence from '../../hooks/useJ2Adherence'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import { RULE_PREFIX, checklistItems } from '../../lib/blocks/checklistItems'
import styles from './AdherenceChecklist.module.css'

const OTHER_ACCOUNT = 'This trade is in another account. Switch to that account to see its checklist.'
// Log Trade's own sentence for rules that failed to load (components/LogTradeChecklist.jsx).
const RULES_FAILED = "Your rules couldn't load, so none are listed here."
const NO_IDS = new Set()

export default function AdherenceChecklist({ trade, settings }) {
  const flagOn = useFeatureFlag('adherence')
  const tradeId = trade?.id || null
  const setup = trade?.setup || ''

  // Skip the fetch entirely when the flag is off (pass null → hook no-ops).
  const { adherence, save } = useJ2Adherence(flagOn ? tradeId : null)
  const { rules: accountRules, rulesState } = useChecklistSources({ wantRules: flagOn })
  const { accountId: selectedId } = useJ2SelectedAccount()
  // R-T8-3: a trade with no account of its own (legacy) is read as the selected account's.
  const tradeAccount = typeof trade?.accountId === 'string' && trade.accountId ? trade.accountId : null
  const otherAccount = !!tradeAccount && !!selectedId && tradeAccount !== selectedId

  // No setup, no list: Log Trade lists nothing before a setup is picked either.
  const items = useMemo(
    () => (setup
      ? checklistItems({ settings, rules: otherAccount ? [] : accountRules, setup, includeRules: 'yes' })
      : []),
    [settings, accountRules, setup, otherAccount],
  )
  const itemIds = useMemo(() => items.map((r) => r.id), [items])

  // Local optimistic checked set, seeded from the stored record.
  const [checked, setChecked] = useState(() => new Set())
  // R-T8-2: the record as it stood when the member first answered on this card (null until then),
  // and the added rules they answered. Both are per trade.
  const [answeredFrom, setAnsweredFrom] = useState(null)
  const [answered, setAnswered] = useState(null)

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

  const touched = answeredFrom?.tradeId === tradeId
  const base = touched
    ? answeredFrom
    : { tradeId, hasRecord: !!adherence, ids: new Set(adherence?.checkedRuleIds || []) }
  const answeredIds = answered?.tradeId === tradeId ? answered.ids : NO_IDS
  const isAdded = (i) => base.hasRecord && i.source === 'rule' && !base.ids.has(i.id)
  const counts = (i, ans) => !isAdded(i) || ans.has(i.id)
  const listed = items.filter((i) => !isAdded(i))
  const added = items.filter(isAdded)

  // Stored rule ticks this list does not show: kept, and counted as followed (see the header).
  const kept = [...checked].filter((id) => id.startsWith(RULE_PREFIX) && !itemIds.includes(id))
  const waiting = !otherAccount && (rulesState === 'loading' || rulesState === 'error')

  let checkedCount
  let total
  let pct
  if (adherence && !touched) {
    // The record's own numbers, never re-scored by a list that changed since it was written.
    checkedCount = Array.isArray(adherence.checkedRuleIds) ? adherence.checkedRuleIds.length : 0
    total = Number.isFinite(adherence.totalRules) ? adherence.totalRules : 0
    const stored = Number.isFinite(adherence.adherencePct) ? adherence.adherencePct : (total ? checkedCount / total : 0)
    pct = Math.round(stored * 100)
  } else {
    const counted = items.filter((i) => counts(i, answeredIds))
    total = counted.length + kept.length
    checkedCount = counted.filter((i) => checked.has(i.id)).length + kept.length
    pct = total > 0 ? Math.round((checkedCount / total) * 100) : 0
  }

  const toggle = (item) => {
    if (waiting) return
    const next = new Set(checked)
    if (next.has(item.id)) next.delete(item.id)
    else next.add(item.id)
    setChecked(next)
    if (!touched) setAnsweredFrom(base)
    const ans = new Set(answeredIds)
    if (isAdded(item)) ans.add(item.id)
    setAnswered({ tradeId, ids: ans })
    // The counted ids that are ticked, then the kept rule ticks; a stale setup item id drops out,
    // and an added rule the member has not answered here is neither written nor counted.
    const counted = items.filter((i) => counts(i, ans))
    const nextChecked = [...counted.filter((i) => next.has(i.id)).map((i) => i.id), ...kept]
    save({ setup, checkedRuleIds: nextChecked, totalRules: counted.length + kept.length })
  }

  const row = (r) => {
    const isChecked = checked.has(r.id)
    return (
      <li key={r.id} className={`${styles.item} ${isChecked ? styles.itemChecked : ''}`}>
        <label className={styles.itemLabel}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={isChecked}
            disabled={waiting}
            onChange={() => toggle(r)}
          />
          <span className={styles.text}>{r.label}</span>
        </label>
      </li>
    )
  }
  const addedHeadId = `adherence-added-${tradeId}`

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

      {items.length === 0 ? (
        <p className={styles.affordance}>
          {setup
            ? `Define rules for ${setup} in Settings`
            : 'Tag a setup to track adherence'}
        </p>
      ) : (
        listed.length > 0 && <ul className={styles.list}>{listed.map(row)}</ul>
      )}
      {added.length > 0 && (
        <div role="group" aria-labelledby={addedHeadId} className={styles.list}>
          <p id={addedHeadId} className={styles.title}>Not answered on this trade</p>
          <ul className={styles.list}>{added.map(row)}</ul>
        </div>
      )}
      {setup && otherAccount && <p className={styles.affordance}>{OTHER_ACCOUNT}</p>}
      {setup && !otherAccount && rulesState === 'error' && <p className={styles.affordance}>{RULES_FAILED}</p>}
      {kept.length > 0 && (
        <p className={styles.affordance}>
          {`Also counted as followed: ${kept.length} ${kept.length === 1 ? 'rule' : 'rules'} ticked earlier that ${kept.length === 1 ? 'is' : 'are'} not listed here.`}
        </p>
      )}
    </div>
  )
}
