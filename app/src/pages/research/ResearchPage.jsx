import { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import useResearchOverview from './hooks/useResearchOverview'
import ResearchHeader from './ResearchHeader'
import useRatings from './hooks/useRatings'
import OverviewTab from './tabs/OverviewTab'
import FinancialsTab from './tabs/FinancialsTab'
import EstimatesTab from './tabs/EstimatesTab'
import AnalystRatingsTab from './tabs/AnalystRatingsTab'
import NewsTab from './tabs/NewsTab'
import RatingsTab from './tabs/RatingsTab'
import OwnershipTab from './tabs/OwnershipTab'
import CallsTab from './tabs/CallsTab'
import FilingsTab from './tabs/FilingsTab'
import PaywallTeaser from './PaywallTeaser'
import styles from './ResearchPage.module.css'

// 2026-09-03 A6/A7 pass: "Filings & Events" corrected to "Filings" — the tab
// has only ever rendered SEC filings (FilingsTab.jsx), never events/calendar
// content; the label over-promised functionality that was never built. If a
// real Events surface is authorized later (A5's Events & Calendar territory,
// out of this pass's scope), give it its own tab rather than reviving this
// label — do not read "Events" back into Filings just because the old label
// implied it once.
//
// 2026-09-03 dedicated Analyst Ratings slice (owner-authorized product-home
// split): "Analyst Ratings" is a NEW tab, not a rename. It owns third-party
// analyst consensus/price-targets/recent actions -- content that used to be
// enriched into Estimates (now narrowed to EPS/revenue forecasts only) and
// that was ALSO independently rendered on a different surface entirely
// (AnalystPanel.jsx, via TickerPopup/Charts widgets — a live, paid-gated,
// legacy path deliberately left untouched, retirement deferred). Do not
// confuse this with the "Ratings" tab, which stays the UCT Composite Rating
// — a separate, 100% locally-derived product concept.
//
// 2026-09-04 News/Intelligence Slice 1 (A8, owner-authorized narrow slice):
// "News" is a NEW tab, security-scoped only (curated-first per owner
// decision 1 -- no market-wide/browsable feed here). Placed right after
// Overview: "what's happening" is the natural first stop before the
// numbers. The calendar modal's own separate News tab
// (EarningsResearchModal.jsx's Coverage group) is a COMPATIBILITY BRIDGE,
// untouched -- this is a second, canonical surface, not a replacement.
const TABS = ['Overview', 'News', 'Financials', 'Estimates', 'Analyst Ratings', 'Ratings', 'Ownership', 'Calls & Transcript', 'Filings']

// P2: the earnings modal's rail LINK items deep-open /research/:sym?section=…
// (spec §4.3). Seeding the initial tab from that param is the whole contract —
// the tab stays local state afterwards, and P3 replaces this bar with SectionRail.
const SECTION_TO_TAB = {
  overview: 'Overview', news: 'News', financials: 'Financials', estimates: 'Estimates',
  'analyst-ratings': 'Analyst Ratings',
  ratings: 'Ratings', ownership: 'Ownership', calls: 'Calls & Transcript',
  filings: 'Filings',
}

export default function ResearchPage() {
  const { sym: rawSym } = useParams()
  const navigate = useNavigate()
  const { isPaid } = useAuth()
  const [searchParams] = useSearchParams()
  const [active, setActive] = useState(
    () => SECTION_TO_TAB[(searchParams.get('section') || '').toLowerCase()] || 'Overview',
  )
  const data = useResearchOverview(rawSym)
  const sym = data.sym
  const { data: ratingsData } = useRatings(sym)
  const headerRatings = ratingsData ? { composite: ratingsData.composite, ...(ratingsData.components || {}) } : null

  if (!isPaid) {
    return <div className={styles.page}><PaywallTeaser sym={sym} /></div>
  }

  return (
    <div className={styles.page}>
      <ResearchHeader
        sym={sym}
        meta={data.meta}
        live={data.live}
        ratings={headerRatings}
        onSymbolChange={(s) => s && navigate(`/research/${s.toUpperCase()}`)}
      />
      <nav className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t}
            className={`${styles.tab} ${active === t ? styles.tabOn : ''}`}
            onClick={() => setActive(t)}
          >{t}</button>
        ))}
      </nav>
      {active === 'Overview' && <OverviewTab sym={sym} stats={data.stats} analyst={data.analyst} ai={data.ai} row={null} />}
      {active === 'News' && <NewsTab sym={sym} />}
      {active === 'Financials' && <FinancialsTab sym={sym} />}
      {active === 'Estimates' && <EstimatesTab sym={sym} />}
      {active === 'Analyst Ratings' && <AnalystRatingsTab sym={sym} />}
      {active === 'Ratings' && <RatingsTab sym={sym} />}
      {active === 'Ownership' && <OwnershipTab sym={sym} />}
      {active === 'Calls & Transcript' && <CallsTab sym={sym} />}
      {active === 'Filings' && <FilingsTab sym={sym} />}
    </div>
  )
}
