import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { mergeChartSettings } from '../components/chart/chartDefaults'

// The mic is the shared journal VoiceInputButton (Whisper). Here it is a button
// that "hears" a fixed sentence, so the test proves the TRANSCRIPT path: what is
// spoken enters the exact same Agent pipeline as what is typed.
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({
  default: ({ onTranscript }) => <button type="button" data-testid="mic" onClick={() => onTranscript('hide volume')}>mic</button>,
}))

import AgentPanel from './AgentPanel'
import { makeBoard } from './__fixtures__/board'

function makeHost(defs) {
  const st = new Map(defs.map(d => [d.ref, { stored: null, tf: d.tf || 'D', symbol: d.symbol || 'SPY', label: d.label || 'Chart (SPY)', position: d.position || null }]))
  const commits = []
  const read = (ref) => {
    const s = st.get(ref)
    return s ? { ref, label: s.label, position: s.position, symbol: s.symbol, tf: s.tf, stored: s.stored, cs: mergeChartSettings(s.stored || {}), linkedCount: 0 } : null
  }
  return {
    commits, raw: (r) => st.get(r), manual: (r, p) => Object.assign(st.get(r), p),
    charts: {
      list: () => [...st.keys()].map(read), read,
      commit(ref, patch) {
        commits.push(patch)
        const s = st.get(ref)
        if ('settings' in patch) s.stored = patch.settings
        if ('tf' in patch) s.tf = patch.tf
        if ('symbol' in patch) s.symbol = patch.symbol
        return true
      },
    },
    otherWidgets: () => [],
  }
}

let turns
let turnBodies
let records
beforeEach(() => {
  turns = []
  turnBodies = []
  records = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') {
      turnBodies.push(body)
      return json({ conversationId: 'ac_1', turnId: 1, envelope: turns.shift(), usage: { citations: [] } })
    }
    if (url === '/api/agent/record') { records.push(body); return json({ conversationId: 'ac_1' }) }
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    if (String(url).startsWith('/api/ticker-search')) return json({ results: [{ ticker: 'NVDA' }] })
    return json({})
  })
})
afterEach(() => { vi.restoreAllMocks() })

