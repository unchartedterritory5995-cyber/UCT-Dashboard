import { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import useResearchOverview from './hooks/useResearchOverview'
import ResearchHeader from './ResearchHeader'
import useRatings from './hooks/useRatings'
import OverviewTab from './tabs/OverviewTab'
import FinancialsTab from './tabs/FinancialsTab'
import EstimatesTab from './tabs/EstimatesTab'
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
const TABS = ['Overview', 'Financials', 'Estimates', 'Ratings', 'Ownership', 'Calls & Transcript', 'Filings']

// P2: the earnings modal's rail LINK items deep-open /research/:sym?section=…
// (spec §4.3). Seeding the initial tab from that param is the whole contract —
// the tab stays local state afterwards, and P3 replaces this bar with SectionRail.
const SECTION_TO_TAB = {
  overview: 'Overview', financials: 'Financials', estimates: 'Estimates',
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
      {active === 'Financials' && <FinancialsTab sym={sym} />}
      {active === 'Estimates' && <EstimatesTab sym={sym} />}
      {active === 'Ratings' && <RatingsTab sym={sym} />}
      {active === 'Ownership' && <OwnershipTab sym={sym} />}
      {active === 'Calls & Transcript' && <CallsTab sym={sym} />}
      {active === 'Filings' && <FilingsTab sym={sym} />}
    </div>
  )
}
