// The Agent on /morning-wire, the sixth page host: a READ-ONLY host over the wire's date, its section names and the
// archive's index. ⛔ The wire's text must never reach the model, wire.picks does not exist, nothing is written.
// No paid model call: every turn is scripted. Every wire string below is synthetic.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

let rundownState
vi.mock('swr', async (original) => {
  const real = await original()
  return { ...real, default: vi.fn((key, ...rest) => (key === '/api/rundown' ? { ...rundownState, mutate: vi.fn() } : real.default(key, ...rest))) }
})

import AgentPanel from './AgentPanel'
import { registerBuiltins } from './builtins'
import { AgentContext } from './agentApp'
import { buildWirePageHost, wireSectionName } from './hosts/pageHosts'
import { describeWirePage } from './capabilities/wirePage'
import { allCapabilityNames, getCapability, manifestFor } from './capabilities'
import { answerFor, fastDiscovery, matchTopic } from './discovery'
import { guideFeatures, matchFeature } from './guide/registry'
import { _resetGuide } from './guide/guideStore'
import { fastParse } from './fastPath'
import { TerminalPanelContext } from '../components/terminal'
import { renderWithProviders } from '../test-utils'
import MorningWire from '../pages/MorningWire'

registerBuiltins()

const INDEX = {
  dates: ['2026-11-04', '2026-11-03', '2026-10-30'],
  coverage: { held: 3, first: '2026-10-30', last: '2026-11-04', weekdays_in_range: 4, missing_weekdays: ['2026-11-02'], denominator: 'weekdays' },
}
const SECRET = 'SENTINEL-WIRE-TEXT'
const FIXED = answerFor('wireText').text

function makePage(over = {}, index = async () => INDEX) {
  const page = { date: '2026-11-05', status: 'ready', sections: ['The Tape', 'Macro', 'The Board'], ...over }
  const nav = []
  const host = buildWirePageHost({ read: () => page, archiveIndex: index, location: () => '/morning-wire', navigate: (to) => nav.push(to) })
  return { page, host, nav }
}

let turns
let turnBodies
let fetched
const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
let restore = []
beforeEach(() => {
  turns = []
  turnBodies = []
  fetched = []
  _resetGuide()
  try { localStorage.clear() } catch { /* */ }
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = vi.fn(async (url, init) => {
    fetched.push(`${init?.method || 'GET'} ${url}`)
    const body = init?.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn') { turnBodies.push(body); const next = turns.shift(); return json({ conversationId: 'ac_1', turnId: 1, envelope: typeof next === 'function' ? next(body) : next, usage: { citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    return json({})
  })
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX, toJSON: () => BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  restore = [() => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }]
})
afterEach(() => { restore.forEach(f => f()); cleanup(); vi.restoreAllMocks(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); _resetGuide() })

const env = (disposition, ops = [], reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}
const mount = (host) => render(<AgentPanel host={host} surface="wire" onClose={() => {}} />)
const pageOp = (body) => ({ action: 'wire.page', target: body.context.wirePage[0].ref, args: {} })
const archiveOp = (body, date) => ({ action: 'wire.archive', target: body.context.wirePage[0].ref, args: { date } })
const askPage = (host) => { mount(host); turns.push((body) => env('apply', [pageOp(body)])); type('what does this page show?') }
const askArchive = (host, date) => { mount(host); turns.push((body) => env('apply', [archiveOp(body, date)])); type('does the archive hold that?') }
function controls(ids) {
  const root = document.createElement('div')
  root.setAttribute('data-fixture', '')
  root.innerHTML = ids.map(id => `<button data-guide="${id}">${id}</button>`).join('')
  document.body.appendChild(root)
}

