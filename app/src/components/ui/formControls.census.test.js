// app/src/components/ui/formControls.census.test.js
//
// ─── TERM-067 · THE FORM-CONTROL CENSUS ─────────────────────────────────────────
//
// FB-S10-03 asks for "one set of input, select, checkbox and field-error
// primitives" and its own `Known it worked.` field says the honest first step is
// a census. This is that census: every form control in `app/src`, read off the
// AST, by KIND, by IMPLEMENTATION, with the duplication clusters and a label-
// association count.
//
//     cd app && npx vitest run src/components/ui/formControls.census.test.js
//
// ── WHAT COUNTS AS A CONTROL SITE (read off the AST, never grepped) ─────────────
//
//   native   a lowercase `<input>`, `<select>` or `<textarea>` JSX element. An
//            `<input>` takes its kind from a LITERAL `type` (absent = text); a
//            `type={expr}` is kind `dynamic`, never guessed.
//   aria     any JSX element carrying a LITERAL control `role` (switch, checkbox,
//            radio, slider, spinbutton, combobox, searchbox, textbox,
//            menuitemcheckbox, menuitemradio) — a hand-rolled widget.
//   pressed  any JSX element carrying `aria-pressed` — a hand-rolled toggle
//            button (segmented controls are made of these).
//   primitive a JSX use of a component DEFINED under `components/ui/` whose own
//            body renders a control site. The set is DERIVED by reading that
//            directory, never typed, so a primitive added tomorrow is seen the
//            day it lands.
//
// `role="listbox"` is NOT a control site: it is almost always the popup of a
// combobox, and counting both would count one widget twice. It is printed on its
// own line so the number is visible rather than silently dropped.
//
// Sites INSIDE `components/ui/` are the primitives' own implementation — the one
// place a raw control is supposed to live — so they are excluded from the page
// population, exactly as `lib/presentation/` is excluded from the TERM-066
// formatter census. A rail below proves that exclusion is load-bearing.
//
// ── LABEL ASSOCIATION (a count, not a gate) ────────────────────────────────────
//
// A site that needs an accessible name is LABELLED when any of these hold:
// `aria-label` / `aria-labelledby` / `title` present · an ancestor `<label>` ·
// an `id` matched by a `<label htmlFor>` in the same file (a dynamic `id` counts
// only if the file has a dynamic `htmlFor`) · for a button-based widget, visible
// text content. Otherwise it is PLACEHOLDER-ONLY (a placeholder is not a label),
// INDETERMINATE (a `{...spread}` may carry the name — the census cannot see it,
// so it says so instead of guessing) or UNLABELLED. Hidden inputs (`type=hidden`,
// `hidden`, `aria-hidden`) need no name and are counted apart.
//
// ── WHAT BLOCKS, AND WHAT ONLY PRINTS ──────────────────────────────────────────
//
// ⛔ Lesson from TERM-066's first ratchet: a ratchet over something every lane
// adds routinely (every `<input>`, every checkbox) fails OTHER sessions' PRs by
// name. So NOTHING in this file blocks on a kind, an implementation or a label
// count. They are PRINTED. The only blocking rail is the narrow switch ratchet
// further down this file, over the single family TERM-067 retires.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = (() => {
  let dir = HERE
  for (;;) {
    if (fs.existsSync(path.join(dir, 'app', 'package.json'))) return dir
    const up = path.dirname(dir)
    if (up === dir) throw new Error('could not find the repo root above ' + HERE)
    dir = up
  }
})()
export const PRIMITIVE_DIR = 'app/src/components/ui/'
export const PARTNER_OWNED = ['app/src/pages/OptionsFlow.jsx']
const CODE_EXT = /\.(js|jsx|mjs|cjs)$/

const JsxParser = Parser.extend(jsx())
export const parse = (src) => JsxParser.parse(src, {
  ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true,
})

// ── vocabulary ──────────────────────────────────────────────────────────────────

const NATIVE = new Set(['input', 'select', 'textarea'])
const TEXT_TYPES = new Set(['text', 'search', 'email', 'password', 'url', 'tel'])
const DATE_TYPES = new Set(['date', 'time', 'datetime-local', 'month', 'week'])
const BUTTON_TYPES = new Set(['submit', 'button', 'reset', 'image'])
export const CONTROL_ROLES = {
  switch: 'switch',
  checkbox: 'checkbox',
  menuitemcheckbox: 'checkbox',
  radio: 'radio',
  menuitemradio: 'radio',
  slider: 'range',
  spinbutton: 'number',
  combobox: 'select',
  searchbox: 'text',
  textbox: 'text',
}

/** Kind of a native `<input>` from its `type` attribute node (or its absence). */
export function inputKind(typeAttr) {
  if (!typeAttr) return 'text'
  const v = typeAttr.value
  if (v == null) return 'text'
  if (v.type !== 'Literal' || typeof v.value !== 'string') return 'dynamic'
  const t = v.value.toLowerCase()
  if (TEXT_TYPES.has(t)) return 'text'
  if (DATE_TYPES.has(t)) return 'date'
  if (BUTTON_TYPES.has(t)) return 'button-input'
  if (t === 'number') return 'number'
  if (t === 'range') return 'range'
  if (t === 'checkbox') return 'checkbox'
  if (t === 'radio') return 'radio'
  if (t === 'file') return 'file'
  if (t === 'color') return 'color'
  if (t === 'hidden') return 'hidden'
  return 'other'
}

// ── AST helpers ─────────────────────────────────────────────────────────────────

const elName = (opening) => {
  const n = opening?.name
  if (!n) return null
  if (n.type === 'JSXIdentifier') return n.name
  if (n.type === 'JSXMemberExpression') {
    let o = n; const parts = []
    while (o.type === 'JSXMemberExpression') { parts.unshift(o.property.name); o = o.object }
    if (o.type === 'JSXIdentifier') parts.unshift(o.name)
    return parts.join('.')
  }
  return null
}
const attrs = (opening) => opening.attributes.filter((a) => a.type === 'JSXAttribute')
const attrName = (a) => (a.name.type === 'JSXIdentifier' ? a.name.name
  : `${a.name.namespace.name}:${a.name.name.name}`)
