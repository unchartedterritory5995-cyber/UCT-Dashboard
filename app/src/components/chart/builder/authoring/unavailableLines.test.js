// app/src/components/chart/builder/authoring/unavailableLines.test.js
//
// ⭐ 2026-11-01 — "mark a doji" / "every inside day" on the chart door. The planner names a
// SCREENER text column (`candle_matches`, `bar_character`) as unavailable. When the model
// built the idea from bars anyway, the turn used to end "candle_matches isn't available yet —
// TEXT -- …": an internal column name and manifest prose under a working indicator.
import { describe, it, expect } from 'vitest'
import { newAuthoringState } from './index'
import { modelTurn, unavailableLines } from './authoringSession'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'

const CANDLE = { phrase: 'doji', name: 'candle_matches', reason: 'TEXT -- the Candle Matches column, a list of names' }
const withUnavailable = (inner, list) => async (args) => ({ ...(await inner(args)), unavailable: list })
const allText = (out) => out.entries.flatMap((e) => e.lines || []).join('\n')

describe('unavailable screener columns, in member words', () => {
  it('a turn that BUILT something does not contradict it', async () => {
    const st = newAuthoringState()
    const out = await modelTurn(st, () => st, 'Add a 20 EMA', { converse: withUnavailable(scriptedConverse, [CANDLE]) })
    expect(out).toMatchObject({ ok: true, changed: true })
    expect(allText(out)).not.toMatch(/candle_matches|isn't available|TEXT --|text label/)
  })

  it('a turn that built nothing says it plainly, with no column name or manifest prose', async () => {
    const st = newAuthoringState()
    const out = await modelTurn(st, () => st, 'color the bars by sector', {
      converse: async () => ({ ok: true, disposition: 'unsupported', reply: 'A chart formula reads numbers, not sectors.',
        turn: 'noop', envelope: null, unavailable: [{ phrase: 'sector', name: 'sector', reason: 'TEXT -- GICS sector' }] }),
    })
    const text = allText(out)
    expect(text).toMatch(/“sector” is in UCT's screener data, which a chart formula can't read\./)
    expect(text).not.toMatch(/TEXT --|GICS/)
  })

  it('one line per phrase, never the internal column name when the phrase is known', () => {
    expect(unavailableLines({ unavailable: [CANDLE, { ...CANDLE }, { phrase: 'Doji', name: 'candle_matches' }] }))
      .toEqual(['“doji” is in UCT\'s screener data, which a chart formula can\'t read.'])
    // ⭐ 11-02 review: most excluded columns are NOT text (enterprise value, EPS, dates), so
    // the line never claims "text label".
    expect(unavailableLines({ unavailable: [{ phrase: 'enterprise value', name: 'enterprise_value', reason: 'NUMBER -- Wave 7' }] }))
      .toEqual(['“enterprise value” is in UCT\'s screener data, which a chart formula can\'t read.'])
    expect(unavailableLines({ unavailable: [] })).toEqual([])
    expect(unavailableLines(null)).toEqual([])
  })
})
