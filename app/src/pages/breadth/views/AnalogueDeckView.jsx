/**
 * Analogue Deck — the sessions in history whose breadth vector most resembles
 * today's, and what SPY did next. The similarity search and the forward returns
 * are the server's (`breadth_analogues.py`); this view ranks and reads them.
 */
import useSWR from 'swr'
import { resolveViewColors, medianOf } from './breadthViewShared'
import SeekDate from './SeekDate'
// ⭐ ONE AUTHOR FOR THE KEY. The Read reads this endpoint's answer OUT OF THE
// SWR CACHE without fetching it, which only works if it asks for the exact
// string this view stored under. A hand-typed copy there would miss the cache
// every time and the clause would simply never appear — a silent, invisible
// failure. See `breadthEndpoints.js`.
import { analoguesKey } from './breadthEndpoints'
// ⛔ NOT an inline `fetch(url).then(r => r.json())`. A 402/401 answers JSON too,
// and its `{detail}` body is truthy — so `data?.analogues ?? []` would render a
// paywall as "no historical session resembles today", which is a different
// sentence and the wrong one. `jsonFetcher` throws so SWR reports the status.
import jsonFetcher from '../../../utils/jsonFetcher'

// ⛔ WAS A LOCAL `{ fwd_20d: '20 days', … }` MAP — a second copy of the option
// schema's own choice labels, in a file that renders beside the panel that
// shows them. The registry is the author; The Read prints the same words.
import { optionLabel } from './viewMetricConfig'
const horizonLabel = (h) => optionLabel('analogues', 'horizon', h)

// A card is a floor and a ceiling, the same ruling every board on this tab
// follows: the floor is what a quarter-size compare pane can honour once the
// summary and the basis line are paid for, and the ceiling is what stops a
// five-card deck on a 1000px-tall panel from drawing five posters.
const CARD_MIN_H = 96
const CARD_MAX_H = 560

// ⭐ `medianOf` LIVES IN `breadthViewShared.js` — one implementation. The Read
// quotes the same median this deck prints, and the even-length bug the helper's
// comment records is exactly the kind a second copy would reintroduce.
// ⛔ It is NOT re-exported from here: a component module that also exports a
// value stops hot-reloading as a component, and importers reach the one author
// directly.

/**
 * ⛔ THIS LENS DELIBERATELY IGNORES `rowIdx` / `currentRow`, ALONE AMONG ITS
 * SIBLINGS — it is not an oversight, and nothing in the file said so.
 *
 * Every other view slices its window at the date cursor, so the arrow keys
 * scrub them through history. The analogue search does not live here: the
 * server always matches against the LATEST stored session
 * (`breadth_analogues.find_analogues` takes the newest row as "today" and
 * caches the answer for six hours), so there is no per-date result to scrub to.
 * Accepting the cursor and quietly serving the same payload would be worse than
 * ignoring it — it would look like a date-aware view that had frozen.
 *
 * What the reader gets instead is the honest label: the deck states "Matched
 * against {reference_date}", straight off the response, so the session the
 * comparison is really anchored to is on screen rather than assumed. A
 * per-date endpoint is the change that would make the cursor meaningful here.
 *
 * ⭐ IT DOES TAKE `onSeek`/`canSeek`, AND THAT IS NOT A CONTRADICTION. The lens
 * ignores the cursor as an INPUT — the match set does not change when you scrub
 * — while each card NAMES a historical session the reader may want to look at.
 * This is the deck the refusal was designed for: the server matches against all
 * of history, so most named dates fall outside a 90-day window and MUST render
 * as disabled affordances that say so. Widen the window and the same card
 * becomes live, with no other change.
 */
