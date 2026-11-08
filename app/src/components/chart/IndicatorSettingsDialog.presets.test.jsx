// app/src/components/chart/IndicatorSettingsDialog.presets.test.jsx
//
// ─── THE GENERIC PRESET PICKER AND THE `groupsCollapsed` HINT (UCT RS Phase 1, unit 4) ──
//
// Plan §5 / §6.3 / §6.8: a preset is a named set of input values on the
// DEFINITION (`meta.presets`), applied to the CURRENT instance through the one
// writer, `setInstanceInput`. The dialog stays generic — nothing here names RS
// except the one case that proves the shipped definition reaches the picker.
//
// ⭐ EVERY WRITE IS PROVED THROUGH THE DOOR, NOT BY A SPY ON IT. A preset value the
// definition would refuse (out of range) must NOT land on the instance; a direct
// write would have stored it. That is a stronger proof that the writer is in the
// loop than counting calls, and it survives a refactor of the loop.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, within, act, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IndicatorSettingsDialog, { DEBOUNCE_MS, CUSTOM_PRESET } from './IndicatorSettingsDialog'
import { fieldsFromDefinition } from './indicatorRegistry'
import { mergeChartSettings } from './chartDefaults'
import { setIndicatorEnabled, findInstance, applyPresetInputs } from './engine/instanceControls'
import { legacyInstanceId } from './engine/instances'
import { validateDefinition } from './engine/defSchema'
import * as engineRegistry from './engine/nativeRegistry'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

// ─── harness (the dialog suite's own shape) ─────────────────────────────────

let harness = { onChange: null, initial: null }

function Harness({ initial, instanceId, registry, onChangeSpy, onCloseSpy, open = true }) {
  const [cs, setCs] = useState(initial)
  return (
    <IndicatorSettingsDialog
      open={open}
      instanceId={instanceId}
      settings={cs}
      registry={registry}
      onChange={(next) => { onChangeSpy?.(next); setCs(next) }}
      onClose={onCloseSpy}
    />
  )
}

function mount({ settings, instanceId, registry = engineRegistry }) {
  const onChange = vi.fn()
  const onClose = vi.fn()
  harness = { onChange, initial: settings }
  render(
    <Harness initial={settings} instanceId={instanceId} registry={registry}
             onChangeSpy={onChange} onCloseSpy={onClose} />,
  )
  return { onChange, onClose }
}

const latest = () => {
  const calls = harness.onChange?.mock?.calls || []
  return calls.length ? calls[calls.length - 1][0] : harness.initial
}
const dialog = () => screen.getByRole('dialog')
const picker = () => screen.queryByTestId('preset-picker')
const presetSelect = () => screen.getByRole('combobox', { name: 'Preset' })
const resetButton = () => screen.getByRole('button', { name: 'Reset to preset' })
const choosePreset = (id) => fireEvent.change(presetSelect(), { target: { value: id } })
/** The GROUP HEADER for `name` — the disclosure button, which is the one button
 *  carrying `aria-expanded`. A colour swatch takes its accessible name from the
 *  input's label, and UCT RS labels a colour 'Line' inside the group 'Line', so a
 *  plain role+name query finds two buttons on the Style tab. */
const groupButton = (name) => {
  const hits = [...dialog().querySelectorAll('button[aria-expanded][aria-controls]')]
    .filter((b) => b.textContent === name)
  if (hits.length !== 1) throw new Error(`expected one group header named ${JSON.stringify(name)}, found ${hits.length}`)
  return hits[0]
}
const settle = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 80)) })
}

/** A registry over ONE hand-built definition, validated through the REAL
 *  `validateDefinition` so a fixture the product would refuse cannot pass. */
function fakeRegistry(raw) {
  const res = validateDefinition(raw)
  if (!res.ok) throw new Error(`fixture definition rejected: ${res.errors.join(' | ')}`)
  const def = res.def
  return { def, getDefinition: (id) => (id === def.id ? def : null), listDefinitions: () => [def] }
}

const FIX = 'presetfix'
const FIX_INST = `inst:${FIX}:1`
const FIX_SIBLING = `inst:${FIX}:2`

const FAST = { length: 5, mode: 'a', smooth: true }
const SLOW = { length: 50, mode: 'b', smooth: false }

/** Two real presets, one that names a key the definition does not declare, and
 *  one whose value the definition's own bounds refuse. */
