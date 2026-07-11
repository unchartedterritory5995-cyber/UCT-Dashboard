/**
 * MyRulesList — the "My rules" list for the Psychology section (P6-6).
 *
 * Renders the account's active personal rules (from `useJournalRules`): each is
 * a bold label + a muted evidence subtext + a dismiss ×. Dismiss optimistically
 * removes the row (the hook POSTs `/rules/{id}/dismiss`).
 *
 * When there are no active rules it shows a single muted invitation line (never
 * a bare blank). Gated by `useFeatureFlag('makeRule')`; also renders nothing when
 * there's no single account selected (the rules endpoint is per-account). NO
 * emoji — every glyph is a `<UIcon>`.
 */

import UIcon from '../../../../components/ui/UIcon'
import { useFeatureFlag } from '../../featureFlags'
import useJournalRules from '../../hooks/useJournalRules'
import styles from './MyRulesList.module.css'

export default function MyRulesList({ accountId }) {
  const on = useFeatureFlag('makeRule')
  // Read the flag FIRST and only pass an accountId when the surface is on, so a
  // flag-off render fires NO `GET /accounts/{id}/rules` (matches tagSuggest /
  // verdictScore). The `if (!on || !accountId) return null` guard still renders
  // nothing.
  const { rules, dismiss } = useJournalRules(on && accountId ? accountId : null)

  if (!on || !accountId) return null

  if (!rules.length) {
    return (
      <p className={styles.empty}>Turn a recurring mistake into a rule above.</p>
    )
  }

  return (
    <section className={styles.wrap} aria-label="My rules">
      <h5 className={styles.title}>My rules</h5>
      <ul className={styles.list}>
        {rules.map((rule) => (
          <li key={rule.id} className={styles.item}>
            <div className={styles.main}>
              <span className={styles.label}>{rule.label}</span>
              {rule.evidence && <span className={styles.evidence}>{rule.evidence}</span>}
            </div>
            <button
              type="button"
              className={styles.dismiss}
              onClick={() => dismiss(rule.id)}
              aria-label={`Dismiss rule: ${rule.label}`}
              title="Dismiss this rule"
            >
              <UIcon name="x" size={14} gold={false} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
