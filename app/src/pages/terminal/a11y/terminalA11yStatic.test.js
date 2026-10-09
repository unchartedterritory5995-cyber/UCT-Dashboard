// app/src/pages/terminal/a11y/terminalA11yStatic.test.js
//
// RAIL: the terminal's own markup and stylesheets keep the accessibility floor the 2026-10-06
// audit set (docs/terminal-research/14-visual/a11y-audit-2026-10-06.md). Static by necessity —
// jsdom performs no layout — and DERIVED: every .jsx / .css under pages/terminal and
// components/terminal is walked each run, so a panel added tomorrow is covered the day it lands.
//
//   1. every <table> has an accessible name (aria-label / aria-labelledby / <caption>);
//   2. every <svg> is either a named image (role="img" + aria-label) or aria-hidden;
//   3. no aria-label sits on a bare <span>/<div> (generic role: screen readers drop the name);
//   4. every class a stylesheet makes clickable (cursor: pointer) is a 44px finger target at
//      phone AND tablet width (<=1024px is touch in this repo — styles/tapFloor.test.js).
//   5. MOUNTED SURFACES (2026-10-06, lane fn5-tables): every table in a module the terminal
//      reaches by IMPORT — the research tabs, options analytics, the screener and the whole
//      pages the shell embeds — is named, every header cell is a <th scope>, and a header that
//      sorts says which way with aria-sort. The set is derived each run by following imports
//      (static, re-export and lazy import()) from the two roots above, read by an acorn AST so a
//      comment that says "<table>" is not a table. Partner/forbidden surfaces are a shrink-only
//      BASELINE with a reason each, never a skip.
//
// ⛔ Necessary, not sufficient: this reads source, not the accessibility tree. The behavioural
// rails (TerminalShell.*.test.jsx, the panel tests) and a real screen reader remain the truth.
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Parser } from 'acorn'
import acornJsx from 'acorn-jsx'

const SRC = join(process.cwd(), 'src')
const ROOTS = [join(SRC, 'pages', 'terminal'), join(SRC, 'components', 'terminal')]
const posix = (p) => relative(SRC, p).split(sep).join('/')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const FILES = ROOTS.flatMap((r) => walk(r)).filter((f) => !/\.test\.|__tests__|__fixtures__/.test(f))
const JSX = FILES.filter((f) => f.endsWith('.jsx'))
const CSS = FILES.filter((f) => f.endsWith('.css'))

/** Every opening tag `<name …>` in `src`, braces respected (a `>` inside `{…}` is not the end). */
function openingTags(src, name) {
  const out = []
  const re = new RegExp(`<${name}\\b`, 'g')
  let m
  while ((m = re.exec(src))) {
    let depth = 0
    let i = m.index + name.length + 1
    for (; i < src.length; i += 1) {
      const ch = src[i]
      if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
      else if (ch === '>' && depth === 0) break
    }
    out.push({ tag: src.slice(m.index, i + 1), at: src.slice(0, m.index).split('\n').length, end: i + 1 })
  }
  return out
}

const hasAttr = (tag, attr) => new RegExp(`\\s${attr}=`).test(tag)

function tableOffenders(file, src) {
  return openingTags(src, 'table')
    .filter(({ tag, end }) => !hasAttr(tag, 'aria-label') && !hasAttr(tag, 'aria-labelledby')
      && !/^\s*<caption\b/.test(src.slice(end)))
    .map(({ at }) => `${file}:${at}`)
}

function svgOffenders(file, src) {
  return openingTags(src, 'svg')
    .filter(({ tag }) => !(/\srole="img"/.test(tag) && hasAttr(tag, 'aria-label')) && !/\saria-hidden=/.test(tag))
    .map(({ at }) => `${file}:${at}`)
}

function genericLabelOffenders(file, src) {
  return ['span', 'div'].flatMap((n) => openingTags(src, n))
    .filter(({ tag }) => hasAttr(tag, 'aria-label') && !hasAttr(tag, 'role'))
    .map(({ at }) => `${file}:${at}`)
}

