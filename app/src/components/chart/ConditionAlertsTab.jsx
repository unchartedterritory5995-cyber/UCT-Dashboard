import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ChartSettingsConditions from './ChartSettingsConditions'
import ConditionAlertPopover from './ConditionAlertPopover'
import { promoteCondition } from './engine/conditionPromotion'
import { alertPayloadFor } from './engine/conditionAlerts'
import { bellState } from './engine/conditionBell'
import { promotionStore } from './builder/promotionStore'
import { conditionsOf } from './engine/conditionControls'
import {
  useIndicatorAlerts, createIndicatorAlert, deleteIndicatorAlert, toggleIndicatorAlert,
} from '../../hooks/useIndicatorAlerts'

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
// here is sequencing and the sentences a member reads when something fails.

export default function ConditionAlertsTab({
  settings, onChange, conditionErrors = null, registry = null, onBuild = null,
  sym = null, tf = null, chartId = null, onClose = null,
}) {
  const { alerts, refresh } = useIndicatorAlerts(chartId)
  const navigate = useNavigate()
  const [busyId, setBusyId] = useState(null)
  const [open, setOpen] = useState(null)      // {condId, rect}
  const [notice, setNotice] = useState(null)

  const list = useMemo(() => conditionsOf(settings), [settings])
  const openCond = open ? list.find((c) => c.id === open.condId) || null : null
  // ⭐ RE-DERIVED FROM THE LIVE LIST ON EVERY RENDER, never captured at open time.
  // Creating an alert changes `armed`; a snapshot taken when the sheet opened
  // would show the member the state from before their own click.
  const openState = openCond ? bellState(openCond, registry, alerts, sym) : null

  const close = useCallback(() => { setOpen(null); setNotice(null) }, [])

  /**
   * Arm an alert on a condition that is already durable.
   *
   * ⛔ THE DEFINITION HANDED OVER IS THE PROOF IT IS INSTALLED. The bell resolved
   * it from the registry; re-asking a probe here would be a second authority on
   * one fact, and asserting `() => true` would defeat the check entirely.
   */
  const onCreate = useCallback(async ({ cond, definition, policyId }) => {
    setNotice(null)
    setBusyId(cond.id)
    try {
      const built = alertPayloadFor(cond, {
        sym, tf, definition, policyId, chartId,
        hasDefinition: (id) => !!definition && (definition.id === id || definition.def_id === id),
      })
      if (!built.ok) { setNotice({ kind: 'error', text: built.reason }); return }
      const res = await createIndicatorAlert(built.payload)
      // ⛔ THE SERVER'S OWN SENTENCE, NOT A RESTATEMENT. The count cap, the
      // admission refusals and a transport failure all arrive here already
      // worded by whoever refused; re-phrasing them would be a second authority
      // on a decision this surface did not make.
      if (!res.ok) { setNotice({ kind: 'error', text: res.error }); return }
      refresh()
      setNotice({
        kind: 'ok',
        // ⭐ WHAT IT WILL DO, IN THE MEMBER'S WORDS. "cross_above 0.5 on
        // u_abc.value" is a sentence about our encoding; `triggerPolicy` owns the
        // translation and hands back the label, so this surface never has to know
        // the comparator.
        text: `Watching ${built.payload.sym} — you'll be told when it ${built.policy.label.toLowerCase()}.`,
      })
    } finally {
      setBusyId(null)
    }
  }, [sym, tf, chartId, refresh])

  /**
   * Make a self-contained condition durable.
   *
   * ⚠️ PROMOTION AND ARMING ARE TWO STEPS ON PURPOSE. Chaining them would mean one
   * click creates a stored formula AND an outward-delivering alert, and a member
   * who only wanted to see whether it was possible would have armed something. The
   * sheet stays open and flips to DURABLE on the next render, so the second click
   * is right where the first one was.
   */
  const onPromote = useCallback(async ({ cond }) => {
    setNotice(null)
    setBusyId(cond.id)
    try {
      const res = await promoteCondition(settings, cond.id, promotionStore(registry))
      if (!res.ok) {
        setNotice({
          kind: 'error',
          text: res.orphanDefinitionId
            // ⛔ THE ORPHAN IS NAMED, NOT HIDDEN. It is inert — it draws nothing
            // and alerts on nothing — and the condition is untouched, which is the
            // part that matters and the part this sentence leads with.
            ? `${cond.name} is unchanged. The formula was saved but could not be added to the chart (${res.reason}).`
            : `${cond.name} is unchanged. ${res.reason}`,
        })
        return
      }
      onChange?.(res.settings)
      setNotice({ kind: 'ok', text: 'Saved. Click Create alert to start watching.' })
    } finally {
      setBusyId(null)
    }
  }, [settings, registry, onChange])

  const onToggle = useCallback(async (id) => {
    await toggleIndicatorAlert(id)
    refresh()
  }, [refresh])

  const onDelete = useCallback(async (id) => {
    await deleteIndicatorAlert(id)
    refresh()
    setNotice({ kind: 'ok', text: 'Alert deleted.' })
  }, [refresh])

  // ⭐ THE ALERT CENTER IS A ROUTE, so "manage" is a navigation rather than a
  // second copy of the manager inside a chart panel. Closing the modal first is
  // the same courtesy the Builder door already extends.
  const onManage = useCallback((alertId) => {
    close()
    onClose?.()
    navigate(alertId ? `/alerts?focus=${encodeURIComponent(alertId)}` : '/alerts')
  }, [navigate, close, onClose])

  return (
    <>
      <ChartSettingsConditions
        settings={settings}
        onChange={onChange}
        conditionErrors={conditionErrors}
        registry={registry}
        onBuild={onBuild}
        alerts={alerts}
        sym={sym}
        busyId={busyId}
        openAlertsFor={open ? open.condId : null}
        // ⚠️ THE DOOR IS OPEN ONLY WHEN AN ALERT COULD ACTUALLY BE MADE. Without a
        // symbol and a timeframe there is nothing to arm, so the bell is absent
        // rather than present and refusing — the same "absent prop ⇒ absent door"
        // rule the Builder button follows.
        onOpenAlerts={sym && tf
          ? (cond, rect) => { setNotice(null); setOpen({ condId: cond.id, rect }) }
          : null}
      />
      {openCond && openState && (
        <ConditionAlertPopover
          cond={openCond}
          state={openState}
          sym={sym}
          tf={tf}
          anchorRect={open.rect}
          busy={busyId === openCond.id}
          notice={notice}
          onClose={close}
          onCreate={onCreate}
          onPromote={onPromote}
          onBuild={onBuild ? (intent) => { close(); onBuild(intent) } : null}
          onManage={onManage}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      )}
    </>
  )
}
