// app/src/components/chart/engine/ast/silenceSpeaks.test.js
//
// ─── ⭐⭐ R22 / d1 — WHAT THE MEMBER WROTE IS NEVER DROPPED WITHOUT A WORD ────
//
// Owner ruling, 2026-09-15. Measured at (d)'s census, the engine dropped two things
// **silently** — no output, no refusal, no note:
//
//   `alert(message, freq)`            191 uses across 46 files
//   an alertcondition's MESSAGE       487 of 555 are literal-or-placeholder
//
// ⛔⛔ SILENCE IS THE DEFECT. This engine's standing rule is that what it cannot carry
// is **refused by name or noted** — never dropped. Both of these were dropped.
//
// ⛔⛔ AND BOTH GET A **NOTE**, NEVER A REFUSAL, on a standing rule rather than a
// preference: **a threshold never removes what works**. The alertcondition offer
// translates today and must keep translating; `alert()` is a runtime action *neither
// surface reads*, so a script carrying plots and an `alert()` must keep its plots. A
// refusal would take a working column away to report a line that was never going to
// draw.
//
// ⭐ THE NOTE CODE IS FREE-FORM, MEASURED BEFORE ONE WAS ADDED. `noteOf(code, message,
// tok)` takes a plain string — no table, no validation — and `pine:chart-only` is the
// standing precedent for a **note-only** code: it has **zero** entries in `REFUSALS`
// (the frozen 41) and is never thrown. So `pine:runtime-only` joins it without touching
// that table. ⛔ `REFUSALS` is unchanged — there is still no 42nd.
//
// ⭐ AND THE DOCTRINE SENTENCE HAS ONE HOME. *"TradingView's own screener reads plot()
// and alertcondition() and nothing else"* already lives in `chartOnlyNote`; d1 reuses
// it **by reference** rather than retyping it, because two authorities on one sentence
// is a defect (R20).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(__dirname, '../../../../../..')

/** ⭐ NAMED CORPUS SPECIMENS, from the census (`a99ffcec3`). */
const ALERT_AND_PLOTS = 'corpus/committed/72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt.pine'
const LITERAL_MSG = 'corpus/committed/adaptive-trend-following-suite-alpha-extract__d615e5a027.pine'

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const notesOf = (t, code) => (t.notes || []).filter((n) => (n.code || n.guard) === code)

/** An expression message — only TWO exist in the whole corpus, so this is inline
 *  rather than corpus-named, and the census records why. */
const EXPR_MSG = 'indicator("x")\nc = close > open\n'
  + 'alertcondition(c, "Up", "px " + str.tostring(close))\nplot(close)\n'

