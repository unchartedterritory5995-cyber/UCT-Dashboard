// RS screens, unit U11: UCT Agent opens the five Relative Strength screens on the Screener page, by name, by the
// words a member already calls them ("RSNHBP", "blue dot") and with a quick choice named in the same breath
// ("open RS New Highs for today", "the leaders near a buy point").
//
// NOTHING ABOUT A SCREEN IS TYPED IN THE AGENT. The names, the search words and every quick choice are read
// from the starters payload the page itself opens them from (`controls`, `aliases`: CONTRACT-SCREENS.md), so the
// tests below WALK that payload: every screen, every search word, every option of every control. The starters
// are the ones the SERVER serves (rsScreensFixture reads the server suite's goldens).
//
// What this file has to be able to say red for: a screen or a search word that does not open its screen; a choice
// that opens the wrong option, or a guess when the words name none; a hidden starter offered; a choice dropped
// in silence on a layout that has no quick controls; a screen's controls or search words reaching the model's
// context (the Agent's budget); an old op without `choose` no longer validating.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

import AgentPanel from './AgentPanel'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability, shapeError } from './capabilities'
import { _resetScreenerCache } from './capabilities/screener'
import { screenerPageKind } from './capabilities/screenerPage'
import { buildScreenerPageHost } from './hosts/pageHosts'
import { _resetGuide } from './guide/guideStore'
import { offeredStarters } from '../pages/screener/focus/screenGroups'
import { controlsOf, choicesNamed, choiceWords, offeredChoices, specWithChoices } from '../pages/screener/focus/rsScreens'
import { STARTERS_ON, HIDDEN_STARTERS, PLAIN_STARTERS, RS_STARTERS, NEW_HIGHS, LEADERS, BEFORE_PRICE } from '../pages/screener/focus/__tests__/rsScreensFixture'

registerBuiltins()

const MINE = [{ id: 7, name: 'Momentum', spec: { filters: [{ key: 'price', op: 'gte', min: 10 }] } }]
const HIDDEN_NAMES = HIDDEN_STARTERS.map(s => s.name)
// Every option of every control of every RS screen that is not how the screen opens.
const CHOICES = RS_STARTERS.flatMap(st => controlsOf(st).flatMap(control => control.options.filter(o => !o.default).map(option => ({ st, control, option }))))
// Every search word the payload serves, with its screen.
const ALIASES = STARTERS_ON.flatMap(st => (st.aliases || []).map(alias => ({ st, alias })))

let turns
let turnBodies
beforeEach(() => {
  _resetScreenerCache()
  _resetGuide()
  turns = []
  turnBodies = []
  try { localStorage.clear() } catch { /* */ }
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const body = init?.body ? JSON.parse(init.body) : null
    if (u === '/api/agent/turn') { turnBodies.push(body); const next = turns.shift(); return json({ conversationId: 'ac_1', turnId: 1, envelope: typeof next === 'function' ? next(body) : next, usage: { citations: [] } }) }
    if (u === '/api/screener/fields') return json({ fields: [{ key: 'price', label: 'Price', type: 'range', unit: '$' }] })
    if (u.startsWith('/api/screener/saved-screens')) return json({ saved: MINE, starters: STARTERS_ON })
    if (u === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (u.startsWith('/api/agent/conversations')) return json({ conversations: [] })
    return json({})
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); _resetGuide() })

// The page as the Agent sees it. `quick`: the layout lays a named choice over the screen (the Focus layout);
// false is the Table layout, which has no quick controls.
function pageHost({ current = { id: 7, name: 'Momentum', kind: 'saved' }, quick = true, starters = STARTERS_ON } = {}) {
  const page = { current, applied: [] }
  const host = buildScreenerPageHost({
    read: () => ({ rows: [{ ticker: 'AAA' }], total: 1, current: page.current, filters: ['price'], edited: false }),
    saved: () => ({ saved: MINE, starters }),
    applyScreen: (spec, item) => { page.applied.push(item); page.current = { id: item.id, name: item.name, kind: item.kind } },
    ...(quick ? { quickChoices: () => true } : {}),
    location: () => '/screener',
    navigate: () => {},
  })
  return { page, host }
}
const pageTarget = host => screenerPageKind.read(host, 'screenerPage')
const cap = () => getCapability('screener.openSaved')
const fast = (host, raw) => cap().fast({ raw, lower: raw.toLowerCase(), host })
const START = { open: '7', name: 'Momentum', kind: 'saved', spec: null, pick: null }
const picked = (host, args, st = START) => cap().apply(st, args, { target: pageTarget(host) }).pick
const env = (disposition, ops = [], reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}
const mount = (host) => render(<AgentPanel host={host} surface="screener" onClose={() => {}} />)