const getAttr = (opening, name) => attrs(opening).find((a) => attrName(a) === name)
const literalOf = (a) => {
  if (!a || a.value == null) return undefined
  if (a.value.type === 'Literal') return a.value.value
  if (a.value.type === 'JSXExpressionContainer' && a.value.expression.type === 'Literal') {
    return a.value.expression.value
  }
  if (a.value.type === 'JSXExpressionContainer' && a.value.expression.type === 'TemplateLiteral'
    && a.value.expression.expressions.length === 0) return a.value.expression.quasis[0].value.cooked
  return undefined
}
const hasSpread = (opening) => opening.attributes.some((a) => a.type === 'JSXSpreadAttribute')

const isCapital = (s) => typeof s === 'string' && /^[A-Z]/.test(s)
const FN_TYPES = new Set(['ArrowFunctionExpression', 'FunctionExpression'])
/** The capitalised component a definition node introduces, or null. */
function componentName(node) {
  if (node.type === 'FunctionDeclaration' && isCapital(node.id?.name)) return node.id.name
  if (node.type === 'VariableDeclarator' && isCapital(node.id?.name) && node.init) {
    let init = node.init
    // memo(...) / forwardRef(...) / React.memo(...) wrap the real function
    while (init.type === 'CallExpression' && init.arguments.length) init = init.arguments[0]
    if (FN_TYPES.has(init.type)) return node.id.name
  }
  return null
}

/** Visible text content of a JSX element's children (non-whitespace text or an expression). */
function hasTextContent(el) {
  for (const c of el.children || []) {
    if (c.type === 'JSXText' && c.value.trim()) return true
    if (c.type === 'JSXExpressionContainer' && c.expression.type !== 'JSXEmptyExpression') return true
    if (c.type === 'JSXElement' && hasTextContent(c)) return true
    if (c.type === 'JSXFragment' && hasTextContent(c)) return true
  }
  return false
}

/**
 * Walk keeping two stacks: enclosing JSX element names (for `<label>` ancestry)
 * and enclosing capitalised component definitions (for wrapper detection).
 */
function walk(node, visit, st = { els: [], defs: [] }) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) walk(n, visit, st); return }
  if (typeof node.type !== 'string') return
  visit(node, st)
  const def = componentName(node)
  const isEl = node.type === 'JSXElement'
  if (def) st.defs.push({ name: def, node })
  if (isEl) st.els.push(elName(node.openingElement))
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'range') continue
    if (v && typeof v === 'object') walk(v, visit, st)
  }
  if (isEl) st.els.pop()
  if (def) st.defs.pop()
}

// ── one file ────────────────────────────────────────────────────────────────────

/**
 * Every control site in one source text.
 * ⛔ Takes SOURCE, not a path, so the controls below can plant a site without
 * touching the tree. Comments never reach the AST and a string is a Literal, not
 * a JSX element — so prose that mentions `<input>` is not counted, and a control
 * below proves it.
 *
 * `primitiveNames` (optional) is the set of local identifiers in THIS file that
 * are imports of a derived primitive; a JSX use of one is a `primitive` site.
 */
export function scanSource(src, { primitiveNames = new Set() } = {}) {
  const ast = parse(src)
  const htmlForLiterals = new Set()
  let htmlForDynamic = 0
  walk(ast, (n) => {
    if (n.type !== 'JSXOpeningElement' || elName(n) !== 'label') return
    const hf = getAttr(n, 'htmlFor')
    if (!hf) return
    const lit = literalOf(hf)
    if (typeof lit === 'string') htmlForLiterals.add(lit); else htmlForDynamic++
  })

  const sites = []
  const defs = []           // capitalised definitions, with how many sites they hold
  const listboxes = []
  walk(ast, (n, st) => {
    const def = componentName(n)
    if (def) defs.push({ name: def, node: n, sites: 0, elements: 0 })
    if (n.type !== 'JSXElement') return
    const inner = st.defs[st.defs.length - 1]
    const innerDef = inner ? defs.find((d) => d.node === inner.node) : null
    if (innerDef) innerDef.elements++
    const op = n.openingElement
    const name = elName(op)
    const role = literalOf(getAttr(op, 'role'))
    const line = op.loc?.start?.line ?? n.start

    let kind = null; let impl = null
    if (NATIVE.has(name)) {
      impl = 'native'
      if (name === 'select') kind = 'select'
      else if (name === 'textarea') kind = 'textarea'
      else kind = inputKind(getAttr(op, 'type'))
      if (typeof role === 'string' && CONTROL_ROLES[role]) kind = CONTROL_ROLES[role]
    } else if (typeof role === 'string' && CONTROL_ROLES[role]) {
      impl = 'aria'; kind = CONTROL_ROLES[role]
    } else if (getAttr(op, 'aria-pressed')) {
      impl = 'pressed'; kind = 'toggle-button'
    } else if (name && primitiveNames.has(name)) {
      impl = 'primitive'; kind = `primitive:${name}`
    } else if (role === 'listbox') {
      listboxes.push({ line })
    }
    if (!impl) return
    if (innerDef) innerDef.sites++

    // ── label association ─────────────────────────────────────────────────────
    let label
    const hiddenInput = kind === 'hidden' || getAttr(op, 'hidden') || literalOf(getAttr(op, 'aria-hidden')) === true
      || literalOf(getAttr(op, 'aria-hidden')) === 'true'
    if (kind === 'button-input') label = 'n/a'
    else if (hiddenInput) label = 'hidden'
    // ⛔ A PRIMITIVE IS JUDGED LIKE THE NATIVE CONTROL IT RENDERS. This branch used
    // to answer `primitive` for every use of one, so moving an unnamed `<input>`
    // onto `<Input>` made "unlabelled" go DOWN with no name added — the count
    // improved by migration alone. The primitives forward `aria-label`, `id` and
    // `title` untouched, so the same evidence is on the JSX and is read the same way.
    else if (getAttr(op, 'aria-label') || getAttr(op, 'aria-labelledby') || getAttr(op, 'title')) label = 'labelled'
    // `visit` runs BEFORE the element pushes itself, so `st.els` is exactly its ancestors
    else if (st.els.includes('label')) label = 'labelled'
    else if ((() => {
      const id = getAttr(op, 'id')
      if (!id) return false
      const lit = literalOf(id)
      return typeof lit === 'string' ? htmlForLiterals.has(lit) : htmlForDynamic > 0
    })()) label = 'labelled'
    else if (impl !== 'native' && impl !== 'primitive' && hasTextContent(n)) label = 'labelled'
    else if (hasSpread(op)) label = 'indeterminate'
    else if (getAttr(op, 'placeholder')) label = 'placeholder-only'
    else label = 'unlabelled'

    sites.push({
      kind, impl, name, role: typeof role === 'string' ? role : null, line, label,
      component: inner ? inner.name : null,
      signature: signatureOf(n, kind, impl),
    })
  })
  const localWrappers = defs
    .filter((d) => d.sites === 1 && d.elements <= 6)
    .map((d) => d.name)
  const controlDefs = defs.filter((d) => d.sites > 0).map((d) => d.name)
  return { sites, listboxes: listboxes.length, localWrappers, controlDefs }
}

