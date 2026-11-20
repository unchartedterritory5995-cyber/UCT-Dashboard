// app/src/components/chart/builder/ConverseBox.script.test.jsx
//
// ─── THE BUILDER'S OWN "DESCRIBE IT" BOX SHOWS A SCRIPT ANSWER ────────────────────────
//
// ⚰️ Found live 2026-11-19 (admin-only lane): this box told the door it accepts a script and showed
// only the assistant's description of one. First it stopped asking (`scriptAccepts.test.js`). Now it
// shows one properly: the script is checked by THIS window's engine (the dock's own check and repair
// loop), the entry leads with the engine's verdict, and one button opens it in the script editor.
//
// It asks for a script ONLY where it can open one: the start view of a new indicator, with a host
// that handed it the opener. The door is scripted; the engine, the box and the builder are real.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { clearUserDefinitions } from '../engine/nativeRegistry'
import { __permitRuntimePaneForTests } from '../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../engine/runtimeKill'
import { AuthContext } from '../../../context/AuthContext'
import { recipeBars, recipeContext, RUN_STOP_PROBES } from '../supportLoop/assistantRecipes'
import { _resetSessions } from './authoring/conversationSessions'
import { converseBody } from './authoring/converseClient'

vi.mock('./editor/PreviewPane', () => ({
  default: (p) => (p.definition && p.sym && p.tf ? <div data-testid="converse-preview" /> : null),
}))

import ConverseBox from './ConverseBox'
import BuilderSheet from './BuilderSheet'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
// (a script is run on a chart only where member scripts are drawn at all: `runsHere.js` asks the gate first)
vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')

const LF = String.fromCharCode(10)
const EXAMPLES = path.resolve(process.cwd(), 'src/components/chart/supportLoop/assistantExamples')
const TABLE = fs.readFileSync(path.join(EXAMPLES, 'table-summary.pine'), 'utf8')
const BROKEN = ['//@version=5', 'indicator("x", overlay=true)', 'plot(ta.not_a_function(close, 14), "x")'].join(LF) + LF
const TOTAL = RUN_STOP_PROBES['running-total'].source

const scriptAnswer = (pine, reply) => ({
  ok: true, disposition: 'answer', reply, turn: 'script',
  envelope: { contract: 'uct.authoring.patch/1', baseRevision: 0, ops: [], disposition: 'answer', reply },
  script: { name: 'ATR table', pine, round: 0 }, notUnderstood: [], unavailable: [],
})

function mount({ converse, onOpenScript = vi.fn(), ...props }) {
  const spy = vi.fn(converse)
  render(<ConverseBox sym="AAPL" tf="D" variant="start" converse={spy} onOpenScript={onOpenScript} sessionKey={null} {...props} />)
  return { spy, onOpenScript }
}
async function say(text, settled = () => document.querySelector('[data-role="uct"]')) {
  fireEvent.change(screen.getByLabelText('Describe it'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Write it' })) })
  await waitFor(() => expect(settled()).not.toBeNull(), { timeout: 60_000 })
}
const entry = () => document.querySelector('[data-role="uct"][data-kind="script"]')
const lines = () => [...entry().querySelectorAll('ul > li')].map((l) => l.textContent)

beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })
beforeEach(() => { _resetSessions(); global.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) })
afterEach(() => { cleanup(); clearUserDefinitions() })

describe('a script answer in the builder\'s own box', () => {
  it('asks for one, leads with this window\'s engine verdict, keeps the assistant\'s words apart, and opens the script editor with the text', async () => {
    const { spy, onOpenScript } = mount({ converse: async () => scriptAnswer(TABLE, 'A table of the ATR in the corner.') })
    await say('Show a table in the corner with the ATR', entry)
    expect(spy).toHaveBeenCalledTimes(1)                                    // it ran: nothing was sent back
    // ⭐ this window shows a script, so it told the door it accepts one
    expect(spy.mock.calls[0][0].gateCtx.showsScripts).toBe(true)
    expect(converseBody({ message: 'x', state: spy.mock.calls[0][0].state, gateCtx: spy.mock.calls[0][0].gateCtx }).accepts).toContain('script')
    // (no chart beside this box: the script passed the check and was NOT run, and the entry says exactly that)
    expect(lines()[0]).toBe('Passed the script check; not run on a chart yet')
    expect(screen.getByTestId('converse-script').dataset.runs).toBe('true')
    expect(screen.getByTestId('converse-script-said').textContent).toBe('UCT Agent: A table of the ATR in the corner.')
    expect(screen.getByTestId('converse-script-text').textContent).toContain('table.new(position.top_right')
    expect(screen.getByTestId('converse-open-script').textContent).toBe('Open this script in the editor')
    fireEvent.click(screen.getByTestId('converse-open-script'))
    expect(onOpenScript).toHaveBeenCalledWith({ pine: TABLE, name: 'ATR table' })
    // nothing was built in the box: there is no working indicator and nothing to save
    expect(screen.queryByTestId('converse-preview')).toBeNull()
  }, 120_000)

  it('a script the engine refuses is sent back with the engine\'s words, and a refusal that stands is shown as one', async () => {
    const sent = []
    const { spy } = mount({ converse: async (args) => { sent.push(args); return scriptAnswer(`${BROKEN}// try ${sent.length}${LF}`, 'It works.') } })
    await say('Show a table in the corner with the ATR', entry)
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(sent[0].scriptRefusal).toBeUndefined()
    expect(sent[1].scriptRefusal.pine).toContain('ta.not_a_function')
    expect(sent[1].scriptRefusal.errors.length).toBeGreaterThan(0)
    expect(sent[1].scriptRefusal.round).toBe(1)
    expect(sent[1].gateCtx.showsScripts).toBe(true)                          // the repair is asked for as a script too
    expect(screen.getByTestId('converse-script').dataset.runs).toBe('false')
    expect(lines()[0]).not.toMatch(/^Runs/)
    expect(screen.getByTestId('converse-open-script').textContent).toBe('Open this script in the editor to fix it')
  }, 120_000)

  it('beside a chart, "runs" is a real run on that chart: the run\'s refusal leads, and is what goes back', async () => {
    const sent = []
    const chart = { bars: recipeBars('daily'), ctx: recipeContext('daily', 'offListing') }
    mount({ engineChart: chart, converse: async (args) => { sent.push(args); return scriptAnswer(`${TOTAL}// try ${sent.length}${LF}`, 'A running total of volume.') } })
    await say('Plot a running total of volume', entry)
    expect(lines()[0]).toBe('It does not run on this chart')
    expect(screen.getByTestId('converse-script').dataset.runs).toBe('false')
    expect(sent.length).toBeGreaterThanOrEqual(2)
    expect(sent[1].scriptRefusal.errors.join(' ')).toMatch(/never came to agree|first bar/i)
  }, 120_000)

  it('CONTROL: with no chart beside it, the same script is judged by the paste check alone', async () => {
    mount({ converse: async () => scriptAnswer(TOTAL, 'A running total of volume.') })
    await say('Plot a running total of volume', entry)
    expect(lines()[0]).toBe('Passed the script check; not run on a chart yet')
  }, 120_000)
})

