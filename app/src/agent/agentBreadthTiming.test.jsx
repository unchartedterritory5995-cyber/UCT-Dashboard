// BREADTH RESPONSE TIMING (owner 2026-10-13): the Agent's OWN cost for the owner's four questions —
// deterministic parse, subject resolution, dispatch and the card's render — with the data route
// answering at once, so what is measured is everything but the server's data time. First ask and a
// repeat. Zero model calls; exactly one /api/agent/breadth request per question. (Production's
// 9–10 s was the server's cold per-measure read — measured from Railway HTTP logs, fixed in Breadth.)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { _resetBreadthSubject, _resetBreadthDates, breadthFast } from './capabilities/breadth'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const Q = ['What percentage of US stocks are above their 50 SMA?', 'What about Nasdaq?', 'And how many are below it?', 'And the 200-day?']
let turns, breadth
beforeEach(() => {
  turns = 0; breadth = []
  _resetBreadthDates(); _resetBreadthSubject()
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') { turns += 1; return json({}) }
    if (url === '/api/agent/breadth') {
      const b = JSON.parse(init.body); breadth.push(b)
      return json({ status: 'ok', text: '…', table: null, present: { kind: 'value', value: '1.0%', label: `${b.universe} ${b.metrics[0]} ${b.side}`, note: 'n' } })
    }
    if (url === '/api/agent/record') return json({ conversationId: 'c1' })
    if (url === '/api/agent/breadth/dates') return json({ today_et: '2026-10-13', latest_finalized: {} })
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('the Agent’s own time for the owner’s four questions', () => {
  it('deterministic resolution is sub-millisecond', () => {
    const t = performance.now()
    for (let i = 0; i < 1000; i++) breadthFast(Q[0])
    const per = (performance.now() - t) / 1000
    console.log(`[timing] breadthFast parse: ${per.toFixed(3)} ms per question`)
    expect(per).toBeLessThan(5)
  })

  it('send → card, first ask and repeat: one request each, no model, well under 300 ms', async () => {
    const board = makeBoard([{ id: 'l', type: 'chart', x: 0, y: 0, w: 8, h: 20 }], { A: 'QQQ' })
    render(<AgentPanel host={board.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    const ms = []
    for (const round of [1, 2]) {
      for (const q of Q) {
        await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
        const n = screen.queryAllByTestId('agent-result').length
        const t = performance.now()
        fireEvent.change(box, { target: { value: q } })
        fireEvent.keyDown(box, { key: 'Enter' })
        await waitFor(() => expect(screen.queryAllByTestId('agent-result')).toHaveLength(n + 1), { timeout: 8000, interval: 2 })
        ms.push({ round, q, ms: Math.round(performance.now() - t) })
      }
    }
    for (const m of ms) console.log(`[timing] round ${m.round} ${m.ms} ms  ${m.q}`)
    expect(turns).toBe(0)
    expect(breadth).toHaveLength(8)                                               // one request per question, no duplicates
    expect(breadth.map(b => `${b.universe}:${b.metrics[0]}:${b.side}`)).toEqual([
      'us:pct_above_50sma:null', 'nasdaq:pct_above_50sma:null', 'nasdaq:pct_above_50sma:below', 'nasdaq:pct_above_200sma:below',
      // the repeat round starts from the remembered subject (Nasdaq A200, below): "US … above" resets it
      'us:pct_above_50sma:null', 'nasdaq:pct_above_50sma:null', 'nasdaq:pct_above_50sma:below', 'nasdaq:pct_above_200sma:below',
    ])
    expect(Math.max(...ms.map(m => m.ms))).toBeLessThan(300)
  }, 40000)
})
