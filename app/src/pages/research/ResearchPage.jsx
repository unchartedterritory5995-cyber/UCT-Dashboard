import { useState } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { parseResearchReturnParam, researchReturnTarget, researchReturnLabel } from '../../lib/journal-2-0'
import useResearchOverview from './hooks/useResearchOverview'
import useLatestReport from './hooks/useLatestReport'
import ResearchHeader from './ResearchHeader'
import useRatings from './hooks/useRatings'
import OverviewTab from './tabs/OverviewTab'
import FinancialsTab from './tabs/FinancialsTab'
import EstimatesTab from './tabs/EstimatesTab'
import FinancialsDeep from '../../components/research/fmpDepth/FinancialsDeep'
import ConsensusEstimates from '../../components/research/fmpDepth/ConsensusEstimates'
import AnalystRatingsTab from './tabs/AnalystRatingsTab'
import NewsTab from './tabs/NewsTab'
import CatalystsTab from './tabs/CatalystsTab'
import ModelBookTab from './tabs/ModelBookTab'
import TechnicalTab from './tabs/TechnicalTab'
import FlowTab from './tabs/FlowTab'
import RatingsTab from './tabs/RatingsTab'
import OwnershipTab from './tabs/OwnershipTab'
import CallsTab from './tabs/CallsTab'
import FilingsTab from './tabs/FilingsTab'
import AskAiTab from './tabs/AskAiTab'
import DecisionRecordTab from './tabs/DecisionRecordTab'
import HistoryTab from './tabs/HistoryTab'
import OptionsChainTab from './tabs/OptionsChainTab'
import SeasonalityTab from './tabs/SeasonalityTab'
import FilingChangesTab from './tabs/FilingChangesTab'
import PeopleTab from './tabs/PeopleTab'
import EstimateHistoryTab from './tabs/EstimateHistoryTab'
import FilingsFeedTab from './tabs/FilingsFeedTab'
import DepthTab from './depth/DepthTab'
import { anyResearchDepth } from './depth/researchDepthFlags'
import ResearchNotices from './notices/ResearchNotices'
import PaywallTeaser from './PaywallTeaser'
import TickerResearchWorkspace from '../journal-2-0/components/notebook/TickerResearchWorkspace'
import { notePath } from '../../hooks/useNoteBacklinks'
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
//
// 2026-09-04 AI-Native Research Assistant Slice 1 (I1 Intelligence Layer,
// owner-authorized narrow slice): "Ask AI" is the ONE contextual AI door
// inside this already-canonical security context (OQ-05's provisional
// answer -- a context layer on an existing surface, not a second AI entry
// point). It EXPLAINS (news + analyst activity, cited); it does not
// decide -- see api/services/ticker_explain.py. Placed last, mirroring
// the calendar modal's own tab ordering (Ask AI is that modal's last
// group too).
// 2026-09-05 Chart/Technical Intelligence Convergence (owner-authorized
// narrow slice, Phase B): "Technical" is a NEW tab, placed right after News —
// both answer "what's happening / why does this matter right now" before the
// fundamental-data tabs. Source is the EXISTING /api/patterns/{sym} endpoint's
// confirmed-only (Opus-vision-verified) output, never the raw scanner
// firehose the owner already ruled untrustworthy. See TechnicalTab.jsx.
// 2026-09-07 Wave H (Notebook Research Home + Ticker Research Workspace):
// "My Research" is a BRIDGE tab, not a re-implementation -- it mounts the
// exact same `TickerResearchWorkspace` component Notebook's own
// `/journal/notebook/research/:symbol` route renders (checkpoint decision
// 6/7). This tab owns MY private research about the security (notes/
// theses/captured facts/trade-links); every OTHER tab on this page keeps
// 100% of the market/vendor data -- that boundary is deliberate (checkpoint
// decision 7/§33's "MY RESEARCH vs MARKET DATA" distinction), not
// incidental. Placed last, after Ask AI: this page's existing tab order
// already reads as "the market's view of this company" first, ending on
// this member's own working context.
// REBASE RESOLUTION 2026-09-09: both tabs, both intents intact -- Technical
// sits right after News (its "what's happening now" grouping) and My Research
// stays LAST (this page reads market-view-first, ending on the member's own
// working context). Neither ordering rule constrains the other.
//
// Packet G CP1 (signed 2026-09-22, fingerprint 5331c90c2): "Catalysts" joins
// the same "what's happening now" grouping as News/Technical -- what has
// UCT's own catalyst engine ever flagged about this ticker, across every
// date, not just today's top-20 (that's the Dashboard tile's job).
//
// Packet H CP1 (signed 2026-09-22, fingerprint f119617df): "Model Book"
// joins the "what others/we have said about this name" grouping (with
// Analyst Ratings/Calls & Transcript), ahead of the raw-document tabs
// (Filings) -- has this ticker ever been a curated Model Book entry.
//
// A13 Wave B (2026-09-23, roadmap-2026-09-23): "Flow" joins the same
// "what's happening now" grouping as News/Technical/Catalysts, right after
// Technical -- what has the options tape actually shown on this ticker,
// reusing the existing per-ticker flow endpoint (see FlowTab.jsx for the
// scope-revision rationale: this replaced a literal thesis+setup+trade+flow
// merged panel, which would have violated this page's own "MY RESEARCH vs
// MARKET DATA" boundary below). Ships DARK behind RESEARCH_FLOW_TAB_ENABLED,
// same mechanism and polarity as RESEARCH_TECHNICAL_TAB_ENABLED.
//
// TERM-088 (item 15 ACC-02): "Decision Record" joins the "what we have said
// about this name" grouping, right after Model Book -- what UCT's own Morning
// Wire considered about this ticker, issue by issue, and the stage each
// rejection happened at. It is the firm's record, not the member's, so it sits
// on the market-view side of the MY RESEARCH boundary. Ships DARK behind
// DECISION_RECORD_MEMBER_ENABLED (served as decision_record_enabled), same
// mechanism and polarity as the Flow tab.
//
// COV-05 / COV-07 / COV-09 (roadmap RM-L19): "People" sits with Ownership (who
// runs and holds the company), "Estimate history" right after Estimates (how the
// consensus got where it is), and "Filings feed" beside Filings (what SEC has
// received, live, per ticker and market-wide). Each is DARK behind its own flag:
// RESEARCH_PEOPLE_ENABLED, ESTIMATE_HISTORY_ENABLED, FILINGS_FEED_ENABLED.
const TABS = ['Overview', 'News', 'Catalysts', 'Technical', 'Flow', 'Options', 'Seasonality', 'Financials', 'Estimates', 'Estimate history', 'Analyst Ratings', 'Ratings', 'Ownership', 'People', 'Calls & Transcript', 'Model Book', 'Decision Record', 'History', 'Filings', 'Filings feed', 'Filing changes', 'Depth', 'Ask AI', 'My Research']

