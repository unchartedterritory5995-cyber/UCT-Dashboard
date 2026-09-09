// ⛔ THE RAW-ERROR CLASS — a structural rail, because this defect has now
// shipped twice.
//
// Wave B removed raw backend/provider exception text from member-facing UI in
// three places. Wave H reintroduced it in TickerResearchWorkspace:
//
//     alert(`Could not create note: ${e.message || e}`)
//
// Two failures in one line: a native alert() (the modal the readiness
// scorecard already names as trust-eroding), and a raw exception rendered to a
// member — which is how a stack fragment, a provider's internal error code, or
// a 500's HTML ends up in front of someone who wanted to write a note.
//
// A fix that is not railed has a shelf life; this one lasted a single wave.
//
// ⭐ AST, NEVER GREP. A grep for `alert(` finds the comment above, this file,
// and every doc that describes the pattern — the exact false-positive class the
// owner's instruction calls out, and the same failure `reachable.test.js`
// records ("found 5 call sites, all five of them prose"). Comments and strings
// are not AST nodes, so parsing is what makes the rail honest.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import * as acorn from 'acorn'
import jsx from 'acorn-jsx'

const Parser = acorn.Parser.extend(jsx())
const ROOT = path.resolve(__dirname)

// ⛔ SCOPE — the Notebook's own member-facing UI. This is the surface the
// integrity mini-pass owns, and the surface where the class shipped twice.
// The rest of `journal-2-0/` (the trading tabs and their modals) carries the
// SAME class in quantity; that is recorded as named debt in the gap ledger
// rather than silently swept in here or silently hidden by a narrower rail.
// Widening this list is a one-line change once that debt is scheduled.
const IN_SCOPE = [
  path.join(ROOT, 'components', 'notebook'),
  path.join(ROOT, 'tabs', 'NotebookTab.jsx'),
]
const inScope = (p) => IN_SCOPE.some((s) => p === s || p.startsWith(s + path.sep))

function sourceFiles(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__fixtures__' || entry.name === 'node_modules') continue
      sourceFiles(p, out)
    } else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) {
      out.push(p)
    }
  }
  return out
}

function parse(code) {
  return Parser.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
}

/** Walk every node, calling fn(node, ancestors). */
function walk(node, fn, ancestors = []) {
  if (!node || typeof node.type !== 'string') return
  fn(node, ancestors)
  const next = [...ancestors, node]
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue
    const v = node[key]
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn, next))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, fn, next)
  }
}

const isConsoleCall = (n) =>
  n?.type === 'CallExpression' &&
  n.callee?.type === 'MemberExpression' &&
  n.callee.object?.name === 'console'

/** Names bound by a catch clause — what "the exception" is called here. */
function catchBinding(cl) {
  const p = cl.param
  if (!p) return []
  if (p.type === 'Identifier') return [p.name]
  return [] // destructured catch params carry no whole-exception identifier
}

