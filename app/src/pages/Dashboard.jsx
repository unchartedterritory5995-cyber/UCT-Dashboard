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
// ⭐ …AND A MARKET CLOSURE IS COMPOSED ON TOP OF IT, HERE. The spec's state
// table has always read `WEEKEND` = "Sat/Sun and market holidays"; the session
// function deliberately does not know closures (see `heroState` below), so the
// dashboard reads the served calendar's answer and picks the weekend hero on a
// holiday. Rail: Dashboard.holiday.test.jsx.
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
import useSessionState, { useNextBoundary } from './dashboard/useSessionState'
import ZoneRead from './dashboard/ZoneRead'
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
  // ⭐ THE PAGE'S ONE SESSION READ — `ZoneRead` is handed this rather than
  // calling the hook again. See the note on `boundary` below for why two
  // instances of a ticking hook is a real disagreement and not just a
  // duplicate call.
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
  //
  // 🔴 A MARKET HOLIDAY TAKES THE WEEKEND HERO. Until this commit only Zone A
  // knew about closures: on Labor Day the paid home would have rendered a
  // "Holiday" pill and a suppressed countdown in Zone A, directly above a 440px
  // card asking `CatalystTable` to scan a tape that is shut — two zones reading
  // two different calendars, sixty vertical pixels apart, on the first day of
  // the exercise. The spec's own state table says `WEEKEND` = "Sat/Sun and
  // market holidays"; this is the line that makes that true for the dashboard.
  //
  // ⛔ COMPOSED HERE, NOT TAUGHT TO `resolveSession`. That function is pure and
  // synchronous, read at first render, mocked by Dashboard.session.test.jsx, and
  // its four values are branched on across the codebase — the calendar arrives
  // over the wire, so teaching it closures means making the session state
  // asynchronous. `useMarketOpen`, `marketSession.js` and `expected_wire_date`
  // are three further holiday-blind authorities with app-wide consumers (the
  // live-price polling cadence among them). Consolidating the four is a real
  // project; this is one component composing two answers it already holds.
  //
  // ⭐ ONE CLOCK AND ONE CALENDAR, READ HERE AND HANDED DOWN. `holidayToday` is
  // `isMarketHoliday(now, holidays, coversThrough)` computed inside
  // `useNextBoundary`, off ONE served calendar and ONE `new Date()`. Zone A's
  // pill and countdown need that same read, so `ZoneRead` is given this one as
  // a prop instead of calling the hook itself.
  //
  // 🔴 THAT SENTENCE WAS FALSE UNTIL THIS COMMIT, AND IT IS THE REASON THE
  // HOOKS MOVED UP HERE. This comment used to warn that "a second `new Date()`
  // here" could "straddle a midnight tick and disagree about the same day" —
  // while `useNextBoundary()` was in fact instantiated TWICE, at this line and
  // in ZoneRead.jsx. What the two instances shared was the FETCH (SWR dedupes
  // `/api/market-calendar` by key) and the derivation; what they did NOT share
  // was the clock. Each held its own `now` state and its own 60s interval, and
  // a Dashboard re-render does not refresh ZoneRead's state — so at an ET
  // midnight the two ticks land either side of it and Zone A's pill and Zone
  // B's hero can disagree about which day it is for up to ~60s. Same shape for
  // `useSessionState` at the top of this function. Both are now called once,
  // here. Rail: Dashboard.oneClock.test.jsx.
  //
  // ⛔ `=== true`, NOT TRUTHINESS. `holidayToday` is `null` while the calendar is
  // loading, when the endpoint is down, and past the horizon its table can speak
  // for. "We cannot tell" is not "it is a closure" — and it is not "it is a
  // normal day" either, which is why the null falls through to `session` rather
  // than being read either way. Same rule, same reason, as `pillFor` in
  // ZoneRead.jsx.
  //
  // ⚠️ WHAT THAT BUYS, MEASURED — AND IT IS NOT "no flash of the wrong one",
  // which is what this comment used to claim. `holidayToday` is `null` on the
  // FIRST paint of every load (SWR resolves asynchronously, even from cache),
  // so the honest guarantee is:
  //   * NO BLANK, ever — an unverified calendar renders today's behaviour, not
  //     a spinner and not an empty Zone B; and
  //   * NO FLASH ON A SESSION DAY — `holidayToday` goes null → false, the hero
  //     never changes, and that is ~250 of ~260 trading days a year;
  //   * on a CLOSURE (~10 days a year) both branches paint `CatalystTable`
  //     first and swap to `TheWeek` when the calendar lands. One flicker per
  //     load. Only the first load of the day pays a network round trip:
  //     `/api/market-calendar` ships `Cache-Control: public, max-age=86400`
  //     (`market_calendar.py::_MAX_AGE`), so later loads resolve out of the
  //     browser cache and the window is about a frame.
  //
  // ⚠️ AND THE TWO BRANCHES DO NOT FLICKER ALIKE. The desktop cockpit swaps
  // inside the fixed `--zone-b: 440px` track, so nothing below it moves — with
  // one documented exception, `TheWeek` rendering null on a quiet week, which
  // trips Dashboard.module.css's `:has(.zoneB:empty)` collapse and is a
  // separate case from this one. The mobile stack renders `{hero}` with no
  // height budget at all, and `TheWeek` and `CatalystTable` are not the same
  // height, so a closure shifts the content beneath it once per load.
  //
  // ⛔ NOT WORTH BLOCKING THE RENDER TO REMOVE. Holding Zone B until the
  // calendar lands would trade one flicker on ten days for a blank hero on all
  // 260 — including every session day, where the wait buys nothing at all.
  const boundary = useNextBoundary()
  const heroState = boundary.holidayToday === true ? 'WEEKEND' : session
  const hero = heroState === 'WEEKEND' ? <TheWeek /> : <CatalystTable />

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        {/* ── Desktop: the four-zone cockpit ────────────────────────────── */}
        <div className={styles.desktopOnly}>
          <div className={styles.cockpit}>
            <div className={styles.main}>
              {/* Zone A · THE READ — session pill + UCT exposure + a compact
                  six-across index strip, in the declared 120px. The Quote of
                  the Day is demoted out of the top row (ZoneRead passes
                  FuturesStrip `hideQuote`) and reduced to one line.

                  ⛔ …AND SUPPRESSED ENTIRELY WHEN `TheWeek` IS THE HERO, because
                  that is the one composition where Zone B gives the quote its
                  own first-class panel. ⛔ IT READS `heroState`, NOT `session`:
                  a closure now draws `TheWeek` while `session` still says LIVE,
                  so gating on the raw session would have re-created the exact
                  duplicate below on every holiday. Both read the same
                  `useQuoteOfTheDay`, which has a local rotation fallback and so
                  is ALWAYS truthy — the duplicate was guaranteed, every
                  weekend, not occasional. Two tasks each correct alone (Task 12
                  gave the quote its panel; the S4 fix gave Zone A its
                  one-liner) and nobody owned the pair.

                  ⭐ `session` AND `boundary` ARE PROPS, NOT HOOK CALLS. Both
                  are resolved once above and passed in, so Zone A and Zone B
                  read one clock — see the note on `boundary` above. */}
              <div className={styles.zoneA}>
                <ZoneRead
                  session={session}
                  boundary={boundary}
                  showQuote={heroState !== 'WEEKEND'}
                />
              </div>
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
            {/* 5. Market glance.
                ⛔ Same rule as Zone A above, off the same `heroState`: whenever
                the hero is TheWeek — weekend OR closure — it carries the quote's
                first-class panel, so this strip must not render a second copy
                of the same line. */}
            <FuturesStrip hideQuote={heroState === 'WEEKEND'} />
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
