// app/src/pages/terminal/panelPhoneLayout.rail.test.js
//
// ─── EVERY TERMINAL-NATIVE PANEL HOLDS ITS SHAPE ON A PHONE (≤640) AND A TABLET (641–1024) ───
//
//     cd app && npx vitest run src/pages/terminal/panelPhoneLayout.rail.test.js --maxWorkers=2
//
// jsdom computes no layout, so this reads SOURCE, not boxes: each panel's JSX (by AST) and the
// CSS modules it imports. Passing is necessary, not sufficient; `tools/mobile_audit.py` against a
// running build remains the ground truth for rendered widths.
//
// ── THE POPULATION IS DERIVED, NEVER TYPED ──────────────────────────────────────────────────
// Every `import('./panels/<Name>')` in `PANEL_IMPORTERS` (panels.jsx), read from its source text so
// nothing is lazily loaded. A panel added to the registry tomorrow is examined the day it lands.
//
// ── THE RULES (each a relationship between a panel's JSX and its own stylesheet) ─────────────
//   R1  a <table> sits inside an element whose className names `.tableBox`, and that stylesheet
//       gives `.tableBox` `overflow-x: auto` — the table scrolls in its box, the page never does.
//   R2  a cell or column flagged `phoneHide` resolves to a stylesheet that hides `.phoneHide`
//       inside the canonical PHONE query `@media (max-width: 640px)`.
//   R3  a table five or more columns wide folds at least one away on a phone (R2's flag), so a
//       390px panel keeps the symbol and the numbers that matter in view.
//   R4  that stylesheet's `.table` draws digits with `font-variant-numeric: tabular-nums`.
//   R5  a <form> whose className names `.form` stacks to ONE column on a phone.
//   R6  a long-name cell flagged `wrapCell` resolves to a rule that lets it wrap.
//   R7  an ECharts chart confines its tooltip to the chart, and its stage has a `min-height`.
// Each rule also runs against an in-memory fixture that MUST fail, so a rule that cannot fail
// fails here instead of passing quietly.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const TERMINAL = path.join(process.cwd(), 'src', 'pages', 'terminal')
const PANELS_DIR = path.join(TERMINAL, 'panels')
const PHONE_MQ = '(max-width: 640px)'

/** ⚠️ CRLF normalised at the door — `core.autocrlf` is on in this checkout. */
const read = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })

// ── population ───────────────────────────────────────────────────────────────────────────────
function registryPanels() {
  const src = read(path.join(TERMINAL, 'panels.jsx'))
  const start = src.indexOf('export const PANEL_IMPORTERS')
  const body = src.slice(start, src.indexOf('\n}\n', start))
  const out = []
  for (const m of body.matchAll(/^\s*(\w+):[^\n]*import\('\.\/panels\/(\w+)'\)/gm)) {
    out.push({ key: m[1], file: path.join(PANELS_DIR, `${m[2]}.jsx`) })
  }
  return out
}

// ── CSS reading ──────────────────────────────────────────────────────────────────────────────
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const norm = (s) => s.replace(/\s+/g, ' ').trim()

/** Splits a stylesheet into top-level rules and @media blocks (one level deep is all we use). */
function cssBlocks(cssRaw) {
  const css = stripComments(cssRaw)
  const rules = []
  const media = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const head = norm(css.slice(i, open))
    let depth = 1
    let j = open + 1
    while (j < css.length && depth) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
      j += 1
    }
    const inner = css.slice(open + 1, j - 1)
    if (head.startsWith('@media')) media.push({ query: norm(head.slice(6)), ...cssBlocks(inner) })
    else rules.push({ selectors: head.split(',').map(norm), body: norm(inner) })
    i = j
  }
  return { rules, media }
}

/** Does a rule whose selector list contains `selector` declare `decl` (a regex over the body)? */
const declares = (rules, selector, decl) => rules.some((r) => r.selectors.includes(selector) && decl.test(r.body))
const phoneRules = (blocks) => blocks.media.filter((m) => m.query === PHONE_MQ).flatMap((m) => m.rules)

// ── JSX reading ──────────────────────────────────────────────────────────────────────────────
function walk(node, visit, parents = []) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, visit, parents)); return }
  if (typeof node.type === 'string') visit(node, parents)
  const next = typeof node.type === 'string' ? [...parents, node] : parents
  for (const [k, v] of Object.entries(node)) {
    if (k !== 'loc' && v && typeof v === 'object') walk(v, visit, next)
  }
}