describe('it asks for a script only where it can open one', () => {
  const plain = async () => ({
    ok: true, disposition: 'answer', reply: 'Ask me for an indicator.', turn: 'answer',
    envelope: { contract: 'uct.authoring.patch/1', baseRevision: 0, ops: [], disposition: 'answer', reply: 'Ask me for an indicator.' },
    notUnderstood: [], unavailable: [],
  })
  const askedFor = (spy) => converseBody({ message: 'x', state: spy.mock.calls[0][0].state, gateCtx: spy.mock.calls[0][0].gateCtx }).accepts

  it.each([
    ['a host that handed it no opener', { onOpenScript: null }],
    ['the editor\'s Ask tab', { variant: 'ask' }],
    ['an indicator that exists', { editing: { defId: 'u_aaaaaaaaaaaa', version: 1, prior: null } }],
  ])('%s: the word is not sent', async (_name, props) => {
    const { spy } = mount({ converse: plain, ...props })
    const label = props.variant === 'ask' ? /Describe it|Change it/ : 'Describe it'
    fireEvent.change(screen.getByLabelText(label), { target: { value: 'what can you do' } })
    await act(async () => { fireEvent.click(screen.getAllByRole('button').find((b) => /Write it|Send|Ask/.test(b.textContent))) })
    await waitFor(() => expect(spy).toHaveBeenCalled(), { timeout: 30_000 })
    expect('showsScripts' in spy.mock.calls[0][0].gateCtx).toBe(false)
    expect(askedFor(spy)).not.toContain('script')
  }, 60_000)

  it('CONTROL: the start view of a new indicator, with the opener, does send it', async () => {
    const { spy } = mount({ converse: plain })
    await say('what can you do')
    expect(askedFor(spy)).toContain('script')
  }, 60_000)

  it('a script it never asked for is shown as the plain answer it always was (no entry it cannot act on)', async () => {
    mount({ onOpenScript: null, converse: async () => scriptAnswer(TABLE, 'A table of the ATR in the corner.') })
    await say('Show a table in the corner with the ATR')
    expect(entry()).toBeNull()
    expect(screen.queryByTestId('converse-script')).toBeNull()
  }, 60_000)
})

describe('the builder hands the box its script editor', () => {
  it('"Open this script in the editor" puts the text in the script box, on the script tab', async () => {
    const answer = scriptAnswer(TABLE, 'A table of the ATR in the corner.')
    global.fetch = vi.fn(async (url) => (String(url).includes('/converse')
      ? { ok: true, status: 200, json: async () => answer }
      : { ok: false, status: 404, json: async () => ({}) }))
    render(
      <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false, cohorts: ['create-indicator'] }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet open onClose={() => {}} sym="AAPL" tf="D" />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await say('Show a table in the corner with the ATR', entry)
    // the request this box sent asked for a script
    const sent = global.fetch.mock.calls.find((c) => String(c[0]).includes('/converse'))
    expect(JSON.parse(sent[1].body).accepts).toContain('script')
    fireEvent.click(screen.getByTestId('converse-open-script'))
    await waitFor(() => expect(screen.getByTestId('pine-box').querySelector('textarea').value).toBe(TABLE), { timeout: 30_000 })
  }, 180_000)

  it('and its chart: a script the run refuses on the builder\'s chart is shown as refused there', async () => {
    const answer = scriptAnswer(TOTAL, 'A running total of volume.')
    global.fetch = vi.fn(async (url) => (String(url).includes('/converse')
      ? { ok: true, status: 200, json: async () => answer }
      : { ok: false, status: 404, json: async () => ({}) }))
    const chart = { bars: recipeBars('daily'), ctx: recipeContext('daily', 'offListing') }
    render(
      <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false, cohorts: ['create-indicator'] }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet open onClose={() => {}} sym="AAPL" tf="D" engineChart={chart} />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await say('Plot a running total of volume', entry)
    expect(lines()[0]).toBe('It does not run on this chart')
    expect(screen.getByTestId('converse-script').dataset.runs).toBe('false')
  }, 180_000)
})