const fixtureRaw = (metaExtra = {}) => ({
  schemaVersion: 1,
  id: FIX,
  version: 1,
  compute: { kind: 'native', fn: FIX, rev: 1 },
  meta: {
    name: 'Fixture presets', shortName: 'PFX', category: 'Test', tier: 'free', repaint: 'non-repainting',
    groupsCollapsed: ['Advanced'],
    presets: [
      { id: 'fast', label: 'Fast', origin: 'Fixture origin: fast', inputs: FAST },
      { id: 'slow', label: 'Slow', origin: 'Fixture origin: slow', inputs: SLOW },
      { id: 'stale', label: 'Stale', origin: 'Names an undeclared key', inputs: { length: 20, ghost: 1 } },
      { id: 'wild', label: 'Wild', inputs: { length: 9999 } },
    ],
    ...metaExtra,
  },
  placement: { target: 'price' },
  inputs: [
    { key: 'length', type: 'int', label: 'Length', default: 14, min: 1, max: 500, step: 1, group: 'Simple' },
    { key: 'mode', type: 'enum', label: 'Mode', default: 'a', options: [['a', 'Mode A'], ['b', 'Mode B']], group: 'Simple' },
    { key: 'smooth', type: 'bool', label: 'Smooth', default: true, group: 'Advanced' },
    { key: 'color', type: 'color', label: 'Colour', default: '#ffffff', group: 'Advanced' },
  ],
  plots: [{ key: 'out', label: 'Out', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 2 } }],
})

/** A blob with the fixture instance (and a sibling, so "never touches another
 *  instance" has something to be true of). */
const fixtureBlob = (inputs, siblingInputs = { length: 77, mode: 'b', smooth: false }) => ({
  ...mergeChartSettings(null),
  indicatorInstances: [
    { instanceId: FIX_INST, defId: FIX, inputs, hidden: false },
    { instanceId: FIX_SIBLING, defId: FIX, inputs: siblingInputs, hidden: false },
  ],
})

const liveInstances = (cs) => (cs.indicatorInstances || []).filter((i) => i && i.instanceId && !i.removed)
const inputsOf = (cs, id) => findInstance(cs, id).inputs

const labelOf = (def, key) => {
  const f = fieldsFromDefinition(def).find((x) => x.key === key)
  if (!f) throw new Error(`no generated field for ${def.id}.${key}`)
  return f.label
}

// ─── the shipped definition reaches the picker; one without presets does not ──

describe('the preset picker renders only for a definition that declares presets', () => {
  it('UCT RS (rsLine) carries a `classic` preset and the picker lists it, plus Custom', () => {
    const rs = engineRegistry.getDefinition('rsLine')
    expect(rs.meta.presets.some((p) => p.id === 'classic')).toBe(true)
    const cs = setIndicatorEnabled(mergeChartSettings(null), 'rsLine', true, engineRegistry)
    mount({ settings: cs, instanceId: legacyInstanceId('rsLine') })
    expect(picker()).toBeTruthy()
    const options = [...presetSelect().querySelectorAll('option')].map((o) => [o.value, o.textContent])
    // ⭐ 3-08: nothing primes the server definitions here, so the four Phase 3
    // presets (`requiresServer`) are hidden and the six shipped ones list.
    expect(options).toEqual([...rs.meta.presets.filter((p) => p.requiresServer !== true).map((p) => [p.id, p.label]),
      [CUSTOM_PRESET, 'Custom']])
    // A fresh instance resolves to the declared defaults, which ARE the Classic
    // values — so the picker reads Classic, and its origin line shows.
    expect(presetSelect().value).toBe('classic')
    expect(screen.getByTestId('preset-origin').textContent).toBe(rs.meta.presets.find((p) => p.id === 'classic').origin)
    // The picker sits ABOVE the tabs, inside the sheet.
    const root = picker().parentElement
    const tabs = within(dialog()).getByRole('tablist')
    expect(root.contains(tabs)).toBe(true)
    expect(picker().compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a native definition without presets (RSI, the control) renders no picker', () => {
    expect(engineRegistry.getDefinition('rsi').meta.presets).toBeUndefined()
    const cs = setIndicatorEnabled(mergeChartSettings(null), 'rsi', true, engineRegistry)
    mount({ settings: cs, instanceId: legacyInstanceId('rsi') })
    expect(dialog()).toBeTruthy()
    expect(picker()).toBeNull()
  })
})

// ─── choosing a preset ───────────────────────────────────────────────────────

describe('choosing a preset', () => {
  it('applies EVERY key to the current instance, adds no instance and leaves the sibling untouched', () => {
    const reg = fakeRegistry(fixtureRaw())
    const base = fixtureBlob({})
    const siblingBefore = JSON.stringify(findInstance(base, FIX_SIBLING))
    const { onChange } = mount({ settings: base, instanceId: FIX_INST, registry: reg })
    expect(liveInstances(latest())).toHaveLength(2)

    choosePreset('slow')
    expect(onChange).toHaveBeenCalledTimes(1)
    const after = latest()
    for (const [k, v] of Object.entries(SLOW)) expect(inputsOf(after, FIX_INST)[k]).toBe(v)
    expect(liveInstances(after)).toHaveLength(2)
    expect(JSON.stringify(findInstance(after, FIX_SIBLING))).toBe(siblingBefore)
    expect(presetSelect().value).toBe('slow')
    expect(screen.getByTestId('preset-origin').textContent).toBe('Fixture origin: slow')
  })

  it('skips a key the definition does not declare with a console.warn, never a throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reg = fakeRegistry(fixtureRaw())
    mount({ settings: fixtureBlob({}), instanceId: FIX_INST, registry: reg })
    expect(() => choosePreset('stale')).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/ghost/)
    const inputs = inputsOf(latest(), FIX_INST)
    expect(inputs.length).toBe(20)
    expect(Object.prototype.hasOwnProperty.call(inputs, 'ghost')).toBe(false)
    // A preset whose key can never be matched never reads as "current".
    expect(presetSelect().value).toBe(CUSTOM_PRESET)
  })

  it('a value the definition refuses is NOT written — the writer is in the loop', () => {
    const reg = fakeRegistry(fixtureRaw())
    const { onChange } = mount({ settings: fixtureBlob(FAST), instanceId: FIX_INST, registry: reg })
    const before = JSON.stringify(latest())
    choosePreset('wild')
    // Refused by `setInstanceInput` (max is 500) ⇒ identity ⇒ nothing persisted.
    expect(onChange).not.toHaveBeenCalled()
    expect(JSON.stringify(latest())).toBe(before)
    expect(inputsOf(latest(), FIX_INST).length).toBe(FAST.length)
  })

  it('selecting Custom is a no-op', () => {
    const reg = fakeRegistry(fixtureRaw())
    const { onChange } = mount({ settings: fixtureBlob(FAST), instanceId: FIX_INST, registry: reg })
    choosePreset(CUSTOM_PRESET)
    expect(onChange).not.toHaveBeenCalled()
    expect(presetSelect().value).toBe('fast')
  })
})