describe('R22 / d1 — the two silences speak', () => {
  it('⛔⛔ NON-VACUITY CONTROL — each specimen carries its construct and produces output', () => {
    // Without this a note assertion passes over a script that refused before ever
    // reaching the construct — which is how an absence reads as a pass.
    for (const rel of [ALERT_AND_PLOTS, LITERAL_MSG]) {
      expect(fs.existsSync(path.join(REPO, rel)), `${rel} missing`).toBe(true)
      const t = translatePine(read(rel), {})
      expect((t.outputs || []).length, `${rel} produces no outputs`).toBeGreaterThan(0)
    }
    expect(read(ALERT_AND_PLOTS)).toMatch(/\balert\s*\(/)
    expect(read(LITERAL_MSG)).toMatch(/alertcondition\s*\(/)
    expect((translatePine(EXPR_MSG, {}).outputs || []).length).toBeGreaterThan(0)
  })

  // ⚰️⚰️ R22's d1 PREMISE IS CORRECTED HERE BY MEASUREMENT, BEFORE ANY CODE MOVED.
  // The ruling said *"`alert()` is dropped whole — 191 uses, 46 files: ok=true, no
  // output, no refusal, no note"*, and the census that produced it counted call sites
  // without asking WHERE they sit. Measured through the door:
  //
  //     alert()  at TOP LEVEL   -> pine:chart-only@2   ✅ already noted, correctly
  //     alert()  inside an `if` -> (no note)           ⛔ the real gap
  //     bgcolor  inside an `if` -> (no note)           ⛔ same gap
  //     bgcolor/fill at top     -> pine:chart-only     ✅
  //
  // ⭐ `alert` IS ALREADY IN `CHART_ONLY_CALLS` (`pine.js` ≈1785) alongside
  // `plotshape`, `plotchar`, `bgcolor`, `barcolor`, `fill` and `hline`. So d1 needs
  // **no new note code** — `pine:runtime-only` is withdrawn, `pine:chart-only` is the
  // right one and already exists — and the defect is not about `alert` at all:
  // **a chart-only call inside a BLOCK is noted nowhere, for the whole set.**
  //
  // ⛔ That is a bigger change than the ruling priced: it reaches the block walk, the
  // same machinery whose two readers disagreeing is recorded at `destructureBindings`.
  // Left RED and unbuilt rather than half-landed.
  it.fails('⭐⭐ a chart-only call INSIDE A BLOCK is noted, as it is at top level', () => {
    const inBlock = 'indicator("x")\nif close > open\n'
      + '    alert("boom", alert.freq_once_per_bar)\nplot(close)\n'
    const t = translatePine(inBlock, {})
    const n = notesOf(t, 'pine:chart-only')
    expect(n.length, 'a chart-only call inside a block is still dropped without a word')
      .toBeGreaterThan(0)
    expect(n[0].line, 'the note must sit at the call\'s own line').toBe(3)
  })

  it('⛔ CONTROL — at TOP LEVEL it is already noted, and that must not move', () => {
    // ⭐ The half that already works, pinned so d1 cannot "fix" it into existence
    // twice or break it while reaching the block case.
    const top = 'indicator("x")\nalert("boom", alert.freq_once_per_bar)\nplot(close)\n'
    const n = notesOf(translatePine(top, {}), 'pine:chart-only')
    expect(n.map((x) => x.line)).toEqual([2])
    expect(String(n[0].message))
      .toContain('reads plot() and alertcondition() and nothing else')
  })

  it.fails('⭐⭐ a message the engine cannot carry is NOTED, naming its shape', () => {
    const t = translatePine(EXPR_MSG, {})
    const n = notesOf(t, 'pine:alert-message')
    expect(n.length, 'an expression message is still dropped without a word')
      .toBeGreaterThan(0)
    expect(String(n[0].message)).toMatch(/expression/)
  })

  // ── CONTROLS: a note is a note.

  it('⛔⛔ CONTROL — refusals are UNCHANGED on every specimen', () => {
    // ⚰️ The whole risk of d1 is turning a working offer into a refusal. These are
    // the numbers a note must not move.
    //
    // ⛔ THEY ARE MEASURED, NOT ASSUMED. v1 of this control asserted `0` for the
    // alert() specimen on the assumption that a script chosen for its plots would be
    // clean; it carries **23** refusals of its own, for reasons that have nothing to
    // do with d1. Asserting 0 would have made the control fail for a true reason and
    // be "fixed" by loosening it — so the real count is pinned instead, which is what
    // actually catches a note turning into a refusal.
    expect((translatePine(read(ALERT_AND_PLOTS), {}).refusals || []).length,
      'd1 moved the alert() specimen\'s refusal count').toBe(23)
    expect((translatePine(EXPR_MSG, {}).refusals || []).length).toBe(0)
    expect(translatePine(EXPR_MSG, {}).ok).toBe(true)
  })

  it('⛔ CONTROL — `pine:chart-only` stays a NOTE code and is never thrown', () => {
    // ⭐ No new note code is added: `pine:runtime-only` was withdrawn once the
    // measurement showed `alert` is already in `CHART_ONLY_CALLS`. This pins the
    // existing code's note-only status, which is what d1 now relies on.
    const src = fs.readFileSync(path.join(
      REPO, 'app/src/components/chart/engine/ast/pine.js'), 'utf8')
    const needle = ['pine', 'chart-only'].join(':')
    expect(src.includes(`'${needle}':`),
      `${needle} gained an entry in REFUSALS — it must stay note-only`).toBe(false)
    expect(src.includes(`PineRefusal('${needle}'`),
      `${needle} is thrown somewhere — it must never be`).toBe(false)
    // …and the control can see a code that IS in the table, or it proves nothing.
    expect(src.includes(`'${['pine', 'collection'].join(':')}':`),
      'the sweep cannot see a real REFUSALS entry — it is not looking').toBe(true)
  })

  it('⛔ CONTROL — the doctrine sentence still has exactly ONE home', () => {
    // R20: two authorities on one sentence is a defect. The clause must be written
    // once and referenced, not retyped into the new note.
    const src = fs.readFileSync(path.join(
      REPO, 'app/src/components/chart/engine/ast/pine.js'), 'utf8')
    const clause = 'reads plot() and alertcondition() and nothing else'
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    const hits = code.split(clause).length - 1
    expect(hits, `the doctrine clause is written ${hits} times in CODE — it must be `
      + 'written once and referenced').toBe(1)
  })
})