/**
 * A structural signature for clustering hand-rolled duplicates: the element, its
 * role/type literals, whether the state attribute is present, and the element
 * names of its direct children. Labels, handlers and values are deliberately NOT
 * in it — they differ at every call site; the SHAPE is what gets copied.
 */
export function signatureOf(el, kind, impl) {
  const op = el.openingElement
  const kids = (el.children || []).filter((c) => c.type === 'JSXElement')
    .map((c) => elName(c.openingElement)).join(',')
  const flags = ['aria-checked', 'aria-pressed', 'className', 'style']
    .filter((a) => getAttr(op, a)).join(',')
  const type = literalOf(getAttr(op, 'type'))
  return `${impl}:${kind} <${elName(op)}${type ? ` type=${type}` : ''}> [${flags}] > (${kids})`
}

// ── the population ──────────────────────────────────────────────────────────────

/** Repo-relative, forward slashes, sorted. ⛔ Asked of git; a failed git read
 *  throws rather than returning [] — every rail here would pass over nothing. */
export function allCodeFiles() {
  const out = execFileSync('git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'app/src'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return [...new Set(out.split('\n').map((l) => l.trim()).filter(Boolean))]
    .filter((p) => CODE_EXT.test(p))
    .filter((p) => !/\.(test|spec)\.[cm]?jsx?$/.test(p))
    .filter((p) => !p.split('/').includes('__tests__'))
    .filter((p) => fs.existsSync(path.join(ROOT, p)))
    .sort()
}

const stripExt = (p) => p.replace(/\.(jsx?|mjs|cjs)$/, '').replace(/\/index$/, '')

/**
 * The shared primitives, DERIVED: every capitalised definition under
 * `components/ui/` whose own body renders a control site. Returns
 * { 'app/src/components/ui/Switch': Set(['Switch']) , ... } keyed by
 * extensionless path.
 */
export function derivePrimitives(files = allCodeFiles()) {
  const out = {}
  for (const f of files.filter((p) => p.startsWith(PRIMITIVE_DIR))) {
    const { controlDefs } = scanSource(fs.readFileSync(path.join(ROOT, f), 'utf8'))
    if (controlDefs.length) out[stripExt(f)] = new Set(controlDefs)
  }
  return out
}

/** Local names in `src` that import a derived primitive. */
export function primitiveImportsOf(file, src, primitives) {
  const names = new Set()
  const ast = parse(src)
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue
    const spec = node.source.value
    if (typeof spec !== 'string' || !spec.startsWith('.')) continue
    const target = stripExt(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)))
    const defs = primitives[target]
    if (!defs) continue
    for (const s of node.specifiers) {
      let imported = null
      if (s.type === 'ImportSpecifier') imported = s.imported.name
      else if (s.type === 'ImportDefaultSpecifier') {
        imported = defs.has(s.local.name) ? s.local.name : (defs.size === 1 ? [...defs][0] : null)
      }
      if (imported && defs.has(imported)) names.add(s.local.name)
    }
  }
  return names
}

let _census = null
/** { files, perFile: {file -> scan}, parseFailures, primitives } over the page population. */
export function census() {
  if (_census) return _census
  const all = allCodeFiles()
  const primitives = derivePrimitives(all)
  const files = all.filter((p) => !p.startsWith(PRIMITIVE_DIR))
  const perFile = {}
  const parseFailures = []
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    try {
      const primitiveNames = primitiveImportsOf(f, src, primitives)
      const r = scanSource(src, { primitiveNames })
      if (r.sites.length || r.listboxes || r.localWrappers.length) perFile[f] = r
    } catch (e) { parseFailures.push(`${f}: ${e.message}`) }
  }
  _census = { files, perFile, parseFailures, primitives }
  return _census
}

// ── the summary (pure over a census) ────────────────────────────────────────────

const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n }
export function summarise({ perFile }) {
  const byKind = Object.create(null)
  const byImpl = Object.create(null)
  const byKindImpl = Object.create(null)
  const labels = Object.create(null)
  const labelsByKind = Object.create(null)
  const unlabelledByFile = Object.create(null)
  const clusters = Object.create(null)
  const wrapperDefs = Object.create(null)
  let total = 0; let listboxes = 0
  for (const [f, r] of Object.entries(perFile)) {
    listboxes += r.listboxes
    for (const w of r.localWrappers) (wrapperDefs[w] ||= []).push(f)
    for (const s of r.sites) {
      total++
      bump(byKind, s.kind); bump(byImpl, s.impl); bump(byKindImpl, `${s.kind} / ${s.impl}`)
      bump(labels, s.label)
      bump((labelsByKind[s.kind] ||= Object.create(null)), s.label)
      if (s.label === 'unlabelled') bump(unlabelledByFile, f)
      if (s.impl !== 'native') {
        const c = (clusters[s.signature] ||= { sites: 0, files: new Set() })
        c.sites++; c.files.add(f)
      }
    }
  }
  return { total, listboxes, byKind, byImpl, byKindImpl, labels, labelsByKind,
    unlabelledByFile, clusters, wrapperDefs }
}

