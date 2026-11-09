// app/src/components/chart/__tests__/rsVisualVA5Inspector.test.jsx
//
// UCT RS Phase 2a VISUAL, unit VA5 (spec A6, inspector half). The Chart Settings
// Inspector reaches the settings dialog's parity for a definition that declares
// presets, groups and `activeWhen`:
//   1. the first CORE row is Preset, showing "Classic (O'Neil)" and its origin;
//   2. three group heads, Line and New highs collapsed on first open;
//   3. with Mansfield view off, `[data-field=mansfieldLength]`'s control has
//      aria-disabled="true" and its label the off class; toggling the view clears both;
//   4. no label is cut: the label rule carries no ellipsis (jsdom measures no
//      boxes, so `scrollWidth > clientWidth` is the browser half of this check);
//   5. no `__style__:dot*` rows (a plot with `restyle: false` offers no Plot style);
//   6. choosing Trend in the Inspector applies Trend through `applyPresetInputs`.
// And the control: a definition that declares none of it (RSI, MACD) renders the
// Inspector it always did — no Preset row, no head, nothing dimmed.
//
// ⚠️ `restyle: false` is VA2's to set on the RS dot plots (contract, "Plot restyle
// opt-out"). This suite does not wait for it: the registry's `getDefinition` is
// wrapped so `rsLine` carries the opt-out on every dot plot whether or not the
// definition already does, which is exactly the state after VA2 lands.
//
// ⭐ UCT RS 3-14 — the pins read the v4 definition (unit 3-08). Everything Phase 3
// adds is `requiresServer`, so each check runs TWICE where it differs: against a
// server that declares nothing new (`RS_V3_ENABLED` off; the inspector members
// had before Phase 3: six presets, no Reading, no Checks head, the three Phase 2
// line styles) and against a primed v4 row (`RS_V3_ENABLED` on: ten presets, the
// Reading select, the Checks head, the Phase 3 lines' styles).
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import ChartSettingsModal from '../ChartSettingsModal'
import { mergeChartSettings } from '../chartDefaults'
import * as registry from '../engine/nativeRegistry'
import { setIndicatorEnabled, findInstance, dotPlotsOf } from '../engine/instanceControls'
import { legacyInstanceId } from '../engine/instances'
import { styleInputKeys, hiddenPlotOnlyInputKeys, visiblePresets, visibleInputs } from '../indicatorRegistry'
import {
  primeServerDefinitions, clearServerDefinitions, serverDeclares, __setServerDefinitionsFetcherForTests,
} from '../engine/serverCompute'

vi.mock('../engine/nativeRegistry', async (importOriginal) => {
  const actual = await importOriginal()
  const cache = new Map()
  const withOptOut = (def) => {
    if (!def) return def
    if (cache.has(def)) return cache.get(def)
    const dots = new Set(def.plots.filter((p) => p.style === 'markers' || p.marker).map((p) => p.key))
    const next = { ...def, plots: def.plots.map((p) => (dots.has(p.key) ? { ...p, restyle: false } : p)) }
    cache.set(def, next)
    return next
  }
  return {
    ...actual,
    getDefinition: (id) => (id === 'rsLine' ? withOptOut(actual.getDefinition(id)) : actual.getDefinition(id)),
  }
})

beforeEach(() => { clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })
afterEach(() => { cleanup(); clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })

function Host({ initial, onSeen }) {
  const [cs, setCs] = useState(initial)
  return <ChartSettingsModal open settings={cs} onChange={(next) => { onSeen(next); setCs(next) }} onClose={() => {}} />
}
const show = (cs) => {
  const seen = { cs }
  render(<Host initial={cs} onSeen={(next) => { seen.cs = next }} />)
  fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
  return seen
}
const rows = () => [...document.body.querySelectorAll('[data-structure-row]')]
const nameOf = (r) => (r.querySelector('[class*="insRowName"]')?.textContent || '').trim()
const select = (re) => {
  const row = rows().find((r) => re.test(nameOf(r)))
  if (!row) throw new Error(`no structure row matches ${re}; rows: ${rows().map(nameOf).join(' | ')}`)
  fireEvent.click(row)
}
const inspector = () => document.body.querySelector('[data-inspector-for]')
const core = () => inspector().querySelector('[data-section="core"]')
const field = (key) => inspector().querySelector(`[data-field="${key}"]`)
const heads = () => [...inspector().querySelectorAll('[data-group] > button[aria-expanded]')]
const head = (name) => {
  const hits = heads().filter((b) => b.textContent.trim() === name)
  if (hits.length !== 1) throw new Error(`expected one head ${name}, found ${hits.length}`)
  return hits[0]
}
const presetSelect = () => field('__preset__').querySelector('select')

