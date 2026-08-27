// app/src/components/screener/ScanToChart.wire.test.jsx
//
// ─── 🔴 THE WIRE-CUT. THE WHOLE POINT OF THIS FILE ──────────────────────────
//
// `ScanResultRow.test.jsx` renders a row and asserts it has a chart button; that
// case stays green for the entire time the button goes NOWHERE. This one drives
// the CLICK and asserts the CHART received the DEFINITION — and it is the only
// case that reds when the join is cut.
//
// ⭐ AND THE ASSERTION IS A HASH EQUALITY ACROSS THE HOP, NOT A RESEMBLANCE.
// `def_hash` IS `astHash` IS `compute.fn`: the tree is the implementation, so
// "the same definition" is a value two surfaces can be made to publish and be
// compared on. The receipt is filed under the hash the SWEEP saw; the chart
// publishes the hash of the tree it actually INSTALLED. Nothing in this file
// types either of them.
//
// ⛔ WHY A COMPONENT TEST IS NOT ENOUGH, MEASURED IN THIS REPO: 8 features built,
// tested and green were reachable from nothing at all — 4 auditors, 25 findings,
// 6 of 9 unreachability. Component tests are structurally blind to a severed
// wire because both components stay correct. The fix is a test that goes RED
// when the WIRE is cut while both halves remain correct, which is what the
// mutation split below is: M2 removes the button's handler and only THIS file
// may red.

import fs from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

import { parseFormula, astHash, TABLE } from '../chart/engine/ast/parse'
import { lintRepaint } from '../chart/engine/ast/lint'
import { freshnessFor } from '../chart/engine/ast/freshness'
import { SCHEMA_VERSION } from '../chart/engine/defSchema'
import { AST_LANE_TIER, clearUserDefinitions } from '../chart/engine/nativeRegistry'
import { BUILDER_INPUTS, BUILDER_INPUT_SCOPE } from '../chart/builder/builderInputs'
import { evaluateFormula } from '../chart/builder/FormulaField'

// The chart shell, stubbed to what it was handed. ChartPane's own internals (an
// AuthProvider, a market clock, fundamentals, three SWR polls) are not what this
// file is about — and `data-testid="chart-pane"` deliberately lives on the
// SURFACE's wrapper, not inside the pane, so mocking the pane cannot make the
// assertion pass by removing the thing under test.
vi.mock('../chart/pane/ChartPane', () => ({
  default: ({ sym, tf }) => <div data-testid={`pane-inner-${sym}-${tf}`}>pane</div>,
}))

const ScanResults = (await import('./ScanResults')).default

// ─── the definition, built the way the builder builds one ───────────────────
//
// ⛔ EVERY MACHINE-ASSIGNED FIELD IS MEASURED HERE, NOT TYPED. `repaint` is
// `lintRepaint(ast).mode` and `freshness` is `freshnessFor(ast).mode` because
// `validateUserDefinitions` refuses a disagreement in BOTH directions — a fixture
// that typed either would be asserting about a document the product cannot save.

const SCAN_SOURCE = 'close > sma(close, 50)'
const PARSED = parseFormula(SCAN_SOURCE)
if (!PARSED.ok) throw new Error(`the wire-cut fixture does not parse: ${PARSED.error}`)
const AST = PARSED.ast
const DEF_HASH = astHash(AST)
const DEF_ID = 'u_0123456789ab'

const DEFINITION = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  id: DEF_ID,
  version: 1,
  meta: {
    name: 'Above the 50', shortName: 'A50', category: 'Custom', tier: AST_LANE_TIER,
    repaint: lintRepaint(AST, { inputs: BUILDER_INPUT_SCOPE }).mode,
    freshness: freshnessFor(AST).mode,
  },
  compute: { kind: 'ast', fn: DEF_HASH, rev: 1, ast: AST, source: SCAN_SOURCE },
  placement: { target: 'pane', pane: { height: 0.15 } },
  inputs: BUILDER_INPUTS,
  plots: [{ key: 'value', label: 'A50', style: 'line', color: '$color', width: 1, role: 'primary' }],
})

const AS_OF = 20260807

/** A receipt whose arithmetic CLOSES — `CoverageLine` refuses to present one
 *  that does not, and a fixture that tripped that would be measuring the wrong
 *  refusal. Derived here so a change to one count breaks the sum out loud. */
