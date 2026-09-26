// app/src/components/chart/engine/ast/nameDemandCensus.measure.test.js
//
// ─── ⭐⭐ WHICH PINE NAMES THE CORPUS ACTUALLY USES ─────────────────────────
//
// Three censuses already answer "where does a script DIE" (`runtimeCorpusCensus`,
// `objectLaneCensus`) and "which guard blocks the most" (`objectLaneCallSites`).
// None answers the question that should pick the next lane: **which names do
// real scripts reach for at all?**
//
// ⛔⛔ AND THAT IS A DIFFERENT QUESTION FROM A BLOCKER COUNT, which this repo
// has now learned three times. A guard's script count is not its upside:
//   · `[` read as 16 scripts of history operator; 15 were tuple destructuring.
//   · `pine:input-kind` read as missing `input.*`; every kind was supported and
//     the refusals were a `group=` label.
//   · `objects:nothing-drawn` read as 13 scripts of work; ZERO of them contain
//     a drawing call, so no capability can ever move them.
// A name's demand is a property of the CORPUS and cannot drift like that.
//
//     cd app && node node_modules/vitest/vitest.mjs run \
//       src/components/chart/engine/ast/nameDemandCensus.measure.test.js
//
// ⛔ IT ASSERTS NO COUNT, deliberately — same contract as its siblings. A queue
// pinned to a number reds every time the queue is worked. What is asserted is
// that the corpus was found, that comments and strings were really stripped,
// and that the result is not one bucket.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'corpus/committed')
const SCRIPTS = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
  : []

/** The namespaces Pine itself owns. A dotted name outside these is a library
 *  call or a UDT field read, never a builtin this engine is missing. */
const NS = ['ta', 'math', 'str', 'request', 'array', 'matrix', 'map', 'ticker',
  'syminfo', 'timeframe', 'session', 'chart', 'runtime', 'color', 'input']

/**
 * ⛔⛔ COMMENTS AND STRING LITERALS ARE REMOVED FIRST, AND THAT IS NOT
 * FASTIDIOUSNESS. This repo has six recorded cases of an instrument matching
 * its own prose and reporting it as a property of the subject. A tooltip that
 * says "uses ta.atr internally" is not a use of `ta.atr`, and a `input.string`
 * default of "math.max" is not a call.
 *
 * ⭐ Strings become a SPACE rather than vanishing, so a name can never be glued
 * to the token on the other side of a quote.
 */
export function stripCommentsAndStrings(source) {
  const out = []
  let quote = null
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]
    if (quote) {
      if (c === quote) quote = null
      out.push(' ')
      continue
    }
    if (c === '"' || c === "'") { quote = c; out.push(' '); continue }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      out.push('\n')
      continue
    }
    out.push(c)
  }
  return out.join('')
}

const RE = new RegExp(`\\b(${NS.join('|')})\\.([a-z_][a-zA-Z0-9_]*)`, 'g')

describe('⭐⭐ the names real scripts reach for', () => {
  it('⛔ CONTROL — the corpus is on disk', () => {
    expect(SCRIPTS.length).toBeGreaterThan(200)
  })

  it('⛔⛔ the stripper really strips — comments and strings are NOT code', () => {
    // ⭐ THE CONTROL THAT MAKES THE CENSUS MEAN ANYTHING. Without it a run over
    // a stripper that returned its input unchanged looks identical.
    const src = [
      'x = ta.sma(close, 5)',
      '// a comment mentioning ta.ema and math.max',
      's = "a string mentioning ta.rsi"',
      "t = 'another with math.abs'",
    ].join('\n')
    const found = [...stripCommentsAndStrings(src).matchAll(RE)].map((m) => m[0])
    expect(found).toEqual(['ta.sma'])
    // and the stripper must not GLUE tokens across a removed string
    expect(stripCommentsAndStrings('a"x"b')).toBe('a   b')
  })

  it('⭐⭐ prints the demand table — by SCRIPTS first, then uses', () => {
    const uses = new Map()
    const scripts = new Map()
    for (const name of SCRIPTS) {
      const src = stripCommentsAndStrings(
        fs.readFileSync(path.join(DIR, name), 'utf8'))
      for (const m of src.matchAll(RE)) {
        const n = m[0]
        uses.set(n, (uses.get(n) || 0) + 1)
        if (!scripts.has(n)) scripts.set(n, new Set())
        scripts.get(n).add(name)
      }
    }
    const rows = [...uses.keys()]
      .map((n) => ({ n, uses: uses.get(n), scripts: scripts.get(n).size }))
      .sort((a, b) => b.scripts - a.scripts || b.uses - a.uses)

    // eslint-disable-next-line no-console
    console.log([
      '',
      `PINE NAME DEMAND — ${SCRIPTS.length} scripts, ${rows.length} distinct namespaced names`,
      '⭐ SCRIPTS is the column to plan from. A name used 2,278 times in 77',
      '  scripts and one used 108 times in 59 are both "top ten", and the second',
      '  is the broader capability.',
      '',
      'scripts  uses  name',
      ...rows.slice(0, 40).map((r) => `${String(r.scripts).padStart(7)}  ${String(r.uses).padStart(5)}  ${r.n}`),
      '',
    ].join('\n'))

    // ⛔ NON-VACUITY: a stripper that ate everything, or a regex that matched
    // nothing, both produce an empty table that satisfies any count assertion.
    expect(rows.length).toBeGreaterThan(50)
    expect(rows[0].scripts).toBeGreaterThan(20)
    // and the table must actually SEPARATE — one bucket means it is noise
    expect(new Set(rows.map((r) => r.scripts)).size).toBeGreaterThan(10)
  })
})
