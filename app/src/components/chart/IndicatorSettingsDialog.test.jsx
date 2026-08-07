/* global process */
// app/src/components/chart/IndicatorSettingsDialog.test.jsx
//
// ─── SPEC §6's SETTINGS FORM, PER *INSTANCE* ────────────────────────────────
//
// "RSI settings…" opened the GLOBAL five-tab modal (Price Style / Canvas /
// Indicators / Header / Markers). Spec §6 asks for a THREE-tab form scoped to
// ONE instance. The generator was never the missing part — `fieldsFromDefinition`
// has turned declared inputs into control descriptors since B4 — the CONTAINER
// was. Every case below names the §6 clause it holds.
//
// ⛔ THE PIXEL GATE IS BLIND TO ALL OF IT. `ChartRender.jsx` injects
// `#chart-export [class*="legend" i]{display:none}` into the only route
// `tools/chart_parity.py` photographs, and that route mounts no dialog and
// clicks nothing — a TOTAL regression of this file reports 0 changed pixels on
// all 46 cases. These cases plus the byte-equality rollback ARE the gate.
//
// ⭐ EVERY IDENTIFIER IS DERIVED FROM THE SYSTEM. Labels come from
// `fieldsFromDefinition`, bounds from the definition's own inputs, the debounce
// from the module's exported constant, the chip's decimals from `readout.chipsFrom`.
// A typed 'Length' would have been a green test against a control that says
// 'Period' — the plan's own snippet typed exactly that.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { useState } from 'react'
import { render, screen, within, act, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// ⚠️ `?raw`, not `fs` + `__dirname`. `import.meta.url` is NOT a `file:` URL under
// this vitest transform (`fileURLToPath` threw "The URL must be of scheme file"),
// and `__dirname` / `process` are undefined to this repo's eslint config — the two
// pre-existing `no-undef` errors in `controlDoorCensus.test.js` are exactly that.
// Vite's `?raw` reads the file through the resolver that already knows where this
// module is, so the path cannot rot and no global is invented.
//
// ⛔ IT DOES NOT WORK FOR A `.module.css`: vitest's CSS handling wins over the
// `?raw` query and hands back the class-name PROXY, whose every property is a
// string — `css.length` came back as `"length"` rather than a number, which is a
// scan that would have matched nothing and reported it as a pass. The stylesheet
// is read off disk below instead, from a root RESOLVED rather than assumed.
import STOCKCHART_SRC from '../StockChart.jsx?raw'
import IndicatorSettingsDialog, { DEBOUNCE_MS } from './IndicatorSettingsDialog'
import { fieldsFromDefinition, fieldsForInstance, evalActiveWhen } from './indicatorRegistry'
import { mergeChartSettings } from './chartDefaults'
import { setIndicatorEnabled, addInstance, setInstanceInput, findInstance } from './engine/instanceControls'
import { legacyInstanceId } from './engine/instances'
import { validateDefinition, PLACEMENT_TARGETS } from './engine/defSchema'
import { chipsFrom } from './engine/readout'
import { stripComments } from './engine/__tests__/sourceScan'
import * as engineRegistry from './engine/nativeRegistry'

// ─── harness ────────────────────────────────────────────────────────────────

const RSI = 'rsi'
const RSI_INST = legacyInstanceId(RSI)
const rsiDef = engineRegistry.getDefinition(RSI)

/** A field's LABEL, read from the same generator the dialog renders from. */
const labelOf = (def, key) => {
  const f = fieldsFromDefinition(def).find((x) => x.key === key)
  if (!f) throw new Error(`no generated field for ${def.id}.${key}`)
  return f.label
}
/** A field's declared bound, read from the definition itself. */
const declaredOf = (def, key) => {
  const d = (def.inputs || []).find((i) => i && i.key === key)
  if (!d) throw new Error(`no declared input ${def.id}.${key}`)
  return d
}

const RSI_PERIOD_LABEL = labelOf(rsiDef, 'period')
const RSI_PERIOD = declaredOf(rsiDef, 'period')

/** The period an instance RESOLVES to — its stored input if it has one, the
 *  definition's declared default if it does not. Read through the same builder
 *  the dialog renders from. */
const resolvedPeriod = (blob, id) =>
  fieldsForInstance(rsiDef, findInstance(blob, id)).values.period

/** The base blob with RSI on — through the shipped door, so the instance is the
 *  one the product actually stores. */
const rsiOn = () => setIndicatorEnabled(mergeChartSettings(null), RSI, true, engineRegistry)

/** The role a generated field's control carries, per type. Derived so a new
 *  control type has to teach this table rather than silently skipping the aria
 *  case. */
const ROLE_FOR = { number: 'spinbutton', select: 'combobox', toggle: 'switch', color: 'button' }

// The harness's current blob is read from the LAST `onChange` argument rather
// than from a module variable the component writes: `react-hooks/immutability`
// refuses the latter, and the spy is the more honest source anyway — it is the
// value the dialog actually handed out.
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

function mount({ settings, instanceId = RSI_INST, registry = engineRegistry } = {}) {
  const initial = settings || rsiOn()
  const onChange = vi.fn()
  const onClose = vi.fn()
  harness = { onChange, initial }
  const view = render(
    <Harness initial={initial} instanceId={instanceId} registry={registry}
             onChangeSpy={onChange} onCloseSpy={onClose} />,
  )
  return { onChange, onClose, initial, view }
}

const latest = () => {
  const calls = harness.onChange?.mock?.calls || []
  return calls.length ? calls[calls.length - 1][0] : harness.initial
}
const dialog = () => screen.getByRole('dialog')
const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent)
const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }))
const rowFor = (key) => dialog().querySelector(`[data-input-key="${key}"]`)
const rowKeys = () => [...dialog().querySelectorAll('[data-input-key]')].map((r) => r.dataset.inputKey)

