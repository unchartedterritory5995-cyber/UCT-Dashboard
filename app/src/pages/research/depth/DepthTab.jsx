import { useEffect, useRef } from 'react'
import FilingSearchPanel from './FilingSearchPanel'
import EarningsReactionPanel from './EarningsReactionPanel'
import EventsPanel from './EventsPanel'
import FtdPanel from './FtdPanel'
import MentionSeriesPanel from './MentionSeriesPanel'
import BrokerEstimatesPanel from './BrokerEstimatesPanel'
import NewsDeskPanel from './NewsDeskPanel'
import { NEWS_DESK_KEYS } from './researchDepthFlags'
import CallReplayPanel from './CallReplayPanel'
import styles from './Depth.module.css'
import { DepthStackContext } from './depthChrome'
import HowToChecklist from '../../../components/howTo/HowToChecklist'
import { DEPTH_HOW_TO_SURFACES } from '../../../components/howTo/howToChecklists'
import PanelState from '../../../components/terminal/PanelState'

// Research > Depth (lane gaps-research). A container only: each panel is its own
// surface behind its own server flag (researchDepthFlags.js), and a panel whose
// flag is off is not rendered at all.
//
// `focus` (the page's `?panel=`, which the /terminal "Full page" link sets from the code's own
// depth flag — functions.js::depthPanelOf) is one of these flag keys: that panel renders FIRST
// and highlighted, and is scrolled to, so EVTS / FTD / … land on their panel rather than the
// tab's top. Leading with it (not just scrolling) is what makes the landing deterministic —
// the panels above it load asynchronously and would push a scroll target down.
// ⛔ Keyed by the SAME flag keys that gate each panel, so no second vocabulary exists.
export const DEPTH_PANELS = [
  ['earnings_reaction_panel_enabled', EarningsReactionPanel],
  ['events_timeline_enabled', EventsPanel],
  ['broker_estimates_enabled', BrokerEstimatesPanel],
  ['ftd_dataset_enabled', FtdPanel],
  ['mention_series_enabled', MentionSeriesPanel],
  ['filing_search_enabled', FilingSearchPanel],
]

export default function DepthTab({ sym, flags, focus = null }) {
  const f = flags || {}
  const focusRef = useRef(null)
  const on = DEPTH_PANELS.filter(([k]) => f[k] === true)
  const focused = on.find(([k]) => k === focus)
  const ordered = focused ? [focused, ...on.filter(p => p !== focused)] : on
  useEffect(() => {
    if (focused && focusRef.current?.scrollIntoView) focusRef.current.scrollIntoView({ block: 'start' })
  }, [focused])
  // Completeness audit 2026-10-07: with no depth panel switched on, DPTH opened as an empty box.
  // Say why in plain words instead -- nothing failed; nothing is switched on.
  const anyOn = on.length > 0 || NEWS_DESK_KEYS.some(k => f[k] === true) || f.call_replay_enabled === true
  if (!anyOn) {
    return (
      <div className={styles.depth} data-testid="research-depth">
        <PanelState kind="locked" testId="depth-none-on" title="No depth panel is switched on yet.">
          Depth stacks the deeper research panels (earnings reactions, events, broker estimates,
          fails-to-deliver, mentions, filing search, the news desk and call replay). Each one is
          switched on separately, and none is on for this account yet, so there is nothing to show
          for {String(sym || '').toUpperCase() || 'this ticker'}. That is not a failed read.
        </PanelState>
      </div>
    )
  }
  return (
    <DepthStackContext.Provider value={true}>
    <div className={styles.depth} data-testid="research-depth">
      {/* FT-046: one checklist per panel that is ON; each renders nothing unless
          HOW_TO_CHECKLISTS_ENABLED is on AND the owner approved its copy. */}
      {Object.entries(DEPTH_HOW_TO_SURFACES).map(([k, surface]) =>
        f[k] === true ? <HowToChecklist key={surface} surface={surface} /> : null)}
      {ordered.map(([k, Panel]) => (
        <div
          key={k}
          id={`depth-${k}`}
          data-depth-panel={k}
          data-focused={k === focus ? 'true' : undefined}
          ref={k === focus ? focusRef : undefined}
          className={k === focus ? styles.focused : undefined}
        >
          <Panel sym={sym} />
        </div>
      ))}
      {NEWS_DESK_KEYS.some(k => f[k] === true) && <NewsDeskPanel sym={sym} />}
      {f.call_replay_enabled === true && <CallReplayPanel sym={sym} />}
    </div>
    </DepthStackContext.Provider>
  )
}