/** Is `node` inside a `.map(...)` call within `root`? (a mapped <th> is counted from its array) */
function insideMap(node, root) {
  let hit = false
  walk(root, (m, parents) => {
    if (m === node) hit = parents.some((p) => p.type === 'CallExpression' && p.callee?.type === 'MemberExpression' && p.callee.property?.name === 'map')
  })
  return hit
}

const tagOf = (el) => (el?.type === 'JSXElement' && el.openingElement.name.type === 'JSXIdentifier' ? el.openingElement.name.name : null)

/** `[namespace, class]` pairs a JSX element's className expression names (`s.x`, `s['x']`). */
function classRefs(el) {
  const attr = el.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name?.name === 'className')
  const out = []
  if (!attr?.value) return out
  walk(attr.value, (n) => {
    if (n.type === 'MemberExpression' && n.object.type === 'Identifier') {
      const prop = n.computed ? n.property.value : n.property.name
      if (typeof prop === 'string') out.push([n.object.name, prop])
    }
  })
  return out
}

/** Everything one panel file says about its layout, from source (so fixtures can be in memory). */
function analyse(src, file, cssFor = (abs) => read(abs)) {
  const ast = parse(src)
  const styles = {}
  const arrays = {}
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration' && /\.module\.css$/.test(n.source.value)) {
      const def = n.specifiers.find((sp) => sp.type === 'ImportDefaultSpecifier')
      if (def) styles[def.local.name] = cssBlocks(cssFor(path.resolve(path.dirname(file), n.source.value)))
    }
    const decl = n.type === 'VariableDeclaration' ? n : n.declaration?.type === 'VariableDeclaration' ? n.declaration : null
    for (const d of decl?.declarations || []) {
      let init = d.init
      if (init?.type === 'CallExpression' && init.arguments[0]?.type === 'ArrayExpression') init = init.arguments[0]
      if (d.id.type === 'Identifier' && init?.type === 'ArrayExpression') {
        arrays[d.id.name] = {
          width: init.elements.length,
          phoneHide: init.elements.some((e) => e?.type === 'ObjectExpression'
            && e.properties.some((p) => (p.key?.name || p.key?.value) === 'phoneHide' && p.value?.value === true)),
        }
      }
    }
  }
  const tables = []
  const forms = []
  const refs = []
  const charts = []
  let echarts = false
  walk(ast, (n, parents) => {
    if (n.type === 'ImportDeclaration' && n.source.value === 'echarts-for-react') echarts = true
    if (n.type !== 'JSXElement') return
    for (const r of classRefs(n)) refs.push(r)
    const tag = tagOf(n)
    const ancestors = parents.filter((p) => p.type === 'JSXElement')
    if (tag === 'table') {
      const boxed = ancestors.flatMap(classRefs).find(([, c]) => c === 'tableBox') || null
      let width = 0
      let folds = false
      const thead = n.children.find((c) => tagOf(c) === 'thead')
      if (thead) {
        walk(thead, (m) => {
          if (tagOf(m) === 'th' && !insideMap(m, thead)) width += 1
          if (m.type === 'CallExpression' && m.callee.type === 'MemberExpression' && m.callee.property.name === 'map'
            && m.callee.object.type === 'Identifier' && arrays[m.callee.object.name]) {
            width += arrays[m.callee.object.name].width
            if (arrays[m.callee.object.name].phoneHide) folds = true
          }
        })
      }
      walk(n, (m) => { if (m.type === 'JSXElement' && classRefs(m).some(([, c]) => c === 'phoneHide')) folds = true })
      tables.push({ line: n.loc?.start?.line, boxed, width, folds })
    }
    if (tag === 'form') forms.push({ cls: classRefs(n).find(([, c]) => c === 'form') || null })
    if (tag === 'ReactECharts') {
      const stage = ancestors.length ? classRefs(ancestors[ancestors.length - 1]) : []
      charts.push({ stage })
    }
  })
  return { styles, tables, forms, refs, charts, echarts, confined: /confine:\s*true/.test(src) }
}

