// RS screens, unit U7 (P3): starters the server retired from the picker (`hidden: true`, served only while
// RS_SCREENS_ENABLED is on) and the UCT Agent. The picker leaves a hidden starter out of its groups and its
// search and still opens one by id. The Agent follows the same rule: every list it SHOWS or OFFERS (the
// model's context, "list my screens", the "which screen?" choices, the names in a "couldn't find" sentence)
// leaves them out, through the picker's own helper (`offeredStarters`), and a hidden starter the member names
// exactly, or has open on the page, still resolves.
//
// The starters are the ones the SERVER serves (rsScreensFixture reads the server suite's goldens).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

import AgentPanel from './AgentPanel'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability } from './capabilities'
import { fastParse } from './fastPath'
import { _resetScreenerCache, loadSaved, loadMeta } from './capabilities/screener'
import { screenerPageKind } from './capabilities/screenerPage'
import { buildScreenerPageHost } from './hosts/pageHosts'
import { _resetGuide } from './guide/guideStore'
import { offeredStarters } from '../pages/screener/focus/screenGroups'
import { STARTERS_ON, HIDDEN_STARTERS, PLAIN_STARTERS, RS_STARTERS } from '../pages/screener/focus/__tests__/rsScreensFixture'

registerBuiltins()

const MINE = [{ id: 7, name: 'Momentum', spec: { filters: [{ key: 'price', op: 'gte', min: 10 }] } }]
const HIDDEN_NAMES = HIDDEN_STARTERS.map(s => s.name)
const OFFERED = offeredStarters(STARTERS_ON)
// One retired starter, named the way a member who used it would name it.
const QUICKSAND = HIDDEN_STARTERS.find(s => s.id === 'starter_rs_quicksand_5')
const none = (text, names = HIDDEN_NAMES) => { for (const n of names) expect(text, n).not.toContain(n) }

let starters
let scans
let restore = []
const BOX = { top: 40, left: 40, right: 160, bottom: 70, width: 120, height: 30, x: 40, y: 40 }
beforeEach(() => {
  _resetScreenerCache()
  _resetGuide()
  try { localStorage.clear() } catch { /* */ }
  starters = STARTERS_ON
  scans = []
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    if (u === '/api/screener/fields') return json({ fields: [{ key: 'price', label: 'Price', type: 'range', unit: '$' }] })
    if (u.startsWith('/api/screener/saved-screens')) return json({ saved: MINE, starters })
    if (u === '/api/screener/scan') { scans.push(JSON.parse(init.body)); return json({ total: 2, rows: [{ ticker: 'AAA' }, { ticker: 'BBB' }], snapshot_date: '2026-11-13' }) }
    if (u === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (u.startsWith('/api/agent/conversations')) return json({ conversations: [] })
    return json({})
  })
  // every element in the document has a box (jsdom lays nothing out; the guide needs one)
  const rects = Element.prototype.getClientRects
  const box = Element.prototype.getBoundingClientRect
  Element.prototype.getClientRects = function () { return this.isConnected ? [BOX] : [] }
  Element.prototype.getBoundingClientRect = function () { return this.isConnected ? { ...BOX, toJSON: () => BOX } : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  Element.prototype.scrollIntoView = function () {}
  restore = [() => { Element.prototype.getClientRects = rects; Element.prototype.getBoundingClientRect = box }]
})
afterEach(() => { restore.forEach(f => f()); cleanup(); vi.restoreAllMocks(); document.querySelectorAll('[data-fixture]').forEach(n => n.remove()); _resetGuide() })

function pageHost({ current = { id: 7, name: 'Momentum', kind: 'saved' } } = {}) {
  const page = { current, applied: [] }
  const host = buildScreenerPageHost({
    read: () => ({ rows: [{ ticker: 'AAA' }], total: 1, current: page.current, filters: ['price'], edited: false }),
    saved: () => ({ saved: MINE, starters }),
    applyScreen: (spec, item) => { page.applied.push(item.id); page.current = { id: item.id, name: item.name, kind: item.kind } },
    location: () => '/screener',
    navigate: () => {},
  })
  return { page, host }
}
const pageTarget = host => screenerPageKind.read(host, 'screenerPage')
const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('the payload this is read on', () => {
  it('serves seven hidden starters among the ones it offers, and the helper drops exactly those', () => {
    expect(HIDDEN_STARTERS).toHaveLength(7)
    expect(STARTERS_ON.filter(s => s.hidden).map(s => s.id).sort()).toEqual(HIDDEN_STARTERS.map(s => s.id).sort())
    expect(OFFERED.map(s => s.id)).toEqual([...PLAIN_STARTERS, ...RS_STARTERS].map(s => s.id))
    // no offered name is a hidden name, so "the sentence names no hidden starter" below can be read by name
    for (const s of OFFERED) expect(HIDDEN_NAMES).not.toContain(s.name)
  })
})

