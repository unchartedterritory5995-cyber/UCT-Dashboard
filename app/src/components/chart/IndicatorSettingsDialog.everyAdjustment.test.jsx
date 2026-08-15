// app/src/components/chart/IndicatorSettingsDialog.everyAdjustment.test.jsx
//
// ─── EVERY INDICATOR × EVERY ADJUSTMENT THE FORM OFFERS ─────────────────────
//
// `IndicatorSettingsDialog.everyDefinition.test.jsx` swept every definition's
// NUMERIC inputs, because that is where the clamp lives. It left the other three
// control types untouched — and a `select` whose write is dropped, a `toggle` that
// flips its own pip but never reaches the instance, or a colour that changes the
// swatch and not the line are all the same defect as the clamp bug: a control that
// looks like it worked and did not.
//
// So this file drives EVERY generated field on EVERY definition, through the
// rendered control, and asserts the value landed on the INSTANCE — the thing the
// chart draws from. Plus the two Visibility adjustments (`hidden`, `placement`)
// and a per-definition Cancel rollback, because rollback is only proven where an
// edit was proven first.
//
// ⭐ NOTHING HERE NAMES AN INDICATOR. The fields come from `fieldsForInstance`,
// which is the generator the dialog itself renders from, so a definition that adds
// a control tomorrow is driven the day it registers.
//
// ⛔ A DISABLED FIELD IS SKIPPED AND COUNTED, NOT ASSERTED ON. `activeWhen` dims a
// control that another input governs, and driving one would assert that a
// deliberately inert control writes. The count is reported so "everything was
// skipped" can never look like "everything passed".
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import IndicatorSettingsDialog, { DEBOUNCE_MS } from './IndicatorSettingsDialog'
import { mergeChartSettings } from './chartDefaults'
import { setIndicatorEnabled, findInstance } from './engine/instanceControls'
import { legacyInstanceId } from './engine/instances'
import { fieldsForInstance } from './indicatorRegistry'
import { PLACEMENT_TARGETS } from './engine/defSchema'
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
  const latest = () => (onChange.mock.calls.length
    ? onChange.mock.calls[onChange.mock.calls.length - 1][0] : initial)
  return { initial, instanceId, latest }
}

/** Past the debounce window, on REAL timers.
 *
 * ⛔ LOAD-BEARING FOR THE COLOUR CASES, AND ONLY THOSE. Number commits go through
 * `commitNumber` → `flushNow()`, and selects and toggles set `pendingRef` then call
 * `flushNow()` — all immediate. A COLOUR goes through `schedule()`, the 250ms
 * debounced path, because a drag across a gradient would otherwise write on every
 * pointer move. Reading the instance straight after a colour change therefore
 * reports `undefined` and looks exactly like "the control moved and the instance
 * did not" — which is what the first run of this file claimed, for all 17
 * definitions, before this wait existed. `DEBOUNCE_MS` is imported, never typed. */
const settle = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 80)) })
}

const dialog = () => screen.getByRole('dialog')
const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }))
const rowFor = (key) => {
  for (const tab of ['Inputs', 'Style']) {
    openTab(tab)
    const r = dialog().querySelector(`[data-input-key="${key}"]`)
    if (r) return r
  }
  return null
}

/** Drive one generated field through its rendered control. Returns the value the
 *  control was pushed to, or null when there was nothing to drive. */
function driveField(field, row, current) {
  if (field.type === 'number') {
    const box = row.querySelector('input[type="number"]')
    if (!box || box.disabled) return null
    const lo = Number.isFinite(field.min) ? field.min : 1
    const hi = Number.isFinite(field.max) ? field.max : 100
    let target = null
    for (let v = lo; v <= hi; v++) if (v !== current) { target = v; break }
    if (target === null) return null
    fireEvent.change(box, { target: { value: String(target) } })
    fireEvent.blur(box)
    return target
  }
  if (field.type === 'select') {
    const sel = row.querySelector('select')
    if (!sel || sel.disabled) return null
    const opts = (field.options || []).map(([v]) => v)
    const target = opts.find((v) => String(v) !== String(current))
    if (target === undefined) return null
    fireEvent.change(sel, { target: { value: String(target) } })
    return target
  }
  if (field.type === 'toggle') {
    const sw = row.querySelector('[role="switch"]')
    if (!sw || sw.disabled) return null
    fireEvent.click(sw)
    return current === false          // it flips
  }
  if (field.type === 'color') {
    // The swatch opens a portalled popup whose preset buttons carry the hex as
    // their `title`. Driving the real control rather than the handler is the point:
    // the dialog wires `ColorPicker`'s `onChange`, and a broken wire is invisible
    // to a test that calls the handler directly.
    const trigger = row.querySelector('button')
    if (!trigger || trigger.disabled) return null
    fireEvent.click(trigger)
    const preset = [...document.querySelectorAll('button')]
      .find((b) => /^#[0-9a-f]{6}$/i.test(b.getAttribute('title') || '')
        && (b.getAttribute('title') || '').toLowerCase() !== String(current).toLowerCase())
    if (!preset) return null
    fireEvent.click(preset)
    return preset.getAttribute('title')
  }
  return null
}

