// app/src/components/chart/engine/__tests__/objectFnInline.vendor.test.js
//
// ─── ⭐⭐ C13 AGAINST TRADINGVIEW: what the inliner now carries, and what it withholds ─
//
// Triage class C13 (`docs/pine/vendor-harness/objects-triage-2026-09-28.md`,
// step 13). Graded on the committed NYSE:RDDT 1D captures through the member
// door with the objects-only flag on, exactly as the harness grades them.
//
//   • `high-low-open-mid-ranges` — every drawing helper is called under an
//     `input.bool` guard (`if tfbool` / `if i_q` / `if i_t`) and was refused as
//     conditional-history. It is inlined now: 37 of TradingView's 45 table cells
//     are drawn and EVERY one of them is a cell TradingView shows. Its lines and
//     labels are WITHHELD: the collector cuts both families and the program
//     lost creates in both (the `vline` dividers' guard, labels whose text or
//     y this chart cannot read), so the held set could not be TradingView's.
//   • `sector-rotation` — its 50/50 line count was a coincidence: TradingView
//     holds two lines per bar, ours one. Withheld.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { HARNESS_DIR } from './vendorHarness/harness'
import { runOurSide, enterMemberDoor, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import * as registry from '../nativeRegistry'

const FLAG = 'VITE_PINE_OBJECTS_ONLY_PANE_ENABLED'
const load = (slug) => JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, `${slug}-rddt-1d-2026-09-28.json`), 'utf8'))

afterEach(() => { vi.unstubAllEnvs() })

/** Is `sub` a sub-multiset of `all`? */
function subMultiset(sub, all) {
  const left = new Map()
  for (const x of all) left.set(x, (left.get(x) || 0) + 1)
  for (const x of sub) {
    const n = left.get(x) || 0
    if (!n) return x
    left.set(x, n - 1)
  }
  return null
}

function translationOf(cap) {
  const door = enterMemberDoor(cap.source.text)
  try {
    return door.built && door.built.translation
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}

describe('high-low-open-mid-ranges — the input-guarded helpers are inlined', () => {
  it('⭐ no call is refused as conditional-history any more', () => {
    vi.stubEnv(FLAG, '1')
    const t = translationOf(load('high-low-open-mid-ranges'))
    const refused = (t.objectDiagnostics.refusedCalls || []).join(' | ')
    expect(refused).not.toMatch(/conditional-history/)
    expect(t.objectDiagnostics.inlinedCalls).toBeGreaterThanOrEqual(62)
  })

  it('⭐ 37 of TradingView\'s 45 cells are drawn, and every one is a cell TradingView shows', () => {
    vi.stubEnv(FLAG, '1')
    const cap = load('high-low-open-mid-ranges')
    const ours = runOurSide(cap)
    expect(ours.objects && ours.objects.ok, ours.objects && ours.objects.reason).toBe(true)
    expect(cap.objects.counts.tableCells).toBe(45)
    expect(ours.objects.counts.tableCells).toBe(37)
    const extra = subMultiset(ours.objects.texts.tableCells.map(String), cap.objects.texts.tableCells.map(String))
    expect(extra, `a cell TradingView does not show: ${JSON.stringify(extra)}`).toBeNull()
  })

  // ⚰️ This read "its lines and labels are WITHHELD". C33 (2026-09-30) carried
  // every label create (an `input.timeframe` text, a getter and its history in a
  // text, an `na` text-colour arm), so the label family lost nothing and holds
  // TradingView's 504 — text, price and order pinned in
  // `vendorHarness.c33ObjectReads`. The LINES are still withheld: the `vline`
  // divider's guard has a term this lane does not read (`time(<timeframe>)`).
  it('⛔ its lines are WITHHELD (TradingView may have collected them differently); its labels are the 504', () => {
    vi.stubEnv(FLAG, '1')
    const cap = load('high-low-open-mid-ranges')
    const ours = runOurSide(cap)
    expect(ours.objects.counts.lines).toBe(0)
    expect(ours.objects.counts.labels).toBe(cap.objects.counts.labels)
    expect(cap.objects.counts.labels).toBe(504)
    // ⭐ the evidence the count alone hid: TradingView holds FIVE lines a week
    // (four ranges + the `vline` divider this chart cannot guard), 101 weeks.
    const perX = new Map()
    for (const r of cap.objects.records.lines) perX.set(r.x1, (perX.get(r.x1) || 0) + 1)
    const fives = [...perX.values()].filter((n) => n === 5).length
    expect(fives).toBeGreaterThan(90)
    expect(cap.objects.records.lines.some((r) => r.ex === 'b')).toBe(true) // the extend.both divider
  })
})

describe('sector-rotation — a coincidental count is not a match', () => {
  it('⛔ its lines are withheld: TradingView holds two per bar where this chart makes one', () => {
    vi.stubEnv(FLAG, '1')
    const cap = load('sector-rotation')
    const perX = new Map()
    for (const r of cap.objects.records.lines) perX.set(r.x1, (perX.get(r.x1) || 0) + 1)
    expect([...perX.values()].filter((n) => n >= 2).length).toBeGreaterThan(20)
    const ours = runOurSide(cap)
    expect(ours.objects.ok).toBe(true)
    expect(ours.objects.counts.lines).toBe(0)
  })
})
