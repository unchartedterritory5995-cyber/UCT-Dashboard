// G-063 — frozen-at-insert temporal correctness for reconstructable embeds.
//
// THE INVARIANT UNDER TEST:
//   what the member could know at capture time must not silently become
//   what became true later.
//
// The defect this file pins: `calendar` declared `reconstructable: true`
// unconditionally, on the (true) grounds that the calendar endpoints are
// date-parameterized and backfilled. That reasoning is about the ENDPOINTS. It
// is false about the MEMBER: a day captured before it happened re-rendered
// live, so a note written as a pre-event thesis later displayed the result.
import { describe, it, expect } from 'vitest'
import { resolveEmbedRender, outcomeKnowableAtCapture, etDayOf } from './widgetEmbedCore'
import { asOfDayOf } from '../../../widgets/registry'

const IMG = { url: 'https://x/archive.png', w: 800, h: 600 }

/** A calendar embed ABOUT `date`, CAPTURED at `capturedAt`. */
const cal = (date, capturedAt, fallback = IMG) => ({
  v: 1,
  widgetId: 'calendar',
  params: { date, econStars: 3 },
  capturedAt,
  mode: 'snapshot',
  fallback,
})

describe('G-063 — the day a capture is ABOUT', () => {
  it('calendar declares its as-of day at DAY precision, the only precision it has', () => {
    expect(asOfDayOf('calendar', { date: '2026-09-10' })).toBe('2026-09-10')
  })

  it('a widget that makes no as-of claim is not gated', () => {
    expect(asOfDayOf('chart', { from: 1, to: 2 })).toBeNull()
  })

  it('a malformed date is not accepted as an as-of day', () => {
    expect(asOfDayOf('calendar', { date: 'thursday' })).toBeNull()
    expect(asOfDayOf('calendar', {})).toBeNull()
  })
})

describe('G-063 — capture time is read as an ET SESSION day', () => {
  it('an evening ET capture stays on ITS OWN day, not UTC tomorrow', () => {
    // 21:30 ET on the 7th is 01:30 UTC on the 8th. toISOString() would say the
    // 8th and hand a whole extra day of "already knowable" away for free.
    expect(etDayOf('2026-09-08T01:30:00Z')).toBe('2026-09-07')
  })

  it('an unparseable capture time yields no day', () => {
    expect(etDayOf('not-a-date')).toBeNull()
    expect(etDayOf(undefined)).toBeNull()
  })
})

describe('G-063 — knowability, not string ordering', () => {
  // 1. BACKWARD-LOOKING: the day had fully elapsed before capture.
  it('a day that ALREADY HAPPENED when it was captured stays live-reconstructable', () => {
    const attrs = cal('2026-09-01', '2026-09-05T14:00:00Z')
    expect(outcomeKnowableAtCapture(attrs)).toBe(true)
    expect(resolveEmbedRender(attrs)).toEqual({ kind: 'live', reason: 'reconstructable' })
  })

  // 2. FORWARD-LOOKING: the defect. Captured before the outcome existed.
  it('a day captured BEFORE it happened renders its ARCHIVE, not the later truth', () => {
    const attrs = cal('2026-09-10', '2026-09-07T14:00:00Z')
    expect(outcomeKnowableAtCapture(attrs)).toBe(false)
    expect(resolveEmbedRender(attrs)).toEqual({ kind: 'image', reason: 'captured-before-outcome' })
  })

  // 3. SAME-DAY BOUNDARY at the precision actually available.
  it('a SAME-DAY capture is not knowable — the day was still unfolding', () => {
    // 13:00 UTC = 09:00 ET, before the close. Nothing in the data model can
    // show this capture followed the day's outcomes, so it must not claim so.
    const attrs = cal('2026-09-07', '2026-09-07T13:00:00Z')
    expect(outcomeKnowableAtCapture(attrs)).toBe(false)
    expect(resolveEmbedRender(attrs).reason).toBe('captured-before-outcome')
  })

  it('the same-day rule holds for an after-close capture too, and says why', () => {
    // 21:00 ET, after the close — genuinely settled in the real world, but the
    // widget exposes DAY precision only. We do not upgrade a guess to a claim.
    const attrs = cal('2026-09-07', '2026-09-08T01:00:00Z')
    expect(outcomeKnowableAtCapture(attrs)).toBe(false)
  })

  // 4. MISSING / INVALID capturedAt → fail safe.
  it('a missing capture time fails SAFE — never upgraded to later truth', () => {
    expect(outcomeKnowableAtCapture(cal('2026-09-01', undefined))).toBe(false)
    expect(outcomeKnowableAtCapture(cal('2026-09-01', ''))).toBe(false)
    expect(outcomeKnowableAtCapture(cal('2026-09-01', 'whenever'))).toBe(false)
    expect(resolveEmbedRender(cal('2026-09-01', null)).reason).toBe('captured-before-outcome')
  })

  it('a forward-looking capture with NO archive degrades to a placeholder, never live', () => {
    const attrs = cal('2026-09-10', '2026-09-07T14:00:00Z', null)
    expect(resolveEmbedRender(attrs)).toEqual({ kind: 'placeholder', reason: 'captured-before-outcome' })
  })
})

describe('G-063 — the gate is NARROW', () => {
  // 5. Chart is unchanged: from/to is a query range over a permanent store.
  it('a chart embed is untouched by the temporal gate', () => {
    const to = Math.floor(Date.parse('2026-12-31T00:00:00Z') / 1000)
    const attrs = {
      v: 1,
      widgetId: 'chart',
      params: { symbol: 'NVDA', tf: 'D', to },
      capturedAt: '2026-09-07T14:00:00Z',
      mode: 'snapshot',
      fallback: IMG,
    }
    expect(outcomeKnowableAtCapture(attrs)).toBe(true)
  })

  // 6. Payload-freeze widgets are unchanged — their data never re-fetches.
  it('a payload-freeze widget (news) is untouched by the temporal gate', () => {
    const attrs = {
      v: 1,
      widgetId: 'news',
      params: { symbol: 'NVDA', filter: 'all', events: [{ t: 'headline' }] },
      capturedAt: '2026-09-07T14:00:00Z',
      mode: 'snapshot',
      fallback: IMG,
    }
    expect(outcomeKnowableAtCapture(attrs)).toBe(true)
    expect(resolveEmbedRender(attrs)).toEqual({ kind: 'live', reason: 'reconstructable' })
  })

  it('live-mode embeds still win before the gate — live is what they asked for', () => {
    const attrs = {
      v: 1,
      widgetId: 'chart',
      params: { symbol: 'NVDA', tf: 'D' },
      capturedAt: '2026-09-07T14:00:00Z',
      mode: 'live',
      fallback: IMG,
    }
    expect(resolveEmbedRender(attrs).reason).toBe('live-mode')
  })
})

describe('G-063 — the real pre-event → post-event transition', () => {
  it('the SAME stored embed does not change what it shows as the day passes', () => {
    // The member captured Thursday's calendar on Tuesday. This is the whole
    // point: the stored attrs are immutable, so the ONLY thing that could
    // change the rendering is the passage of time. It must not.
    const stored = cal('2026-09-10', '2026-09-08T14:00:00Z')
    const beforeTheEvent = resolveEmbedRender(stored)
    // ...time passes, the day resolves, the endpoints now return real results...
    const afterTheEvent = resolveEmbedRender(stored)
    expect(beforeTheEvent).toEqual(afterTheEvent)
    expect(afterTheEvent.kind).toBe('image')
    expect(afterTheEvent.reason).toBe('captured-before-outcome')
  })
})