describe('the payload this is read on', () => {
  it('serves five RS screens with quick controls, search words on one of them, and seven hidden starters', () => {
    expect(RS_STARTERS).toHaveLength(5)
    for (const st of RS_STARTERS) expect(controlsOf(st).length, st.id).toBeGreaterThan(0)
    expect(CHOICES.length).toBeGreaterThan(20)
    expect(ALIASES.length).toBeGreaterThan(1)
    expect(ALIASES.map(a => a.alias)).toContain('RSNHBP')
    expect(HIDDEN_STARTERS).toHaveLength(7)
    for (const st of PLAIN_STARTERS) expect(st.controls, st.id).toBeUndefined()
  })
})

describe('the five are opened by name and by the words members already use', () => {
  it.each(RS_STARTERS.map(st => [st.name, st]))('"open %s" opens it as it is, with no model call', (_name, st) => {
    const { host } = pageHost()
    for (const raw of [`open ${st.name}`, `open the ${st.name} screen`, `switch to ${st.name.toLowerCase()}`, `load ${st.name} on this page.`]) {
      expect(fast(host, raw), raw).toEqual({ screen: st.id, choose: null, __target: 'screenerPage', __explicit: true })
    }
    expect(cap().check(START, { screen: st.id, choose: null }, { target: pageTarget(host) })).toBeNull()
    const pick = picked(host, { screen: st.id, choose: null })
    expect(pick).toEqual({ id: st.id, name: st.name, kind: 'starter', spec: st.spec })
    expect('choices' in pick).toBe(false)
  })

  it.each(ALIASES.map(a => [a.alias, a]))('the search word "%s" opens its screen', (_alias, { st, alias }) => {
    const { host } = pageHost()
    for (const raw of [`open ${alias}`, `open the ${alias.toLowerCase()} screen`, `switch to ${alias.toUpperCase()}`]) {
      expect(fast(host, raw), raw).toMatchObject({ screen: st.id, choose: null })
    }
    // the model may hand the member's word on as the screen
    expect(cap().check(START, { screen: alias, choose: null }, { target: pageTarget(host) })).toBeNull()
    expect(picked(host, { screen: alias.toLowerCase(), choose: null })).toMatchObject({ id: st.id, name: st.name })
  })

  it('typed in the panel: the screen opens through the page\'s own door, receipts, and Undo puts the last screen back', async () => {
    const { page, host } = pageHost()
    mount(host)
    type('open RSNHBP')
    const receipt = await screen.findByTestId('agent-receipt')
    expect(receipt.textContent).toContain(`Opened “${BEFORE_PRICE.name}” on the Screener page (was “Momentum”)`)
    expect(page.applied).toEqual([{ id: BEFORE_PRICE.id, name: BEFORE_PRICE.name, kind: 'starter', spec: BEFORE_PRICE.spec }])
    expect(turnBodies).toHaveLength(0)
    type('undo that')
    await screen.findByText(new RegExp(`Undid: Opened “${BEFORE_PRICE.name}”`))
    expect(page.applied.map(i => String(i.id))).toEqual([BEFORE_PRICE.id, '7'])
  })

  it('a hidden starter is never offered, and no search word belongs to one', () => {
    const { host } = pageHost()
    const said = cap().check(START, { screen: 'Zebra crossing', choose: null }, { target: pageTarget(host) })
    expect(said).toContain('I couldn\'t find a saved screen called “Zebra crossing”')
    for (const n of HIDDEN_NAMES) expect(said, n).not.toContain(n)
    // the sentence lists at most twelve: the member's own, then the offered starters in the payload's order
    const offered = ['Momentum', ...offeredStarters(STARTERS_ON).map(s => s.name)]
    expect(said).toContain(`(your screens: ${offered.slice(0, 12).join(', ')})`)
    for (const st of RS_STARTERS) expect(offered, st.name).toContain(st.name)
    for (const { st } of ALIASES) expect(st.hidden, st.id).toBeUndefined()
    // a hidden starter the member names exactly still opens (unit U7), and it has no quick choices to set
    const gone = HIDDEN_STARTERS[0]
    expect(picked(host, { screen: gone.name, choose: null })).toMatchObject({ id: gone.id })
  })
})

