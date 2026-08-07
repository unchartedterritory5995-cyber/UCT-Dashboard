import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// ⚠️ `@babel/parser` reaches this test through `@vitejs/plugin-react`'s own
// dependency tree, not through a direct devDependency. It is used ONLY here, and
// only to make the containment claim below a real STRUCTURAL one — the phase's
// standing rule is "verify structure with an AST, never a grep", and a substring
// search for `<IndicatorChip` inside a sliced region is exactly the kind of grep
// a comment or a string literal fools. If the import ever fails it fails loudly,
// at module load, which is the correct failure for a gate.
import { parse } from '@babel/parser'

// ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// `tools/chart_parity.py` renders exactly one route, `/r/chart`, and that page
// injects a rule that hides the whole legend from the captured element. So the
// pixel gate cannot see a chip — not its text, not its controls, not its
// absence. A TOTAL REGRESSION OF THE CHIP SURFACE REPORTS 0 CHANGED PIXELS ON
// ALL 46 LIVE CASES.
//
// A 0 from an instrument that cannot fail is the shape this branch keeps
// finding. This file makes the blindness an ASSERTED FACT, so a future reader
// who runs the parity gate after touching the legend and sees 0 has something
// that tells them what that 0 is worth.
//
// ⚠️ IT ASSERTS THE BLINDNESS *AS IT CURRENTLY EXISTS*, WHICH MEANS IT IS
// SUPPOSED TO FAIL IF THE EXPORT CSS EVER CHANGES. Cases 1 and 2 read the rules
// out of `ChartRender.jsx`. Deleting or narrowing the hide fails them — and that
// is the correct outcome, not a broken test: at that moment the gate WOULD see
// chips, this file's premise is no longer true, and the sibling invariant below
// (the chip lives INSIDE the legend, so it inherits the hide) has stopped being
// what keeps the chip out of every branded newsletter export. Re-derive the
// claim then; do not relax the regex to make it pass.
//
// ⛔ AND THE INVARIANT THAT FOLLOWS: THE CHIP MUST STAY INSIDE THE LEGEND
// CONTAINER. A sibling would survive the export-time `display:none`, appear in
// every branded screenshot the hand-made charts never carried, and move all 46
// pixel baselines at once. Case 3 proves it from the AST — a range containment
// over parsed JSX, not a grep — and `legendFromDefinitions.test.jsx` proves the
// same thing from the rendered DOM.

/** The repo root, walked up from THIS FILE — never from the working directory.
 *  vitest is run from `app/` and from the repo root at different times, and the
 *  same rule is why `legendProbe.js` resolves its paths this way. */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = (() => {
  let dir = HERE
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'pages', 'ChartRender.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`parity blindness: repo root not found walking up from ${HERE}`)
})()

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8')

const CHART_RENDER = read('app', 'src', 'pages', 'ChartRender.jsx')
const STOCK_CHART = read('app', 'src', 'components', 'StockChart.jsx')

