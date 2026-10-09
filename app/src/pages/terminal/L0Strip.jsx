// app/src/pages/terminal/L0Strip.jsx — the L0 status strip (V7).
//
// An always-on status strip mounted at the top of the Terminal shell's `.bar`:
// a ticking ET clock + session label, the market-regime/exposure chip, an
// alert-inbox affordance, and the active channel. Every data source here is
// REUSED, not reinvented:
//   * the clock/session reads S11's shared market-clock stack the exact same
//     way `components/tiles/MarketClock.jsx` does — `useMarketOpen()` (backed
//     by `lib/marketClock/marketClock.js::sessionState`) + `sessionModel()`
//     for the label/tone, and a plain `toLocaleTimeString` in `America/New_York`
//     for the digits. No new clock logic.
//   * the regime chip reads `/api/breadth` via `useMobileSWR`, the exact same
//     hook + endpoint `components/tiles/MarketBreadth.jsx` uses for its
//     Exposure Rating, and renders the SAME `data.exposure.score` field
//     MarketBreadth already displays. SWR dedupes the key, so mounting this
//     strip alongside MarketBreadth (or alone) never double-fetches.
//   * the alert-inbox affordance is the existing `<AlertBell/>` component,
//     rendered as-is (it owns its own feed, auth-gating and dropdown).
//   * the active-channel chip renders `activeChannelOf(layout)`, already
//     computed by TerminalShell and passed in as a prop.
import { useEffect, useState } from 'react'
import useMarketOpen from '../../hooks/useMarketOpen'
import useMobileSWR from '../../hooks/useMobileSWR'
import jsonFetcher from '../../utils/jsonFetcher'
import { sessionModel } from '../../components/dashboard/sessionModel'
import AlertBell from '../../components/AlertBell'
import { activeChannelOf, groupStyle } from './boardModel'
import styles from './L0Strip.module.css'

// jsonFetcher, not a bare r.json(): a 402/500 answers JSON too, and its {detail} body was read
// as breadth, so the chip showed a silent dash. A failed read now stays a failed read.
const breadthFetcher = (url) => jsonFetcher(url)

function useEtNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** Pure: 0-150 exposure score → the same tone buckets MarketBreadth paints with. */
function regimeTone(score) {
  if (score == null) return 'muted'
  if (score >= 70) return 'bull'
  if (score >= 50) return 'neutral'
  if (score >= 30) return 'caution'
  return 'bear'
}

/** The tone bucket in words, so a screen reader hears what the colour says. */
export const REGIME_TONE_WORD = { bull: 'bullish', neutral: 'neutral', caution: 'cautious', bear: 'bearish', muted: 'no reading' }

/** A short session label for the phone strip, where the full one does not fit. */
export const SHORT_SESSION_LABEL = { 'MARKET OPEN': 'OPEN', 'PRE-MARKET': 'PRE', 'AFTER-HOURS': 'AH', 'MARKET CLOSED': 'CLOSED' }

export default function L0Strip({ layout, isPhone }) {
  const session = useMarketOpen()
  const now = useEtNow()
  const { label, tone } = sessionModel(session)

  // Same key + fetcher MarketBreadth.jsx uses for `/api/breadth` — SWR's
  // cache dedupes this against any other mounted consumer of the same key.
  const { data: breadth } = useMobileSWR('/api/breadth', breadthFetcher, { refreshInterval: 60000, marketHoursOnly: true })
  const expScore = breadth?.exposure?.score ?? null
  const rTone = regimeTone(expScore)
  // The same staleness MarketBreadth stamps (its `wire_status` read, judged server-side against
  // the trading calendar): a stale reading is dimmed and dated, never shown as today's.
  // 'unknown' / absent is NOT stale — that would assert what we cannot support.
  const wireDate = breadth?.wire_date ?? null
  const wireStale = breadth?.wire_status === 'stale' && expScore != null

  const activeChannel = activeChannelOf(layout)
  const activeGroup = (layout?.channels || []).find((c) => c.id === activeChannel) || null

  const time = now.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    ...(isPhone ? {} : { second: '2-digit' }),
    hour12: true,
  })

  const toneCls = tone === 'open' ? styles.toneOpen : tone === 'ext' ? styles.toneExt : styles.toneClosed

  return (
    <div className={styles.strip} data-testid="terminal-l0-strip" data-phone={isPhone ? 'true' : 'false'}>
      <div className={styles.clock} data-testid="l0-clock" title={`${label} · ${time} ET`}>
        <span className={`${styles.sessionDot} ${toneCls}`} aria-hidden="true" />
        <span className={styles.time}>{time}</span>
        <span className={styles.etLabel}>ET</span>
        {/* Phone keeps a short label (OPEN / PRE / AH / CLOSED): the dot's colour alone is
            not enough, and the full label does not fit beside the command bar. The full label
            is real (visually hidden) TEXT: an aria-label on a bare <span> is not exposed by
            screen readers, so they heard only "PRE" (a11y audit 2026-10-06). */}
        <span className={`${styles.sessionLabel} ${toneCls}`} data-testid="l0-session-label">
          {isPhone ? (
            <>
              <span aria-hidden="true" data-testid="l0-session-short">{SHORT_SESSION_LABEL[label] || label}</span>
              <span className="sr-only">{label}</span>
            </>
          ) : label}
        </span>
      </div>

      <div
        className={`${styles.chip} ${styles[`regime_${rTone}`]} ${wireStale ? styles.regimeStale : ''}`}
        data-testid="l0-regime-chip"
        data-stale={wireStale ? 'true' : 'false'}
        role="group"
        aria-label={`UCT Exposure Rating ${expScore == null ? 'not available' : Math.round(expScore)}${expScore == null ? '' : `, ${REGIME_TONE_WORD[rTone]}`}${wireStale ? `, as of ${wireDate || 'an earlier wire'}, not today's reading` : ''}`}
        title={wireStale
          ? `UCT Exposure Rating as of ${wireDate || 'an earlier wire'} — no run since; not today's reading`
          : 'UCT Exposure Rating'}
      >
        <span className={styles.chipLabel}>{isPhone ? 'EXP' : 'EXPOSURE'}</span>
        <span className={styles.chipValue}>{expScore == null ? '—' : Math.round(expScore)}</span>
        {wireStale && (
          <span className={styles.chipAsOf} data-testid="l0-regime-asof">
            {isPhone ? 'old' : `as of ${wireDate || 'earlier'}`}
          </span>
        )}
      </div>

      {/* The active link GROUP (the word the panel headers and the link menu use — "CH" read as
          nothing). Its dot carries the group's own colour, ringed so a pale one still reads on a
          light theme; the letter is what the panel-header dots show. */}
      <div className={styles.chip} data-testid="l0-channel-chip" role="group"
        aria-label={`Active link group: ${activeGroup?.name || `Group ${activeChannel}`}`}
        title={`Active link group: ${activeGroup?.name || `Group ${activeChannel}`}. Panels linked to it follow its ticker.`}>
        <span className={styles.chipLabel}>{isPhone ? 'GRP' : 'GROUP'}</span>
        <span className={styles.groupSwatch} style={groupStyle(activeGroup?.color)} aria-hidden="true" />
        <span className={styles.chipValue}>{activeChannel}</span>
      </div>

      <div className={styles.bellWrap} data-testid="l0-alert-bell">
        <AlertBell />
      </div>
    </div>
  )
}