const env = (disposition, ops = [], reply = '', question = null) => ({ disposition, reply, question, ops, unsupported_category: null })
const type = (text) => {
  const box = screen.getByLabelText('Message UCT Agent')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

describe('UCT Agent panel', () => {
  it('TALK: an answer shows text and mutates nothing', async () => {
    const host = makeHost([{ ref: 'w1' }])
    turns.push(env('answer', [], 'An EMA weights recent prices more heavily.'))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('What is the difference between an EMA and an SMA?')
    await screen.findByText(/weights recent prices/)
    expect(host.commits).toHaveLength(0)
    // the model was told what it can do (manifest) and what is on screen (context)
    expect(turnBodies[0].capabilities.map(c => c.name)).toContain('chart.setType')
    expect(turnBodies[0].context.charts[0]).toMatchObject({ ref: 'c1', symbol: 'SPY' })
  })

  it('compound request: one write, an exact receipt, and Undo restores it', async () => {
    const host = makeHost([{ ref: 'w1' }])
    turns.push(env('apply', [
      { action: 'chart.setType', target: 'c1', args: { type: 'bars' } },
      { action: 'chart.setTimeframe', target: 'c1', args: { timeframe: 'W' } },
      { action: 'volume.setState', target: 'c1', args: { state: 'hidden' } },
      { action: 'chart.setBackground', target: 'c1', args: { color: '#f3efe4' } },
    ]))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('Change this chart to bars, switch it to weekly, hide Volume, and make the background cream')
    const receipt = await screen.findByTestId('agent-receipt')
    expect(receipt.textContent).toContain('Changed chart to Bars · Switched timeframe to Weekly · Hid Volume · Changed background to #f3efe4')
    expect(host.commits).toHaveLength(1)
    expect(host.raw('w1').tf).toBe('W')
    // natural-language undo: deterministic, no model call
    const before = turnBodies.length
    type('undo that')
    await screen.findByText(/Undid: Changed chart to Bars/)
    expect(turnBodies.length).toBe(before)
    expect(host.raw('w1').stored).toBeNull()
    expect(host.raw('w1').tf).toBe('D')
    expect(records.some(r => r.telemetry?.undo)).toBe(true)
  })

  it('fast path: obvious commands never call the model, and the Undo button works', async () => {
    const host = makeHost([{ ref: 'w1' }])
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('bars and weekly')
    await screen.findByText(/Changed chart to Bars · Switched timeframe to Weekly/)
    expect(turnBodies).toHaveLength(0)
    expect(records[0]).toMatchObject({ member: 'bars and weekly', telemetry: { path: 'fast' } })
    fireEvent.click(screen.getByTestId('agent-undo'))
    await screen.findByText(/Undid: Changed chart to Bars/)
    expect(host.raw('w1').tf).toBe('D')
  })

  it('AMBIGUITY: several charts and no target → it asks, nothing changes until chosen', async () => {
    const host = makeHost([{ ref: 'w1', label: 'Left chart (SPY)' }, { ref: 'w2', symbol: 'NVDA', label: 'Right chart (NVDA)' }])
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('weekly')
    await screen.findByTestId('agent-question')
    expect(host.commits).toHaveLength(0)
    fireEvent.click(screen.getByText('Right chart (NVDA)'))
    await screen.findByText(/Switched timeframe to Weekly/)
    expect(host.raw('w2').tf).toBe('W')
    expect(host.raw('w1').tf).toBe('D')
  })

  it('model clarify mutates nothing', async () => {
    const host = makeHost([{ ref: 'w1' }, { ref: 'w2' }])
    turns.push(env('clarify', [], '', { text: 'Which chart?', choices: ['Left chart', 'Right chart'] }))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('change this one to weekly')
    await screen.findByTestId('agent-question')
    expect(host.commits).toHaveLength(0)
  })

  it('PROPOSAL: shown first; "do it" executes the STORED plan with no second model call', async () => {
    const host = makeHost([{ ref: 'w1' }])
    turns.push(env('propose', [
      { action: 'chart.applyTheme', target: 'c1', args: { theme: 'cream' } },
      { action: 'volume.setState', target: 'c1', args: { state: 'hidden' } },
    ], 'A calmer, light canvas without the volume noise.'))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('make this chart look cleaner')
    const card = await screen.findByTestId('agent-proposal')
    expect(card.textContent).toContain('Applied the Cream chart theme')
    expect(host.commits).toHaveLength(0)
    const before = turnBodies.length
    type('do it')
    await screen.findByTestId('agent-receipt')
    expect(turnBodies.length).toBe(before)
    expect(host.commits).toHaveLength(1)
    expect(host.raw('w1').stored.volume.visible).toBe(false)
  })

  it('stale undo: a manual edit after the Agent wrote is never overwritten', async () => {
    const host = makeHost([{ ref: 'w1' }])
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('bars')
    await screen.findByTestId('agent-receipt')
    act(() => host.manual('w1', { tf: '60' }))
    type('undo')
    await screen.findByText(/changed since I made that change/)
    expect(host.raw('w1').stored.chartType).toBe('bars')
    expect(host.raw('w1').tf).toBe('60')
  })

  it('MICROPHONE: the transcript runs through the same pipeline', async () => {
    const host = makeHost([{ ref: 'w1' }])
    render(<AgentPanel host={host} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('mic'))
    await screen.findByText(/Hid Volume/)
    expect(host.raw('w1').stored.volume.visible).toBe(false)
    expect(records[0].telemetry).toMatchObject({ path: 'fast', voice: true })
  })

  it('an unsupported request is said plainly and changes nothing', async () => {
    const host = makeHost([{ ref: 'w1' }])
    turns.push({ ...env('unsupported', [], "I can't add indicators yet — use Chart Settings › Indicators."), unsupported_category: 'indicators' })
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('add RSI 21')
    await screen.findByText(/can't add indicators yet/)
    expect(host.commits).toHaveLength(0)
  })

  it('"do it" with NO pending proposal never reaches the model (no regenerated plan)', async () => {
    const host = makeHost([{ ref: 'w1' }])
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('do it')
    await screen.findByText(/no proposal waiting/)
    expect(turnBodies).toHaveLength(0)
    expect(host.commits).toHaveLength(0)
  })

  it('a failed model turn changes nothing and the conversation continues', async () => {
    const host = makeHost([{ ref: 'w1' }])
    globalThis.fetch.mockImplementationOnce(async () => new Response('boom', { status: 500 }))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('make the chart look cleaner')
    await screen.findByText(/couldn't complete that request. No changes were made/)
    expect(host.commits).toHaveLength(0)
    type('bars')
    await screen.findByText(/Changed chart to Bars/)
  })

  it('fast path resolves a NAMED target: "make the left chart weekly" changes only the left chart, no model', async () => {
    const host = makeHost([{ ref: 'w1', label: 'Left chart (SPY)', position: 'left' }, { ref: 'w2', label: 'Right chart (SPY)', position: 'right' }])
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('make the left chart weekly')
    await screen.findByText(/Switched timeframe to Weekly/)
    expect(host.raw('w1').tf).toBe('W')
    expect(host.raw('w2').tf).toBe('D')
    expect(turnBodies).toHaveLength(0)
  })

  it('fast path "both charts" is a multi-target plan → a PROPOSAL, nothing changes until approved', async () => {
    const host = makeHost([{ ref: 'w1', label: 'Left chart (SPY)', position: 'left' }, { ref: 'w2', label: 'Right chart (SPY)', position: 'right' }])
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('hide volume on both charts')
    await screen.findByTestId('agent-proposal')
    expect(host.commits).toHaveLength(0)
    type('do it')
    await screen.findByTestId('agent-receipt')
    expect(host.raw('w1').stored.volume.visible).toBe(false)
    expect(host.raw('w2').stored.volume.visible).toBe(false)
    expect(turnBodies).toHaveLength(0)
  })

  it('a position that matches nothing ASKS rather than guessing', async () => {
    const host = makeHost([{ ref: 'w1', label: 'Left chart (SPY)', position: 'left' }, { ref: 'w2', label: 'Right chart (SPY)', position: 'right' }])
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('make the bottom chart weekly')
    await screen.findByText(/I don't see a bottom chart/)
    expect(host.commits).toHaveLength(0)
  })

  it("a choice under the MODEL's question goes back to the model, never through the fast path", async () => {
    const host = makeHost([{ ref: 'w1', label: 'Left chart (SPY)', position: 'left' }, { ref: 'w2', label: 'Right chart (SPY)', position: 'right' }])
    turns.push(env('clarify', [], '', { text: 'What would make it cleaner?', choices: ['Hide volume', 'Switch to line'] }))
    turns.push(env('apply', [{ action: 'volume.setState', target: 'c2', args: { state: 'hidden' } }]))
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('make the right chart look cleaner')
    await screen.findByText('Hide volume')
    fireEvent.click(screen.getByText('Hide volume'))
    await screen.findByText(/Hid Volume/)
    expect(turnBodies).toHaveLength(2)                 // the choice went to the model
    expect(turnBodies[1].message).toBe('Hide volume')
    expect(host.raw('w2').stored.volume.visible).toBe(false)
    expect(host.raw('w1').stored).toBeNull()
  })

  it('MULTI-CREATE: proposal first, "never mind" cancels, "do it" runs the STORED plan, one Undo', async () => {
    const { host, state } = makeBoard([])
    const plan = [
      ...[1, 2, 3, 4].map(i => ({ action: 'widget.add', target: 'w1', args: { type: 'chart', as: `new${i}` } })),
      ...[1, 2, 3, 4].map(i => ({ action: 'chart.setTimeframe', target: `new${i}`, args: { timeframe: '5' } })),
      ...['SPY', 'QQQ', 'NVDA', 'TSLA'].map((s, i) => ({ action: 'chart.setSymbol', target: `new${i + 1}`, args: { symbol: s } })),
    ]
    globalThis.fetch.mockImplementation(async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : null
      const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url === '/api/agent/turn') { turnBodies.push(body); return json({ conversationId: 'ac_1', envelope: env('propose', plan, 'Four 5-minute charts.'), usage: {} }) }
      if (url === '/api/agent/record') { records.push(body); return json({ conversationId: 'ac_1' }) }
      if (String(url).startsWith('/api/ticker-search')) {
        const q = new URL(url, 'http://x').searchParams.get('q')
        return json({ results: [{ ticker: q }] })
      }
      return json({ conversations: [] })
    })
    render(<AgentPanel host={host} onClose={() => {}} />)
    type('Add 4 charts. Make them all 5-minute. Put SPY, QQQ, NVDA, and TSLA in them.')
    const card = await screen.findByTestId('agent-proposal')
    expect(card.textContent).toContain('Added 4 Charts')
    expect(card.textContent).toContain('New chart 4: Changed symbol to TSLA')
    expect(state.widgets).toHaveLength(0)
    expect(turnBodies[0].context.workspace[0]).toMatchObject({ ref: 'w1', widgetCount: 0 })
    type('never mind')
    await screen.findByText(/nothing changed/)
    expect(state.widgets).toHaveLength(0)
    type('Add 4 charts. Make them all 5-minute. Put SPY, QQQ, NVDA, and TSLA in them.')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal')).toHaveLength(2))
    const calls = turnBodies.length
    type('do it')
    const receipt = await screen.findByTestId('agent-receipt', {}, { timeout: 4000 })
    expect(receipt.textContent).toContain('Added 4 Charts (not linked — each keeps its own symbol) · All 4 new: Switched timeframe to 5 minutes · New chart 1: Changed symbol to SPY')
    expect(turnBodies.length).toBe(calls)                              // the stored plan, no regeneration
    expect(state.widgets.map(w => host.charts.read(w.id).symbol)).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
    expect(state.widgets.every(w => w.opts.tf === '5')).toBe(true)
    type('undo')
    await screen.findByText(/Undid: Added 4 Charts/, {}, { timeout: 4000 })
    expect(state.widgets).toHaveLength(0)
  })

  it('keys typed in the panel never reach chart shortcuts', () => {
    const host = makeHost([{ ref: 'w1' }])
    const seen = vi.fn()
    document.addEventListener('keydown', seen)
    render(<AgentPanel host={host} onClose={() => {}} />)
    fireEvent.keyDown(screen.getByLabelText('Message UCT Agent'), { key: 'b' })
    expect(seen).not.toHaveBeenCalled()
    document.removeEventListener('keydown', seen)
  })
})

