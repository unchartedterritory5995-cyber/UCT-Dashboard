// A name for anything a chart can hold.
//
// Found on production, 2026-11-17: putting a house indicator on a chart said
// "u_ace6fec50339 added". The history toast named what was added with `labelFor`, which reads the
// shipped catalogue only, so every member-made indicator (built, pasted, installed) fell through
// to its id. `anyLabelFor` is the reader for surfaces that name whatever is on the chart.

import { describe, it, expect, afterEach } from 'vitest'
import * as registry from './engine/nativeRegistry'
import { anyLabelFor, labelFor } from './indicatorCatalog'
import { describeIndicatorChange } from './indicatorHistoryStore'
import { mergeChartSettings } from './chartDefaults'
import { addInstance } from './engine/instanceControls'
import HOUSE from './house/houseIndicators.json'
import STOCKCHART_SRC from '../StockChart.jsx?raw'
import PANE_SRC from './pane/ChartPane.jsx?raw'
import MOBILE_SRC from '../../pages/charts/mobile/MobileChartsApp.jsx?raw'

const OWN_ID = 'u_0123456789ab'
const item = HOUSE.indicators.find((i) => i.slug === 'distribution_day_count')
const install = () => registry.installUserDefinitions([{ ...item.definition, id: OWN_ID }])

afterEach(() => { registry.clearUserDefinitions() })

describe('anyLabelFor', () => {
  it('a member\'s own indicator is named by the name it was saved under, never its id', () => {
    expect(install().errors).toEqual([])
    expect(anyLabelFor(OWN_ID)).toBe('Distribution Day Count')
    // control: the shipped-only reader is what fell through to the id
    expect(labelFor(OWN_ID)).toBe(OWN_ID)
  })

  it('a shipped indicator keeps its short name, the same answer labelFor gives', () => {
    for (const id of ['rsi', 'macd', 'ema']) {
      if (registry.getDefinition(id)) expect(anyLabelFor(id)).toBe(labelFor(id))
    }
    expect(anyLabelFor('rsi')).not.toBe('')
  })

  it('an id nothing knows is returned as it is (no invented name)', () => {
    expect(anyLabelFor('u_ffffffffffff')).toBe('u_ffffffffffff')
  })
})

describe('the chart\'s history names a member\'s indicator', () => {
  it('"Distribution Day Count added", not the id', () => {
    install()
    const before = mergeChartSettings({})
    const after = addInstance(before, OWN_ID, registry)
    expect(after).not.toBe(before)
    const said = describeIndicatorChange(before, after, anyLabelFor)
    expect(said.kind).toBe('add')
    expect(said.label).toBe('Distribution Day Count added')
    // control: with the shipped-only reader the same change reads as the id
    expect(describeIndicatorChange(before, after, labelFor).label).toBe(`${OWN_ID} added`)
  })

  // source rails: comments are stripped first, so a sentence about the rule is not the rule
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('all three recorders of an indicator change read names through anyLabelFor', () => {
    expect(code(STOCKCHART_SRC)).toMatch(/labelOf: anyLabelFor, origin: chartId/)
    expect(code(STOCKCHART_SRC)).not.toMatch(/labelOf: labelFor\b/)
    expect(code(PANE_SRC)).toMatch(/import \{ anyLabelFor as indicatorLabelFor \} from '\.\.\/indicatorCatalog'/)
    expect(code(MOBILE_SRC)).toMatch(/import \{ anyLabelFor as indicatorLabelFor \} from/)
  })
})
