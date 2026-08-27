// app/src/components/chart/builder/EvidenceTab.rails.test.js
//
// ─── THE NAKED-HIT-RATE RULE, IN THE SOURCE ─────────────────────────────────
// Spec §4: never a naked hit rate. The component test proves a horizon without
// a baseline is refused; THIS file proves the WORDS cannot drift: every string
// in EvidenceTab.jsx that says "win rate" says "vs" in the SAME string. An AST
// over the file, never a grep — a grep reports comments, and comments are not
// what a member reads.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

// ⚠️ `fileURLToPath(new URL('./EvidenceTab.jsx', import.meta.url))` THROWS
// HERE — "The URL must be of scheme file". Vite's asset plugin statically
// rewrites that exact literal form into a served asset URL, so `import.meta.url`
// is an http: URL under this environment's transform. Both facts are already
// measured in this repo: `editor/CodeEditor.test.jsx` (same directory) and
// `engine/__tests__/singleWriterIndex.test.js`. `import.meta.dirname` is the
// form that works, and it is the one CodeEditor.test.jsx uses.
const FILE = path.join(import.meta.dirname, 'EvidenceTab.jsx')

export function stringsOf(source) {
  const ast = Parser.extend(jsx()).parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const out = []
  ;(function walk(node) {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'Literal' && typeof node.value === 'string') out.push(node.value)
    if (node.type === 'JSXText') out.push(node.value)
    if (node.type === 'TemplateElement') out.push(node.value.cooked ?? node.value.raw)
    for (const key of Object.keys(node)) {
      const v = node[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v.type === 'string') walk(v)
    }
  })(ast)
  return out
}

export const WIN_RATE = /win\s*rate/i
export const VS = /\bvs\.?\b/i
export function nakedWinRateStrings(source) {
  return stringsOf(source).filter((s) => WIN_RATE.test(s) && !VS.test(s))
}

describe('EvidenceTab never says "win rate" without "vs" in the same string', () => {
  const src = fs.readFileSync(FILE, 'utf8')
  it('every string that says win rate says vs', () => {
    expect(nakedWinRateStrings(src)).toEqual([])
  })
  it('…and the file does say win rate somewhere, so the rail measured something', () => {
    expect(stringsOf(src).some((s) => WIN_RATE.test(s))).toBe(true)
  })
  it('CONTROL: the checker flags a planted naked win rate in a literal, JSX text and a template', () => {
    const planted = 'const a = "Win rate"; const b = <th>win rate</th>; const c = `win rate ${1}`; const ok = <th>Win rate vs baseline</th>'
    expect(nakedWinRateStrings(planted)).toHaveLength(3)
  })
})

// ─── THE SENTENCE THE ROUTE ADDED FOR THIS TAB IS ACTUALLY READ ─────────────
//
// `api/routers/definition_record.py` ships `hit_rate_means` at the top level of
// every response, beside `claim` and never inside it, and its own docstring says
// why: "the Evidence tab renders this within inches of the backtest's
// strategy/baseline pair and an unlabelled percentage there reads as
// performance". A component that never reads that key renders the naked hit rate
// the field exists to prevent — and the component test can only catch that while
// a fixture happens to carry the key. This reads the SOURCE, so the coupling to
// the route's field name cannot quietly lapse.
//
// ⚠️ It asserts a member expression (`something.hit_rate_means`), not a
// substring: `lesson_three_rosters_disagree_on_who_reports_today` — groundedness
// is a named FIELD PATH, never a substring of prose. A comment mentioning the
// field would satisfy a grep and satisfy nothing else.
export function readsMemberNamed(source, name) {
  const ast = Parser.extend(jsx()).parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  let found = 0
  ;(function walk(node) {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'MemberExpression' && !node.computed
        && node.property && node.property.type === 'Identifier'
        && node.property.name === name) found += 1
    for (const key of Object.keys(node)) {
      const v = node[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v.type === 'string') walk(v)
    }
  })(ast)
  return found
}

