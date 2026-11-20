// ─── ⭐⭐ (coordinator ruling 2026-11-20, the SPX data gap) — AN OTHER SYMBOL'S BARS ARE UCT'S OWN, AND THE MEMBER IS TOLD ──
//
// A `request.security` of another symbol is served from UCT's own bars for that symbol (RS RATING L8), never TradingView's
// feed. MEASURED 2026-11-19 on Fred RS's NHDOT captures: our SP:SPX differs from TradingView's on 12-47% of dates, the RS
// line by up to 1.8e-2 relative on bars of histories reaching 1999. The grader proved it was the data
// (supply-attributed MATCH_SUBSTITUTED); the member door said nothing, while it did say so for `syminfo.industry`.
// These rails hold the disclosure (`symbolSubstitution.js::otherSymbolSourceNotesFor`):
//   1. one note per other symbol, named as the script spells it, the ruled sentence word for word;
//   2. BOTH member-door paths carry it (the host document and the runtime document), on the saved `meta.disclosures`;
//   3. a script reading no other symbol carries none, and the chart's OWN symbol (`syminfo.tickerid`) never does;
//   4. Fred RS carries it for its `SP:SPX` read.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition, __forceRuntimeLaneForTests } from './memberPaneDefinition'
import { __resetRuntimePanePermission, __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from '../../engine/runtimeKill'
import { otherSymbolSourceNotesFor, OTHER_SYMBOL_SOURCE_NOTE } from '../../engine/ast/symbolSubstitution'

const RULED = "This script reads `AMEX:SPY`. It uses UCT's own data for that symbol, not TradingView's feed. The two "
  + "agree on most dates but not all, so values built from it can differ from TradingView's chart, most often on older bars."
const OTHER = '//@version=6\nindicator("other")\nplot(request.security("AMEX:SPY", "D", close))\n'
const NONE = '//@version=6\nindicator("none")\nplot(close)\n'
const OWN = '//@version=6\nindicator("own")\nplot(request.security(syminfo.tickerid, "D", close))\n'
const FRED = fs.readFileSync(path.join(path.resolve(process.cwd(), '..'), 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')

const sourceNotes = (built) => (built.notes || []).filter((n) => n && n.note === OTHER_SYMBOL_SOURCE_NOTE(n.name))
const saved = (built) => ((built.definition && built.definition.meta && built.definition.meta.disclosures) || [])
  .filter((n) => n && n.note === OTHER_SYMBOL_SOURCE_NOTE(n.name))

function runtimeLane(source) {
  __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); setRuntimeKillList([])
  __forceRuntimeLaneForTests(true)
  try { return memberPaneDefinition({ source }) } finally { __forceRuntimeLaneForTests(false) }
}

afterEach(() => { __forceRuntimeLaneForTests(false); __resetRuntimePanePermission() })

describe('1. the note: one per other symbol, the ruled sentence, named as spelled', () => {
  it('the sentence is the ruling, word for word', () => {
    expect(OTHER_SYMBOL_SOURCE_NOTE('AMEX:SPY')).toBe(RULED)
  })
  it('one per symbol, by its spelling; duplicates and malformed rows say nothing more', () => {
    const got = otherSymbolSourceNotesFor([{ ticker: 'SPX', spellings: ['SP:SPX'] }, { ticker: 'SPX', spellings: ['SP:SPX'] },
      { ticker: 'QQQ', spellings: [] }, null, { ticker: '' }, { spellings: ['X'] }])
    expect(got.map((n) => n.name)).toEqual(['SP:SPX', 'QQQ'])
    expect(got.every((n) => n.note === OTHER_SYMBOL_SOURCE_NOTE(n.name))).toBe(true)
    expect(otherSymbolSourceNotesFor(undefined)).toEqual([])
  })
})

describe('2. both member-door paths carry it, on the saved document', () => {
  it('the HOST document', () => {
    const built = memberPaneDefinition({ source: OTHER })
    expect(built.ok, built.reason).toBe(true)
    expect(sourceNotes(built).map((n) => n.name)).toEqual(['AMEX:SPY'])
    expect(saved(built).map((n) => n.note)).toEqual([RULED])
  })
  it('the RUNTIME document', () => {
    const built = runtimeLane(OTHER)
    expect(built.ok, built.reason).toBe(true)
    expect(built.definition.compute && built.definition.compute.kind, 'the runtime lane drew it').toBe('runtime')
    expect(sourceNotes(built).map((n) => n.name)).toEqual(['AMEX:SPY'])
    expect(saved(built).map((n) => n.note)).toEqual([RULED])
  })
})

describe('3. no other symbol, no note; the chart\'s own symbol never carries one', () => {
  for (const [what, source] of [['reads no other symbol', NONE], ['reads only its own symbol', OWN]]) {
    it(`a script that ${what}: none on either path`, () => {
      const host = memberPaneDefinition({ source })
      expect(host.ok, host.reason).toBe(true)
      expect(sourceNotes(host)).toEqual([])
      expect(saved(host)).toEqual([])
      const rt = runtimeLane(source)
      expect(sourceNotes(rt)).toEqual([])
    })
  }
})

describe('4. Fred RS says it for its SP:SPX read', () => {
  it('the member door names SP:SPX', () => {
    const built = memberPaneDefinition({ source: FRED })
    expect(built.ok, built.reason).toBe(true)
    const names = sourceNotes(built).map((n) => n.name)
    expect(names.some((n) => /SPX/.test(n)), JSON.stringify(names)).toBe(true)
    expect(saved(built).length).toBe(names.length)
  })
})
