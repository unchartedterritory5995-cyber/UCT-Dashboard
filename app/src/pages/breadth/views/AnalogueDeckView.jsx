/**
 * Analogue Deck — the sessions in history whose breadth vector most resembles
 * today's, and what SPY did next. The similarity search and the forward returns
 * are the server's (`breadth_analogues.py`); this view ranks and reads them.
 */
import useSWR from 'swr'
import { resolveViewColors } from './breadthViewShared'
// ⛔ NOT an inline `fetch(url).then(r => r.json())`. A 402/401 answers JSON too,
// and its `{detail}` body is truthy — so `data?.analogues ?? []` would render a
// paywall as "no historical session resembles today", which is a different
// sentence and the wrong one. `jsonFetcher` throws so SWR reports the status.
import jsonFetcher from '../../../utils/jsonFetcher'

const HORIZON_LABEL = { fwd_5d: '5 days', fwd_10d: '10 days', fwd_20d: '20 days', fwd_60d: '60 days' }

export default function AnalogueDeckView({ options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const horizon = options.horizon ?? 'fwd_20d'
  const topN = Number(options.matches ?? 5)

  // ⭐ A BARE `useSWR`, DELIBERATELY — see the census row for this file in
  // `hooks/pollingSites.rail.test.js`. The analogues feed refreshes 6-hourly and
  // the endpoint is server-cached for 6 hours, so `useMobileSWR`'s
  // `revalidateOnFocus: true`, its visibilitychange listener and its 60s
  // `useMarketOpen` timer would all be cost for data that moves at most daily.
  const { data, isLoading, error } = useSWR(
    `/api/breadth-monitor/analogues?top_n=${topN}`, jsonFetcher,
    { refreshInterval: 6 * 60 * 60 * 1000 },
  )

  if (isLoading) {
    return <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#64748b' }}>Finding analogues…</div>
  }
  const analogues = data?.analogues ?? []
  if (error || !analogues.length) {
    return (
      <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        {error ? `Could not load analogues — ${error.message ?? 'network error'}`
               : 'No historical session resembles today closely enough to report.'}
      </div>
    )
  }

  const withReturn = analogues.filter(a => a.forward_returns?.[horizon] != null)
  const higher = withReturn.filter(a => a.forward_returns[horizon] > 0).length
  const median = withReturn.length
    ? [...withReturn.map(a => a.forward_returns[horizon])].sort((x, y) => x - y)[Math.floor(withReturn.length / 2)]
    : null

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px' }}>
      <div data-testid="analogue-summary"
           style={{ font: '800 15px \'Instrument Sans\', sans-serif', color: '#e8e8ea', marginBottom: 4 }}>
        {withReturn.length
          ? `${higher} of ${withReturn.length} higher ${HORIZON_LABEL[horizon]} later`
          : `No match has ${HORIZON_LABEL[horizon]} of history after it yet`}
        {median != null && (
          <span style={{ marginLeft: 8, font: '700 12px \'Instrument Sans\', sans-serif',
                         color: median >= 0 ? colors.bull : colors.bear }}>
            median {median >= 0 ? '+' : ''}{median.toFixed(1)}%
          </span>
        )}
      </div>
      <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginBottom: 10 }}>
        Matched against {data.reference_date} · similarity over 16 weighted breadth metrics
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {analogues.map(a => {
          const fwd = a.forward_returns?.[horizon]
          return (
            <div key={a.date} data-testid={`analogue-${a.date}`}
                 style={{ background: '#0e131a', borderRadius: 8, padding: 10,
                          border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ font: '700 12px \'Instrument Sans\', sans-serif', color: '#e2e8f0' }}>{a.date}</span>
                <span style={{ font: '600 9px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
                  {Number(a.similarity).toFixed(1)}% match
                </span>
              </div>
              <div style={{ font: `800 20px 'Instrument Sans', sans-serif`, marginTop: 4,
                            color: fwd == null ? '#64748b' : (fwd >= 0 ? colors.bull : colors.bear) }}>
                {fwd == null ? 'Not yet' : `${fwd >= 0 ? '+' : ''}${Number(fwd).toFixed(1)}%`}
              </div>
              <div style={{ font: '500 9px \'Instrument Sans\', sans-serif', color: '#475569' }}>
                {fwd == null ? `less than ${HORIZON_LABEL[horizon]} of history after it`
                             : `SPY, ${HORIZON_LABEL[horizon]} later`}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
