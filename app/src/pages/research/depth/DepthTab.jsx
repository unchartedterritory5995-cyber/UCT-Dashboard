import FilingSearchPanel from './FilingSearchPanel'
import EarningsReactionPanel from './EarningsReactionPanel'
import EventsPanel from './EventsPanel'
import FtdPanel from './FtdPanel'
import MentionSeriesPanel from './MentionSeriesPanel'
import styles from './Depth.module.css'

// Research > Depth (lane gaps-research). A container only: each panel is its own
// surface behind its own server flag (researchDepthFlags.js), and a panel whose
// flag is off is not rendered at all.
export default function DepthTab({ sym, flags }) {
  const f = flags || {}
  return (
    <div className={styles.depth} data-testid="research-depth">
      {f.earnings_reaction_panel_enabled === true && <EarningsReactionPanel sym={sym} />}
      {f.events_timeline_enabled === true && <EventsPanel sym={sym} />}
      {f.ftd_dataset_enabled === true && <FtdPanel sym={sym} />}
      {f.mention_series_enabled === true && <MentionSeriesPanel sym={sym} />}
      {f.filing_search_enabled === true && <FilingSearchPanel sym={sym} />}
    </div>
  )
}
