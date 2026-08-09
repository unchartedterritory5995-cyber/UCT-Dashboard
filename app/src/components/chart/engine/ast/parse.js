// ─── ONE PARSER, AND THE AST IS THE PERSISTED ARTIFACT ──────────────────────
//
// `jsep` parses ONCE, in the browser, at author time. `compute.ast` — the tree
// this file produces — is what is stored, versioned, wired and interpreted.
// **Python never parses.** It walks the same tree.
//
// The basis for that ruling, measured rather than assumed:
//   * the frontend has no parser library of any kind today, so `jsep` is a NEW
//     dependency either way;
//   * Python has no equivalent that produces the SAME tree, so a second parser
//     would be a second grammar;
//   * a hand-ported grammar is a SECOND VOCABULARY, and this repo has already
//     paid for one — `williams_r` here is `williamsR` in the chart registry,
//     which is the entire reason `_CASE_COLUMNS` exists.
//
// ⭐ THE PERSISTED SHAPE IS THE CONTRACT WITH PYTHON, AND IT IS DELIBERATELY
// SMALLER THAN jsep's: `num`, `series`, `op`, `call`, with keys drawn from
// `{type, name, value, args}` and nothing else. Python's walker therefore has
// four cases — a surface small enough to prove closed.
//
// ⛔ A STORED TREE CARRYING jsep's OWN NODE SHAPES WOULD MAKE A jsep UPGRADE A
// DATA MIGRATION. That is why `canonicalise` exists at all, and it is why the
// dependency is pinned EXACT in `package.json` the way `lightweight-charts` is.

import jsep from 'jsep'
import TABLE_JSON from './closedTable.json'

// --------------------------------------------------------------------------- //
// the table
// --------------------------------------------------------------------------- //

/** Deep-frozen so a caller cannot edit the grammar at runtime. The manifest is
 *  DATA read by two lanes; a mutation here would desynchronise them silently. */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** The imported manifest, frozen. THE one grammar. */
export const TABLE = deepFreeze(TABLE_JSON)

/** The canonical node types, and there are no others.
 *
 *  ⚠️ ASSERTED BY WALKING A PARSED TREE, never by reading this constant back —
 *  a test that reads the list it is checking measures a re-typed copy. */
export const NODE_TYPES = Object.freeze(['num', 'series', 'op', 'call'])

// --------------------------------------------------------------------------- //
// the refusals
// --------------------------------------------------------------------------- //

/** A refusal at the parse→canonical boundary. Carries the GUARD that fired.
 *
 *  ⛔ DISJOINT MESSAGES, DELIBERATELY. Two gates sharing a phrase let a
 *  `raises(match=…)` pass with the safety deleted, and that has happened in this
 *  repo. The fragments below are the ones `tests/fixtures/ast/escapes.json`
 *  declares per guard, so the census can bind a refusal to the gate that made
 *  it rather than to "something threw". */
export class TableRefusal extends Error {
  constructor(guard, message) {
    super(message)
    this.name = 'TableRefusal'
    this.guard = guard
  }
}

/** guard → the sentence it refuses with. The fragments `escapes.json` pins are
 *  each a substring of exactly one of these, and no message is a substring of
 *  another. `parse.test.js` asserts both halves. */
export const REFUSALS = Object.freeze({
  'canonicalise:array':
    'array literals have no meaning in a column formula',
  'canonicalise:this':
    '`this` names nothing this table can resolve',
  'canonicalise:member':
    'property access is not in the table',
  'canonicalise:call-target':
    'only a bare table name may be called',
  'canonicalise:assignment':
    'a formula produces a column; it does not bind a name',
  'canonicalise:compound':
    'a formula is one expression, and this is several',
  'canonicalise:empty':
    'there is nothing here to compute',
  'canonicalise:operator':
    'the parser produced a symbol this grammar never declared',
  'canonicalise:node':
    'the parser produced a construct with no canonical form',
})

const refuse = (guard) => { throw new TableRefusal(guard, REFUSALS[guard]) }

// --------------------------------------------------------------------------- //
// configure the parser FROM the table
// --------------------------------------------------------------------------- //

/** Binding power for every arity-2 operator. NOT in the manifest, because
 *  precedence is a property of the SURFACE SYNTAX and the manifest describes the
 *  tree; Python never sees an infix string and must not have to carry this.
 *
 *  ⚠️ EVERY arity-2 ENTRY OF THE TABLE MUST APPEAR HERE, and the module THROWS
 *  BY NAME if one does not. `jsep.addBinaryOp(op, undefined)` does not fail — it
 *  registers an operator with a broken binding power and silently misparses,
 *  which is the shape of defect that survives thousands of green tests. */
