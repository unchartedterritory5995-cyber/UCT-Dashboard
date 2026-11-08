/* UCT RS PHASE 2a, UNIT 2a-11 — the phone study editor learns input GROUPS,
 * help text, `activeWhen` dimming and the preset row (plan §6.3, §6.8, §6.9).
 *
 * What these rails pin:
 *   · group heads in DECLARATION order, each a 44px `aria-expanded` disclosure;
 *     `meta.groupsCollapsed` names the ones that start folded (Line, New highs)
 *     and Simple is what the member sees first; a tap unfolds, a second folds;
 *   · an input's `tooltip` is visible help text under the label, wired to the
 *     controls by `aria-describedby` — NEVER part of a control's name;
 *   · `activeWhen` DIMS a row and never removes it: `data-active="false"`,
 *     `aria-disabled`, controls disabled; flipping the governing input wakes it;
 *   · every field row carries `data-input-key`, one per declared input;
 *   · the preset row shows every `meta.presets` entry as a chip, the matched
 *     one pressed; pressing a preset writes ONCE through the sheet's writer and
 *     adds no instance; a manual edit flips the row to Custom;
 *   · a definition with no groups (RSI, a fixture) renders no head at all.
 *
 * The real registry serves UCT RS (`rsLine` is registered unconditionally —
 * `registerDefinitions([RS_LINE_RAW])` runs at module load, no flag). No shipped
 * definition declares `activeWhen`, so that case is a fixture validated through
 * the REAL `validateDefinition` and served through a partial mock of the
 * registry's `getDefinition` (the user-definition lane admits only runtime/ast
 * kinds, so a native fixture cannot be registered the honest way). */
import { useState } from 'react'
import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, test, expect, afterEach } from 'vitest'
import MobileIndicatorSheet from './MobileIndicatorSheet'
import { validateDefinition } from '../../../components/chart/engine/defSchema'
import { isInstanceTombstone } from '../../../components/chart/instanceShape'
import * as engineRegistry from '../../../components/chart/engine/nativeRegistry'

const fixtures = vi.hoisted(() => new Map())
vi.mock('../../../components/chart/engine/nativeRegistry', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getDefinition: (id) => fixtures.get(id) || actual.getDefinition(id),
  }
})

afterEach(() => { cleanup() })

// ─── harness: a STATEFUL owner, so a write re-renders the sheet with the new blob ─

function Harness({ initial, initialEditing, onWrite }) {
  const [cs, setCs] = useState(initial)
  return (
    <MobileIndicatorSheet
      open
      onClose={vi.fn()}
      cs={cs}
      onWrite={(next) => { onWrite(next); setCs(next) }}
      onBrowseLibrary={vi.fn()}
      onOpenSettings={vi.fn()}
      initialEditing={initialEditing}
    />
  )
}

function mount(initial, initialEditing) {
  const onWrite = vi.fn()
  render(<Harness initial={initial} initialEditing={initialEditing} onWrite={onWrite} />)
  return onWrite
}

const latest = (onWrite, initial) => (onWrite.mock.calls.length ? onWrite.mock.calls.at(-1)[0] : initial)
const liveOf = (cs, defId) => (cs.indicatorInstances || []).filter((i) => i && i.defId === defId && !isInstanceTombstone(i))

/** The EDITOR sheet (the stacked one), named `<title> settings` by its ariaLabel. */
const editor = (name) => screen.getByRole('dialog', { name })
const rowFor = (root, key) => root.querySelector(`[data-input-key="${key}"]`)
const rowKeys = (root) => [...root.querySelectorAll('[data-input-key]')].map((r) => r.dataset.inputKey)
const heads = (root) => [...root.querySelectorAll('button[aria-expanded]')]
const headNamed = (root, name) => {
  const hits = heads(root).filter((b) => b.textContent === name)
  if (hits.length !== 1) throw new Error(`expected one group head named ${JSON.stringify(name)}, found ${hits.length}`)
  return hits[0]
}
const presetChip = (root, id) => root.querySelector(`[data-preset-id="${id}"]`)

// ─── UCT RS, the shipped definition ─────────────────────────────────────────