// ── CSS: clickable classes vs the touch floor ────────────────────────────────────────────

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** Bodies of the @media blocks that APPLY at `width` (same semantics as tapFloor.test.js). */
function mediaBodies(css, width) {
  const out = []
  const re = /@media([^{]+)\{/g
  let m
  while ((m = re.exec(css))) {
    const max = /max-width:\s*(\d+)px/.exec(m[1])
    const min = /min-width:\s*(\d+)px/.exec(m[1])
    let depth = 1
    let i = re.lastIndex
    while (i < css.length && depth) {
      if (css[i] === '{') depth += 1
      else if (css[i] === '}') depth -= 1
      i += 1
    }
    if ((!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))) out.push(css.slice(re.lastIndex, i - 1))
  }
  return out.join('\n')
}
const withoutMedia = (css) => css.replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')

/** Last class of each selector part in rules whose body matches `pred`. */
function classesWhere(text, pred) {
  const found = new Set()
  const rule = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = rule.exec(text))) {
    if (!pred(m[2])) continue
    for (const part of m[1].split(',')) {
      if (/:(hover|focus|active|focus-visible|disabled)/.test(part)) continue
      const classes = part.match(/\.[A-Za-z][A-Za-z0-9_-]*/g)
      if (classes) found.add(classes[classes.length - 1])
    }
  }
  return found
}

