import { useState, useCallback } from 'react'
import { useSWRConfig } from 'swr'
import PullToRefresh from '../components/PullToRefresh'
import FuturesStrip from '../components/tiles/FuturesStrip'
import IntradayPulse from '../components/tiles/IntradayPulse'
import MarketBreadth from '../components/tiles/MarketBreadth'
import ThemeTracker from '../components/tiles/ThemeTracker'
import CatalystFlow from '../components/tiles/CatalystFlow'
import LeadershipTile from '../components/tiles/LeadershipTile'
import NewsFeed from '../components/tiles/NewsFeed'
import SectorFlows from '../components/tiles/SectorFlows'
import MoversSidebar from '../components/MoversSidebar'
import TileCard from '../components/TileCard'
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
  // Mobile accordion state — exposure expanded by default (most important)
  const [openSection, setOpenSection] = useState('exposure')

  const toggle = useCallback((key) => {
    setOpenSection(prev => prev === key ? null : key)
  }, [])

  const handleRefresh = useCallback(() => mutate(() => true, undefined, { revalidate: true }), [mutate])

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        {/* Row 1: Futures strip */}
        <div className={styles.row1}>
          <FuturesStrip />
        </div>

        {/* Intraday pulse — only renders when brain has pushed an update */}
        <IntradayPulse />

        {/* ── Desktop layout (hidden on mobile) ──────────────────────────── */}
        <div className={styles.desktopOnly}>
          <div className={styles.row2}>
            <MoversSidebar />
            <MarketBreadth />
            <ThemeTracker />
          </div>
          <div className={styles.row3}>
            <CatalystFlow />
            <LeadershipTile />
            <NewsFeed />
          </div>
          <div className={styles.row4}>
            <SectorFlows />
            <TileCard title="Options Flow">
              <div className={styles.comingSoon}>
                <span className={styles.comingSoonIcon}>🔧</span>
                <span className={styles.comingSoonLabel}>Coming Soon</span>
              </div>
            </TileCard>
          </div>
        </div>

        {/* ── Mobile layout (hidden on desktop) ──────────────────────────── */}
        <div className={styles.mobileOnly}>
          <PullToRefresh onRefresh={handleRefresh}>
          <MobileSection
            icon="📊"
            title="UCT Exposure Rating"
            subtitle="Market regime & exposure"
            expanded={openSection === 'exposure'}
            onToggle={() => toggle('exposure')}
          >
            <MarketBreadth />
          </MobileSection>

          <MobileSection
            icon="🚀"
            title="Movers at the Open"
            subtitle="Top gappers & drillers"
            expanded={openSection === 'movers'}
            onToggle={() => toggle('movers')}
          >
            <MoversSidebar />
          </MobileSection>

          <MobileSection
            icon="🎯"
            title="Theme Tracker"
            subtitle="Sector & theme performance"
            expanded={openSection === 'themes'}
            onToggle={() => toggle('themes')}
          >
            <ThemeTracker />
          </MobileSection>

          <MobileSection
            icon="💰"
            title="Earnings"
            subtitle="BMO & AMC catalyst flow"
            expanded={openSection === 'earnings'}
            onToggle={() => toggle('earnings')}
          >
            <CatalystFlow />
          </MobileSection>

          <MobileSection
            icon="⭐"
            title="UCT 20"
            subtitle="Leadership portfolio"
            expanded={openSection === 'leadership'}
            onToggle={() => toggle('leadership')}
          >
            <LeadershipTile />
          </MobileSection>

          <MobileSection
            icon="💧"
            title="Sector Flows"
            subtitle="ETF money flow analysis"
            expanded={openSection === 'sectorflows'}
            onToggle={() => toggle('sectorflows')}
          >
            <SectorFlows />
          </MobileSection>

          <MobileSection
            icon="📰"
            title="News"
            subtitle="Latest market headlines"
            expanded={openSection === 'news'}
            onToggle={() => toggle('news')}
          >
            <NewsFeed />
          </MobileSection>
          </PullToRefresh>
        </div>

      </div>
    </div>
  )
}