describe('page targeting', () => {
  it('a turn here carries the wire surface, the wire entry and the wire reads; chart and write controls are not offered', async () => {
    const { host } = makePage()
    mount(host)
    turns.push(env('answer', [], 'ok'))
    type('hello there')
    await screen.findByText('ok')
    const body = turnBodies[0]
    expect(body.context.surface).toBe('wire')
    expect(body.context.wirePage[0]).toMatchObject({ date: '2026-11-05', status: 'ready', sections: 3 })
    const names = body.capabilities.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['wire.page', 'wire.archive', 'guide.show', 'agent.capabilities', 'app.open']))
    expect(body.capabilities.filter(c => c.name.startsWith('wire.')).every(c => c.query)).toBe(true)
    expect(names.some(n => /^(chart|widget|layout|drawing|indicator|board|watchlist|alert|journal)\./.test(n))).toBe(false)
  })

  it('wire capabilities are offered on /morning-wire and nowhere else', () => {
    for (const s of ['charts', 'screener', 'breadth', 'calendar', 'journal']) {
      const off = manifestFor({ surface: s, createIndicator: true }).map(c => c.name).filter(n => n.startsWith('wire.'))
      expect(off, s).toEqual([])
    }
  })

  it('a page without the wire host has no wire entry', async () => {
    const host = { surface: 'calendar', location: () => '/calendar', navigate: () => {} }
    render(<AgentPanel host={host} surface="calendar" onClose={() => {}} />)
    turns.push(env('answer', [], 'ok'))
    type('hello there')
    await screen.findByText('ok')
    expect(turnBodies[0].context.wirePage).toBeUndefined()
  })

  it('the guide on this page is this page\'s: words match here and not on /charts', () => {
    expect(guideFeatures({ surface: 'wire' }).map(f => f.id)).toEqual(['wireArchive', 'wireReadAloud', 'wireSections'])
    expect(matchFeature('where are the past issues', { surface: 'wire' })?.id).toBe('wireArchive')
    expect(matchFeature('how do I listen to it', { surface: 'wire' })?.id).toBe('wireReadAloud')
    expect(matchFeature('where are the wire sections', { surface: 'charts', createIndicator: true })).toBeNull()
  })
})

describe('supported actions and navigation', () => {
  it('wire.page says the date and the section names, and a query leaves no receipt', async () => {
    const { host } = makePage()
    askPage(host)
    await screen.findByText(/This page shows the Morning Wire of 2026-11-05\. Sections: The Tape, Macro, The Board\./)
    expect(screen.queryByTestId('agent-receipt')).toBeNull()
  })

  it('wire.archive: a held date, reading the index once', async () => {
    let reads = 0
    const { host } = makePage({}, async () => { reads += 1; return INDEX })
    askArchive(host, '2026-11-03')
    await screen.findByText(/The archive holds the wire of 2026-11-03\. Pick that date in Past issues/)
    expect(reads).toBe(1)
  })

  it('wire.archive: an absent date is an absence, never a neighbour', async () => {
    const { host } = makePage()
    askArchive(host, '2026-11-02')
    await screen.findByText(/No wire in the archive for 2026-11-02\. The archive runs 2026-10-30 to 2026-11-04\./)
  })

  it('wire.archive: a weekend says so; no date gives the coverage with its gaps', async () => {
    const { host } = makePage()
    askArchive(host, '2026-11-01')
    await screen.findByText(/No wire in the archive for 2026-11-01\. That date is a weekend\./)
    turns.push((body) => env('apply', [archiveOp(body, null)]))
    type('how far back does the archive go?')
    await screen.findByText(/The archive holds 3 of 4 weekdays, 2026-10-30 to 2026-11-04\. Not held: 2026-11-02\./)
  })

  it('an empty archive is said plainly', async () => {
    const { host } = makePage({}, async () => ({ dates: [], coverage: { held: 0 } }))
    askArchive(host, null)
    await screen.findByText('No past issues are archived yet.')
  })

  it('NAVIGATION: "open breadth" leaves through the provider\'s navigate; "open morning wire" here goes nowhere', async () => {
    const { host, nav } = makePage()
    mount(host)
    type('open breadth')
    await waitFor(() => expect(nav).toEqual(['/breadth']))
    cleanup()
    const here = makePage()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, pathname: '/morning-wire' } })
    mount(here.host)
    type('open morning wire')
    await screen.findAllByText(/You are already on/)
    expect(here.nav).toEqual([])
  })

  it('EXPLAIN comes from the guide with no model call; SHOW highlights a real control and changes nothing', async () => {
    const { host } = makePage()
    controls(['wire.archive', 'wire.readAloud', 'wire.rundown'])
    mount(host)
    type('what is the wire archive?')
    await screen.findAllByText(/Past issues replays an archived Morning Wire/)
    type('where are the past issues?')
    await waitFor(() => expect(screen.queryByTestId('guide-text')?.textContent || '').toMatch(/Past issues is here/))
    type('do it for me')
    await screen.findAllByText(/Replaying it is yours: pick the date in Past issues/)
    expect(screen.queryByTestId('agent-receipt')).toBeNull()
    expect(turnBodies).toHaveLength(0)
  })

  it('SHOW says so when the control is not on screen', async () => {
    const { host } = makePage()
    mount(host)
    type('where is the read aloud button?')
    await screen.findAllByText(/can’t see/)
    expect(screen.queryByTestId('guide-card')).toBeNull()
  })
})