describe('the pixel gate cannot see the legend — asserted, not assumed', () => {
  it('the export route hides every element whose class contains "legend"', () => {
    // Single-line match on purpose: this repo is CRLF and a multi-line `\n`
    // anchor matches ZERO.
    expect(CHART_RENDER).toMatch(/#chart-export \[class\*="legend" i\]\{display:none !important\}/)
  })

  it('…and re-shows ONLY the volume legend — the control that the rule is narrow', () => {
    expect(CHART_RENDER).toMatch(/#chart-export \[class\*="volLegend" i\]\{display:flex !important\}/)
    // The narrowness matters: `volLegend` is the ONE thing put back, so anything
    // else the strip might have been named would stay hidden.
    const reshown = [...CHART_RENDER.matchAll(/#chart-export \[class\*="([^"]+)" i\]\{display:(?!none)/g)]
      .map(m => m[1])
    expect(reshown, 'the export route re-shows something other than the volume legend')
      .toEqual(['volLegend'])
  })

  it('the gate photographs ONE route, and it is that page', () => {
    // The chain, link by link: the harness drives `/r/chart`, screenshots the
    // `#chart-export` ELEMENT, and `/r/chart` is `ChartRender.jsx`. Break any
    // link and the blindness claim above stops following.
    const harness = read('tools', 'chart_parity.py')
    expect(harness, 'the parity harness no longer drives /r/chart').toContain('/r/chart?')
    expect(harness, 'the parity harness no longer screenshots the #chart-export element')
      .toContain('page.locator("#chart-export")')
    expect(CHART_RENDER, 'ChartRender no longer renders the captured element')
      .toContain('id="chart-export"')
  })

  it('…over 46 LIVE cases — the number a future 0 would be reported against', () => {
    // DERIVED from the corpus, never typed: the report of a "0 px" run names a
    // case count, and that count has to come from the same file the run reads.
    const cases = JSON.parse(read('tools', 'chart_parity_cases.json')).cases
    const live = cases.filter(c => c.status !== 'placeholder')
    expect(live.length, 'the live parity corpus changed size — re-derive the claim')
      .toBe(46)
    expect(cases.length).toBeGreaterThan(live.length)   // the placeholders are real
  })
})

// ─── THE AST HALF ───────────────────────────────────────────────────────────

/** Every node in a Babel AST, depth-first. */
function* walk(node) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return }
  if (typeof node.type !== 'string') return
  yield node
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue
    yield* walk(node[key])
  }
}

const AST = parse(STOCK_CHART, { sourceType: 'module', plugins: ['jsx'] })

/** The JSX element carrying `ref={<name>}` — exactly one, or a NAMED throw. A
 *  probe that silently matches nothing is worse than no probe. */
const elementWithRef = (name) => {
  const hits = []
  for (const node of walk(AST.program)) {
    if (node.type !== 'JSXElement') continue
    const attrs = node.openingElement.attributes || []
    const hasRef = attrs.some(a => a.type === 'JSXAttribute'
      && a.name && a.name.name === 'ref'
      && a.value && a.value.type === 'JSXExpressionContainer'
      && a.value.expression.type === 'Identifier' && a.value.expression.name === name)
    if (hasRef) hits.push(node)
  }
  if (hits.length !== 1) {
    throw new Error(
      `parity blindness: ${hits.length} JSX elements carry ref={${name}} in StockChart.jsx ` +
      '(expected exactly 1). The anchor has moved — re-derive it, do not pin a line number.')
  }
  return hits[0]
}

const jsxElementsNamed = (name) => [...walk(AST.program)].filter(
  n => n.type === 'JSXElement'
    && n.openingElement.name.type === 'JSXIdentifier'
    && n.openingElement.name.name === name)

const contains = (outer, inner) => inner.start > outer.start && inner.end < outer.end

describe('⛔ so the chip strip must stay INSIDE the legend container', () => {
  const legend = elementWithRef('legendRef')
  const chips = jsxElementsNamed('IndicatorChip')

  it('every <IndicatorChip> is a DESCENDANT of the legend element', () => {
    // If the chip were a SIBLING of the legend it would survive the export-time
    // hide, appear in every branded newsletter export, and move all 46 parity
    // baselines. Range containment in a parsed tree IS descendancy — this is an
    // AST, not a substring search that a comment or a string literal can fool.
    expect(chips.length, 'StockChart renders no IndicatorChip — the strip is gone')
      .toBeGreaterThan(0)
    const outside = chips.filter(c => !contains(legend, c))
      .map(c => STOCK_CHART.slice(0, c.start).split('\n').length)
    expect(outside, 'an IndicatorChip is rendered OUTSIDE the legend container, at these lines')
      .toEqual([])
  })

  it('…and so is the `+N` button, which is part of the same strip', () => {
    const more = [...walk(AST.program)].filter(n => n.type === 'JSXElement'
      && (n.openingElement.attributes || []).some(a => a.type === 'JSXAttribute'
        && a.name && a.name.name === 'aria-label'
        && a.value && a.value.type === 'JSXExpressionContainer'
        && /more indicators/.test(STOCK_CHART.slice(a.value.start, a.value.end))))
    // ONE PER LAYOUT BRANCH, tied to the chip count rather than typed: a branch
    // that renders chips without the control strands its folded tail with no way
    // to expand it, and a branch that renders the control without chips has
    // nothing to unfold.
    expect(more.length, 'a legend layout renders chips with no +N control, or the reverse')
      .toBe(chips.length)
    expect(more.filter(m => !contains(legend, m)),
      'a +N button escaped the legend container — it would print in every export')
      .toEqual([])
  })

  it('⛔ and the containment predicate can say NO — the control', () => {
    // Without this, `contains()` returning true for everything would make the
    // case above pass whatever StockChart does. The `<canvas ref={vpCanvasRef}>`
    // is the legend's SIBLING in the same subtree, so it is exactly the shape a
    // stray chip would take.
    const sibling = elementWithRef('vpCanvasRef')
    expect(contains(legend, sibling),
      'the containment test says a known SIBLING is inside — it cannot fail').toBe(false)
  })

  it('the legend container really is what the export rule matches', () => {
    // The mechanism, not the intention: the container's class comes from
    // `styles.legend`, CSS Modules keeps the source class name inside the
    // generated one, and the rule matches `[class*="legend" i]`.
    const opening = STOCK_CHART.slice(legend.start, legend.openingElement.end)
    expect(opening, 'the legend container no longer takes its class from styles.legend')
      .toContain('styles.legend')
    const moduleCss = read('app', 'src', 'components', 'StockChart.module.css')
    expect(moduleCss, 'StockChart.module.css declares no .legend class').toMatch(/^\.legend\b/m)
  })

  it('⛔ and NO chip class may contain "legend" — it would hit the volLegend re-show', () => {
    // The chip inherits the hide as a DESCENDANT. A chip class of its own
    // containing "legend" would be matched by the hide too — harmless — but one
    // containing "volLegend" would be RE-SHOWN inside the export, which is the
    // failure this rules out by construction.
    const css = read('app', 'src', 'components', 'chart', 'legend', 'IndicatorChip.module.css')
    const classes = [...css.matchAll(/^\.([A-Za-z_][\w-]*)/gm)].map(m => m[1])
    expect(classes.length, 'no classes were read — this case would pass on an empty list')
      .toBeGreaterThanOrEqual(3)
    expect(classes.filter(c => /legend/i.test(c)),
      'a chip class contains "legend" — it now interacts with the export rules directly')
      .toEqual([])
  })
})