// P2: the earnings modal's rail LINK items deep-open /research/:sym?section=…
// (spec §4.3). Seeding the initial tab from that param is the whole contract —
// the tab stays local state afterwards, and P3 replaces this bar with SectionRail.
const SECTION_TO_TAB = {
  'filing-changes': 'Filing changes',
  depth: 'Depth',
  overview: 'Overview', news: 'News', catalysts: 'Catalysts', technical: 'Technical', flow: 'Flow', options: 'Options', seasonality: 'Seasonality', financials: 'Financials', estimates: 'Estimates',
  'analyst-ratings': 'Analyst Ratings',
  ratings: 'Ratings', ownership: 'Ownership', calls: 'Calls & Transcript', modelbook: 'Model Book',
  'decision-record': 'Decision Record',
  people: 'People', 'estimate-history': 'Estimate history', 'filings-feed': 'Filings feed',
  history: 'History',
  filings: 'Filings', ai: 'Ask AI', research: 'My Research',
}

export default function ResearchPage() {
  const { sym: rawSym } = useParams()
  const navigate = useNavigate()
  const { isPaid, researchTechnicalTabEnabled, researchFlowTabEnabled, decisionRecordEnabled, tickerHistoryEnabled, optionsChainEnabled, optionsVolSurfaceEnabled, optionsBacktestEnabled, seasonalityEnabled, filingBlacklineEnabled, researchPeopleEnabled, estimateHistoryEnabled, filingsFeedEnabled, researchDepth, researchNotices, researchFmpDepthEnabled } = useAuth()
  const [searchParams] = useSearchParams()
  const [rawActive, setActive] = useState(
    () => SECTION_TO_TAB[(searchParams.get('section') || '').toLowerCase()] || 'Overview',
  )
  // Seam 12 fix (Journal / Trade Lifecycle Convergence V1): a member arriving
  // via Full Research/Ask AI/Compare from a Trade or Position surface
  // otherwise has no way back except browser Back. Seeded once at mount,
  // same convention as `section` above -- this is a one-time entry marker,
  // not live state the tab-switching UI needs to track.
  const [returnTo] = useState(() => parseResearchReturnParam(searchParams.get('from')))
  // `?section=depth&panel=<depth flag key>` (the /terminal EVTS / FTD / … "Full page" link)
  // lands on that one Depth panel. Seeded once, like `section`; DepthTab ignores a key that is
  // not one of its panels, so a stale or hand-typed value just opens the tab as before.
  const [depthFocus] = useState(() => searchParams.get('panel') || null)
  // Chart/Technical Intelligence Convergence ships DARK behind
  // RESEARCH_TECHNICAL_TAB_ENABLED (off by default, read per request off the
  // auth payload — see api/routers/auth.py::_access_payload). With it off the
  // tab is absent from the strip AND `?section=technical` falls through to
  // Overview rather than selecting a tab that is not there, which would render
  // an empty content area under a strip that never offered it.
  //
  // A13 Wave B's "Flow" tab ships dark the same way behind
  // RESEARCH_FLOW_TAB_ENABLED — same reasoning, independent flag.
  const tabs = TABS.filter(t =>
    (t !== 'Technical' || researchTechnicalTabEnabled) &&
    (t !== 'Flow' || researchFlowTabEnabled) &&
    (t !== 'Decision Record' || decisionRecordEnabled === true) &&
    (t !== 'History' || tickerHistoryEnabled === true) &&
    // BRK-01 increment 1: the option chain, dark behind OPTIONS_CHAIN_ENABLED.
    (t !== 'Options' || optionsChainEnabled === true) &&
    // COV-01: seasonality, dark behind SEASONALITY_ENABLED.
    (t !== 'Seasonality' || seasonalityEnabled === true) &&
    // COV-04: filing-to-filing blackline, dark behind FILING_BLACKLINE_ENABLED.
    (t !== 'Filing changes' || filingBlacklineEnabled === true) &&
    // COV-05 / COV-07 / COV-09: each dark behind its own flag.
    (t !== 'People' || researchPeopleEnabled === true) &&
    (t !== 'Estimate history' || estimateHistoryEnabled === true) &&
    (t !== 'Filings feed' || filingsFeedEnabled === true) &&
    // lane gaps-research: the Depth tab exists while ANY of its panels' flags is on;
    // each panel inside it is gated by its own flag (depth/researchDepthFlags.js).
    (t !== 'Depth' || anyResearchDepth(researchDepth)))
  const active = tabs.includes(rawActive) ? rawActive : 'Overview'

  const data = useResearchOverview(rawSym)
  const sym = data.sym
  const { data: ratingsData } = useRatings(sym)
  const report = useLatestReport(sym)
  const headerRatings = ratingsData ? { composite: ratingsData.composite, ...(ratingsData.components || {}) } : null

  if (!isPaid) {
    return <div className={styles.page}><PaywallTeaser sym={sym} /></div>
  }

  return (
    <div className={styles.page}>
      {returnTo && (
        <Link to={researchReturnTarget(returnTo)} className={styles.returnLink}>
          &larr; {researchReturnLabel(returnTo)}
        </Link>
      )}
      <ResearchHeader
        sym={sym}
        meta={data.meta}
        live={data.live}
        ratings={headerRatings}
        onSymbolChange={(s) => s && navigate(`/research/${s.toUpperCase()}`)}
      />
      {/* Lane R notices (D-9/D-11/D-12): each dark behind its own flag; renders nothing while all are off. */}
      <ResearchNotices sym={sym} flags={researchNotices} />
      <nav className={styles.tabs}>
        {tabs.map(t => (
          <button
            key={t}
            className={`${styles.tab} ${active === t ? styles.tabOn : ''}`}
            onClick={() => setActive(t)}
          >{t}</button>
        ))}
      </nav>
      {active === 'Overview' && <OverviewTab sym={sym} stats={data.stats} analyst={data.analyst} ai={data.ai} row={report.row} reportState={report.state} retryReport={report.retry} error={data.error} mutate={data.mutate} />}
      {active === 'News' && <NewsTab sym={sym} />}
      {active === 'Catalysts' && <CatalystsTab sym={sym} />}
      {active === 'Technical' && <TechnicalTab sym={sym} />}
      {active === 'Flow' && <FlowTab sym={sym} />}
      {/* RESEARCH_FMP_DEPTH_ENABLED: the terminal's FA/EE depth views. Off => as before. */}
      {active === 'Financials' && (researchFmpDepthEnabled ? <FinancialsDeep sym={sym} /> : <FinancialsTab sym={sym} />)}
      {active === 'Estimates' && (researchFmpDepthEnabled ? <ConsensusEstimates sym={sym} /> : <EstimatesTab sym={sym} />)}
      {active === 'Analyst Ratings' && <AnalystRatingsTab sym={sym} />}
      {active === 'Ratings' && <RatingsTab sym={sym} />}
      {active === 'Ownership' && <OwnershipTab sym={sym} />}
      {active === 'Calls & Transcript' && <CallsTab sym={sym} />}
      {active === 'Model Book' && <ModelBookTab sym={sym} />}
      {active === 'Decision Record' && <DecisionRecordTab sym={sym} />}
      {active === 'History' && <HistoryTab sym={sym} />}
      {active === 'Options' && <OptionsChainTab sym={sym} volSurface={optionsVolSurfaceEnabled === true} backtest={optionsBacktestEnabled === true} />}
      {active === 'Seasonality' && <SeasonalityTab sym={sym} />}
      {active === 'Filings' && <FilingsTab sym={sym} />}
      {active === 'Filing changes' && <FilingChangesTab sym={sym} />}
      {active === 'People' && <PeopleTab sym={sym} />}
      {active === 'Estimate history' && <EstimateHistoryTab sym={sym} />}
      {active === 'Filings feed' && <FilingsFeedTab sym={sym} />}
      {active === 'Depth' && <DepthTab sym={sym} flags={researchDepth} focus={depthFocus} />}
      {active === 'Ask AI' && <AskAiTab sym={sym} />}
      {active === 'My Research' && (
        <TickerResearchWorkspace symbol={sym} showBackLink={false} onOpenNote={(note) => navigate(notePath(note.id))} />
      )}
    </div>
  )
}