describe('what the Agent lists and offers leaves a hidden starter out', () => {
  it('"list my screens": the starters line is the offered ones', async () => {
    const said = await getCapability('screener.listSaved').answer()
    expect(said).toBe(`Your screens: Momentum\nUCT starters: ${OFFERED.map(s => s.name).join(', ')}`)
    none(said)
  })

  it('the model\'s context: no hidden id among savedScreens, and the library counts the offered ones', async () => {
    await loadMeta()
    await loadSaved()
    const { context } = buildContext({}, { surface: 'charts', message: 'run one of my saved screens' })
    const listed = context.screener[0].savedScreens
    expect(listed.map(s => s.id)).toEqual(['7', ...OFFERED.map(s => s.id)])
    expect(listed.filter(s => s.kind === 'starter')).toHaveLength(OFFERED.length)
    expect(context.savedScreenLibrary[0].starters).toBe(OFFERED.length)
    none(JSON.stringify(context.screener[0].savedScreens))
  })

  it('a name nothing matches: the sentence offers the real names, never a hidden one', async () => {
    // before the list has loaded the fast path carries the member's words; the answer resolves them
    const op = fastParse('run my zebra crossing screen').ops[0]
    expect(op.action).toBe('screener.runSaved')
    const said = await getCapability('screener.runSaved').answer(null, op.args)
    expect(said).toContain('I couldn\'t find one saved screen called “zebra crossing”')
    expect(said).toContain('Momentum')
    none(said)
  })

  it('on the page: "couldn\'t find" and "more than one" sentences list the offered names', () => {
    const { host } = pageHost()
    const cap = getCapability('screener.openSaved')
    const said = cap.check({ pick: null }, { screen: 'Zebra crossing' }, { target: pageTarget(host) })
    expect(said).toContain('I couldn\'t find a saved screen called “Zebra crossing”')
    expect(said).toContain('Momentum')
    none(said)
    // two of the member's own screens share a name: the list that asks which is the offered one too
    const twice = { ...pageTarget(host), saved: [{ id: 'a', name: 'Twin' }, { id: 'b', name: 'Twin' }] }
    const which = cap.check({ pick: null }, { screen: 'Twin' }, { target: twice })
    expect(which).toContain('more than one screen called “Twin”')
    none(which)
  })

  it('"do it for me" after the Screen menu walkthrough: the choices are offered screens only', async () => {
    const { host } = pageHost()
    const root = document.createElement('div')
    root.setAttribute('data-fixture', '')
    root.innerHTML = '<button data-guide="screener.screens">screener.screens</button>'
    document.body.appendChild(root)
    render(<AgentPanel host={host} surface="screener" onClose={() => {}} />)
    type('show me how to open a saved screen')
    await waitFor(() => expect(screen.queryByTestId('guide-text')?.textContent || '').toMatch(/This is the Screen menu/))
    type('now do it for me')
    await screen.findAllByText('Which screen?')
    // the list is short (eight at most): the member's own, then the first offered starters, in the payload's order.
    // A hidden starter in it would both show a retired screen and push an offered one off the end.
    const want = [...MINE, ...OFFERED].slice(0, 8).map(s => s.name)
    expect(want).toHaveLength(8)
    for (const n of want) expect(screen.getAllByRole('button', { name: n }).length, n).toBeGreaterThan(0)
    for (const n of HIDDEN_NAMES) expect(screen.queryAllByRole('button', { name: n }), n).toHaveLength(0)
  })
})

describe('a hidden starter the member names, or has open, still resolves', () => {
  it('the engine keeps it, marked, and an offered starter is the object it always was', async () => {
    const lib = await loadSaved()
    expect(lib.starters.map(s => s.id)).toEqual(STARTERS_ON.map(s => s.id))
    expect(lib.starters.filter(s => s.hidden).map(s => s.id)).toEqual(STARTERS_ON.filter(s => s.hidden).map(s => s.id))
    for (const s of lib.starters.filter(x => !x.hidden)) expect(Object.keys(s)).toEqual(['id', 'name', 'spec', 'kind'])
  })

  it('"run the <its exact name> screen" runs it, on its own filters', async () => {
    await loadSaved()
    const op = fastParse(`run the ${QUICKSAND.name} screen`).ops[0]
    expect(op).toEqual({ action: 'screener.runSaved', args: { screen: QUICKSAND.id, show: null, as: null } })
    await getCapability('screener.runSaved').answer(null, op.args)
    expect(scans).toHaveLength(1)
    expect(scans[0].filters).toEqual(QUICKSAND.spec.filters)
  })

  it('on the page: its id and its exact name both open it, and one that is open is the page\'s screen', () => {
    const { host } = pageHost()
    const cap = getCapability('screener.openSaved')
    const st = { open: '7', name: 'Momentum', pick: null }
    for (const screenArg of [QUICKSAND.id, QUICKSAND.name]) {
      expect(cap.check(st, { screen: screenArg }, { target: pageTarget(host) })).toBeNull()
      expect(cap.apply(st, { screen: screenArg }, { target: pageTarget(host) }).pick).toMatchObject({ id: QUICKSAND.id, name: QUICKSAND.name, kind: 'starter' })
    }
    // the page host hands the mark on, and adds nothing to a starter that is not hidden
    const served = host.screenerPage.saved().starters
    expect(served.filter(s => s.hidden).map(s => s.id)).toEqual(STARTERS_ON.filter(s => s.hidden).map(s => s.id))
    for (const s of served.filter(x => !x.hidden)) expect('hidden' in s).toBe(false)
    // a member who has it open (a pin, a last-used screen): the page says so by name
    const open = pageHost({ current: { id: QUICKSAND.id, name: QUICKSAND.name, kind: 'starter' } })
    expect(getCapability('screener.page').answer(pageTarget(open.host))).toContain(`The page shows ${QUICKSAND.name}`)
  })
})

describe('without hidden starters nothing changes', () => {
  it('a payload with none lists every starter, as before', async () => {
    starters = PLAIN_STARTERS
    const said = await getCapability('screener.listSaved').answer()
    expect(said).toBe(`Your screens: Momentum\nUCT starters: ${PLAIN_STARTERS.map(s => s.name).join(', ')}`)
    await loadMeta()
    const { context } = buildContext({}, { surface: 'charts', message: 'run one of my saved screens' })
    expect(context.screener[0].savedScreens.map(s => s.id)).toEqual(['7', ...PLAIN_STARTERS.map(s => s.id)])
    expect(context.savedScreenLibrary[0].starters).toBe(PLAIN_STARTERS.length)
  })
})