// ─── the current preset is DERIVED from the inputs ───────────────────────────

describe('the current preset is derived from the inputs, never stored', () => {
  it('an instance whose inputs equal a preset reads as that preset; a changed input flips it to Custom', async () => {
    const reg = fakeRegistry(fixtureRaw())
    mount({ settings: fixtureBlob(FAST), instanceId: FIX_INST, registry: reg })
    expect(presetSelect().value).toBe('fast')
    expect(screen.getByTestId('preset-origin').textContent).toBe('Fixture origin: fast')

    const box = screen.getByRole('spinbutton', { name: labelOf(reg.def, 'length') })
    fireEvent.change(box, { target: { value: '6' } })
    fireEvent.blur(box)
    await settle()
    expect(inputsOf(latest(), FIX_INST).length).toBe(6)
    expect(presetSelect().value).toBe(CUSTOM_PRESET)
    expect(screen.queryByTestId('preset-origin')).toBeNull()
    // …and no preset id was ever written onto the instance.
    expect(Object.keys(findInstance(latest(), FIX_INST))).not.toContain('preset')
    expect(Object.keys(findInstance(latest(), FIX_INST))).not.toContain('presetId')
  })

  it('Reset to preset re-applies the preset the form last matched', async () => {
    const reg = fakeRegistry(fixtureRaw())
    mount({ settings: fixtureBlob(FAST), instanceId: FIX_INST, registry: reg })
    const box = screen.getByRole('spinbutton', { name: labelOf(reg.def, 'length') })
    fireEvent.change(box, { target: { value: '6' } })
    fireEvent.blur(box)
    await settle()
    expect(presetSelect().value).toBe(CUSTOM_PRESET)
    expect(resetButton().disabled).toBe(false)

    fireEvent.click(resetButton())
    expect(inputsOf(latest(), FIX_INST).length).toBe(FAST.length)
    expect(presetSelect().value).toBe('fast')
    expect(box.value).toBe(String(FAST.length))
  })

  it('Reset is disabled when no preset was ever matched or chosen in this dialog', () => {
    const reg = fakeRegistry(fixtureRaw())
    mount({ settings: fixtureBlob({ length: 7, mode: 'b', smooth: true }), instanceId: FIX_INST, registry: reg })
    expect(presetSelect().value).toBe(CUSTOM_PRESET)
    expect(resetButton().disabled).toBe(true)
    choosePreset('fast')
    expect(resetButton().disabled).toBe(false)
    expect(presetSelect().value).toBe('fast')
  })
})