/** Every rule broken in one panel, as readable strings (empty = holds). */
function violations(a, name) {
  const out = []
  const sheet = (ns) => a.styles[ns]
  for (const t of a.tables) {
    if (!t.boxed) { out.push(`${name}: <table> (line ${t.line}) is not inside a .tableBox container`); continue }
    const css = sheet(t.boxed[0])
    if (!css || !declares(css.rules, '.tableBox', /overflow-x: auto/)) {
      out.push(`${name}: ${t.boxed[0]}.tableBox does not declare overflow-x: auto`)
    }
    if (!css || !css.rules.some((r) => r.selectors.includes('.table') && /font-variant-numeric: tabular-nums/.test(r.body))) {
      out.push(`${name}: ${t.boxed[0]}.table does not use tabular-nums`)
    }
    if (t.width >= 5 && !t.folds) out.push(`${name}: a ${t.width}-column table (line ${t.line}) hides nothing on a phone`)
  }
  for (const [ns, cls] of a.refs) {
    if (!a.styles[ns]) continue // `c.phoneHide` on a column object is a flag, not a class
    const css = sheet(ns)
    if (cls === 'phoneHide' && !(css && declares(phoneRules(css), '.phoneHide', /display: none/))) {
      out.push(`${name}: ${ns}.phoneHide is not hidden inside @media ${PHONE_MQ}`)
    }
    if (cls === 'wrapCell' && !(css && declares(css.rules, '.table td.wrapCell', /white-space: normal/))) {
      out.push(`${name}: ${ns}.wrapCell does not let the cell wrap`)
    }
  }
  for (const f of a.forms) {
    if (!f.cls) continue
    const css = sheet(f.cls[0])
    if (!(css && declares(phoneRules(css), '.form', /grid-template-columns: 1fr\s*(;|$)/))) {
      out.push(`${name}: ${f.cls[0]}.form does not stack to one column inside @media ${PHONE_MQ}`)
    }
  }
  if (a.echarts && a.charts.length) {
    if (!a.confined) out.push(`${name}: the chart tooltip is not confined to the chart`)
    for (const c of a.charts) {
      const ok = c.stage.some(([ns, cls]) => sheet(ns) && declares(sheet(ns).rules, `.${cls}`, /min-height: /))
      if (!ok) out.push(`${name}: the chart's stage has no min-height`)
    }
  }
  return [...new Set(out)]
}

