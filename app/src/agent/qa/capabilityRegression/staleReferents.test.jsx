// CAPABILITY REGRESSION · STALE REFERENTS (11-18): a bare pronoun follow-up ("make it red", "hide it", "make it a 50") points
// at what the conversation LAST did — never at an object an earlier request left behind once the member has moved on.
//
// The class (master before this fix): the follow-up readers (conversation.js aboutIndicators, references.js "make it a 9")
// asked only "was the last COMMITTED change an indicator change?". A member message in between that committed NOTHING — a
// no-op ("turn on the grid lines": already on), a refusal ("save this layout": not on this page), a request the model handled
// in words or asked about ("alert me when NVDA crosses 100", "make the candles green") — left that answer unchanged, so
// "make it thicker" right after "turn on the grid lines" thickened the EMA added two messages earlier, with no question.
//
// Generated: every prior shape (an indicator added / edited) × every unrelated non-committing message × every pronoun
// follow-up → NOTHING changes by itself (the model reads it: it asks or acts on what the member means). Controls, same
// generator: right after the change, or after a message that keeps the thread (an acknowledgement, a message naming the
// indicator, a no-op on the same indicator) the follow-up still acts at once, with no question.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import { registerCatalog } from './testing/registry'
import { replay } from './testing/run'
import { pinClock } from './testing/clock'
import { boardState, receiptsNow } from './testing/harness'
import { createMemory } from '../../memory'

pinClock()
vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

// what the conversation did last (each commits one indicator change)
const PRIORS = {
  'ema-added': ['add a 20 ema'],
  'rsi-added': ['add rsi'],
  'ema-edited': ['add a 20 ema', 'make it a 50'],
}
// a member message about something ELSE that commits nothing (TIMED: one NVDA chart, no layouts on this page)
const UNRELATED = {
  'noop-other-setting': 'turn on the grid lines',          // deterministic: "Nothing to change — Grid lines is already on."
  'refused-other-object': 'save this layout as Swing',     // deterministic refusal: layouts aren't on this page
  'model-other-request': 'alert me when nvda crosses 100', // the model's (answered in words here: no plan)
  'model-other-style': 'make the candles green',
  'question-other': 'what timeframe is this chart',
}
// messages that KEEP the thread on the indicator (controls: the follow-up still acts)
const KEEPS = {
  'ack': 'thanks',
  'ack-2': 'ok cool',
}
// the pronoun follow-ups (each acts at once right after the change: the controls below)
const FOLLOWUPS = ['make it red', 'make it thicker', 'hide it', 'make it a 30', 'make that blue']
// (RSI has no line width the readers change by "thicker": that phrasing is generated for the moving averages only)
const followupsOf = (pk) => FOLLOWUPS.filter(f => !(pk.startsWith('rsi') && f === 'make it thicker'))

async function run(prior, follow) {
  const m = await replay({ board: 'TIMED', steps: prior.map(say => ({ say })) }, prior.join(' → '))
  await m.p.idle?.()
  const before = boardState(m.board)
  const receipts = receiptsNow().length
  await m.say(follow)
  await m.p.idle?.()
  return { m, before, receipts }
}

describe('stale referents: an unrelated message in between leaves "it" unbound (nothing changes by itself)', () => {
  for (const [pk, prior] of Object.entries(PRIORS)) {
    for (const [uk, between] of Object.entries(UNRELATED)) {
      for (const f of followupsOf(pk)) {
        it(`${pk} · ${uk} · "${f}"`, async () => {
          const { m, before, receipts } = await run([...prior, between], f)
          await new Promise(r => setTimeout(r, 50))
          expect(boardState(m.board), `"${f}" after "${between}" changed nothing`).toBe(before)
          expect(receiptsNow().length, 'no receipt').toBe(receipts)
        }, 60000)
      }
    }
  }
})

describe('controls: the thread is still on the indicator — the follow-up acts at once', () => {
  for (const [pk, prior] of Object.entries(PRIORS)) {
    for (const f of followupsOf(pk)) {
      it(`${pk} · right after · "${f}"`, async () => {
        const { m, before } = await run(prior, f)
        await waitFor(() => expect(boardState(m.board), `"${f}" acted`).not.toBe(before), { timeout: 6000 })
      }, 60000)
      for (const [kk, between] of Object.entries(KEEPS)) {
        it(`${pk} · ${kk} · "${f}"`, async () => {
          const { m, before } = await run([...prior, between], f)
          await waitFor(() => expect(boardState(m.board), `"${f}" after "${between}" acted`).not.toBe(before), { timeout: 6000 })
        }, 60000)
      }
    }
  }
  // a message NAMING the indicator, and a no-op on the SAME indicator, keep the thread
  for (const [id, steps] of [
    ['names-it', ['add a 20 ema', 'what is the ema at', 'make it red']],
    ['names-it-rsi', ['add rsi', 'is the rsi overbought', 'make it red']],
    ['noop-same', ['add a 20 ema', 'make it red', 'make it red', 'make it thicker']],
    ['noop-same-edit', ['add a 20 ema', 'make it a 20', 'hide it']],
  ]) {
    it(id, async () => {
      const { m, before } = await run(steps.slice(0, -1), steps.at(-1))
      await waitFor(() => expect(boardState(m.board), `"${steps.at(-1)}" acted`).not.toBe(before), { timeout: 6000 })
    }, 60000)
  }
})

describe('memory.pronounLive (unit)', () => {
  it('a committed change, then an unrelated message that commits nothing → unbound on the next message', () => {
    const mem = createMemory()
    mem.beginTurn(); mem.noteChange({ ops: [{ action: 'indicator.add', target: 'ixe:c1', args: {} }] })
    mem.beginTurn(); expect(mem.pronounLive()).toBe(true)        // right after the change
    mem.beginTurn(); expect(mem.pronounLive()).toBe(false)       // one message that did nothing in between
  })
  it('pointing back (noteEngaged) keeps the thread for the next message; a new commit restarts it', () => {
    const mem = createMemory()
    mem.beginTurn(); mem.noteChange({ ops: [{ action: 'indicator.add', target: 'ixe:c1', args: {} }] })
    mem.beginTurn(); mem.noteEngaged()
    mem.beginTurn(); expect(mem.pronounLive()).toBe(true)
    mem.beginTurn(); mem.beginTurn(); expect(mem.pronounLive()).toBe(false)
    mem.noteChange({ ops: [{ action: 'chart.setTimeframe', target: 'c1', args: {} }] })
    expect(mem.pronounLive()).toBe(true)                          // the message now being answered committed
  })
})
