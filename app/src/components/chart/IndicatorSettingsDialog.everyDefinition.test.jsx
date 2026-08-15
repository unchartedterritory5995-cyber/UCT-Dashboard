// app/src/components/chart/IndicatorSettingsDialog.everyDefinition.test.jsx
//
// ─── THE SETTINGS FORM, FOR EVERY INDICATOR, AT EVERY DECLARED BOUND ────────
//
// `IndicatorSettingsDialog.test.jsx` proves the dialog's BEHAVIOUR — the debounce,
// the rollback, the focus trap — and it proves it against RSI. That is the right
// shape for those claims, and it is why every one of them is written once.
//
// This file asks a different question: does the generated form actually work for
// each of the seventeen definitions that ship? The generator resolves controls
// from `def.inputs`, so a definition whose declaration disagrees with its own
// compute — a bound the maths cannot survive, an input with no control type, a
// label that never renders a row — produces a form that looks fine and edits
// nothing. Nothing enumerated the definitions here.
//
// ⭐ THE LIST IS THE REGISTRY'S, NOT MINE. `listDefinitions()` drives every case,
// so an indicator added tomorrow is swept the day it registers, at the bounds it
// chose. The sibling sweep at `engine/__tests__/everyIndicatorParameterSweep.test.js`
// does the same for the COMPUTE lane, and found Ichimoku throwing a TypeError on a
// period its own form offers.
//
// ⛔ THE CLAMP CASES ARE THE POINT. A member types a number the definition refuses;
// `setInstanceInput` returns the blob by IDENTITY and the write is dropped. Without
// the clamp the box keeps the typed number and the chart keeps the old one — a
// control that looks like it worked and did not. So every numeric input is driven
// one PAST each of its own declared bounds, and the form has to both correct the
// value and SAY that it did.
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import IndicatorSettingsDialog from './IndicatorSettingsDialog'
import { mergeChartSettings } from './chartDefaults'
import { setIndicatorEnabled, findInstance } from './engine/instanceControls'
import { legacyInstanceId } from './engine/instances'
import { fieldsForInstance } from './indicatorRegistry'
import * as engineRegistry from './engine/nativeRegistry'

const DEFS = engineRegistry.listDefinitions()
  .map((d) => engineRegistry.getDefinition(d.id) || d)
  .filter(Boolean)

function Harness({ initial, instanceId, onChangeSpy }) {
  const [cs, setCs] = useState(initial)
  return (
    <IndicatorSettingsDialog
      open instanceId={instanceId} settings={cs} registry={engineRegistry}
      onChange={(next) => { setCs(next); onChangeSpy(next) }}
      onClose={() => {}}
    />
  )
}

function mountFor(defId) {
  const initial = setIndicatorEnabled(mergeChartSettings(null), defId, true, engineRegistry)
  const instanceId = legacyInstanceId(defId)
  const onChange = vi.fn()
  render(<Harness initial={initial} instanceId={instanceId} onChangeSpy={onChange} />)
  return { initial, instanceId, onChange, latest: () => (onChange.mock.calls.length
    ? onChange.mock.calls[onChange.mock.calls.length - 1][0] : initial) }
}

const dialog = () => screen.getByRole('dialog')
const rowKeys = () => [...dialog().querySelectorAll('[data-input-key]')].map((r) => r.dataset.inputKey)
const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }))

/** Every key the generator says belongs on a tab, gathered across all three. */
function renderedKeysAcrossTabs() {
  const seen = new Set()
  for (const tab of ['Inputs', 'Style', 'Visibility']) {
    openTab(tab)
    for (const k of rowKeys()) seen.add(k)
  }
  openTab('Inputs')
  return seen
}

describe('the sweep covers the shipped registry — the control', () => {
  it('there are definitions, and they declare inputs', () => {
    expect(DEFS.length).toBeGreaterThan(10)
    expect(DEFS.filter((d) => (d.inputs || []).length > 0).length).toBeGreaterThan(10)
  })
})