const isTapFloor = (body) => /min-height:\s*var\(--tap-min/.test(body) || /(^|[^-])height:\s*var\(--tap-min/.test(body)

function clickableWithoutFloor(cssText) {
  const css = stripComments(cssText)
  const clickable = classesWhere(withoutMedia(css), (b) => /cursor:\s*pointer/.test(b))
  const base = classesWhere(withoutMedia(css), isTapFloor)
  const out = []
  for (const width of [390, 820]) {
    const floored = classesWhere(mediaBodies(css, width), isTapFloor)
    for (const c of clickable) if (!base.has(c) && !floored.has(c)) out.push(`${c}@${width}`)
  }
  return out.sort()
}

describe('terminal markup — names and roles', () => {
  it('walks real files (non-vacuity)', () => {
    expect(JSX.map(posix)).toContain('pages/terminal/TerminalShell.jsx')
    expect(JSX.map(posix)).toContain('pages/terminal/panels/MoversPanel.jsx')
    const tables = JSX.flatMap((f) => openingTags(readFileSync(f, 'utf8'), 'table'))
    expect(tables.length).toBeGreaterThanOrEqual(6)
  })

  it('every <table> has an accessible name', () => {
    expect(JSX.flatMap((f) => tableOffenders(posix(f), readFileSync(f, 'utf8')))).toEqual([])
  })

  it('every <svg> is a named image or hidden', () => {
    expect(JSX.flatMap((f) => svgOffenders(posix(f), readFileSync(f, 'utf8')))).toEqual([])
  })

  it('no aria-label on a bare <span>/<div>', () => {
    expect(JSX.flatMap((f) => genericLabelOffenders(posix(f), readFileSync(f, 'utf8')))).toEqual([])
  })

  it('CONTROL: each check SEES its defect', () => {
    expect(tableOffenders('x', '<table className={a}>\n<tbody/></table>')).toEqual(['x:1'])
    expect(tableOffenders('x', '<table>\n  <caption>Name</caption></table>')).toEqual([])
    expect(svgOffenders('x', '<svg viewBox={`0 0 ${W} ${H}`}>')).toEqual(['x:1'])
    expect(svgOffenders('x', '<svg role="img" aria-label={label}>')).toEqual([])
    expect(genericLabelOffenders('x', '<span className={s} aria-label="Dot" />')).toEqual(['x:1'])
    expect(genericLabelOffenders('x', '<span role="img" aria-label="Dot" />')).toEqual([])
  })
})

describe('terminal stylesheets — every clickable class is a finger target on touch', () => {
  it('walks real stylesheets that declare clickable classes (non-vacuity)', () => {
    const clickable = CSS.filter((f) => /cursor:\s*pointer/.test(readFileSync(f, 'utf8')))
    expect(clickable.map(posix)).toContain('pages/terminal/TerminalShell.module.css')
    expect(clickable.map(posix)).toContain('pages/terminal/panels/moversPanel.module.css')
  })

  it('no clickable class is under 44px at phone (390) or tablet (820) width', () => {
    const offenders = CSS.flatMap((f) => clickableWithoutFloor(readFileSync(f, 'utf8')).map((c) => `${posix(f)} ${c}`))
    expect(offenders, `clickable classes with no --tap-min floor on touch:\n${offenders.join('\n')}`).toEqual([])
  })

  it('media queries use only the canonical 640 / 1024 boundaries (styles/breakpoints.css)', () => {
    const odd = CSS.flatMap((f) => [...stripComments(readFileSync(f, 'utf8')).matchAll(/@media[^{]*?(?:min|max)-width:\s*(\d+)px/g)]
      .filter((m) => !['640', '641', '1024', '1025'].includes(m[1]))
      .map((m) => `${posix(f)}: ${m[0].trim()}`))
    expect(odd).toEqual([])
  })

  it('nothing sets a fixed min-width wider than a 360px phone', () => {
    const wide = CSS.flatMap((f) => [...stripComments(readFileSync(f, 'utf8')).matchAll(/(?:^|[;{\s])min-width:\s*(\d+)px/g)]
      .filter((m) => Number(m[1]) > 360)
      .map((m) => `${posix(f)}: min-width ${m[1]}px`))
    expect(wide).toEqual([])
  })

  it('CONTROL: a clickable class floored on the phone only is reported at tablet width', () => {
    const css = '.a { cursor: pointer; }\n@media (max-width: 640px) { .a { min-height: var(--tap-min); } }'
    expect(clickableWithoutFloor(css)).toEqual(['.a@820'])
    const ok = '.a { cursor: pointer; }\n@media (max-width: 1024px) { .a { min-height: var(--tap-min); } }'
    expect(clickableWithoutFloor(ok)).toEqual([])
  })
})

// ── 5. Mounted surfaces: every table the terminal reaches by import ────────────────────────
//
// The shell embeds ~50 existing pages and tabs as panels (panels.jsx / surfacePanels.js), so a
// table on, say, the research People tab is a terminal table the moment a member opens that
// panel. The audit (§5) found 46 of 52 such tables unnamed; this is the rail that keeps the
// fix. ⭐ The module set is DERIVED from the import graph, never typed: a tab the shell starts
// mounting tomorrow is covered the day it lands, and one it stops mounting drops out.

const JSXParser = Parser.extend(acornJsx())
const parseModule = (src) => JSXParser.parse(src, {
  ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true,
})

function walkAst(node, fn) {
  if (!node || typeof node.type !== 'string') return
  fn(node)
  for (const k of Object.keys(node)) {
    if (k === 'loc') continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walkAst(c, fn))
    else if (v && typeof v.type === 'string') walkAst(v, fn)
  }
}

const RESOLVE_EXT = ['', '.jsx', '.js', '/index.jsx', '/index.js']
function resolveImport(from, spec) {
  if (typeof spec !== 'string' || !spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec)
  for (const ext of RESOLVE_EXT) {
    const p = base + ext
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  return null
}
const isSourceModule = (f) => /\.jsx?$/.test(f) && !/\.test\.|__tests__|__fixtures__/.test(f)

/** Every source module reachable from `roots` by static import, re-export or lazy import(). */
export function importClosure(roots) {
  const modules = new Map()
  const unparsed = []
  const queue = [...roots]
  while (queue.length) {
    const f = queue.pop()
    if (modules.has(f)) continue
    let ast = null
    const src = readFileSync(f, 'utf8')
    try { ast = parseModule(src) } catch (e) { unparsed.push(`${posix(f)}: ${e.message}`) }
    modules.set(f, { ast, src })
    if (!ast) continue
    walkAst(ast, (n) => {
      let spec = null
      if (n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') spec = n.source?.value
      else if (n.type === 'ImportExpression' && n.source?.type === 'Literal') spec = n.source.value
      const r = resolveImport(f, spec)
      if (r && isSourceModule(r)) queue.push(r)
    })
  }
  return { modules, unparsed }
}

const jsxName = (el) => (el.openingElement?.name?.type === 'JSXIdentifier' ? el.openingElement.name.name : null)
const jsxAttr = (el, name) => el.openingElement.attributes.some((a) => a.type === 'JSXAttribute' && a.name?.name === name)
const meaningful = (children) => children.filter((c) => !(c.type === 'JSXText' && !c.value.trim())
  && !(c.type === 'JSXExpressionContainer' && c.expression.type === 'JSXEmptyExpression'))

/**
 * The three table defects in one module, each as `file:line`:
 *   unnamed  — a <table> with no aria-label / aria-labelledby and no leading <caption>;
 *   unscoped — a <th> with no scope (an empty corner cell should be a <td>: it names nothing);
 *   unsorted — a <th> whose cell sorts (an onClick naming a sort) but carries no aria-sort.
 */
export function tableFindings(file, src, ast = parseModule(src)) {
  const out = { unnamed: [], unscoped: [], unsorted: [], tables: 0 }
  walkAst(ast, (n) => {
    if (n.type !== 'JSXElement') return
    const name = jsxName(n)
    const at = `${file}:${n.loc.start.line}`
    if (name === 'table') {
      out.tables += 1
      const first = meaningful(n.children)[0]
      const caption = first?.type === 'JSXElement' && jsxName(first) === 'caption'
      if (!jsxAttr(n, 'aria-label') && !jsxAttr(n, 'aria-labelledby') && !caption) out.unnamed.push(at)
    } else if (name === 'th') {
      if (!jsxAttr(n, 'scope')) out.unscoped.push(at)
      let sorts = false
      walkAst(n, (m) => {
        if (m.type === 'JSXAttribute' && m.name?.name === 'onClick' && /sort/i.test(src.slice(m.start, m.end))) sorts = true
      })
      if (sorts && !jsxAttr(n, 'aria-sort')) out.unsorted.push(at)
    }
  })
  return out
}

// ⛔ SHRINK-ONLY. A file here may carry AT MOST the stated count of each defect; fewer fails too
// ("lower the baseline"), so a fix has to say so here and the list can only get shorter. Every
// entry is a surface this lane may not edit, by name, with the reason.
const CHART_OWNER = 'owner-blocked: app/src/components/chart/** belongs to the chart workstream (forbidden to this lane)'
// ⚠️ Not visible to this rail, stated: a shared component that forwards a name prop reads as named
// here whatever its caller passes. components/mobile/ResponsiveTable.jsx takes `label`; its one
// caller, journal-2-0's NotesTableView (Notebook-owned, forbidden to this lane), does not pass it yet.
export const MOUNTED_BASELINE = new Map([
  // The bars-adjustment popover (reached through the Chart panel's StockChart).
  ['components/chart/AdjustmentLabel.jsx', { unnamed: 1, unscoped: 4, unsorted: 0, why: CHART_OWNER }],
  // The builder's Evidence tab (reached through the chart's builder sheet).
  ['components/chart/builder/EvidenceTab.jsx', { unnamed: 1, unscoped: 6, unsorted: 0, why: CHART_OWNER }],
])

const DEFECTS = ['unnamed', 'unscoped', 'unsorted']

describe('mounted surfaces — every table the terminal reaches by import', () => {
  let closure
  let findings
  beforeAll(() => {
    closure = importClosure(ROOTS.flatMap((r) => walk(r)).filter(isSourceModule))
    findings = new Map()
    for (const [abs, { ast, src }] of closure.modules) {
      if (!ast || !src.includes('<t')) continue
      const f = tableFindings(posix(abs), src, ast)
      if (f.tables || f.unscoped.length) findings.set(posix(abs), f)
    }
  }, 120_000)

  it('follows real imports past the terminal (non-vacuity) and parses every module', () => {
    const files = [...closure.modules.keys()].map(posix)
    expect(files).toContain('pages/research/tabs/PeopleTab.jsx')
    expect(files).toContain('pages/optionsAnalytics/StrategyScreensPanel.jsx')
    expect(files).toContain('pages/FlowScoreboard.jsx')
    expect(closure.unparsed).toEqual([])
    const tables = [...findings.values()].reduce((s, f) => s + f.tables, 0)
    expect(tables).toBeGreaterThanOrEqual(60)
  })

  it('every mounted table is named, every header cell scoped, every sorting header says which way', () => {
    const problems = []
    for (const [file, f] of findings) {
      const allowed = MOUNTED_BASELINE.get(file)
      for (const d of DEFECTS) {
        const cap = allowed?.[d] ?? 0
        if (f[d].length > cap) problems.push(`${d}: ${f[d].join(', ')}${cap ? ` (baseline allows ${cap})` : ''}`)
        else if (f[d].length < cap) problems.push(`${file} ${d}: ${f[d].length} < baseline ${cap} — lower MOUNTED_BASELINE (shrink-only)`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('every baseline entry is still mounted and still has a reason', () => {
    const stale = [...MOUNTED_BASELINE].filter(([file, b]) => !findings.has(file) || !b.why)
      .map(([file]) => `${file}: no longer in the terminal's import closure (or has no reason) — drop it`)
    expect(stale).toEqual([])
  })

  it('CONTROL: each defect is SEEN, a caption or label clears it, and a comment is not a table', () => {
    const f = tableFindings('x', [
      'export const A = () => (<div>',
      '  {/* a <table> in a comment is not one */}',
      '  <table className={s}><thead><tr><th>Name</th><th onClick={() => onSort(1)}>Px</th></tr></thead></table>',
      '  <table aria-label="Named"><tbody><tr><th scope="row" /></tr></tbody></table>',
      '  <table>',
      '    <caption>Captioned</caption>',
      '    <thead><tr><th scope="col" aria-sort="none" onClick={() => toggleSort(2)}>Sorted</th></tr></thead>',
      '  </table>',
      '</div>)',
    ].join('\n'))
    expect(f.tables).toBe(3)
    expect(f.unnamed).toEqual(['x:3'])
    expect(f.unscoped).toEqual(['x:3', 'x:3'])
    expect(f.unsorted).toEqual(['x:3'])
  })
})

// ── 6. Panel-instance ids and form-control names (2026-10-09, lane w9-7) ────────────────────
//
// A board can hold two copies of one panel (two ETF panels, two CHK panels), so a LITERAL `id`
// inside a panel is a duplicate id the moment the second copy opens: `aria-labelledby` and
// `htmlFor` then point at whichever copy came first. Panel ids come from `useId()`. The shell's
// own singletons (BoardsMenu, FirstRunCard) live outside these two roots and are not checked.
//
// And every form control a panel draws has a name a screen reader can read: an aria-label /
// aria-labelledby / title, a wrapping <label>, or an `id` that a <label htmlFor> in the same file
// names (compared as source text, so `${ids}-entry` matches `${ids}-entry`).
// DERIVED like the rest of this file: every .jsx under the roots, every run.

const PANEL_ROOTS = [join(SRC, 'pages', 'terminal', 'panels'), join(SRC, 'components', 'terminal')]
const inPanelRoots = (f) => PANEL_ROOTS.some((r) => f.startsWith(r + sep))
const CONTROLS = new Set(['input', 'select', 'textarea', 'Input', 'Select'])

const attrOf = (el, name) => el.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name?.name === name)
const isLiteralValue = (a) => a?.value?.type === 'Literal'
  || (a?.value?.type === 'JSXExpressionContainer' && a.value.expression.type === 'TemplateLiteral'
    && a.value.expression.expressions.length === 0)
  || (a?.value?.type === 'JSXExpressionContainer' && a.value.expression.type === 'Literal')

/** `file:line` of every DOM element (lowercase tag) carrying a literal `id`. */
export function literalIdOffenders(file, src, ast = parseModule(src)) {
  const out = []
  walkAst(ast, (n) => {
    if (n.type !== 'JSXElement') return
    const name = jsxName(n)
    if (!name || name[0] !== name[0].toLowerCase()) return
    if (isLiteralValue(attrOf(n, 'id'))) out.push(`${file}:${n.loc.start.line}`)
  })
  return out
}

/** `file:line` of every form control with no accessible name in its own file. */
export function unnamedControlOffenders(file, src, ast = parseModule(src)) {
  const text = (a) => (a?.value ? src.slice(a.value.start, a.value.end).replace(/^\{|\}$/g, '') : null)
  const labelFor = new Set()
  walkAst(ast, (n) => {
    if (n.type === 'JSXElement' && jsxName(n) === 'label') {
      const f = text(attrOf(n, 'htmlFor'))
      if (f) labelFor.add(f)
    }
  })
  const out = []
  const visit = (node, underLabel) => {
    if (!node || typeof node.type !== 'string') return
    let inside = underLabel
    if (node.type === 'JSXElement') {
      const name = jsxName(node)
      if (name === 'label') inside = true
      if (CONTROLS.has(name)) {
        const type = text(attrOf(node, 'type'))
        const named = inside || ['aria-label', 'aria-labelledby', 'title'].some((k) => attrOf(node, k))
          || (attrOf(node, 'id') && labelFor.has(text(attrOf(node, 'id'))))
        if (!named && type !== '"hidden"') out.push(`${file}:${node.loc.start.line}`)
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue
      const v = node[k]
      if (Array.isArray(v)) v.forEach((c) => visit(c, inside))
      else if (v && typeof v.type === 'string') visit(v, inside)
    }
  }
  visit(ast, false)
  return out
}

describe('panels — per-instance ids and named form controls', () => {
  const parsed = () => JSX.map((f) => ({ f, src: readFileSync(f, 'utf8') })).map((x) => ({ ...x, ast: parseModule(x.src) }))

  it('walks the panels that carry ids and controls (non-vacuity)', () => {
    const files = JSX.filter(inPanelRoots).map(posix)
    for (const p of ['EtfPanel', 'CheckPanel', 'SizePanel', 'PlanPanel', 'ScatterPanel']) {
      expect(files).toContain(`pages/terminal/panels/${p}.jsx`)
    }
    const controls = parsed().reduce((s, { src, ast }) => {
      let c = 0
      walkAst(ast, (n) => { if (n.type === 'JSXElement' && CONTROLS.has(jsxName(n))) c += 1 })
      return s + c
    }, 0)
    expect(controls).toBeGreaterThanOrEqual(10)
  })

  it('no literal id inside a panel (two copies of a panel must not share one)', () => {
    const off = parsed().filter(({ f }) => inPanelRoots(f)).flatMap(({ f, src, ast }) => literalIdOffenders(posix(f), src, ast))
    expect(off).toEqual([])
  })

  it('every terminal form control has an accessible name', () => {
    const off = parsed().flatMap(({ f, src, ast }) => unnamedControlOffenders(posix(f), src, ast))
    expect(off).toEqual([])
  })

  it('CONTROL: each check SEES its defect', () => {
    const src = [
      'export const A = ({ ids }) => (<div>',
      '  <h3 id="fixed-title">T</h3>',
      '  <h3 id={`${ids}-title`}>T</h3>',
      '  <Section id="setup" />',
      '  <label htmlFor={`${ids}-entry`}>Entry</label>',
      '  <Input id={`${ids}-entry`} />',
      '  <Input id={`${ids}-stop`} />',
      '  <label>Y axis <Select value={v} /></label>',
      '  <select aria-label="Period" />',
      '  <input type="hidden" />',
      '</div>)',
    ].join('\n')
    expect(literalIdOffenders('x', src)).toEqual(['x:2'])
    expect(unnamedControlOffenders('x', src)).toEqual(['x:7'])
  })
})
