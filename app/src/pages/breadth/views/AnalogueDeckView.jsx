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

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px' }}>
      <div data-testid="analogues-summary"
           style={{ font: '800 15px \'Instrument Sans\', sans-serif', color: '#e8e8ea', marginBottom: 4 }}>
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
           style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginBottom: 10 }}>
        Matched against {data.reference_date} · similarity over 16 weighted breadth metrics
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {analogues.map(a => {
          const fwd = a.forward_returns?.[horizon]
          return (
            <div key={a.date} data-testid={`analogues-card-${a.date}`}
                 style={{ background: '#0e131a', borderRadius: 8, padding: 10,
                          border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ font: '700 12px \'Instrument Sans\', sans-serif', color: '#e2e8f0' }}>
                  <SeekDate date={a.date} styleKey="analogues" onSeek={onSeek} canSeek={canSeek} />
                </span>
                <span style={{ font: '600 9px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
                  {Number(a.similarity).toFixed(1)}% match
                </span>
              </div>
              <div style={{ font: `800 20px 'Instrument Sans', sans-serif`, marginTop: 4,
                            color: fwd == null ? '#64748b' : (fwd >= 0 ? colors.bull : colors.bear) }}>
                {fwd == null ? 'Not yet' : `${fwd >= 0 ? '+' : ''}${Number(fwd).toFixed(1)}%`}
              </div>
              <div style={{ font: '500 9px \'Instrument Sans\', sans-serif', color: '#475569' }}>
                {fwd == null ? `less than ${horizonLabel(horizon)} of history after it`
                             : `SPY, ${horizonLabel(horizon)} later`}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
