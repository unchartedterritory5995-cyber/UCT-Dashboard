// ⭐ P0.2 / AUDIT NO-GO R (11-24): the ONE no-card path for a revert-only plan — a drawing verb that GOVERNS a drawing object (owner
// 10-27: a visible drawing is deleted at once). Turn 1 draws a trendline on NVDA; turn 2's model plan removes it (a revert of the last
// change). Generated: the drawing kinds' declared verbs × governing frames (a declared noun, a lone pronoun) → deleted at once, no
// card; the same verbs as a noun / an adjective / with another object / negated / asked, and vague complaints → the revert card,
// the drawing still there until the pick. × routing v1 / v2 × apply / propose, in the REAL drawings store. Plus drift: a drawing
// added under the card makes the pick refuse.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as store from '../../../components/chart/drawingsStore'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, drawingsOf, must, waitFor } from './outcomeHarness'
import { getCapability } from '../../capabilities'
import { screen, fireEvent } from '@testing-library/react'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)
beforeEach(() => { for (const s of ['SPY', 'QQQ', 'NVDA', 'TSLA']) store.clearAll(s) })

const CARD = 'back the way it was before my last change'
const peek = (s) => store.peekDrawings(s)
const TREND = (ctx, symbol) => ({ action: 'drawing.addTrendline', target: drawingsOf(ctx, symbol).ref, args: { from: { date: '2026-10-01', price: 100 }, to: { date: '2026-10-20', price: 120 }, color: null, style: null } })
const recent = (ctx, symbol) => must(drawingsOf(ctx, symbol).drawings.find(d => d.recent), `recent drawing on ${symbol}`)
const REMOVE = (ctx, symbol) => ({ action: 'drawing.remove', target: drawingsOf(ctx, symbol).ref, args: { drawing: recent(ctx, symbol).id } })

const { verbs, nouns } = getCapability('drawing.remove') || { verbs: ['remove'], nouns: ['line'] }
const GOVERNED = [(v) => `${v} it`, (v) => `${v} that`, (v) => `${v} the ${nouns[0]}`, (v) => `ok, ${v} that ${nouns[4] || nouns[0]} please`, (v) => `go ahead and ${v} the new ${nouns[2] || nouns[0]}`]
const NOT_GOVERNED = [(v) => `the ${v} was wrong`, (v) => `${v}, but not quite`, (v) => `${v} the guesswork`, (v) => `${v} the rsi`, (v) => `don't ${v} it`,
  (v) => `should I ${v} it?`, () => 'fix that', () => "that's wrong", () => 'hmm, try again', (v) => `no, wrong, ${v}`]
const combos = []
for (const nlm1 of [false, true]) for (const mode of ['apply', 'propose']) combos.push({ nlm1, mode })
const tag = (c) => `routing ${c.nlm1 ? 'v2' : 'v1'} · ${c.mode}`
async function drawn(c) {
  const m = open(QUAD(), QUAD_SYMS, { extra: { drawings: true }, selected: 'bl', seed: { nlm1: c.nlm1 } })
  await m.say('draw a trendline', (ctx) => [TREND(ctx, 'NVDA')])
  await waitFor(() => expect(peek('NVDA')).toHaveLength(1))
  return m
}
const turns = (m) => m.p.st.calls.filter(x => x[1] === '/api/agent/turn').length

describe('a drawing verb that GOVERNS a drawing object: deleted at once, no revert card', () => {
  const rows = []
  combos.forEach((c, i) => verbs.forEach((v, k) => rows.push([tag(c), GOVERNED[(i + k) % GOVERNED.length](v), c])))
  it.each(rows)('%s: "%s"', async (_t, text, c) => {
    const m = await drawn(c)
    const t0 = turns(m)
    const out = await m.say(text, (ctx) => [REMOVE(ctx, 'NVDA')], { disposition: c.mode })
    if (turns(m) === t0) return                                                  // an instant reader took it (its own path)
    expect(out).not.toContain(CARD)
    if (m.pending()) await m.apply()                                             // propose: the model's own card
    await waitFor(() => expect(peek('NVDA')).toEqual([]))
  }, 40000)
})

describe('the same verbs as a noun / adjective / with another object / negated / asked, and vague complaints: the revert card', () => {
  const rows = []
  combos.forEach((c, i) => verbs.forEach((v, k) => { for (const j of [i + k, i + k + 5]) rows.push([tag(c), NOT_GOVERNED[j % NOT_GOVERNED.length](v), c, j % 2]) }))
  it.each(rows)('%s: "%s"', async (_t, text, c, pick) => {
    const m = await drawn(c)
    const t0 = turns(m)
    const out = await m.say(text, (ctx) => [REMOVE(ctx, 'NVDA')], { disposition: c.mode })
    if (turns(m) === t0) { expect(peek('NVDA')).toHaveLength(1); return }      // read on the instant path: still there
    if (out.includes('Did you mean the ticker')) { expect(peek('NVDA')).toHaveLength(1); return }
    expect(out).toContain(CARD)
    expect(peek('NVDA')).toHaveLength(1)                                        // nothing changed before the pick
    fireEvent.click(screen.getAllByRole('button', { name: pick ? 'Apply' : 'Cancel' }).at(-1))
    await m.p.idle()
    // Apply: the removal still passes execute's own destructive-words rail — the card never bypasses it. With words that never named a
    // removal it refuses ("…you didn't ask for that"), and the drawing stays; either way nothing was removed silently
    if (pick && /you didn.t ask for that/.test(m.p.transcript())) expect(peek('NVDA')).toHaveLength(1)
    else if (pick) await waitFor(() => expect(peek('NVDA')).toEqual([]))
    else expect(peek('NVDA')).toHaveLength(1)
  }, 40000)
})

describe('drift: a drawing added under the card makes the pick refuse', () => {
  it.each(combos.map(c => [tag(c), c]))('%s', async (_t, c) => {
    const m = await drawn(c)
    const t0 = turns(m)
    const out = await m.say('fix that', (ctx) => [REMOVE(ctx, 'NVDA')], { disposition: c.mode })
    if (turns(m) === t0) return
    expect(out).toContain(CARD)
    store.addDrawing('NVDA', { type: 'horizontal', points: [{ price: 50 }], color: '#fff', lineWidth: 1 })   // the target drifts
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' }).at(-1))
    await m.p.idle()
    expect(m.p.transcript()).toContain('Your board changed since I asked')
    expect(peek('NVDA')).toHaveLength(2)
  }, 40000)
})
