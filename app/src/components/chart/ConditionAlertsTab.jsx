import { useCallback, useState } from 'react'
import ChartSettingsConditions from './ChartSettingsConditions'
import { promoteCondition } from './engine/conditionPromotion'
import { alertPayloadFor } from './engine/conditionAlerts'
import { promotionStore } from './builder/promotionStore'
import { useIndicatorAlerts, createIndicatorAlert } from '../../hooks/useIndicatorAlerts'
import styles from './ChartSettingsModal.module.css'

// ─── THE CONDITIONS TAB, WITH ITS ALERT DOORS OPEN ──────────────────────────
//
// ⭐⭐ THIS COMPONENT EXISTS SO THE SUBSCRIPTION HAS AN OFF SWITCH. `useIndicatorAlerts`
// polls every 30 s, and the settings modal is MOUNTED by every chart whether it is
// open or not — a nine-cell grid would otherwise hold nine pollers for a panel
// nobody opened. The modal already learned this exact lesson with the member's
// formula feed and moved those hooks into a child; this is the same answer for
// the same reason. The tab mounts only while `activeTab === 'conditions'`.
//
// ⛔ AND IT IS THE ONLY PLACE IN THIS LANE THAT TOUCHES THE NETWORK. The bell
// decides what to offer, `conditionPromotion` decides what may move,
// `conditionAlerts` decides what to send — and all three are pure. What is left
// here is sequencing and the two sentences a member reads when something fails.

export default function ConditionAlertsTab({
  settings, onChange, conditionErrors = null, registry = null, onBuild = null,
  sym = null, tf = null, chartId = null,
}) {
  const { alerts, refresh } = useIndicatorAlerts(chartId)
  const [promotingId, setPromotingId] = useState(null)
  const [notice, setNotice] = useState(null)

  /**
   * Arm an alert on a condition that is already durable.
   *
   * ⛔ THE DEFINITION HANDED OVER IS THE PROOF IT IS INSTALLED. The bell resolved
   * it from the registry; re-asking a probe here would be a second authority on
   * one fact, and asserting `() => true` would defeat the check entirely.
   */
  const onArmAlert = useCallback(async ({ cond, definition, policyId }) => {
    setNotice(null)
    const built = alertPayloadFor(cond, {
      sym, tf, definition, policyId,
      chartId,
      hasDefinition: (id) => !!definition && (definition.id === id || definition.def_id === id),
    })
    if (!built.ok) { setNotice({ kind: 'error', text: built.reason }); return }
    const res = await createIndicatorAlert(built.payload)
    if (!res.ok) { setNotice({ kind: 'error', text: res.error }); return }
    refresh()
    setNotice({
      kind: 'ok',
      // ⭐ WHAT IT WILL DO, IN THE MEMBER'S WORDS. "cross_above 0.5 on u_abc.value"
      // is a sentence about our encoding; `triggerPolicy` owns the translation and
      // hands back the label so this surface never has to know the comparator.
      text: `${cond.name} will alert you on ${built.payload.sym} (${built.payload.tf}) when it ${built.policy.label.toLowerCase()}.`,
    })
  }, [sym, tf, chartId, refresh])

  /**
   * Make a self-contained condition durable, then leave it to the member to arm.
   *
   * ⚠️ PROMOTION AND ARMING ARE TWO STEPS ON PURPOSE. Chaining them would mean one
   * click creates a stored formula AND an outward-delivering alert, and a member
   * who only wanted to see whether it was possible would have armed something. The
   * bell flips to DURABLE on the next render, so the second click is right there.
   */
  const onPromoteCondition = useCallback(async ({ cond }) => {
    setNotice(null)
    setPromotingId(cond.id)
    try {
      const res = await promoteCondition(settings, cond.id, promotionStore(registry))
      if (!res.ok) {
        setNotice({
          kind: 'error',
          text: res.orphanDefinitionId
            // ⛔ THE ORPHAN IS NAMED, NOT HIDDEN. It is inert — it draws nothing and
            // alerts on nothing — and the condition is untouched, which is the part
            // that matters and the part this sentence leads with.
            ? `${cond.name} is unchanged. The formula was saved but could not be added to the chart (${res.reason}).`
            : `${cond.name} is unchanged. ${res.reason}`,
        })
        return
      }
      onChange?.(res.settings)
      setNotice({ kind: 'ok', text: `${cond.name} can now run when the chart is closed. Click the bell again to set the alert.` })
    } finally {
      setPromotingId(null)
    }
  }, [settings, registry, onChange])

  return (
    <>
      {notice && (
        <div className={styles.indRow} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span style={{ fontSize: 11, opacity: notice.kind === 'error' ? 0.95 : 0.8 }}>
            {notice.text}
          </span>
        </div>
      )}
      <ChartSettingsConditions
        settings={settings}
        onChange={onChange}
        conditionErrors={conditionErrors}
        registry={registry}
        onBuild={onBuild}
        alerts={alerts}
        sym={sym}
        promotingId={promotingId}
        // ⚠️ THE DOORS ARE OPEN ONLY WHEN AN ALERT COULD ACTUALLY BE MADE. Without
        // a symbol and a timeframe there is nothing to arm, so the bell is absent
        // rather than present and refusing — the same "absent prop ⇒ absent door"
        // rule the Builder button follows.
        onArmAlert={sym && tf ? onArmAlert : null}
        onPromoteCondition={sym && tf ? onPromoteCondition : null}
      />
    </>
  )
}