describe('conversational follow-ups', () => {
  it('the page entry survives into the next turn: a date, then another date, then the page', async () => {
    const { host } = makePage()
    askArchive(host, '2026-11-03')
    await screen.findByText(/The archive holds the wire of 2026-11-03/)
    turns.push((body) => env('apply', [archiveOp(body, '2026-11-02')]))
    type('and the day before?')
    await screen.findByText(/No wire in the archive for 2026-11-02/)
    turns.push((body) => env('apply', [pageOp(body)]))
    type('ok and what is on the page again?')
    await screen.findByText(/Sections: The Tape, Macro, The Board/)
    expect(turnBodies).toHaveLength(3)
    expect(turnBodies[2].context.wirePage[0].date).toBe('2026-11-05')
  })

  it('a new wire landing between turns is what the next turn reads', async () => {
    const { page, host } = makePage()
    askPage(host)
    await screen.findByText(/Morning Wire of 2026-11-05/)
    page.date = '2026-11-06'
    page.sections = ['Macro']
    turns.push((body) => env('apply', [pageOp(body)]))
    type('and now?')
    await screen.findByText(/Morning Wire of 2026-11-06\. Sections: Macro\./)
  })

  it('a follow-up after a decline still answers the page', async () => {
    const { host } = makePage()
    mount(host)
    type('can you summarise the wire?')
    await screen.findAllByText(FIXED)
    turns.push((body) => env('apply', [pageOp(body)]))
    type('ok what date is it then?')
    await screen.findByText(/Morning Wire of 2026-11-05/)
  })
})

describe('error handling', () => {
  const fail = (status) => async () => { throw Object.assign(new Error('x'), { status }) }

  it.each([
    ['error', /could not be read right now/],
    ['notOut', /not out yet\. It publishes each trading morning around 7:35 AM ET/],
    ['loading', /still loading/],
  ])('page status %s is said, never a stale claim', async (status, re) => {
    const { host } = makePage({ status, sections: [], date: null })
    askPage(host)
    await screen.findByText(re)
  })

  it('a 402 is the paid plan; a 500 is a failed read, never "not held"', async () => {
    askArchive(makePage({}, fail(402)).host, '2026-11-03')
    await screen.findByText('Past issues are part of the paid plan.')
    cleanup()
    askArchive(makePage({}, fail(500)).host, '2026-11-03')
    await screen.findByText(/The archive could not be read right now\. That says nothing about which dates it holds\./)
  })

  it('a date that cannot be read is asked back before any read', async () => {
    let reads = 0
    askArchive(makePage({}, async () => { reads += 1; return INDEX }).host, 'someday')
    await screen.findByText(/I couldn’t read “someday” as a date/)
    expect(reads).toBe(0)
  })

  it('a malformed index does not crash and claims nothing', async () => {
    askArchive(makePage({}, async () => ({ nonsense: true })).host, null)
    await screen.findByText('No past issues are archived yet.')
  })

  it('describing no host, and a wire with no date, stay honest', () => {
    expect(describeWirePage(null)).toMatch(/not available here/)
    expect(describeWirePage({ status: 'ready', date: null, sections: [], unnamed: 2 })).toMatch(/\(no date on it\)\. 2 sections I can’t name\./)
  })
})