const RS = 'rsLine'
const RS_ID = legacyInstanceId(RS)
const RS_ROW = /^UCT/
const rsDef = () => registry.getDefinition(RS)
const preset = (id) => rsDef().meta.presets.find((p) => p.id === id)
const withRs = () => setIndicatorEnabled(mergeChartSettings({}), RS, true, registry)
/** A saved instance with these stored inputs (a v3 Trend layout, for one). */
const withRsInputs = (inputs) => {
  const cs = withRs()
  return {
    ...cs,
    indicatorInstances: cs.indicatorInstances.map((i) => (i.defId === RS ? { ...i, inputs: { ...i.inputs, ...inputs } } : i)),
  }
}
/** The v4 row as `/api/signature/definitions` publishes it with RS_V3_ENABLED on:
 *  every key the definition sends, each enum with its whole option list. */
const optionValue = (o) => (Array.isArray(o) ? o[0] : (o && typeof o === 'object' ? o.value : o))
const v4Body = () => ({
  definitions: [{
    id: RS,
    inputs: rsDef().meta.serverInputs.map((key) => {
      const spec = rsDef().inputs.find((i) => i.key === key)
      return spec && spec.type === 'enum' ? { key, options: spec.options.map(optionValue) } : { key }
    }),
  }],
})
const armV3 = () => { act(() => { primeServerDefinitions(v4Body()) }) }
// The inspector members had before Phase 3, and what the v4 row adds.
const V3_OFF_PRESETS = ['classic', 'classicWeekly', 'phase', 'trend', 'trendWeekly', 'stress']
const V3_ON_PRESETS = [...V3_OFF_PRESETS, 'rotation', 'rotationWeekly', 'quality', 'volAdjusted']

describe('A6.1 — the Preset row is the first CORE row', () => {
  it('reads Classic (O\'Neil) with its origin on a fresh instance; Custom is not offered while a preset matches', () => {
    show(withRs()); select(RS_ROW)
    const first = core().querySelector('[data-field]')
    expect(first.getAttribute('data-field')).toBe('__preset__')
    expect(first.querySelector('[class*="insFieldLabel"]').textContent).toBe('Preset')
    const sel = presetSelect()
    expect(sel.value).toBe('classic')
    expect(sel.options[sel.selectedIndex].textContent).toBe('Classic (O\'Neil)')
    // v4 (3-08): the four Phase 3 presets are `requiresServer`; nothing declared lists the six.
    expect([...sel.options].map((o) => o.value)).toEqual(V3_OFF_PRESETS)
    expect(V3_OFF_PRESETS).toEqual(visiblePresets(rsDef(), null).map((p) => p.id))
    const origin = within(inspector()).getByTestId('preset-origin')
    expect(origin.textContent).toBe(preset('classic').origin)
    expect(sel.getAttribute('aria-describedby')).toBe(origin.id)
    expect(within(field('__preset__')).getByRole('button', { name: 'Reset to preset' })).toBeEnabled()
  })

  it('a v4 row (RS_V3_ENABLED on) lists all ten, the Phase 3 readings after the six', () => {
    show(withRs()); select(RS_ROW)
    armV3()
    expect([...presetSelect().options].map((o) => o.value)).toEqual(V3_ON_PRESETS)
    expect(V3_ON_PRESETS).toEqual(rsDef().meta.presets.map((p) => p.id))
    expect(presetSelect().value).toBe('classic')
  })

  it('choosing Trend applies Trend through applyPresetInputs: its inputs, its dot size and its visibility', () => {
    const seen = show(withRs()); select(RS_ROW)
    fireEvent.change(presetSelect(), { target: { value: 'trend' } })
    const inst = findInstance(seen.cs, RS_ID)
    for (const [k, v] of Object.entries(preset('trend').inputs)) expect(inst.inputs[k], k).toBe(v)
    // 2026-11-07: the definition unit (VA2) moved Trend to Mansfield view with its
    // cross dot at the DEFAULT size; the writer stores nothing for 'medium', so the
    // expectation is read from the preset instead of a literal.
    const ds = preset('trend').dotSize
    if (typeof ds === 'string' && ds !== 'medium') expect(inst.presentation && inst.presentation.dotSize).toBe(ds)
    else if (ds && typeof ds === 'object') {
      for (const [plotKey, word] of Object.entries(ds)) {
        const stored = inst.presentation && inst.presentation.plots && inst.presentation.plots[plotKey]
        if (word === 'medium') expect(stored && stored.dotSize, plotKey).toBeUndefined()
        else expect(stored && stored.dotSize, plotKey).toBe(word)
      }
    }
    expect(inst.visibility).toEqual({ preset: 'dailyUp' })
    expect(seen.cs.preset).toBe('custom')
    expect(presetSelect().value).toBe('trend')
    expect(within(inspector()).getByTestId('preset-origin').textContent).toBe(preset('trend').origin)
  })

  it('a tweak reads Custom (the option appears, no origin); Reset to preset puts the last preset back', () => {
    const seen = show(withRs()); select(RS_ROW)
    fireEvent.change(field('maLength').querySelector('input'), { target: { value: '30' } })
    expect(findInstance(seen.cs, RS_ID).inputs.maLength).toBe(30)
    expect(presetSelect().value).toBe('__custom')
    expect(field('__preset__').dataset.preset).toBe('__custom')
    expect(within(inspector()).queryByTestId('preset-origin')).toBeNull()
    // Choosing Custom is a state, not a write.
    const before = seen.cs
    fireEvent.change(presetSelect(), { target: { value: '__custom' } })
    expect(seen.cs).toBe(before)
    fireEvent.click(within(field('__preset__')).getByRole('button', { name: 'Reset to preset' }))
    expect(findInstance(seen.cs, RS_ID).inputs.maLength).toBe(21)
    expect(presetSelect().value).toBe('classic')
  })
})

