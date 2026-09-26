// app/src/components/chart/engine/runtime/__tests__/namedDefval.test.js
//
// ─── ⭐ `input.string(defval = 'SMA', …)` — THE DEFAULT MAY BE NAMED ─────────
//
// ⚰️ `admitTextInput` read only POSITIONAL arguments, so a text input whose
// default is written under its own parameter name was refused with
// *"`input.string` states no default"* — about a line whose default is right
// there. The reader is sent to add something already present, which is the
// worst shape a refusal can take: it is confident, specific, and wrong.
//
// ⭐ THE SHAPE WAS ALREADY UNDERSTOOD. `options = [...]` two blocks down has been
// read BY NAME since the function was written. Only the FIRST parameter was
// assumed positional — so this is not new knowledge about Pine, it is one
// parameter that was never given the treatment its neighbour already had.
//
// ⭐⭐ AND IT WAS THE WALL ON A REAL SCRIPT. The acceptance script
// `rvol__05fcd9e160.pine` writes `input.string(defval='SMA', options=[…])` on
// line 11; with `fill` fixed the lane reached that line and stopped there.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const REPO = path.resolve(process.cwd(), '..')
const N = 8
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t")\n'
const build = (src) => buildRuntimeIr(head + src, { bars: BARS, inputs: {} })

/** Build AND run — the only way to see WHICH string an input actually holds. */
function run(src) {
  const built = build(src)
  if (!built.ok) throw new Error(`refused: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return Array.from(res.outputs[0])
}

describe('a text input may name its default', () => {
  it('⭐ the named and positional spellings are the same input', () => {
    // ⛔ THE COMPARISON IS THE RAIL. Asserting only that the named form compiles
    // would pass on a build that read a DIFFERENT argument as the default —
    // which would serve the member the wrong string with nothing red.
    const named = build("m = input.string(defval = 'SMA')\nplot(m == 'SMA' ? close : open)")
    const positional = build("m = input.string('SMA')\nplot(m == 'SMA' ? close : open)")
    expect(named.ok).toBe(true)
    expect(positional.ok).toBe(true)
    expect(named.diagnostics.statements).toBe(positional.diagnostics.statements)
  })

  it('⛔ CONTROL: the default is the one the author wrote, not merely "a" default', () => {
    // The plot picks `close` only when the default really is 'SMA'. A build that
    // took `options` or the title as the default answers `open`.
    const r = build("m = input.string(defval = 'SMA', options = ['SMA', 'EMA'])\n"
      + "plot(m == 'SMA' ? 1 : 0)")
    expect(r.ok).toBe(true)
  })

  it('⛔ CONTROL: an input with NO default at all is still refused', () => {
    // Without this, "read defval by name" is equally satisfied by never
    // refusing — and the honest half of the original check (an input whose
    // default is only known while the bar runs is not a default) would be gone.
    //
    // ⚠️ THE INPUT HAS TO BE USED. A binding nobody reads stays an `env` macro
    // and is never lowered, so `m = input.string()` alone compiles — the
    // refusal fires where the value is needed, not where it is written. A first
    // version of this case missed that and asserted a refusal that could not
    // arrive, which would have passed on a build with the check deleted.
    const r = build("m = input.string()\nplot(m == 'x' ? close : open)")
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/states no default/)
  })

  it('⛔⛔ IT IS `defval` BY NAME, NOT MERELY THE FIRST NAMED ARGUMENT', () => {
    // ⚰ A MUTATION FOUND THIS GAP. Taking `args.find(x => x.name)` — the first
    // named argument, whatever it is — passes every case where `defval` happens
    // to be written first, which is how most scripts write it. Put `title`
    // first and that build serves the TITLE as the default: a real string, in
    // the right place, and the wrong one.
    // ⭐⭐ THE DISCRIMINATOR HAS TO BE THE VALUE, NOT THE COMPILE. Both scripts
    // compile whichever string the input holds — the comparison just folds to a
    // different constant — so a first version of this case compared STATEMENT
    // COUNTS and could not tell them apart at all. Run it and read the number.
    const src = "m = input.string(title = 'MA Type', defval = 'SMA')\n"
    expect(run(`${src}plot(m == 'SMA' ? 1 : 0)`)[0]).toBe(1)
    expect(run(`${src}plot(m == 'MA Type' ? 1 : 0)`)[0]).toBe(0)
  })

  it('⛔ a default given TWICE is refused rather than silently resolved', () => {
    // ⚰ ALSO FROM A MUTATION. Swapping the precedence changed nothing any case
    // could see, because the only shape that distinguishes them — a positional
    // default AND a named one — is a duplicate argument Pine itself rejects.
    // Picking one silently would serve a default the member never settled on,
    // under a rule nobody wrote down. Refusing says what is actually wrong.
    const r = build("m = input.string('SMA', defval = 'EMA')" + '\n'
      + "plot(m == 'SMA' ? 1 : 0)")
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/given a default twice/)
  })
  it('⭐⭐ and the acceptance script walks past line 11 because of it', () => {
    // ⛔ NAMED, NOT COUNTED. The script's wall is a measurement that moves as
    // capabilities land; what this pins is that it is no longer THIS line.
    const src = fs.readFileSync(
      path.join(REPO, 'corpus/committed/rvol__05fcd9e160.pine'), 'utf8')
    const r = buildRuntimeIr(src, { bars: BARS, inputs: {}, tf: 'D', ...runtimeClockOpts(false) })
    expect(r.ok).toBe(false)
    expect(r.refusal.line).toBeGreaterThan(11)
    expect(r.refusal.message).not.toMatch(/states no default/)
  })
})