// ── exemptions: SHRINK-ONLY, one line each, kind first ─────────────────────────────────────────
// Panels outside the 2026-10-09 phone/tablet lane whose gap is real and is another lane's to close.
const EXEMPT = {
  Help: 'outside-lane: its three key tables (TerminalShell.module.css .helpTable) sit in no overflow box; they are two narrow wrapping columns today, so nothing scrolls the page yet',
  Rrg: 'outside-lane: the six-column quadrant table scrolls inside its .tableBox but folds no column on a phone (comparePanels.module.css)',
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────
const POPULATION = registryPanels()
const RESULTS = POPULATION.map(({ key, file }) => ({ key, file, a: analyse(read(file), file) }))

describe('terminal panels: phone and tablet layout rail', () => {
  it('derives a real population from PANEL_IMPORTERS', () => {
    const tables = RESULTS.reduce((n, r) => n + r.a.tables.length, 0)
    const folding = RESULTS.filter((r) => r.a.tables.some((t) => t.folds)).length
    console.log(`panelPhoneLayout: ${RESULTS.length} panels, ${tables} tables, ${folding} fold columns on a phone, `
      + `${RESULTS.reduce((n, r) => n + r.a.forms.length, 0)} forms, ${RESULTS.filter((r) => r.a.charts.length).length} echarts panels`)
    expect(RESULTS.length).toBeGreaterThanOrEqual(20)
    expect(tables).toBeGreaterThanOrEqual(10)
    expect(folding).toBeGreaterThanOrEqual(8)
    for (const r of RESULTS) expect(fs.existsSync(r.file), r.key).toBe(true)
  })

  it.each(RESULTS.filter((r) => !EXEMPT[r.key]).map((r) => [r.key, r]))('%s holds R1–R7', (_key, r) => {
    expect(violations(r.a, r.key).join(' | ')).toBe('')
  })

  // Shrink-only: an exempt panel that now holds every rule FAILS here, so the line gets deleted.
  it.each(Object.keys(EXEMPT).map((k) => [k]))('exemption %s is still needed and still in the registry', (key) => {
    const r = RESULTS.find((x) => x.key === key)
    expect(r, `${key} left PANEL_IMPORTERS; delete its EXEMPT line`).toBeTruthy()
    expect(violations(r.a, r.key).length, `${key} now holds R1–R7; delete its EXEMPT line`).toBeGreaterThan(0)
  })
})

describe('terminal panels: phone layout rail — controls that must fail', () => {
  const FILE = path.join(PANELS_DIR, 'Fixture.jsx')
  const GOOD_CSS = `
    .tableBox { overflow-x: auto; }
    .table { font-variant-numeric: tabular-nums; }
    .table td.wrapCell { white-space: normal; }
    .stage { min-height: 16rem; }
    @media (max-width: 640px) { .phoneHide { display: none; } .form { grid-template-columns: 1fr; } }
  `
  const run = (jsxSrc, css = GOOD_CSS) => violations(analyse(jsxSrc, FILE, () => css), 'Fixture')
  const HEAD = "import s from './x.module.css'\n"
  const WIDE = '<thead><tr><th>A</th><th>B</th><th>C</th><th>D</th><th className={s.phoneHide}>E</th></tr></thead>'

  it('a clean fixture passes (the controls below differ by one thing)', () => {
    expect(run(`${HEAD}export default () => <div><div className={s.tableBox}><table className={s.table}>${WIDE}</table></div>
      <form className={s.form} /></div>`).join(' | ')).toBe('')
  })
  it('R1: a bare table fails', () => {
    expect(run(`${HEAD}export default () => <table className={s.table}><tbody /></table>`).join()).toMatch(/not inside a .tableBox/)
  })
  it('R1: a box that does not scroll fails', () => {
    expect(run(`${HEAD}export default () => <div className={s.tableBox}><table /></div>`, GOOD_CSS.replace('overflow-x: auto;', '')).join())
      .toMatch(/overflow-x/)
  })
  it('R2: phoneHide hidden only on a non-canonical query fails', () => {
    const css = GOOD_CSS.replace('(max-width: 640px)', '(max-width: 600px)')
    expect(run(`${HEAD}export default () => <td className={s.phoneHide} />`, css).join()).toMatch(/phoneHide is not hidden/)
  })
  it('R3: a five-column table that folds nothing fails, also when its columns are a mapped array', () => {
    const plain = WIDE.replace(' className={s.phoneHide}', '')
    expect(run(`${HEAD}export default () => <div className={s.tableBox}><table>${plain}</table></div>`).join()).toMatch(/hides nothing/)
    const mapped = `${HEAD}const COLS = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }, { key: 'e' }]
      export default () => <div className={s.tableBox}><table><thead><tr>{COLS.map((c) => <th key={c.key}>{c.key}</th>)}</tr></thead></table></div>`
    expect(run(mapped).join()).toMatch(/5-column table .*hides nothing/)
    expect(run(mapped.replace("{ key: 'e' }", "{ key: 'e', phoneHide: true }"))).toEqual([])
  })
  it('R4: proportional digits fail', () => {
    expect(run(`${HEAD}export default () => <div className={s.tableBox}><table /></div>`, GOOD_CSS.replace('font-variant-numeric: tabular-nums;', '')).join())
      .toMatch(/tabular-nums/)
  })
  it('R5: a form that keeps two columns on a phone fails', () => {
    const css = GOOD_CSS.replace('.form { grid-template-columns: 1fr; }', '')
    expect(run(`${HEAD}export default () => <form className={s.form} />`, css).join()).toMatch(/one column/)
  })
  it('R6: a wrapCell that cannot wrap fails', () => {
    expect(run(`${HEAD}export default () => <td className={s.wrapCell} />`, GOOD_CSS.replace('white-space: normal;', '')).join())
      .toMatch(/wrapCell/)
  })
  it('R7: an unconfined chart with a floorless stage fails', () => {
    const src = `${HEAD}import ReactECharts from 'echarts-for-react'\nexport default () => <div className={s.bare}><ReactECharts /></div>`
    const v = run(src).join()
    expect(v).toMatch(/not confined/)
    expect(v).toMatch(/no min-height/)
  })
})
