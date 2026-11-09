// app/src/components/chart/IndicatorSettingsDialog.myDefault.test.jsx
//
// ─── UCT RS unit VA2 (§17.8) — "Save as my default" in the DESKTOP dialog ────
//
// Generic: any shipped indicator with a savable input shows the two buttons and
// a one-line note. Pinned on UCT RS and on RSI (the control: not RS-specific).
//   · Save writes `indicatorDefaults` and leaves the copy as it is;
//   · ⛔ Cancel undoes the copy's edits, NEVER a saved default (the snapshot
//     carries it);
//   · Reset to UCT default forgets the default and puts this copy on UCT's values;
//   · each button is disabled exactly when it would change nothing;
//   · the rating inputs render where the plan puts them (Simple; Rating, folded).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import IndicatorSettingsDialog from './IndicatorSettingsDialog'
import { mergeChartSettings } from './chartDefaults'
import { setIndicatorEnabled, findInstance, setInstanceInput, INDICATOR_DEFAULTS_KEY } from './engine/instanceControls'
import { legacyInstanceId } from './engine/instances'
import * as engineRegistry from './engine/nativeRegistry'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

let calls = []
function Harness({ initial, instanceId }) {
  const [cs, setCs] = useState(initial)
  return (
    <IndicatorSettingsDialog open instanceId={instanceId} settings={cs} registry={engineRegistry}
      onChange={(next) => { calls.push(next); setCs(next) }} onClose={() => {}} />
  )
}
const RS_ID = legacyInstanceId('rsLine')
const rsCs = (inputs = {}) => {
  let cs = setIndicatorEnabled(mergeChartSettings(null), 'rsLine', true, engineRegistry)
  for (const [k, v] of Object.entries(inputs)) cs = setInstanceInput(cs, RS_ID, k, v, engineRegistry)
  return cs
}
const mount = (cs, instanceId = RS_ID) => { calls = []; render(<Harness initial={cs} instanceId={instanceId} />) }
const latest = () => calls[calls.length - 1]
const save = () => screen.getByTestId('save-default')
const reset = () => screen.getByTestId('reset-default')
const note = () => screen.getByTestId('my-default-note').textContent

describe('the two buttons and the note', () => {
  it('a fresh copy at UCT\'s values: both disabled, the note names UCT\'s settings', () => {
    mount(rsCs())
    expect(save().textContent).toBe('Save as my default')
    expect(reset().textContent).toBe('Reset to UCT default')
    expect(save().disabled).toBe(true)
    expect(reset().disabled).toBe(true)
    expect(note()).toBe('New copies start with UCT\'s settings.')
  })

  it('Save writes the default for NEW copies and leaves this copy untouched', async () => {
    const cs = rsCs({ benchmark: 'RSP' })
    mount(cs)
    expect(save().disabled).toBe(false)
    await act(async () => { fireEvent.click(save()) })
    const next = latest()
    expect(next[INDICATOR_DEFAULTS_KEY]).toEqual({ rsLine: { inputs: { benchmark: 'RSP' } } })
    expect(findInstance(next, RS_ID).inputs).toEqual(findInstance(cs, RS_ID).inputs)
    expect(note()).toBe('New copies of this indicator start with these settings.')
    expect(save().disabled).toBe(true)
  })

  it('⛔ Cancel undoes the edits made in the dialog, never the saved default', async () => {
    mount(rsCs({ benchmark: 'RSP' }))
    await act(async () => { fireEvent.click(save()) })
    // an edit after saving: the benchmark select
    const select = screen.getByRole('combobox', { name: 'Benchmark' })
    await act(async () => { fireEvent.change(select, { target: { value: 'QQQ' } }) })
    expect(findInstance(latest(), RS_ID).inputs.benchmark).toBe('QQQ')
    expect(note()).toBe('New copies start with your saved default, not these settings.')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
    const after = latest()
    expect(findInstance(after, RS_ID).inputs.benchmark).toBe('RSP')          // the edit is undone
    expect(after[INDICATOR_DEFAULTS_KEY]).toEqual({ rsLine: { inputs: { benchmark: 'RSP' } } }) // the default stays
  })

  it('Reset to UCT default forgets the default and puts this copy on UCT\'s values', async () => {
    mount({ ...rsCs({ benchmark: 'RSP', showRating: false }), [INDICATOR_DEFAULTS_KEY]: { rsLine: { inputs: { benchmark: 'RSP' } } } })
    expect(reset().disabled).toBe(false)
    await act(async () => { fireEvent.click(reset()) })
    const next = latest()
    expect(INDICATOR_DEFAULTS_KEY in next).toBe(false)
    expect(findInstance(next, RS_ID).inputs).toMatchObject({ benchmark: 'SPY', showRating: true })
    expect(reset().disabled).toBe(true)
    expect(note()).toBe('New copies start with UCT\'s settings.')
  })

  it('is generic: RSI carries the same controls', async () => {
    let cs = setIndicatorEnabled(mergeChartSettings(null), 'rsi', true, engineRegistry)
    const id = legacyInstanceId('rsi')
    cs = setInstanceInput(cs, id, 'period', 9, engineRegistry)
    mount(cs, id)
    await act(async () => { fireEvent.click(save()) })
    expect(latest()[INDICATOR_DEFAULTS_KEY]).toEqual({ rsi: { inputs: { period: 9 } } })
  })
})

describe('the rating inputs render where the plan puts them', () => {
  const groupHead = (name) => [...screen.getByRole('dialog').querySelectorAll('button[aria-expanded][aria-controls]')]
    .find((b) => b.textContent === name)
  it('RS Rating in Simple (open); Headline rating and Rating colours in Rating (folded), dimmed with the rating off', async () => {
    mount(rsCs({ showRating: false }))
    expect(screen.getByRole('dialog').querySelector('[data-input-key="showRating"]')).not.toBeNull()
    expect(groupHead('Rating').getAttribute('aria-expanded')).toBe('false')
    await act(async () => { fireEvent.click(groupHead('Rating')) })
    const headline = screen.getByRole('combobox', { name: 'Headline rating' })
    expect(headline.disabled).toBe(true)
    expect([...headline.options].map((o) => o.textContent)).toEqual(['IBD-style', 'UCT fast', 'Both'])
    expect(screen.getByRole('switch', { name: 'Rating colours' }).getAttribute('aria-disabled')).toBe('true')
  })
  it('the five folded groups, Simple open', () => {
    mount(rsCs())
    expect(groupHead('Simple').getAttribute('aria-expanded')).toBe('true')
    for (const g of ['Line', 'New highs', 'Rating', 'Stress test', 'Method']) {
      expect(groupHead(g).getAttribute('aria-expanded'), g).toBe('false')
    }
  })
})
