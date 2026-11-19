// app/src/components/chart/builder/memberPane/draw1KeepHost.test.js
//
// ─── ⭐⭐ DRAW-1 — A FALLBACK DOCUMENT DOES NOT CARRY A HOST PICTURE THAT LOST CREATES ──────
//
// The runtime lane is the member door's fallback for a script the host lane REFUSED. When its
// drawing build is refused by name and its value build stands, the door used to keep the host
// object program's partial picture (`runtimeObjectsDoor.js`, "keepHost"). Measured on DRAW-1's
// tree: trend-levels-chartprime (its `label(na)` casts now build) reached that path, and its
// host program had lost 12 creates (`pine:window`) while carrying their deletes; the harness
// graded both committed captures runtime-on DIVERGE (labels at other prices, 3 lines missing).
// A host picture that LOST a create is not kept on that path: the door declines with the drawing
// build's own refusal. A host picture that lost only other steps (or nothing) is kept as before.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { memberPaneDefinition } from './memberPaneDefinition'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

const CORPUS = path.resolve(process.cwd(), '..', 'corpus', 'committed')
const src = (f) => fs.readFileSync(path.join(CORPUS, f), 'utf8')

describe('DRAW-1 — the fallback keeps a host picture only when it lost no create', () => {
  beforeAll(() => {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
  })

  it('trend-levels-chartprime: drawing build refused, host lost creates -> declined by name', () => {
    const d = memberPaneDefinition({ source: src('trend-levels-chartprime__90a5bf4ab1.pine'), id: 'u_draw1kh', name: 'tl' })
    expect(d.ok).toBe(false)
    // ⭐ CO-2 (NUMBER PENDING): the drawing build no longer stops at `chart.fg_color` (L165, `pine:builtin`), which
    // the runtime lane now carries; it stops at its next wall by name, and the door still declines the same way
    expect(d.runtimeDeclined && d.runtimeDeclined.code).toBe('runtime:call-text-state')
    expect(String(d.runtimeDeclined.why)).toMatch(/lost/)
  })

  it('CONTROL: trend-targets-algoalpha (host program clean, drawn from it inside the run) still attaches', () => {
    const d = memberPaneDefinition({ source: src('trend-targets-algoalpha__92ff5628d7.pine'), id: 'u_draw1kh2', name: 'tt' })
    expect(d.ok).toBe(true)
    expect(d.lane).toBe('runtime')
  })
})