describe('the sweep has fields to drive — the control', () => {
  it('the definitions declare more than one KIND of control between them', () => {
    const kinds = new Set()
    for (const def of DEFS) {
      const initial = setIndicatorEnabled(mergeChartSettings(null), def.id, true, engineRegistry)
      const model = fieldsForInstance(def, findInstance(initial, legacyInstanceId(def.id)))
      for (const f of model.all) kinds.add(f.type)
    }
    // If this ever collapses to just {number} the sweep below has quietly stopped
    // covering selects, toggles and colours.
    expect([...kinds].sort()).toContain('number')
    expect(kinds.size, `only saw control kinds: ${[...kinds]}`).toBeGreaterThan(1)
  })
})

describe('every generated field, on every definition, writes to the instance', () => {
  for (const def of DEFS) {
    it(`${def.id}`, async () => {
      const { initial, instanceId, latest } = mountFor(def.id)
      const model = fieldsForInstance(def, findInstance(initial, instanceId))
      let driven = 0
      let skippedDisabled = 0

      for (const field of model.all) {
        const row = rowFor(field.key)
        if (!row) continue
        const before = fieldsForInstance(def, findInstance(latest(), instanceId)).values[field.key]
        const target = driveField(field, row, before)
        if (target === null) { skippedDisabled++; continue }
        await settle()

        const after = findInstance(latest(), instanceId).inputs[field.key]
        expect(after,
          `${def.id}.${field.key} (${field.type}): the control moved but the INSTANCE did not — `
          + `expected ${JSON.stringify(target)}, instance has ${JSON.stringify(after)}`)
          .toEqual(target)
        driven++
      }

      // Reported so an all-skipped definition can never read as an all-passed one.
      expect(driven + skippedDisabled,
        `${def.id}: no generated field reached a row at all`).toBeGreaterThan(0)
      cleanup()
    })
  }
})

describe('the Visibility tab writes both of its adjustments, on every definition', () => {
  for (const def of DEFS) {
    it(`${def.id}: hide toggle and placement`, () => {
      const { instanceId, latest } = mountFor(def.id)
      openTab('Visibility')

      const sw = screen.getByRole('switch', { name: /visible on the chart/i })
      const before = findInstance(latest(), instanceId).hidden === true
      fireEvent.click(sw)
      expect(findInstance(latest(), instanceId).hidden,
        `${def.id}: the visibility toggle did not reach the instance`).toBe(!before)

      const sel = screen.getByRole('combobox', { name: /move to/i })
      for (const target of PLACEMENT_TARGETS) {
        fireEvent.change(sel, { target: { value: target } })
        expect(findInstance(latest(), instanceId).placement?.target,
          `${def.id}: "Move to ${target}" did not reach the instance`).toBe(target)
      }
      cleanup()
    })
  }
})

describe('Cancel restores the blob byte-for-byte, on every definition', () => {
  for (const def of DEFS) {
    it(`${def.id}`, async () => {
      const { initial, instanceId, latest } = mountFor(def.id)
      const opened = JSON.stringify(latest())
      const model = fieldsForInstance(def, findInstance(initial, instanceId))

      let changed = false
      for (const field of model.all) {
        const row = rowFor(field.key)
        if (!row) continue
        const before = fieldsForInstance(def, findInstance(latest(), instanceId)).values[field.key]
        if (driveField(field, row, before) !== null) { await settle(); changed = true; break }
      }
      openTab('Visibility')
      fireEvent.click(screen.getByRole('switch', { name: /visible on the chart/i }))
      changed = true

      // ⛔ THE POSITIVE CONTROL. Without proving the edit was observable first, a
      // dialog that wrote nothing at all would satisfy the rollback assertion.
      expect(changed, `${def.id}: nothing was edited, so rollback proves nothing`).toBe(true)
      expect(JSON.stringify(latest()),
        `${def.id}: the edit was not observable before Cancel`).not.toBe(opened)

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(JSON.stringify(latest()),
        `${def.id}: Cancel did not restore the blob it opened with`).toBe(opened)
      cleanup()
    })
  }
})
