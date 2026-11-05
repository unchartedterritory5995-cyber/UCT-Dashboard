// ── MORNING WIRE PAGE: what /morning-wire shows, and what the archive holds — dates and names only ─────────
//
//   wire.page      a QUERY: the wire's date and its section names, as the page shows them now
//   wire.archive   a QUERY: whether the archive holds a date, from the index the Past issues tile reads
//                  (GET /api/wire/archive: dates and coverage, no issue text)
//
// ⛔ THE WIRE'S TEXT NEVER REACHES THE MODEL. Register rows T-14 / T-20 / T-50 rate that content R / LA / U, so nothing
// here can carry it: the page host hands over a date and bounded section names (hosts/pageHosts.js), the archive read
// is the index and never /api/wire/archive/{date} (that answer holds the issue's html). "Summarise the wire" declines
// in fixed words (discovery.js `wireText`). A member-only display would need turn.py LOCAL_ONLY_ACTIONS: not built.
// ⛔ wire.picks IS ON HOLD for an owner ruling (the tickers may derive from a third-party source): no capability.
// ⛔ NOTHING IS WRITTEN. Wire feedback has no Undo path and admin votes are flagged, so the votes stay the page's own;
// replaying a past issue is the Past issues tile's own date picker (its state is private to that tile: no door to call).

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { dayOf } from './calendar'

const REF = 'wirePage'
const MISSING_SHOWN = 8

function snap(host) {
  const src = host?.wirePage
  if (!src) return null
  return { ref: REF, label: 'Morning Wire page', ...src.snapshot() }
}

export const wirePageKind = {
  name: 'wirePage',
  boardScoped: false,
  selfDescribing: true,
  list: (host) => { const s = snap(host); return s ? [s] : [] },
  read: (host, ref) => (ref === REF ? snap(host) : null),
  stateOf: (s) => ({ ...s }),
  patch: () => null,
  commit: async () => false,
  landed: () => true,
  undoPatch: () => null,
  fingerprint: (s) => JSON.stringify([s.date, s.status]),
}

export function describeWirePage(s) {
  if (!s) return 'The Morning Wire page is not available here.'
  if (s.status === 'error') return 'The Morning Wire could not be read right now, so I can’t say what is on the page.'
  if (s.status === 'notOut') return 'Today’s Morning Wire is not out yet. It publishes each trading morning around 7:35 AM ET.'
  if (s.status !== 'ready') return 'The Morning Wire is still loading.'
  const names = s.sections || []
  const list = names.length ? ` Sections: ${names.join(', ')}.` : ''
  const more = s.unnamed ? ` ${names.length ? 'Plus ' : ''}${s.unnamed} section${s.unnamed === 1 ? '' : 's'} I can’t name.` : ''
  return `This page shows the Morning Wire ${s.date ? `of ${s.date}` : '(no date on it)'}.${list}${more} Its text stays on the page, so I can’t read or summarise it.`
}

const weekend = (iso) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay())
function coverageLine({ held, first, last, weekdays, missing }) {
  if (!held) return 'No past issues are archived yet.'
  const shown = missing.slice(0, MISSING_SHOWN)
  const gaps = shown.length ? ` Not held: ${shown.join(', ')}${missing.length > shown.length ? ` and ${missing.length - shown.length} more` : ''}.` : ''
  return `The archive holds ${held} of ${weekdays} weekdays, ${first} to ${last}.${gaps}`
}
function dateLine(day, { dates, held, first, last }) {
  if (dates.includes(day)) return `The archive holds the wire of ${day}. Pick that date in Past issues on this page to replay it.`
  const why = weekend(day) ? ' That date is a weekend.' : held ? ` The archive runs ${first} to ${last}.` : ''
  return `No wire in the archive for ${day}.${why}`
}

let registered = false
export function registerWirePageCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(wirePageKind)
  registerContextProvider({
    key: 'wirePage',
    build: (host, refFor) => {
      const s = snap(host)
      if (!s) return undefined
      return [{ ref: refFor('wirePage', REF), label: 'The Morning Wire page (its date, its section names, whether the archive holds a date; read only. The wire’s text is never available to you)', date: s.date, status: s.status, sections: s.sections.length + s.unnamed }]
    },
  })
  registerCapability({
    name: 'wire.page',
    surfaces: ['wire'],
    target: 'wirePage', query: true,
    summary: 'Say what the Morning Wire PAGE shows now: the wire\'s date and its section names. Changes nothing. Use it for "what does this page show?", "what am I looking at?", "what date is this wire?".',
    hints: 'target = the ref of the wirePage entry. You NEVER have the wire\'s text. Asked to summarise, read, quote or explain what the wire says, or for its picks or tickers: write no summary of your own; plan agent.capabilities with topic wireText instead (a fixed answer).',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    answer: (s) => describeWirePage(s),
  })
  registerCapability({
    name: 'wire.archive',
    surfaces: ['wire'],
    target: 'wirePage', query: true,
    summary: 'Say whether the Morning Wire archive holds a past date, or how much it holds. Dates only, never an issue\'s text. Use it for "do you have the wire of Oct 6?", "how far back does the archive go?".',
    hints: 'target = the ref of the wirePage entry; date = YYYY-MM-DD, or null for what the archive covers.',
    args: { type: 'object', properties: { date: { type: ['string', 'null'] } }, required: ['date'], additionalProperties: false },
    async answer(s, { date }, host) {
      const day = date ? dayOf(date) : null
      if (date && !day) return `I couldn’t read “${date}” as a date. Say it as YYYY-MM-DD.`
      const src = host?.wirePage
      if (!src) return 'The Morning Wire archive is not available here.'
      let index
      try { index = await src.archive() } catch (e) {
        return e?.status === 401 || e?.status === 402 ? 'Past issues are part of the paid plan.' : 'The archive could not be read right now. That says nothing about which dates it holds.'
      }
      return day ? dateLine(day, index) : coverageLine(index)
    },
  })
}
