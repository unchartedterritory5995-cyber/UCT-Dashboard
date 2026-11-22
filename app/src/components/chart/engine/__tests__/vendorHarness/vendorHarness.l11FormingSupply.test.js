// ─── ⭐⭐ RS RATING L11 PR 2 — A RECORDED SUPPLY CARRIES THE SERVER'S `newest_bar_is_forming` ─────────────
//
// What the chart's newest bar reads of SP:SPX depends on whether the index session is in progress
// (`otherSymbols.newestOwnPeriodOf`, decided by the cache entry's `newestBarIsForming`, which the chart's
// entry takes from the bars route, `secondaryBars._read`). A capture taken IN SESSION is graded on the
// supply recorded beside it, so the record may carry the route's flag for a series (`other.<t>.newestBarIsForming`,
// the slot runner records it as `forming`): the harness hands it to the entry exactly as the chart would.
// Optional; a record without it supplies an entry without it (every committed record, so no grade moves).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { otherSymbolSupply, __setSupplyDirForTests } from './ourSide'
import { loadCapture, HARNESS_DIR, REPO } from './harness'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'

const RDDT = 'rs-rating-fred6724-rddt-1d-2026-11-15'
const cap = loadCapture(path.join(HARNESS_DIR, `${RDDT}.json`)).capture
const committed = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor-supply', `${RDDT}.json`), 'utf8'))
const def = memberPaneDefinition({ source: cap.source.text, id: 'u_l11-forming', name: 'RS Rating' }).definition

function dirWith(rec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l11-forming-'))
  fs.writeFileSync(path.join(dir, `${RDDT}.json`), JSON.stringify(rec))
  return dir
}
const withSpx = (extra) => ({ ...committed, other: { ...committed.other, SPX: { ...committed.other.SPX, ...extra } } })

afterEach(() => { __setSupplyDirForTests(null) })

describe('L11 PR 2 — the recorded flag reaches the entry the chart would build', () => {
  it('CONTROL: the committed record carries no flag, and the SPX entry carries none (no committed grade moves)', () => {
    expect(Object.prototype.hasOwnProperty.call(committed.other.SPX, 'newestBarIsForming')).toBe(false)
    const { secondary } = otherSymbolSupply(def, cap)
    expect(secondary.get('SPX').status).toBe('available')
    expect(Object.prototype.hasOwnProperty.call(secondary.get('SPX'), 'newestBarIsForming')).toBe(false)
  })

  it('a record saying the index session is on hands `true` to the entry, and says so in the notes', () => {
    __setSupplyDirForTests(dirWith(withSpx({ newestBarIsForming: true })))
    const { secondary, notes } = otherSymbolSupply(def, cap)
    expect(secondary.get('SPX').newestBarIsForming).toBe(true)
    expect(notes.join(' ')).toMatch(/other symbol SPX: .*; newest bar forming: true/)
  })

  it('`false` and `null` (the route\'s other two answers) are handed as they are', () => {
    for (const v of [false, null]) {
      __setSupplyDirForTests(dirWith(withSpx({ newestBarIsForming: v })))
      expect(otherSymbolSupply(def, cap).secondary.get('SPX').newestBarIsForming).toBe(v)
    }
  })

  it('⛔ anything but the route\'s tri-state is refused, never coerced', () => {
    for (const v of ['true', 1, 0, 'yes']) {
      __setSupplyDirForTests(dirWith(withSpx({ newestBarIsForming: v })))
      expect(() => otherSymbolSupply(def, cap)).toThrow(/newestBarIsForming must be the route's tri-state/)
    }
  })
})