describe('A6.2 — CORE renders the declared groups; Simple open, the hinted groups collapsed (VA2, v4)', () => {
  // VA2: the plan's five folded groups (§6.3); v4 (3-08) folds Checks too, whose
  // one input (the anchor date) is `requiresServer`, so its head waits for the row.
  const folded = ['Line', 'New highs', 'Rating', 'Stress test', 'Method', 'Checks']
  it('six heads in declaration order with nothing declared, hinted ones folded, bodies unmounted while folded', () => {
    show(withRs()); select(RS_ROW)
    expect(rsDef().meta.groupsCollapsed).toEqual(folded)
    expect(heads().map((b) => b.textContent.trim())).toEqual(['Simple', ...folded.filter((g) => g !== 'Checks')])
    expect(head('Simple').getAttribute('aria-expanded')).toBe('true')
    for (const g of folded.filter((x) => x !== 'Checks')) expect(head(g).getAttribute('aria-expanded'), g).toBe('false')
    expect(field('benchmark')).not.toBeNull()
    expect(field('maType')).toBeNull()
    expect(field('lookback')).toBeNull()
    for (const h of heads()) {
      expect(h.tagName).toBe('BUTTON')
      expect(h.getAttribute('type')).toBe('button')
      expect(h.getAttribute('aria-controls')).toBeTruthy()
      expect(h.closest('[data-section="core"]')).toBeTruthy()
    }
    expect(field('view')).toBeNull()
  })

  it('a v4 row adds the Checks head (folded) and the Reading select in Simple', () => {
    show(withRs()); select(RS_ROW)
    armV3()
    expect(heads().map((b) => b.textContent.trim())).toEqual(['Simple', ...folded])
    expect(head('Checks').getAttribute('aria-expanded')).toBe('false')
    expect(field('view')).not.toBeNull()
    const body = document.getElementById(head('Simple').getAttribute('aria-controls'))
    expect(body.contains(field('view'))).toBe(true)
  })

  it('a head toggles its body; Display and Visibility stay ungrouped at the end of CORE', () => {
    show(withRs()); select(RS_ROW)
    fireEvent.click(head('Line'))
    expect(head('Line').getAttribute('aria-expanded')).toBe('true')
    expect(field('maType')).not.toBeNull()
    const body = document.getElementById(head('Line').getAttribute('aria-controls'))
    expect(body.contains(field('maType'))).toBe(true)
    expect(head('New highs').getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(head('Line'))
    expect(field('maType')).toBeNull()
    for (const key of ['__display__', '__visibility__']) {
      const el = field(key)
      if (!el) continue
      expect(el.closest('[data-group]'), key).toBeNull()
      expect(el.closest('[data-section="core"]'), key).toBeTruthy()
    }
    expect(field('__visibility__')).not.toBeNull()
  })
})

describe('A6.3 — activeWhen dims, never removes', () => {
  const ctl = () => field('mansfieldLength').querySelector('input')
  const label = () => field('mansfieldLength').querySelector('[class*="insFieldLabel"]')
  const expectInert = () => {
    expect(ctl().getAttribute('aria-disabled')).toBe('true')
    expect(ctl()).toBeDisabled()
    expect(label().className).toMatch(/indLabelOff/)
    expect(field('mansfieldLength').dataset.active).toBe('false')
    expect(label().textContent).toBe('Mansfield (bars)')
  }
  const expectAwake = () => {
    expect(ctl().hasAttribute('aria-disabled')).toBe(false)
    expect(ctl()).toBeEnabled()
    expect(label().className).not.toMatch(/indLabelOff/)
    expect(field('mansfieldLength').dataset.active).toBe('true')
  }

  it('nothing declared: no Reading, the legacy switch instead; Mansfield (bars) is inert under the RS line and wakes under Trend', () => {
    const seen = show(withRs()); select(RS_ROW)
    fireEvent.click(head('Method'))
    // v4: `view` waits for the row. ⭐ 3-14: until it is declared, the legacy
    // `showMansfield` switch is the control this server reads, so it renders.
    expect(field('showMansfield')).not.toBeNull()
    expect(field('showMansfield').querySelector('[class*="insFieldLabel"]').textContent).toBe('Mansfield view')
    expect(field('view')).toBeNull()
    expectInert()
    fireEvent.change(presetSelect(), { target: { value: 'trend' } })
    expect(findInstance(seen.cs, RS_ID).inputs.view).toBe('mansfield')
    expect(findInstance(seen.cs, RS_ID).inputs.showMansfield).toBe(true)
    expectAwake()
  })

  it('⭐ 3-14 — nothing declared: the Mansfield view switch writes showMansfield and wakes Mansfield (bars)', () => {
    const seen = show(withRs()); select(RS_ROW)
    fireEvent.click(head('Method'))
    expectInert()
    const sw = field('showMansfield').querySelector('[role="switch"], input[type="checkbox"], button')
    expect(sw).not.toBeNull()
    fireEvent.click(sw)
    expect(findInstance(seen.cs, RS_ID).inputs.showMansfield).toBe(true)
    expect(findInstance(seen.cs, RS_ID).inputs).not.toHaveProperty('view')
    expectAwake()
  })

  it('⭐ 3-14 — a v4 row: the switch is gone, the Reading replaces it', () => {
    show(withRs()); select(RS_ROW)
    armV3()
    fireEvent.click(head('Method'))
    expect(field('showMansfield')).toBeNull()
    expect(field('view')).not.toBeNull()
  })

  it('a saved v3 Trend layout (showMansfield: true, no view) reads as the Mansfield reading (3-08b)', () => {
    show(withRsInputs({ showMansfield: true })); select(RS_ROW)
    fireEvent.click(head('Method'))
    expectAwake()
  })

  it('a v4 row: the Reading select wakes it on the same change, and the RS line dims it again', () => {
    const seen = show(withRs()); select(RS_ROW)
    armV3()
    fireEvent.click(head('Method'))
    expectInert()
    fireEvent.change(field('view').querySelector('select'), { target: { value: 'mansfield' } })
    expect(findInstance(seen.cs, RS_ID).inputs.view).toBe('mansfield')
    expectAwake()
    fireEvent.change(field('view').querySelector('select'), { target: { value: 'ratio' } })
    expectInert()
  })
})

describe('A6.4 — no label is cut', () => {
  it('the Inspector label rule declares no ellipsis and no clipping', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/chart/ChartSettingsModal.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = /\.insFieldLabel\s*\{([^}]*)\}/.exec(css)
    expect(rule).toBeTruthy()
    expect(rule[1]).not.toMatch(/text-overflow:\s*ellipsis/)
    expect(rule[1]).not.toMatch(/overflow:\s*hidden/)
    expect(rule[1]).not.toMatch(/white-space:\s*nowrap/)
  })

  const allLabels = (groups, declaredRow) => {
    for (const g of groups) fireEvent.click(head(g))
    const declared = new Map(rsDef().inputs.map((i) => [i.key, i.label]))
    let seen = 0
    for (const el of inspector().querySelectorAll('[data-field]')) {
      const key = el.getAttribute('data-field')
      if (!declared.has(key)) continue
      expect(el.querySelector('[class*="insFieldLabel"]').textContent, key).toBe(declared.get(key))
      seen += 1
    }
    // v4: a surface renders `visibleInputs` (a legacy input never, a gated one once declared).
    expect(seen).toBe(visibleInputs(rsDef(), declaredRow).length)
    return seen
  }

  it('every rendered label prints its whole declared text, nothing declared', () => {
    show(withRs()); select(RS_ROW)
    const seen = allLabels(['Line', 'New highs', 'Rating', 'Stress test', 'Method'], null)
    // ⭐ 3-14: plus the legacy Mansfield view switch, shown while `view` is undeclared.
    expect(seen).toBe(rsDef().inputs.filter((i) => !i.legacy && !i.requiresServer).length + 1)
  })

  it('every rendered label prints its whole declared text under a v4 row', () => {
    show(withRs()); select(RS_ROW)
    armV3()
    const seen = allLabels(['Line', 'New highs', 'Rating', 'Stress test', 'Method', 'Checks'], serverDeclares(RS))
    expect(seen).toBe(rsDef().inputs.filter((i) => !i.legacy).length)
  })

  it('a group head is 28px tall on a mouse and a 44px target under a coarse pointer', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/chart/ChartSettingsModal.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(/\.insGroupHead\s*\{[^}]*min-height:\s*28px/.test(css)).toBe(true)
    const coarse = css.slice(css.indexOf('@media (max-width: 1024px) and (pointer: coarse)'))
    expect(/\.insGroupHead\s*\{[^}]*min-height:\s*var\(--tap-min/.test(coarse)).toBe(true)
  })
})

