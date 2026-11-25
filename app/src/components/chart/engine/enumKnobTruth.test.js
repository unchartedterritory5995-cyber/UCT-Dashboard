// app/src/components/chart/engine/enumKnobTruth.test.js
//
// ─── ⭐⭐ e97 U8 — THE CLASS RAIL: EVERY ENUM SETTING A MEMBER CAN SEE IS TRUE ────────────────────────────────────────
//
// For every `enum` setting the door declares on these scripts (`enumKnobTruth.js`):
//   · it MOVES something: at some option a computed column or the shown set differs from the default's;
//   · what it moves is the script's own answer: at every option, the picture equals the same script with that option
//     WELDED in as plain text (the literal program), and where this engine refuses the literal program the setting
//     refuses there too, by name.
// ⚰️ The built-in MA family's "Type" moved only what was shown: picking EMA drew the SMA under the member's choice (the
// knob never reached `ma(src, len, type) => switch type`). The CONTROL below hands the checker exactly that document.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { enumKnobTruth, walkBars, withLiteralOption } from './enumKnobTruth.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CORPUS = path.resolve(HERE, '../../../../../corpus/committed')
const BARS = walkBars()

// the MA-family shape, written for this rail: a helper whose PARAMETER is the type, a VWMA arm reading the length
// setting, a `var` gate on the type, a band on a second setting
const familyOf = (smoothBody) => [
  '//@version=6',
  'indicator("family", overlay = true)',
  'len = input.int(14, "Length")',
  'base = ta.sma(close, 9)',
  'plot(base, "Base", color = color.blue)',
  'kind = input.string("SMA", "Type", options = ["None", "SMA", "SMA + BB", "EMA", "VWMA"])',
  'mult = input.float(2.0, "Mult")',
  'var useMa = kind != "None"',
  'var useBands = kind == "SMA + BB"',
  'smooth(x, n, t) =>',
  smoothBody,
  'm = useMa ? smooth(base, len, kind) : na',
  'dev = useBands ? ta.stdev(base, len) * mult : na',
  'plot(m, "Smoothed", color = color.yellow, display = useMa ? display.all : display.none)',
  'up = plot(m + dev, "Upper", color = color.green, display = useBands ? display.all : display.none)',
  'lo = plot(m - dev, "Lower", color = color.green, display = useBands ? display.all : display.none)',
  'fill(up, lo, color = color.new(color.green, 90), display = useBands ? display.all : display.none)',
  '',
].join('\n')
const FAMILY = familyOf('    switch t\n        "SMA" => ta.sma(x, n)\n        "SMA + BB" => ta.sma(x, n)\n        "EMA" => ta.ema(x, n)\n        "VWMA" => ta.vwma(x, n)')

const expectTrue = (result) => {
  expect(result.ok, result.reason).toBe(true)
  expect(result.knobs.length).toBeGreaterThan(0)
  for (const k of result.knobs) {
    expect(k.moves.length, `${k.key} moves nothing`).toBeGreaterThan(0)
    expect(k.untrue, `${k.key}`).toEqual([])
  }
}

describe('e97 U8 — every enum setting a member can see moves the script\'s own answer', () => {
  it('the MA-family shape: "Type" reaches the switch through the helper\'s parameter, and every type is the literal program', () => {
    const r = enumKnobTruth(FAMILY, BARS)
    expectTrue(r)
    expect(r.knobs.map((k) => k.key)).toEqual(['kind'])
    // the length the VWMA arm reads does not cost the script its other settings (the door's declaring pass translates)
    const def = memberPaneDefinition({ source: FAMILY }).definition
    expect(def.inputs.map((i) => i.key)).toEqual(expect.arrayContaining(['kind', 'mult']))
  }, 120000)

  it.each([
    ['artemis-oscillator-pro__ea1097ca9e.pine'],
    ['multicator-table__486858895c.pine'],
  ])('%s: every enum setting it offers is true', (file) => {
    expectTrue(enumKnobTruth(fs.readFileSync(path.join(CORPUS, file), 'utf8'), BARS))
  }, 240000)

  // ⭐ coordinator ruling (i): a switch the setting reaches through a helper's parameter is built within a budget; over
  // it, the switch folds to the default as it always did and the setting is WITHHELD BY NAME. Measured: artemis's
  // drmMethod (its helper-of-helper method switch) is over; sigMethod is within, and true (above).
  it('⛔ over the budget, the setting is withheld by name (artemis "Smoothing" / drmMethod), never a lying control', () => {
    const r = memberPaneDefinition({ source: fs.readFileSync(path.join(CORPUS, 'artemis-oscillator-pro__ea1097ca9e.pine'), 'utf8') })
    expect(r.ok, r.reason).toBe(true)
    const keys = r.definition.inputs.map((i) => i.key)
    expect(keys).not.toContain('drmMethod')
    expect(keys).toContain('sigMethod')
    expect((r.notes || []).map((n) => n.note).join(' | '))
      .toContain('is not offered as a setting: this script\'s setting "Smoothing" has more variants than this engine expands yet, so it stays at its default "RMA"')
  }, 240000)

  it('⛔ CONTROL: a document whose "Type" never reaches the smoothing is caught (the lie this rail exists for)', () => {
    const lying = memberPaneDefinition({ source: familyOf('    ta.sma(x, n) + 0 * (t == "EMA" ? 1 : 0)') })
    expect(lying.ok, lying.reason).toBe(true)
    const r = enumKnobTruth(FAMILY, BARS, { definition: lying.definition })
    const kind = r.knobs.find((k) => k.key === 'kind')
    expect(kind.untrue.map((u) => u.option)).toEqual(expect.arrayContaining(['EMA']))
  }, 120000)

  it('CONTROL: the literal program welds the option as plain text', () => {
    const lit = withLiteralOption(FAMILY, 'kind', 'EMA')
    expect(lit).toContain('kind = "EMA"\n')
    expect(lit).not.toContain('input.string')
  })
})
