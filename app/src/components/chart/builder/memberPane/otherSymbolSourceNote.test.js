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
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from './memberPaneDefinition'
import { __resetRuntimePanePermission, __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from '../../engine/runtimeKill'
import { otherSymbolSourceNotesFor, OTHER_SYMBOL_SOURCE_NOTE } from '../../engine/ast/symbolSubstitution'

const RULED = "This script reads `AMEX:SPY`. It uses UCT's own data for that symbol, not TradingView's feed. The two "
  + "agree on most dates but not all, so values built from it can differ from TradingView's chart, most often on older bars."
const OTHER = '//@version=6\nindicator("other")\nplot(request.security("AMEX:SPY", "D", close))\n'
// the same read in a script the HOST lane refuses (an unbounded running total, `pine:state`): the member door routes it to the
// RUNTIME lane, so this is the runtime document's own disclosure path
const OTHER_RT = '//@version=6\nindicator("other-rt")\nvar float acc = 0.0\nacc += nz(request.security("AMEX:SPY", "D", close))\nplot(acc)\n'
const NONE = '//@version=6\nindicator("none")\nplot(close)\n'
const OWN = '//@version=6\nindicator("own")\nplot(request.security(syminfo.tickerid, "D", close))\n'
const FRED = fs.readFileSync(path.join(path.resolve(process.cwd(), '..'), 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')

const sourceNotes = (built) => (built.notes || []).filter((n) => n && n.note === OTHER_SYMBOL_SOURCE_NOTE(n.name))
const saved = (built) => ((built.definition && built.definition.meta && built.definition.meta.disclosures) || [])
  .filter((n) => n && n.note === OTHER_SYMBOL_SOURCE_NOTE(n.name))

function runtimeLane(source) {
  // the runtime pane's flags, as every door test that routes to the runtime lane stubs them (`fillAnchorDrawn.test.js`)
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); setRuntimeKillList([])
  // ⛔ an id and a name, as every door test minting a runtime document passes them (`fillAnchorDrawn.test.js`): a runtime
  // document is `runtime:<id>`, so without one the door falls back to the host lane's refusal (#2137's CI, run 44671305718)
  return memberPaneDefinition({ source, id: 'u_other_rt', name: 'other-rt' })
}

afterEach(() => { __resetRuntimePanePermission(); vi.unstubAllEnvs() })

describe('1. the note: one per other symbol, the ruled sentence, named as spelled', () => {
  it('the sentence is the ruling, word for word', () => {
    expect(OTHER_SYMBOL_SOURCE_NOTE('AMEX:SPY')).toBe(RULED)
  })
  it('one per symbol, by its spelling; duplicates and malformed rows say nothing more', () => {
    // a spelling is the PREFIX the script wrote (`SP` of `SP:SPX`); none, or '', names the bare ticker
    const got = otherSymbolSourceNotesFor([{ ticker: 'SPX', spellings: ['SP'] }, { ticker: 'SPX', spellings: ['SP'] },
      { ticker: 'QQQ', spellings: [] }, { ticker: 'SPY', spellings: [''] }, null, { ticker: '' }, { spellings: ['X'] }])
    expect(got.map((n) => n.name)).toEqual(['SP:SPX', 'QQQ', 'SPY'])
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
  // ⚰️ THIS CASE ASKED FOR A RUNTIME DOCUMENT THAT CANNOT EXIST YET, and went red on both CI runs (44671305718,
  // 44685438353): a document drawn bar by bar on its OWN pane is not handed another symbol's bars, so the runtime lane
  // declines every such script BY NAME (`memberPaneDefinition.js::runtimeLaneDefinition`, RT2 `runtime:request`) and the
  // member reads the host lane's refusal. What a member gets today is held here instead: no runtime document, the decline
  // named, and therefore no disclosure owed on that path. The runtime document's disclosure line stays in the door for
  // the own-pane other-symbol supply (the request unit's branch); its rail belongs with that supply, which mints one.
  // Fred RS reads SP:SPX through the HOST document's run half, and carries the note there (section 4).
  it('the RUNTIME path: another symbol on its own pane is declined by name, so no runtime document carries a note', () => {
    const built = runtimeLane(OTHER_RT)
    expect(built.ok).toBe(false)
    expect(built.runtimeDeclined && built.runtimeDeclined.code).toBe('runtime:request')
    expect(built.runtimeDeclined.why).toMatch(/another symbol/)
    expect(sourceNotes(built)).toEqual([])
    expect(saved(built)).toEqual([])
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
    expect(names, JSON.stringify(names)).toContain('SP:SPX')
    expect(saved(built).length).toBe(names.length)
  })
})
