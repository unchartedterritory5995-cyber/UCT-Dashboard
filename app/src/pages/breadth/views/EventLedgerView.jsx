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

/**
 * THE FIRED ACCENT IS NEUTRAL, AND THAT IS THE WHOLE POINT OF THIS LENS.
 *
 * It reports that a NAMED thing happened; it does not grade the thing. Painting
 * every fired event with the palette's bull colour drew *90% Down Volume Day*,
 * *McClellan Oversold* and *New-Low Washout* green, with a green border — a
 * washout day rendered as good news. Tinting each event by an invented
 * directional opinion would be worse: McClellan oversold, an HVC surge and ATR
 * froth are all genuinely arguable, and those are the owner's calls, not this
 * file's.
 *
 * ⭐ SO THE ACCENT IS `colors.tier.a` — THE PALETTE'S OWN CAUTION TONE.
 *
 * The first fix for the green-washout bug hardcoded the UT gold, which held the
 * neutrality but left `options.palette` INERT in this lens: the Customize
 * control was on screen, offered four choices, and moved nothing. A control
 * that cannot change anything is a lie about the product, and it had to be
 * parked behind an exemption in the palette rail to keep that rail green.
 *
 * `tier.a` keeps the property the neutral ruling was actually protecting — the
 * caution band is the one tone a palette carries that reads as neither bull nor
 * bear — while moving with the palette like every other themed view. The
 * exemption is gone; `viewRegistry.test.jsx` now covers this lens with the
 * rest, and pins that the accent is never the bull or bear colour.
 */
export const firedAccent = (colors) => colors.tier.a

export default function EventLedgerView({ rows = [], rowIdx = 0, options = {} }) {
  const colors = resolveViewColors(options.palette, options.intensity)
  const accent = firedAccent(colors)
  // `win`, not `window`: a local named `window` shadows the global for the whole
  // function body, so any later `window.matchMedia` / `window.addEventListener`
  // added here would read a row array instead.
  const win = rows.slice(rowIdx)
  // The guard comes BEFORE the scan: `scanEvents([])` on an empty window was
  // work done only to be thrown away, and it reads as though the empty case
  // were handled somewhere downstream.
  if (!win.length) return null
  const families = options.families && options.families !== 'all' ? [options.families] : null
  const events = scanEvents(win, { families })

  const firedCount = events.filter(e => e.firedToday).length

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span data-testid="events-headline"
              style={{ font: '800 15px \'Instrument Sans\', sans-serif',
                       color: firedCount ? accent : '#94a3b8' }}>
          {firedCount ? `${firedCount} event${firedCount > 1 ? 's' : ''} today` : 'No named event today'}
        </span>
        <span data-testid="events-basis"
              style={{ font: '600 10px \'Instrument Sans\', sans-serif', color: '#64748b', marginLeft: 'auto' }}>
          {win.length} sessions · since {win[win.length - 1].date}
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
            <div key={e.key} data-testid={`events-card-${e.key}`}
                 style={{ background: '#0e131a', borderRadius: 8, padding: 10,
                          border: e.firedToday ? `1px solid ${accent}` : '1px solid rgba(255,255,255,0.05)',
                          opacity: e.unavailable ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, flex: '0 0 7px',
                               opacity: e.firedToday ? colors.fillOpacity : 1,
                               background: e.firedToday ? accent : '#334155' }} />
                <span style={{ font: '700 11px \'Instrument Sans\', sans-serif', color: '#e2e8f0' }}>
                  {e.label}
                </span>
              </div>
              <div style={{ font: '600 10px \'Instrument Sans\', sans-serif', marginTop: 4,
                            color: e.firedToday ? accent : '#94a3b8' }}>
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
