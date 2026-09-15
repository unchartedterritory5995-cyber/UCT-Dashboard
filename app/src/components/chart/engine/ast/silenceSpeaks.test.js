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
  it('⭐⭐ a chart-only call INSIDE A BLOCK is noted, as it is at top level', () => {
    const inBlock = 'indicator("x")\nif close > open\n'
      + '    alert("boom", alert.freq_once_per_bar)\nplot(close)\n'
    const t = translatePine(inBlock, {})
    const n = notesOf(t, 'pine:chart-only')
    expect(n.length, 'a chart-only call inside a block is still dropped without a word')
      .toBeGreaterThan(0)
    expect(n[0].line, 'the note must sit at the call\'s own line').toBe(3)
  })

  // ─── d1′ (R22b) — NESTED SPECIMENS: three call types, two depths ──────────
  //
  // ⭐ THE SEVEN TYPES ARE `CHART_ONLY_CALLS` (`pine.js` ≈1783): `plotshape`,
  // `plotchar`, `bgcolor`, `barcolor`, `fill`, `hline`, `alert`.
  //
  // ⚠️ R22b's suggested third type — a drawing call, `label.new`/`line.new` — is
  // **not in that set** and is therefore outside d1′'s scope: drawing calls have
  // their own `pine:drawing` treatment. `plotshape` is used instead, so the three
  // types are all genuinely members of the set d1′ is ruled over.
  const NESTED = {
    'alert in if': 'indicator("x")\nif close > open\n'
      + '    alert("boom", alert.freq_once_per_bar)\nplot(close)\n',
    'bgcolor in if': 'indicator("x")\nif close > open\n'
      + '    bgcolor(color.red)\nplot(close)\n',
    'plotshape in for': 'indicator("x")\nfor i = 0 to 2\n'
      + '    plotshape(close > open)\nplot(close)\n',
    'alert in nested if': 'indicator("x")\nif close > open\n    if high > low\n'
      + '        alert("deep", alert.freq_once_per_bar)\nplot(close)\n',
    // ⭐⭐ THE SPECIMEN THAT MAKES R22b's CONSTRAINT EXERCISABLE. The four above
    // bind no names, so a pass that reached into binding machinery would perturb
    // nothing measurable on them and the byte-identical controls would pass a pass
    // that broke the rule. ⚰️ Found by the mutation proof: forcing a binding opaque
    // inside the pass left 14/14 green, because `close` is a builtin and there was
    // no binding to touch. This one BINDS `v` and PLOTS it, so a pass that stepped
    // on a binding moves the refusals and the controls see it.
    'bgcolor in if, with a binding read by the plot':
      'indicator("x")\nv = ta.sma(close, 14)\nif close > open\n'
      + '    bgcolor(color.red)\nplot(v)\n',
  }

  /** Measured BEFORE d1′, so the controls pin real numbers rather than assumed ones. */
  const BEFORE = Object.fromEntries(Object.entries(NESTED).map(([k, src]) => {
    const t = translatePine(src, {})
    return [k, {
      refusals: (t.refusals || []).length,
      codes: (t.refusals || []).map((r) => r.guard).join(','),
      outputs: (t.outputs || []).length,
    }]
  }))

  it('⛔⛔ NON-VACUITY — each nested specimen really has the call INSIDE a block', () => {
    for (const [label, src] of Object.entries(NESTED)) {
      const lines = src.split('\n')
      const callLine = lines.findIndex((l) => /^\s+\w/.test(l) && /\(/.test(l))
      expect(callLine, `${label}: no indented call line`).toBeGreaterThan(0)
      expect(lines[callLine]).toMatch(/^\s{4,}/)
      expect((translatePine(src, {}).outputs || []).length,
        `${label} produces no outputs`).toBeGreaterThan(0)
    }
  })

  for (const [label, src] of Object.entries(NESTED)) {
    it(`⭐⭐ d1′ — ${label} is NOTED at its own line`, () => {
      const t = translatePine(src, {})
      const n = notesOf(t, 'pine:chart-only')
      expect(n.length, `${label}: still dropped without a word`).toBeGreaterThan(0)
      // ⚰️ v1 took "the first line indented 4+" as the call line. On the
      // doubly-nested specimen that is the inner `if` (line 3), not the `alert`
      // (line 4) — so it demanded a note one line above the call and reported the
      // pass wrong when the pass was right. The line is found by the CALL now.
      const CHART_ONLY = /^\s+(plotshape|plotchar|bgcolor|barcolor|fill|hline|alert)\s*\(/
      const callLine = src.split('\n').findIndex((l) => CHART_ONLY.test(l)) + 1
      expect(callLine, `${label}: the fixture has no indented chart-only call`)
        .toBeGreaterThan(0)
      expect(n.map((x) => x.line)).toContain(callLine)
    })
  }

  it('⛔⛔ CONTROL — refusals, CODES IN ORDER, and output count are byte-identical', () => {
    // ⭐ A note pass moves nothing else. This is the assertion that makes R22b's
    // read-only constraint checkable rather than merely stated.
    for (const [label, src] of Object.entries(NESTED)) {
      const t = translatePine(src, {})
      expect((t.refusals || []).length, `${label}: refusal COUNT moved`)
        .toBe(BEFORE[label].refusals)
      expect((t.refusals || []).map((r) => r.guard).join(','),
        `${label}: refusal CODES or their ORDER moved`).toBe(BEFORE[label].codes)
      expect((t.outputs || []).length, `${label}: output COUNT moved`)
        .toBe(BEFORE[label].outputs)
    }
  })

  it('⛔⛔ CONTROL — DEDUP: every call site gets exactly ONE note, never two', () => {
    // ⚰️ v1 of this control pinned only the TOP-LEVEL call — which the nested pass
    // never visits, so defeating the dedup left it green. The mutation proof caught
    // it (clear `seen`, walk twice: 14/14 still passed), which is precisely what a
    // mutation proof is for. It now pins EVERY site, nested included, and that is
    // where a double emit actually lands.
    const top = 'indicator("x")\nalert("boom", alert.freq_once_per_bar)\nplot(close)\n'
    const topNotes = notesOf(translatePine(top, {}), 'pine:chart-only')
    expect(topNotes.filter((x) => x.line === 2).length,
      'the top-level alert() is noted more than once').toBe(1)

    for (const [label, src] of Object.entries(NESTED)) {
      const n = notesOf(translatePine(src, {}), 'pine:chart-only')
      const perLine = new Map()
      for (const x of n) perLine.set(x.line, (perLine.get(x.line) || 0) + 1)
      for (const [line, count] of perLine) {
        expect(count, `${label}: line ${line} is noted ${count} times, not once`).toBe(1)
      }
      expect(n.length, `${label}: expected exactly one nested note`).toBe(1)
    }
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

  // ⚰️ MOVED TO `alertMessageRides.test.js` (R22a, d2) — NOT DELETED.
  //
  // This was d1's half of the message gap, written when d1 came first. **R22a folded
  // the message note into d2**, because once the census's named-argument bug was
  // corrected only **2** of 555 messages are expressions — two specimens is not a
  // feature of its own. d2 now owns both halves together: the 487 that ride, and the
  // note for the ones that cannot.
  //
  // ⭐ It is recorded here rather than removed silently because the assertion was
  // RIGHT and its marker retired for the honest reason — the behaviour shipped. A
  // reader looking for "where did d1's message note go" finds the answer, and the
  // successor asserts the same thing with its line pinned.
  it('⭐ the message note lives in d2\'s rail now, and really exists', () => {
    // A one-line tie so this file cannot go quiet about a gap it opened.
    const n = notesOf(translatePine(EXPR_MSG, {}), 'pine:alert-message')
    expect(n.length, 'the expression-message note vanished from both rails')
      .toBeGreaterThan(0)
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
