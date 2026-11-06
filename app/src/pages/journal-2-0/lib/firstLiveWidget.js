// Audit 2026-11-05, S20 "First aha" (Tier 3a fix round 1, review minor 9): the first time a widget shows the member's
// OWN tickers, `first_live_widget` is sent ONCE PER ACCOUNT -- recorded in the per-account one-time preference
// (`notebook_tips`, id `first-live-widget`, the same store the first run's marks use), so a shared machine or a
// switched account never hides a second member's first "aha". The admin read keeps each member's first row anyway.
import { useEffect } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import { TIPS_PREF, TIP_IDS, seenTips, withTipSeen } from './notebookTips'
import { NOTEBOOK_EVENTS, firstLiveWidgetOn, trackNotebookEvent } from './notebookTelemetry'

// Two widgets on one page can both see the mark missing before the first write lands: one send per tab.
let sentThisTab = false
/** Tests only. */
export function __resetFirstLiveWidgetForTests() { sentThisTab = false }

/** Send `first_live_widget` the first time this account sees `names` (> 0) of its own tickers in a widget. */
export function useFirstLiveWidget(source, names) {
  const on = firstLiveWidgetOn()
  const { prefs, loading, readFailed, setPrefMerged } = usePreferences(on)
  const due = on && !loading && !readFailed && Number(names) > 0
    && !seenTips(prefs?.[TIPS_PREF]).has(TIP_IDS.firstLiveWidget)
  useEffect(() => {
    if (!due || sentThisTab) return
    sentThisTab = true
    setPrefMerged(TIPS_PREF, (current) => withTipSeen(current, TIP_IDS.firstLiveWidget))
    trackNotebookEvent(NOTEBOOK_EVENTS.FIRST_LIVE_WIDGET, { source, names: Number(names) })
  }, [due]) // eslint-disable-line react-hooks/exhaustive-deps
}
