// app/src/components/chart/__tests__/rsLegacySuccessorGate.test.jsx
//
// ⭐ UCT RS 3-14 — A LEGACY INPUT IS NOT REPLACED UNTIL ITS SUCCESSOR CAN SHOW.
// rsLine's `showMansfield` is `legacy: true` with `mapsTo {when: true, key:
// 'view', value: 'mansfield'}`, and `view` is `requiresServer`. While the live
// row is v3 (no `view` declared) the old "Mansfield view" switch is the only
// control that server reads, so it renders and writes itself; once the server
// declares `view`, the switch is hidden and the Reading shows. One rule in the
// shared field model (`indicatorRegistry.isInputHidden` / `visibleInputs`), so
// the dialog, the phone sheet and the Chart Settings inspector all follow it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import IndicatorSettingsDialog from '../IndicatorSettingsDialog'
import { fieldsForInstance, visibleInputs, isInputHidden } from '../indicatorRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { findInstance } from '../engine/instanceControls'
import { primeServerDefinitions, clearServerDefinitions, __setServerDefinitionsFetcherForTests } from '../engine/serverCompute'
import * as engineRegistry from '../engine/nativeRegistry'

const RS = engineRegistry.getDefinition('rsLine')
const PHASE3 = ['view', 'customBenchmark', 'rrgRatioLength', 'rrgMomentumLength', 'clenowWindow',
  'clenowGapPct', 'atrLength', 'varsLookback', 'anchorDate']
const optionValues = (key) => RS.inputs.find((i) => i.key === key).options.map((o) => (Array.isArray(o) ? o[0] : o.value))
/** The v3 row (RS_V3_ENABLED off): every server input but the nine Phase 3 keys, no CUSTOM. */
const V3_OFF = Object.freeze({
  inputs: RS.meta.serverInputs.filter((k) => !PHASE3.includes(k)),
  options: { benchmark: optionValues('benchmark').filter((v) => v !== 'CUSTOM') },
})
/** The v4 row (RS_V3_ENABLED on): everything, every option. */
const V3_ON = Object.freeze({
  inputs: [...RS.meta.serverInputs],
  options: { benchmark: optionValues('benchmark'), view: optionValues('view') },
})
const rowBody = (decl) => ({
  schemaVersion: 1,
  definitions: [{
    schemaVersion: 1, id: 'rsLine', version: 4, compute: { kind: 'server', fn: 'rsLine', rev: 4 },
    inputs: decl.inputs.map((key) => ({ key, type: 'x', default: null, ...(decl.options[key] ? { options: decl.options[key] } : {}) })),
    columns: ['rsLine'],
  }],
})

beforeEach(() => { clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })
afterEach(() => { cleanup(); clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })

describe('the field model', () => {
  const legacy = RS.inputs.find((i) => i.key === 'showMansfield')
  const keys = (declared, inputs = {}) => fieldsForInstance(RS, { instanceId: 'rs', defId: 'rsLine', inputs }, { declared }).all.map((f) => f.key)

  it('V3 off: the "Mansfield view" switch is present, in the Method group, and the Reading is not', () => {
    const k = keys(V3_OFF)
    expect(k).toContain('showMansfield')
    expect(k).not.toContain('view')
    const f = fieldsForInstance(RS, null, { declared: V3_OFF }).all.find((x) => x.key === 'showMansfield')
    expect(f).toMatchObject({ label: 'Mansfield view', group: 'Method', inputType: 'bool' })
    expect(isInputHidden(legacy, V3_OFF, RS)).toBe(false)
  })

  it('nothing declared yet (null) is the same as v3: the successor is gated off, so the switch shows', () => {
    expect(keys(null)).toContain('showMansfield')
    expect(keys(null)).not.toContain('view')
  })

  it('V3 on: the switch is gone and the Reading shows in its place', () => {
    const k = keys(V3_ON)
    expect(k).not.toContain('showMansfield')
    expect(k).toContain('view')
    expect(isInputHidden(legacy, V3_ON, RS)).toBe(true)
  })

  it('a stored v3 Trend instance reads its switch ON under v3', () => {
    const m = fieldsForInstance(RS, { instanceId: 'rs', defId: 'rsLine', inputs: { showMansfield: true } }, { declared: V3_OFF })
    expect(m.values.showMansfield).toBe(true)
  })

  it('without the definition, a legacy input is hidden exactly as before (3-01)', () => {
    expect(isInputHidden(legacy, V3_OFF)).toBe(true)
    expect(isInputHidden(legacy, null)).toBe(true)
  })

  it('every definition WITHOUT a legacy input: visibleInputs is byte-identical under any declaration', () => {
    const plain = engineRegistry.listDefinitions().filter((d) => !d.inputs.some((i) => i && i.legacy === true))
    expect(plain.length).toBeGreaterThan(20)
    for (const def of plain) {
      for (const declared of [null, V3_OFF, V3_ON]) {
        const shown = visibleInputs(def, declared)
        const before = def.inputs.filter((i) => !(i.requiresServer === true
          && !(declared && declared.inputs.includes(i.key))))
        expect(shown.map((i) => i.key), def.id).toEqual(before.map((i) => i.key))
      }
    }
  })
})

describe('the settings dialog (the door every surface writes through)', () => {
  const INST = 'inst:rsLine:1'
  const blob = (inputs = {}) => ({
    ...mergeChartSettings(null),
    indicatorInstances: [{ instanceId: INST, defId: 'rsLine', inputs, hidden: false }],
  })
  function Harness({ initial, spy }) {
    const [cs, setCs] = useState(initial)
    return (
      <IndicatorSettingsDialog open instanceId={INST} settings={cs} registry={engineRegistry}
        onChange={(next) => { spy(next); setCs(next) }} onClose={() => {}} />
    )
  }
  const mount = (decl) => {
    act(() => { primeServerDefinitions(rowBody(decl)) })
    const spy = vi.fn()
    render(<Harness initial={blob()} spy={spy} />)
    const row = (k) => screen.getByRole('dialog').querySelector(`[data-input-key="${k}"]`)
    return { spy, row }
  }
  const openAllGroups = () => {
    for (const b of screen.getByRole('dialog').querySelectorAll('button[aria-expanded="false"]')) {
      act(() => { fireEvent.click(b) })
    }
  }

  it('V3 off: the switch renders, and toggling it stores showMansfield: true', () => {
    const { spy, row } = mount(V3_OFF)
    openAllGroups()
    expect(row('view')).toBeNull()
    const r = row('showMansfield')
    expect(r, 'the Mansfield view row').not.toBeNull()
    const sw = r.querySelector('[role="switch"]')
    expect(sw).not.toBeNull()
    act(() => { fireEvent.click(sw) })
    expect(spy).toHaveBeenCalled()
    expect(findInstance(spy.mock.calls.at(-1)[0], INST).inputs.showMansfield).toBe(true)
  })

  it('V3 on: no switch, the Reading is there', () => {
    const { row } = mount(V3_ON)
    openAllGroups()
    expect(row('showMansfield')).toBeNull()
    expect(row('view')).not.toBeNull()
  })
})
