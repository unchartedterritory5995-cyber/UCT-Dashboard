// @vitest-environment node
// app/src/components/chart/builder/memberPane/runtimeFamilyLedger.test.js
//
// ─── ⭐⭐ THE FAMILY LEDGER'S RAILS (coordinator ruling 2026-11-19) ─────────────────────────────────────────────
//
// THE CLASS: a document drawn bar by bar draws, or NAMES, every family its script declares. Three layers:
//   1. the vocabulary is the engine's own (`pine.js::CHART_DRAWING_CALLS`, the object families) and every member of it
//      has the member's word, so a family the engine gains cannot leave the ledger silently;
//   2. the scanner reads a declaration where the script writes one, and nowhere else (comments, strings, a method or a
//      function of the author's own);
//   3. THE CLASS RAIL, over every corpus script the runtime lane draws: what the source declares is drawn by the
//      DOCUMENT (its rows, its paints, its drawings), named by a NOTE, or hidden by its author. Read off the document and
//      the notes the member gets, never off the door's own ledger, so the door cannot grade itself.
// Mutation-proved: `ci/mutants/runtime-family-ledger.json`.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { CHART_DRAWING_CALLS } from '../../engine/ast/pine'
import { DRAWING_NOTE_NAME } from '../../engine/ast/objectLoss'
import { OHLC_DEF_STYLES } from '../../engine/defSchema'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'
import { __admitEveryRunHalfForTests } from '../../engine/runHalfRailSeam'
import {
  OBJECT_DRAWING_FAMILIES, FAMILY_WORDS, declaredFamiliesOf, authorHiddenFamiliesOf, runtimeFamilyLedger,
} from './runtimeFamilyLedger'
import { memberPaneDefinition, RUNTIME_UNDRAWN_KINDS, familyWord } from './memberPaneDefinition'

const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const v5 = (body) => `//@version=5\nindicator("ledger rail", overlay = true)\n${body}\n`

describe('1. the vocabulary is the engine\'s, and every member of it has a word', () => {
  it('the chart-drawing calls are derived: every output call, both candles, the chart-only calls, less the two that draw nothing', () => {
    for (const c of ['plot', 'plotshape', 'plotchar', 'plotarrow', 'plotcandle', 'plotbar', 'hline', 'fill', 'bgcolor', 'barcolor']) {
      expect(CHART_DRAWING_CALLS, c).toContain(c)
    }
    expect(CHART_DRAWING_CALLS).not.toContain('alertcondition')
    expect(CHART_DRAWING_CALLS).not.toContain('alert')
    expect(OBJECT_DRAWING_FAMILIES).toEqual(expect.arrayContaining(['line', 'label', 'box', 'table', 'linefill', 'polyline']))
  })
  it('every family has ONE member\'s word (the door\'s four, the ledger\'s rest), and no word names a family the vocabulary lacks', () => {
    const vocab = [...CHART_DRAWING_CALLS, ...OBJECT_DRAWING_FAMILIES]
    for (const f of vocab) expect(typeof familyWord(f), f).toBe('string')
    const door = Object.keys(RUNTIME_UNDRAWN_KINDS)
    expect(Object.keys(FAMILY_WORDS).filter((k) => door.includes(k))).toEqual([])
    expect([...door, ...Object.keys(FAMILY_WORDS)].sort()).toEqual([...new Set(vocab)].sort())
  })
})

describe('2. the scanner reads a declaration where the script writes one, and nowhere else', () => {
  it('reads each call and each `<family>.new(`', () => {
    const src = v5([
      'plot(close)', 'plotshape(close > open)', 'bgcolor(color.red)', 'fill(p1, p2)', 'hline(50)',
      'label.new(bar_index, high, "x")', 'var table tb = table.new(position.top_right, 1, 1)', 'linefill.new(l1, l2)',
    ].join('\n'))
    expect([...declaredFamiliesOf(src)].sort()).toEqual(['bgcolor', 'fill', 'hline', 'label', 'linefill', 'plot', 'plotshape', 'table'])
  })
  it('never in a comment or a string', () => {
    expect(declaredFamiliesOf(v5('// plot(close)\nx = "label.new(" + "bgcolor("\n'))).toEqual([])
  })
  it('never a method, a namespace member or a function of the author\'s own', () => {
    expect(declaredFamiliesOf(v5('myplot(x) => x\ny = myplot(close)\nz = m.plot(close)\nw = foo.label.new(1)\n'))).toEqual([])
  })
  it('a `linefill.new(` is not a `fill(`, and a `plotshape(` is not a `plot(`', () => {
    expect([...declaredFamiliesOf(v5('linefill.new(a, b)\nplotshape(c)'))].sort()).toEqual(['linefill', 'plotshape'])
  })
})

