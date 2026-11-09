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
import RunsOnLine from '../builder/RunsOnLine'
import SaveReceipt from '../builder/studio/SaveReceipt'
import fs from 'node:fs'
import path from 'node:path'

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

// ── r1: every OTHER member surface that prints a composer's sentence ────────────
const noGuard = (root) => {
  // data-guard is the one attribute that carries the id on purpose (tests and rails read it)
  const out = [root.textContent]
  for (const el of root.querySelectorAll('*')) for (const a of el.attributes) if (a.name !== 'data-guard') out.push(a.value)
  return out
}
const SAID = 'this is a strategy, so nothing is drawn (pine:strategy-call).'

describe('r1 — DOM: builder surfaces print no guard id', () => {
  it('RunsOnLine: a refused lane sentence', () => {
    const { container } = render(<RunsOnLine serverLanes={{ alerts: { guard: 'runtime:strategy-start', sentence: SAID }, screener: true, scans: true }} />)
    expect(container.textContent).toContain('alerts: this is a strategy, so nothing is drawn.')
    for (const s of noGuard(container)) expect(s).not.toMatch(GUARD_RE)
  })
  it('SaveReceipt: a failed item', () => {
    render(<SaveReceipt receipt={{ status: 'partial', title: 'Saved', items: [{ ok: false, kind: 'alerts', text: SAID }] }} />)
    const root = document.body
    expect(root.textContent).toContain('this is a strategy, so nothing is drawn.')
    for (const s of noGuard(root)) expect(s).not.toMatch(GUARD_RE)
  })
  it('CONTROL: the raw sentence carries the id', () => { expect(SAID).toMatch(GUARD_RE) })
})

// Census: every render site that prints a composer's sentence wraps it. A site printing the
// bare expression fails by name. Paths are relative to app/src.
const SRC = path.resolve(__dirname, '../../..')
export const SITES = [
  ['components/chart/pane/AttachedPineDisclosures.jsx', ['n.note']],
  ['components/chart/builder/BuilderSheet.jsx', ['req.reason', 'notice.sentence', 'o.verdict.reason', 'o.verdict.note', 'objectLoss.sentence']],
  ['components/chart/builder/ConciergeBox.jsx', ['item.reason', 'refusal.reason', 'proposal.sentence']],
  ['components/chart/builder/ConverseBox.jsx', ['c.text', 'editability.text']],
  ['components/chart/builder/ImageBox.jsx', ['refusal.reason', 'c.sentence', 'r.reason']],
  ['components/chart/builder/StarterLibrary.jsx', ['entry.sentence']],
  ['components/chart/builder/studio/CreateIndicatorPanel.jsx', ['editability.text', 'conv.dropped.reason', 'o.reason', 'p.text']],
  ['components/chart/builder/studio/SaveReceipt.jsx', ['it.text']],
  ['components/chart/builder/memberPane/MemberPane.jsx', ['built.reason', 'n.note']],
  ['components/chart/builder/RunsOnLine.jsx', ['s.sentence']],
  ['components/chart/ChartSettingsIndicators.jsx', ['f.why', 'n.sentence']],
  ['components/chart/IndicatorAlertPopover.jsx', ['preflight.reason']],
  ['components/chart/IndicatorLibraryDialog.jsx', ['n.sentence']],
  ['pages/charts/widgets/ScanObjectCard.jsx', ['item.reason', 'view.reason']],
  ['pages/formulas/FormulaReference.jsx', ['item.sentence', 'item.reason']],
]
// ⭐ RULING 2026-11-08 (coordinator): guard ids are hidden on every member surface EXCEPT the
// Pine editor proper, where a script author benefits from the code. These two files print the
// raw id on purpose and are exempt BY NAME; every file in SITES must wrap.
export const EDITOR_EXEMPT = ['components/chart/builder/PineBox.jsx', 'components/chart/builder/PineEditorStatus.jsx']

/** bare JSX/template prints of `expr`: `{expr}`, `${expr}`, `={expr}` (an attribute) */
export function barePrints(src, expr) {
  const e = expr.replace(/[.()]/g, (c) => `\\${c}`)
  const re = new RegExp(String.raw`(?:\$\{|[{=])\s*` + e + String.raw`\s*\}`, 'g')
  // a dedup/React key (`${n.name}::${n.note}`) never reaches the DOM's text: skipped by its `::`
  const out = []
  for (const m of src.matchAll(re)) {
    if (/::\s*$/.test(src.slice(Math.max(0, m.index - 4), m.index))) continue
    out.push(m[0])
  }
  return out
}
describe('r1 — census: every composer print site goes through withoutGuardIds', () => {
  it.each(SITES)('%s', (rel, exprs) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8')
    expect(src).toContain('withoutGuardIds')
    for (const e of exprs) {
      expect(barePrints(src, e), `${rel}: bare ${e}`).toEqual([])
      expect(src.includes(`withoutGuardIds(${e})`), `${rel}: ${e} wrapped`).toBe(true)
    }
  })
  it('the editor exemption is exactly the two editor files, and they are not in SITES', () => {
    for (const rel of EDITOR_EXEMPT) {
      expect(SITES.some(([r]) => r === rel)).toBe(false)
      expect(fs.readFileSync(path.join(SRC, rel), 'utf8')).not.toContain('withoutGuardIds')
    }
  })
  it('CONTROL: a non-editor bare print fails the census', () => {
    const rel = 'components/chart/builder/RunsOnLine.jsx'
    expect(EDITOR_EXEMPT).not.toContain(rel)
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8').replace('withoutGuardIds(s.sentence)', 's.sentence')
    expect(barePrints(src, 's.sentence').length).toBeGreaterThan(0)
  })
  it('CONTROL: the census sees a bare print', () => {
    expect(barePrints('<li>{n.note}</li> title={f.why} `x ${r.why}`', 'n.note')).toHaveLength(1)
    expect(barePrints('title={f.why}', 'f.why')).toHaveLength(1)
    expect(barePrints('`x ${r.why}`', 'r.why')).toHaveLength(1)
    expect(barePrints('<li>{withoutGuardIds(n.note)}</li>', 'n.note')).toHaveLength(0)
  })
})