// ─── Cancel undoes a preset like any other edit ──────────────────────────────

describe('Cancel after a preset', () => {
  it('restores the inputs the dialog opened with, byte for byte', async () => {
    const user = userEvent.setup()
    const reg = fakeRegistry(fixtureRaw())
    const { onClose } = mount({ settings: fixtureBlob(FAST), instanceId: FIX_INST, registry: reg })
    const before = JSON.stringify(latest())
    choosePreset('slow')
    // ⭐ POSITIVE CONTROL — the edit was observable before Cancel undid it.
    expect(JSON.stringify(latest())).not.toBe(before)
    expect(inputsOf(latest(), FIX_INST).length).toBe(SLOW.length)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(JSON.stringify(latest())).toBe(before)
    expect(onClose).toHaveBeenCalled()
  })
})

// ─── `meta.groupsCollapsed` ──────────────────────────────────────────────────

describe('meta.groupsCollapsed', () => {
  it('groups named in the hint start collapsed, every other group starts expanded', () => {
    const reg = fakeRegistry(fixtureRaw())
    mount({ settings: fixtureBlob(FAST), instanceId: FIX_INST, registry: reg })
    expect(groupButton('Simple').getAttribute('aria-expanded')).toBe('true')
    expect(groupButton('Advanced').getAttribute('aria-expanded')).toBe('false')
    // Collapsed hides the rows; the member can still open it.
    expect(dialog().querySelector('[data-input-key="smooth"]')).toBeNull()
    fireEvent.click(groupButton('Advanced'))
    expect(groupButton('Advanced').getAttribute('aria-expanded')).toBe('true')
    expect(dialog().querySelector('[data-input-key="smooth"]')).toBeTruthy()
    // …and close it again — the hint is a default, not a lock.
    fireEvent.click(groupButton('Advanced'))
    expect(groupButton('Advanced').getAttribute('aria-expanded')).toBe('false')
  })

  it('the hint is the Inputs tab\'s: the same group name on the Style tab starts expanded', () => {
    // The fixture's `color` input is plot-referenced, so it renders on Style under
    // the hinted 'Advanced' group. Folding it there would open a Style tab with
    // nothing on it (plan §6.4 says nothing about collapsing).
    const reg = fakeRegistry(fixtureRaw())
    mount({ settings: fixtureBlob(FAST), instanceId: FIX_INST, registry: reg })
    fireEvent.click(screen.getByRole('tab', { name: 'Style' }))
    expect(groupButton('Advanced').getAttribute('aria-expanded')).toBe('true')
    expect(dialog().querySelector('[data-input-key="color"]')).toBeTruthy()
  })

  it('a definition with no hint opens every group expanded (unchanged behaviour)', () => {
    const reg = fakeRegistry(fixtureRaw({ groupsCollapsed: undefined }))
    mount({ settings: fixtureBlob(FAST), instanceId: FIX_INST, registry: reg })
    expect(groupButton('Simple').getAttribute('aria-expanded')).toBe('true')
    expect(groupButton('Advanced').getAttribute('aria-expanded')).toBe('true')
  })

  it('UCT RS opens Simple expanded and the hinted groups collapsed', () => {
    const rs = engineRegistry.getDefinition('rsLine')
    const cs = setIndicatorEnabled(mergeChartSettings(null), 'rsLine', true, engineRegistry)
    mount({ settings: cs, instanceId: legacyInstanceId('rsLine') })
    expect(groupButton('Simple').getAttribute('aria-expanded')).toBe('true')
    // 3-08: Checks holds only the anchor date, a `requiresServer` input, so with
    // no server declaration it has no control and no section
    const rendered = rs.meta.groupsCollapsed.filter((g) => g !== 'Checks')
    for (const g of rendered) {
      expect(groupButton(g).getAttribute('aria-expanded'), g).toBe('false')
    }
    // Its Style tab is nothing but hinted groups (the colours), so they stay
    // open there — otherwise the tab would open with no control on it. Rating
    // holds no colour or width, so it has no Style section (VA2).
    fireEvent.click(screen.getByRole('tab', { name: 'Style' }))
    for (const g of rendered.filter((x) => x !== 'Rating')) {
      expect(groupButton(g).getAttribute('aria-expanded'), `${g} on Style`).toBe('true')
    }
  })
})

