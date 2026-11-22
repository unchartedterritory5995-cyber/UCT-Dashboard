// app/src/components/chart/__tests__/rsFixU8DotSizeControls.test.jsx
//
// UCT RS Phase 2a review, unit U8, finding #11 (2026-11-07), on the two member
// surfaces: the dialog's Style tab and the Chart Settings Inspector row. After
// Stress the before-price dot draws Large from a per-dot entry, so the control
// must read Mixed (not Default), and any word the member picks must size every
// dot, which means the per-dot entry is deleted.
import { useState } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import IndicatorSettingsDialog from '../IndicatorSettingsDialog'
import ChartSettingsModal from '../ChartSettingsModal'
import { mergeChartSettings } from '../chartDefaults'
import * as registry from '../engine/nativeRegistry'
import { setIndicatorEnabled, findInstance, applyPresetInputs } from '../engine/instanceControls'
import { legacyInstanceId } from '../engine/instances'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const RS = legacyInstanceId('rsLine')
const rsDef = () => registry.getDefinition('rsLine')
const stressed = () => {
  const cs = setIndicatorEnabled(mergeChartSettings({}), 'rsLine', true, registry)
  const p = rsDef().meta.presets.find((x) => x.id === 'stress')
  return applyPresetInputs(cs, RS, rsDef(), p, registry)
}

/** The sink is a CALLBACK, not an object prop: writing through a prop inside the
 *  component trips the immutability lint rule (the tooltipTitle suite's shape). */
function DialogHost({ initial, onSeen }) {
  const [cs, setCs] = useState(initial)
  return (
    <IndicatorSettingsDialog open instanceId={RS} settings={cs} registry={registry}
      onChange={(next) => { onSeen(next); setCs(next) }} onClose={() => {}} />
  )
}
function ModalHost({ initial, onSeen }) {
  const [cs, setCs] = useState(initial)
  return <ChartSettingsModal open settings={cs} onChange={(next) => { onSeen(next); setCs(next) }} onClose={() => {}} />
}

describe('U8 #11 — the dialog Style tab', () => {
  it('reads Mixed after Stress; Default then clears the per-dot Large', () => {
    const initial = stressed()
    expect(findInstance(initial, RS).presentation).toEqual({ plots: { dotNHred: { dotSize: 'large' } } })   // visual round A3
    const seen = { cs: initial }
    render(<DialogHost initial={initial} onSeen={(next) => { seen.cs = next }} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Style' }))
    const sel = () => screen.getByRole('combobox', { name: 'Dot size' })
    expect(sel().value).toBe('mixed')
    const mixed = [...sel().options].find((o) => o.value === 'mixed')
    expect(mixed.textContent).toBe('Mixed')
    expect(mixed.disabled).toBe(true)
    fireEvent.change(sel(), { target: { value: 'medium' } })
    expect('presentation' in findInstance(seen.cs, RS)).toBe(false)
    expect(sel().value).toBe('medium')
    expect([...sel().options].map((o) => o.value)).toEqual(['small', 'medium', 'large'])
  })
})

describe('U8 #11 — the Chart Settings Inspector row', () => {
  it('reads Mixed after Stress; Small then sizes every dot small', () => {
    const initial = stressed()
    const seen = { cs: initial }
    render(<ModalHost initial={initial} onSeen={(next) => { seen.cs = next }} />)
    fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
    const row = [...document.body.querySelectorAll('[data-structure-row]')]
      .find((r) => /^UCT/.test((r.querySelector('[class*="insRowName"]')?.textContent || '').trim()))
    fireEvent.click(row)
    const sel = () => document.body.querySelector('[data-inspector-for] [data-field="__dotSize__"] select')
    expect(sel().value).toBe('mixed')
    fireEvent.change(sel(), { target: { value: 'small' } })
    expect(findInstance(seen.cs, RS).presentation).toEqual({ dotSize: 'small' })
    expect(seen.cs.preset).toBe('custom')
    expect(sel().value).toBe('small')
  })
})