/** Past the debounce window, on REAL timers. `DEBOUNCE_MS` is imported, never
 *  typed: a change to the window moves this wait with it. */
const settle = async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 80)) })
}

/** A registry over ONE hand-built definition — validated through the REAL
 *  `validateDefinition`, so a fixture the product would refuse cannot make a
 *  case pass. The resolved definition is used (it carries `$refs`). */
function fakeRegistry(raw) {
  const res = validateDefinition(raw)
  if (!res.ok) throw new Error(`fixture definition rejected: ${res.errors.join(' | ')}`)
  const def = res.def
  return {
    def,
    getDefinition: (id) => (id === def.id ? def : null),
    listDefinitions: () => [def],
  }
}

const fixtureDef = (id, inputs, plots) => ({
  schemaVersion: 1,
  id,
  version: 1,
  compute: { kind: 'native', fn: id, rev: 1 },
  meta: { name: `Fixture ${id}`, shortName: id.toUpperCase(), category: 'Test', tier: 'free', repaint: 'non-repainting' },
  placement: { target: 'price' },
  inputs,
  plots: plots || [{ key: 'out', label: 'Out', style: 'line', color: '#ffffff', width: 1, role: 'primary', legend: { decimals: 2 } }],
})

/** The module stylesheet, read off disk from a root RESOLVED by walking up until
 *  the file is there — never a path assumed from the cwd the runner happened to
 *  have. ⛔ It REFUSES rather than returning an empty string: a CSS scan against
 *  `''` matches nothing and reports it as a pass, which is the zero that cannot
 *  fail this repo keeps finding. */
const readDialogCss = () => {
  const rel = 'src/components/chart/IndicatorSettingsDialog.module.css'
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    const hit = path.join(dir, rel)
    if (fs.existsSync(hit)) return fs.readFileSync(hit, 'utf8')
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`IndicatorSettingsDialog.module.css not found from ${process.cwd()}`)
}

/** A settings blob carrying ONE live instance of a fixture definition. Built
 *  from the shipped base so nothing else about the blob is invented. */
const csWithInstance = (defId, inputs, extra = {}) => ({
  ...mergeChartSettings(null),
  indicatorInstances: [{ instanceId: `inst:${defId}:1`, defId, inputs, hidden: false, ...extra }],
})

// ─── the cases ──────────────────────────────────────────────────────────────

