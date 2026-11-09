// app/src/components/chart/pane/attachedPineDisclosures.noGuardIds.test.jsx
//
// ⛔ NO GUARD ID REACHES THE DOM. The C43 strip printed "(runtime:strategy-start)" inside
// the sentence a member reads. Every disclosure fixture below renders through the shipped
// strip; the rail reads the rendered text AND every attribute. The control renders the
// same notes through a bare <li> (no `withoutGuardIds`) and must see the ids, so the rail
// cannot pass vacuously.
import { render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AttachedPineDisclosures from './AttachedPineDisclosures'
import { setRuntimeErrorNotice, resetRuntimeErrorNotices } from '../engine/runtimeErrorNotice'
import { runtimeRunStopOf } from '../engine/nativeRegistry'
import { withoutGuardIds } from '../../../lib/presentation/memberCopy'

const GUARD_RE = /\b(runtime|pine|strategy|enum):[a-z-]+/

const STRAT_WHY = 'a strategy run takes the most recent bars of its history window, and this run is over a window that slides with each new bar, so its trades would move. Nothing is drawn.'
const runDef = { compute: { kind: 'runtime', outputs: { p0: 0 } }, meta: { name: 'My Strategy' } }
const startStop = runtimeRunStopOf(runDef, { __columnErrors: { p0: { guard: 'runtime:strategy-start', message: STRAT_WHY } } })

const FIXTURE_NOTES = [
  { name: 'Alerts', note: 'Alerts are not run here (pine:alertcondition-call).' },
  { name: 'Strategy', note: 'refused strategy:commission-type here' },
  { name: 'Enum', note: 'An input option is not offered (enum:unknown-member): pick another.' },
  { name: 'Runtime', note: 'its run computed nothing on this chart (runtime:history-start)' },
]
const registry = {
  getDefinition: (id) => (id === 'd1' ? { meta: { name: 'Fixture', disclosures: FIXTURE_NOTES } } : id === 'd2' ? runDef : null),
  registryGeneration: () => 1,
}
const settings = { indicatorInstances: [{ instanceId: 'i1', defId: 'd1' }, { instanceId: 'i2', defId: 'd2' }] }

const domStrings = (root) => {
  const out = [root.textContent]
  for (const el of root.querySelectorAll('*')) for (const a of el.attributes) out.push(a.value)
  return out
}

afterEach(() => { cleanup(); resetRuntimeErrorNotices() })

describe('the disclosure strip never prints a guard id', () => {
  it('the strategy-start fixture really quotes its guard id (precondition)', () => {
    expect(startStop.guard).toBe('runtime:strategy-start')
    expect(startStop.sentence).toContain('(runtime:strategy-start)')
  })

  it('no guard id in rendered text or attributes, over every fixture', () => {
    setRuntimeErrorNotice('i2', startStop.sentence)
    const { getByTestId } = render(<AttachedPineDisclosures settings={settings} registry={registry} />)
    const root = getByTestId('pine-attached-disclosures')
    expect(root.querySelectorAll('li').length).toBe(FIXTURE_NOTES.length + 1)
    for (const s of domStrings(root)) expect(s).not.toMatch(GUARD_RE)
  })

  it('the strategy-start case reads as the exact plain sentence', () => {
    setRuntimeErrorNotice('i2', startStop.sentence)
    const { getByTestId } = render(<AttachedPineDisclosures settings={settings} registry={registry} />)
    const first = getByTestId('pine-attached-disclosures').querySelector('li').textContent
    expect(first).toBe(`My Strategy — not drawn on this chart: ${STRAT_WHY}`)
  })

  it('CONTROL: the same notes without the rule do show guard ids', () => {
    const { container } = render(<ul>{FIXTURE_NOTES.map((n) => <li key={n.name}>{n.note}</li>)}<li>{startStop.sentence}</li></ul>)
    expect(domStrings(container).some((s) => GUARD_RE.test(s))).toBe(true)
  })

  it('withoutGuardIds changes nothing else', () => {
    const plain = 'This script is a strategy: nothing is drawn (calc_bars_count).'
    expect(withoutGuardIds(plain)).toBe(plain)
    expect(withoutGuardIds('it stopped (runtime:strategy-unpinned).')).toBe('it stopped.')
    expect(withoutGuardIds('refused pine:strategy-call here')).toBe('refused here')
  })
})
