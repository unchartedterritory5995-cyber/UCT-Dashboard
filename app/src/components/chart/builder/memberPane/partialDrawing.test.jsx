// app/src/components/chart/builder/memberPane/partialDrawing.test.jsx
//
// ─── ⭐⭐ THE PARTIAL-DRAWING RULE AT THE MEMBER DOOR — owner ruling 2026-09-27 ─
//
// Option (b), verbatim in intent:
//   1. an object program that lost a REMOVAL (a delete, a table clear, anything
//      whose loss leaves on screen an object Pine removed) is REFUSED by name when
//      the drawing is all the script has, and WITHHELD — plots only, with a
//      sentence — when it also plots;
//   2. any other partial program attaches WITH "N of M drawing elements in this
//      script aren't supported yet";
//   3. a clean object program, and a plot-only script, are unchanged.
//
// ⛔ A TABLE OVER REAL COMMITTED CORPUS SCRIPTS, and every sentence is asserted as
// RENDERED DOM TEXT — the repo rule: feedback that never reaches the screen is the
// half that fails silently. `ChartPane` is mocked (as `MemberPane.test.jsx` does),
// so pixels are out of scope; the document handed to it is not.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import * as engineRegistry from '../../engine/nativeRegistry'
import { memberPaneDefinition } from './memberPaneDefinition'
import MemberPane from './MemberPane.jsx'

const paneProps = []
vi.mock('../../pane/ChartPane', () => ({
  default: (props) => { paneProps.push(props); return <div data-testid="mock-chart-pane" /> },
}))

const REPO = path.resolve(process.cwd(), '..')
const corpus = (name) => fs.readFileSync(path.join(REPO, 'corpus', 'committed', `${name}.pine`), 'utf8')
const DEF_ID = 'u_member-pane-partial'

const REMOVAL_REFUSAL = /^This script's drawing can't be shown yet\. It removes drawings as it runs, and this chart can't follow part of that \((.+)\), so drawing the rest would leave lines, labels, boxes or table cells on screen that TradingView would have removed\.$/
const WITHHELD = /^This script's plots are shown, but its drawings are not\. It removes drawings as it runs, and this chart can't follow part of that \((.+)\), so showing them would leave lines, labels, boxes or table cells on screen that TradingView would have removed\.$/
const partial = (n, m) => new RegExp(`^${n} of ${m} drawing elements in this script aren't supported yet, so what it draws is incomplete\\. \\(The ${m} are every drawing step this chart tried to carry`)

/**
 * The table. `objectsOnly` is the VITE_PINE_OBJECTS_ONLY_PANE_ENABLED flag.
 * `expect.kind`: 'refused' | 'withheld' | 'partial' | 'clean'.
 */