// ════════════════════════════════════════════════════════════════════════════════
// RAILS — the instrument first. A census nobody has seen fail is not a census.
// ════════════════════════════════════════════════════════════════════════════════

describe('the detector sees every kind it claims to', () => {
  const kinds = (src) => scanSource(src).sites.map((s) => `${s.kind}/${s.impl}`)

  it('classifies every native input type, select and textarea', () => {
    const src = `export const A = () => (<form>
      <input />
      <input type="text" /><input type="search" /><input type="email" /><input type="password" />
      <input type="number" /><input type="range" /><input type="date" /><input type="time" />
      <input type="checkbox" /><input type="radio" /><input type="file" /><input type="color" />
      <input type="hidden" /><input type="submit" /><input type={t} /><input type="bogus" />
      <select /><textarea />
    </form>)`
    expect(kinds(src)).toEqual([
      'text/native', 'text/native', 'text/native', 'text/native', 'text/native',
      'number/native', 'range/native', 'date/native', 'date/native',
      'checkbox/native', 'radio/native', 'file/native', 'color/native',
      'hidden/native', 'button-input/native', 'dynamic/native', 'other/native',
      'select/native', 'textarea/native',
    ])
  })

  it('classifies every hand-rolled ARIA widget and the aria-pressed toggle button', () => {
    const src = `export const A = () => (<div>
      <button role="switch" aria-checked={on} /><div role="checkbox" /><li role="menuitemcheckbox" />
      <span role="radio" /><li role="menuitemradio" /><div role="slider" /><div role="spinbutton" />
      <div role="combobox" /><div role="searchbox" /><div role="textbox" />
      <button aria-pressed={x}>Day</button>
    </div>)`
    expect(kinds(src)).toEqual([
      'switch/aria', 'checkbox/aria', 'checkbox/aria', 'radio/aria', 'radio/aria',
      'range/aria', 'number/aria', 'select/aria', 'text/aria', 'text/aria',
      'toggle-button/pressed',
    ])
  })

  it('a native input carrying a control role takes the role as its kind', () => {
    expect(kinds('const a = <input type="checkbox" role="switch" />')).toEqual(['switch/native'])
  })

  it('a listbox is counted apart, never as a second control beside its combobox', () => {
    const r = scanSource('const a = <div><div role="combobox" /><ul role="listbox" /></div>')
    expect(r.sites.map((s) => s.kind)).toEqual(['select'])
    expect(r.listboxes).toBe(1)
  })

  it('a JSX use of an imported primitive is a primitive site; the same name un-imported is not', () => {
    const src = 'const a = <div><Switch checked /><Other /></div>'
    expect(scanSource(src, { primitiveNames: new Set(['Switch']) }).sites.map((s) => s.impl))
      .toEqual(['primitive'])
    expect(scanSource(src).sites).toEqual([])
  })
})

describe('the detector reads CODE — comments and strings are not controls', () => {
  it('ignores comments and string contents — and the control proves code IS seen', () => {
    const prose = [
      '// <input type="checkbox" />',
      '/* <select><option /></select> <button role="switch" /> */',
      "const s = '<input type=\"text\" />'",
      'const t = `<textarea role="switch"></textarea>`',
      "const u = { role: 'switch', 'aria-pressed': true }",
    ].join('\n')
    expect(scanSource(prose).sites).toEqual([])
    expect(scanSource(prose + '\nconst v = <input type="checkbox" />\n').sites).toHaveLength(1)
  })

  it('a non-literal role is not guessed, and an unrelated role is not a control', () => {
    expect(scanSource('const a = <div role={r} />').sites).toEqual([])
    expect(scanSource('const a = <div role="dialog"><div role="tab" /></div>').sites).toEqual([])
  })
})

describe('label association — each rule fires, and each can fail', () => {
  const label = (src) => scanSource(src).sites.map((s) => s.label)

  it('aria-label / aria-labelledby / title / wrapping label / htmlFor all label', () => {
    expect(label('const a = <input aria-label="x" />')).toEqual(['labelled'])
    expect(label('const a = <input aria-labelledby="h" />')).toEqual(['labelled'])
    expect(label('const a = <input title="x" />')).toEqual(['labelled'])
    expect(label('const a = <label>Name <input /></label>')).toEqual(['labelled'])
    expect(label('const a = <div><label htmlFor="n">N</label><input id="n" /></div>')).toEqual(['labelled'])
    expect(label('const a = <div><label htmlFor={id}>N</label><input id={id} /></div>')).toEqual(['labelled'])
  })

  it('the negatives: bare, mismatched htmlFor, placeholder-only, spread, hidden, submit', () => {
    expect(label('const a = <input />')).toEqual(['unlabelled'])
    expect(label('const a = <div><label htmlFor="x">N</label><input id="y" /></div>')).toEqual(['unlabelled'])
    expect(label('const a = <div><label>N</label><input id={id} /></div>')).toEqual(['unlabelled'])
    expect(label('const a = <input placeholder="Search" />')).toEqual(['placeholder-only'])
    expect(label('const a = <input {...p} />')).toEqual(['indeterminate'])
    expect(label('const a = <input type="hidden" />')).toEqual(['hidden'])
    expect(label('const a = <input type="file" hidden />')).toEqual(['hidden'])
    expect(label('const a = <input type="submit" />')).toEqual(['n/a'])
  })

  it('a button widget is named by its text, and a knob-only switch is not', () => {
    expect(label('const a = <button aria-pressed={x}>Day</button>')).toEqual(['labelled'])
    expect(label('const a = <button role="switch" aria-checked={x}><span className="k" /></button>'))
      .toEqual(['unlabelled'])
    // a native element is never named by children — an <select>'s options are not its label
    expect(label('const a = <select><option>One</option></select>')).toEqual(['unlabelled'])
  })
})

