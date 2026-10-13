// UCT Agent — GATE C multi-turn conversations (owner 2026-10-13): session memory + references through the
// REAL panel (AgentPanel → useAgent → references → planner → runtime → Undo). No model: every turn here is
// answered by UCT itself; a scripted server answers only /record. A test-only screen returns a fixed table.
//
// AGENT_TRANSCRIPT_OUT=<dir> writes each conversation's transcript (what the member saw) as text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { registerCapability, registerTargetKind } from './capabilities'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

// A screen UCT "ran": the rows the member sees, in this order.
const ROWS = ['NVDA', 'AVGO', 'AMD', 'MU', 'QCOM']
registerTargetKind({ name: 'testMarket', boardScoped: false, list: () => [{ ref: 'mkt', label: 'Market' }], read: () => ({ ref: 'mkt', label: 'Market' }), stateOf: () => ({}), patch: () => null, commit: async () => ({}), landed: () => true, undoPatch: () => null, fingerprint: () => 'x' })
registerCapability({
  name: 'test.screen', target: 'testMarket', query: true, summary: 'test screen', args: { type: 'object', properties: {}, additionalProperties: false },
  fast: ({ lower }) => (lower === 'find strong semis' ? {} : null),
  answer: () => ({ text: `Strong semis: ${ROWS.length} matches.`, title: 'Strong semis', table: { columns: [{ key: 'ticker', label: 'Ticker' }], rows: ROWS.map(t => ({ ticker: t })) } }),
})

let turns, records
beforeEach(() => {
  turns = []; records = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
    const body = init.body ? JSON.parse(init.body) : null
    if (url === '/api/agent/turn' || url === '/api/agent/turn/stream') { turns.push(body); return json({ detail: 'no model in this test' }, 503) }
    if (url === '/api/agent/record') { records.push(body); return json({ conversationId: 'c1' }) }
    if (url === '/api/agent/config') return json({ stream: false })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** A board whose charts publish positions (x < 12 → left). */
function board(widgets, syms, opts) {
  const b = makeBoard(widgets, syms, opts)
  const base = b.host.charts
  const pos = (s) => {
    if (!s) return s
    const w = b.state.widgets.find(x => x.id === s.ref)
    return { ...s, position: b.state.widgets.filter(x => x.type === 'chart').length > 1 ? (w.x < 12 ? 'left' : 'right') : null }
  }
  b.host.charts = { ...base, list: () => base.list().map(pos), read: (r) => pos(base.read(r)) }
  return b
}

function mount(b, name) {
  render(<AgentPanel host={b.host} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const said = []
  const say = async (t) => {
    await waitFor(() => { expect(box.disabled).toBe(false); expect(document.querySelector('[data-testid=agent-typing]')).toBeNull() }, { timeout: 8000 })
    said.push(t)
    fireEvent.change(box, { target: { value: t } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(box.value).toBe(''), { timeout: 4000 })
    await waitFor(() => expect(document.querySelector('[data-testid=agent-typing]')).toBeNull(), { timeout: 8000 })
  }
  const transcript = () => screen.getByTestId('agent-transcript').textContent
  const save = () => {
    const dir = globalThis.process?.env?.AGENT_TRANSCRIPT_OUT
    if (!dir) return
    const items = [...screen.getByTestId('agent-transcript').children].map(el => el.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${name}.txt`), items.join('\n'))
  }
  return { say, transcript, save }
}
const chart = (b, id) => b.host.charts.read(id)

describe('Gate C conversations — references from session memory, through the real panel', () => {
  it('screen → "open the third one" → "compare it to the others" → undo → out of range', async () => {
    const b = board([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], { A: 'QQQ' })
    const { say, transcript, save } = mount(b, 'conversation-1-open-compare-undo')
    await say('find strong semis')
    await waitFor(() => expect(transcript()).toContain('5 matches'))
    await say('open the third one')
    await waitFor(() => expect(chart(b, 'c1').symbol).toBe('AMD'))     // the 3rd row SHOWN, on the one chart
    expect(b.state.addCalls || []).toHaveLength(0)                        // no new widget
    await say('compare it to the others')
    await waitFor(() => expect((chart(b, 'c1').cs.comparisonSymbols || []).map(x => x.sym)).toEqual(['NVDA', 'AVGO', 'MU', 'QCOM']))
    await say('undo')
    await waitFor(() => expect(chart(b, 'c1').cs.comparisonSymbols || []).toEqual([]))
    expect(chart(b, 'c1').symbol).toBe('AMD')                            // undo took back ONLY the comparison
    await say('open the 9th one')
    await waitFor(() => expect(transcript()).toContain('showed 5 — pick a number from 1 to 5'))
    expect(chart(b, 'c1').symbol).toBe('AMD')
    await say('pull up the last one')
    await waitFor(() => expect(chart(b, 'c1').symbol).toBe('QCOM'))
    expect(turns).toHaveLength(0)                                        // every turn answered by UCT
    save()
  }, 60000)

  it('two charts: "open the second one" asks which chart (no click, no subject); the answer lands there', async () => {
    const b = board([{ id: 'L', type: 'chart', x: 0, y: 0, w: 12, h: 20 }, { id: 'R', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'B' }], { A: 'SPY', B: 'QQQ' })
    const { say, transcript, save } = mount(b, 'conversation-2-which-chart')
    await say('find strong semis')
    await waitFor(() => expect(transcript()).toContain('5 matches'))
    await say('open the second one')
    await waitFor(() => expect(transcript()).toMatch(/Which chart/))
    expect(chart(b, 'L').symbol).toBe('SPY')
    expect(chart(b, 'R').symbol).toBe('QQQ')                             // nothing changed while asking
    fireEvent.click(screen.getAllByRole('button').find(x => /Chart R/.test(x.textContent)))
    await waitFor(() => expect(chart(b, 'R').symbol).toBe('AVGO'))
    // "it" is now the chart this chat changed: "weekly on it" needs no question
    await say('make it weekly')
    await waitFor(() => expect(chart(b, 'R').tf).toBe('W'))
    expect(chart(b, 'L').tf).toBe('D')
    save()
  }, 60000)

  it('"do the same on the right one" repeats the last change there; Undo takes back only that', async () => {
    const b = board([{ id: 'L', type: 'chart', x: 0, y: 0, w: 12, h: 20 }, { id: 'R', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'B' }], { A: 'SPY', B: 'QQQ' })
    const { say, save } = mount(b, 'conversation-3-do-the-same')
    await say('make the left chart weekly')
    await waitFor(() => expect(chart(b, 'L').tf).toBe('W'))
    await say('do the same on the right one')
    await waitFor(() => expect(chart(b, 'R').tf).toBe('W'))
    await say('undo')
    await waitFor(() => expect(chart(b, 'R').tf).toBe('D'))
    expect(chart(b, 'L').tf).toBe('W')
    save()
  }, 60000)

  it('stale context is refused, never guessed: nothing to repeat; a new chat forgets the results', async () => {
    const b = board([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], { A: 'QQQ' })
    const { say, transcript, save } = mount(b, 'conversation-4-stale')
    await say('do the same on the right one')
    await waitFor(() => expect(transcript()).toContain("I don't have a recent change to repeat"))
    await say('find strong semis')
    await waitFor(() => expect(transcript()).toContain('5 matches'))
    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))
    await say('open the third one')
    await waitFor(() => expect(turns.length).toBe(1))                    // no memory → the model path (here: down)
    expect(chart(b, 'c1').symbol).toBe('QQQ')                            // and nothing changed
    save()
  }, 60000)
})
