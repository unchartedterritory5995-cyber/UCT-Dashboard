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
import MoversSidebar from '../components/MoversSidebar'
import CatalystTable from '../components/tiles/CatalystTable'
import DeskVideoRail from '../components/dashboard/DeskVideoRail'
import OptionsFlowPreview from '../components/tiles/OptionsFlowPreview'
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
        {/* ── Desktop layout (unchanged; hidden on mobile) ───────────────── */}
        <div className={styles.desktopOnly}>
          <div className={styles.row1}>
            <FuturesStrip />
          </div>
          <IntradayPulse />
          <JournalSnapshotTile />
          <CatalystTable />
          <div className={styles.row2}>
            <MoversSidebar />
            <MarketBreadth />
            <ThemeTracker />
          </div>
          <div className={styles.row3}>
            <CatalystFlow />
            <LeadershipTile />
            <TapeFeed />
          </div>
          <div className={styles.row4}>
            <OptionsFlowPreview />
          </div>
          <DeskVideoRail />
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
            {/* From the Desk — video discovery rail */}
            <DeskVideoRail />
          </PullToRefresh>
        </div>

      </div>
    </div>
  )
}