// ─── the pure helper ─────────────────────────────────────────────────────────

describe('applyPresetInputs (instanceControls)', () => {
  it('returns the settings BY IDENTITY when nothing changes', () => {
    const reg = fakeRegistry(fixtureRaw())
    const cs = fixtureBlob(FAST)
    const fast = reg.def.meta.presets.find((p) => p.id === 'fast')
    expect(applyPresetInputs(cs, FIX_INST, reg.def, fast, reg)).toBe(cs)          // already stored
    expect(applyPresetInputs(cs, 'inst:nope:9', reg.def, fast, reg)).toBe(cs)     // no such instance
    expect(applyPresetInputs(cs, FIX_INST, reg.def, null, reg)).toBe(cs)          // no preset
    expect(applyPresetInputs(cs, FIX_INST, reg.def, { id: 'x', inputs: [] }, reg)).toBe(cs)
    expect(applyPresetInputs(cs, FIX_INST, null, fast, reg)).toBe(cs)             // no definition
  })

  it('writes each declared key through the writer and returns a new object', () => {
    const reg = fakeRegistry(fixtureRaw())
    const cs = fixtureBlob(FAST)
    const slow = reg.def.meta.presets.find((p) => p.id === 'slow')
    const next = applyPresetInputs(cs, FIX_INST, reg.def, slow, reg)
    expect(next).not.toBe(cs)
    expect(inputsOf(next, FIX_INST)).toEqual(SLOW)
    expect(inputsOf(cs, FIX_INST)).toEqual(FAST)                                  // input untouched
    expect(liveInstances(next)).toHaveLength(2)
  })
})

// ─── the schema's light validation ───────────────────────────────────────────

describe('defSchema: meta.presets and meta.groupsCollapsed', () => {
  const errs = (raw) => { const r = validateDefinition(raw); return r.ok ? [] : r.errors }

  it('accepts the fixture, and the absence of both fields', () => {
    expect(errs(fixtureRaw())).toEqual([])
    expect(errs(fixtureRaw({ presets: undefined, groupsCollapsed: undefined }))).toEqual([])
    // The shipped RS definition passed the real registry, which validates on load.
    expect(engineRegistry.getDefinition('rsLine').meta.groupsCollapsed)
      .toEqual(['Line', 'New highs', 'Rating', 'Stress test', 'Method', 'Checks'])
  })

  it('refuses presets that are not an array, or entries missing id / label / inputs', () => {
    expect(errs(fixtureRaw({ presets: 'classic' })).join(' ')).toMatch(/meta\.presets: expected an array/)
    expect(errs(fixtureRaw({ presets: [{ label: 'x', inputs: {} }] })).join(' ')).toMatch(/meta\.presets\[0\]\.id/)
    expect(errs(fixtureRaw({ presets: [{ id: 'x', inputs: {} }] })).join(' ')).toMatch(/meta\.presets\[0\]\.label/)
    expect(errs(fixtureRaw({ presets: [{ id: 'x', label: 'X' }] })).join(' ')).toMatch(/meta\.presets\[0\]\.inputs/)
    expect(errs(fixtureRaw({ presets: [{ id: 'x', label: 'X', inputs: [1] }] })).join(' ')).toMatch(/meta\.presets\[0\]\.inputs/)
    expect(errs(fixtureRaw({ presets: ['x'] })).join(' ')).toMatch(/meta\.presets\[0\]: expected an object/)
    expect(errs(fixtureRaw({ presets: [{ id: 'x', label: 'X', inputs: {}, origin: 3 }] })).join(' ')).toMatch(/meta\.presets\[0\]\.origin/)
    expect(errs(fixtureRaw({ presets: [{ id: 'x', label: 'X', inputs: {} }, { id: 'x', label: 'Y', inputs: {} }] })).join(' '))
      .toMatch(/duplicate preset id/)
  })

  it('refuses groupsCollapsed that is not an array of non-empty strings', () => {
    expect(errs(fixtureRaw({ groupsCollapsed: 'Line' })).join(' ')).toMatch(/meta\.groupsCollapsed/)
    expect(errs(fixtureRaw({ groupsCollapsed: ['Line', 3] })).join(' ')).toMatch(/meta\.groupsCollapsed/)
    expect(errs(fixtureRaw({ groupsCollapsed: [''] })).join(' ')).toMatch(/meta\.groupsCollapsed/)
    expect(errs(fixtureRaw({ groupsCollapsed: [] }))).toEqual([])
  })
})