describe('A6.5 — a plot with restyle: false offers no Plot style row', () => {
  const styleKeysNow = () => [...inspector().querySelectorAll('[data-field^="__style__:"]')]
    .map((el) => el.getAttribute('data-field').slice('__style__:'.length))

  it('no __style__ row for any RS dot plot; the three lines keep theirs; Dot size stays', () => {
    show(withRs()); select(RS_ROW)
    const styleKeys = styleKeysNow()
    const dotKeys = dotPlotsOf(rsDef()).map((p) => p.key)
    expect(dotKeys.length).toBeGreaterThan(0)
    for (const k of dotKeys) expect(styleKeys, k).not.toContain(k)
    expect(styleKeys.some((k) => k.startsWith('dot'))).toBe(false)
    // 3-14: the Phase 3 lines are `requiresServer` plots; nothing declared shows the Phase 2 three.
    expect(styleKeys).toEqual(['rsLine', 'rsMa', 'mansfield'])
    expect(field('__dotSize__')).not.toBeNull()
  })

  it('a v4 row adds the Phase 3 lines after the three, still no dot style', () => {
    show(withRs()); select(RS_ROW)
    armV3()
    // + the RS Rating Reading's two lines (rev 5, Deepvue round 2)
    expect(styleKeysNow()).toEqual(['rsLine', 'rsMa', 'mansfield', 'rsRatio', 'rsMomentum', 'clenowScore', 'vars', 'varsMa',
      'ratingLine', 'ratingMa'])
    expect(styleKeysNow().some((k) => k.startsWith('dot'))).toBe(false)
    expect(field('__dotSize__')).not.toBeNull()
  })
})

