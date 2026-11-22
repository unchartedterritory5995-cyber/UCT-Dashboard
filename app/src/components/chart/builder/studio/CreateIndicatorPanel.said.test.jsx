// What the assistant says it built, shown below the engine's words and labelled as the
// assistant's (Studio plan, section 5). The engine's read-back stays the authority; this is the
// plain sentence a member checks their request against.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'
import { transcriptSnippets } from '../authoring/converseClient'
import { saidOf, SAID_MAX } from '../authoring/authoringSession'

vi.mock('../authoring/studioTelemetry', async (orig) => ({ ...(await orig()), logStudioAction: vi.fn() }))

import CreateIndicatorPanel from './CreateIndicatorPanel'

afterEach(() => { cleanup(); registry.clearUserDefinitions() })

function mount(converse = scriptedConverse) {
  render(<CreateIndicatorPanel settings={mergeChartSettings({})} onChange={() => {}} sym="AAPL" tf="D"
    onPreview={() => {}} onClose={() => {}} converse={converse} />)
}
async function say(text) {
  fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
  await act(async () => {})
}
const lastUct = () => [...document.querySelectorAll('[data-role="uct"]')].at(-1)

describe('what the assistant says it built', () => {
  it('sits under the engine\'s lines, with its label, on a change', async () => {
    mount()
    await say('Add a 20 EMA')
    const entry = lastUct()
    const said = entry.querySelector('[data-testid="create-indicator-said"]')
    expect(said).not.toBeNull()
    expect(said.textContent).toBe('What the assistant says it builtAdded a 20-bar EMA of the close.')
    // the engine's own line is there too, and comes first
    const engine = [...entry.querySelectorAll('span')].find((s) => /EMA 20/.test(s.textContent) && !said.contains(s))
    expect(engine).toBeTruthy()
    expect(engine.compareDocumentPosition(said) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a change with no description shows no label', async () => {
    mount(async (args) => { const r = await scriptedConverse(args); return { ...r, reply: '', envelope: { ...r.envelope, reply: '' } } })
    await say('Add a 20 EMA')
    expect(lastUct().querySelector('[data-testid="create-indicator-said"]')).toBeNull()
    expect(lastUct().textContent).toMatch(/EMA 20/)
  })

  it('an answer or a refusal is not given the label (its words are already the assistant\'s)', async () => {
    mount()
    await say('Add a 20 EMA')
    await say('What does this do?')
    expect(lastUct().dataset.kind).toBe('answer')
    expect(lastUct().querySelector('[data-testid="create-indicator-said"]')).toBeNull()
  })

  it('it is rendered as text: markup in it is inert', async () => {
    mount(async (args) => { const r = await scriptedConverse(args); return { ...r, reply: '<img src=x onerror=alert(1)> built it' } })
    await say('Add a 20 EMA')
    const said = lastUct().querySelector('[data-testid="create-indicator-said"]')
    expect(said.querySelector('img')).toBeNull()
    expect(said.textContent).toContain('<img src=x onerror=alert(1)> built it')
  })
})

describe('the dock keeps the name the assistant gave where the derived one is a formula', () => {
  const C = { type: 'series', name: 'close' }
  const call = (name, ...args) => ({ type: 'call', name, args })
  const num = (value) => ({ type: 'num', value })
  const bin = (name, l, r) => ({ type: 'op', name, args: [l, r] })
  // (EMA 10 - EMA 21) / SMA 200 * 100: its derived name is a formula, not a name
  const SPREAD = bin('*', bin('/', bin('-', call('ema', C, num(10)), call('ema', C, num(21))), call('sma', C, num(200))), num(100))
  const spread = async (args) => {
    const r = await scriptedConverse({ ...args, message: 'Add a 20 EMA' })
    const op0 = { ...r.envelope.ops[0], name: 'Trend Spread', placement: 'pane', outputs: [{ key: 'value', tree: SPREAD }] }
    return { ...r, envelope: { ...r.envelope, ops: [op0] } }
  }

  it('an unreadable derived name gives way to the assistant’s', async () => {
    mount(spread)
    await say('show the spread between the 10 and 21 EMA as a percent of the 200 day')
    expect(screen.getByTestId('create-indicator-readback').textContent).toMatch(/Trend Spread/)
  })

  it('a readable derived name stays: "RSI 14 above 70" is not replaced by "RSI overbought", nor "EMA 20"', async () => {
    mount()
    await say('Build an RSI overbought signal')
    const card = screen.getByTestId('create-indicator-readback')
    expect(card.textContent).toMatch(/RSI 14 above 70/)
    expect(card.textContent).not.toMatch(/RSI overbought/)
    cleanup(); registry.clearUserDefinitions()
    mount()
    await say('Add a 20 EMA')
    expect(screen.getByTestId('create-indicator-readback').textContent).toMatch(/EMA 20/)
  })
})

describe('the pieces', () => {
  it('saidOf: one line, bounded, empty for nothing', () => {
    expect(saidOf('  Built   it.\n\nTwo lines. ')).toBe('Built it. Two lines.')
    expect(saidOf('x'.repeat(SAID_MAX + 50))).toHaveLength(SAID_MAX)
    for (const v of [null, undefined, 7, '', '   ']) expect(saidOf(v)).toBe('')
  })

  it('⛔ what is sent back to the model as context does not change: the description is not in the snippet', () => {
    const entry = { role: 'uct', kind: 'created', lines: ['EMA 20 — a number on every bar'], said: 'Added a 20-bar EMA of the close.' }
    const [snip] = transcriptSnippets([entry])
    expect(snip.text).toBe('EMA 20 — a number on every bar')
    // control: a field the snippet DOES read is included
    expect(transcriptSnippets([{ ...entry, reply: 'hello' }])[0].text).toContain('hello')
  })
})