describe('clustering and wrapper detection', () => {
  it('two copies of one hand-rolled shape share a signature; a different shape does not', () => {
    const a = scanSource('const a = <button type="button" role="switch" aria-checked={x} className={c}><span className={k} /></button>').sites[0]
    const b = scanSource('const b = <button type="button" role="switch" aria-checked={y} aria-label="Q" className={d} onClick={f}><span className={k2} /></button>').sites[0]
    const c = scanSource('const c = <button type="button" role="switch" aria-checked={y} style={s} />').sites[0]
    expect(a.signature).toBe(b.signature)
    expect(c.signature).not.toBe(a.signature)
  })

  it('a small component wrapping exactly one control is a local wrapper; a page is not', () => {
    const r = scanSource(`
      function Toggle({ on }) { return <button role="switch" aria-checked={on}><span /></button> }
      const Field = memo(({ v }) => <label><input value={v} /></label>)
      export default function Page() { return <div><Toggle /><input /><select /></div> }
    `)
    expect(r.localWrappers.sort()).toEqual(['Field', 'Toggle'])
    expect(r.controlDefs.sort()).toEqual(['Field', 'Page', 'Toggle'])
  })
})

describe('the population is real, and the primitive exclusion does work', () => {
  it('git returned a real tree, and parse failures are zero', () => {
    const { files, parseFailures } = census()
    expect(files.length, 'the population read returned almost nothing').toBeGreaterThan(1000)
    expect(parseFailures, 'a file the AST cannot read is a file the census cannot see').toEqual([])
  }, 120_000)

  it('names a known offender — the census is not silently empty', () => {
    const { perFile } = census()
    for (const f of PARTNER_OWNED) {
      expect(perFile[f]?.sites.length ?? 0, `${f} should carry form controls`).toBeGreaterThan(0)
    }
    // and a non-partner one, so the check does not rest on a file nobody here edits
    expect(perFile['app/src/components/chart/ChartSettingsModal.jsx']?.sites.length ?? 0).toBeGreaterThan(0)
  }, 120_000)

  it('every kind the rails plant is also found somewhere in the real tree (no dead vocabulary)', () => {
    const { byKind } = summarise(census())
    for (const k of ['text', 'textarea', 'select', 'checkbox', 'radio', 'switch', 'toggle-button', 'number', 'range', 'date']) {
      expect(byKind[k] ?? 0, `kind ${k} never occurs — is the detector blind to it?`).toBeGreaterThan(0)
    }
  }, 120_000)

  it('the primitive directory is excluded from the page population, and the exclusion is load-bearing', () => {
    const { files, primitives } = census()
    expect(files.some((f) => f.startsWith(PRIMITIVE_DIR))).toBe(false)
    // Every derived primitive really renders a control of its own — so, un-excluded,
    // the page census WOULD count it. That is what makes the exclusion do work.
    for (const [p, names] of Object.entries(primitives)) {
      const f = ['.jsx', '.js'].map((e) => p + e).find((c) => fs.existsSync(path.join(ROOT, c)))
      const own = scanSource(fs.readFileSync(path.join(ROOT, f), 'utf8'))
      expect(own.sites.length, `${p} (${[...names]}) should render a control`).toBeGreaterThan(0)
    }
  }, 120_000)
})

// ════════════════════════════════════════════════════════════════════════════════
// THE ONE BLOCKING RAIL — hand-rolled switches may not grow
// ════════════════════════════════════════════════════════════════════════════════
//
// The census names ONE family with a single copied shape and a clear primitive:
// the hand-rolled switch (`<button type="button" role="switch" aria-checked> >
// <span knob>`), now `components/ui/Switch`. Only THAT family is held to a
// baseline. A hand-rolled switch is a site of kind `switch` whose implementation
// is raw (`aria`, or a native element carrying `role="switch"`) outside
// `components/ui/`. Every other kind is printed above and blocks nothing.
//
// `handRolledSwitch.baseline.json` records, per file, how many such sites it had.
//   • a file that GREW fails by name;
//   • a NEW file with any fails by name — render `components/ui/Switch` instead;
//   • a file that SHRANK fails too, with the command that banks it, so progress
//     is locked in the commit that makes it and cannot creep back.
//
// ⛔ THE UPDATE MODE ONLY TIGHTENS. `UPDATE_SWITCH_BASELINE=1` lowers counts and
// drops files that reached zero, and REFUSES — writes nothing — if any file grew
// or appeared. Growth costs a deliberate hand edit to the JSON, with the reason in
// the commit message. (It writes a baseline from scratch only when none exists —
// the one-time bootstrap.)
//
//     cd app && UPDATE_SWITCH_BASELINE=1 npx vitest run src/components/ui/formControls.census.test.js

const SWITCH_BASELINE_PATH = path.join(HERE, 'handRolledSwitch.baseline.json')
const SWITCH_UPDATE_CMD = 'cd app && UPDATE_SWITCH_BASELINE=1 npx vitest run '
  + 'src/components/ui/formControls.census.test.js'

export const isHandRolledSwitch = (s) => s.kind === 'switch' && (s.impl === 'aria' || s.impl === 'native')

export function switchCounts({ perFile }) {
  const out = {}
  for (const [f, r] of Object.entries(perFile)) {
    const n = r.sites.filter(isHandRolledSwitch).length
    if (n > 0) out[f] = n
  }
  return out
}

/** The ratchet decision, pure. Same contract as TERM-066's `ratchetVerdict`. */
export function ratchetVerdict(current, baseline) {
  const added = []; const grew = []; const slack = []
  for (const [f, now] of Object.entries(current)) {
    if (!Object.hasOwn(baseline, f)) added.push({ file: f, now })
    else if (now > baseline[f]) grew.push({ file: f, was: baseline[f], now })
  }
  for (const [f, was] of Object.entries(baseline)) {
    const now = current[f] || 0
    if (now < was) slack.push({ file: f, was, now })
  }
  return { added, grew, slack }
}

const SWITCH_NOTE = [
  'TERM-067 HAND-ROLLED SWITCH BASELINE. Read by formControls.census.test.js.',
  'Per file: how many raw role="switch" sites it had outside components/ui/ when last written.',
  'New switches render components/ui/Switch. SHRINK-ONLY. Tightening is mechanical:',
  '  cd app && UPDATE_SWITCH_BASELINE=1 npx vitest run src/components/ui/formControls.census.test.js',
  'The update mode REFUSES to raise a count or add a file. Growth is a HAND EDIT to this',
  'file, with the reason in the commit message, so it cannot be laundered by a re-run.',
  'Keys are repo-relative with forward slashes, sorted; LF; trailing newline. The rail',
  'asserts these bytes are exactly what its writer produces.',
]