const CASES = [
  // ── clean: unchanged ──────────────────────────────────────────────────────
  { cls: 'clean objects-only', script: 'makuchaku039s-trade-tools-fair-value-gaps__b951deedc8',
    objectsOnly: true, kind: 'clean' },
  { cls: 'clean plots + objects', script: 'liquidity-pools__fa7b28e733',
    objectsOnly: false, kind: 'clean' },
  { cls: 'plot-only', script: 'donchian-channels__5df15aaa23',
    objectsOnly: false, kind: 'clean', noObjects: true },
  // ── partial, nothing removed: drawn, disclosed ───────────────────────────
  { cls: 'partial objects-only (the owner\'s example)', script: 'poor-man039s-volume-profile__ZnFTCYyvGJ',
    objectsOnly: true, kind: 'partial', text: partial(199, 246), also: '`line.set_xloc`' },
  // 138 of 152 since the call-site inliner: `chart_pivot`'s drawing now runs at
  // each call site, and most of it sits behind guards this chart cannot read
  // (7 of 21 when the helper's body was walked once as top-level code). Its lost
  // `line.delete`s still remove nothing drawn.
  { cls: 'partial objects-only, lost deletes remove nothing drawn', script: 'htf-liquidity-dashboard-tfo__ec8f8316a4',
    objectsOnly: true, kind: 'partial', text: partial(138, 152) },
  // ── partial with a removal, drawing-only: refused by name ────────────────
  { cls: 'removal lost: a delete', script: 'rsi-horizontal-resistance-levels__a3f8454f81',
    objectsOnly: true, kind: 'refused', what: 'a delete' },
  { cls: 'removal lost: a table clear', script: 'strong-start-rvol-dashboard__36140b1cbe',
    objectsOnly: true, kind: 'refused', what: 'a table clear' },
  // ⚰️ 2026-09-28 — sonarlab WAS the "lost BEFORE conversion" row: its delete
  // loops are `for … by 1`, which the reader used to block whole (a reader-level
  // loss, zero dropReasons). The loop op carries a `by` step now, so the loops
  // are READ — and their bound `array.size(shortBoxes) - 1` cannot be, so the
  // loss is now a counted `loop:bounds` drop whose body deletes. Same verdict
  // (refused), a truer phrase. The before-conversion class keeps its own
  // fixture below, because no committed script exhibits it any more.
  { cls: 'removal lost: a loop that deletes, its bound unreadable', script: 'sonarlab-order-blocks__0df0d45ee6',
    objectsOnly: true, kind: 'refused', what: 'a loop that deletes' },
  { cls: 'removal lost BEFORE conversion (zero dropReasons)', script: '(fixture: a `while` that deletes)',
    source: [
      '//@version=5',
      'indicator("before conversion", overlay = true)',
      'var label lb = label.new(bar_index, high, "x")',
      'i = 0',
      'while i < 1',
      '    label.delete(lb)',
      '    i += 1',
    ].join(String.fromCharCode(10)),
    zeroDropReasons: true,
    objectsOnly: true, kind: 'refused', what: 'a delete' },
  // ── plots + partial: drawn, disclosed ─────────────────────────────────────
  // ⚰️ 24 → 25, 2026-09-27 (H14). `int kSize = array.size(knnF1)` read a `var`
  // array that `array.push` grows inside an `if` at line 471, and the host walk
  // folded it to its CREATION size, 0 — so the element built from it drew with a
  // number the script never has. It now refuses, and is counted, not drawn.
  { cls: 'plots + partial', script: 'artemis-oscillator-pro__ea1097ca9e',
    objectsOnly: false, kind: 'partial', text: partial(25, 38) },
  { cls: 'plots + partial the reader never carried', script: 'momentum-volatility-scanner__4d1deaa855',
    objectsOnly: false, kind: 'partial',
    text: /^This script uses `table\.merge_cells`, which this chart doesn't draw yet, so what it draws is incomplete\.$/ },
  // ── plots + a removal lost: plots drawn, drawings withheld, said so ───────
  // ⚠️ Since the call-site inliner this corpus row's program is EMPTY (all 7 of
  // its drawing steps are refused calls to its own helpers), so it proves the
  // SENTENCE and not the withholding; `plots + removal lost, with a real program`
  // below is the case that can tell withheld from drawn.
  { cls: 'plots + removal lost in a refused helper', script: 'trend-lines-supports-and-resistances__413ee2ee3b',
    objectsOnly: false, kind: 'withheld', what: 'a function of its own that deletes' },
  // ⭐ 2026-09-27 — was the `withheld` row (its `line.delete(sup[1])`s were
  // dropped). A drawing variable's history (`{r:'reg', back:1}`) completes it.
  { cls: 'clean plots + objects, completed by `line.delete(sup[1])`', script: 'fibonacci-pivot-points-cc__p8DQ3RIR97',
    objectsOnly: false, kind: 'clean' },
]

const setMemberPane = (v) => {
  if (v === undefined) delete import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED
  else import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED = v
}

beforeEach(() => { paneProps.length = 0; setMemberPane('1') })
afterEach(() => {
  cleanup()
  setMemberPane(undefined)
  vi.unstubAllEnvs()
  engineRegistry.uninstallUserDefinition(DEF_ID)
})

const drawingItems = () => {
  const list = screen.queryByTestId('pine-member-pane-notes')
  return list ? [...list.querySelectorAll('li')].map((li) => li.textContent) : []
}

describe.each(CASES)('$cls — $script', (c) => {
  it(`door verdict and the rendered sentence (${c.kind})`, () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', c.objectsOnly ? '1' : '')
    const source = c.source || corpus(c.script)
    const door = memberPaneDefinition({ source, id: DEF_ID })
    render(<MemberPane sym="SPY" tf="D" source={source} defId={DEF_ID} />)
    // ⭐ The class is DEFINED by the drop ledger being empty — assert it, or a
    // fixture that drifted into a counted drop would still pass as this class.
    if (c.zeroDropReasons) expect(door.translation.objectDiagnostics.dropReasons).toEqual({})

    if (c.kind === 'refused') {
      expect(door.ok).toBe(false)
      expect(door.guard).toBe('pine:object-removal-lost')
      const shown = screen.getByTestId('pine-member-pane-refusal').textContent
      const m = shown.match(REMOVAL_REFUSAL)
      expect(m, shown).toBeTruthy()
      expect(m[1]).toBe(c.what)
      expect(screen.queryByTestId('pine-member-pane')).toBeNull()
      expect(paneProps).toHaveLength(0)
      return
    }

    expect(door.ok, door.reason || '').toBe(true)
    expect(screen.getByTestId('pine-member-pane')).toBeTruthy()
    // ⛔ WHAT THE PANE WAS HANDED IS THE DOCUMENT UNDER TEST — the installed row.
    const installed = engineRegistry.getDefinition(DEF_ID)
    expect(installed, 'the pane installed nothing').toBeTruthy()
    const drawings = drawingItems().filter((t) => /drawing|doesn't draw yet/.test(t))

    if (c.kind === 'clean') {
      expect(drawings).toEqual([])
      if (c.noObjects) expect(installed.objects || null).toBe(null)
      else expect(installed.objects && installed.objects.ops.length).toBeGreaterThan(0)
      return
    }
    if (c.kind === 'withheld') {
      expect(installed.objects || null).toBe(null)
      expect(installed.plots.some((p) => !p.hidden)).toBe(true)
      expect(drawings).toHaveLength(1)
      const m = drawings[0].match(WITHHELD)
      expect(m, drawings[0]).toBeTruthy()
      expect(m[1]).toBe(c.what)
      return
    }
    // partial
    expect(drawings).toHaveLength(1)
    expect(drawings[0]).toMatch(c.text)
    if (c.also) expect(drawings[0]).toContain(`It also uses ${c.also}, which this chart doesn't draw yet.`)
    // ⭐ DRAWN: a partial program still reaches the pane, it is not withheld.
    const lossyWithOps = !!(door.translation.objects && door.translation.objects.ops.length)
    if (lossyWithOps) expect(installed.objects && installed.objects.ops.length).toBeGreaterThan(0)
  })
})

describe('plots + removal lost, with a real program — the drawing is WITHHELD, not drawn', () => {
  // ⛔ No committed corpus script has this shape since the call-site inliner (the
  // only plotting script that loses a removal has an empty program), so a
  // fixture that can tell "withheld" from "drawn" is written here: a drawn
  // label, and its delete behind a condition this chart cannot read.
  const SOURCE = [
    '//@version=6',
    'indicator("withheld", overlay = true)',
    'var label lb = label.new(bar_index, high, "x")',
    'if weird_unreadable_fn(close)',
    '    label.delete(lb)',
    'plot(close)',
  ].join('\n')

  it('plots drawn, objects null although the program has ops, the sentence rendered', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '')
    const door = memberPaneDefinition({ source: SOURCE, id: DEF_ID })
    expect(door.ok, door.reason || '').toBe(true)
    // non-vacuity: there IS a program to withhold
    expect(door.translation.objects && door.translation.objects.ops.length).toBeGreaterThan(0)
    render(<MemberPane sym="SPY" tf="D" source={SOURCE} defId={DEF_ID} />)
    const installed = engineRegistry.getDefinition(DEF_ID)
    expect(installed.objects || null).toBe(null)
    expect(installed.plots.some((p) => !p.hidden)).toBe(true)
    const drawings = drawingItems().filter((t) => /drawing/.test(t))
    expect(drawings).toHaveLength(1)
    const m = drawings[0].match(WITHHELD)
    expect(m, drawings[0]).toBeTruthy()
    expect(m[1]).toBe('a delete')
  })

  // ⭐ INTEGRATION (2026-09-27): the object-pass branch adds the inputs an object
  // tree reads to the document (`withObjectInputs`) — an input DECLARED by a
  // declined row (the alertcondition here) and read by the label. When the
  // drawing is withheld that input moves nothing on the chart, so it must not be
  // offered as a knob. Control: the same script with no lost removal draws the
  // label AND declares the input.
  const withInput = (removalLost) => [
    '//@version=6',
    'indicator("withheld inputs", overlay = true)',
    'len = input.int(5, "Len")',
    'var label lb = label.new(bar_index, high + len, "x")',
    removalLost ? 'if weird_unreadable_fn(close)' : 'if close > open',
    removalLost ? '    label.delete(lb)' : '    label.set_text(lb, "y")',
    'plot(close)',
    'alertcondition(close > len, "A", "a")',
  ].join('\n')
  const inputKeys = (d) => (d.definition.inputs || []).map((i) => i.key)

  it('a withheld drawing brings none of its own inputs into the document', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '')
    const withheld = memberPaneDefinition({ source: withInput(true), id: DEF_ID })
    const drawn = memberPaneDefinition({ source: withInput(false), id: `${DEF_ID}-c` })
    expect(withheld.ok && drawn.ok).toBe(true)
    // both translations declare `len` — the difference is only the door's
    expect(withheld.translation.declared).toContain('len')
    expect(drawn.translation.declared).toContain('len')
    expect(drawn.definition.objects).toBeTruthy()
    expect(inputKeys(drawn)).toContain('len')
    expect(withheld.definition.objects || null).toBe(null)
    expect(inputKeys(withheld)).not.toContain('len')
  })
})

describe('⛔ flag OFF, a drawing-only script is still refused with the sentence it always had', () => {
  // ⚰️ 2026-09-28 — re-pointed from sonarlab-order-blocks, whose host
  // translation is no longer clean (its `for … by 1` delete loops are read now,
  // and their array bounds are not), so its flag-OFF refusal is the
  // objects-only sentence every lossy drawing-only script gets. This row is
  // about a CLEAN drawing-only script meeting the flag switched off.
  it('makuchaku fair-value-gaps (clean, drawing-only): no pane, the pre-existing refusal, nothing drawn', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '')
    const source = corpus('makuchaku039s-trade-tools-fair-value-gaps__b951deedc8')
    render(<MemberPane sym="SPY" tf="D" source={source} defId={DEF_ID} />)
    expect(screen.getByTestId('pine-member-pane-refusal').textContent)
      .toBe('this script declares nothing a chart can draw')
    expect(paneProps).toHaveLength(0)
  })
})