const PRECEDENCE = Object.freeze({
  '||': 1,
  '&&': 2,
  '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '+': 9, '-': 9,
  '*': 10, '/': 10,
})

/** The arity-1 operator names the CANONICAL tree uses, mapped to the character
 *  the SOURCE spells them with. `u-` is unary minus; `-` alone is the binary
 *  operator and they are different table entries. */
const UNARY_CANONICAL = Object.freeze({ '-': 'u-', '!': '!' })

/** The arity-3 operator: the ternary. jsep produces `ConditionalExpression` for
 *  it; the table names it `?:`. */
const TERNARY = '?:'

function binaryOpsFromTable() {
  return Object.entries(TABLE.operators)
    .filter(([, spec]) => spec.arity === 2)
    .map(([op]) => op)
}

/** ⛔ EVERY jsep FEATURE THIS TABLE DOES NOT USE IS REMOVED AT CONFIGURE TIME.
 *  Not blocked at interpret time — REMOVED, so it cannot parse.
 *
 *  A blocklist is a list of what somebody remembered; removing the operator is
 *  the absence itself. jsep 1.4.0 ships `**`, `%`, `&`, `|`, `^`, `<<`, `>>`,
 *  `>>>`, `??`, `===` and `!==` as binary operators, `~` and unary `+` as unary
 *  operators, and `null` as a literal. Not one of the fourteen has a meaning in
 *  a column formula, and every one of them would reach a walker with no case
 *  for it. */
function configureParser() {
  jsep.removeAllBinaryOps()
  for (const op of binaryOpsFromTable()) {
    const bp = PRECEDENCE[op]
    if (typeof bp !== 'number') {
      throw new Error(
        `closedTable.json declares the binary operator ${JSON.stringify(op)} but ` +
        'parse.js has no precedence for it. jsep.addBinaryOp(op, undefined) does ' +
        'not fail — it misparses — so this is a hard stop.')
    }
    jsep.addBinaryOp(op, bp)
  }

  jsep.removeAllUnaryOps()
  jsep.addUnaryOp('-')
  jsep.addUnaryOp('!')

  jsep.removeAllLiterals()
  // The table has NO boolean node type — see `_booleans` in the manifest. These
  // exist so a user may type the words; they canonicalise to num 1 / num 0.
  jsep.addLiteral('true', true)
  jsep.addLiteral('false', false)
}

configureParser()

// --------------------------------------------------------------------------- //
// the forbidden-node scan
// --------------------------------------------------------------------------- //

/** WHICH OFFENCE IS REPORTED WHEN A TREE CARRIES SEVERAL, DECLARED RATHER THAN
 *  LEFT TO TRAVERSAL ORDER.
 *
 *  `[1, 2][0]` is a MemberExpression whose object is an ArrayExpression, so a
 *  naive top-down canonicaliser refuses it as a *member read* and the message a
 *  user sees depends on which line of the walker happens to run first. Task 2
 *  wrote that ambiguity down as an open question on the `array_literal` case.
 *  This closes it: the scan collects EVERY offence in the whole tree, then
 *  reports the first one in this declared order.
 *
 *  ⚠️ The order is measured, not aesthetic — under it every case in
 *  `escapes.json` reports the guard that file declares, which is what makes the
 *  armed per-guard fragment check (Task 6's) able to mean anything. */
const OFFENCE_PRIORITY = Object.freeze([
  'canonicalise:array',
  'canonicalise:this',
  'canonicalise:member',
  'canonicalise:assignment',
  'canonicalise:call-target',
  'canonicalise:compound',
])

const JSEP_TYPE_OFFENCE = Object.freeze({
  ArrayExpression: 'canonicalise:array',
  ThisExpression: 'canonicalise:this',
  MemberExpression: 'canonicalise:member',
  AssignmentExpression: 'canonicalise:assignment',
  Compound: 'canonicalise:compound',
})

/** Every offence present anywhere in a jsep tree.
 *
 *  ITERATIVE ON PURPOSE. The escape corpus's `too_many_nodes` case is 8,001
 *  nodes deep; a recursive scan would die inside the guard rather than inside
 *  the thing being guarded, and a guard that crashes is not a refusal. */