export function serializeSwitchBaseline(sites) {
  const sorted = {}
  for (const k of Object.keys(sites).sort()) sorted[k] = sites[k]
  return JSON.stringify({ note: SWITCH_NOTE, sites: sorted }, null, 2) + '\n'
}

function readSwitchBaseline() {
  // core.autocrlf=true on this box checks the file out with CRLF; the blob git
  // stores is LF, and that blob is what the byte check is about.
  const raw = fs.readFileSync(SWITCH_BASELINE_PATH, 'utf8').replace(/\r\n/g, '\n')
  return { raw, sites: JSON.parse(raw).sites }
}

const fmtList = (rows, render) => rows.map(render).join('\n  ')

if (process.env.UPDATE_SWITCH_BASELINE === '1') {
  const cur = switchCounts(census())
  if (!fs.existsSync(SWITCH_BASELINE_PATH)) {
    fs.writeFileSync(SWITCH_BASELINE_PATH, serializeSwitchBaseline(cur))
  } else {
    const { sites: base } = readSwitchBaseline()
    const v = ratchetVerdict(cur, base)
    if (v.added.length || v.grew.length) {
      throw new Error('REFUSING to update the switch baseline — it only shrinks. Grew/new:\n  '
        + fmtList([...v.grew, ...v.added], (r) => `${r.file}: ${r.was ?? 'new'} -> ${r.now}`))
    }
    const next = {}
    for (const [f, was] of Object.entries(base)) {
      const now = Math.min(was, cur[f] || 0)
      if (now > 0) next[f] = now
    }
    fs.writeFileSync(SWITCH_BASELINE_PATH, serializeSwitchBaseline(next))
  }
}

describe('the switch ratchet verdict, pure', () => {
  it('a planted new file with a switch is ADDED, by name', () => {
    const v = ratchetVerdict({ 'app/src/a.jsx': 2, 'app/src/new.jsx': 1 }, { 'app/src/a.jsx': 2 })
    expect(v.added).toEqual([{ file: 'app/src/new.jsx', now: 1 }])
    expect(v.grew).toEqual([])
    expect(v.slack).toEqual([])
  })

  it('growth is caught by name, and a shrink is slack to bank', () => {
    const v = ratchetVerdict({ 'app/src/a.jsx': 3, 'app/src/b.jsx': 1 },
      { 'app/src/a.jsx': 2, 'app/src/b.jsx': 4, 'app/src/gone.jsx': 1 })
    expect(v.grew).toEqual([{ file: 'app/src/a.jsx', was: 2, now: 3 }])
    expect(v.slack).toEqual([
      { file: 'app/src/b.jsx', was: 4, now: 1 },
      { file: 'app/src/gone.jsx', was: 1, now: 0 },
    ])
  })

  it('only the switch family counts — a native checkbox, a toggle button, a Switch use do not', () => {
    const src = `const a = <div>
      <button type="button" role="switch" aria-checked={x}><span /></button>
      <input type="checkbox" role="switch" />
      <input type="checkbox" /><button aria-pressed={y}>On</button><Switch checked />
    </div>`
    const r = scanSource(src, { primitiveNames: new Set(['Switch']) })
    expect(r.sites.filter(isHandRolledSwitch)).toHaveLength(2)
    expect(switchCounts({ perFile: { 'app/src/x.jsx': r } })).toEqual({ 'app/src/x.jsx': 2 })
  })
})

describe('the Switch primitive is derived, and its uses are counted as primitive sites', () => {
  it('components/ui/Switch is found by derivation, not by a typed roster', () => {
    const { primitives } = census()
    expect([...(primitives['app/src/components/ui/Switch'] || [])]).toEqual(['Switch'])
  }, 120_000)

  it('the migrated panels render the primitive and hold no hand-rolled switch', () => {
    const { perFile } = census()
    for (const f of ['app/src/pages/watchlist/WatchlistSettingsPanel.jsx',
      'app/src/pages/theme-tracker/ThemeTrackerSettingsPanel.jsx']) {
      const sites = perFile[f]?.sites || []
      // the Switch uses only — other primitives (Input, Select) may live on the panel too
      expect(sites.filter((s) => s.kind === 'primitive:Switch').length, f).toBe(2)
      expect(sites.filter(isHandRolledSwitch), f).toEqual([])
    }
  }, 120_000)
})

describe('⭐ HAND-ROLLED SWITCHES MAY NOT GROW', () => {
  it('no file gained a hand-rolled switch, and no new file appeared', () => {
    const { sites: base } = readSwitchBaseline()
    const v = ratchetVerdict(switchCounts(census()), base)
    expect(v.added, 'NEW hand-rolled role="switch" file(s) — render components/ui/Switch instead:\n  '
      + fmtList(v.added, (r) => `${r.file} (${r.now} site(s))`)).toEqual([])
    expect(v.grew, 'these files gained hand-rolled switches — render components/ui/Switch instead:\n  '
      + fmtList(v.grew, (r) => `${r.file}: ${r.was} -> ${r.now}`)).toEqual([])
  }, 120_000)

  it('the baseline is tight — progress is banked in the commit that makes it', () => {
    const { sites: base } = readSwitchBaseline()
    const v = ratchetVerdict(switchCounts(census()), base)
    expect(v.slack, 'these files SHRANK — bank it so it cannot creep back:\n  '
      + fmtList(v.slack, (r) => `${r.file}: ${r.was} -> ${r.now}`)
      + `\n  run: ${SWITCH_UPDATE_CMD}`).toEqual([])
  }, 120_000)

  it('the committed baseline is byte-exactly what its writer produces', () => {
    const { raw, sites } = readSwitchBaseline()
    expect(raw).toBe(serializeSwitchBaseline(sites))
  })
})