describe('IndicatorSettingsDialog — spec §6\'s settings form, per INSTANCE', () => {
  // 1. THREE TABS, in order.
  it('renders Inputs / Style / Visibility as tabs, Inputs first', () => {
    mount()
    expect(tabNames()).toEqual(['Inputs', 'Style', 'Visibility'])
    expect(screen.getByRole('tab', { name: 'Inputs' }).getAttribute('aria-selected')).toBe('true')
    // …and the OTHER two are not selected, which is the half a "first tab exists"
    // assertion cannot see.
    expect(screen.getByRole('tab', { name: 'Style' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tabpanel')).toBeTruthy()
  })

  it('the title names THIS instance the way the chip does, not the definition', () => {
    mount()
    // `RSI(14)` — the same string `readout.chipsFrom` puts on the chip, resolved
    // through the instance's own inputs. A title reading "Relative Strength
    // Index" would be a second naming pipeline.
    const chip = chipsFrom(
      [{ defId: RSI, plotKey: 'rsi', series: {}, lastValue: 0, instanceId: RSI_INST }],
      new Map(), engineRegistry, () => findInstance(rsiOn(), RSI_INST).inputs,
    )[0]
    expect(within(dialog()).getByText(new RegExp(chip.label.replace(/[()]/g, '\\$&')))).toBeTruthy()
  })

  // 2. ONE INPUT PER ROW, label left / control right.
  it('every declared input of the definition reaches a row, in declaration order', () => {
    // MACD, because it declares five inputs across two types — three periods and
    // two colours — so "declaration order" is a claim with something to say.
    const macd = engineRegistry.getDefinition('macd')
    const cs = setIndicatorEnabled(mergeChartSettings(null), 'macd', true, engineRegistry)
    mount({ settings: cs, instanceId: legacyInstanceId('macd') })
    const declared = fieldsFromDefinition(macd).map((f) => f.key)
    // The union across the two tabs that carry generated fields, in the order the
    // tabs were walked — Inputs first, Style second — must be a PARTITION of the
    // declared list preserving declaration order within each half.
    const onInputs = rowKeys()
    openTab('Style')
    const onStyle = rowKeys().filter((k) => declared.includes(k))
    expect([...onInputs, ...onStyle].sort()).toEqual([...declared].sort())
    expect(onInputs).toEqual(declared.filter((k) => onInputs.includes(k)))
    expect(onStyle).toEqual(declared.filter((k) => onStyle.includes(k)))
    // …and the split is DERIVED from the plots' `$refs`, not a typed list: the
    // two colours are the two inputs the plots substitute.
    expect(onStyle).toEqual(['macdColor', 'signalColor'])
  })

  it('a row is label LEFT, control RIGHT — in that DOM order', () => {
    mount()
    const row = rowFor('period')
    const kids = [...row.children]
    expect(kids[0].tagName).toBe('LABEL')
    expect(kids[0].textContent).toBe(RSI_PERIOD_LABEL)
    expect(kids[1].querySelector('input,select,button')).toBeTruthy()
  })

  // 3. `inline` PACKS <=3 SAME-TYPE.
  it('three same-type inputs sharing an `inline` group render on ONE row; a fourth wraps', () => {
    // ⚠️ NO SHIPPED DEFINITION DECLARES `inline` — `grep -c inline: nativeRegistry.js`
    // is 0 today. `defSchema:795` validates it as a v1 presentation modifier, so
    // the branch ships with a hand-built definition exercising it, and this comment
    // is the record that the product does not exercise it yet.
    const four = ['a', 'b', 'c', 'd'].map((k, i) => ({
      key: `lvl${k}`, type: 'int', label: `Level ${k.toUpperCase()}`, default: i + 1, min: 0, max: 9, step: 1, inline: 'levels',
    }))
    const reg = fakeRegistry(fixtureDef('inlinefix', four))
    mount({ settings: csWithInstance('inlinefix', { lvla: 1, lvlb: 2, lvlc: 3, lvld: 4 }), instanceId: 'inst:inlinefix:1', registry: reg })
    const packs = [...dialog().querySelectorAll('[data-inline-group="levels"]')]
    expect(packs).toHaveLength(2)
    expect([...packs[0].querySelectorAll('[data-input-key]')]).toHaveLength(3)
    expect([...packs[1].querySelectorAll('[data-input-key]')]).toHaveLength(1)
    // All four still reach a row — packing is layout, never a filter.
    expect(rowKeys()).toEqual(['lvla', 'lvlb', 'lvlc', 'lvld'])
  })

  it('an `inline` group of MIXED types does not pack — three widths on one row is a layout, not a lie', () => {
    const mixed = [
      { key: 'n1', type: 'int', label: 'N one', default: 1, min: 0, max: 9, step: 1, inline: 'mix' },
      { key: 'c1', type: 'color', label: 'C one', default: '#ffffff', inline: 'mix' },
    ]
    const reg = fakeRegistry(fixtureDef('mixfix', mixed))
    mount({ settings: csWithInstance('mixfix', { n1: 1, c1: '#ffffff' }), instanceId: 'inst:mixfix:1', registry: reg })
    // The colour is a STYLE field ($refs-free here, so it stays on Inputs) but the
    // types differ, so they take a row each.
    expect([...dialog().querySelectorAll('[data-inline-group="mix"]')]).toHaveLength(2)
  })

  // 4. LIVE-APPLY.
  it('typing a period and blurring calls onChange with the INSTANCE updated', async () => {
    const { onChange } = mount()
    const box = screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL })
    fireEvent.change(box, { target: { value: '21' } })
    fireEvent.blur(box)
    await settle()
    expect(onChange).toHaveBeenCalled()
    expect(findInstance(latest(), RSI_INST).inputs.period).toBe(21)
    // …and the SIBLING definition's stored inputs are untouched: this is an
    // instance write, not a definition write.
    expect(latest().indicators?.[RSI]?.period).toBeUndefined()
  })

  // 5. 250ms DEBOUNCE.
  it('the debounce window is spec §6\'s 250ms', () => {
    expect(DEBOUNCE_MS).toBe(250)
  })

  it('three keystrokes inside 250ms produce ONE onChange, and it carries the LAST value', async () => {
    const { onChange } = mount()
    const box = screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL })
    // Three edits with NO await between them — the whole burst is inside one
    // window by construction, so a saturated box cannot make this flake.
    fireEvent.change(box, { target: { value: '2' } })
    fireEvent.change(box, { target: { value: '20' } })
    fireEvent.change(box, { target: { value: '21' } })
    expect(onChange).not.toHaveBeenCalled()
    await settle()
    expect(onChange).toHaveBeenCalledTimes(1)
    // ⭐ THE LAST value, not the first. A timer callback closing over the value it
    // was scheduled with commits `2` here — `feedback_tiptap_onupdate_stale_closure`
    // is the recorded version of that bug in this repo.
    expect(findInstance(latest(), RSI_INST).inputs.period).toBe(21)
  })

  // 6. NUMERIC COMMIT ON BLUR/ENTER, WITH VISIBLE CLAMPING.
  it('a period above the declared max commits CLAMPED and the input SHOWS the clamped value', async () => {
    mount()
    const box = screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL })
    fireEvent.change(box, { target: { value: String(RSI_PERIOD.max + 899) } })
    fireEvent.blur(box)
    await settle()
    // ⛔ BOTH HALVES. Storing the clamp while the box still reads 999 is a control
    // that changed the user's number behind their back; showing the clamp while
    // storing nothing is `setInstanceInput` REFUSING the write
    // (`validateInputValue` rejects out-of-range) with no sign that it did.
    expect(box.value).toBe(String(RSI_PERIOD.max))
    expect(findInstance(latest(), RSI_INST).inputs.period).toBe(RSI_PERIOD.max)
  })

  it('…and below the declared min clamps up, the other end of the same bound', async () => {
    mount()
    const box = screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL })
    fireEvent.change(box, { target: { value: '0' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await settle()
    expect(box.value).toBe(String(RSI_PERIOD.min))
    expect(findInstance(latest(), RSI_INST).inputs.period).toBe(RSI_PERIOD.min)
  })

  it('…and the clamp is announced, not silent: the row carries a role="status" saying max is N', async () => {
    mount()
    const box = screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL })
    // CONTROL: nothing is announced before anything is clamped, so the assertion
    // below is about the clamp and not about a line that is always there.
    expect(within(rowFor('period')).queryByRole('status')).toBeNull()
    fireEvent.change(box, { target: { value: '999' } })
    fireEvent.blur(box)
    await settle()
    const status = within(rowFor('period')).getByRole('status')
    expect(status.textContent).toContain(String(RSI_PERIOD.max))
  })

  // 7. CANCEL-ROLLBACK VIA SNAPSHOT-ON-OPEN.
  it('Cancel restores the settings object the dialog opened with, BYTE for byte', async () => {
    const user = userEvent.setup()
    const { onClose } = mount()
    const before = JSON.stringify(latest())
    const box = screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL })
    fireEvent.change(box, { target: { value: '7' } })
    fireEvent.blur(box)
    await settle()
    // ⭐⭐ THE POSITIVE CONTROL. Without this line a dialog that wrote NOTHING AT
    // ALL passes the rollback assertion below — a gate that cannot fail. It has
    // to be observable first, then restored.
    expect(JSON.stringify(latest())).not.toBe(before)
    expect(findInstance(latest(), RSI_INST).inputs.period).toBe(7)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(JSON.stringify(latest())).toBe(before)
    expect(onClose).toHaveBeenCalled()
  })

  it('Cancel restores a MULTI-FIELD edit, and the snapshot is not refreshed by the edits it must undo', async () => {
    const user = userEvent.setup()
    mount()
    const before = JSON.stringify(latest())
    const box = screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL })
    fireEvent.change(box, { target: { value: '9' } })
    fireEvent.blur(box)
    await settle()
    fireEvent.change(box, { target: { value: '33' } })
    fireEvent.blur(box)
    await settle()
    // TWO settled writes: a snapshot taken on every render is a snapshot of the
    // FIRST edit by now, and Cancel would restore period 9 rather than 14.
    expect(findInstance(latest(), RSI_INST).inputs.period).toBe(33)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(JSON.stringify(latest())).toBe(before)
  })

  it('Done keeps the edit — the rollback is Cancel\'s alone', async () => {
    const user = userEvent.setup()
    const { onClose } = mount()
    const box = screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL })
    fireEvent.change(box, { target: { value: '8' } })
    fireEvent.blur(box)
    await settle()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(findInstance(latest(), RSI_INST).inputs.period).toBe(8)
    expect(onClose).toHaveBeenCalled()
  })

  // 8. `activeWhen` DIMS, NEVER REMOVES.
  it('an input whose activeWhen is false is disabled and still in the DOM', () => {
    // ⚠️ NO SHIPPED DEFINITION DECLARES `activeWhen` — `grep -c activeWhen
    // nativeRegistry.js` is 0. `defSchema:802` validates it and explains why an
    // unresolvable key is fatal ("a control hidden forever"); the branch ships
    // with a hand-built definition and this comment is the record.
    const inputs = [
      { key: 'mode', type: 'int', label: 'Mode', default: 0, min: 0, max: 1, step: 1 },
      { key: 'extra', type: 'int', label: 'Extra', default: 5, min: 1, max: 9, step: 1, activeWhen: { key: 'mode', equals: 1 } },
    ]
    const reg = fakeRegistry(fixtureDef('awfix', inputs))
    mount({ settings: csWithInstance('awfix', { mode: 0, extra: 5 }), instanceId: 'inst:awfix:1', registry: reg })
    const box = screen.getByRole('spinbutton', { name: 'Extra' })
    // ⛔ DIMMED, NEVER REMOVED. A control that vanishes teaches the user it does
    // not exist; one that is visibly inert teaches them what to change first.
    expect(box).toBeTruthy()
    expect(box.disabled).toBe(true)
    expect(box.getAttribute('aria-disabled')).toBe('true')
    expect(rowKeys()).toContain('extra')
  })

  it('…and it comes back to life when its condition is met', async () => {
    const inputs = [
      { key: 'mode', type: 'int', label: 'Mode', default: 0, min: 0, max: 1, step: 1 },
      { key: 'extra', type: 'int', label: 'Extra', default: 5, min: 1, max: 9, step: 1, activeWhen: { key: 'mode', equals: 1 } },
    ]
    const reg = fakeRegistry(fixtureDef('awfix2', inputs))
    mount({ settings: csWithInstance('awfix2', { mode: 0, extra: 5 }), instanceId: 'inst:awfix2:1', registry: reg })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Mode' }), { target: { value: '1' } })
    // The DRAFT drives it — a control that only wakes after the debounce settles
    // is a control that lags the switch that governs it.
    expect(screen.getByRole('spinbutton', { name: 'Extra' }).disabled).toBe(false)
  })

  it('evalActiveWhen: the grammar is small, and an unknown comparator refuses rather than guessing', () => {
    expect(evalActiveWhen(undefined, {})).toBe(true)
    expect(evalActiveWhen({ key: 'a', equals: 1 }, { a: 1 })).toBe(true)
    expect(evalActiveWhen({ key: 'a', equals: 1 }, { a: 2 })).toBe(false)
    expect(evalActiveWhen({ key: 'a', notEquals: 0 }, { a: 2 })).toBe(true)
    expect(evalActiveWhen({ key: 'a', gt: 0 }, { a: 2 })).toBe(true)
    expect(evalActiveWhen({ key: 'a', gt: 0 }, { a: 0 })).toBe(false)
    expect(evalActiveWhen({ key: 'a', in: [1, 3] }, { a: 3 })).toBe(true)
    // No comparator at all ⇒ truthiness, which is what `indicatorRegistry`'s own
    // shipped `showIf` predicates mean (`(v) => Number(v.maPeriod) > 0`).
    expect(evalActiveWhen({ key: 'a' }, { a: 0 })).toBe(false)
    expect(evalActiveWhen({ key: 'a' }, { a: 3 })).toBe(true)
    // ⛔ AN UNKNOWN COMPARATOR IS ACTIVE, NOT HIDDEN. `defSchema` says the operator
    // grammar is NOT locked in v1; a future operator this build cannot read must
    // leave the control usable rather than hide it forever.
    expect(evalActiveWhen({ key: 'a', matchesRegex: '^x' }, { a: 3 })).toBe(true)
  })

  // 9. 70vh MAX-HEIGHT + COLLAPSIBLE GROUPS.
  it('the body declares max-height:70vh in the module CSS', () => {
    const css = readDialogCss()
    // CONTROL: the file is real and non-trivial, so the match below is a match
    // against a stylesheet rather than against an empty string that happens to
    // contain nothing.
    expect(css.length).toBeGreaterThan(200)
    expect(css).toMatch(/max-height:\s*70vh/)
    // …and the fixed control widths §6 asks for are declared per TYPE, not per
    // field: one width for numbers, one for selects.
    expect(css).toMatch(/--fld-num-w/)
    expect(css).toMatch(/--fld-sel-w/)
  })

  it('a definition with two `group`s renders two collapsible sections', () => {
    // ⚠️ NO SHIPPED DEFINITION DECLARES `group` either (0 hits in nativeRegistry).
    const inputs = [
      { key: 'p1', type: 'int', label: 'P one', default: 1, min: 1, max: 9, step: 1, group: 'Bands' },
      { key: 'p2', type: 'int', label: 'P two', default: 2, min: 1, max: 9, step: 1, group: 'Bands' },
      { key: 'p3', type: 'int', label: 'P three', default: 3, min: 1, max: 9, step: 1, group: 'Smoothing' },
    ]
    const reg = fakeRegistry(fixtureDef('grpfix', inputs))
    mount({ settings: csWithInstance('grpfix', { p1: 1, p2: 2, p3: 3 }), instanceId: 'inst:grpfix:1', registry: reg })
    const heads = screen.getAllByRole('button', { expanded: true })
    expect(heads.map((h) => h.textContent)).toEqual(['Bands', 'Smoothing'])
    // Collapsing one hides ITS rows and leaves the other's alone — the property
    // that makes a 70vh body navigable rather than merely short.
    fireEvent.click(heads[0])
    expect(rowKeys()).toEqual(['p3'])
    expect(screen.getByRole('button', { name: 'Bands' }).getAttribute('aria-expanded')).toBe('false')
  })

  // 10. FOCUS TRAP + TAB ORDER + ARIA.
  it('Tab from the last control returns to the first', async () => {
    mount()
    // `Sheet` focuses its panel on an rAF; letting that land first is what makes
    // the focus this case sets its OWN starting point rather than a race.
    await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
    // The focusable set is computed here with a STANDARD selector, independent of
    // whatever the component uses — two implementations of "focusable" agreeing
    // is the point. ⚠️ `Sheet` does NOT ship a focus trap (it focuses the panel
    // once, handles Escape, locks body scroll); nothing in it stops Tab walking
    // out of the modal. The trap is this dialog's own.
    const focusables = [...dialog().querySelectorAll(
      'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )]
    expect(focusables.length).toBeGreaterThan(3)
    const first = focusables[0]
    const last = focusables[focusables.length - 1]

    // ⚠️ `fireEvent`, NOT `userEvent.tab()`. jsdom implements no native tab
    // navigation, so any focus move here is THIS component's; `userEvent.tab()`
    // emulates the browser's own move and — measured — does not honour the
    // `preventDefault` the trap issues, so it wraps the DOCUMENT ring (a body of
    // nothing but this modal) and passes with the trap deleted. `fireEvent`
    // returns `false` when the handler prevented the default, which is the
    // assertion that the interception happened at all.
    last.focus()
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(first)

    // …and backwards from the first wraps to the last, or the trap leaks the
    // other way and Shift+Tab walks into the page behind the modal.
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(last)

    // ⭐ POSITIVE CONTROL. In the MIDDLE of the ring the trap must NOT intervene —
    // a handler that swallowed every Tab would pass both assertions above while
    // making the dialog impossible to walk through.
    const mid = focusables[1]
    mid.focus()
    expect(fireEvent.keyDown(mid, { key: 'Tab' })).toBe(true)
    expect(document.activeElement).toBe(mid)
  })

  it('every control has an accessible name from its label, and its tooltip as aria-describedby', () => {
    const inputs = [
      { key: 'num', type: 'int', label: 'Num', default: 1, min: 1, max: 9, step: 1, tooltip: 'How many bars' },
      { key: 'pick', type: 'enum', label: 'Pick', default: 'a', options: ['a', 'b'], tooltip: 'Which one' },
      { key: 'flag', type: 'bool', label: 'Flag', default: true, tooltip: 'On or off' },
      { key: 'tint', type: 'color', label: 'Tint', default: '#ffffff', tooltip: 'The colour' },
    ]
    const reg = fakeRegistry(fixtureDef('ariafix', inputs))
    mount({ settings: csWithInstance('ariafix', { num: 1, pick: 'a', flag: true, tint: '#ffffff' }), instanceId: 'inst:ariafix:1', registry: reg })
    // Derived from the generator: every field it produces must be reachable BY ITS
    // LABEL through the role its type maps to.
    for (const f of fieldsForInstance(reg.def, findInstance(csWithInstance('ariafix', { num: 1, pick: 'a', flag: true, tint: '#ffffff' }), 'inst:ariafix:1')).all) {
      const el = screen.getByRole(ROLE_FOR[f.type], { name: f.label })
      expect(el, f.key).toBeTruthy()
      if (f.type === 'color') {
        // ⚠️ THE ONE HONEST GAP, NAMED. `ColorPicker` is a SHIPPED component this
        // task does not own and it accepts no aria props, so its swatch takes its
        // name from `title` and can carry no `aria-describedby`. The tooltip is
        // rendered as visible row text instead, which every user can read.
        expect(within(rowFor(f.key)).getByText(f.tooltip)).toBeTruthy()
        continue
      }
      const describedBy = el.getAttribute('aria-describedby')
      expect(describedBy, f.key).toBeTruthy()
      expect(document.getElementById(describedBy).textContent).toBe(f.tooltip)
    }
  })

  // 11. THE STYLE TAB AND THE ONE FORMATTING PIPELINE.
  it('the Style tab reads the chip\'s precision from readout.chipsFrom, and the chip name follows the instance', async () => {
    mount()
    openTab('Style')
    const throughThePipeline = (inputs) => chipsFrom(
      [{ defId: RSI, plotKey: 'rsi', series: {}, lastValue: 0, instanceId: RSI_INST }],
      new Map(), engineRegistry, () => inputs,
    )[0]
    const before = throughThePipeline({ period: 14 })
    // ONE pipeline: the number shown is the one `readout` would format with —
    // Task 2 set these per definition (rsi 1, obv 0, bb 2 …) and this reads them
    // rather than re-deriving a second table.
    expect(within(dialog()).getByTestId('chip-precision').textContent).toBe(String(before.decimals))
    expect(within(dialog()).getByTestId('chip-name').textContent).toBe(before.label)

    // …and the NAME follows the instance's inputs, live.
    openTab('Inputs')
    const box = screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL })
    fireEvent.change(box, { target: { value: '21' } })
    fireEvent.blur(box)
    await settle()
    openTab('Style')
    expect(within(dialog()).getByTestId('chip-name').textContent).toBe(throughThePipeline({ period: 21 }).label)
  })

  it('the Style tab\'s precision is READ-ONLY, and says why — there is no per-instance store for it', () => {
    mount()
    openTab('Style')
    const cell = within(dialog()).getByTestId('chip-precision')
    // ⛔ NOT A CONTROL. `readout.chipsFrom` reads `plot.legend.decimals` off the
    // DEFINITION; `mergeSettingsOverride`'s instance branch is a shallow spread
    // (`instanceShape.js:71`) so a nested per-instance `legend` would be replaced
    // wholesale by a grid-cell override, and `readout.js` — the only reader — is
    // owned by another task. An editable box here would write nowhere, which is
    // the defect `indicatorRegistry` names: "a control that appears and writes
    // nowhere is a support ticket with no answer in it".
    expect(cell.querySelector('input,select,button')).toBeNull()
    expect(within(dialog()).getByTestId('chip-precision-why').textContent.length).toBeGreaterThan(20)
  })

  it('the Style tab carries the definition\'s own style inputs, derived from the plots\' $refs', () => {
    mount()
    openTab('Style')
    // rsi's line takes `color: '$color'`, so `color` is the style input. Derived
    // from `$refs`, never from a typed list of key names.
    expect(rowKeys()).toEqual(['color'])
    expect(screen.getByRole('button', { name: labelOf(rsiDef, 'color') })).toBeTruthy()
  })

  // 12. VISIBILITY — honest v1, from state the instance ALREADY carries.
  it('the Visibility tab carries the two facts the instance stores: hidden, and its placement target', async () => {
    mount()
    openTab('Visibility')
    const eye = screen.getByRole('switch', { name: /visible on the chart/i })
    expect(eye.getAttribute('aria-checked')).toBe('true')
    const move = screen.getByRole('combobox', { name: /move to/i })
    // Options are the schema's vocabulary, not a typed list.
    expect([...move.options].map((o) => o.value)).toEqual([...PLACEMENT_TARGETS])
    fireEvent.click(eye)
    await act(async () => {})
    expect(findInstance(latest(), RSI_INST).hidden).toBe(true)
  })

  it('Move writes placement.target on THIS instance, and nothing else', async () => {
    mount()
    openTab('Visibility')
    fireEvent.change(screen.getByRole('combobox', { name: /move to/i }), { target: { value: 'price' } })
    await act(async () => {})
    expect(findInstance(latest(), RSI_INST).placement).toEqual({ target: 'price' })
  })

  // 13. PER INSTANCE.
  it('opening on inst:rsi:1 shows THAT instance\'s period, not its sibling\'s', async () => {
    // Two live RSIs through the shipped doors: the legacy one at 14, the added
    // one edited to 7.
    let cs = rsiOn()
    cs = addInstance(cs, RSI, engineRegistry)
    const second = cs.indicatorInstances.filter((i) => i.defId === RSI && i.instanceId !== RSI_INST)[0].instanceId
    cs = setInstanceInput(cs, second, 'period', 7, engineRegistry)
    // ⚠️ READ THE *RESOLVED* VALUE, NOT `inputs.period`. `setIndicatorEnabled`
    // builds `legacy:rsi` with `inputsFromLegacy`, which stores NOTHING when the
    // legacy blob carries no override — "unset means the current default" is the
    // rule the migrator, the binder and `drawnValues` all use, so the legacy
    // instance's `inputs.period` is genuinely `undefined` while the chart draws
    // 14. A test asserting the stored key would have been asserting a shape the
    // product does not produce.
    expect(resolvedPeriod(cs, RSI_INST)).toBe(14)
    expect(resolvedPeriod(cs, second)).toBe(7)

    mount({ settings: cs, instanceId: second })
    expect(screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL }).value).toBe('7')
    cleanup()

    mount({ settings: cs, instanceId: RSI_INST })
    expect(screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL }).value).toBe('14')
  })

  it('editing one instance leaves its sibling\'s period alone', async () => {
    let cs = rsiOn()
    cs = addInstance(cs, RSI, engineRegistry)
    const second = cs.indicatorInstances.filter((i) => i.defId === RSI && i.instanceId !== RSI_INST)[0].instanceId
    mount({ settings: cs, instanceId: second })
    const box = screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL })
    fireEvent.change(box, { target: { value: '7' } })
    fireEvent.blur(box)
    await settle()
    expect(findInstance(latest(), second).inputs.period).toBe(7)
    // The sibling still RESOLVES to 14 — and its stored inputs were not written
    // at all, which is the stronger half: a per-DEFINITION write would have put
    // the 7 on both.
    expect(resolvedPeriod(latest(), RSI_INST)).toBe(14)
    expect(findInstance(latest(), RSI_INST).inputs.period).toBeUndefined()
  })

  // 14. PERSISTENCE — neither allow-list can eat what this writes.
  it('writes ONLY inside indicatorInstances: no new top-level key, no new nested object on the instance', async () => {
    mount()
    const beforeKeys = Object.keys(latest()).sort()
    const box = screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL })
    fireEvent.change(box, { target: { value: '21' } })
    fireEvent.blur(box)
    await settle()
    openTab('Visibility')
    fireEvent.click(screen.getByRole('switch', { name: /visible on the chart/i }))
    fireEvent.change(screen.getByRole('combobox', { name: /move to/i }), { target: { value: 'price' } })
    await act(async () => {})

    // ⛔ ALLOW-LIST #1 — `mergeChartSettings` (`chartDefaults.js:336`) is a hard
    // allow-list whose return literal DESTROYS an undeclared top-level key. That
    // mechanism deleted `engineEnabled` at seven sites.
    expect(Object.keys(latest()).sort()).toEqual(beforeKeys)
    // …and the same blob survives a real round-trip through it unchanged.
    const roundTripped = mergeChartSettings(JSON.stringify(latest()))
    expect(findInstance(roundTripped, RSI_INST).inputs.period).toBe(21)
    expect(findInstance(roundTripped, RSI_INST).hidden).toBe(true)
    expect(findInstance(roundTripped, RSI_INST).placement).toEqual({ target: 'price' })

    // ⛔ ALLOW-LIST #2 — `mergeSettingsOverride`'s instance branch
    // (`instanceShape.js:71`) is a SHALLOW spread with `inputs` the only
    // deep-merged child, so a NESTED object added to an instance is replaced
    // wholesale by a grid-cell override. Nothing here adds one: `inputs` is the
    // deep-merged child and `placement` is pre-existing and written by
    // `addInstance` in exactly this shape.
    const inst = findInstance(latest(), RSI_INST)
    const nested = Object.entries(inst).filter(([, v]) => v && typeof v === 'object')
    expect(nested.map(([k]) => k).sort()).toEqual(['inputs', 'placement'])
  })

  // 15. Refusals and absences.
  it('an instanceId that names no live instance renders nothing rather than an empty form', () => {
    mount({ instanceId: 'inst:rsi:404' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closed, it renders nothing and takes no snapshot to restore', () => {
    const initial = rsiOn()
    harness = { onChange: null, initial }
    render(<Harness initial={initial} instanceId={RSI_INST} registry={engineRegistry} open={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // 16. WHY THE MOUNT MUST NOT RE-STAMP `preset`.
  it('the write door marks the blob custom by itself, and Cancel takes that back too', async () => {
    const user = userEvent.setup()
    // `setIndicatorEnabled` already routes through `withInstances`, which stamps
    // `preset: 'custom'` — so a base built by it is ALREADY custom and would make
    // the control below vacuous. Reset it to whatever `mergeChartSettings` calls
    // the default, read from the system.
    const defaultPreset = mergeChartSettings(null).preset
    const base = { ...rsiOn(), preset: defaultPreset }
    mount({ settings: base })
    expect(latest().preset).not.toBe('custom')          // ⭐ CONTROL
    const box = screen.getByRole('spinbutton', { name: RSI_PERIOD_LABEL })
    fireEvent.change(box, { target: { value: '21' } })
    fireEvent.blur(box)
    await settle()
    // The DOOR stamps it (`instanceControls.withInstances`), which is precisely
    // why the StockChart mount must not stamp it again: a second stamp survives
    // the rollback and the byte-equality above stops holding.
    expect(latest().preset).toBe('custom')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(latest().preset).toBe(defaultPreset)
  })
})

// ─── THE STOCKCHART WIRING ──────────────────────────────────────────────────
//
// ⚠️ A COMMENT-STRIPPED SOURCE RAIL, AND THE REASON IS OWNERSHIP, NOT PREFERENCE.
// The mounted-DOM home for these claims is
// `engine/__tests__/stockChartWiring.test.jsx`, which another agent holds this
// session; editing it was refused rather than risked. So the claims are made
// structurally here, sliced BY NAME (never by line number — `inspect.getsource`'s
// line slice returned the wrong function mid-run this phase when a co-worker
// inserted 180 lines above it) and through the shipped stripper, so a scan cannot
// read prose as code or be defeated by a commented-out call.
describe('StockChart mounts the dialog on settingsInstanceId', () => {
  const RAW = STOCKCHART_SRC
  const SRC = stripComments(RAW)

  it('the stripper is neither a no-op nor a nuke — the control every scan below rests on', () => {
    expect(stripComments('/* X */ keep')).not.toMatch(/X/)
    expect(stripComments('a // X\nkeep')).not.toMatch(/X/)
    expect(stripComments('keep')).toMatch(/keep/)
    // …and on the REAL file: prose was removed (this file is heavily commented)
    // and code survived. Either half alone is satisfied by a broken stripper.
    expect(SRC.length).toBeLessThan(RAW.length * 0.9)
    expect(SRC).toMatch(/export default function StockChart/)
  })

  it('the region menu\'s "<label> settings…" routes at the per-instance dialog, not the global panel', () => {
    const i = SRC.indexOf("region.type === 'indicator'")
    expect(i).toBeGreaterThan(-1)
    const end = SRC.indexOf("region.type === 'overlay'", i)
    expect(end).toBeGreaterThan(i)
    const branch = SRC.slice(i, end)
    expect(branch).toMatch(/firstLiveInstanceId\(cs, key\)/)
    expect(branch).toMatch(/setSettingsInstanceId\(instId\)/)
    // …and the read-only gate is still `showDrawingTools`, so a Model Book or
    // grid-cell mount gets no row rather than one that writes nowhere.
    expect(branch).toMatch(/showDrawingTools && instId/)
  })

  it('the mount names the instance, and does NOT re-stamp the preset', () => {
    const i = SRC.indexOf('<IndicatorSettingsDialog')
    expect(i).toBeGreaterThan(-1)
    const mountJsx = SRC.slice(i, SRC.indexOf('/>', i))
    expect(mountJsx).toMatch(/instanceId=\{settingsInstanceId\}/)
    expect(mountJsx).toMatch(/registry=\{engineRegistry\}/)
    // Identity guard: a REFUSED write comes back as `cs` itself and must not persist.
    expect(mountJsx).toMatch(/next !== cs/)
    // ⛔ NO `preset` HERE. The doors already stamp it; a second stamp would outlive
    // the Cancel rollback, and the byte-equality is this task's whole gate.
    expect(mountJsx).not.toMatch(/preset/)
  })

  it('the resolver asks findInstance for liveness rather than re-deriving it', () => {
    const i = SRC.indexOf('function firstLiveInstanceId')
    expect(i).toBeGreaterThan(-1)
    const fn = SRC.slice(i, SRC.indexOf('\n}', i))
    // A tombstone is an element of `indicatorInstances` carrying the same `defId`;
    // taking it opens the dialog on an indicator that is not on the chart.
    expect(fn).toMatch(/findInstance\(cs, i\.instanceId\)/)
  })
})