function offencesIn(root) {
  const found = new Set()
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    if (Array.isArray(node)) { stack.push(...node); continue }
    if (!node || typeof node !== 'object') continue

    const byType = JSEP_TYPE_OFFENCE[node.type]
    if (byType) found.add(byType)

    // A SHAPE, not a type: `sma(close, 20)(1)` is a perfectly ordinary
    // CallExpression whose callee is another CallExpression. Only a bare name
    // may be called, because a callee that is itself an expression is how a
    // closed table stops being closed.
    if (node.type === 'CallExpression' && node.callee?.type !== 'Identifier') {
      found.add('canonicalise:call-target')
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') stack.push(value)
    }
  }
  return found
}

// --------------------------------------------------------------------------- //
// canonicalise
// --------------------------------------------------------------------------- //

const num = (value) => ({ type: 'num', value })
const series = (name) => ({ type: 'series', name })
const op = (name, args) => ({ type: 'op', name, args })
const call = (name, args) => ({ type: 'call', name, args })

function convert(node) {
  switch (node.type) {
    case 'Literal': {
      if (typeof node.value === 'number') return num(node.value)
      // The manifest declares `!`, `&&`, `||` and `?:` over a table whose only
      // literal is a number, so a condition IS a 0/1 column and `true`/`false`
      // are spellings of 1 and 0. See `_booleans` in closedTable.json.
      if (node.value === true) return num(1)
      if (node.value === false) return num(0)
      return refuse('canonicalise:node')
    }
    case 'Identifier':
      // ⚠️ NOT VALIDATED AGAINST `TABLE.series` HERE, ON PURPOSE. Whether a name
      // resolves is `resolve:name`'s question and `escapes.json` fates
      // `globalThis` / `toString` / `hasOwnProperty` to that guard. Refusing
      // them here would move three census cases out from under the guard that
      // is supposed to catch them and make its first zero mean less.
      return series(node.name)
    case 'UnaryExpression': {
      const name = UNARY_CANONICAL[node.operator]
      if (!name) return refuse('canonicalise:operator')
      return op(name, [convert(node.argument)])
    }
    case 'BinaryExpression': {
      // Reachable only if the parser was reconfigured behind this module's back;
      // the removal in `configureParser` is the primary defence and the ops-table
      // case in parse.test.js is what asserts the removal itself. This is the
      // belt, and it is exercised directly rather than left theoretical.
      if (TABLE.operators[node.operator]?.arity !== 2) return refuse('canonicalise:operator')
      return op(node.operator, [convert(node.left), convert(node.right)])
    }
    case 'ConditionalExpression':
      return op(TERNARY, [convert(node.test), convert(node.consequent), convert(node.alternate)])
    case 'CallExpression':
      return call(node.callee.name, (node.arguments || []).map(convert))
    default:
      return refuse('canonicalise:node')
  }
}

/** jsep's tree → the persisted tree. Four node shapes, and no others.
 *
 *  ⛔ MemberExpression, ArrayExpression, Compound, ThisExpression and
 *  AssignmentExpression are REFUSED HERE BY NAME, each with its own message.
 *  Refusal is decided by a WHOLE-TREE scan (see `OFFENCE_PRIORITY`) so the
 *  message a user sees never depends on which branch the walker reached first.
 *
 *  Throws `TableRefusal`. `parseFormula` is the door that never throws. */
export function canonicalise(node) {
  if (!node || typeof node !== 'object') return refuse('canonicalise:node')
  if (node.type === 'Compound' && (node.body || []).length === 0) {
    return refuse('canonicalise:empty')
  }
  const offences = offencesIn(node)
  for (const guard of OFFENCE_PRIORITY) {
    if (offences.has(guard)) return refuse(guard)
  }
  return convert(node)
}

// --------------------------------------------------------------------------- //
// parseFormula
// --------------------------------------------------------------------------- //

/** Parse. NEVER throws — returns a tagged result.
 *
 *  ⛔ A THROW FROM A PARSER REACHES THE BUILDER AS A BLANK SCREEN. The spec's
 *  instance-state inventory has ten states and none of them is "the page died";
 *  the failure state is a red dot on the chip with the message in the tooltip.
 *  And a parse failure is the NORMAL case here, not the exceptional one — the
 *  whole surface is a text box a user is halfway through typing into.
 *
 *  @returns {{ok: true, ast: object} | {ok: false, error: string, guard?: string}}
 */
