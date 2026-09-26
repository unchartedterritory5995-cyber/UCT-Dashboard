// app/src/components/chart/engine/runtime/__tests__/inputLaneArgs.test.js
//
// ─── ⭐⭐ AN INPUT'S LABEL CANNOT DECIDE ITS LANE ────────────────────────────
//
// `group`, `tooltip`, `title`, `inline`, `display` and `confirm` name a control
// in the settings dialog. None of them can change the number the input yields
// on any bar. Until this file, ALL of them did — not the value, the LANE:
//
//     var string GROUP_FRACT = "Fractals"
//     n = input.int(10, title = "Fractal Period", minval = 2, group = GROUP_FRACT)
//
// `var` makes `GROUP_FRACT` a runtime slot, the route decision (`needsRuntime`)
// walks EVERY argument, so the whole call "reads a slot" and is handed to the
// runtime lane — which has no `input.*` node and reports:
//
//     runtime:call-undeclared-builtin-state — a builtin fed by a mutable value
//     that the CLOSED TABLE does not declare at all
//
// ⛔⛔ THAT SENTENCE SENDS THE NEXT ENGINEER TO ADD `input.int` TO THE CLOSED
// TABLE, and `input.int` is not a table function at all — it is folded by the
// columnar lane, and always has been. The same script with `group = "Fractals"`
// spelled as a literal compiles today. This is the third instance of the
// mislabel class `builtinStateFamily` already records twice in its own comment
// (a bound `plot`, and the eight `PINE_CALL_SHAPES` names).
//
// ⭐ MEASURED, 2026-09-21, over `corpus/committed` (266 scripts): NINE scripts
// are first-blocked on an `input*` token, and storing group names in `var`
// strings is the ordinary Pine idiom in every one of them.
//
// ⭐⭐ THE RAIL'S SHAPE: a presentation argument's SPELLING must not change the
// verdict. Each kind is built TWICE — once with a literal `group`, once with a
// `var`-bound one — and the two verdicts must be identical. Asserting only
// "the var form compiles" would be satisfied by a build that folded the input
// to the wrong number, or by one that stopped refusing things it should refuse.
//
// ⛔ AND EVERY POSITIVE IS PAIRED WITH A CONTROL THAT READS THE OPPOSITE: an
// input whose DEFVAL or MINVAL reads a slot must STILL be refused. Without
// that pair, "ignore the presentation arguments" is equally satisfied by
// "ignore every argument", which would fold a member's input off a value the
// script never wrote and report nothing.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const REPO = path.resolve(process.cwd(), '..')
const N = 6
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t")\n'

const build = (src, inputs) => buildRuntimeIr(head + src, {
  bars: BARS, inputs: inputs || {}, ...runtimeClockOpts(false),
})

