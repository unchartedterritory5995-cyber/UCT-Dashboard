// UCT Agent STREAMING (2026-10-12, latency): an answer's reply appears while it is written, as ONE
// provisional line that the final envelope replaces; a web search is announced and retracts any
// placeholder text; anything that ends as a non-answer removes the line. Server flag off (or the
// browser's kill switch) → the old request, unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { _resetAgentConfig } from './agentClient'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

const host = { charts: { list: () => [], read: () => null }, otherWidgets: () => [] }
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const env = (disposition, reply, extra = {}) => ({ disposition, reply, question: null, ops: [], unsupported_category: null, ...extra })
const final = (e) => ({ t: 'final', conversationId: 'ac_s', turnId: 1, envelope: e, usage: { citations: [] } })

let urls = []
let streamCtl = null          // the open SSE response's controller: the test sends events by hand
let serverStream = true
function install({ plainTurn = env('answer', 'Plain answer.') } = {}) {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    urls.push(u)
    if (u === '/api/agent/config') return json({ stream: serverStream })
    if (u === '/api/agent/turn') return json({ conversationId: 'ac_s', turnId: 1, envelope: plainTurn, usage: { citations: [] } })
    if (u === '/api/agent/turn/stream') {
      const body = new ReadableStream({ start(c) { streamCtl = c; c.enqueue(new TextEncoder().encode(': open\n\n')) } })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    return json({ conversations: [] })
  })
}
const send = (ev) => streamCtl.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(ev)}\n\n`))
const close = () => streamCtl.close()

async function open() {
  render(<AgentPanel host={host} onClose={() => {}} />)
  await waitFor(() => expect(urls).toContain('/api/agent/config'))
  await new Promise(r => setTimeout(r, 0))
  return screen.getByLabelText('Message UCT Agent')
}
const ask = (box, text) => { fireEvent.change(box, { target: { value: text } }); fireEvent.keyDown(box, { key: 'Enter' }) }
const agentTexts = () => [...document.querySelectorAll('[data-testid="agent-transcript"] *')]
  .filter(n => n.children.length === 0 && /^(Part|Researched|Plain|Let me)/.test(n.textContent)).map(n => n.textContent)

beforeEach(() => {
  try { localStorage.clear(); localStorage.setItem('uct.agent.welcomed.anon', '1') } catch { /* */ }
  _resetAgentConfig()
  urls = []; streamCtl = null; serverStream = true
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('UCT Agent streaming', () => {
  it('server flag OFF: the old request, nothing streamed', async () => {
    serverStream = false
    install()
    ask(await open(), 'explain RSI divergence in detail')
    await waitFor(() => expect(screen.getByText('Plain answer.')).toBeTruthy())
    expect(urls).toContain('/api/agent/turn')
    expect(urls).not.toContain('/api/agent/turn/stream')
  })

  it('kill switch uct.agent.stream=0: the old request even when the server streams', async () => {
    localStorage.setItem('uct.agent.stream', '0')
    install()
    ask(await open(), 'explain RSI divergence in detail')
    await waitFor(() => expect(screen.getByText('Plain answer.')).toBeTruthy())
    expect(urls).not.toContain('/api/agent/turn/stream')
  })

  it('an answer streams into ONE line, and the final reply replaces it', async () => {
    install()
    ask(await open(), 'explain RSI divergence in detail')
    await waitFor(() => expect(streamCtl).not.toBeNull())
    send({ t: 'delta', text: 'Part one of the answer' })
    await waitFor(() => expect(screen.getByText('Part one of the answer')).toBeTruthy())
    expect(screen.getByTestId('agent-typing')).toBeTruthy()            // still working
    send({ t: 'delta', text: ', part two' })
    await waitFor(() => expect(screen.getByText('Part one of the answer, part two')).toBeTruthy())
    send(final(env('answer', 'Part one of the answer, part two. (final)')))
    close()
    await waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull())
    expect(agentTexts()).toEqual(['Part one of the answer, part two. (final)'])
  })

  it('a web search is announced; streamed placeholder text is retracted before the researched answer', async () => {
    install()
    ask(await open(), 'what did AMD say on its call?')
    await waitFor(() => expect(streamCtl).not.toBeNull())
    send({ t: 'delta', text: 'Let me look that up.' })
    await waitFor(() => expect(screen.getByText('Let me look that up.')).toBeTruthy())
    send({ t: 'retract' })
    send({ t: 'status', stage: 'research' })
    await waitFor(() => expect(screen.getByTestId('agent-typing').textContent).toMatch(/looking that up on the web/))
    expect(screen.queryByText('Let me look that up.')).toBeNull()
    send({ t: 'delta', text: 'Researched answer' })
    await waitFor(() => expect(screen.getByText('Researched answer')).toBeTruthy())
    expect(screen.getByTestId('agent-typing').textContent).toMatch(/is typing/)
    send(final(env('answer', 'Researched answer, in full.')))
    close()
    await waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull())
    expect(agentTexts()).toEqual(['Researched answer, in full.'])
  })

  it('a turn that ends as anything but an answer removes the streamed line', async () => {
    install()
    ask(await open(), 'tidy up my watchlist')
    await waitFor(() => expect(streamCtl).not.toBeNull())
    send({ t: 'delta', text: 'Part of something' })
    await waitFor(() => expect(screen.getByText('Part of something')).toBeTruthy())
    send(final(env('clarify', '', { question: { text: 'Which watchlist?', choices: ['Momentum'] } })))
    close()
    await waitFor(() => expect(screen.getByText('Which watchlist?')).toBeTruthy())
    expect(screen.queryByText('Part of something')).toBeNull()
  })

  it('an error ends the turn: the streamed line goes, the error is said', async () => {
    install()
    ask(await open(), 'explain RSI divergence in detail')
    await waitFor(() => expect(streamCtl).not.toBeNull())
    send({ t: 'delta', text: 'Part that will not finish' })
    await waitFor(() => expect(screen.getByText('Part that will not finish')).toBeTruthy())
    send({ t: 'error', status: 503, detail: 'UCT Agent is unavailable right now (APIError). No changes were made.' })
    close()
    await waitFor(() => expect(screen.getByText(/unavailable right now/)).toBeTruthy())
    expect(screen.queryByText('Part that will not finish')).toBeNull()
  })

  it('a dropped connection is said plainly and nothing streamed stays', async () => {
    install()
    ask(await open(), 'explain RSI divergence in detail')
    await waitFor(() => expect(streamCtl).not.toBeNull())
    send({ t: 'delta', text: 'Part before the drop' })
    await waitFor(() => expect(screen.getByText('Part before the drop')).toBeTruthy())
    streamCtl.error(new Error('network'))
    await waitFor(() => expect(screen.getByText(/connection to UCT dropped/)).toBeTruthy())
    expect(screen.queryByText('Part before the drop')).toBeNull()
  })
})
