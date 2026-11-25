// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.candleNotDrawn.test.js
//
// ─── ⭐ e97 U5 — A CANDLE OUR DOOR DID NOT DRAW IS GRADED BY THE DOOR'S OWN REASON ──────────────────────────────────
//
// `kernel-channel-backquant` writes `plotcandle(..., display = useBarColor ? display.all : display.none)` with
// `useBarColor = input.bool(false, ...)`. The runtime door does not draw that candle, and says why in its note
// ("`Bar Coloring` is not drawn: its `display = unread` is not a place this pane reads"): it withholds it BY NAME.
// Graded as "the member pane did not carry this output (hidden helper or beyond its row ceiling)" the harness named
// a cause that was not the cause. The door now lists each candle it does not draw (`candlesNotDrawn`: hidden by its
// author, or withheld with its reason), `ourSide.js::candleNotDrawnOf` carries the sentence, and `compare.mjs`
// grades the four parts INCONCLUSIVE with it. Run as the runtime-on lane runs (the corpus test's flags).

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { loadCapture } from './harness'
import { runOurSide, AUTHOR_HIDDEN_CANDLE, candleNotDrawnOf } from './ourSide'
import { compareCapture } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

const FILE = path.resolve(process.cwd(), '../tests/fixtures/vendor/harness/kernel-channel-backquant-rddt-1d-2026-11-14.json')
const WITHHELD = 'withheld by name on our side (`Bar Coloring`): its `display = unread` is not a place this pane reads'

describe('e97 U5 — a candle our door did not draw is named by the door\'s reason', () => {
  it('candleNotDrawnOf reads the door\'s list and the host\'s own author mark, and nothing else', () => {
    const c = { kind: 'plotcandle', title: 'open' }
    const built = { candlesNotDrawn: [{ outputs: [7, 8, 9, 10], by: 'withheld', label: 'X', why: 'because' },
      { outputs: [11, 12, 13, 14], by: 'author' }] }
    expect(candleNotDrawnOf(c, 7, built)).toEqual({ by: 'withheld', sentence: 'withheld by name on our side (`X`): because' })
    expect(candleNotDrawnOf(c, 12, built)).toEqual({ by: 'author', sentence: AUTHOR_HIDDEN_CANDLE })
    expect(candleNotDrawnOf(c, 6, built)).toBe(null)
    expect(candleNotDrawnOf({ ...c, hiddenReason: 'author' }, 6, {})).toEqual({ by: 'author', sentence: AUTHOR_HIDDEN_CANDLE })
    // ⛔ the host's `passthrough` hiding is not a reason: such a candle recolours the chart's bars and is drawn
    expect(candleNotDrawnOf({ ...c, hiddenReason: 'passthrough' }, 6, {})).toBe(null)
    expect(candleNotDrawnOf({ kind: 'plot', hiddenReason: 'author' }, 6, built)).toBe(null)
  })

  it('kernel-channel RDDT, runtime lane: the four candle parts are INCONCLUSIVE by the door\'s reason; its lines still MATCH', () => {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    const { capture } = loadCapture(FILE)
    const ours = runOurSide(capture)
    expect(ours.ok, ours.refusal).toBe(true)
    const candles = (ours.plots || []).filter((p) => p.kind === 'plotcandle')
    expect(candles).toHaveLength(4)
    for (const p of candles) expect(p).toMatchObject({ candleNotDrawn: 'withheld', missingReason: WITHHELD })
    const r = compareCapture(capture, ours)
    const parts = r.plots.filter((p) => /^C1-candle-order/.test(p.rule || ''))
    expect(parts.map((p) => [p.verdict, p.reason])).toEqual(Array(4).fill(['INCONCLUSIVE', WITHHELD]))
    expect(r.plots.filter((p) => /^M1-title/.test(p.rule || '')).map((p) => p.verdict)).toEqual(['MATCH', 'MATCH', 'MATCH'])
  }, 120000)
})
