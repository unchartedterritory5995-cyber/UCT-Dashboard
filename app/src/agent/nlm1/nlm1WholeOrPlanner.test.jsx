// NLM-1 · ALL OR NOTHING (AUDIT, #806 blocker): a message NLM-1 re-reads as SEVERAL steps runs only when EVERY step reads
// on the board as it is; otherwise NLM-1 declines and the member's ORIGINAL message goes to the planner, exactly as v1
// sends it. Never "stopped at …" where v1 would have asked the model, and never part of it run and then a stop.
//   1. a text rewrite that becomes a compound with an unread step → declined: nothing runs, the model gets the original
//   2. the clause rewrite (steps) with an unread clause → declined before anything runs, the model gets the original
//   3. every step reads → the steps run, no model call, one receipt per step
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog } from '../qa/capabilityRegression/testing/registry'
import { pinClock } from '../qa/capabilityRegression/testing/clock'
import { mountCase, chartsOf } from '../qa/capabilityRegression/testing/harness'
import { loadAgentConfig } from '../agentClient'

pinClock()
vi.mock('../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const boardOf = (m) => chartsOf(m.board).map(w => { const c = m.h.charts.read(w.id); return `${c?.symbol}/${c?.tf}[${m.p.brief(m.board, w.id).join(',')}]` }).join(' ')
const turnsOf = (m) => m.p.st.calls.filter(c => c[1] === '/api/agent/turn').map(c => c[2]?.message)
const marksOf = () => (window.__uctAgentTurns?.() || []).slice(-1).flatMap(x => x.marks || []).map(x => `${x[0]}${x[2] ? `=${x[2]}` : ''}`)

async function run(board, text, seed = {}) {
  const m = mountCase(board, { seed: { nlm1: true, ...seed } })
  await loadAgentConfig()
  const before = boardOf(m)
  await m.say(text)
  await m.p.idle()
  return { m, before, after: boardOf(m), turns: turnsOf(m), marks: marksOf(), said: String(m.p.transcript()) }
}

describe('NLM-1 multi-step rewrites: all steps read, or the whole ORIGINAL message goes to the planner', () => {
  it('1 · a reworded message whose steps do not all read → nothing runs; the planner gets the ORIGINAL text', async () => {
    const text = 'make the left chart weekly; then add rsi to it and make it orange'
    const r = await run('TWO', text)
    expect(r.marks).toContain('nlm1:rewrite=add-to-it')
    expect(r.marks).toContain('nlm1:rewrite-declined=compound')
    expect(r.turns).toEqual([text])                          // exactly one model call, with the member's own words
    expect(r.after).toBe(r.before)                           // nothing ran before it
    expect(r.said).not.toMatch(/stopped at|Nothing after it was started|Done \d+ of \d+/i)
    // #806 LOW-1: what ran is taken back as ONE group — one receipt, never "nothing of mine to undo"
    expect(r.said.match(/Took back all 2 changes from the steps I had started/g) || []).toHaveLength(1)
    expect(r.said).not.toMatch(/nothing of mine to undo/i)
  }, 30000)

  it('1b · the take-back itself fails → said honestly (what is still on the board), and the planner is NOT asked', async () => {
    const m = mountCase('TWO', { seed: { nlm1: true } })
    await loadAgentConfig()
    // the member (or another tab) edits the left chart while the steps run: its exact Undo must refuse to overwrite that
    let n = 0
    const persist = m.h.persist.bind(m.h)
    m.h.persist = async (...a) => {
      n += 1
      const r = await persist(...a)
      if (n === 2) { const w = chartsOf(m.board)[0]; m.board.state.widgets = m.board.state.widgets.map(x => (x.id === w.id ? { ...x, color: 'Q' } : x)) }
      return r
    }
    await m.say('make the left chart weekly; then add rsi to it and make it orange')
    await m.p.idle()
    const said = String(m.p.transcript())
    expect(turnsOf(m)).toEqual([])                           // never a plan over a partly reverted board
    expect(said).toMatch(/1 of the changes I had started is still on your board/)
    expect(said).toMatch(/didn’t ask the model to try it/)
    expect(said).not.toMatch(/stopped at “/)
  }, 30000)

  it('2 · the clause rewrite with a clause that does not read → declined before anything runs; the planner gets the ORIGINAL text', async () => {
    const text = 'swap the two charts and add rsi'
    const r = await run('TWO', text, { nlm1Inplan: true })
    expect(r.marks.some(x => x.startsWith('nlm1:rewrite-declined='))).toBe(true)
    expect(r.turns).toEqual([text])
    expect(r.after).toBe(r.before)
    expect(r.said).not.toMatch(/stopped at|Nothing after it was started|Done \d+ of \d+/i)
  }, 30000)

  it('3 · every step reads → all of it runs, no model call', async () => {
    const r = await run('TWO', 'make the left chart weekly; then add rsi to it')
    expect(r.marks).toContain('nlm1:rewrite=add-to-it')
    expect(r.turns).toEqual([])
    expect(r.after).toBe('NVDA/W[rsi(14)] AMD/D[]')
  }, 30000)

  it('kill switch: the same reworded request is v1 — the model gets it, as typed', async () => {
    const text = 'make the left chart weekly; then add rsi to it and make it orange'
    const r = await run('TWO', text, { nlm1: false })
    expect(r.turns).toEqual([text])
    expect(r.after).toBe(r.before)
  }, 30000)
})