const RS = 'rsLine'
const RS_EDITOR = 'UCT Relative Strength settings'
const rsCs = () => ({ indicatorInstances: [{ instanceId: 'rs-1', defId: RS, inputs: {}, hidden: false }] })
const rsEditing = { kind: 'study', defId: RS, instanceId: 'rs-1' }
const rsDef = () => engineRegistry.getDefinition(RS)

describe('groups — heads in declaration order, the hint honoured, tap to fold and unfold', () => {
  test('Simple, Line, New highs, Rating, Stress test, Method — Simple open, the five hinted groups folded, bodies unmounted', () => {
    mount(rsCs(), rsEditing)
    const ed = editor(RS_EDITOR)
    // The premise: the shipped definition declares exactly these groups and this hint
    // (VA2: the plan's five folded groups, §6.3).
    const folded = ['Line', 'New highs', 'Rating', 'Stress test', 'Method']
    // 3-08 adds Checks to the hint; it holds only the anchor date, a
    // `requiresServer` input, so with no server declaration it has no head
    expect(rsDef().meta.groupsCollapsed).toEqual([...folded, 'Checks'])
    expect(heads(ed).map((b) => b.textContent)).toEqual(['Simple', ...folded])
    expect(headNamed(ed, 'Simple').getAttribute('aria-expanded')).toBe('true')
    for (const g of folded) expect(headNamed(ed, g).getAttribute('aria-expanded'), g).toBe('false')
    // Simple's rows are there; a folded group's rows are not in the DOM at all.
    expect(rowFor(ed, 'benchmark')).not.toBeNull()
    expect(rowFor(ed, 'maLength')).not.toBeNull()
    expect(rowFor(ed, 'maType')).toBeNull()
    expect(rowFor(ed, 'lookback')).toBeNull()
    // Each head is a disclosure: it names the body it controls.
    for (const h of heads(ed)) expect(h.getAttribute('aria-controls')).toBeTruthy()
    const simpleBody = ed.querySelector(`#${CSS.escape(headNamed(ed, 'Simple').getAttribute('aria-controls'))}`)
    expect(simpleBody).not.toBeNull()
    expect(within(simpleBody).getByText('Benchmark')).toBeInTheDocument()
  })

  test('tapping a folded head unfolds it (rows mount); tapping again folds it', async () => {
    const user = userEvent.setup()
    const onWrite = mount(rsCs(), rsEditing)
    const ed = editor(RS_EDITOR)
    await user.click(headNamed(ed, 'Line'))
    expect(headNamed(ed, 'Line').getAttribute('aria-expanded')).toBe('true')
    expect(rowFor(ed, 'maType')).not.toBeNull()
    expect(rowFor(ed, 'lineWidth')).not.toBeNull()
    // Folding is UI state, not a write.
    expect(onWrite).not.toHaveBeenCalled()
    await user.click(headNamed(ed, 'Line'))
    expect(headNamed(ed, 'Line').getAttribute('aria-expanded')).toBe('false')
    expect(rowFor(ed, 'maType')).toBeNull()
    // The other folded group was not touched by Line's toggle.
    expect(headNamed(ed, 'New highs').getAttribute('aria-expanded')).toBe('false')
  })

  test('a head is a real tap target: a button, not a label', () => {
    mount(rsCs(), rsEditing)
    for (const h of heads(editor(RS_EDITOR))) {
      expect(h.tagName).toBe('BUTTON')
      expect(h.getAttribute('type')).toBe('button')
    }
  })
})

describe('every field row carries data-input-key, one per declared input, in declaration order', () => {
  test('with every group unfolded, the keys are the definition\'s input keys', async () => {
    const user = userEvent.setup()
    mount(rsCs(), rsEditing)
    const ed = editor(RS_EDITOR)
    for (const g of ['Line', 'New highs', 'Rating', 'Stress test', 'Method']) await user.click(headNamed(ed, g))
    // 3-08: the Phase 3 inputs (`requiresServer`) wait for the server's
    // declaration (unit 3-01). ⭐ 3-14: the legacy Mansfield switch renders while
    // its successor (`view`) is undeclared, so the phone sheet carries it too.
    const declared = rsDef().inputs.filter((i) => i.requiresServer !== true
      && (i.legacy !== true || i.key === 'showMansfield')).map((i) => i.key)
    expect(declared.length).toBeGreaterThanOrEqual(15)
    expect(declared).toContain('showMansfield')
    expect(rowKeys(ed)).toEqual(declared)
  })
})