describe('a quick choice named with the open is the screen\'s own option', () => {
  it.each(CHOICES.map(c => [`${c.st.name} / ${c.control.label}: ${c.option.label}`, c]))('%s', (_id, { st, control, option }) => {
    const { host } = pageHost()
    // one breath, no model: the screen's name, then the option's own label
    for (const raw of [`open ${st.name} ${option.label}`, `open ${st.name} for ${option.label.toLowerCase()}`, `switch to the ${st.name} with ${option.label} on this page`]) {
      const op = fast(host, raw)
      expect(op, raw).toMatchObject({ screen: st.id })
      expect(picked(host, op).choices, raw).toEqual({ [control.id]: option.id })
    }
    // the model's op: the screen's id and the member's words, by label, by id, or naming the control
    for (const choose of [option.label, option.label.toUpperCase(), option.id, `${control.label} = ${option.label}`, `${control.id}=${option.id}`]) {
      expect(cap().check(START, { screen: st.id, choose }, { target: pageTarget(host) }), choose).toBeNull()
      const pick = picked(host, { screen: st.id, choose })
      expect(pick, choose).toEqual({ id: st.id, name: st.name, kind: 'starter', spec: st.spec, choices: { [control.id]: option.id }, chose: [option.label] })
    }
    // what the page lays over the screen is that option's own clauses (the contract's control semantics)
    const spec = specWithChoices(st.spec, st, { [control.id]: option.id })
    const onKeys = f => control.keys.includes(f.key)
    expect(spec.filters.filter(onKeys)).toEqual(option.filters)
    expect(spec.filters.filter(f => !onKeys(f))).toEqual(st.spec.filters.filter(f => !onKeys(f)))
    if (option.sort) expect(spec.sort).toEqual(option.sort)
  })

  it('typed in the panel: "open RS New Highs for today" opens it set to Today, with no model call', async () => {
    const { page, host } = pageHost()
    mount(host)
    type('open RS New Highs for today')
    const receipt = await screen.findByTestId('agent-receipt')
    expect(receipt.textContent).toContain(`Opened “${NEW_HIGHS.name}” on the Screener page, set to Today (was “Momentum”)`)
    expect(page.applied).toEqual([{ id: NEW_HIGHS.id, name: NEW_HIGHS.name, kind: 'starter', spec: NEW_HIGHS.spec, choices: { when: 'today' } }])
    expect(turnBodies).toHaveLength(0)
    type('undo that')
    await screen.findByText(new RegExp(`Undid: Opened “${NEW_HIGHS.name}”`))
    expect(page.applied.at(-1)).toMatchObject({ id: '7' })
    expect('choices' in page.applied.at(-1)).toBe(false)
  })

  it('through the model: "the leaders near a buy point" opens UCT RS Leaders with that choice', async () => {
    const { page, host } = pageHost()
    mount(host)
    turns.push((body) => env('apply', [{ action: 'screener.openSaved', target: body.context.screenerPage[0].ref, args: { screen: LEADERS.id, choose: 'near a buy point' } }]))
    type('put up the leaders that are near a buy point')
    const receipt = await screen.findByTestId('agent-receipt')
    expect(receipt.textContent).toContain(`Opened “${LEADERS.name}” on the Screener page, set to Near a buy point (was “Momentum”)`)
    expect(page.applied).toEqual([{ id: LEADERS.id, name: LEADERS.name, kind: 'starter', spec: LEADERS.spec, choices: { show: 'near' } }])
    expect(turnBodies).toHaveLength(1)
  })

  it('two choices at once, and a label that holds an "and" of its own', () => {
    const { host } = pageHost()
    expect(picked(host, { screen: NEW_HIGHS.id, choose: 'today and 90' })).toMatchObject({ choices: { when: 'today', min: 'r90' }, chose: ['Today', '90'] })
    expect(picked(host, { screen: NEW_HIGHS.id, choose: 'This month, Down days only' }).choices).toEqual({ when: 'month', down: 'down' })
    const top = RS_STARTERS.find(s => controlsOf(s).some(c => c.options.some(o => / and /.test(o.label))))
    const control = controlsOf(top).find(c => c.options.some(o => / and /.test(o.label)))
    const option = control.options.find(o => / and /.test(o.label))
    expect(choicesNamed(top, option.label)).toEqual({ choices: { [control.id]: option.id }, labels: [option.label], problems: [] })
    expect(fast(host, 'open RS New Highs today and 90')).toMatchObject({ screen: NEW_HIGHS.id, choose: 'today and 90' })
  })

  it('the screen already open, asked with a choice, is a change; asked without one it is not', () => {
    const { host } = pageHost({ current: { id: NEW_HIGHS.id, name: NEW_HIGHS.name, kind: 'starter' } })
    const st = screenerPageKind.stateOf(pageTarget(host))
    const same = cap().apply(st, { screen: NEW_HIGHS.id, choose: null }, { target: pageTarget(host) })
    expect(same).toBe(st)
    expect(screenerPageKind.patch(st, same)).toBeNull()
    const set = cap().apply(st, { screen: NEW_HIGHS.id, choose: 'today' }, { target: pageTarget(host) })
    expect(screenerPageKind.patch(st, set)).toMatchObject({ open: { id: NEW_HIGHS.id, choices: { when: 'today' } }, from: { id: NEW_HIGHS.id } })
    expect(cap().describe(st, set)).toBe(`Opened “${NEW_HIGHS.name}” on the Screener page, set to Today`)
  })
})

