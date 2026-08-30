import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useSWRConfig } from 'swr'
import PullToRefresh from '../components/PullToRefresh'
import FuturesStrip from '../components/tiles/FuturesStrip'
import IntradayPulse from '../components/tiles/IntradayPulse'
import MarketBreadth from '../components/tiles/MarketBreadth'
import ThemeTracker from '../components/tiles/ThemeTracker'
import CatalystFlow from '../components/tiles/CatalystFlow'
import LeadershipTile from '../components/tiles/LeadershipTile'
import TapeFeed from '../components/tiles/TapeFeed'
import JournalSnapshotTile from '../components/tiles/JournalSnapshotTile'
import FlowScoreboardTile from '../components/tiles/FlowScoreboardTile'
import MoversSidebar from '../components/MoversSidebar'
import CatalystTable from '../components/tiles/CatalystTable'
import DeskVideoRail from '../components/dashboard/DeskVideoRail'
import CompassTodayTile from '../components/tiles/CompassTodayTile'
import OptionsFlowPreview from '../components/tiles/OptionsFlowPreview'
import SectorRotation from '../components/tiles/SectorRotation'
import UIcon from '../components/ui/UIcon'
import styles from './Dashboard.module.css'

/* ── Mobile accordion section ────────────────────────────────────────────── */
function MobileSection({ icon, title, subtitle, children, expanded, onToggle }) {
  const sectionId = `mobile-section-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className={`${styles.mSection} ${expanded ? styles.mSectionOpen : ''}`}>
      <button
        className={styles.mSectionHeader}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={sectionId}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <span className={styles.mSectionIcon}>{icon}</span>
        <div className={styles.mSectionText}>
          <span className={styles.mSectionTitle}>{title}</span>
          {!expanded && subtitle && (
            <span className={styles.mSectionSub}>{subtitle}</span>
          )}
        </div>
        <span className={styles.mChevron}>{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div className={styles.mSectionBody} id={sectionId}>
          {children}
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { mutate } = useSWRConfig()
  // Mobile accordion state — Movers open by default (breadth/catalysts/compass
  // are now always-visible in the triaged stack above the accordion).
  const [openSection, setOpenSection] = useState('movers')

  const toggle = useCallback((key) => {
    setOpenSection(prev => prev === key ? null : key)
  }, [])

  const handleRefresh = useCallback(() => mutate(() => true, undefined, { revalidate: true }), [mutate])

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        {/* ── Desktop: command-center grid (2026-07-02 restyle) ──────────── */}
        <div className={styles.desktopOnly}>
          {/* Index boxes (QQQ/SPY/IWM/DIA/BTC/VIX) + Quote of the Day */}
          <div className={styles.row1}>
            <FuturesStrip />
          </div>
          {/* ⛔ MUST stay wrapped — see the SectorRotation comment below.
              Dashboard.zones.test.jsx treats any bare child of .desktopOnly
              as the defect shape, so every mount here gets a track. */}
          <div className={styles.rowFull}>
            <IntradayPulse />
          </div>

          {/* Row B — the decision row: catalysts hero + journal/movers rail */}
          <div className={styles.rowB}>
            <div className={styles.hero}>
              <CatalystTable />
            </div>
            <div className={styles.rail}>
              <JournalSnapshotTile />
              <FlowScoreboardTile />
              <div className={styles.railMovers}>
                <MoversSidebar />
              </div>
            </div>
          </div>

          {/* Row C — market glance */}
          <div className={styles.rowC}>
            <MarketBreadth />
            <ThemeTracker />
            <LeadershipTile />
            <TapeFeed />
          </div>

          {/* Sector rotation — SPDR sectors ranked strongest→weakest.
              ⛔ MUST stay wrapped. TileCard is height:100%, and .desktopOnly
              is display:block/height:auto — a bare mount here resolved that
              100% against nothing and expanded to 3,081px around a 323px
              list. Rail: Dashboard.zones.test.jsx */}
          <div className={styles.rowSector}>
            <SectorRotation />
          </div>

          {/* Row D — earnings + flow */}
          <div className={styles.rowD}>
            <CatalystFlow />
            <OptionsFlowPreview />
          </div>

          <div className={styles.rowFull}>
            <DeskVideoRail />
          </div>
          {/* Compass noticed — self-hiding awareness feed */}
          <div className={styles.rowFull}>
            <CompassTodayTile />
          </div>
        </div>

        {/* ── Mobile: triaged, decision-first stack (spec §5) ────────────── */}
        <div className={styles.mobileOnly}>
          <PullToRefresh onRefresh={handleRefresh}>
            {/* 1. Journal snapshot — open positions, balance & performance */}
            <JournalSnapshotTile />
            {/* Morning Wire entry */}
            <Link to="/morning-wire" className={styles.mwLink}>
              <span><UIcon name="wire" size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} /> Morning Wire — today's read &amp; top picks</span>
              <span aria-hidden="true">→</span>
            </Link>
            {/* 2. Breadth snapshot — always visible */}
            <MarketBreadth />
            {/* 3. Catalysts / needs attention (★ highlights your tickers) */}
            <CatalystTable />
            {/* 4. Movers */}
            <MobileSection
              icon={<UIcon name="equity" />}
              title="Movers at the Open"
              subtitle="Top gappers & drillers"
              expanded={openSection === 'movers'}
              onToggle={() => toggle('movers')}
            >
              <MoversSidebar />
            </MobileSection>
            {/* 5. Market glance */}
            <FuturesStrip />
            <IntradayPulse />
            {/* 6. The rest — collapsible */}
            <MobileSection
              icon={<UIcon name="flow" />}
              title="Sector Rotation"
              subtitle="Where money is rotating"
              expanded={openSection === 'sectors'}
              onToggle={() => toggle('sectors')}
            >
              <SectorRotation />
            </MobileSection>
            <MobileSection
              icon={<UIcon name="flow" />}
              title="Theme Tracker"
              subtitle="Sector & theme performance"
              expanded={openSection === 'themes'}
              onToggle={() => toggle('themes')}
            >
              <ThemeTracker />
            </MobileSection>
            <MobileSection
              icon={<UIcon name="dollar" />}
              title="Earnings"
              subtitle="BMO & AMC catalyst flow"
              expanded={openSection === 'earnings'}
              onToggle={() => toggle('earnings')}
            >
              <CatalystFlow />
            </MobileSection>
            <MobileSection
              icon={<UIcon name="star" />}
              title="UCT 20"
              subtitle="Leadership portfolio"
              expanded={openSection === 'leadership'}
              onToggle={() => toggle('leadership')}
            >
              <LeadershipTile />
            </MobileSection>
            <MobileSection
              icon={<UIcon name="wire" />}
              title="News"
              subtitle="Live market tweets — on the tape"
              expanded={openSection === 'news'}
              onToggle={() => toggle('news')}
            >
              <TapeFeed />
            </MobileSection>
            <MobileSection
              icon={<UIcon name="flow" />}
              title="Options Flow"
              subtitle="Top conviction flow today"
              expanded={openSection === 'optflow'}
              onToggle={() => toggle('optflow')}
            >
              <OptionsFlowPreview embedded />
            </MobileSection>
            {/* Flow Scoreboard — verified Top Flow track record */}
            <FlowScoreboardTile />
            {/* From the Desk — video discovery rail */}
            <DeskVideoRail />
            {/* Compass noticed — self-hiding awareness feed */}
            <CompassTodayTile />
          </PullToRefresh>
        </div>

      </div>
    </div>
  )
}