describe('tooltips — visible help text, reaching the controls by aria-describedby and never by name', () => {
  test('the Average (bars) stepper is described by its tooltip and its name is the label alone', () => {
    mount(rsCs(), rsEditing)
    const ed = editor(RS_EDITOR)
    const tip = rsDef().inputs.find((i) => i.key === 'maLength').tooltip
    expect(typeof tip).toBe('string')
    const row = rowFor(ed, 'maLength')
    expect(row.textContent).toContain(tip)
    // The name is the label alone — an exact-name role query is the proof.
    const inc = within(ed).getByRole('button', { name: 'Increase Average (bars)' })
    const dec = within(ed).getByRole('button', { name: 'Decrease Average (bars)' })
    const typeIt = within(ed).getByRole('button', { name: 'Type Average (bars)' })
    for (const b of [inc, dec, typeIt]) {
      const by = b.getAttribute('aria-describedby')
      expect(by).toBeTruthy()
      expect(document.getElementById(by).textContent).toBe(tip)
    }
  })

  test('a switch and an enum chip carry the description too; a field with no tooltip carries none', () => {
    mount(rsCs(), rsEditing)
    const ed = editor(RS_EDITOR)
    const sw = within(ed).getByRole('switch', { name: 'RS new highs' })
    const swTip = rsDef().inputs.find((i) => i.key === 'showNewHigh').tooltip
    expect(document.getElementById(sw.getAttribute('aria-describedby')).textContent).toBe(swTip)
    const chip = within(ed).getByRole('button', { name: 'S&P 500 (SPY)' })
    const benchTip = rsDef().inputs.find((i) => i.key === 'benchmark').tooltip
    expect(document.getElementById(chip.getAttribute('aria-describedby')).textContent).toBe(benchTip)
  })
})

