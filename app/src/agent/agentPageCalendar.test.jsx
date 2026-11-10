// W2-C1 — the Agent on /calendar: next report (the page's own route) and the loaded week (the page's own payload).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

import AgentPanel from './AgentPanel'
import { buildCalendarPageHost } from './hosts/pageHosts'
import { dayOf } from './capabilities/calendar'

const WEEK = {
  week_start: '2026-11-02', week_end: '2026-11-06',
  days: {
    '2026-11-02': { label: 'Mon Nov 2', bmo: [{ sym: 'ON' }], amc: [{ sym: 'PLTR' }, { sym: 'VRTX' }], tbd: [], econ: [{ title: 'ISM Manufacturing' }] },
    '2026-11-03': { label: 'Tue Nov 3', bmo: [{ sym: 'AMD' }], amc: [], tbd: [{ sym: 'SMCI' }], econ: [] },
    '2026-11-05': { label: 'Thu Nov 5', bmo: [], amc: [{ sym: 'NVDA' }], tbd: [], econ: [] },
  },
}
function makePage(data = WEEK) {
  const page = { data, weekLabel: 'Nov 2 – Nov 6', view: 'week', loading: !data }
  return { page, host: buildCalendarPageHost({ read: () => page, location: () => '/calendar', navigate: () => {} }) }
}

let turns
let turnBodies
let fetched
beforeEach(() => {
  turns = []
  turnBodies = []
  fetched = []
  try { localStorage.clear() } catch { /* */ }
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = vi.fn(async (url, init) => {
    fetched.push(String(url))
    const body = init?.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn') { turnBodies.push(body); const next = turns.shift(); return json({ conversationId: 'ac_1', turnId: 1, envelope: typeof next === 'function' ? next(body) : next, usage: { citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    if (String(url).startsWith('/api/calendar/next-report')) return json({ sym: 'NVDA', date: '2026-11-19', timing: 'amc', date_est: null })
    if (String(url).startsWith('/api/calendar?week=')) return json({ ...WEEK, week_start: '2026-11-09', week_end: '2026-11-13', days: { '2026-11-10': { label: 'Tue Nov 10', bmo: [{ sym: 'HD' }], amc: [], tbd: [], econ: [] } } })
    return json({})
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const env = (disposition, ops = [], reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}
const mount = (host) => render(<AgentPanel host={host} surface="calendar" onClose={() => {}} />)

describe('UCT Agent on /calendar (W2-C1)', () => {
  it('NEXT REPORT: "when does NVDA report next?" reads the Calendar\'s own next-report route — no model call', async () => {
    const { host } = makePage()
    mount(host)
    type('when does NVDA report next?')
    await screen.findByText(/NVDA next reports on 2026-11-19, after the close/)
    expect(fetched).toContain('/api/calendar/next-report?sym=NVDA')
    expect(turnBodies).toHaveLength(0)
  })

  it('DAY: a day of the loaded week is read from the page (tickers by session), nothing fetched', async () => {
    const { host } = makePage()
    mount(host)
    turns.push((body) => env('apply', [{ action: 'calendar.day', target: body.context.calendar[0].ref, args: { date: '2026-11-02' } }]))
    type('what reports are on Nov 2?')
    await screen.findByText(/Mon Nov 2: ON before the open; PLTR, VRTX after the close\. Economic: ISM Manufacturing/)
    expect(fetched.some(u => u.startsWith('/api/calendar?week='))).toBe(false)
    const names = turnBodies[0].capabilities.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['calendar.nextReport', 'calendar.day', 'stock.earnings', 'app.open']))
    expect(names.some(n => n.startsWith('chart.') || n.startsWith('journal.') || n === 'screener.openSaved')).toBe(false)
    expect(turnBodies[0].context.calendar[0]).toMatchObject({ week: 'Nov 2 – Nov 6', view: 'week' })
  })

  it('WEEK: "what\'s on this week?" lists every loaded day; a day outside the loaded week is fetched from the Calendar\'s own route', async () => {
    const { host } = makePage()
    mount(host)
    type("what's on this week?")
    await screen.findByText(/Tue Nov 3: AMD before the open; SMCI time not confirmed/)
    expect(turnBodies).toHaveLength(0)
    type('who reports 2026-11-10?')
    await screen.findByText(/Tue Nov 10: HD before the open/)
    expect(fetched).toContain('/api/calendar?week=2026-11-09')
  })

  it('HONEST: an unreadable day word is refused; a day with nothing says so', async () => {
    const { host } = makePage()
    mount(host)
    turns.push((body) => env('apply', [{ action: 'calendar.day', target: body.context.calendar[0].ref, args: { date: 'someday' } }]))
    type('what is on someday')
    await screen.findByText(/I couldn't read “someday” as a day/)
    turns.push((body) => env('apply', [{ action: 'calendar.day', target: body.context.calendar[0].ref, args: { date: '2026-11-04' } }]))
    type('what reports are on the 4th')
    await screen.findByText(/2026-11-04 isn't in that calendar week/)
  })

  // TERM-033 (AUDIT bar, 2026-11-10): `request()` folded every failure into `null` with `.catch(() => null)`. A failed
  // read is now a tagged outcome: the member is told the calendar couldn't be LOADED, with the cause, and it is logged;
  // a failed week never reads as an empty one ("No reports…" / "no earnings reports").
  it('UNAVAILABLE: a failed next-report / week read says the calendar couldn\'t be loaded (with the cause) and logs it, never "no reports"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const real = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url)
      if (u.startsWith('/api/calendar/next-report')) { fetched.push(u); return new Response('upstream down', { status: 503 }) }
      if (u.startsWith('/api/calendar?week=')) { fetched.push(u); throw new TypeError('Failed to fetch') }
      return real(url, init)
    })
    const { host } = makePage()
    mount(host)
    type('when does NVDA report next?')
    await screen.findByText("I couldn't load UCT's calendar for NVDA right now (HTTP 503), so I can't say when it reports.")
    type('who reports 2026-11-10?')
    await screen.findByText("I couldn't load UCT's calendar for that week right now (the request didn't reach UCT), so I can't say what reports.")
    expect(screen.queryByText(/No reports are on that week|no earnings reports/)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[uct-agent\] calendar: \/api\/calendar\/next-report\?sym=NVDA failed \(HTTP 503\)/))
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[uct-agent\] calendar: \/api\/calendar\?week=2026-11-09 failed \(the request didn't reach UCT\)/))
    expect(turnBodies).toHaveLength(0)
  })

  it('day words: today / tomorrow / a weekday of the current week / ISO', () => {
    const now = Date.parse('2026-11-04T15:00:00Z')      // a Wednesday
    expect(dayOf('today', now)).toBe('2026-11-04')
    expect(dayOf('tomorrow', now)).toBe('2026-11-05')
    expect(dayOf('yesterday', now)).toBe('2026-11-03')
    expect(dayOf('Thursday', now)).toBe('2026-11-05')
    expect(dayOf('monday', now)).toBe('2026-11-02')
    expect(dayOf('2026-12-01', now)).toBe('2026-12-01')
    expect(dayOf('someday', now)).toBeNull()
  })
})