// ── the named surfaces ──────────────────────────────────────────────────────────
//
// FB-S10-03's `Known it worked.` says nothing measured form-control inconsistency,
// so "it worked" could not be told from "it shipped". This is that observable for
// the surfaces TERM-067 has migrated: every control site on them carries an
// accessible name, and stays that way.
//
// ⛔ NARROW ON PURPOSE. This is a list of surfaces somebody finished, not a rule
// over the tree — a rail over every file would fail other lanes' work by name
// (the census header records that lesson). A file joins the list in the commit
// that takes its last unnamed control away.
export const NAMED_SURFACES = [
  'app/src/components/AppThemePicker.jsx',
  'app/src/components/FeedbackWidget.jsx',
  'app/src/components/IntradayDayPopover.jsx',
  'app/src/components/TickerActions.jsx',
  'app/src/components/admin/CatalystRulesPanel.jsx',
  'app/src/components/admin/TwitterAccountsPanel.jsx',
  'app/src/components/chart/ChartDrawingOverlay.jsx',
  'app/src/components/chart/ChartSettingsModal.jsx',
  'app/src/components/chart/ChartToolbar.jsx',
  'app/src/components/chart/ComparisonPicker.jsx',
  'app/src/components/chart/builder/ParamControls.jsx',
  'app/src/components/community/ShareToFloor.jsx',
  'app/src/components/mobile/TickerHubSheet.jsx',
  'app/src/components/tiles/CatalystTable.jsx',
  'app/src/components/video/VideoDockSlot.jsx',
  'app/src/components/voice/VisionAttachButton.jsx',
  'app/src/components/voice/VoiceDocumentsPanel.jsx',
  'app/src/components/voice/VoiceMemoryPanel.jsx',
  'app/src/floor2/ChartAttach.jsx',
  'app/src/floor2/Composer.jsx',
  'app/src/floor2/ReplyBox.jsx',
  'app/src/floor2/SearchBox.jsx',
  'app/src/hub/HubReportButton.jsx',
  'app/src/pages/Admin.jsx',
  'app/src/pages/AiSearchPage.jsx',
  'app/src/pages/AlertTester.jsx',
  'app/src/pages/Confluence.jsx',
  'app/src/pages/CotData.jsx',
  'app/src/pages/DarkPool.jsx',
  'app/src/pages/LiveFlow.jsx',
  'app/src/pages/LiveFlowMassive.jsx',
  'app/src/pages/LiveFlow_admin.jsx',
  'app/src/pages/ModelBook.jsx',
  'app/src/pages/OpenFlow.jsx',
  'app/src/pages/OptionsFlow.jsx',
  'app/src/pages/OptionsFlow_admin.jsx',
  'app/src/pages/Settings.jsx',
  'app/src/pages/SetupLibrary.jsx',
  'app/src/pages/Support.jsx',
  'app/src/pages/ThemeTrackerPage.jsx',
  'app/src/pages/Watchlists.jsx',
  'app/src/pages/admin/ChartHealth.jsx',
  'app/src/pages/admin/DetectionReviewCard.jsx',
  'app/src/pages/admin/PatternReview.jsx',
  'app/src/pages/breadth/BreadthViewsCustomizePanel.jsx',
  'app/src/pages/breadth/CustomizePanel.jsx',
  'app/src/pages/calendar/CalendarHeader.jsx',
  'app/src/pages/charts/ChartsWorkspace.jsx',
  'app/src/pages/charts/CompareSymbolsPanel.jsx',
  'app/src/pages/charts/PeriodSortConfig.jsx',
  'app/src/pages/charts/ReplayPanel.jsx',
  'app/src/pages/charts/WidgetHeader.jsx',
  'app/src/pages/charts/grid/MultiChartMenu.jsx',
  'app/src/pages/charts/widgets/AlertsWidget.jsx',
  'app/src/pages/charts/widgets/ChartTabStrip.jsx',
  'app/src/pages/charts/widgets/CompanySearch.jsx',
  'app/src/pages/charts/widgets/NhnlUniverseMenu.jsx',
  'app/src/pages/charts/widgets/PickerHeader.jsx',
  'app/src/pages/charts/widgets/ScatterWidget.jsx',
  'app/src/pages/charts/widgets/VolumeScanLists.jsx',
  'app/src/pages/community/ChatView.jsx',
  'app/src/pages/community/CommunityPage.jsx',
  'app/src/pages/community/components/FloorSearch.jsx',
  'app/src/pages/desk/ArticlesSection.jsx',
  'app/src/pages/desk/TeamSection.jsx',
  'app/src/pages/modelbook/SetupsView.jsx',
  'app/src/pages/modelbook/shared/ChartExampleKit.jsx',
  'app/src/pages/research/components/ComparisonAskAi.jsx',
  'app/src/pages/research/tabs/AskAiTab.jsx',
  'app/src/pages/screener/ScreensManager.jsx',
  'app/src/pages/screener/shell/FlaggedActions.jsx',
  'app/src/pages/screener/shell/SaveScanButton.jsx',
  'app/src/pages/settings/JoystickSettingsCard.jsx',
  'app/src/pages/watchlist/WatchlistSettingsPanel.jsx',
]
const NAMED = new Set(['labelled', 'hidden', 'n/a'])
export const unnamedSites = (sites) => sites.filter((s) => !NAMED.has(s.label))

describe('⭐ THE MIGRATED SURFACES STAY FULLY NAMED', () => {
  it('a primitive is judged like a native control — an unnamed one is NOT waved through', () => {
    const prim = { primitiveNames: new Set(['Input', 'Select', 'Checkbox', 'Switch']) }
    const labels = (src) => scanSource(src, prim).sites.map((s) => s.label)
    expect(labels('const a = <Input value={v} />')).toEqual(['unlabelled'])
    expect(labels('const a = <Input placeholder="Code" />')).toEqual(['placeholder-only'])
    expect(labels('const a = <Input aria-label="Code" />')).toEqual(['labelled'])
    expect(labels('const a = <label>Replay <Checkbox checked={x} /></label>')).toEqual(['labelled'])
    expect(labels('const a = <div><label htmlFor="f">Sort</label><Select id="f" /></div>')).toEqual(['labelled'])
    expect(labels('const a = <Select {...rest} />')).toEqual(['indeterminate'])
  })

  it('the verdict can FAIL — a planted unnamed control on a named surface is reported', () => {
    const planted = scanSource('const a = <div><input aria-label="ok" /><select /></div>')
    expect(unnamedSites(planted.sites).map((s) => `${s.kind}:${s.label}`)).toEqual(['select:unlabelled'])
  })

  it.each(NAMED_SURFACES)('%s — every control has an accessible name', (file) => {
    const { perFile } = census()
    const sites = perFile[file]?.sites || []
    expect(sites.length, `${file} holds no control sites at all — renamed, or the scan missed it`).toBeGreaterThan(0)
    expect(unnamedSites(sites).map((s) => `${s.kind}/${s.impl} ${s.label} in ${s.component}`),
      `${file} was migrated under TERM-067 and every control on it had a name. Give the new one an`
      + ' aria-label or a <label htmlFor>.').toEqual([])
  }, 120_000)
})

