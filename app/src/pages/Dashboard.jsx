// app/src/pages/Dashboard.jsx
//
// ─── THE FOUR-ZONE COCKPIT ──────────────────────────────────────────────────
//
// `/dashboard` is the paid member's home. It used to stack 15 tiles with no
// height budget and render ONE composition regardless of what kind of day it
// was: 5.5 screens of scroll, and on a Saturday a hero reading "Markets are
// closed" beside an 849px dead column.
//
// It is now four zones with DECLARED heights (Dashboard.module.css owns the
// budget; content scrolls inside its zone, the page does not):
//
//   Zone A · THE READ      — session + exposure + index strip       120px
//   Zone B · THE DECISION  — weekday: catalysts · weekend: The Week  440px
//   Zone C · YOUR RISK     — open book, today's P&L                  300px
//   Zone D · THE DOORS     — 8 signposts, one live number each        90px
//   ...plus a 240px Movers rail beside A-C.
//
// ⛔ ZONE B IS THE ONLY ZONE THAT VARIES. `useSessionState()` resolves exactly
// one of PREMARKET/LIVE/CLOSED/WEEKEND per render; A, C and D are constant.
// Rail: Dashboard.session.test.jsx.
//
// ⛔ SEVEN PREVIEW TILES LOST THEIR MOUNT HERE AND BECAME ZONE D DOORS
// (LeadershipTile · CatalystFlow · OptionsFlowPreview · DeskVideoRail ·
// CompassTodayTile · SectorRotation · IntradayPulse), plus TapeFeed, whose
// content now lives INSIDE MoversSidebar (64960303b) and was rendering twice.
// Their FILES are kept as rollback backup — the same keep-the-file/cut-the-
// mount idiom as LiveFlow.jsx and api/routers/trades.py — and each is recorded
// by name, with the door that replaces it, in
// `components/screener/reachable.test.js`'s AWAITING_A_DECISION. A signpost is
// not a duplicate; it is a link with a number on it, at ~90px instead of the
// ~4,000px the previews cost.
import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useSWRConfig } from 'swr'
import PullToRefresh from '../components/PullToRefresh'
import FuturesStrip from '../components/tiles/FuturesStrip'
import MarketBreadth from '../components/tiles/MarketBreadth'
import ThemeTracker from '../components/tiles/ThemeTracker'
import JournalSnapshotTile from '../components/tiles/JournalSnapshotTile'
import FlowScoreboardTile from '../components/tiles/FlowScoreboardTile'
import MoversSidebar from '../components/MoversSidebar'
import CatalystTable from '../components/tiles/CatalystTable'
import UIcon from '../components/ui/UIcon'
import useSessionState from './dashboard/useSessionState'
import TheWeek from './dashboard/TheWeek'
import ZoneDoors from './dashboard/ZoneDoors'
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
  const session = useSessionState()
  // Mobile accordion state — Movers open by default.
  const [openSection, setOpenSection] = useState('movers')

  const toggle = useCallback((key) => {
    setOpenSection(prev => prev === key ? null : key)
  }, [])

  const handleRefresh = useCallback(() => mutate(() => true, undefined, { revalidate: true }), [mutate])

  // ⛔ ONE authority for the hero, read by BOTH branches. jsdom renders desktop
  // and mobile together (CSS hides one, and jsdom computes no CSS), so a
  // weekday-only mobile hero would leave a Saturday member on a phone looking
  // at the very composition this redesign exists to retire.
  const hero = session === 'WEEKEND' ? <TheWeek /> : <CatalystTable />

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        {/* ── Desktop: the four-zone cockpit ────────────────────────────── */}
        <div className={styles.desktopOnly}>
          <div className={styles.cockpit}>
            <div className={styles.main}>
              {/* Zone A · THE READ.
                  ⚠️ FuturesStrip is the INTERIM occupant: Task 14 replaces it
                  with `dashboard/ZoneRead` (session pill + exposure number +
                  compact index strip). It sits here rather than ZoneRead so
                  this commit does not import a module that does not exist yet. */}
              <div className={styles.zoneA}><FuturesStrip /></div>
              {/* Zone B · THE DECISION — the only zone that varies. */}
              <div className={styles.zoneB}>{hero}</div>
              {/* Zone C · YOUR RISK */}
              <div className={styles.zoneC}><JournalSnapshotTile /></div>
            </div>
            <aside className={styles.rail}><MoversSidebar /></aside>
          </div>
          {/* Zone D · THE DOORS */}
          <div className={styles.zoneD}><ZoneDoors /></div>
        </div>

        {/* ── Mobile: triaged, decision-first stack (spec §5) ────────────── */}
        <div className={styles.mobileOnly}>
          <PullToRefresh onRefresh={handleRefresh}>
            {/* 1. Journal snapshot — open positions, balance & performance */}
            <JournalSnapshotTile />
            {/* Morning Wire entry */}
            <Link to="/morning-wire" className={styles.mwLink}>
              <span><UIcon name="wire" size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} /> Morning Wire — today&rsquo;s read &amp; top picks</span>
              <span aria-hidden="true">→</span>
            </Link>
            {/* 2. Breadth snapshot — always visible */}
            <MarketBreadth />
            {/* 3. The session hero — the same decision as Zone B above */}
            {hero}
            {/* 4. Movers (which now carries the tape) */}
            <MobileSection
              icon={<UIcon name="equity" />}
              title="Movers at the Open"
              subtitle="Top gappers, drillers & the tape"
              expanded={openSection === 'movers'}
              onToggle={() => toggle('movers')}
            >
              <MoversSidebar />
            </MobileSection>
            {/* 5. Market glance */}
            <FuturesStrip />
            <MobileSection
              icon={<UIcon name="flow" />}
              title="Theme Tracker"
              subtitle="Sector & theme performance"
              expanded={openSection === 'themes'}
              onToggle={() => toggle('themes')}
            >
              <ThemeTracker />
            </MobileSection>
            {/* Flow Scoreboard — verified Top Flow track record */}
            <FlowScoreboardTile />
            {/* 6. The doors — the same eight signposts as Zone D. This is where
                a phone member reaches everything the retired previews used to
                preview; without it the retirement would be only a removal. */}
            <ZoneDoors />
          </PullToRefresh>
        </div>

      </div>
    </div>
  )
}