const EVALUATED = 3742
const DROPPED_SYMBOLS = [{ ticker: 'ZZZZ', reason: 'not-computable', detail: 'no value for rs_rank' }]
const coverage = (over = {}) => {
  const dropped = 1
  const notComputable = 41
  return {
    evaluated: EVALUATED,
    answered: EVALUATED - dropped - notComputable,
    dropped,
    not_computable: notComputable,
    dropped_symbols: DROPPED_SYMBOLS,
    ...over,
  }
}

/** The SHIPPED route's payload shape — `api/routers/scan_results.py` answers
 *  `{def_hash, tf, as_of, status, coverage, tickers, truncated}`. */
const H = { payload: null, calls: [] }

const evaluatedPayload = (over = {}) => ({
  def_hash: DEF_HASH,
  tf: 'D',
  as_of: AS_OF,
  status: 'evaluated',
  coverage: coverage(),
  tickers: ['NVDA'],
  truncated: false,
  ...over,
})

beforeEach(() => {
  H.payload = evaluatedPayload()
  H.calls = []
  clearUserDefinitions()
  vi.stubGlobal('fetch', vi.fn((url) => {
    H.calls.push(String(url))
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(H.payload) })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearUserDefinitions()
})

const renderSurface = () => render(
  <ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" />,
)

async function chartAScanHit() {
  const user = userEvent.setup()
  renderSurface()
  await user.click(await screen.findByRole('button', { name: /chart NVDA/i }))
  return screen.getByTestId('chart-pane')
}

describe('🔴 the wire — a scan hit charts the definition that found it', () => {
  it('clicking a scan hit charts the SYMBOL with the SAME DEFINITION the scan ran', async () => {
    const user = userEvent.setup()
    renderSurface()

    // The control on the case: nothing is charted until the click. Without it
    // this test would pass on a surface that mounts a chart unconditionally.
    expect(await screen.findByRole('button', { name: /chart NVDA/i })).toBeInTheDocument()
    expect(screen.queryByTestId('chart-pane')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /chart NVDA/i }))

    const chart = screen.getByTestId('chart-pane')
    expect(chart).toHaveAttribute('data-symbol', 'NVDA')
    // 🔴 E9-A1: THE DEFINITION, NOT JUST THE TICKER. Handing over only the symbol
    // makes the two surfaces agree by coincidence — and the claim "the formula you
    // charted is the scan you ran" is exactly the thing that would then be false.
    //
    // ⭐ AND THE EXPECTATION IS THE RECEIPT'S OWN HANDLE. `H.payload.def_hash` is
    // what the sweep filed these hits under; the attribute is `astHash` of the
    // tree the chart installed. Neither side is typed in this file, so this is a
    // hash equality ACROSS THE HOP rather than two constants agreeing.
    expect(chart).toHaveAttribute('data-definition', H.payload.def_hash)
  })

  it('and the chart really resolved the definition — the pane mounted for that symbol', async () => {
    // The install door is `nativeRegistry.installUserDefinitions`, which re-lints
    // and re-budgets. If it had refused, the surface would show the refusal and
    // open no pane at all — so a mounted pane is evidence the document survived
    // the same gates the builder puts a save through.
    await chartAScanHit()
    expect(screen.getByTestId('pane-inner-NVDA-D')).toBeInTheDocument()
    expect(screen.queryByTestId('scan-chart-refused')).not.toBeInTheDocument()
  })

  it('and the CONDITION IS VISIBLE on the chart, in the tree read-back words', async () => {
    // ⛔ A2.2: "with the condition visible". A chart that draws the definition but
    // never says WHICH condition returned this symbol leaves the member to trust
    // that the two agree — which is the thing this loop exists to prove.
    //
    // ⭐ THE TWO LANES MEET HERE. The expectation is derived from the SOURCE
    // through `evaluateFormula` (parse → lint → budget → sentence, the builder's
    // own door); the surface derives it from the TREE through `sentenceFor`. They
    // must agree, and `compute.fn === astHash(compute.ast)` is why they can.
    await chartAScanHit()
    const expected = evaluateFormula(SCAN_SOURCE, BUILDER_INPUT_SCOPE).readback
    expect(expected, 'the read-back lane refused — the expectation would be null').toBeTruthy()
    expect(screen.getByTestId('chart-scan-condition')).toHaveTextContent(expected)
  })

  it('…and that condition is NOT the stored source text', async () => {
    // 🔴 M3's killer, stated as its own case rather than relied on as a side
    // effect. `compute.source` is what a member TYPED; `sentenceFor(compute.ast)`
    // is what the engine will RUN. Two descriptions of one tree is D-A5's reason,
    // on a new surface.
    await chartAScanHit()
    const shown = screen.getByTestId('chart-scan-condition').textContent
    expect(shown).not.toBe(DEFINITION.compute.source)
    expect(shown.trim().length, 'the condition rendered empty').toBeGreaterThan(0)
  })

  it('asks the endpoint about the SAME definition it charts', async () => {
    // The other half of the round trip: the request the receipt came back for
    // names the definition the click then installs. A surface that read one
    // formula's results and charted another would satisfy every assertion above.
    await chartAScanHit()
    expect(H.calls).toHaveLength(1)
    expect(H.calls[0]).toContain(encodeURIComponent(DEF_HASH))
    expect(H.calls[0]).toContain('/api/scans/definition-results')
  })
})

