/**
 * Score Attribution — the nine weighted components behind `breadth_score`,
 * each showing points earned of points available, and the change vs the prior
 * session. The numbers come from the server's own scoring pass; this view
 * never re-derives them, because a renormalized score cannot be reconstructed
 * from its weights alone.
 */
import useSWR from 'swr'
import { resolveViewColors } from './breadthViewShared'
// ⛔ NOT an inline `fetch(url).then(r => r.json())`. A 401 from `require_paid`
// or a 503 answers JSON too, and its `{detail}` body is a perfectly good object —
// so `data.ok === false` is `undefined === false`, the refusal branch is skipped,
// and `.filter` on a missing `components` takes the WHOLE Breadth route down
// through `RouteErrorBoundary`. `jsonFetcher` throws on a non-ok status so SWR
// reports it as an error instead. See `utils/jsonFetcher.test.js`.
import jsonFetcher from '../../../utils/jsonFetcher'

export default function ScoreAttributionView({ rows = [], currentRow, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const date = currentRow?.date
  // ⭐ The window the CLIENT loaded, not a fourth one nobody warms. `get_history`
  // caches per `days` value and startup warms only 90, so a hardcoded 400 here
  // paid a cold ~415-row fetch plus a full derivation pass every 5 minutes on a
  // single-process pod. `rows` IS the loaded window and `currentRow` came out of
  // it, so this can never ask for less history than it needs.
  const days = Math.min(3650, Math.max(1, rows.length || 90))
  const { data, isLoading, error } = useSWR(
    date ? `/api/breadth-monitor/score-components/${date}?days=${days}` : null,
    jsonFetcher,
  )

  if (isLoading) {
    return <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#64748b' }}>Loading attribution…</div>
  }
  // ⛔ `data.ok === false` ALONE IS NOT THE GUARD. A non-ok body answers
  // `undefined` there, which is not `false`, so a malformed payload sailed
  // straight into `.filter` below. The shape the render needs is checked
  // instead of the shape a healthy server happens to send.
  if (error || !data || data.ok === false || !Array.isArray(data.components)) {
    return (
      <div style={{ padding: 24, font: '600 12px \'Instrument Sans\', sans-serif', color: '#94a3b8' }}>
        <div data-testid="attribution-refusal">
          {error ? `Could not load attribution — ${error.message ?? 'network error'}`
                 : (data?.reason ?? data?.detail ?? 'No attribution for this session')}
        </div>
      </div>
    )
  }

  const prevByKey = Object.fromEntries((data.prev?.components ?? []).map(c => [c.key, c]))
  const totalDelta = (data.total != null && data.prev?.total != null) ? data.total - data.prev.total : null
  const dropped = data.components.filter(c => !c.present)

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ font: '800 26px \'Instrument Sans\', sans-serif', color: '#e8e8ea' }}>
          {data.total == null ? '—' : data.total}
        </span>
        {totalDelta != null && (
          <span style={{ font: '700 12px \'Instrument Sans\', sans-serif',
                         color: totalDelta >= 0 ? colors.bull : colors.bear }}>
            {totalDelta >= 0 ? '+' : ''}{totalDelta.toFixed(1)} vs {data.prev.date}
          </span>
        )}
        <span style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
          {data.min_weight_met
            ? `renormalized over ${data.components.filter(c => c.present).length} of ${data.components.length} inputs`
            : 'below the minimum available weight — no score reported'}
        </span>
      </div>

      {data.components.map(c => {
        const prev = prevByKey[c.key]
        const delta = (prev && c.present && prev.present) ? c.points - prev.points : null
        const fill = c.max_points ? (c.points / c.max_points) * 100 : 0
        return (
          <div key={c.key} data-testid={`attribution-component-${c.key}`}
               style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 150, flex: '0 0 150px', textAlign: 'right',
                          font: '700 10px \'Instrument Sans\', sans-serif', color: '#94a3b8',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.label}
            </div>
            <div style={{ flex: 1, minWidth: 0, height: 16, borderRadius: 3,
                          background: 'rgba(255,255,255,0.04)', position: 'relative' }}>
              {c.present && (
                <div style={{ width: `${fill}%`, height: '100%', borderRadius: 3,
                              opacity: colors.fillOpacity,
                              background: fill >= 50 ? colors.bull : colors.bear }} />
              )}
            </div>
            <div style={{ width: 130, flex: '0 0 130px', font: '700 10px \'Instrument Sans\', sans-serif',
                          color: c.present ? '#e2e8f0' : '#64748b' }}>
              {c.present ? `${Number(c.points).toFixed(0)} / ${c.max_points}` : 'Not reported'}
              {delta != null && (
                <span data-testid={`attribution-delta-${c.key}`}
                      style={{ marginLeft: 6, color: delta >= 0 ? colors.bull : colors.bear }}>
                  {delta >= 0 ? '+' : ''}{delta.toFixed(0)}
                </span>
              )}
            </div>
          </div>
        )
      })}

      {dropped.length > 0 && (
        <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginTop: 10 }}>
          {dropped.length} component{dropped.length > 1 ? 's' : ''} dropped from both sides of the ratio —
          an input that cannot be measured is not scored zero.
        </div>
      )}
    </div>
  )
}
