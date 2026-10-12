// MARKET INTELLIGENCE breadth slice 1 — the browser half of the LOCAL-RESULT BOUNDARY.
// The model only PLANS breadth.show; the panel asks /api/agent/breadth and shows UCT's answer; the
// figure never goes back to a model. Here the ACTUAL request bodies the browser sends are inspected:
// the next /api/agent/turn (context, pending, history-bearing fields) and the /record row that the
// server replays as a note. Scripted model, mocked routes — no model call, no network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { getCapability, manifestFor, buildContext, shapeError } from './capabilities'
import { selectGroups, routeManifest } from './routing'
import { loadBreadthDates, _resetBreadthDates, BREADTH_METRICS } from './capabilities/breadth'
import { makeBoard } from './__fixtures__/board'
import { MANIFEST_CONTRACT } from './capabilities'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const SENTINELS = ['73.4567', '73.457', '73.46', '73.5']
const leaked = (o) => SENTINELS.filter(s => JSON.stringify(o).includes(s))
const ANSWER = { status: 'ok', text: 'US · % Above 50-Day: 73.5% on 2026-10-09. Prior session 2026-10-08: 61.0%.\nSource: UCT Breadth — US.',
  table: { columns: [{ key: 'metric', label: 'Measure' }, { key: 'value', label: 'Value' }], rows: [{ metric: '% Above 50-Day', value: '73.5%' }] } }
const REQ = { mode: 'value', universe: 'us', metrics: ['pct_above_50sma'], date: null, compare_date: null, start: null, end: null }
const CTX = { surface: 'charts', createIndicator: true }

let envelopes, turnBodies, records, breadthBodies, datesBody
beforeEach(() => {
  envelopes = []; turnBodies = []; records = []; breadthBodies = []
  datesBody = { today_et: '2026-10-11', latest_finalized: { us: '2026-10-09', nyse: '2026-10-09', nasdaq: '2026-10-09' } }
  _resetBreadthDates()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn') {
      turnBodies.push(body)
      const e = envelopes.shift()
      return json({ conversationId: 'c1', envelope: typeof e === 'function' ? e(body) : e, usage: {} })
    }
    if (url === '/api/agent/record') { records.push(body); return json({ conversationId: 'c1' }) }
    if (url === '/api/agent/breadth') { breadthBodies.push(body); return json(ANSWER) }
    if (url === '/api/agent/breadth/dates') return json(datesBody)
    if (String(url).startsWith('/api/fundamentals-full/')) return json({ symbol: 'NVDA', companyName: 'Nvidia Corp' })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

const refOf = (b, key) => b.context[key]?.[0]?.ref
const plan = (ops, reply = '') => ({ disposition: 'apply', reply, question: null, unsupported_category: null, ops })

async function mount() {
  const board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 }); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { ...board, say }
}

describe('1 · the capability: local only, closed args, dates-only context', () => {
  it('breadth.show is a localOnly QUERY with a closed schema and hints inside the manifest limits', () => {
    const cap = getCapability('breadth.show')
    expect(cap.query).toBe(true)
    expect(cap.localOnly).toBe(true)
    const entry = manifestFor(CTX).find(c => c.name === 'breadth.show')
    expect(entry.hints.length).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxHints)
    expect(entry.summary.length).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxSummary)
    expect(JSON.stringify(entry).length).toBeLessThanOrEqual(MANIFEST_CONTRACT.limits.maxCapBytes)
    expect(entry.args.properties.metrics.items.enum).toEqual(BREADTH_METRICS)
    expect(entry.args.properties.from).toBeUndefined()                      // start/end, never from/to
    expect(Object.keys(entry)).not.toContain('localOnly')                     // a registry flag, not a model field
  })

  it('the browser refuses a bad shape before anything is asked (from/to, wrong universe); the route refuses unknown metrics', () => {
    expect(shapeError('breadth.show', REQ)).toBeNull()
    expect(shapeError('breadth.show', { ...REQ, from: '2026-01-01' })).toMatch(/Unexpected detail/)
    expect(shapeError('breadth.show', { ...REQ, universe: 'uct' })).toMatch(/isn't an option/)
  })

  it('the context section carries DATES ONLY — anything else the dates route returns is dropped', async () => {
    datesBody = { today_et: '2026-10-11', latest_finalized: { us: '2026-10-09', nyse: 73.4567, nasdaq: '73.5%' }, value: 73.4567 }
    await loadBreadthDates()
    const sec = buildContext(makeBoard([], {}).host, CTX).context.breadth[0]
    expect(sec.today_et).toBe('2026-10-11')
    expect(sec.latest_finalized).toEqual({ us: '2026-10-09', nyse: null, nasdaq: null })
    expect(Object.keys(sec).sort()).toEqual(['label', 'latest_finalized', 'ref', 'today_et'])
    expect(leaked(sec)).toEqual([])
  })
})