describe('the chart never outlives the answer set it came from', () => {
  // 🔴 THE FAILURE THIS RULES OUT IS THE TASK'S OWN CLAIM, INVERTED. Chart a hit
  // from screen A, switch to screen B, and a chart left open would be drawing A's
  // formula — with A's read-back sentence — beside B's hits. Every assertion in
  // the first describe would still pass; only this one can see it.
  const OTHER_SOURCE = 'close > sma(close, 20)'
  const OTHER_PARSED = parseFormula(OTHER_SOURCE)
  if (!OTHER_PARSED.ok) throw new Error(`fixture does not parse: ${OTHER_PARSED.error}`)
  const OTHER = {
    ...DEFINITION,
    id: 'u_ba9876543210',
    compute: {
      kind: 'ast', fn: astHash(OTHER_PARSED.ast), rev: 1,
      ast: OTHER_PARSED.ast, source: OTHER_SOURCE,
    },
  }

  it('switching to another screen closes the chart the first one opened', async () => {
    const user = userEvent.setup()
    const view = render(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" />)
    await user.click(await screen.findByRole('button', { name: /chart NVDA/i }))
    expect(screen.getByTestId('chart-pane'))
      .toHaveAttribute('data-definition', DEF_HASH)

    // ⛔ THE TWO DEFINITIONS REALLY ARE DIFFERENT — otherwise this case asserts
    // that nothing changed by changing nothing.
    expect(OTHER.compute.fn).not.toBe(DEF_HASH)
    H.payload = evaluatedPayload({ def_hash: OTHER.compute.fn, tickers: ['AMD'] })
    view.rerender(<ScanResults definition={OTHER} asOf={AS_OF} tf="D" />)

    expect(await screen.findByRole('button', { name: /chart AMD/i })).toBeInTheDocument()
    expect(screen.queryByTestId('chart-pane'),
      'the previous screen\'s chart survived the switch — it now claims a formula '
      + 'that did not return the symbols on screen').not.toBeInTheDocument()
  })
})

describe('the four outcomes reach this surface intact', () => {
  it('a NOT-COMPUTABLE symbol is named in the receipt and gets NO chart button', async () => {
    // ⛔ A chart opened from a `not_computable` hit must not imply we had data.
    // Only `tickers` are symbols the screen ANSWERED true for; `dropped_symbols`
    // carries both non-answered kinds and neither is a hit.
    renderSurface()
    expect(await screen.findByRole('button', { name: /chart NVDA/i })).toBeInTheDocument()
    // It IS on screen — so the missing button is about the button, not about the
    // symbol having been dropped from the render entirely.
    expect(screen.getByTestId('coverage-dropped-symbols')).toHaveTextContent('ZZZZ')
    expect(screen.queryByRole('button', { name: /chart ZZZZ/i })).not.toBeInTheDocument()
  })

  it('the receipt is forwarded WHOLE — the four counts render', async () => {
    renderSurface()
    const line = await screen.findByTestId('coverage-line')
    expect(line).toHaveTextContent('3,742 evaluated')
    expect(line).toHaveTextContent('41 not computable')
  })

  it('"nobody looked" is answered as itself, never as a quiet market (E6-A2)', async () => {
    H.payload = { def_hash: DEF_HASH, tf: 'D', as_of: AS_OF, status: 'not-run', coverage: null, tickers: [], truncated: false }
    renderSurface()
    expect(await screen.findByTestId('scan-results-not-run')).toBeInTheDocument()
    expect(screen.queryByTestId('coverage-line')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chart-pane')).not.toBeInTheDocument()
  })

  it('a screen that ran and matched NOTHING says so — in words, beside its counts', async () => {
    // ⛔ THE OTHER HALF OF `CoverageLine`'s PAIR. That component refuses to brand
    // an empty screen at full coverage a data outage, which presumes something
    // says "nothing matched". Counts with an empty space below them read as
    // "still loading" — and a member who waits for rows that are never coming has
    // been told nothing at all.
    H.payload = evaluatedPayload({ tickers: [] })
    renderSurface()
    expect(await screen.findByTestId('scan-results-empty')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-line')).toBeInTheDocument()
    // …and it is NOT the "nobody looked" sentence: the two are different facts.
    expect(screen.queryByTestId('scan-results-not-run')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chart-pane')).not.toBeInTheDocument()
  })

  it('a refused read is reported, never rendered as an empty screen', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 402, json: () => Promise.resolve({}) })))
    renderSurface()
    expect(await screen.findByTestId('scan-results-error')).toHaveTextContent('402')
  })
})

