// A SCRIPT ANSWER IN THE DOCK — for a request a formula cannot hold, the assistant writes Pine;
// the dock shows this window's own ENGINE verdict on it and opens the script editor with it
// (`authoring/scriptAnswer.js`). The door is scripted; the engine, the panel and the builder
// window are real.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { _resetSessions, createKey } from '../authoring/conversationSessions'
import { AuthContext } from '../../../../context/AuthContext'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'
import CreateIndicatorPanel from './CreateIndicatorPanel'
import { recipeBars, recipeContext, RUN_STOP_PROBES } from '../../supportLoop/assistantRecipes'
import BuilderSheet from '../BuilderSheet'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
// (a script is run on a chart only where member scripts are drawn at all: `runsHere.js` asks the gate first)
vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')

const EXAMPLES = path.resolve(process.cwd(), 'src/components/chart/supportLoop/assistantExamples')
const TABLE = fs.readFileSync(path.join(EXAMPLES, 'table-summary.pine'), 'utf8')
const BROKEN = '//@version=5\nindicator("x", overlay=true)\nplot(ta.not_a_function(close, 14), "x")\n'

const scriptAnswer = (pine, reply) => ({
  ok: true, disposition: 'answer', reply, turn: 'script',
  envelope: { contract: 'uct.authoring.patch/1', baseRevision: 0, ops: [], disposition: 'answer', reply },
  script: { name: 'ATR table', pine, round: 0 }, notUnderstood: [], unavailable: [],
})

function mount({ converse, onOpenScript = vi.fn() }) {
  const spy = vi.fn(converse)
  const writes = []
  render(
    <CreateIndicatorPanel settings={mergeChartSettings({})} onChange={(n) => writes.push(n)} sym="AAPL" tf="D"
      onPreview={() => {}} onClose={() => {}} converse={spy} sessionKey={createKey('s_script')} onOpenScript={onOpenScript} />,
  )
  return { spy, writes, onOpenScript }
}

async function say(text) {
  fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
  await waitFor(() => expect(document.querySelector('[data-role="uct"][data-kind="script"]')).not.toBeNull(), { timeout: 60_000 })
}
const entry = () => document.querySelector('[data-role="uct"][data-kind="script"]')

beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })
beforeEach(() => { _resetSessions(); global.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) })
afterEach(() => { cleanup(); registry.clearUserDefinitions() })

describe('an answer that is a script', () => {
  it('leads with this window\'s own engine verdict, keeps the assistant\'s words apart, and opens the script editor with the text', async () => {
    const { spy, writes, onOpenScript } = mount({ converse: async () => scriptAnswer(TABLE, 'A table of the ATR in the corner.') })
    await say('Show a table in the corner with the ATR')
    expect(spy).toHaveBeenCalledTimes(1)                                    // it ran: nothing was sent back
    // ⭐ this window SHOWS a script, so it is the sender that tells the door it accepts one
    expect(spy.mock.calls[0][0].gateCtx.showsScripts).toBe(true)
    const lines = [...entry().querySelectorAll(':scope > span')].map((s) => s.textContent)
    // (no chart beside this dock: the script passed the check and was NOT run, and the entry says exactly that)
    expect(lines[0]).toMatch(/^Passed the script check; not run on a chart yet/)
    expect(screen.getByTestId('create-indicator-said').textContent).toContain('A table of the ATR in the corner.')
    expect(screen.getByTestId('create-indicator-script').dataset.runs).toBe('true')
    expect(screen.getByTestId('create-indicator-script-text').textContent).toContain('table.new(position.top_right')
    expect(writes).toHaveLength(0)                                          // nothing is put on the chart from the dock
    fireEvent.click(screen.getByTestId('create-indicator-open-script'))
    expect(onOpenScript).toHaveBeenCalledWith({ pine: TABLE, name: 'ATR table' })
  }, 120_000)

  it('a script the engine refuses is sent back with the engine\'s words, and a refusal that stands is shown as one', async () => {
    const sent = []
    const { spy } = mount({ converse: async (args) => { sent.push(args); return scriptAnswer(`${BROKEN}// try ${sent.length}\n`, 'It works.') } })
    await say('Show a table in the corner with the ATR')
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)                  // the engine's refusal went back
    expect(sent[1].scriptRefusal.round).toBe(1)
    expect(sent[1].scriptRefusal.errors.length).toBeGreaterThan(0)
    expect(screen.getByTestId('create-indicator-script').dataset.runs).toBe('false')
    expect(entry().textContent).not.toMatch(/^Runs/)
    expect(entry().textContent).toMatch(/the chart still does not run it fully/)
    expect(screen.getByTestId('create-indicator-open-script').textContent).toBe('Open this script to fix it')
  }, 120_000)
})