describe('EvidenceTab reads the record own hit_rate_means', () => {
  const src = fs.readFileSync(FILE, 'utf8')
  it('the field is READ, as a field, at least once', () => {
    expect(readsMemberNamed(src, 'hit_rate_means')).toBeGreaterThan(0)
  })
  it('and hit_rate itself is read too, so the pair is what the rail measured', () => {
    expect(readsMemberNamed(src, 'hit_rate')).toBeGreaterThan(0)
  })
  it('CONTROL: a comment naming the field does not satisfy it, and an unrelated field is not seen', () => {
    const commentOnly = '// hit_rate_means is important\nconst s = "hit_rate_means"; export const x = 1'
    expect(readsMemberNamed(commentOnly, 'hit_rate_means')).toBe(0)
    expect(readsMemberNamed('const q = a.hit_rate_means', 'hit_rate_means')).toBe(1)
    expect(readsMemberNamed(src, 'no_such_field_anywhere')).toBe(0)
  })
})

// ─── EVERY STATE HAS A SENTENCE, AND NO SENTENCE IS EMPTY ───────────────────
//
// ⭐ The rail asserts the WORDS, not the guard. A branch that renders
// `data-testid="evidence-job-error"` around an empty span passes every
// state-only check and tells the member nothing. This walks the JSX and, for
// each element carrying one of the tab's `data-testid` literals, requires real
// prose inside it — either directly or from a child element.
function jsxOwnersOfTestids(source) {
  const ast = Parser.extend(jsx()).parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const out = new Map()
  ;(function walk(node) {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'JSXElement') {
      const attrs = node.openingElement?.attributes || []
      for (const a of attrs) {
        if (a.type !== 'JSXAttribute' || a.name?.name !== 'data-testid') continue
        const v = a.value
        const literal = v && v.type === 'Literal' ? v.value : null
        if (typeof literal === 'string') out.set(literal, node)
      }
    }
    for (const key of Object.keys(node)) {
      const v = node[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v.type === 'string') walk(v)
    }
  })(ast)
  return out
}

/** Prose is a JSXText run of at least `min` non-space characters anywhere
 *  inside the element — the words a member would actually read. */
function proseWithin(node, min = 12) {
  let best = ''
  ;(function walk(n) {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'JSXText') {
      const t = String(n.value).replace(/\s+/g, ' ').trim()
      if (t.replace(/[^A-Za-z]/g, '').length > best.replace(/[^A-Za-z]/g, '').length) best = t
    }
    for (const key of Object.keys(n)) {
      const v = n[key]
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v.type === 'string') walk(v)
    }
  })(node)
  return best.replace(/[^A-Za-z]/g, '').length >= min ? best : null
}

// The states whose whole job is to SAY something. A receipt row renders numbers
// and is covered by the component test; these render words and nothing else, so
// an empty one is invisible to every other rail in the lane.
const SPEAKING_STATES = [
  'evidence-not-saved',
  'evidence-no-hash',
  'evidence-request-refused',
  'evidence-poll-refused',
  'evidence-running',
  'evidence-job-error',
  'evidence-job-unknown',
  'evidence-hash-mismatch',
  'evidence-bars-broken',
  'evidence-record-hit-rate-withheld',
]

describe('every state that exists to SAY something actually says it', () => {
  const src = fs.readFileSync(FILE, 'utf8')
  const owners = jsxOwnersOfTestids(src)

  it('CONTROL: the walker finds the tab own root testid, so it can see this file', () => {
    expect(owners.has('evidence-tab')).toBe(true)
    expect(owners.size).toBeGreaterThan(8)
  })

  it.each(SPEAKING_STATES)('%s renders a sentence', (id) => {
    const node = owners.get(id)
    expect(node, `no JSX element carries data-testid="${id}"`).toBeTruthy()
    expect(proseWithin(node), `data-testid="${id}" renders no prose`).toBeTruthy()
  })

  it('CONTROL: the prose check rejects an empty branch and accepts a real one', () => {
    const empty = jsxOwnersOfTestids('const a = <p data-testid="x"><span /></p>')
    expect(proseWithin(empty.get('x'))).toBeNull()
    const full = jsxOwnersOfTestids('const a = <p data-testid="x">The study failed before it started.</p>')
    expect(proseWithin(full.get('x'))).toBeTruthy()
  })
})

// A last guard on the file's own identity: the module lives where both doors
// (W5a.6/W5a.7) will import it from.
describe('EvidenceTab lives where its two doors will look for it', () => {
  it('the source file exists beside this rail', () => {
    expect(fs.existsSync(FILE)).toBe(true)
    expect(path.basename(FILE)).toBe('EvidenceTab.jsx')
  })
})