describe('no accidental workspace changes', () => {
  it('reads write nothing: no receipt, no Undo, no POST except the Agent\'s own turn and record, no feedback', async () => {
    const { host, nav } = makePage()
    askPage(host)
    await screen.findByText(/Morning Wire of 2026-11-05/)
    turns.push((body) => env('apply', [archiveOp(body, '2026-11-03')]))
    type('do you hold the third?')
    await screen.findByText(/The archive holds the wire of 2026-11-03/)
    expect(screen.queryByTestId('agent-receipt')).toBeNull()
    expect(screen.queryByTestId('agent-proposal')).toBeNull()
    expect(nav).toEqual([])
    const writes = fetched.filter(l => !l.startsWith('GET ')).filter(l => !/\/api\/agent\/(turn|record)/.test(l))
    expect(writes).toEqual([])
    expect(fetched.some(l => /wire-feedback/.test(l))).toBe(false)
  })

  it('the kind commits nothing and every wire capability is a query', async () => {
    for (const n of allCapabilityNames().filter(x => x.startsWith('wire.'))) {
      const c = getCapability(n)
      expect(c.query, n).toBe(true)
      expect(c.apply, n).toBeUndefined()
      expect(c.surfaces, n).toEqual(['wire'])
    }
  })

  it('the fast path claims no chart phrase here', () => {
    const { host } = makePage()
    expect(fastParse('switch to weekly', { host })).toBeNull()
  })
})