describe('the preset row — chips over meta.presets, the match pressed, one write, Custom after a tweak', () => {
  test('a fresh instance reads Classic; pressing Phase writes once through the writer and adds no instance', async () => {
    const user = userEvent.setup()
    const initial = rsCs()
    const onWrite = mount(initial, rsEditing)
    const ed = editor(RS_EDITOR)
    const row = within(ed).getByTestId('preset-row')
    // 3-08: the Phase 3 presets are `requiresServer`, so nothing declared lists the six
    const ids = rsDef().meta.presets.filter((p) => p.requiresServer !== true).map((p) => p.id)
    expect(ids).toContain('classic')
    expect(ids).toContain('phase')
    for (const id of ids) expect(presetChip(row, id)).not.toBeNull()
    // The resolved values ARE Classic's values, so Classic is the pressed chip…
    expect(presetChip(row, 'classic').getAttribute('aria-pressed')).toBe('true')
    expect(presetChip(row, 'phase').getAttribute('aria-pressed')).toBe('false')
    expect(presetChip(row, '__custom').getAttribute('aria-current')).toBeNull()
    expect(row.dataset.preset).toBe('classic')
    // …and its origin line reads as help text.
    const classic = rsDef().meta.presets.find((p) => p.id === 'classic')
    expect(within(row).getByTestId('preset-origin').textContent).toBe(classic.origin)

    await user.click(presetChip(row, 'phase'))
    expect(onWrite).toHaveBeenCalledTimes(1)
    const next = latest(onWrite, initial)
    const phase = rsDef().meta.presets.find((p) => p.id === 'phase')
    const live = liveOf(next, RS)
    expect(live).toHaveLength(1)
    expect(live[0].instanceId).toBe('rs-1')
    for (const [k, v] of Object.entries(phase.inputs)) expect(live[0].inputs[k]).toBe(v)
    expect(next.preset).toBe('custom')
    // The row now reads Phase.
    const row2 = within(editor(RS_EDITOR)).getByTestId('preset-row')
    expect(presetChip(row2, 'phase').getAttribute('aria-pressed')).toBe('true')
    expect(presetChip(row2, 'classic').getAttribute('aria-pressed')).toBe('false')
    expect(within(row2).getByTestId('preset-origin').textContent).toBe(phase.origin)
  })

  // `applyPresetInputs` skips a key only when it is already STORED at the
  // preset's value (instanceControls.js, "compares against STORED inputs"), so
  // the two halves of "already matched" differ: a fresh instance MATCHES Classic
  // through its defaults and pressing Classic stores them explicitly (one write,
  // same resolved values, still Classic); an instance with every key stored
  // writes nothing. The dialog behaves the same way.
  test('pressing the matched preset on a FRESH instance stores its values explicitly, once, and stays Classic', async () => {
    const user = userEvent.setup()
    const initial = rsCs()
    const onWrite = mount(initial, rsEditing)
    const row = within(editor(RS_EDITOR)).getByTestId('preset-row')
    await user.click(presetChip(row, 'classic'))
    expect(onWrite).toHaveBeenCalledTimes(1)
    const classic = rsDef().meta.presets.find((p) => p.id === 'classic')
    const live = liveOf(latest(onWrite, initial), RS)
    expect(live).toHaveLength(1)
    expect(live[0].inputs).toEqual(classic.inputs)
    const row2 = within(editor(RS_EDITOR)).getByTestId('preset-row')
    expect(presetChip(row2, 'classic').getAttribute('aria-pressed')).toBe('true')
  })

  test('pressing a preset whose every key is already STORED writes nothing (identity return, nothing persisted)', async () => {
    const user = userEvent.setup()
    const classic = rsDef().meta.presets.find((p) => p.id === 'classic')
    const initial = { indicatorInstances: [{ instanceId: 'rs-1', defId: RS, inputs: { ...classic.inputs }, hidden: false }] }
    const onWrite = mount(initial, rsEditing)
    const row = within(editor(RS_EDITOR)).getByTestId('preset-row')
    expect(presetChip(row, 'classic').getAttribute('aria-pressed')).toBe('true')
    await user.click(presetChip(row, 'classic'))
    expect(onWrite).not.toHaveBeenCalled()
  })

  test('a manual edit of a key the preset sets flips the row to Custom; no chip stays pressed', async () => {
    const user = userEvent.setup()
    const initial = rsCs()
    const onWrite = mount(initial, rsEditing)
    const ed = editor(RS_EDITOR)
    await user.click(within(ed).getByRole('button', { name: 'Increase Average (bars)' }))
    expect(onWrite).toHaveBeenCalledTimes(1)
    expect(liveOf(latest(onWrite, initial), RS)[0].inputs.maLength).toBe(22)
    const row = within(editor(RS_EDITOR)).getByTestId('preset-row')
    expect(row.dataset.preset).toBe('__custom')
    expect(presetChip(row, '__custom').getAttribute('aria-current')).toBe('true')
    for (const p of rsDef().meta.presets.filter((x) => x.requiresServer !== true)) expect(presetChip(row, p.id).getAttribute('aria-pressed')).toBe('false')
    expect(within(row).queryByTestId('preset-origin')).toBeNull()
  })

  test('the benchmark is not a preset key, so changing it keeps Classic (a preset sets only what it is about)', async () => {
    const user = userEvent.setup()
    mount(rsCs(), rsEditing)
    await user.click(within(editor(RS_EDITOR)).getByRole('button', { name: 'Nasdaq 100 (QQQ)' }))
    const row = within(editor(RS_EDITOR)).getByTestId('preset-row')
    expect(presetChip(row, 'classic').getAttribute('aria-pressed')).toBe('true')
  })
})

// ─── activeWhen — a fixture, because no shipped definition declares one ──────

const AW = 'awfix'
const awRaw = {
  schemaVersion: 1,
  id: AW,
  version: 1,
  compute: { kind: 'native', fn: AW, rev: 1 },
  meta: { name: 'Fixture active', shortName: 'AWF', category: 'Test', tier: 'free', repaint: 'non-repainting' },
  placement: { target: 'price' },
  inputs: [
    { key: 'gate', type: 'bool', label: 'Gate', default: false, tooltip: 'Turns the threshold on.' },
    { key: 'thresh', type: 'float', label: 'Threshold', default: 1.5, min: 0, max: 10, step: 0.5,
      activeWhen: { key: 'gate', equals: true } },
    { key: 'mode', type: 'enum', label: 'Mode', default: 'a', options: [['a', 'Mode A'], ['b', 'Mode B']],
      activeWhen: { key: 'gate', equals: true } },
  ],
  plots: [{ key: 'out', label: 'Out', style: 'line', color: '#ffffff', width: 1, role: 'primary', legend: { decimals: 2 } }],
}
{
  const res = validateDefinition(awRaw)
  if (!res.ok) throw new Error(`fixture definition rejected: ${res.errors.join(' | ')}`)
  fixtures.set(AW, res.def)
}
const AW_EDITOR = 'Fixture active settings'
const awCs = () => ({ indicatorInstances: [{ instanceId: 'aw-1', defId: AW, inputs: {}, hidden: false }] })
const awEditing = { kind: 'study', defId: AW, instanceId: 'aw-1' }