// ─── ⭐ THE SOURCE RAIL ──────────────────────────────────────────────────────
//
// ⛔ THE HALF NO BEHAVIOURAL TEST CAN SEE. E-2 measured the asymmetry (M5 vs
// M5b) and E-4 reproduced it: a hand-list that REPLACES a derivation is
// behavioural and a planted fixture catches it; one that AGREES WITH TODAY'S
// ARTIFACT and merely shadows the derivation is invisible to every behavioural
// case there is. Its only possible killer is an AST walk of the source.
//
// For this surface the shadowing shape is exact: `compute.source` and
// `compute.ast` describe the same formula TODAY, so a surface that rendered the
// stored source instead of the tree's read-back would pass every case above on
// every document the builder can currently write — and would be wrong the first
// time a source and its tree disagree, which is the one thing `defSchema` ties
// together BY HASH precisely because it can happen.

describe('⭐ THE SOURCE RAIL — the condition can only come from the TREE', () => {
  const ROOT = (() => {
    let dir = process.cwd()
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
    throw new Error(`ScanToChart.wire.test: could not find the repo root from ${process.cwd()}`)
  })()

  const SURFACE_REL = 'app/src/components/screener/ScanResults.jsx'
  /** ⚠️ CRLF NORMALISED AT THE DOOR — `core.autocrlf` is on in this checkout. */
  const readSource = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

  const parseJsx = (src) => Parser.extend(jsx()).parse(src, {
    ecmaVersion: 'latest', sourceType: 'module',
  })

  const walk = (node, visit) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach((n) => walk(n, visit)); return }
    if (typeof node.type === 'string') visit(node)
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit)
  }

  /** Every property NAME read off an object, statically. `a.source` and
   *  `a['source']` both count; a comment mentioning `compute.source` does not,
   *  because a comment is not in the AST (plan-review #14's rule, one node type
   *  over from `criteria.test.js`'s string-constant rail). */
  function propertyReads(src) {
    const out = new Set()
    walk(parseJsx(src), (n) => {
      if (n.type !== 'MemberExpression') return
      if (!n.computed && n.property && n.property.type === 'Identifier') out.add(n.property.name)
      if (n.computed && n.property && n.property.type === 'Literal'
        && typeof n.property.value === 'string') out.add(n.property.value)
    })
    return out
  }

  /** The first argument of every `sentenceFor(...)` call, as a dotted path. */
  function sentenceForArguments(src) {
    const out = []
    walk(parseJsx(src), (n) => {
      if (n.type !== 'CallExpression') return
      const callee = n.callee
      const named = callee && ((callee.type === 'Identifier' && callee.name)
        || (callee.type === 'MemberExpression' && !callee.computed
          && callee.property.type === 'Identifier' && callee.property.name))
      if (named !== 'sentenceFor') return
      const dotted = (node) => {
        if (!node) return '?'
        if (node.type === 'Identifier') return node.name
        if (node.type === 'MemberExpression' && !node.computed
          && node.property.type === 'Identifier') return `${dotted(node.object)}.${node.property.name}`
        return '?'
      }
      out.push(dotted(n.arguments[0]))
    })
    return out
  }

  it('the surface NEVER reads `.source` off anything', () => {
    const props = propertyReads(readSource(SURFACE_REL))
    expect(props.size, 'the walk found no property reads at all — this rail would pass on anything')
      .toBeGreaterThan(10)
    expect([...props].filter((p) => p === 'source'),
      'ScanResults.jsx reads a `.source` — the condition beside a chart must be '
      + 'derived from `compute.ast`, never from the text the member typed (M3).')
      .toEqual([])
  })

  it('and the rail is NOT vacuous — a planted `compute.source` read is caught', () => {
    const dirty = 'export const show = (d) => <p>{d.compute.source}</p>\n'
    expect([...propertyReads(dirty)].filter((p) => p === 'source')).toEqual(['source'])
  })

  it('`sentenceFor` is called exactly once, and on the TREE', () => {
    const args = sentenceForArguments(readSource(SURFACE_REL))
    expect(args, 'the read-back must be derived once, from `compute.ast`').toHaveLength(1)
    expect(args[0].endsWith('.compute.ast'),
      `sentenceFor was handed ${args[0]} — a read-back derived from anything but the `
      + 'tree is a second description of the maths').toBe(true)
  })

  it('and it spells NO name the closed table declares', () => {
    // The same rail E-4 put on `criteria.js`, for the same reason: a surface that
    // hand-listed a series, scalar, function or operator name would be a fourth
    // vocabulary, and it would agree with today's manifest right up until a
    // rename.
    const DECLARED = new Set([
      ...Object.keys(TABLE.series), ...Object.keys(TABLE.scalars),
      ...Object.keys(TABLE.functions), ...Object.keys(TABLE.operators),
    ])
    expect(DECLARED.size, 'the declared set is empty — this rail would pass on anything')
      .toBeGreaterThan(70)
    const strings = new Set()
    walk(parseJsx(readSource(SURFACE_REL)), (n) => {
      if (n.type === 'Literal' && typeof n.value === 'string') strings.add(n.value)
      if (n.type === 'TemplateLiteral') n.quasis.forEach((q) => strings.add(q.value.cooked))
    })
    expect([...strings].filter((s) => DECLARED.has(s)),
      'a manifest name is hand-listed in ScanResults.jsx — derive it instead').toEqual([])
  })
})