describe('2 · routing: breadth questions reach breadth.show; going TO the breadth page stays navigation', () => {
  const BUDGET = { limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }
  const routed = (m) => routeManifest(manifestFor(CTX), m, BUDGET).manifest.map(c => c.name)
  it.each([
    'what is breadth today', 'how is market breadth looking', 'what % of stocks are above their 50-day',
    'what percent of nasdaq stocks are above the 200 day sma', 'how many stocks are above the 20-day',
    'new 52-week highs vs lows last friday', 'net new highs on october 1', 'show the advance/decline line for nyse',
    'how many advancers yesterday', 'stage 2 count a month ago', 'how did breadth compare to september 1',
  ])('"%s" → the breadth group, and breadth.show is in the request', (m) => {
    expect(selectGroups(m).selected).toContain('breadth')
    expect(routed(m)).toContain('breadth.show')
  })
  it.each([
    'take me to the breadth page', 'open the breadth monitor', 'go to breadth page please', 'take me to the breadth dashboard',
  ])('"%s" stays NAVIGATION (settings group), not a breadth lookup', (m) => {
    expect(selectGroups(m).selected).toContain('settings')
    expect(selectGroups(m).selected).not.toContain('breadth')
  })
  it.each(['add a 50-day sma', 'show me stocks above the 50 day', 'add RSI', 'switch to my trading layout', 'show me my strongest stocks', 'open NVDA'])(
    '"%s" does not route breadth', (m) => { expect(selectGroups(m).selected).not.toContain('breadth') })
})

describe('3 · the panel: the member sees UCT\'s answer; the model never gets it back', () => {
  it('turn 1 → answer shown (not the model\'s words) and recorded as LOCAL; turn 2 → nothing retrieved rides along', async () => {
    const { say } = await mount()
    await loadBreadthDates()
    envelopes.push((b) => plan([{ action: 'breadth.show', target: refOf(b, 'breadth'), args: REQ }], 'It was about 73.5% on Friday.'))
    await say('what % of US stocks are above their 50-day?')
    await screen.findByText(/73\.5% on 2026-10-09/, {}, { timeout: 6000 })
    expect(screen.getByTestId('agent-transcript').textContent).not.toMatch(/It was about 73\.5% on Friday/)   // model words dropped
    expect(breadthBodies).toEqual([REQ])
    await waitFor(() => expect(records.some(r => r.outcomeData?.kind === 'answered')).toBe(true), { timeout: 6000 })
    const row = records.find(r => r.outcomeData?.kind === 'answered')
    expect(row.outcomeData).toEqual({ kind: 'answered', actions: ['breadth.show'], local: true, requests: [REQ] })
    expect(row.outcome).toMatch(/73\.5%/)                                          // the member's history keeps it

    envelopes.push({ disposition: 'answer', reply: 'Ask me for another date.', question: null, unsupported_category: null, ops: [] })
    await say('and how about a month earlier?')
    await waitFor(() => expect(turnBodies.length).toBe(2), { timeout: 6000 })
    const t2 = turnBodies[1]
    expect(leaked(t2)).toEqual([])                                                 // context, pending, every field
    expect(t2.recentOutcome).toBeUndefined()
    expect(t2.context.breadth[0]).toMatchObject({ today_et: '2026-10-11', latest_finalized: { us: '2026-10-09' } })
  })

  it('a MIXED turn (breadth + stock profile) is recorded local with only the breadth request', async () => {
    const { say } = await mount()
    envelopes.push((b) => plan([
      { action: 'breadth.show', target: refOf(b, 'breadth'), args: REQ },
      { action: 'stock.profile', target: refOf(b, 'stockData'), args: { symbol: 'NVDA' } },
    ]))
    await say('US breadth on the 50-day, and NVDA\'s profile')
    await waitFor(() => expect(records.some(r => r.outcomeData?.kind === 'answered')).toBe(true), { timeout: 6000 })
    const row = records.find(r => r.outcomeData?.kind === 'answered')
    expect(row.outcomeData).toMatchObject({ actions: ['breadth.show', 'stock.profile'], local: true, requests: [REQ] })
  })

  it('a refused breadth answer is shown plainly and still recorded local', async () => {
    globalThis.fetch.mockImplementation(async (url, init = {}) => {
      const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url === '/api/agent/turn') { turnBodies.push(JSON.parse(init.body)); return json({ conversationId: 'c1', envelope: envelopes.shift()(JSON.parse(init.body)), usage: {} }) }
      if (url === '/api/agent/record') { records.push(JSON.parse(init.body)); return json({}) }
      if (url === '/api/agent/breadth') return json({ status: 'refused', text: 'That date is after the latest finalized session. The latest finalized session is 2026-10-09.', table: null })
      return json({ conversations: [] })
    })
    const { say } = await mount()
    envelopes.push((b) => plan([{ action: 'breadth.show', target: refOf(b, 'breadth'), args: { ...REQ, date: '2026-10-12' } }]))
    await say('breadth on october 12')
    await screen.findByText(/after the latest finalized session/, {}, { timeout: 6000 })
    await waitFor(() => expect(records.some(r => r.outcomeData?.local === true)).toBe(true), { timeout: 6000 })
  })

  it('every outcome row the browser records carries a kind (the server replays a row without one as unreadable)', async () => {
    const { say } = await mount()
    await say('do it')                                       // nothing pending → the fixed-sentence path
    await waitFor(() => expect(records.length).toBeGreaterThan(0), { timeout: 6000 })
    for (const r of records.filter(x => x.outcome)) expect(typeof r.outcomeData?.kind).toBe('string')
  })
})
