// ⛔ MULTI-STEP CONTINUITY (2026-11-14) · the APPROVED path. A card made on the answer turn of a pending task stores the words
// it was proposed from — and those include the request the answered question carried (useAgent turnWords). The proposal-time
// gate and constraint check are FORCED off while the card is made (a producer regression: a card that carries the excluded
// chart), so the approval alone must refuse it: "…except the TSLA one" → asked → "log" → a card with TSLA → Apply / "do it" →
// nothing runs. (The same construction as agentExcludedApproved, one turn later.) LOCAL / SIMULATED (BROWSER-MOCK-MODEL).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

const forced = { on: false }
vi.mock('./spatialCheck', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    checkSpatialConstraints: (args) => (forced.on ? null : real.checkSpatialConstraints(args)),
    withoutExcludedCharts: (ops, ...rest) => (forced.on ? { ops, dropped: 0 } : real.withoutExcludedCharts(ops, ...rest)),
  }
})
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const { registerBuiltins } = await import('./builtins')
const { setupPanel, FOUR } = await import('./testing/panelHarness')
registerBuiltins()
let p
beforeEach(() => { p = setupPanel(); forced.on = false })
afterEach(() => { forced.on = false; vi.restoreAllMocks(); cleanup() })

const chartOf = (b, sym) => b.context.charts.find(c => c.label === `Chart (${sym})`).ref
const clarify = (q) => ({ disposition: 'clarify', reply: q, question: { text: q, choices: [] }, ops: [], unsupported_category: null })
const logged = (board) => board.state.widgets.filter(x => x.opts?.settings?.logScale).map(x => x.id).sort()

describe('an approved card from a pending task\'s answer turn never runs on the chart that request excluded', () => {
  it.each([['the Apply button', null], ['typed "do it"', 'do it'], ['typed "yes"', 'yes']])('approved by %s', async (_how, said) => {
    const m = p.mount(...FOUR())
    p.st.envelopes.push(clarify('Which scale do you want — log or percent?'))
    await m.say('Change the price scale on all my charts except the TSLA one')
    forced.on = true
    p.st.envelopes.push(b => p.env('propose', ['SPY', 'QQQ', 'NVDA', 'TSLA'].map(s => ({ action: 'chart.setScale', target: chartOf(b, s), args: { scale: 'log' } }))))
    await m.say('log')
    forced.on = false
    expect(p.proposals().map(c => c.textContent).join(' '), 'the forced card must carry TSLA').toContain('Chart (TSLA)')
    if (said) await m.say(said)
    else await m.click('Apply')
    expect(logged(m.board), p.transcript()).toEqual([])
    expect(p.transcript()).toMatch(/excludes/)
  }, 40000)
})