describe('every definition renders a usable settings form', () => {
  for (const def of DEFS) {
    it(`${def.id}: opens with three tabs and a title`, () => {
      mountFor(def.id)
      expect(dialog()).toBeTruthy()
      expect(screen.getAllByRole('tab').map((t) => t.textContent))
        .toEqual(['Inputs', 'Style', 'Visibility'])
      cleanup()
    })
  }

  for (const def of DEFS) {
    it(`${def.id}: every generated field reaches a row`, () => {
      const { initial, instanceId } = mountFor(def.id)
      const model = fieldsForInstance(def, findInstance(initial, instanceId))
      const rendered = renderedKeysAcrossTabs()
      const missing = model.all.map((f) => f.key).filter((k) => !rendered.has(k))
      expect(missing, `${def.id}: generated fields that render no row`).toEqual([])
      cleanup()
    })
  }
})

describe('every numeric input clamps at BOTH of its own declared bounds, and says so', () => {
  for (const def of DEFS) {
    const nums = (def.inputs || []).filter((i) => i && (i.type === 'int' || i.type === 'float')
      && Number.isFinite(i.min) && Number.isFinite(i.max))
    if (!nums.length) continue

    it(`${def.id}: ${nums.map((n) => n.key).join(', ')}`, () => {
      const { instanceId, latest } = mountFor(def.id)
      const model = fieldsForInstance(def, findInstance(latest(), instanceId))

      for (const declared of nums) {
        const field = model.all.find((f) => f.key === declared.key)
        if (!field) continue
        // The field may live on Inputs or on Style; find whichever tab shows it.
        let box = null
        for (const tab of ['Inputs', 'Style']) {
          openTab(tab)
          const row = dialog().querySelector(`[data-input-key="${declared.key}"]`)
          if (row) { box = row.querySelector('input[type="number"]'); break }
        }
        if (!box) continue

        // ── one PAST the maximum ──
        fireEvent.change(box, { target: { value: String(declared.max + 1) } })
        fireEvent.blur(box)
        expect(box.value,
          `${def.id}.${declared.key}: typing ${declared.max + 1} left the box uncorrected`)
          .toBe(String(declared.max))
        expect(findInstance(latest(), instanceId).inputs[declared.key],
          `${def.id}.${declared.key}: the instance did not take the clamped max`)
          .toBe(declared.max)
        expect(screen.getAllByRole('status').map((n) => n.textContent).join(' '),
          `${def.id}.${declared.key}: clamped to the max SILENTLY`)
          .toMatch(new RegExp(`Maximum is ${declared.max}`))

        // ── one BELOW the minimum ──
        fireEvent.change(box, { target: { value: String(declared.min - 1) } })
        fireEvent.blur(box)
        expect(box.value,
          `${def.id}.${declared.key}: typing ${declared.min - 1} left the box uncorrected`)
          .toBe(String(declared.min))
        expect(findInstance(latest(), instanceId).inputs[declared.key],
          `${def.id}.${declared.key}: the instance did not take the clamped min`)
          .toBe(declared.min)
        expect(screen.getAllByRole('status').map((n) => n.textContent).join(' '),
          `${def.id}.${declared.key}: clamped to the min SILENTLY`)
          .toMatch(new RegExp(`Minimum is ${declared.min}`))
      }
      cleanup()
    })
  }
})

describe('a value the definition refuses never reaches the chart as text', () => {
  for (const def of DEFS) {
    const num = (def.inputs || []).find((i) => i && (i.type === 'int' || i.type === 'float'))
    if (!num) continue
    it(`${def.id}.${num.key}: gibberish restores the stored value rather than committing NaN`, () => {
      const { instanceId, latest } = mountFor(def.id)
      let box = null
      for (const tab of ['Inputs', 'Style']) {
        openTab(tab)
        const row = dialog().querySelector(`[data-input-key="${num.key}"]`)
        if (row) { box = row.querySelector('input[type="number"]'); break }
      }
      if (!box) { cleanup(); return }
      const before = findInstance(latest(), instanceId).inputs?.[num.key] ?? num.default

      fireEvent.change(box, { target: { value: '' } })
      fireEvent.blur(box)

      const after = findInstance(latest(), instanceId).inputs?.[num.key] ?? num.default
      expect(Number.isFinite(after), `${def.id}.${num.key} committed a non-number`).toBe(true)
      expect(after).toBe(before)
      cleanup()
    })
  }
})
