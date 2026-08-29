/**
 * Event Ledger — the named things a trader can say out loud, and whether they
 * happened. Every threshold is sourced (tier / formula / percentile) and shown,
 * so a reader can check the claim rather than trust it.
 */
import { resolveViewColors } from './breadthViewShared'
import { scanEvents } from './breadthEvents'

const BASIS_LABEL = {
  tier: 'metric tier', formula: 'published formula',
  percentile: 'percentile of window', collected: 'collected flag',
}

export default function EventLedgerView({ rows = [], rowIdx = 0, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const window = rows.slice(rowIdx)
  const families = options.families && options.families !== 'all' ? [options.families] : null
  const events = scanEvents(window, { families })
  if (!window.length) return null

  const firedCount = events.filter(e => e.firedToday).length

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={{ font: '800 15px \'Instrument Sans\', sans-serif',
                       color: firedCount ? colors.bull : '#94a3b8' }}>
          {firedCount ? `${firedCount} event${firedCount > 1 ? 's' : ''} today` : 'No named event today'}
        </span>
        <span style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
          {window.length} sessions · since {window[window.length - 1].date}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {events.map(e => {
          const status = e.unavailable
            ? e.unavailable
            : e.firedToday
              ? 'Fired today'
              : e.lastDate
                ? `Last fired ${e.lastDate} · ${e.sessionsAgo} session${e.sessionsAgo === 1 ? '' : 's'} ago`
                : `Not in the last ${e.windowLength} sessions`

          return (
            <div key={e.key} data-testid={`event-${e.key}`}
                 style={{ background: '#0e131a', borderRadius: 8, padding: 10,
                          border: e.firedToday ? `1px solid ${colors.bull}` : '1px solid rgba(255,255,255,0.05)',
                          opacity: e.unavailable ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, flex: '0 0 7px',
                               background: e.firedToday ? colors.bull : '#334155' }} />
                <span style={{ font: '700 11px \'Instrument Sans\', sans-serif', color: '#e2e8f0' }}>
                  {e.label}
                </span>
              </div>
              <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', marginTop: 4,
                            color: e.firedToday ? colors.bull : '#94a3b8' }}>
                {status}
              </div>
              <div style={{ font: '500 9px \'Instrument Sans\', sans-serif', color: '#475569', marginTop: 4 }}>
                {e.note} · {BASIS_LABEL[e.basis]}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