// ─── UCT RS PHASE 2a, UNIT 2a-12 — THE DOT SIZE CONTROL AND PRESETS PAST `inputs` ──
//
// The Style tab's one control that is not an input: "Dot size" (Small / Default /
// Large), shown only for a definition that draws dots, writing `presentation.dotSize`
// through `setInstanceDotSize` — the writer the Chart Data row and the `setDotSize`
// agent op share. And the picker now reads the whole preset: one that declares a
// `dotSize` is "current" only while the copy carries it, so a size change away from
// the word flips the select to Custom like an input change does.

/** The fixture with a DOT output and presets that reach past `inputs`. ⭐ The more
 *  specific preset (a dot size on top of its inputs) is listed FIRST — first match
 *  wins in `detectPreset`, and ordering is the author's job. */
const dotFixtureRaw = () => ({
  ...fixtureRaw({
    presets: [
      { id: 'big', label: 'Big dots', origin: 'Fixture origin: big', inputs: { length: 33 }, dotSize: 'large' },
      { id: 'fast', label: 'Fast', origin: 'Fixture origin: fast', inputs: FAST },
      { id: 'slow', label: 'Slow', origin: 'Fixture origin: slow', inputs: SLOW },
    ],
  }),
  plots: [
    { key: 'out', label: 'Out', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 2 } },
    { key: 'dot', label: 'Dot', style: 'markers', color: '$color', width: 2, role: 'context', legend: { hide: true } },
  ],
})
const styleTab = () => fireEvent.click(screen.getByRole('tab', { name: 'Style' }))
const dotSelect = () => screen.queryByRole('combobox', { name: 'Dot size' })