export function parseFormula(source) {
  if (typeof source !== 'string' || source.trim() === '') {
    return { ok: false, error: REFUSALS['canonicalise:empty'], guard: 'canonicalise:empty' }
  }
  let tree
  try {
    tree = jsep(source)
  } catch (err) {
    // jsep's own syntax errors ("Unexpected \"=\" at character 2", "Expected )
    // at character 10"). They are the user's message, unedited — a rewritten
    // one loses the character offset the text box needs.
    return { ok: false, error: String(err && err.message ? err.message : err), guard: 'parser' }
  }
  try {
    return { ok: true, ast: canonicalise(tree) }
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      guard: err instanceof TableRefusal ? err.guard : 'canonicalise:node',
    }
  }
}

// --------------------------------------------------------------------------- //
// the hash that decides a rev bump
// --------------------------------------------------------------------------- //

/** Canonical JSON: keys SORTED, no whitespace, and NOTHING optional.
 *
 *  ⚠️ `JSON.stringify` DROPS `undefined` — silently, from objects, and to `null`
 *  inside arrays. The canonical form therefore has NO optional keys, and this
 *  refuses anything that is not a string, a finite number, an array or a plain
 *  object rather than serialising it into a hole. B5 shipped a fixture asserting
 *  an absent key and it was vacuous until it was round-tripped through real
 *  JSON; this is that lesson as a hard stop. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`astHash: ${String(value)} has no JSON form; a canonical tree carries finite numbers only`)
    }
    return JSON.stringify(value)
  }
  throw new Error(
    `astHash: a canonical tree carries strings, finite numbers, arrays and objects only — got ${
      value === undefined ? 'undefined' : typeof value}`)
}

const CANONICAL_KEYS = Object.freeze({
  num: ['type', 'value'],
  series: ['type', 'name'],
  op: ['type', 'name', 'args'],
  call: ['type', 'name', 'args'],
})

/** The tree really is one of the four shapes, with exactly its own keys.
 *
 *  This runs INSIDE `astHash` because the hash is taken of the PERSISTED
 *  artifact — a blob that arrived over a wire or out of a database, not
 *  necessarily one this module produced a millisecond ago. */
export function assertCanonical(ast) {
  const stack = [ast]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error(`astHash: not a canonical node: ${JSON.stringify(node) ?? String(node)}`)
    }
    const expected = CANONICAL_KEYS[node.type]
    if (!expected) {
      throw new Error(
        `astHash: node type ${JSON.stringify(node.type)} is not one of ${NODE_TYPES.join(', ')}`)
    }
    const keys = Object.keys(node).sort()
    const want = [...expected].sort()
    if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) {
      throw new Error(
        `astHash: a ${node.type} node must carry exactly [${want}] — got [${keys}]`)
    }
    if (node.args !== undefined) {
      if (!Array.isArray(node.args)) throw new Error('astHash: `args` must be an array')
      stack.push(...node.args)
    }
  }
  return ast
}

// ─── sha256, in ~50 lines, because the alternative is a dependency ──────────
//
// `crypto.subtle.digest` is ASYNC and this signature is not; `node:crypto` does
// not exist in the browser bundle. The whole input is one short JSON string.
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x, n) => (x >>> n) | (x << (32 - n))

export function sha256Hex(text) {
  const msg = new TextEncoder().encode(text)
  const blocks = Math.floor((msg.length + 8) / 64) + 1
  const buf = new Uint8Array(blocks * 64)
  buf.set(msg)
  buf[msg.length] = 0x80
  const dv = new DataView(buf.buffer)
  const bits = msg.length * 8
  dv.setUint32(buf.length - 8, Math.floor(bits / 4294967296))
  dv.setUint32(buf.length - 4, bits >>> 0)

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)

  for (let i = 0; i < buf.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4)
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15]
      const y = w[t - 2]
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K256[t] + w[t]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('')
}

/** `'sha256:<64 hex>'` over the canonical JSON of a canonical tree.
 *
 *  ⭐ THIS HASH DECIDES WHETHER AN EDIT BUMPS `compute.rev`, and a rev bump
 *  force-migrates every binding, resets `last_value` and suppresses a cycle. An
 *  UNSTABLE hash would migrate a user's alerts on a save that changed nothing —
 *  so key order, whitespace and argument spacing must not reach it, and a real
 *  semantic change must. */
export function astHash(ast) {
  assertCanonical(ast)
  return `sha256:${sha256Hex(stableStringify(ast))}`
}
