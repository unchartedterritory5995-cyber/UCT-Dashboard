// AN OFFER IN THE DOCK — "Add the RS Rating" answered with one button that adds UCT's own
// built-in to the chart (`authoring/builtInOffer.js`). The door is scripted; the panel, the
// registry, the settings writer and the session store are real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { _resetSessions, createKey } from '../authoring/conversationSessions'
import { BUILT_IN_NAMES } from '../authoring/checkedLibrary'

// rsRating is `requiresServer`: offered only once the live server lists it. The switch below
// stands in for that answer, so both sides of rule 1 are exercised.
const H = vi.hoisted(() => ({ offered: true }))
vi.mock('../../engine/serverCompute', async (orig) => ({
  ...(await orig()),
  isDefinitionOffered: (def) => !!def && H.offered,
}))

import CreateIndicatorPanel from './CreateIndicatorPanel'

const SAID = 'RS Rating is one of UCT\'s own indicators, UCT RS Rating: the stock\'s RS Rating, 1 to 99, session by session on daily charts. It is not a formula to build here.'
const offerAnswer = async () => ({
  ok: true, disposition: 'answer', reply: SAID, turn: 'offer',
  envelope: { contract: 'uct.authoring.patch/1', baseRevision: 0, ops: [], disposition: 'answer', reply: SAID },
  offer: { kind: 'add_built_in', indicator: 'rsRating' }, notUnderstood: [], unavailable: [],
})

function mount({ key = createKey('s_offer'), converse = offerAnswer, settings = mergeChartSettings({}), writable = true } = {}) {
  const spy = vi.fn(converse)
  const writes = []
  const utils = render(
    <CreateIndicatorPanel settings={settings} onChange={writable ? (n) => writes.push(n) : null}
      sym="AAPL" tf="D" onPreview={() => {}} onClose={() => {}} converse={spy} sessionKey={key} />,
  )
  return { spy, writes, key, ...utils }
}

async function say(text) {
  fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
  await act(async () => {})
}
const offerButton = () => screen.queryByTestId('create-indicator-offer')
const lastUct = () => [...document.querySelectorAll('[data-role="uct"]')].at(-1)
const instancesOf = (cs, defId) => (cs.indicatorInstances || []).filter((i) => i.defId === defId)

beforeEach(() => { H.offered = true; _resetSessions() })
afterEach(() => { cleanup(); registry.clearUserDefinitions() })

