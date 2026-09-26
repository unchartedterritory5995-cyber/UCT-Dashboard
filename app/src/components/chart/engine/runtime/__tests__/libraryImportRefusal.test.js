// app/src/components/chart/engine/runtime/__tests__/libraryImportRefusal.test.js
//
// ─── ⭐⭐ 29 INDICATORS WERE TOLD THEY ARE NOT INDICATORS ────────────────────
//
// `runtime:declaration` is the largest first-wall row on the runtime lane — 54
// of the 266 committed scripts — and its sentence is
//
//     a script that is not an indicator
//
// ⛔⛔ MEASURED, THAT ROW IS **TWO POPULATIONS**, and the sentence is true of
// only one of them:
//
//     25  real `strategy()` scripts          ✅ "not an indicator" is exact
//     29  scripts declaring `indicator()`    ⛔ that stop on an `import`
//
// All 29 open with `indicator(...)`. Telling their author the script is not an
// indicator is a confident wrong answer about the one line they did not get
// wrong — the same class as RC-G (*"a name the script defines is not one it
// never defined"*) arriving through a different door.
//
// ⭐ WHAT THEY ACTUALLY NEED is the imported library's SOURCE. 31 distinct
// libraries across the 29 scripts, and 39 of 40 aliases are really called — so
// this cannot be waved away as unused imports. Serving it means fetching and
// compiling third-party Pine from TradingView, which is a distribution question
// as much as an engineering one (`docs/pine/LICENSING.md`). It stays refused;
// what changes is that the refusal is now TRUE.
//
// ⛔⛔ AND THE OBVIOUS SHORTCUT IS REJECTED, UNMEASURED, ON PURPOSE. Seven of
// the 29 import `TradingView/ta`, and it is tempting to alias `tvta.ema` onto
// the `ta.ema` this engine already serves. **`TradingView/ta` is a LIBRARY and
// `ta` is a NAMESPACE, and they are not the same set** — the corpus calls that
// library for `vStop` and `requestUpAndDownVolume`, which are not `ta.*`
// built-ins at all. Whether the names that DO collide mean the same thing has
// never been measured here, and serving them on the strength of a shared
// spelling is RC-A's defect (a name served by resemblance). Measure first.
import { describe, it, expect } from 'vitest'

import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'

const CORPUS = path.resolve(__dirname, '../../../../../../../corpus/committed')
const build = (src) => buildRuntimeIr(src, { ...runtimeClockOpts(false), inputs: {} })
const refusalOf = (src) => {
  const b = build(src)
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}
const HEAD = '//@version=5'

describe('⭐⭐ an indicator that imports a library', () => {
  it('⛔ CONTROL — a plain indicator still BUILDS', () => {
    // ⭐ NON-VACUITY FIRST. Every case below reads a refusal; if this fixture
    // refused for some unrelated reason, they would all pass while saying
    // nothing about `import`.
    const r = build(`${HEAD}
indicator("t")
plot(close)
`)
    expect(r.ok, r.ok ? '' : `${r.refusal.guard}: ${r.refusal.message}`).toBe(true)
  })

  it('⭐⭐ refuses by its OWN name, and does not call the script a non-indicator', () => {
    const r = refusalOf(`${HEAD}
indicator("t")
import TradingView/ta/7 as tvta
plot(tvta.ema(close, 9))
`)
    expect(r.guard).toBe('runtime:library')
    // ⛔ THE WHOLE POINT, ASSERTED AS AN ABSENCE. The script declares
    // `indicator()` on the line above; the old sentence contradicted it.
    expect(r.message).not.toMatch(/not an indicator/)
  })

  it('⭐ quotes the line the MEMBER wrote, slashes intact', () => {
    // ⚰️ THE TOKENS LOSE THE PATH. `toks.map(t => t.value).join(' ')` renders
    // `import TradingView / ta / 7 as tvta` — a spelling that appears in no
    // script and reads like the engine mis-parsed the line rather than declined
    // to follow it. The refusal reads the source line instead.
    const r = refusalOf(`${HEAD}
indicator("t")
import TradingView/ta/7 as tvta
plot(close)
`)
    expect(r.message).toContain('import TradingView/ta/7 as tvta')
    expect(r.message).not.toContain('TradingView / ta')
  })

  it('⛔ points at the IMPORT line, not at the declaration', () => {
    const r = refusalOf(`${HEAD}
indicator("t")

import PineCoders/Time/1 as tt
plot(close)
`)
    expect(r.line).toBe(4)
  })

  it('⛔⛔ CONTROL — `strategy()` KEEPS the sentence that is true of it', () => {
    // ⚰️ THE HALF THAT MUST NOT MOVE. 25 of the 54 really are not indicators,
    // and the owner ruled `strategy()` out of scope on 2026-09-23. A split that
    // quietly re-pointed them would lose a true refusal to fix a false one.
    const r = refusalOf(`${HEAD}
strategy("s")
plot(close)
`)
    expect(r.guard).toBe('runtime:declaration')
    expect(r.message).toMatch(/not an indicator/)
  })

  it('⛔ CONTROL — `library()` and `export` also keep it', () => {
    // A script that EXPORTS is a library, so "not an indicator" is exact for it
    // — which is why `import` and `export` no longer share one sentence.
    expect(refusalOf(`${HEAD}
library("L")
export f() => 1
`).guard).toBe('runtime:declaration')
    expect(refusalOf(`${HEAD}
indicator("t")
export f() => 1
plot(close)
`).guard).toBe('runtime:declaration')
  })

  it('⭐⭐ THE PRODUCT CLAIM — a real corpus script, read from disk', () => {
    // ⚰️ A PARAPHRASE WOULD PASS BEFORE THE FIX. RC-J's own first case did
    // exactly that, so this reads the file. `atr-stop-loss-indicator` opens
    // `indicator("ATR+ (Stop Loss Indicator)", …)` on line 4 and imports
    // `ZenAndTheArtOfTrading/ZenLibrary/9` on line 7.
    const file = path.join(CORPUS, 'atr-stop-loss-indicator__LOfv1FvRhL.pine')
    expect(fs.existsSync(file), 'the committed corpus script is missing').toBe(true)
    const src = fs.readFileSync(file, 'utf8')
    expect(src, 'the fixture must really declare an indicator').toContain('indicator("ATR+')
    const b = build(src)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:library')
    expect(b.refusal.message).not.toMatch(/not an indicator/)
    expect(b.refusal.message).toContain('ZenLibrary')
  })
})