export default function AnalogueDeckView({ onSeek, canSeek, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const horizon = options.horizon ?? 'fwd_20d'
  const topN = Number(options.matches ?? 5)

  // ⭐ A BARE `useSWR`, DELIBERATELY — see the census row for this file in
  // `hooks/pollingSites.rail.test.js`. The analogues feed refreshes 6-hourly and
  // the endpoint is server-cached for 6 hours, so `useMobileSWR`'s
  // `revalidateOnFocus: true`, its visibilitychange listener and its 60s
  // `useMarketOpen` timer would all be cost for data that moves at most daily.
  const { data, isLoading, error } = useSWR(
    analoguesKey(topN), jsonFetcher,
    { refreshInterval: 6 * 60 * 60 * 1000 },
  )

  if (isLoading) {
    return <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#64748b' }}>Finding analogues…</div>
  }
  const analogues = data?.analogues ?? []
  if (error || !analogues.length) {
    return (
      <div data-testid="analogues-refusal"
           style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        {error ? `Could not load analogues — ${error.message ?? 'network error'}`
               : 'No historical session resembles today closely enough to report.'}
      </div>
    )
  }

  const withReturn = analogues.filter(a => a.forward_returns?.[horizon] != null)
  const higher = withReturn.filter(a => a.forward_returns[horizon] > 0).length
  const median = medianOf(withReturn.map(a => a.forward_returns[horizon]))

  // ⭐ ONE SCALE FOR ALL FIVE CARDS. Five numbers printed five times are five
  // separate readings; the same five drawn against a shared symmetric axis are a
  // COMPARISON, which is the question this deck exists to answer ("and what
  // happened next?"). The bound is the largest move in the set — never a fixed
  // one, which would flatten a quiet set and clip a violent one.
  const span = Math.max(1, ...withReturn.map(a => Math.abs(a.forward_returns[horizon])))

  return (
    <div style={{ height: '100%', minHeight: 0, padding: '12px 18px',
                  display: 'flex', flexDirection: 'column' }}>
      <div data-testid="analogues-summary"
           style={{ font: '800 15px \'Instrument Sans\', sans-serif', color: '#e8e8ea',
                    marginBottom: 4, flex: '0 0 auto' }}>
        {withReturn.length
          ? `${higher} of ${withReturn.length} higher ${horizonLabel(horizon)} later`
          : `No match has ${horizonLabel(horizon)} of history after it yet`}
        {median != null && (
          <span style={{ marginLeft: 8, font: '700 12px \'Instrument Sans\', sans-serif',
                         color: median >= 0 ? colors.bull : colors.bear }}>
            median {median >= 0 ? '+' : ''}{median.toFixed(1)}%
          </span>
        )}
      </div>
      <div data-testid="analogues-basis"
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b',
                    marginBottom: 10, flex: '0 0 auto' }}>
        Matched against {data.reference_date} · similarity over 16 weighted breadth metrics
        {withReturn.length > 1
          ? ` · bars share one axis, ±${span.toFixed(1)}%`
          : ''}
      </div>

      {/* 🔴 THE DECK USED `auto-fill` AND A CONTENT-HEIGHT ROW, AND BOTH LEFT
          ROOM ON THE TABLE. `auto-fill` KEEPS the empty tracks it could not
          fill, so five cards on a full-width panel stopped at 1060px of 1464 and
          left two ghost columns; `auto-fit` collapses them and the five stretch
          across. Vertically the cards drew 109px of ink in a 686px panel — the
          worst-filling view on the tab, measured — because nothing here read the
          room. Now the row shares it, between a floor a compare pane can honour
          and a ceiling that keeps five cards from becoming five posters. */}
      <div style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, display: 'grid',
                    gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                    gridAutoRows: `minmax(${CARD_MIN_H}px, 1fr)`,
                    maxHeight: CARD_MAX_H }}>
        {analogues.map(a => {
          const fwd = a.forward_returns?.[horizon]
          const tone = fwd == null ? '#64748b' : (fwd >= 0 ? colors.bull : colors.bear)
          return (
            <div key={a.date} data-testid={`analogues-card-${a.date}`}
                 style={{ background: '#0e131a', borderRadius: 8, padding: 10,
                          border: '1px solid rgba(255,255,255,0.05)', minHeight: 0,
                          display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flex: '0 0 auto' }}>
                <span style={{ font: '700 12px \'Instrument Sans\', sans-serif', color: '#e2e8f0' }}>
                  <SeekDate date={a.date} styleKey="analogues" onSeek={onSeek} canSeek={canSeek} />
                </span>
                <span style={{ font: '600 9px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
                  {Number(a.similarity).toFixed(1)}% match
                </span>
              </div>
              <div style={{ font: `800 20px 'Instrument Sans', sans-serif`, marginTop: 4,
                            flex: '0 0 auto', color: tone }}>
                {fwd == null ? 'Not yet' : `${fwd >= 0 ? '+' : ''}${Number(fwd).toFixed(1)}%`}
              </div>
              <div style={{ font: '500 9px \'Instrument Sans\', sans-serif', color: '#475569',
                            flex: '0 0 auto' }}>
                {fwd == null ? `less than ${horizonLabel(horizon)} of history after it`
                             : `SPY, ${horizonLabel(horizon)} later`}
              </div>
              {/* ⛔ THE BAR IS DRAWN FROM THE ZERO LINE, NEVER FROM THE FLOOR OF
                  THE BOX. A card's spare height is the only place a set of five
                  returns can be compared as SHAPES rather than read as five
                  numbers, and an area measured from an arbitrary baseline would
                  say nothing. The line sits at the middle of the plot because the
                  axis is symmetric; a bar above it went up, below it went down. */}
              {fwd != null && (
                <div data-testid={`analogues-plot-${a.date}`} aria-hidden="true"
                     style={{ flex: '1 1 auto', minHeight: 0, marginTop: 6, position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1,
                                background: 'rgba(148,163,184,0.22)' }} />
                  <div style={{ position: 'absolute', left: '18%', right: '18%',
                                [fwd >= 0 ? 'bottom' : 'top']: '50%',
                                height: `${Math.min(50, Math.abs(fwd) / span * 50)}%`,
                                background: tone, opacity: colors.fillOpacity,
                                borderRadius: fwd >= 0 ? '3px 3px 0 0' : '0 0 3px 3px' }} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