describe('an answer that offers to add one of UCT\'s own built-in indicators', () => {
  it('the window tells the door what it can add; the answer shows one button; one tap adds it and says so', async () => {
    const { spy, writes } = mount()
    await say('Add the RS Rating')
    // every built-in the library names (this build offers them all: the switch above says so), in its order
    expect(spy.mock.calls[0][0].gateCtx.builtIns).toEqual(
      BUILT_IN_NAMES.map((b) => b.indicator).filter((id, i, all) => all.indexOf(id) === i))
    expect(spy.mock.calls[0][0].gateCtx.builtIns).toEqual(expect.arrayContaining(['rsMansfield', 'rsRating', 'rsPhases', 'vwap', 'atrBands']))
    expect(lastUct().textContent).toContain('RS Rating is one of UCT\'s own indicators')
    expect(offerButton().textContent).toBe('Add UCT RS Rating to this chart')
    expect(writes).toHaveLength(0)                                          // the answer itself changes nothing

    await act(async () => { fireEvent.click(offerButton()) })
    expect(writes).toHaveLength(1)
    expect(instancesOf(writes[0], 'rsRating')).toHaveLength(1)
    expect(writes[0].preset).toBe('custom')
    expect(offerButton()).toBeNull()                                         // one tap, one outcome
    expect(lastUct().textContent).toBe('Added UCT RS Rating to this chart.')
    expect(screen.queryByTestId('create-indicator-save')?.disabled ?? true).toBe(true)   // no draft was made
  })

  // ⭐ ONE SETTING OF A BUILT-IN (2026-11-19): VWAP's standard-deviation bands are Session VWAP with
  // its "Std dev bands" setting on. This dock is on a DAILY chart (`tf="D"`), where Session VWAP does
  // not draw: the tap still adds it, and the line says so (the panel hands the tap its timeframe).
  it('an offer for one setting of a built-in: the button says which, one tap adds it with the setting on, and the line says where it draws', async () => {
    const said = 'Session VWAP, one of UCT\'s own indicators, draws VWAP standard deviation bands itself when its Std dev bands setting is on.'
    const { writes } = mount({ converse: async () => ({
      ok: true, disposition: 'answer', reply: said, turn: 'offer',
      envelope: { contract: 'uct.authoring.patch/1', baseRevision: 0, ops: [], disposition: 'answer', reply: said },
      offer: { kind: 'add_built_in', indicator: 'vwap', inputs: { bands: '2' } }, notUnderstood: [], unavailable: [],
    }) })
    await say('VWAP with 2 standard deviation bands')
    expect(offerButton().textContent).toBe('Add Session VWAP with Std dev bands: ±1σ, ±2σ to this chart')
    expect(writes).toHaveLength(0)

    await act(async () => { fireEvent.click(offerButton()) })
    expect(writes).toHaveLength(1)
    expect(instancesOf(writes[0], 'vwap').map((i) => i.inputs.bands)).toEqual(['2'])
    expect(offerButton()).toBeNull()
    expect(lastUct().textContent).toBe('Added Session VWAP to this chart with Std dev bands: ±1σ, ±2σ. '
      + 'Session VWAP does not draw on this timeframe: it will show when the chart is on one it does.')
  })

  it('a build that does not offer the indicator tells the door so, and a tap on an offer it should never have got writes nothing', async () => {
    H.offered = false
    const { spy, writes } = mount()
    await say('Add the RS Rating')
    expect('builtIns' in spy.mock.calls[0][0].gateCtx).toBe(false)
    // the scripted door offers anyway (a real one would not): the tap asks again
    await act(async () => { fireEvent.click(offerButton()) })
    expect(writes).toHaveLength(0)
    expect(lastUct().textContent).toBe('UCT RS Rating is not offered on this chart right now, so nothing was added.')
    expect(offerButton()).toBeNull()
  })

  it('a window that cannot write the chart tells the door it can add nothing', async () => {
    const { spy } = mount({ writable: false })
    await say('Add the RS Rating')
    expect('builtIns' in spy.mock.calls[0][0].gateCtx).toBe(false)
  })

  it('one already on the chart is not added twice', async () => {
    const first = mount()
    await say('Add the RS Rating')
    await act(async () => { fireEvent.click(offerButton()) })
    const withOne = first.writes[0]
    cleanup(); _resetSessions()
    const second = mount({ settings: withOne, key: createKey('s_offer_2') })
    await say('Add the RS Rating')
    await act(async () => { fireEvent.click(offerButton()) })
    expect(second.writes).toHaveLength(0)
    expect(lastUct().textContent).toBe('UCT RS Rating is already on this chart.')
  })

  it('a conversation read back from the session keeps the words and offers nothing', async () => {
    const key = createKey('s_offer_restore')
    mount({ key })
    await say('Add the RS Rating')
    expect(offerButton()).not.toBeNull()
    cleanup()
    mount({ key })
    expect(document.body.textContent).toContain('RS Rating is one of UCT\'s own indicators')
    expect(offerButton()).toBeNull()
  })

  it('an ordinary answer has no button', async () => {
    mount({ converse: async () => ({
      ok: true, disposition: 'answer', reply: 'A rank of past return.', turn: 'noop',
      envelope: { contract: 'uct.authoring.patch/1', baseRevision: 0, ops: [], disposition: 'answer', reply: 'A rank of past return.' },
      notUnderstood: [], unavailable: [],
    }) })
    await say('What is the RS Rating?')
    expect(offerButton()).toBeNull()
  })
})