describe('the ledger: declared, less drawn, named and hidden by the author, is named', () => {
  it('a family no branch speaks for is UNNAMED; drawn, named and accounted ones are not', () => {
    const source = v5('plot(close)\nbgcolor(color.red)\nline.new(0, 1, 2, 3)\nlabel.new(0, 1, "x")')
    const t = { outputs: [{ kind: 'plot' }], presentation: { paints: [{ kind: 'bgcolor' }] } }
    expect(runtimeFamilyLedger({ source, t, drawn: ['plot'], named: ['bgcolor'] }).unnamed).toEqual(['line', 'label'])
    expect(runtimeFamilyLedger({ source, t, drawn: ['plot'], named: ['bgcolor'], objectsAccounted: true }).unnamed).toEqual([])
    expect(runtimeFamilyLedger({ source, t, drawn: ['plot', 'bgcolor'], objectsAccounted: true }).unnamed).toEqual([])
    expect(runtimeFamilyLedger({ source, t, drawn: [], objectsAccounted: true }).unnamed).toEqual(['plot', 'bgcolor'])
  })
  it('a family EVERY translated element of which its author hid is not named; one the translation never saw is', () => {
    const t = { outputs: [{ kind: 'plot', _authorHidden: true }, { kind: 'plot', hiddenReason: 'author' }],
      presentation: { paints: [{ kind: 'bgcolor', na: true }, { kind: 'barcolor', hidden: false }] } }
    expect([...authorHiddenFamiliesOf(t)].sort()).toEqual(['bgcolor', 'plot'])
    // one shown element of the family and it is not "hidden"
    expect([...authorHiddenFamiliesOf({ outputs: [{ kind: 'plot', _authorHidden: true }, { kind: 'plot' }] })]).toEqual([])
    // a run output the run lowered as hidden (a fill with `display.none` or `color = na`) is the author's
    expect([...authorHiddenFamiliesOf({ outputs: [] }, [{ call: 'fill', hidden: true }])]).toEqual(['fill'])
    expect([...authorHiddenFamiliesOf({ outputs: [] }, [{ call: 'fill', hidden: true }, { call: 'fill' }])]).toEqual([])
    // CONTROL: a host hiding (not the author's) is no excuse: TradingView draws it
    expect([...authorHiddenFamiliesOf({ outputs: [{ kind: 'plot', hiddenReason: 'constant' }] })]).toEqual([])
    expect([...authorHiddenFamiliesOf(null)]).toEqual([])
  })
})

// ── 3. THE CLASS RAIL ─────────────────────────────────────────────────────────────────────────────────────────────
const candleKindOf = (style) => (style === OHLC_DEF_STYLES[0] ? 'plotcandle' : style === OHLC_DEF_STYLES[1] ? 'plotbar' : null)

/** What a runtime document DRAWS: its shown rows (by the host output each draws, as the door minted them into the
 *  document's plots), its candles, its paints (off the document), and whether it draws its drawings at all. */
function drawnOf(d) {
  const def = d.definition
  const outs = (d.translation && d.translation.outputs) || []
  const shown = new Set((def.plots || []).filter((pl) => pl && !pl.hidden).map((pl) => pl.key))
  const fams = new Set()
  for (const r of d.rows || []) {
    if (!r || r.hidden || !shown.has(r.key)) continue
    const k = candleKindOf(r.style)
    if (k) { fams.add(k); continue }
    if (Number.isInteger(r.output) && outs[r.output]) fams.add(outs[r.output].kind)
  }
  for (const p of def.paints || []) fams.add(p.kind)
  const objects = !!def.objects || !!(def.compute && def.compute.objects === true)
  return { fams, objects }
}

/** Is family `f` NAMED in the member's notes: by its word, by a withheld element of it (`<title> is not drawn`, or the
 *  untitled `<kind> <n>`), by a withheld paint (`\`bgcolor\` (line n)`), or, for a drawing family, by the drawing note. */
function namedIn(d, f) {
  const notes = d.notes || []
  if (notes.some((n) => String(n.note).includes(familyWord(f)))) return true
  if (OBJECT_DRAWING_FAMILIES.includes(f)) return notes.some((n) => n.name === DRAWING_NOTE_NAME)
  if (notes.some((n) => String(n.name).startsWith(`\`${f}\``))) return true
  const outs = (d.translation && d.translation.outputs) || []
  const titles = new Set(outs.filter((o) => o && o.kind === f && o.title).map((o) => o.title))
  // a candle's four host outputs are titled by ROLE (`open` … `close`); the door names a withheld candle by the run's
  // own title (`plotcandle(…, title = …)`): a withheld label no output of another kind carries is that candle's
  if (f === 'plotcandle' || f === 'plotbar') {
    const others = new Set(outs.filter((o) => o && o.kind !== f && o.title).map((o) => o.title))
    for (const l of d.withheld || []) if (!others.has(l)) titles.add(l)
  }
  return notes.some((n) => (titles.has(n.name) || new RegExp(`^${f} \\d+$`).test(n.name)) && / is not drawn: /.test(n.note))
}

describe('3. THE CLASS RAIL — every corpus script the runtime lane draws: each declared family drawn, named, or author-hidden', () => {
  beforeAll(() => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); __admitEveryRunHalfForTests()
  })
  afterAll(() => { vi.unstubAllEnvs() })

  const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
  it('the corpus is there (a rail over nothing proves nothing)', () => { expect(files.length).toBeGreaterThan(200) })

  it('every runtime-lane document draws or names every family its source declares', () => {
    let checked = 0
    const gaps = []
    for (const f of files) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      const d = memberPaneDefinition({ source, id: 'u_ledger_rail', name: 'rail' })
      if (!d.ok || d.lane !== 'runtime') continue
      checked += 1
      const { fams, objects } = drawnOf(d)
      // hidden by its author is a TRANSLATION fact (the host's records and the run's): the door's own reading of it
      const hidden = new Set((d.familyLedger && d.familyLedger.hidden) || [])
      for (const fam of declaredFamiliesOf(source)) {
        if (fams.has(fam) || hidden.has(fam)) continue
        if (objects && OBJECT_DRAWING_FAMILIES.includes(fam)) continue
        if (!namedIn(d, fam)) gaps.push(`${f}: ${fam}`)
      }
    }
    expect(checked, 'runtime-lane documents checked').toBeGreaterThan(0)
    expect(gaps).toEqual([])
  }, 600000)
})
