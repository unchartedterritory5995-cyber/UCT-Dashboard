// Wave 3 W3-4 (w3-a, 2026-11-03): the single-turn coaching workflow in the browser — `coach.next` quick replies
// (pure, deterministic, figure-free) ride on the coach's own answers and the panel shows them as chips; a tap is
// the member's own next message (fast path or model, the same guard and consent rule). Scripted model only.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { loadAgentConfig, _resetAgentConfig, noteConversation } from './agentClient'
import { registerBuiltins, registerServerGatedBuiltins } from './builtins'
import { explainConcept, reviewTrades, _resetCoachForTest } from './capabilities/coach'
import { nextFor, MAX_NEXT } from './coach/next'
import { loadConcepts, _resetConceptsForTest } from './coach/concepts'
import { _resetConsentForTest } from './coach/consent'
import { _resetObserveForTest } from './coach/observe'
import { figures, FOOTER } from './coach/guard'
import { setupPanel, ONE } from './testing/panelHarness'

vi.mock('./trace', async (orig) => ({ ...(await orig()), currentTurnId: () => 't-coach' }))

const CONCEPTS = [
  { id: 'breakouts-and-failure', title: 'Breakouts and failed breakouts', aliases: ['breakout', 'failed breakout'], observe: 'none', text: 'Breakouts and failed breakouts. A move through a level. Uncertainty: it may fail.', sections: {} },
  { id: 'consolidation-tightness', title: 'Consolidation and tightness', aliases: ['consolidation'], observe: 'none', text: 'Consolidation and tightness. A narrowing range. Uncertainty: it may widen.', sections: {} },
  { id: 'volume-relative-volume', title: 'Volume and relative volume', aliases: ['volume'], observe: 'none', text: 'Volume and relative volume. Shares traded. Uncertainty: it may mean nothing.', sections: {} },
  { id: 'expectancy', title: 'Expectancy', aliases: ['expectancy'], observe: 'none', text: 'Expectancy. The average result. Uncertainty: it is an estimate.', sections: {} },
  { id: 'stop-placement', title: 'Stop placement principles', aliases: ['stop'], observe: 'none', text: 'Stop placement principles. Where the idea is wrong. Uncertainty: gaps may happen.', sections: {} },
]
const ROWS = [{ id: 't1', symbol: 'AAA', entryDate: '2026-10-28', exitDate: '2026-10-30', rMultiple: 2.0, holdDays: 2, result: 'Win', pnlPercent: 20, mistakeTags: [], emotionTags: [] },
  { id: 't2', symbol: 'BBB', entryDate: '2026-10-26', exitDate: '2026-10-27', rMultiple: -1.0, holdDays: 1, result: 'Loss', pnlPercent: -5, mistakeTags: ['chased'], emotionTags: [] }]
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const host = (charts = [{ ref: 'c1', label: 'Chart (NVDA)', symbol: 'NVDA' }]) => ({ charts: { list: () => charts, read: () => null, selected: () => null } })

function stub(base = null, consent = null) {
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET'
    if (u === '/api/agent/config') return json({ stream: false, data: false, data_kinds: [], coach: true })
    if (u === '/api/agent/coach/concepts') return json({ concepts: CONCEPTS, footer: FOOTER })
    if (/\/state\/coachConsent$/.test(u)) return json({ key: 'coachConsent', value: method === 'PUT' ? { granted: JSON.parse(init.body).value.granted } : consent })
    if (u.startsWith('/api/j2/trades')) return json({ trades: ROWS, total: 2 })
    return base ? base(url, init) : json({})
  })
}

beforeEach(() => {
  _resetAgentConfig(); _resetConceptsForTest(); _resetObserveForTest(); _resetCoachForTest(); _resetConsentForTest()
  noteConversation('ac_1')
})

describe('nextFor (pure)', () => {
  it('after an explanation: a what-to-check question (with a chart), related concepts, and the review only with consent', () => {
    const a = nextFor({ after: 'explain', conceptId: 'breakouts-and-failure', consent: 'unknown', hasChart: true, concepts: CONCEPTS })
    expect(a).toEqual(['What should I check on this chart for breakouts and failed breakouts?', 'Coach me on consolidation and tightness', 'Coach me on volume and relative volume'])
    const b = nextFor({ after: 'explain', conceptId: 'breakouts-and-failure', consent: 'granted', hasChart: false, concepts: CONCEPTS })
    expect(b).toEqual(['Coach me on consolidation and tightness', 'Coach me on volume and relative volume', 'Review my trades'])
    expect(nextFor({ after: 'explain', conceptId: 'nope', concepts: CONCEPTS })).toEqual([])
  })
  it('after a review and after consent; never more than three, never a figure, never an order', () => {
    expect(nextFor({ after: 'review', consent: 'granted', concepts: CONCEPTS })).toEqual(['Write that up as a note for my journal', 'Coach me on expectancy', 'Coach me on stop placement principles'])
    expect(nextFor({ after: 'consent', consent: 'granted', concepts: CONCEPTS })).toEqual(['Review my trades', 'Review my last 20 trades'])
    expect(nextFor({ after: 'consent', consent: 'revoked', concepts: CONCEPTS })).toEqual(['Coach me on expectancy'])
    expect(nextFor({})).toEqual([])
    for (const after of ['explain', 'review', 'consent']) for (const consent of ['granted', 'unknown']) {
      const xs = nextFor({ after, conceptId: 'expectancy', consent, hasChart: true, concepts: CONCEPTS })
      expect(xs.length).toBeLessThanOrEqual(MAX_NEXT)
      for (const x of xs) { expect(figures(x).size, x).toBe(after === 'consent' && x.includes('20') ? 1 : 0); expect(x).not.toMatch(/\b(buy|sell|short)\b/i) }
    }
  })
})

describe('the coach’s own answers carry `next`', () => {
  it('explain and review answers suggest the next step', async () => {
    stub(null, { granted: true })
    await loadAgentConfig(); registerBuiltins(); registerServerGatedBuiltins(); await loadConcepts()
    const a = await explainConcept('failed breakout', host())
    expect(a.next).toEqual(['What should I check on this chart for breakouts and failed breakouts?', 'Coach me on consolidation and tightness', 'Coach me on volume and relative volume'])
    const r = await reviewTrades(null)
    expect(r.next[0]).toBe('Write that up as a note for my journal')
  })
})

describe('🔴 PANEL: the chips are shown under the answer and a tap is the member’s own next message', () => {
  it('coach me on a failed breakout → chips → tap "Coach me on consolidation and tightness" → that concept, instantly', async () => {
    const p = setupPanel()
    stub(globalThis.fetch)
    const { say } = p.mount(...ONE('NVDA'))
    await loadConcepts()
    const first = await say('coach me on a failed breakout')
    expect(first).toContain('A move through a level.')
    expect(first).toContain(FOOTER)
    const chips = screen.getByTestId('agent-next').querySelectorAll('button')
    expect([...chips].map(b => b.textContent)).toEqual(['What should I check on this chart for breakouts and failed breakouts?', 'Coach me on consolidation and tightness', 'Coach me on volume and relative volume'])
    const before = p.turns()
    fireEvent.click(chips[1])
    await p.idle(); await new Promise(r => setTimeout(r, 0)); await p.idle()
    const all = p.transcript()
    expect(all).toContain('Coach me on consolidation and tightness')          // the member's own line
    expect(all).toContain('A narrowing range.')                                 // answered from the concept text
    expect(p.turns()).toBe(before)                                              // instantly: no model turn
    expect(screen.getAllByTestId('agent-next').length).toBe(2)                 // the new answer has its own chips
  })
})
