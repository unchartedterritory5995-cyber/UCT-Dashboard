// fix-nothing-on-workspace — a single-kind request that finds no target says WHY, truthfully, per host kind.
//
// Before: the single-kind ops branch of useAgent replied "There is nothing on this workspace for that to change." whenever
// the kind's list was empty. On a host that does not PROVIDE that kind's source (a page host registered through
// AgentProvider has no layouts, charts, widgets…; a host built without a navigator cannot open pages) that sentence is
// false: the workspace is not empty, the capability is just not offered on this page. Now (capabilities.noTargetSentence):
//   • no source on this host → "<Kind> aren't available on this page — open … " (a refusal; nothing runs)
//   • source there, list empty → the kind's own words ("There are no charts on this board yet.")
// Host kinds covered: the /charts workspace host (makeBoard, the ChartsWorkspace shape) with and without its layouts source,
// and every AgentProvider page host (screener, breadth, calendar, journal — hosts/pageHosts.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

import AgentPanel from './AgentPanel'
import { registerBuiltins } from './builtins'
import { allCapabilityNames, getCapability, getTargetKind, noTargetSentence } from './capabilities'
import { makeBoard } from './__fixtures__/board'
import { buildScreenerPageHost, buildBreadthPageHost, buildCalendarPageHost, buildJournalPageHost } from './hosts/pageHosts'

registerBuiltins()

const OLD = 'nothing on this workspace'
const CHART = { id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 }
const LAYOUTS = { entries: [{ id: 11, name: 'Agent Test', scope: 'user' }], boards: { 11: [CHART] }, active: 11 }

// Every AgentProvider page host, built the way usePageAgentHosts builds it (no navigator: a page that cannot open others)
const PAGE_HOSTS = {
  screener: () => buildScreenerPageHost({ read: () => ({ current: null, rows: [] }), saved: () => ({ saved: [], prebuilt: [] }), applyScreen: () => {}, refreshSaved: () => {}, location: () => '/screener' }),
  breadth: () => buildBreadthPageHost({ read: () => ({ tab: 'breadth', days: 90, rowCount: 0, columns: [] }), location: () => '/breadth' }),
  calendar: () => buildCalendarPageHost({ read: () => ({ days: [] }), location: () => '/calendar' }),
  journal: () => buildJournalPageHost({ notes: () => [], refresh: () => {}, location: () => '/journal' }),
}

const kinds = () => [...new Set(allCapabilityNames().map(n => getCapability(n)?.target).filter(Boolean))].map(getTargetKind).filter(Boolean)
const empty = (k, host) => { try { return (k.list(host) || []).length === 0 } catch { return true } }

let turnBodies
beforeEach(() => {
  turnBodies = []
  try { localStorage.clear() } catch { /* */ }
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = vi.fn(async (url, init) => {
    if (url === '/api/agent/turn') { turnBodies.push(init?.body ? JSON.parse(init.body) : null); return json({ conversationId: 'ac_1', turnId: 1, envelope: { disposition: 'answer', reply: 'ok', question: null, ops: [], unsupported_category: null }, usage: { citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    return json({})
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('a missing host source is "not available on this page", never "nothing on this workspace" (generic)', () => {
  it('every target kind that a page host does not provide declares its source and says it is unavailable here', () => {
    for (const [surface, make] of Object.entries(PAGE_HOSTS)) {
      const host = make()
      for (const k of kinds()) {
        if (!empty(k, host)) continue
        const why = noTargetSentence(k, host)
        // a kind with no target on a page host either names its source (→ unavailable) or has its own empty words
        expect(k.source || k.empty, `${surface}: kind ${k.name} has no source and no empty words`).toBeTruthy()
        if (k.source) {
          expect(why.missing, `${surface}: ${k.name}`).toBe(true)
          expect(why.text, `${surface}: ${k.name}`).toMatch(/(?:aren't|isn't) available (?:on this page|here)/)
        }
        expect(why.text, `${surface}: ${k.name}`).not.toContain(OLD)
      }
    }
  })

  it('page hosts: layouts, charts, widgets, drawings and watchlists each say THIS page does not offer them', () => {
    for (const [surface, make] of Object.entries(PAGE_HOSTS)) {
      const host = make()
      for (const [name, re] of [['layouts', /^Layouts aren't available on this page — open Charts/], ['chart', /^Charts aren't available on this page — open Charts/],
        ['workspace', /^Board widgets aren't available on this page/], ['drawing', /^Drawings aren't available on this page/], ['watchlist', /^Watchlists aren't available on this page/]]) {
        const why = noTargetSentence(getTargetKind(name), host)
        expect(why.missing, `${surface}/${name}`).toBe(true)
        expect(why.text, `${surface}/${name}`).toMatch(re)
      }
    }
  })

  it('the /charts host provides its sources: an empty list gets the kind-specific words, not "unavailable"', () => {
    const { host } = makeBoard([], { A: 'AAPL' }, { layouts: LAYOUTS })
    expect(noTargetSentence(getTargetKind('chart'), host)).toEqual({ missing: false, text: 'There are no charts on this board yet.' })
    expect(noTargetSentence(getTargetKind('layouts'), host).missing).toBe(false)
    expect(noTargetSentence(getTargetKind('workspace'), host).missing).toBe(false)
    expect(noTargetSentence(getTargetKind('alert'), host)).toEqual({ missing: false, text: 'You have no price alerts yet.' })
    expect(noTargetSentence(getTargetKind('watchlist'), { ...host, watchlists: { snapshot: () => [] } })).toEqual({ missing: false, text: 'You have no watchlists yet.' })
  })
})

describe('through the panel, per host kind (no model call, nothing runs)', () => {
  it('/charts host WITHOUT a layouts source: a layout request says layouts are not available here', async () => {
    const { host, state } = makeBoard([CHART])
    const before = JSON.stringify(state.widgets)
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('save this layout as Swing')
    const said = await screen.findByText(/Layouts aren't available on this page — open Charts to save or switch layouts\./)
    expect(said.textContent).not.toContain(OLD)
    expect(document.body.textContent).not.toContain(OLD)
    expect(turnBodies).toHaveLength(0)
    expect(JSON.stringify(state.widgets)).toBe(before)
  })

  it('/charts host with an EMPTY board (source there): a chart request says there are no charts yet', async () => {
    const { host } = makeBoard([], { A: 'AAPL' }, { layouts: LAYOUTS })
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('switch to weekly')
    await screen.findByText('There are no charts on this board yet.')
    expect(document.body.textContent).not.toContain(OLD)
    expect(document.body.textContent).not.toMatch(/available on this page/)
    expect(turnBodies).toHaveLength(0)
  })

  for (const surface of Object.keys(PAGE_HOSTS)) {
    it(`AgentProvider page host /${surface} without a navigator: "open a page" says it is not available here`, async () => {
      const host = PAGE_HOSTS[surface]()
      render(<AgentPanel host={host} surface={surface} onClose={() => {}} />)
      type('open the screener')
      await screen.findByText("Opening other pages isn't available here.")
      expect(document.body.textContent).not.toContain(OLD)
      expect(turnBodies).toHaveLength(0)
    })
  }
})