describe('the Dot size control on the Style tab (2a-12)', () => {
  it('UCT RS (three dot outputs) carries it, reading Default with the three words; the line-only fixture does not', () => {
    const cs = setIndicatorEnabled(mergeChartSettings(null), 'rsLine', true, engineRegistry)
    mount({ settings: cs, instanceId: legacyInstanceId('rsLine') })
    styleTab()
    expect(dotSelect()).toBeTruthy()
    expect(dotSelect().value).toBe('medium')
    expect([...dotSelect().querySelectorAll('option')].map((o) => [o.value, o.textContent]))
      .toEqual([['small', 'Small'], ['medium', 'Default'], ['large', 'Large']])
    cleanup()
    const reg = fakeRegistry(fixtureRaw())
    mount({ settings: fixtureBlob(FAST), instanceId: FIX_INST, registry: reg })
    styleTab()
    expect(dialog()).toBeTruthy()
    expect(dotSelect()).toBeNull()
  })

  it('choosing Large writes presentation.dotSize through the writer; Default deletes it; the sibling is untouched; a repeat is not persisted', () => {
    const reg = fakeRegistry(dotFixtureRaw())
    const base = fixtureBlob(FAST)
    const siblingBefore = JSON.stringify(findInstance(base, FIX_SIBLING))
    const { onChange } = mount({ settings: base, instanceId: FIX_INST, registry: reg })
    styleTab()
    fireEvent.change(dotSelect(), { target: { value: 'large' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(findInstance(latest(), FIX_INST).presentation).toEqual({ dotSize: 'large' })
    expect(dotSelect().value).toBe('large')
    expect(JSON.stringify(findInstance(latest(), FIX_SIBLING))).toBe(siblingBefore)
    fireEvent.change(dotSelect(), { target: { value: 'medium' } })
    expect('presentation' in findInstance(latest(), FIX_INST)).toBe(false)
    // the same word again is a refused (identity) write — nothing persisted
    const calls = onChange.mock.calls.length
    fireEvent.change(dotSelect(), { target: { value: 'medium' } })
    expect(onChange).toHaveBeenCalledTimes(calls)
  })

  it('Cancel takes a dot size back with everything else', async () => {
    const user = userEvent.setup()
    const reg = fakeRegistry(dotFixtureRaw())
    const { onClose } = mount({ settings: fixtureBlob(FAST), instanceId: FIX_INST, registry: reg })
    const before = JSON.stringify(latest())
    styleTab()
    fireEvent.change(dotSelect(), { target: { value: 'small' } })
    expect(JSON.stringify(latest())).not.toBe(before)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(JSON.stringify(latest())).toBe(before)
    expect(onClose).toHaveBeenCalled()
  })
})

describe('a preset that declares a dot size (2a-12)', () => {
  it('choosing it applies the word through the writer; a dot size away from the word reads as Custom; Reset puts it back', () => {
    const reg = fakeRegistry(dotFixtureRaw())
    mount({ settings: fixtureBlob(FAST), instanceId: FIX_INST, registry: reg })
    expect(presetSelect().value).toBe('fast')
    choosePreset('big')
    expect(inputsOf(latest(), FIX_INST).length).toBe(33)
    expect(findInstance(latest(), FIX_INST).presentation).toEqual({ dotSize: 'large' })
    expect(presetSelect().value).toBe('big')
    expect(screen.getByTestId('preset-origin').textContent).toBe('Fixture origin: big')
    styleTab()
    expect(dotSelect().value).toBe('large')
    fireEvent.change(dotSelect(), { target: { value: 'small' } })
    expect(presetSelect().value).toBe(CUSTOM_PRESET)
    expect(screen.queryByTestId('preset-origin')).toBeNull()
    fireEvent.click(resetButton())
    expect(presetSelect().value).toBe('big')
    expect(dotSelect().value).toBe('large')
    // …and nothing but inputs and presentation ever landed on the instance
    expect(Object.keys(findInstance(latest(), FIX_INST)).sort()).toEqual(['defId', 'hidden', 'inputs', 'instanceId', 'presentation'])
  })

  it('an instance at a sized preset\'s inputs but at the default dot size is NOT that preset; carrying the word, it is', () => {
    const reg = fakeRegistry(dotFixtureRaw())
    const at33 = fixtureBlob({ length: 33, mode: 'a', smooth: true })
    mount({ settings: at33, instanceId: FIX_INST, registry: reg })
    expect(presetSelect().value).toBe(CUSTOM_PRESET)
    cleanup()
    const sized = {
      ...at33,
      indicatorInstances: at33.indicatorInstances.map((i) => (i.instanceId === FIX_INST ? { ...i, presentation: { dotSize: 'large' } } : i)),
    }
    mount({ settings: sized, instanceId: FIX_INST, registry: reg })
    expect(presetSelect().value).toBe('big')
  })

  it('a preset of inputs alone (the Phase 1 shape) still reads and applies exactly as before, whatever the dot size', () => {
    const reg = fakeRegistry(dotFixtureRaw())
    const base = fixtureBlob(FAST)
    const sized = {
      ...base,
      indicatorInstances: base.indicatorInstances.map((i) => (i.instanceId === FIX_INST ? { ...i, presentation: { dotSize: 'small' } } : i)),
    }
    const { onChange } = mount({ settings: sized, instanceId: FIX_INST, registry: reg })
    expect(presetSelect().value).toBe('fast')
    choosePreset('slow')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(inputsOf(latest(), FIX_INST)).toEqual(SLOW)
    expect(findInstance(latest(), FIX_INST).presentation).toEqual({ dotSize: 'small' })
    expect(presetSelect().value).toBe('slow')
  })
})

// ─── UCT RS at v3: the six presets, their order, and the non-input fields (2a-14) ──

describe('UCT RS (rsLine) v3 presets — Classic, Classic weekly, Phase, Trend, Trend weekly, Stress (2a-14)', () => {
  const rs = () => engineRegistry.getDefinition('rsLine')
  const rsBlob = () => setIndicatorEnabled(mergeChartSettings(null), 'rsLine', true, engineRegistry)
  const RS_INST = () => legacyInstanceId('rsLine')
  const declared = () => new Set(rs().inputs.map((i) => i.key))

  it('declares exactly the six, Classic first (the member\'s default leads the picker), each on declared inputs only', () => {
    // v4 (3-08) appends the four Phase 3 presets, each `requiresServer`
    expect(rs().meta.presets.map((p) => p.id)).toEqual(['classic', 'classicWeekly', 'phase', 'trend', 'trendWeekly', 'stress',
      'rotation', 'rotationWeekly', 'quality', 'volAdjusted'])
    for (const p of rs().meta.presets) {
      for (const k of Object.keys(p.inputs)) expect(declared().has(k), `${p.id} sets undeclared ${k}`).toBe(true)
      expect(typeof p.origin).toBe('string')
      // every preset states the Reading, so no two readings ever detect as one
      expect('view' in p.inputs, `${p.id} is silent on view`).toBe(true)
      if (p.requiresServer === true) continue
      // every shipped preset states the three v3 toggles, so detection can never
      // read a Trend or Stress instance as Classic whatever the declaration order
      for (const k of ['showMansfield', 'showRedDay', 'showNewLow']) expect(k in p.inputs, `${p.id} is silent on ${k}`).toBe(true)
    }
    mount({ settings: rsBlob(), instanceId: RS_INST() })
    expect([...presetSelect().querySelectorAll('option')].map((o) => o.value))
      .toEqual(['classic', 'classicWeekly', 'phase', 'trend', 'trendWeekly', 'stress', CUSTOM_PRESET])
    expect(presetSelect().value, 'a fresh instance is Classic').toBe('classic')
  })

  it('Trend applies its inputs AND its fields: Mansfield view on at 200, visibility daily-and-up; the picker reads Trend', () => {
    const { onChange } = mount({ settings: rsBlob(), instanceId: RS_INST() })
    choosePreset('trend')
    expect(onChange).toHaveBeenCalled()
    const inst = findInstance(latest(), RS_INST())
    // visual round A2: Mansfield view draws the Mansfield line alone, so Trend sets
    // the Mansfield and cross-dot colours and leaves the RS line's own alone; its
    // cross dot is medium, the default size, so nothing is stored for it.
    expect(inst.inputs).toMatchObject({ showMansfield: true, mansfieldLength: 200, mansfieldColor: '#6ba3be', dotCrossColor: '#6ba3be' })
    expect(inst.inputs.color).toBeUndefined()
    expect(inst.visibility).toEqual({ preset: 'dailyUp' })
    expect(inst.presentation).toBeUndefined()
    expect(presetSelect().value).toBe('trend')
    expect(screen.getByTestId('preset-origin').textContent).toMatch(/Weinstein/)
    // a Trend instance is never read as Classic: the toggle it turned on is the tell
    expect(presetSelect().value).not.toBe('classic')
  })

  it('Trend weekly sets 52 bars on both the lookback and the Mansfield length', () => {
    mount({ settings: rsBlob(), instanceId: RS_INST() })
    choosePreset('trendWeekly')
    const inst = findInstance(latest(), RS_INST())
    expect(inst.inputs).toMatchObject({ showMansfield: true, mansfieldLength: 52, lookback: 52 })
    expect(presetSelect().value).toBe('trendWeekly')
  })

  it('Stress applies the red-day dots as its large gold mark, before price off, visibility daily-and-up; the picker reads Stress, not Classic', () => {
    mount({ settings: rsBlob(), instanceId: RS_INST() })
    choosePreset('stress')
    const inst = findInstance(latest(), RS_INST())
    expect(inst.inputs).toMatchObject({ showRedDay: true, showNewHighBeforePrice: false, showMansfield: false, color: '#6ba3be', dotRedColor: '#c9a84c' })
    expect(inst.visibility).toEqual({ preset: 'dailyUp' })
    expect(inst.presentation).toEqual({ plots: { dotNHred: { dotSize: 'large' } } })
    expect(presetSelect().value).toBe('stress')
    // back to Classic: the toggles come off AND the fields Stress wrote are reset.
    // ⚰️ Moved 2026-11-07 (review finding #26): this pinned "the fields stay as the
    // member had them", which left the pane hidden intraday and the gold dot Large
    // under a picker that read Classic. Classic now declares visibility 'all' and
    // the default dot size, so choosing it is Classic on screen too.
    choosePreset('classic')
    const back = findInstance(latest(), RS_INST())
    expect(back.inputs).toMatchObject({ showRedDay: false, showMansfield: false, showNewHighBeforePrice: true, dotRedColor: '#6ba3be' })
    expect(back.visibility).toBeUndefined()
    expect(back.presentation).toBeUndefined()
    expect(presetSelect().value).toBe('classic')
  })

  it('the Mansfield length control dims until the Mansfield line is on (activeWhen), in the Method group', () => {
    const f = rs().inputs.find((i) => i.key === 'mansfieldLength')
    expect(f.activeWhen).toEqual({ key: 'view', equals: 'mansfield' })   // v4: the Reading
    // VA2: the plan's five folded groups (§6.3); the phone sheet has had groups
    // since 2a-11, so the Mansfield and stress controls have groups of their own.
    expect(f.group).toBe('Method')
    expect(rs().inputs.find((i) => i.key === 'showMansfield').group).toBe('Method')
    for (const k of ['showRedDay', 'dotRedColor']) {
      expect(rs().inputs.find((i) => i.key === k).group, k).toBe('Stress test')
    }
    for (const k of ['showNewLow', 'dotLowColor']) {
      expect(rs().inputs.find((i) => i.key === k).group, k).toBe('New highs')
    }
    expect([...new Set(rs().inputs.map((i) => i.group))])
      .toEqual(['Simple', 'Line', 'New highs', 'Rating', 'Stress test', 'Method', 'Checks'])
    expect(rs().meta.groupsCollapsed).toEqual(['Line', 'New highs', 'Rating', 'Stress test', 'Method', 'Checks'])
  })
})