describe('restricted and unavailable', () => {
  it('wire.picks and any wire write do not exist', () => {
    expect(allCapabilityNames().filter(n => n.startsWith('wire.')).sort()).toEqual(['wire.archive', 'wire.page'])
  })

  it('a model that plans wire.picks is refused and nothing is read', async () => {
    const { host } = makePage()
    mount(host)
    turns.push((body) => env('apply', [{ action: 'wire.picks', target: body.context.wirePage[0].ref, args: {} }]))
    type('what are the top picks?')
    await screen.findAllByText(/can't|can’t/)
    expect(fetched.some(l => /\/api\/(rundown|wire)/.test(l))).toBe(false)
  })

  it.each([
    'can you summarise the wire?', 'could you summarize the morning wire', 'can you give me a recap of the wire',
    'can you read me the wire', 'can you quote the rundown', 'can you tell me what the wire says',
    'can you list the picks from the morning wire', 'can you give me the tickers in the wire',
  ])('"%s" declines in the fixed words with no model call', async (q) => {
    expect(fastDiscovery(q)).toEqual({ topic: 'wireText' })
    const { host } = makePage()
    mount(host)
    type(q)
    await screen.findAllByText(FIXED)
    expect(turnBodies).toHaveLength(0)
  })

  it('a bare "summarise the wire" goes to the model with the rule; its planned decline is the same fixed words', async () => {
    const { host } = makePage()
    mount(host)
    turns.push((body) => env('apply', [{ action: 'agent.capabilities', target: body.context.agent[0].ref, args: { topic: 'wireText' } }]))
    type('Summarise the wire')
    await screen.findAllByText(FIXED)
    expect(turnBodies[0].capabilities.find(c => c.name === 'wire.page').hints).toMatch(/topic wireText/)
    expect(turnBodies[0].capabilities.find(c => c.name === 'agent.capabilities').args.properties.topic.enum).toContain('wireText')
  })

  it('discovery is honest about the page, and neighbouring questions keep their topics', () => {
    expect(answerFor('wire').text).toMatch(/^Partly\..*date and section names/s)
    expect(answerFor('wire').text).toMatch(/Past issues/)
    expect(FIXED).toMatch(/^I can’t summarise, quote or list anything from the Morning Wire/)
    expect(matchTopic('what can you do with the wire')?.id).toBe('wire')
    expect(matchTopic('news on nvda')?.id).toBe('stockInfo')
    expect(matchTopic('read my notes')?.id).toBe('journal')
    expect(fastDiscovery('can you check whether the archive holds a past wire')).toBeNull()
  })

  it('a section heading that is not a short name is not handed over', () => {
    for (const ok of ['The Tape', 'THE MARKET', 'Today’s Focus', 'Leadership 20', 'Top 5']) expect(wireSectionName(ok), ok).toBe(ok)
    for (const no of ['Index reclaimed 5800 on heavy volume', 'SPX: holding the level', 'Up 2.5%', '$AAPL', 'a b c d e f g', '', null, 'x'.repeat(50)]) expect(wireSectionName(no), String(no)).toBeNull()
    const { host } = makePage({ sections: ['Macro', 'Index reclaimed 5800 on heavy volume'] })
    expect(host.wirePage.snapshot()).toMatchObject({ sections: ['Macro'], unnamed: 1 })
  })
})

describe('the real page', () => {
  const HTML = `<div class="rd-sections">
    <section class="rd-seg" data-seg="tape"><div class="rd-seg-label">The Tape</div><p>${SECRET} body</p></section>
    <section class="rd-seg" data-seg="macro"><div class="rd-seg-label">${SECRET} a heading that runs on as a whole sentence with a level 5800</div><p>${SECRET}</p></section>
    <section class="rd-seg" data-seg="board"><div class="rd-seg-label">The Board</div><div class="pick">${SECRET} NVDA</div></section>
  </div>`
  function wrapped(children, { allowed = true } = {}) {
    const registered = []
    const app = { allowed, registerPage: (r) => { registered.push(r); return () => {} }, navigate: () => {} }
    return { registered, tree: <AgentContext.Provider value={app}>{children}</AgentContext.Provider> }
  }

  it('⛔ registers the wire surface; a whole turn carries the names and not one word of the wire', async () => {
    rundownState = { data: { html: HTML, date: '2026-11-05' }, error: undefined }
    const { registered, tree } = wrapped(<MorningWire />)
    const view = renderWithProviders(tree)
    await waitFor(() => expect(registered.length).toBe(1))
    const { surface, host, owned } = registered[0]
    expect([surface, owned]).toEqual(['wire', false])
    await waitFor(() => expect(host.wirePage.snapshot().status).toBe('ready'))
    const snap = host.wirePage.snapshot()
    expect(snap).toEqual({ date: '2026-11-05', status: 'ready', sections: ['The Tape', 'The Board'], unnamed: 1 })
    expect(JSON.stringify(snap)).not.toContain(SECRET)
    expect(Object.keys(host.wirePage).sort()).toEqual(['archive', 'snapshot'])

    render(<AgentPanel host={host} surface="wire" onClose={() => {}} />)
    turns.push((body) => env('apply', [pageOp(body)]))
    type('what does this page show?')
    await screen.findByText(/Sections: The Tape, The Board\. Plus 1 section I can’t name/)
    expect(JSON.stringify(turnBodies)).not.toContain(SECRET)
    const recorded = globalThis.fetch.mock.calls.filter(([u]) => u === '/api/agent/record').map(([, i]) => i.body).join('')
    expect(recorded).not.toContain(SECRET)
    view.unmount()
  })

  it('reads the archive through the index and never fetches an issue', async () => {
    rundownState = { data: { html: HTML, date: '2026-11-05' }, error: undefined }
    const { registered, tree } = wrapped(<MorningWire />)
    renderWithProviders(tree)
    await waitFor(() => expect(registered.length).toBe(1))
    globalThis.fetch.mockImplementation(async (url) => { fetched.push(`GET ${url}`); return new Response(JSON.stringify(INDEX), { status: 200 }) })
    await expect(registered[0].host.wirePage.archive()).resolves.toMatchObject({ held: 3 })
    expect(fetched).toContain('GET /api/wire/archive')
    expect(fetched.some(l => /\/api\/wire\/archive\/\d/.test(l))).toBe(false)
  })

  it('page states reach the host', async () => {
    rundownState = { data: undefined, error: Object.assign(new Error('x'), { status: 503 }) }
    const { registered, tree } = wrapped(<MorningWire />)
    renderWithProviders(tree)
    await waitFor(() => expect(registered.length).toBe(1))
    await waitFor(() => expect(registered[0].host.wirePage.snapshot().status).toBe('error'))
  })

  it('⛔ no host inside a UCT Terminal panel', async () => {
    rundownState = { data: { html: HTML, date: '2026-11-05' }, error: undefined }
    const { registered, tree } = wrapped(
      <TerminalPanelContext.Provider value={{ code: 'WIRE', density: 'comfortable', inset: true }}><MorningWire /></TerminalPanelContext.Provider>,
    )
    renderWithProviders(tree)
    await screen.findByText('The Tape')
    expect(registered).toEqual([])
  })

  it('member gating is the provider\'s, unchanged: not allowed registers nothing', async () => {
    rundownState = { data: { html: HTML, date: '2026-11-05' }, error: undefined }
    const { registered, tree } = wrapped(<MorningWire />, { allowed: false })
    renderWithProviders(tree)
    await screen.findByText('The Tape')
    expect(registered).toEqual([])
  })

  it('outside a provider the page renders as before', async () => {
    rundownState = { data: { html: HTML, date: '2026-11-05' }, error: undefined }
    renderWithProviders(<MorningWire />)
    await screen.findByText('The Tape')
  })
})