/** Every violation in one parsed file. */
function violations(file) {
  const code = fs.readFileSync(file, 'utf8')
  let ast
  try { ast = parse(code) } catch (e) { return [{ file, line: 0, what: `unparseable: ${e.message}` }] }
  const found = []

  walk(ast, (n, ancestors) => {
    // (A) a native alert() shown to a member, whatever it carries.
    const isAlert =
      n.type === 'CallExpression' &&
      ((n.callee.type === 'Identifier' && n.callee.name === 'alert') ||
        (n.callee.type === 'MemberExpression' &&
          n.callee.object?.name === 'window' &&
          n.callee.property?.name === 'alert'))
    if (isAlert) found.push({ file, line: n.loc.start.line, what: 'native alert() in a member-facing surface' })

    // (B) the caught exception itself reaching a STRING context — a template
    // literal, a string concat, or String(e) — anywhere but a console call.
    if (n.type !== 'CatchClause') return
    const names = catchBinding(n)
    if (!names.length) return
    walk(n.body, (m, inner) => {
      if (m.type !== 'Identifier' || !names.includes(m.name)) return
      // `e` as the whole exception, or the object of `e.message`
      const parent = inner[inner.length - 1]
      if (parent?.type === 'MemberExpression' && parent.object !== m) return // e.g. `x.e`
      if (inner.some(isConsoleCall)) return                                   // console.error(e) is correct
      // A per-item REPORT is not an error banner. `failures.push({reason})` /
      // `warnings.push(...)` is how an importer tells a member WHICH of 500
      // files failed and why — dropping the detail there makes the product
      // worse, not safer. Whether those reports should carry a raw provider
      // string at all is a real question, and a different one from this class.
      const intoReport = inner.some(
        (a) => a.type === 'CallExpression' && a.callee?.type === 'MemberExpression' && a.callee.property?.name === 'push',
      )
      if (intoReport) return
      const stringish = inner.some(
        (a) =>
          a.type === 'TemplateLiteral' ||
          (a.type === 'BinaryExpression' && a.operator === '+') ||
          (a.type === 'CallExpression' && a.callee?.name === 'String'),
      )
      if (stringish) {
        found.push({
          file,
          line: m.loc.start.line,
          what: `caught exception \`${m.name}\` rendered into a string`,
        })
      }
    })
  })
  return found
}

const FILES = sourceFiles().filter(inScope)

describe('raw-error class — member-facing surfaces never render a raw exception', () => {
  it('finds a real, non-trivial set of Notebook source files to check', () => {
    // Non-vacuity: a rail that scanned nothing would pass silently.
    expect(FILES.length).toBeGreaterThan(20)
  })

  it('no native alert(), and no caught exception rendered into member-facing text', () => {
    const all = FILES.flatMap(violations)
    const report = all
      .map((v) => `  ${path.relative(ROOT, v.file)}:${v.line} — ${v.what}`)
      .join('\n')
    expect(all, `raw-error violations:\n${report}`).toEqual([])
  })
})

describe('the rail can SEE the thing it forbids (controls)', () => {
  const scan = (code) => {
    const f = path.join(ROOT, '__rail_probe__.jsx')
    fs.writeFileSync(f, code)
    try { return violations(f) } finally { fs.unlinkSync(f) }
  }

  it('catches alert(`...${e.message}...`) — the exact Wave H regression', () => {
    const v = scan('export const f = async () => { try { await go() } catch (e) { alert(`Could not: ${e.message || e}`) } }')
    expect(v.length).toBeGreaterThan(0)
    expect(v.map((x) => x.what).join(' ')).toMatch(/alert/)
  })

  it('catches a raw exception funnelled into member state without alert()', () => {
    const v = scan('export const f = async () => { try { await go() } catch (err) { setMsg(`failed: ${err.message}`) } }')
    expect(v.map((x) => x.what).join(' ')).toMatch(/rendered into a string/)
  })

  it('does NOT flag a COMMENT that describes the forbidden pattern', () => {
    // This is the false-positive class the instruction names, and the reason
    // this rail parses instead of grepping. The fix's own explanatory comment
    // in TickerResearchWorkspace.jsx quotes `alert(...e.message...)` verbatim.
    const v = scan('// alert(`Could not create note: ${e.message || e}`)\nexport const f = () => 1')
    expect(v).toEqual([])
  })

  it('does NOT flag a STRING that mentions the pattern', () => {
    const v = scan('export const DOC = "never write alert(e.message) here"')
    expect(v).toEqual([])
  })

  it('does NOT flag console.error(e) — the engineer still needs the exception', () => {
    const v = scan('export const f = async () => { try { await go() } catch (e) { console.error("x", e); setMsg("Something went wrong.") } }')
    expect(v).toEqual([])
  })

  it('does NOT flag safe copy that mentions no exception at all', () => {
    const v = scan('export const f = async () => { try { await go() } catch (e) { setMsg(`Couldn\'t save. Nothing changed.`) } }')
    expect(v).toEqual([])
  })
})