// ── the unnamed-site baseline ───────────────────────────────────────────────────
//
// NAMED_SURFACES holds the finished files; this holds the REST of the tree to the
// number it has reached. An unnamed site is one whose label association is
// `unlabelled` or `placeholder-only` (a placeholder is a hint, not a name — it
// disappears on the first keystroke). `indeterminate` (a spread that may carry
// the name) is not counted: the scan cannot see it either way.
//
// ⛔ SHRINK-ONLY, and TIGHT. A new unnamed control anywhere fails the first test;
// a migration that names one fails the second until the number is lowered here,
// in the commit that earned it. Never raise it — name the control instead.
//
//   2026-10-01  140  (start of the lane/term-067-batch run)
//   2026-10-01   74  (start of the lane/term-067-partner run: partner flow files)
export const UNNAMED_BASELINE = 35
export const isUnnamedForBaseline = (s) => s.label === 'unlabelled' || s.label === 'placeholder-only'
export const unnamedTotal = ({ perFile }) =>
  Object.values(perFile).reduce((n, r) => n + r.sites.filter(isUnnamedForBaseline).length, 0)

describe('⭐ UNNAMED CONTROL SITES MAY ONLY SHRINK', () => {
  it('the counter can tell a name from a hint', () => {
    const sites = scanSource('const a = <div><input placeholder="x" /><select /><input aria-label="ok" /></div>').sites
    expect(sites.filter(isUnnamedForBaseline).map((s) => s.label)).toEqual(['placeholder-only', 'unlabelled'])
  })

  it('no new unnamed control site appeared anywhere in app/src', () => {
    const c = census()
    const now = unnamedTotal(c)
    const top = Object.entries(c.perFile)
      .map(([f, r]) => [f, r.sites.filter(isUnnamedForBaseline).length]).filter(([, n]) => n)
      .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, n]) => `${n}  ${f}`)
    expect(now, `unnamed control sites grew ${UNNAMED_BASELINE} -> ${now}. Give the new control an`
      + ` aria-label or a <label htmlFor>. Most unnamed:\n  ${top.join('\n  ')}`).toBeLessThanOrEqual(UNNAMED_BASELINE)
  }, 120_000)

  it('the baseline is tight — a migration lowers UNNAMED_BASELINE in the same commit', () => {
    const now = unnamedTotal(census())
    expect(now, `unnamed control sites shrank ${UNNAMED_BASELINE} -> ${now}: set UNNAMED_BASELINE = ${now}`)
      .toBe(UNNAMED_BASELINE)
  }, 120_000)
})

// ── the census, printed ─────────────────────────────────────────────────────────

describe('the census, printed', () => {
  it('reports kinds, implementations, clusters, wrappers and label association', () => {
    const c = census()
    const s = summarise(c)
    const sortDesc = (o) => Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    const table = (o, pad = 28) => sortDesc(o).map(([k, n]) => `      ${k.padEnd(pad)} ${String(n).padStart(5)}`)
    const clusters = Object.entries(s.clusters)
      .map(([sig, v]) => [sig, v.sites, v.files.size])
      .filter(([, n, f]) => n >= 3 && f >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([sig, n, f]) => `      ${String(n).padStart(4)} sites / ${String(f).padStart(3)} files  ${sig}`)
    const dupWrappers = Object.entries(s.wrapperDefs)
      .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
      .map(([n, fs_]) => `      ${n.padEnd(22)} x${fs_.length}${fs_.length > 1 ? '  ' + fs_.join(' · ') : ''}`)
    const partner = PARTNER_OWNED.map((f) => `    partner-owned (counted, not dropped): ${f} = ${c.perFile[f]?.sites.length ?? 0} sites`)
    const topUnlabelled = sortDesc(s.unlabelledByFile).slice(0, 10)
      .map(([f, n]) => `      ${String(n).padStart(4)}  ${f}`)
    const prims = Object.entries(c.primitives).map(([p, n]) => `${p} {${[...n].join(', ')}}`)
    console.log([
      '[term-067 form-control census]',
      `    population ${c.files.length} files · with controls ${Object.values(c.perFile).filter((r) => r.sites.length).length} · sites ${s.total} · listbox popups (not counted) ${s.listboxes}`,
      `    derived primitives (${PRIMITIVE_DIR}): ${prims.length ? prims.join(' · ') : 'NONE'}`,
      ...partner,
      '    by kind:', ...table(s.byKind),
      '    by implementation:', ...table(s.byImpl),
      '    by kind / implementation:', ...table(s.byKindImpl),
      '    hand-rolled switches (the ONE ratcheted family):',
      ...sortDesc(switchCounts(c)).map(([f, n]) => `      ${String(n).padStart(4)}  ${f}`),
      '    label association:', ...table(s.labels),
      '    label association, by kind:',
      ...sortDesc(Object.fromEntries(Object.entries(s.labelsByKind).map(([k, o]) => [k, Object.values(o).reduce((a, b) => a + b, 0)])))
        .map(([k]) => `      ${k.padEnd(16)} ${sortDesc(s.labelsByKind[k]).map(([l, n]) => `${l}=${n}`).join(' ')}`),
      '    most unlabelled sites:', ...topUnlabelled,
      '    duplication clusters (hand-rolled shape, >=3 sites in >=2 files):', ...clusters,
      '    local wrapper components (one control, <=6 elements):', ...dupWrappers,
    ].join('\n'))
    expect(s.total).toBeGreaterThan(0)
  }, 120_000)
})
