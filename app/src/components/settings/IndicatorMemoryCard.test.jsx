// Settings → What Create Indicator remembers.
//
// The server is stubbed (`fetch`); the card, the house dropdown and every word a member reads are real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import IndicatorMemoryCard, { ASK, ASK_LABEL, MEMORY_URL, cameFrom, optionsFor, shortDay } from './IndicatorMemoryCard'

const KIND = {
  id: 'average_kind', title: 'Kind of moving average', question: 'Which kind of moving average?',
  use: 'Used without asking, and said each time.', any_number: false,
  choices: [{ label: 'Simple (SMA)', value: 'sma' }, { label: 'Exponential (EMA)', value: 'ema' }],
}
const LENGTH = {
  id: 'average_length', title: 'Length of an average', question: 'How many bars should the average use?',
  use: 'Asked each time, with yours listed first.', any_number: true,
  choices: [{ label: '10', value: 10 }, { label: '20', value: 20 }, { label: '50', value: 50 }, { label: '200', value: 200 }],
}
const CROSS = {
  id: 'cross_meaning', title: 'When a cross counts', question: 'When should a cross count?',
  use: 'Used without asking, and said each time.', any_number: false,
  choices: [{ label: 'When the bar closes across it', value: 'close' }, { label: 'As soon as price trades through it', value: 'touch' }],
}
const view = (kind = null, length = null, cross = null) => ({
  questions: [{ ...KIND, remembered: kind }, { ...LENGTH, remembered: length }, { ...CROSS, remembered: cross }],
  remembers: [kind, length, cross].filter(Boolean).length,
})
const EMA = { label: 'Exponential (EMA)', value: 'ema', last: '2026-11-18', times: 2, from: 'answer' }
const L21 = { label: '21', value: 21, last: '2026-11-17', times: 1, from: 'settings' }

/** A scripted server: each call's answer in order, recording what was asked. */
function server(answers) {
  const calls = []
  const fn = vi.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, credentials: init.credentials })
    const next = answers[calls.length - 1]
    if (next === undefined) throw new Error(`the server was asked a ${calls.length}th time`)
    if (next && next.__status) return { ok: false, status: next.__status, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => next }
  })
  fn.calls = calls
  vi.stubGlobal('fetch', fn)
  return fn
}
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }) }
const row = (id) => screen.getByTestId('indicator-memory-rows').querySelector(`[data-question="${id}"]`)
async function pick(id, label) {
  fireEvent.click(within(row(id)).getByRole('button'))
  fireEvent.click(screen.getByRole('option', { name: label }))
  await flush()
}