describe('activeWhen — dims, never removes; the governing input wakes it', () => {
  test('a governed row renders dimmed and inert while its condition is false', () => {
    mount(awCs(), awEditing)
    const ed = editor(AW_EDITOR)
    // The row is THERE — rendered, labelled, readable — and marked inert.
    const row = rowFor(ed, 'thresh')
    expect(row).not.toBeNull()
    expect(row.dataset.active).toBe('false')
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(within(row).getByText('Threshold')).toBeInTheDocument()
    const inc = within(ed).getByRole('button', { name: 'Increase Threshold' })
    expect(inc).toBeDisabled()
    expect(inc.getAttribute('aria-disabled')).toBe('true')
    // The enum's chips too.
    const modeA = within(ed).getByRole('button', { name: 'Mode A' })
    expect(modeA).toBeDisabled()
    // The governing row itself is live.
    const gateRow = rowFor(ed, 'gate')
    expect(gateRow.dataset.active).toBe('true')
    expect(gateRow.getAttribute('aria-disabled')).toBeNull()
    expect(within(gateRow).getByText('Turns the threshold on.')).toBeInTheDocument()
    // No groups declared ⇒ no head at all.
    expect(heads(ed)).toHaveLength(0)
    expect(within(ed).queryByTestId('preset-row')).toBeNull()
  })

  test('an inert stepper writes nothing; flipping Gate wakes the rows and the stepper writes again', async () => {
    const user = userEvent.setup()
    const initial = awCs()
    const onWrite = mount(initial, awEditing)
    let ed = editor(AW_EDITOR)
    await user.click(within(ed).getByRole('button', { name: 'Increase Threshold' }))
    expect(onWrite).not.toHaveBeenCalled()

    await user.click(within(ed).getByRole('switch', { name: 'Gate' }))
    expect(onWrite).toHaveBeenCalledTimes(1)
    expect(liveOf(latest(onWrite, initial), AW)[0].inputs.gate).toBe(true)
    ed = editor(AW_EDITOR)
    const row = rowFor(ed, 'thresh')
    expect(row.dataset.active).toBe('true')
    expect(row.getAttribute('aria-disabled')).toBeNull()
    const inc = within(ed).getByRole('button', { name: 'Increase Threshold' })
    expect(inc).toBeEnabled()
    expect(inc.getAttribute('aria-disabled')).toBe('false')
    expect(within(ed).getByRole('button', { name: 'Mode A' })).toBeEnabled()

    await user.click(inc)
    expect(onWrite).toHaveBeenCalledTimes(2)
    expect(liveOf(latest(onWrite, initial), AW)[0].inputs.thresh).toBe(2)
  })
})

// ─── a definition with no groups renders exactly what it did ────────────────

describe('RSI — no groups, no presets: headerless rows, the stepper as before', () => {
  test('no head, no preset row; Period carries data-input-key and still writes', async () => {
    const user = userEvent.setup()
    const initial = { indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: {}, hidden: false }] }
    const onWrite = mount(initial, { kind: 'study', defId: 'rsi' })
    const ed = editor('Relative Strength Index settings')
    expect(heads(ed)).toHaveLength(0)
    expect(within(ed).queryByTestId('preset-row')).toBeNull()
    expect(rowFor(ed, 'period')).not.toBeNull()
    expect(rowKeys(ed)).toEqual(engineRegistry.getDefinition('rsi').inputs.map((i) => i.key))
    await user.click(within(ed).getByRole('button', { name: 'Increase Period' }))
    expect(liveOf(latest(onWrite, initial), 'rsi')[0].inputs.period).toBe(15)
  })
})