/** Build AND run — the only way to see WHICH number an input actually holds. */
function run(src, inputs) {
  const built = build(src, inputs)
  if (!built.ok) throw new Error(`refused by ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return Array.from(res.outputs[0])
}

/** The verdict, reduced to something two spellings can be compared on. */
const verdict = (src, inputs) => {
  const built = build(src, inputs)
  if (!built.ok) return { ok: false, guard: built.refusal.guard }
  return { ok: true, values: run(src, inputs) }
}

// ⭐ The SAME input, written two ways. Only the `group` argument differs, and a
// group is a heading in the settings dialog.
const LITERAL_GROUP = 'GG = "Fractals"\n'
const VAR_GROUP = 'var string GG = "Fractals"\n'

/** Every kind the corpus blocks on, plus the two that share the path. */
const KINDS = [
  ['input.int', 'n = input.int(10, title = "Len", minval = 2, group = GG)\nplot(close * n)'],
  ['input.float', 'n = input.float(1.5, "Mult", group = GG)\nplot(close * n)'],
  ['input.bool', 'b = input.bool(true, "Show", group = GG)\nplot(b ? close : open)'],
  ['input.color', 'c = input.color(color.blue, title = "Col", group = GG)\nplot(close, color = c)'],
  ['input.source', 's = input.source(close, "Src", group = GG)\nplot(s)'],
  ['input (bare)', 'b = input(true, title = "Show", group = GG)\nplot(b ? close : open)'],
  ['input.string', 'm = input.string("SMA", "Type", options = ["SMA", "EMA"], group = GG)\nplot(m == "SMA" ? close : open)'],
  ['input.timeframe', 't = input.timeframe("15", title = "TF", group = GG)\nplot(t == "15" ? close : open)'],
]

describe("an input's label cannot decide its lane", () => {
  describe('⭐⭐ the same input, with the group spelled two ways', () => {
    for (const [label, body] of KINDS) {
      it(`${label} — a \`var\`-bound group reaches the SAME verdict as a literal one`, () => {
        const literal = verdict(LITERAL_GROUP + body)
        const slotted = verdict(VAR_GROUP + body)
        expect(slotted).toEqual(literal)
      })
    }
  })

  it('⛔ CONTROL — the pair above can DISTINGUISH: a `var`-bound DEFVAL does change the verdict', () => {
    // Without this, "the two spellings agree" is equally satisfied by a build
    // that refuses both, or by one that ignores every argument of an input.
    //
    // ⛔⛔ AND IT ASSERTS THE GUARD, NOT ONLY `ok === false`. Measured under
    // mutation: with the defval dropped from `inputValueArgs`, the call is
    // routed to the COLUMNAR lane, whose resolver cannot see a runtime slot and
    // refuses it too — so an `ok === false` control passes for a build that had
    // stopped reading the default at all. Two refusals are not one refusal, and
    // only the guard says which lane made the decision.
    const literalDefault = verdict('LEN = 10\nn = input.int(LEN, "Len")\nplot(close * n)')
    const slottedDefault = build('var int LEN = 10\nn = input.int(LEN, "Len")\nplot(close * n)')
    expect(literalDefault.ok).toBe(true)
    expect(slottedDefault.ok).toBe(false)
    expect(slottedDefault.refusal.guard).toBe('runtime:input-state')
  })

  it('⭐ the number is the AUTHOR\'S, not merely "a" number', () => {
    // A build that read the wrong argument as the default — `minval`, say —
    // would still compile and would still agree with its literal twin. Only the
    // value says which argument was read.
    expect(run(`${VAR_GROUP}n = input.int(10, title = "Len", minval = 2, group = GG)\nplot(close * n)`))
      .toEqual(BARS.map((b) => b.c * 10))
  })

  it('⭐⭐ the MEMBER\'S value still reaches it through the new lane', () => {
    // ⛔ THE ONE THING A NAIVE FIX LOSES. Rewriting the call into a trimmed copy
    // to get it past the route decision drops `boundName` — the key a member's
    // saved setting is stored under — and the member silently gets the author's
    // number with nothing on screen to say so. This is the exact defect this
    // lane already paid for once (`makeResolver`'s own comment).
    const src = `${VAR_GROUP}n = input.int(10, title = "Len", minval = 2, group = GG)\nplot(close * n)`
    expect(run(src, { n: 25 })).toEqual(BARS.map((b) => b.c * 25))
  })

  it('⛔ CONTROL — with no member value the same script reads the author\'s 10', () => {
    const src = `${VAR_GROUP}n = input.int(10, title = "Len", minval = 2, group = GG)\nplot(close * n)`
    expect(run(src, {})).toEqual(BARS.map((b) => b.c * 10))
  })

  describe('⭐⭐ a COMPUTED argument — literal and expression are not the same case', () => {
    it('a defval bound to a pure expression still folds', () => {
      // ⛔ THE LITERAL-ONLY FIXTURE IS THE TRAP. `input.int(10, …)` folds to a
      // constant whatever the route decision does, so a rail built only on
      // literals cannot see a binding that was never read.
      expect(run(`${VAR_GROUP}LEN = 4 + 6\nn = input.int(LEN, "Len", group = GG)\nplot(close * n)`))
        .toEqual(BARS.map((b) => b.c * 10))
    })

    it('⛔ a MINVAL that reads a slot is still refused — a bound is value-bearing', () => {
      // ⛔⛔ THE NARROWING IS SCOPED TO THE ARGUMENTS THAT CANNOT MOVE THE
      // VALUE. `minval`/`maxval` decide whether a MEMBER'S number is admitted
      // at all, so skipping them would silently accept a value the script's own
      // author bounded out — the one thing that door exists to prevent.
      const r = build('var int lo = 2\nn = input.int(10, "Len", minval = lo)\nplot(close * n)')
      expect(r.ok).toBe(false)
      expect(r.refusal.guard).toBe('runtime:input-state')
    })

    it('⛔ CONTROL — the same input with a LITERAL minval compiles', () => {
      expect(build('n = input.int(10, "Len", minval = 2)\nplot(close * n)').ok).toBe(true)
    })
  })

  it('⭐ a POSITIONAL tooltip is a label too — the `bollinger-band-width-percentile` shape', () => {
    // `input.source(close, 'Price Source...:', tip_priceSrc, inline = '1', group = '…')`
    // — corpus line 164, with `var string tip_priceSrc` declared on line 89.
    // The third POSITIONAL argument of `input.source` is its tooltip.
    const literal = verdict('TIP = "why"\ns = input.source(close, "Price", "why", inline = "1", group = "Main")\nplot(s)')
    const slotted = verdict('var string TIP = "why"\ns = input.source(close, "Price", TIP, inline = "1", group = "Main")\nplot(s)')
    expect(slotted).toEqual(literal)
  })

  describe('⭐ and when an input DOES read state, the refusal says so', () => {
    it('names the input, not the closed builtin table', () => {
      // ⛔⛔ `runtime:call-undeclared-builtin-state` reads as "the closed table
      // does not declare this builtin" and sends a reader to ADD ONE — for a
      // name that is not a table function in either lane. That is the same
      // misdirection `builtinStateFamily` already records twice in its own
      // comment; this is the third.
      const r = build('var string MD1 = "Mode A"\nm = input(MD1, "Mode")\nplot(m == "Mode A" ? close : open)')
      expect(r.ok).toBe(false)
      expect(r.refusal.guard).toBe('runtime:input-state')
      expect(r.refusal.message).not.toMatch(/CLOSED TABLE/)
      // ⛔ THE SENTENCE, NOT ONLY THE GUARD. A guard with no entry in
      // `RUNTIME_REFUSALS` still carries its own name as the whole message —
      // so a rail that reads the guard alone is green for a refusal that says
      // `runtime:input-state — \`input\`` and explains nothing
      // (`lesson_rail_the_sentence_not_just_the_guard`).
      expect(r.refusal.message).toMatch(/before bar 0/)
    })

    it('⛔ CONTROL — a genuinely undeclared builtin over state still says the table', () => {
      // Without this, the new family is equally satisfied by relabelling
      // everything, and the row the completion matrix reserves for "blocked on
      // the builtin existing" would quietly empty out.
      const r = build('var x = 0.0\nx := close\nplot(ta.vwma(x, 3))')
      expect(r.ok).toBe(false)
      expect(r.refusal.guard).toBe('runtime:call-undeclared-builtin-state')
    })
  })

  describe('⭐⭐ the corpus — no script is sent to the closed table for an input', () => {
    const DIR = path.join(REPO, 'corpus/committed')
    const SCRIPTS = fs.existsSync(DIR)
      ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
      : []

    it('⛔ NON-VACUITY — the corpus is really on disk', () => {
      expect(SCRIPTS.length).toBeGreaterThan(200)
    })

    it('no first blocker is `runtime:call-undeclared-builtin-state` on an `input*` token', () => {
      const opts = { tf: 'D', ...runtimeClockOpts(false) }
      const sent = []
      for (const name of SCRIPTS) {
        const src = fs.readFileSync(path.join(DIR, name), 'utf8')
        let r = null
        try {
          const b = buildRuntimeIr(src, opts)
          if (b.ok) continue
          r = b.refusal
        } catch {
          continue
        }
        const tok = r && typeof r.token === 'string' ? r.token : ''
        if ((tok === 'input' || tok.startsWith('input.'))
            && r.guard === 'runtime:call-undeclared-builtin-state') {
          sent.push(`${name} @L${r.line} — ${tok}`)
        }
      }
      expect(sent).toEqual([])
    })
  })
})