// ─── THE CONTROL: definitions that declare none of this render what they did ───

describe('control — RSI and MACD are unchanged', () => {
  const coreInputKeys = (def) => {
    const look = styleInputKeys(def)
    const inert = hiddenPlotOnlyInputKeys(def)
    return def.inputs.filter((i) => i.type !== 'color' && !look.has(i.key) && !inert.has(i.key)).map((i) => i.key)
  }
  for (const [id, re] of [['rsi', /^Relative Strength Index|^RSI/], ['macd', /^MACD|^Moving Average Convergence/]]) {
    it(`${id}: no Preset row, no group head, nothing dimmed, CORE inputs in declaration order`, () => {
      show(setIndicatorEnabled(mergeChartSettings({}), id, true, registry)); select(re)
      const def = registry.getDefinition(id)
      expect(def.meta.presets).toBeUndefined()
      expect(field('__preset__')).toBeNull()
      expect(inspector().querySelector('[data-group]')).toBeNull()
      expect(inspector().querySelector('[data-active]')).toBeNull()
      expect(inspector().querySelector('[aria-disabled="true"]')).toBeNull()
      const keys = [...core().querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field'))
        .filter((k) => !k.startsWith('__'))
      expect(keys).toEqual(coreInputKeys(def))
    })
  }

  it('macd keeps a Plot style row for every restyleable output', () => {
    show(setIndicatorEnabled(mergeChartSettings({}), 'macd', true, registry)); select(/^MACD|^Moving Average Convergence/)
    const def = registry.getDefinition('macd')
    expect(def.plots.every((p) => p.restyle !== false)).toBe(true)
    const styleRows = inspector().querySelectorAll('[data-field^="__style__"]')
    expect(styleRows.length).toBeGreaterThan(1)
  })
})