// ─── ⭐ THE ON-DEMAND DOOR'S ENTRY (W4a) ─────────────────────────────────────
//
// `RunNowButton` POSTs `/api/scans/run`, watches the job, and hands the finished
// answer UP to `ScreensManager`, which feeds it to THIS mount. That is the whole
// reason for a `payload` prop: the on-demand run and the nightly receipt render
// through ONE component, so the four-outcome line, the hit rows and the chart
// button are the same code path for both — and `CoverageLine` keeps exactly one
// door into the app, which the planted-cut control above asserts.

describe('a GIVEN payload renders without a fetch (the on-demand door, W4a)', () => {
  it('renders the handed payload, fetches nothing, and the tier rides along', async () => {
    const given = evaluatedPayload({ tickers: ['AMD'], tier: 'on-demand' })
    render(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" payload={given} />)
    expect(await screen.findByRole('button', { name: /chart AMD/i })).toBeInTheDocument()
    expect(screen.getByTestId('coverage-line')).toHaveTextContent('3,742 evaluated')
    expect(H.calls, 'a given payload must not be re-fetched').toHaveLength(0)
  })

  it('and removing the payload falls back to the fetch — the nightly answer returns', async () => {
    const given = evaluatedPayload({ tickers: ['AMD'], tier: 'on-demand' })
    const view = render(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" payload={given} />)
    await screen.findByRole('button', { name: /chart AMD/i })
    view.rerender(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" payload={null} />)
    expect(await screen.findByRole('button', { name: /chart NVDA/i })).toBeInTheDocument()
    expect(H.calls).toHaveLength(1)
  })

  it('a SECOND payload replaces the first — one answer set on screen at a time', async () => {
    const first = evaluatedPayload({ tickers: ['AMD'] })
    const view = render(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D" payload={first} />)
    await screen.findByRole('button', { name: /chart AMD/i })
    view.rerender(<ScanResults definition={DEFINITION} asOf={AS_OF} tf="D"
      payload={evaluatedPayload({ tickers: ['INTC'] })} />)
    expect(await screen.findByRole('button', { name: /chart INTC/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /chart AMD/i })).toBeNull()
    expect(H.calls).toHaveLength(0)
  })
})
