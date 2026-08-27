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

// ─── EVERY STATE HAS A SENTENCE, AND NO SENTENCE IS EMPTY ───────────────
//
// ⭐ The rail asserts the WORDS, not the guard. A branch that renders
// `data-testid="evidence-job-error"` around an empty span passes every
// state-only check and tells the member nothing.
//
// ⛔⛔ AND THE LIST OF STATES IS DERIVED, NOT TYPED. Fix round 1: the previous
// version hand-typed `SPEAKING_STATES` with a non-vacuity control but no
// ANTI-ROT control, and it had already rotted — `evidence-record-error` renders
// prose and was missing from it while its twin `evidence-poll-refused` was in.
// A list that can silently fall behind the file it measures is the
// `lesson_a_gate_list_drifts_like_any_other_artifact` shape. So the set is now
// DERIVED from the file (`role="alert"` / `role="status"` is the structural
// marker for "this element exists to say something") and the hand list is kept
// only as documentation that must EQUAL the derived one.

/** Every element carrying a `data-testid`, keyed by what that testid IS.
 *
 *  ⚠️ THE TEMPLATE ARM IS THE WHOLE POINT. The previous walker matched only
 *  `Literal`, so it was blind BY CONSTRUCTION to every
 *  ``data-testid={`evidence-horizon-${h.horizon}`}`` in the file — the same
 *  family as X10's `specifiersOf` — and would have reported "no horizon row has
 *  a testid" as cheerfully as it reported the truth. Template testids are now
 *  recorded by SHAPE, with `${}` standing in for each hole.
 *
 *  A testid this walk cannot know statically (an identifier threaded through a
 *  helper, e.g. `Refusal`'s `data-testid={testid}`) is counted separately rather
 *  than dropped: a population that is invisible must at least be a KNOWN size.
 */
function testidElements(source) {
  const ast = Parser.extend(jsx()).parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const literal = new Map()
  const template = new Map()
  const dynamic = []
  const attrOf = (node, name) => (node.openingElement?.attributes || []).find(
    (a) => a.type === 'JSXAttribute' && a.name?.name === name)
  const push = (map, key, node) => {
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(node)
  }
  ;(function walk(node) {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'JSXElement') {
      const a = attrOf(node, 'data-testid')
      if (a) {
        const v = a.value
        if (v && v.type === 'Literal' && typeof v.value === 'string') {
          push(literal, v.value, node)
        } else if (v && v.type === 'JSXExpressionContainer'
                   && v.expression?.type === 'TemplateLiteral') {
          push(template, v.expression.quasis.map((q) => q.value.cooked).join('${}'), node)
        } else {
          dynamic.push(node)
        }
      }
    }
    for (const key of Object.keys(node)) {
      const val = node[key]
      if (Array.isArray(val)) val.forEach(walk)
      else if (val && typeof val.type === 'string') walk(val)
    }
  })(ast)
  return { literal, template, dynamic, attrOf }
}

/** `role="alert"` / `role="status"` — the structural marker this file uses for
 *  "this element's job is to say something to a member". */
function speaksAloud(node, attrOf) {
  const a = attrOf(node, 'role')
  const v = a && a.value
  return !!(v && v.type === 'Literal' && (v.value === 'alert' || v.value === 'status'))
}

/** Prose is a JSXText run of at least `min` letters anywhere inside the element
 *  — the words a member would actually read. */
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

// Documentation, and nothing more: the ANTI-ROT case below asserts this equals
// the set derived from the file, so it cannot quietly fall behind again.
const SPEAKING_STATES = [
  'evidence-not-saved',
  'evidence-no-hash',
  'evidence-not-enabled',
  'evidence-request-refused',
  'evidence-poll-refused',
  'evidence-running',
  'evidence-job-error',
  'evidence-job-unknown',
  'evidence-hash-mismatch',
  'evidence-bars-broken',
  // ⭐ FOUND BY THE ANTI-ROT CASE ON ITS FIRST RUN: the no-detail fallback in
  // `Refused` is a role=alert state with its own words, and the hand list this
  // replaced had never had it. Exactly the drift the derivation exists to stop.
  'evidence-refused-detail',
  'evidence-record-error',
  'evidence-record-hit-rate-withheld',
]

describe('every state that exists to SAY something actually says it', () => {
  const src = fs.readFileSync(FILE, 'utf8')
  const { literal, template, dynamic, attrOf } = testidElements(src)
  const derived = [...literal.entries()]
    .filter(([, nodes]) => nodes.some((node) => speaksAloud(node, attrOf)))
    .map(([id]) => id)

  it('⛔ ANTI-ROT: the documented list IS the set the file actually speaks', () => {
    expect([...derived].sort(),
      'a state that renders role="alert"/"status" and is not in SPEAKING_STATES is '
      + 'a sentence nothing checks; one in the list that the file no longer renders '
      + 'is a rail measuring an empty set').toEqual([...SPEAKING_STATES].sort())
  })

  it('CONTROL: the walker can see this file at all', () => {
    expect(literal.has('evidence-tab')).toBe(true)
    expect(derived.length).toBeGreaterThan(8)
  })

  it.each(SPEAKING_STATES)('%s renders a sentence', (id) => {
    const nodes = literal.get(id)
    expect(nodes, `no JSX element carries data-testid="${id}"`).toBeTruthy()
    // EVERY branch that reuses the testid must speak — `evidence-running` has two.
    for (const node of nodes) {
      expect(proseWithin(node), `one data-testid="${id}" branch renders no prose`).toBeTruthy()
    }
  })

  it('⚠️ the walker is NOT blind to template-literal testids', () => {
    // The horizon rows key on `${h.horizon}`; the old Literal-only walker saw none
    // of them and could not have told the difference between that and a file with
    // no rows at all.
    const shapes = [...template.keys()]
    expect(shapes).toContain('evidence-horizon-${}')
    expect(shapes).toContain('evidence-horizon-${}-naked')
    expect(shapes).toContain('evidence-horizon-${}-withheld')
  })

  it('CONTROL: the walker classifies literal, template and dynamic testids apart', () => {
    const probe = testidElements(
      'const a = <p data-testid="lit" />; const b = <p data-testid={`t-${x}-u`} />;'
      + ' const c = <p data-testid={someId} />')
    expect([...probe.literal.keys()]).toEqual(['lit'])
    expect([...probe.template.keys()]).toEqual(['t-${}-u'])
    expect(probe.dynamic).toHaveLength(1)
  })

  it('the helper-routed testids are a KNOWN population, not an invisible one', () => {
    // `Refusal` takes `testid` as a prop, so its `data-testid={testid}` cannot be
    // resolved by a static walk. That is one element, and it is pinned here so a
    // second helper cannot start hiding states from the derivation above.
    expect(dynamic).toHaveLength(1)
  })

  it('CONTROL: the prose check rejects an empty branch and accepts a real one', () => {
    const empty = testidElements('const a = <p data-testid="x"><span /></p>')
    expect(proseWithin(empty.literal.get('x')[0])).toBeNull()
    const full = testidElements('const a = <p data-testid="x">The study failed before it started.</p>')
    expect(proseWithin(full.literal.get('x')[0])).toBeTruthy()
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
