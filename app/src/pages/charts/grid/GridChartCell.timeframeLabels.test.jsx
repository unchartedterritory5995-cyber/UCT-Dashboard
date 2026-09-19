// D2 §4-CP3 — GridChartCell.jsx no longer hand-types the timeframe code->label
// map. It imports the generated `timeframeLabels.json`, which
// tools/build_canonical_address_book.py derives from the address book's
// `axes.timeframe.code_to_label` (sourced from
// api/services/signature/ledger.py::_BARS_STORE_TF_KEYS) — never a fourth
// hand-typed copy of the eight-entry map PRD-D2 §9.2 named this file for.
//
// ⛔ SOURCE-TEXT REGRESSION, NOT BEHAVIOUR ALONE. GridChartCell.test.jsx's own
// suite renders the real component through heavy mocks and would pass even if
// someone reintroduced a hand-typed literal alongside the import (dead code is
// invisible to a render test). This reads the raw file.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import TF_LABELS from '../../../components/chart/engine/ast/timeframeLabels.json'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'GridChartCell.jsx'), 'utf-8')

describe('D2 §4-CP3 — GridChartCell.jsx reads the declared timeframe map', () => {
  it('imports the generated export', () => {
    expect(SOURCE).toMatch(
      /import TF_LABELS from ['"]\.\.\/\.\.\/\.\.\/components\/chart\/engine\/ast\/timeframeLabels\.json['"]/
    )
  })

  it('does not carry a second, hand-typed copy of the map', () => {
    // The old literal, verbatim from the pre-CP3 diff — copied ugly on purpose
    // so a reformat can't silently defeat this check (same convention as
    // ChartPane.chordAdoption.test.jsx).
    expect(SOURCE).not.toContain(
      "'1': '1m', '5': '5m', '15': '15m', '30': '30m',"
    )
    expect(SOURCE).not.toContain("'60': '1h', 'D': '1D', 'W': '1W', 'M': '1M',")
  })

  it('the generated export is non-empty and has the eight declared codes', () => {
    expect(Object.keys(TF_LABELS).sort()).toEqual(
      ['1', '15', '30', '5', '60', 'D', 'M', 'W'].sort()
    )
    expect(TF_LABELS).toEqual({
      '1': '1m', '5': '5m', '15': '15m', '30': '30m',
      '60': '1h', 'D': '1D', 'W': '1W', 'M': '1M',
    })
  })
})