describe('words that name no choice are refused, never guessed', () => {
  it('the refusal lists the screen\'s own choices, and nothing is opened', async () => {
    const { page, host } = pageHost()
    for (const choose of ['tomorrow', 'when = tomorrow', 'colour = today', 'today and tomorrow']) {
      const said = cap().check(START, { screen: NEW_HIGHS.id, choose }, { target: pageTarget(host) })
      expect(said, choose).toContain(`“${NEW_HIGHS.name}” has no choice called “`)
      for (const line of choiceWords(NEW_HIGHS)) expect(said, line).toContain(line)
      expect(cap().apply(START, { screen: NEW_HIGHS.id, choose }, { target: pageTarget(host) })).toBe(START)
    }
    expect(cap().check(START, { screen: NEW_HIGHS.id, choose: 'tomorrow' }, { target: pageTarget(host) })).toContain('called “tomorrow”')
    // the fast path claims nothing it cannot resolve whole: these go to the model, which sees the real names
    for (const raw of ['open RS New Highs tomorrow', 'open RS New Highs today and tomorrow', 'open the new highs today', 'open Momentum today']) expect(fast(host, raw), raw).toBeNull()
    mount(host)
    turns.push((body) => env('apply', [{ action: 'screener.openSaved', target: body.context.screenerPage[0].ref, args: { screen: NEW_HIGHS.id, choose: 'tomorrow' } }]))
    type('open rs new highs for tomorrow please')
    await screen.findByText(/has no choice called “tomorrow” \(it offers When: Today, This week, This month, Weekly; /)
    expect(page.applied).toHaveLength(0)
  })

  it('a word two controls share must name its control', () => {
    const twin = { id: 'x', name: 'Twin', controls: [
      { id: 'a', label: 'First', keys: ['p'], options: [{ id: 'all', label: 'All', default: true, filters: [] }, { id: 'hi', label: 'High', filters: [] }] },
      { id: 'b', label: 'Second', keys: ['q'], options: [{ id: 'all', label: 'All', default: true, filters: [] }, { id: 'lo', label: 'Low', filters: [] }] }] }
    expect(choicesNamed(twin, 'all')).toEqual({ choices: {}, labels: [], problems: ['all'] })
    expect(choicesNamed(twin, 'second = all').choices).toEqual({ b: 'all' })
    expect(choicesNamed(twin, 'high; low').choices).toEqual({ a: 'hi', b: 'lo' })
    expect(choicesNamed(twin, '   ')).toEqual({ choices: {}, labels: [], problems: [] })
    expect(choicesNamed({ id: 'plain', name: 'Plain' }, 'today').problems).toEqual(['today'])
    expect(offeredChoices(twin, { a: 'hi', b: 'nope', c: 'x' })).toEqual({ a: 'hi' })
    expect(offeredChoices(twin, { b: 'nope' })).toBeNull()
    expect(offeredChoices(twin, null)).toBeNull()
  })

  it('a screen with no quick choices says so, for a starter and for the member\'s own screen', () => {
    const { host } = pageHost()
    const plain = PLAIN_STARTERS[0]
    for (const screenArg of [plain.id, '7']) {
      const said = cap().check(START, { screen: screenArg, choose: 'today' }, { target: pageTarget(host) })
      expect(said, screenArg).toContain('has no quick choices to set')
    }
    expect(fast(host, `open ${plain.name} today`)).toBeNull()
  })

  it('the Table layout has no quick controls: a choice there is refused, and a plain open still works', async () => {
    const { page, host } = pageHost({ quick: false })
    expect(pageTarget(host).canChoose).toBe(false)
    expect(fast(host, 'open RS New Highs today')).toBeNull()
    expect(fast(host, 'open RS New Highs')).toMatchObject({ screen: NEW_HIGHS.id, choose: null })
    expect(cap().check(START, { screen: NEW_HIGHS.id, choose: 'today' }, { target: pageTarget(host) })).toBe('The Table layout has no quick choices. Switch to List and ask again.')
    expect(cap().check(START, { screen: NEW_HIGHS.id, choose: null }, { target: pageTarget(host) })).toBeNull()
    // and the door itself refuses a choice it could only drop
    const patch = { open: { id: NEW_HIGHS.id, name: NEW_HIGHS.name, kind: 'starter', spec: NEW_HIGHS.spec, choices: { when: 'today' } }, from: { id: '7' } }
    await expect(screenerPageKind.commit(host, 'screenerPage', patch)).rejects.toThrow(/no quick choices/)
    expect(page.applied).toHaveLength(0)
    expect(pageTarget(pageHost().host).canChoose).toBe(true)
  })
})

describe('what the Agent is handed, and what the model is not', () => {
  it('the page host hands on search words and controls only for a starter that carries them', () => {
    const { host } = pageHost()
    const served = host.screenerPage.saved()
    const by = Object.fromEntries(served.starters.map(s => [s.id, s]))
    for (const st of RS_STARTERS) {
      expect(by[st.id].controls).toEqual(st.controls)
      expect(by[st.id].aliases).toEqual(st.aliases)
    }
    for (const st of PLAIN_STARTERS) expect(Object.keys(by[st.id])).toEqual(['id', 'name', 'kind', 'spec'])
    for (const s of served.saved) expect(Object.keys(s)).toEqual(['id', 'name', 'kind', 'spec'])
  })

  it('neither a search word nor a quick choice reaches the model\'s context', () => {
    const { host } = pageHost()
    const { context } = buildContext(host, { surface: 'screener', message: 'open the rs new highs screen for today' })
    expect(Object.keys(context.screenerPage[0]).sort()).toEqual(['canOpen', 'firstRows', 'label', 'matches', 'ref', 'screen'])
    const sent = JSON.stringify([context.screenerPage, context.screener, context.savedScreenLibrary])
    expect(sent).not.toContain('controls')
    expect(sent).not.toContain('aliases')
    for (const { alias, st } of ALIASES) if (alias.toLowerCase() !== st.name.toLowerCase()) expect(sent, alias).not.toContain(alias)
    for (const { control } of CHOICES) expect(sent, control.label).not.toContain(`"${control.label}"`)
  })

  it('an op from before `choose` existed still validates, and reads as no choice', async () => {
    expect(cap().args.required).toEqual(['screen', 'choose'])
    expect(cap().absentAsNull).toEqual(['choose'])
    expect(shapeError('screener.openSaved', { screen: NEW_HIGHS.id })).toBeNull()
    expect(shapeError('screener.openSaved', { screen: NEW_HIGHS.id, choose: null })).toBeNull()
    expect(shapeError('screener.openSaved', { screen: NEW_HIGHS.id, choose: 'today' })).toBeNull()
    expect(shapeError('screener.openSaved', { screen: NEW_HIGHS.id, choose: 3 })).not.toBeNull()
    const { page, host } = pageHost()
    mount(host)
    turns.push((body) => env('apply', [{ action: 'screener.openSaved', target: body.context.screenerPage[0].ref, args: { screen: NEW_HIGHS.id } }]))
    type('put the rs new highs list up here please')
    await screen.findByTestId('agent-receipt')
    await waitFor(() => expect(page.applied).toEqual([{ id: NEW_HIGHS.id, name: NEW_HIGHS.name, kind: 'starter', spec: NEW_HIGHS.spec }]))
  })

  it('no screen, control or option of the RS screens is typed in the Agent\'s code', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const here = path.dirname((await import('node:url')).fileURLToPath(import.meta.url))
    const code = file => fs.readFileSync(path.join(here, file), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    const cap = code('capabilities/screenerPage.js')
    const src = cap + code('hosts/pageHosts.js')
    for (const st of STARTERS_ON) expect(src, st.id).not.toContain(st.id)
    for (const st of RS_STARTERS) {
      expect(src, st.name).not.toContain(st.name)
      for (const control of controlsOf(st)) for (const option of control.options) {
        if (option.label.length > 3) expect(src, option.label).not.toContain(`'${option.label}'`)
        expect(cap, option.id).not.toMatch(new RegExp(`['"\`]${option.id}['"\`]`))
      }
    }
  })
})