describe('the script editor opens with the script in it', () => {
  it('the text handed in lands in the script box', async () => {
    global.fetch = vi.fn(async (_url, init = {}) => ((init.method || 'GET') === 'GET'
      ? { ok: true, status: 200, json: async () => ({ definitions: [] }) }
      : { ok: true, status: 200, json: async () => ({}) }))
    render(
      <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
          <BuilderSheet open onClose={() => {}} initialMode="pine" initialPine={TABLE} />
        </SWRConfig>
      </AuthContext.Provider>,
    )
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByTestId('pine-box').querySelector('textarea').value).toBe(TABLE)
  }, 120_000)
})

// ═══ the dock beside a chart: "runs" is a real run on that chart ═══════════════════════════

describe('the dock runs a script on the chart it sits beside', () => {
  const TOTAL = RUN_STOP_PROBES['running-total'].source
  const chartOn = (history) => ({ bars: recipeBars('daily'), ctx: recipeContext('daily', history) })
  function mountBeside(engineChart, converse) {
    const spy = vi.fn(converse)
    render(
      <CreateIndicatorPanel settings={mergeChartSettings({})} onChange={() => {}} sym="AAPL" tf="D" engineChart={engineChart}
        onPreview={() => {}} onClose={() => {}} converse={spy} sessionKey={createKey('s_script_run')} onOpenScript={() => {}} />,
    )
    return spy
  }

  it('a script that pastes clean and is refused by the run shows the RUN\'s refusal, not "Runs", and is sent back with it', async () => {
    const sent = []
    const spy = mountBeside(chartOn('offListing'), async (args) => { sent.push(args); return scriptAnswer(`${TOTAL}// try ${sent.length}${String.fromCharCode(10)}`, 'A running total of volume.') })
    await say('Plot a running total of volume')
    // the first answer, and ONE repair: it came back refused the same way, so it is not asked again
    await waitFor(() => expect(spy.mock.calls.length).toBe(2), { timeout: 60_000 })
    expect(sent[1].scriptRefusal.errors[0]).toMatch(/its values never came to agree/)
    expect(sent[1].scriptRefusal.round).toBe(1)
    await waitFor(() => expect(entry().textContent).toMatch(/It does not run on this chart/), { timeout: 60_000 })
    expect(screen.getByTestId('create-indicator-script').dataset.runs).toBe('false')
    expect(entry().textContent).toMatch(/its values never came to agree/)
    expect(entry().textContent).not.toMatch(/^Runs on the chart/)
  }, 180_000)

  it('CONTROL: the same script beside a chart whose history reaches the listing runs, and nothing is sent back', async () => {
    const spy = mountBeside(chartOn('fromListing'), async () => scriptAnswer(TOTAL, 'A running total of volume.'))
    await say('Plot a running total of volume')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('create-indicator-script').dataset.runs).toBe('true')
    expect(entry().textContent).toMatch(/^Runs on the chart/)
  }, 120_000)

  it('CONTROL: with no chart handed to it the dock is what it was (the paste check alone)', async () => {
    const { spy } = mount({ converse: async () => scriptAnswer(TOTAL, 'A running total of volume.') })
    await say('Plot a running total of volume')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('create-indicator-script').dataset.runs).toBe('true')
  }, 120_000)
})