beforeEach(() => { vi.unstubAllGlobals() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('What Create Indicator remembers', () => {
  it('lists every question it can remember, with the member\'s choice and WHERE it came from', async () => {
    const fetch = server([view(EMA, L21, null)])
    render(<IndicatorMemoryCard />)
    await flush()
    expect(fetch.calls[0]).toMatchObject({ url: MEMORY_URL, method: 'GET', credentials: 'include' })
    expect(screen.getByText('What Create Indicator remembers')).toBeTruthy()
    // the choice, on the dropdown's own button
    expect(within(row('average_kind')).getByRole('button').textContent).toMatch(/Exponential \(EMA\)/)
    expect(within(row('average_length')).getByRole('button').textContent).toMatch(/21/)
    expect(within(row('cross_meaning')).getByRole('button').textContent).toMatch(new RegExp(ASK_LABEL))
    // where each came from
    expect(screen.getByTestId('memory-from-average_kind').textContent).toBe('Used without asking, and said each time. You chose this on 18 Nov, when it asked.')
    expect(screen.getByTestId('memory-from-average_length').textContent).toBe('Asked each time, with yours listed first. You set this here on 17 Nov.')
    expect(screen.getByTestId('memory-from-cross_meaning').textContent).toBe('Not asked yet. It will ask the first time this comes up.')
    expect(screen.getByText('Forget everything').disabled).toBe(false)
    // no habit sent: no line about one
    expect(screen.queryByTestId('memory-usual-average_kind')).toBeNull()
  })

  it('what the member USUALLY uses is shown in the server\'s own words, on the row it belongs to', async () => {
    const usual = 'From your saved indicators: Exponential (EMA), in 7 of 9. Offered first when it asks; nothing is stored.'
    const data = view(null, L21, null)
    data.questions[0] = { ...data.questions[0], usual }
    data.questions[1] = { ...data.questions[1], usual: '' }          // an empty one is no line
    data.questions[2] = { ...data.questions[2], usual: { text: 'x' } }   // nor is anything that is not text
    server([data])
    render(<IndicatorMemoryCard />)
    await flush()
    expect(screen.getByTestId('memory-usual-average_kind').textContent).toBe(usual)
    expect(row('average_kind').contains(screen.getByTestId('memory-usual-average_kind'))).toBe(true)
    expect(screen.queryByTestId('memory-usual-average_length')).toBeNull()
    expect(screen.queryByTestId('memory-usual-cross_meaning')).toBeNull()
    // it is a line of text, never a control: the dropdown still says the door will ask
    expect(within(row('average_kind')).getByRole('button').textContent).toMatch(new RegExp(ASK_LABEL))
  })

  it('changing a choice sends that question and one of its own values, and shows what the server kept', async () => {
    const SMA = { label: 'Simple (SMA)', value: 'sma', last: '2026-11-18', times: 1, from: 'settings' }
    const fetch = server([view(EMA), view(SMA)])
    render(<IndicatorMemoryCard />)
    await flush()
    await pick('average_kind', 'Simple (SMA)')
    expect(fetch.calls[1]).toMatchObject({ url: MEMORY_URL, method: 'PUT', body: { question: 'average_kind', value: 'sma' } })
    expect(within(row('average_kind')).getByRole('button').textContent).toMatch(/Simple \(SMA\)/)
    expect(screen.getByTestId('memory-from-average_kind').textContent).toMatch(/You set this here on 18 Nov\./)
    expect(screen.getByRole('status').textContent).toBe('Saved.')
  })

  it('a length is sent as a number, never as text', async () => {
    const fetch = server([view(null, null), view(null, { label: '50', value: 50, last: '2026-11-18', times: 1, from: 'settings' })])
    render(<IndicatorMemoryCard />)
    await flush()
    await pick('average_length', '50')
    expect(fetch.calls[1].body).toEqual({ question: 'average_length', value: 50 })
  })

  it('"Ask me each time" forgets that one choice', async () => {
    const fetch = server([view(EMA, L21), view(null, L21)])
    render(<IndicatorMemoryCard />)
    await flush()
    await pick('average_kind', ASK_LABEL)
    expect(fetch.calls[1]).toMatchObject({ url: `${MEMORY_URL}?question=average_kind`, method: 'DELETE', body: null })
    expect(within(row('average_kind')).getByRole('button').textContent).toMatch(new RegExp(ASK_LABEL))
    expect(within(row('average_length')).getByRole('button').textContent).toMatch(/21/)      // the other one stays
    expect(screen.getByRole('status').textContent).toBe('Forgotten. It will ask next time.')
  })

  it('"Forget everything" forgets everything, and then there is nothing to forget', async () => {
    const fetch = server([view(EMA, L21), view()])
    render(<IndicatorMemoryCard />)
    await flush()
    fireEvent.click(screen.getByText('Forget everything'))
    await flush()
    expect(fetch.calls[1]).toMatchObject({ url: MEMORY_URL, method: 'DELETE', body: null })
    expect(screen.getByRole('status').textContent).toBe('Everything forgotten.')
    expect(screen.getByText('Forget everything').disabled).toBe(true)
  })

  it('with nothing remembered it says so, and the forget button is off', async () => {
    server([view()])
    render(<IndicatorMemoryCard />)
    await flush()
    expect(screen.getByRole('status').textContent).toBe('Nothing yet. It remembers the choices you make when it asks.')
    expect(screen.getByText('Forget everything').disabled).toBe(true)
  })

  it('a save the server refuses says so and changes nothing on screen', async () => {
    const fetch = server([view(EMA), { __status: 400 }])
    render(<IndicatorMemoryCard />)
    await flush()
    await pick('average_kind', 'Simple (SMA)')
    expect(fetch.calls).toHaveLength(2)
    expect(screen.getByRole('status').textContent).toBe('Could not save. Nothing was changed.')
    expect(within(row('average_kind')).getByRole('button').textContent).toMatch(/Exponential \(EMA\)/)
  })

  it('a member the server gives no answer to sees no card at all', async () => {
    server([{ __status: 403 }])
    const { container } = render(<IndicatorMemoryCard />)
    await flush()
    expect(container.textContent).toBe('')
  })

  it('the pieces', () => {
    expect(shortDay('2026-11-18')).toBe('18 Nov')
    expect(shortDay('2026-01-01')).toBe('1 Jan')                       // built from its parts: no time zone moves the day
    expect(shortDay('yesterday')).toBe('')
    expect(cameFrom(null)).toMatch(/^Not asked yet/)
    expect(cameFrom({ from: 'answer', last: null })).toBe('You chose this, when it asked.')
    expect(cameFrom({ from: 'settings', last: '2026-11-18' })).toBe('You set this here on 18 Nov.')
    // ask first; the usual choices; and the member's own value when it is not one of them
    expect(optionsFor({ ...LENGTH, remembered: L21 }).map((o) => o.label)).toEqual([ASK_LABEL, '10', '20', '50', '200', '21'])
    expect(optionsFor({ ...LENGTH, remembered: null })[0]).toEqual({ value: ASK, label: ASK_LABEL })
    expect(optionsFor({ ...KIND, remembered: EMA }).map((o) => o.value)).toEqual([ASK, 'sma', 'ema'])
  })
})
