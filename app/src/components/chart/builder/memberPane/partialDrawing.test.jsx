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
  // ⚰️ 199 → 240 of 246, 2026-09-28 (C8). `time_close` became readable, so
  // its 40 `var label.new(time_close, …, "")` creates and their `set_x`/`set_y`
  // started converting — and every one of those labels would have been drawn
  // BLANK: their text is written by `label.set_text(rowN_label, rowN_text)`,
  // and `rowN_text` is built by `rowN_text := rowN_text + "#"` inside a `for`
  // this chart cannot fold (TradingView shows `####…`). Owner rule: never draw
  // something wrong. So an object whose text a lost setter writes is WITHHELD
  // and counted (`content:lost` 40, `content:withheld` 40), and `row0_text` —
  // which the object pass had been reading as its initial `""` past the
  // reassignment overrule — is refused like the other 39. What is drawn is the
  // two block lines; everything else is counted, never shown blank.
  { cls: 'partial objects-only (the owner\'s example)', script: 'poor-man039s-volume-profile__ZnFTCYyvGJ',
    objectsOnly: true, kind: 'partial', text: partial(240, 246), also: '`line.set_xloc`' },
  // 138 of 152 since the call-site inliner: `chart_pivot`'s drawing now runs at
  // each call site, and most of it sits behind guards this chart cannot read
  // (7 of 21 when the helper's body was walked once as top-level code). Its lost
  // `line.delete`s still remove nothing drawn.
  // 189 of 197 since C13 (2026-09-29): three `chart_pivot` calls sat under
  // input-only guards and were refused as conditional-history, so their bodies
  // never became ops; they are inlined now, and the setters inside them sit
  // behind guards this chart cannot read. The labels those setters write are
  // WITHHELD (`content:lost`) — before, two of them were drawn BLANK where
  // TradingView shows `PDH` / `PDL`. Same verdict: partial, drawn.
  // 195 of 203 since C16 (2026-09-29): its `line.delete(_hline.pop())` is read
  // as the two Pine operations it is — the delete AND the pop — so each of its
  // six lost deletes brings its lost pop with it (`guard:coll_pop`, six more
  // steps attempted and dropped). Same verdict: partial, drawn.
  { cls: 'partial objects-only, lost deletes remove nothing drawn', script: 'htf-liquidity-dashboard-tfo__ec8f8316a4',
    objectsOnly: true, kind: 'partial', text: partial(195, 203) },
  // ⭐ C16 (2026-09-29) — the corpus's bounded-eviction idiom, served whole:
  // `if array.size(rays) > maxRays` + `line.delete(array.shift(rays))`. This row
  // was the 'removal lost: a delete' fixture until the shift became a readable
  // target; that class keeps a fixture of its own below.
  { cls: 'clean objects-only, a bounded eviction (C16)', script: 'rsi-horizontal-resistance-levels__a3f8454f81',
    objectsOnly: true, kind: 'clean' },
  // ── partial with a removal, drawing-only: refused by name ────────────────
  { cls: 'removal lost: a delete', script: '(fixture: a delete under a guard this chart cannot read)',
    source: [
      '//@version=5',
      'indicator("lost delete", overlay = true)',
      'var line l = na',
      'if close > open',
      '    l := line.new(bar_index, close, bar_index + 1, close)',
      'if line.get_y1(l) * 2 > close',
      '    line.delete(l)',
    ].join(String.fromCharCode(10)),
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
  // ⚰️ 2026-09-28 (C8) — and sonarlab is no longer this row either. Its boxes
  // are placed at `bar_index[last_green]`, where `last_green = 0` is reassigned
  // inside a `for` the fold cannot read; the object pass used to read the
  // initial `0` past the reassignment overrule and put every box on the wrong
  // bar. The overrule now holds there too, no create converts, and the script
  // is refused as drawing nothing this chart can place (`pine:no-output`). The
  // class keeps a fixture shaped on sonarlab's own delete loop.
  // ⚰️ C16 (2026-09-29) — and that loop's bound `array.size(shortBoxes) - 1` IS
  // readable now (a drawing list's length is object state the runtime holds), so
  // the fixture's bound reads a NUMERIC array instead — `array.size(tops)`, a
  // value this chart still cannot hold — to keep the class it exists for.
  { cls: 'removal lost: a loop that deletes, its bound unreadable', script: '(fixture: sonarlab\'s delete loop)',
    source: [
      '//@version=5',
      'indicator("loop deletes", overlay = true, max_boxes_count = 500)',
      'var shortBoxes = array.new_box()',
      'var tops = array.new_float()',
      'if close > open',
      '    b = box.new(left=bar_index, top=high, bottom=low, right=bar_index + 1)',
      '    array.push(shortBoxes, b)',
      '    array.push(tops, high)',
      'for i = array.size(tops) - 1 to 0 by 1',
      '    sbox = array.get(shortBoxes, i)',
      '    if close > box.get_top(sbox)',
      '        array.remove(shortBoxes, i)',
      '        box.delete(sbox)',
    ].join(String.fromCharCode(10)),
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
  // ⚰️ 25 → 26, 2026-09-28 (C8). `bar_str = ""` is built by
  // `bar_str := bar_str + …` in a loop the fold cannot read; the object pass
  // read its initial `""` past the reassignment overrule and drew that cell
  // EMPTY. It is now refused and counted (`cell:text`), never written blank.
  // ⭐ 26 → 22, 2026-09-29 (C15, `8a9ce291f`). `mtfLabel(string tf) => switch
  // tf … => tf` is read as the `if` chain a ternary already produces, so the
  // four MTF column-label cells are carried — and they equal the vendor's
  // records on the RDDT 1D capture ("15m","1h","4h","1D"; tableCells 9 → 13,
  // nothing drawn the vendor lacks). Fewer unsupported, none drawn wrong.
  // ⭐ 22 → 17, 2026-09-29 (C10, fix-order step 20). The MTF panel's value
  // column: a timeframe below the chart's own is forced `— n/a` by a test that
  // folds on every bar, so the 15m/1h/4h requests it never shows are no longer
  // read (the object pass's dead-arm rescue), and the `D` request is read as the
  // chart's own through a six-hop preset chain. All five cells equal the
  // vendor's records ("◮ MIXED", "— n/a" ×3, "▼ BEAR"; tableCells 13 → 18).
  { cls: 'plots + partial', script: 'artemis-oscillator-pro__ea1097ca9e',
    // ⭐ 17 -> 7 on 2026-09-29 (C9, merged onto C14): `high[pivSpan]` folds like
    // a window, so ten divergence lines/labels convert — each TradingView's
    // (vendor harness). Measured on the merged tree.
    objectsOnly: false, kind: 'partial', text: partial(7, 38) },
  // ⚰️ 2026-09-28 — momentum-volatility-scanner WAS this row: `table.merge_cells`
  // was a name the reader never carried. It is carried now (and the script
  // matches TradingView on every object family), so it is a CLEAN row, and the
  // reader-name class keeps a fixture — no committed script shows it any more.
  { cls: 'clean plots + objects, completed by `table.merge_cells`', script: 'momentum-volatility-scanner__4d1deaa855',
    objectsOnly: false, kind: 'clean' },
  { cls: 'plots + partial the reader never carried', script: '(fixture: `line.set_xloc`)',
    source: [
      '//@version=5',
      'indicator("reader partial", overlay = true)',
      'plot(close)',
      'var line l = line.new(bar_index, close, bar_index + 1, close)',
      'line.set_xloc(l, time, time + 1, xloc.bar_time)',
    ].join(String.fromCharCode(10)),
    objectsOnly: false, kind: 'partial',
    text: /^This script uses `line\.set_xloc`, which this chart doesn't draw yet, so what it draws is incomplete\.$/ },
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
