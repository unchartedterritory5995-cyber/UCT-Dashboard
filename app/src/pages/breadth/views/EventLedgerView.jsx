/**
 * Event Ledger — the named things a trader can say out loud, and whether they
 * happened. Every threshold is sourced (tier / formula / percentile) and shown,
 * so a reader can check the claim rather than trust it.
 */
import { fillsRow, resolveViewColors } from './breadthViewShared'
import SeekDate from './SeekDate'
import { scanEvents } from './breadthEvents'
// ⛔ THE FAMILY NAMES ARE NOT RE-TYPED HERE. `EVENT_DEFS` owns the roster and
// the option schema owns the words the Customize dropdown shows for each one, so
// the section headings below read the SAME label the filter offers. A local map
// would be a third spelling of a list that already has two authorities too many.
import { optionLabel } from './viewMetricConfig'

const BASIS_LABEL = {
  tier: 'metric tier', formula: 'published formula',
  percentile: 'percentile of window', collected: 'collected flag',
}
// The one word of the basis, for the row's own chip: the long form stays in the
// note beside it and in the row's title.
const BASIS_CHIP = {
  tier: 'TIER', formula: 'FORMULA', percentile: 'PCTILE', collected: 'COLLECTED',
}

// A ledger row's floor and ceiling. The floor is what the row measured at
// before it could flex (5px of padding either side of an 11px line); the
// ceiling stops a one-family filter from drawing three slabs.
const ROW_MIN_H = 26
const ROW_MAX_H = 42

/**
 * Group the scanned events by the family THEY carry. Insertion order is
 * `EVENT_DEFS` order, so the sections come out in the registry's order without
 * this file holding an opinion about what the families are or how many there
 * are — add an event in a new family and its section appears, in place.
 */
function byFamily(events) {
  const out = new Map()
  for (const e of events) {
    if (!out.has(e.family)) out.set(e.family, [])
    out.get(e.family).push(e)
  }
  return [...out.entries()]
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

export default function EventLedgerView({
  rows = [], rowIdx = 0, onSeek, canSeek, options = {},
}) {
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
    <div style={{ height: '100%', minHeight: 0, padding: '12px 18px',
                  display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10,
                    flex: '0 0 auto' }}>
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

      {/* ⭐ A LEDGER, NOT A CARD WALL.
          Nine cards on `auto-fill minmax(260px)` spread across a 1500px page and
          used about 160px of it, most of that padding — and the one thing the
          reader wants to do here, compare the named things that are related to
          each other, was left to the eye. Each event is one row now, grouped
          under the family it declares, with its status, its basis and its note
          on the same line. Roughly twice the height for four times the reading.
          ⛔ NOTHING BELOW IS TINTED BY DIRECTION: the fired accent is the
          palette's caution tone and every other tone here is chrome.

          🔴 AND THE LEDGER BREATHES INTO THE ROOM IT IS GIVEN. Ten rows at
          their intrinsic 26px stopped a third of the way down a full-height
          panel: the box was `height: 100%` and the content simply declined it.
          The rows flex between that 26px — what a quarter-size compare pane
          gets — and a ceiling that keeps a three-event filter from drawing
          three slabs. Row LEADING is the only thing that changes; nothing here
          is stretched or re-ranked to fill space. */}
      <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto',
                    display: 'flex', flexDirection: 'column' }}>
      {byFamily(events).map(([family, list]) => {
        const firedHere = list.filter(e => e.firedToday).length
        return (
        <section key={family} data-testid={`events-family-${family}`}
                 /* ⛔ THE GROW FACTOR IS THE ROW COUNT, not 1. A flat `flex: 1`
                    hands a one-event family the same slack as a four-event one,
                    so the sections stop lining up and the ledger reads as five
                    unrelated blocks. Weighted by rows, every row in the lens
                    ends up the same height whichever family it sits under. */
                 style={{ marginBottom: 12, flex: `${list.length} 1 auto`, minHeight: 0,
                          display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
                        flex: '0 0 auto' }}>
            <span style={{ font: '800 9px \'Instrument Sans\', sans-serif', letterSpacing: '1px',
                           textTransform: 'uppercase', color: '#64748b', whiteSpace: 'nowrap' }}>
              {optionLabel('events', 'families', family)}
            </span>
            <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
            <span style={{ font: '700 9px \'Instrument Sans\', sans-serif',
                           color: firedHere ? accent : '#475569', whiteSpace: 'nowrap' }}>
              {firedHere ? `${firedHere} today` : `${list.length}`}
            </span>
          </div>
        {list.map(e => {
          // ⭐ "Last fired 2026-08-04 · 18 sessions ago" was DEAD TEXT — the one
          // line on this tab that most obviously names a session the reader
          // wants to see. The date is the affordance now; the rest of the
          // sentence is unchanged, and an unreachable date still renders (as a
          // disabled control that says why) rather than disappearing.
          const status = e.unavailable
            ? e.unavailable
            : e.firedToday
              ? 'Fired today'
              : e.lastDate
                ? (
                  <>
                    Last fired{' '}
                    <SeekDate date={e.lastDate} styleKey="events" onSeek={onSeek} canSeek={canSeek} />
                    {` · ${e.sessionsAgo} session${e.sessionsAgo === 1 ? '' : 's'} ago`}
                  </>
                )
                : `Not in the last ${e.windowLength} sessions`

          return (
            <div key={e.key} data-testid={`events-card-${e.key}`}
                 title={`${e.note} · ${BASIS_LABEL[e.basis]}`}
                 style={{ display: 'grid', alignItems: 'center', gap: 8,
                          gridTemplateColumns: '7px minmax(104px, 1.3fr) minmax(110px, 1.5fr) 58px minmax(0, 2.4fr)',
                          ...fillsRow(ROW_MIN_H, ROW_MAX_H),
                          padding: '0 8px 0 6px',
                          borderLeft: `2px solid ${e.firedToday ? accent : 'transparent'}`,
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          background: e.firedToday ? 'rgba(255,255,255,0.025)' : 'transparent',
                          opacity: e.unavailable ? 0.55 : 1 }}>
              <span style={{ width: 7, height: 7, borderRadius: 4,
                             opacity: e.firedToday ? colors.fillOpacity : 1,
                             background: e.firedToday ? accent : '#334155' }} />
              <span style={{ font: '700 11px \'Instrument Sans\', sans-serif', color: '#e2e8f0',
                             minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                             whiteSpace: 'nowrap' }}>
                {e.label}
              </span>
              <span style={{ font: '600 10px \'Instrument Sans\', sans-serif', minWidth: 0,
                             color: e.firedToday ? accent : '#94a3b8' }}>
                {status}
              </span>
              {/* The basis gets a column of its own rather than a tail on the
                  note, because it is the claim's provenance and the note is only
                  its wording — and a column cannot be ellipsised away. */}
              <span style={{ font: '700 8px \'Instrument Sans\', sans-serif', letterSpacing: '.6px',
                             color: '#64748b', textAlign: 'center',
                             border: '1px solid rgba(255,255,255,0.07)', borderRadius: 3,
                             padding: '2px 0' }}>
                {BASIS_CHIP[e.basis]}
              </span>
              <span style={{ font: '500 9px \'Instrument Sans\', sans-serif', color: '#475569',
                             minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                             whiteSpace: 'nowrap' }}>
                {e.note}
              </span>
            </div>
          )
        })}
        </section>
        )
      })}
      </div>
    </div>
  )
}
