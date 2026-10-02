/**
 * Wave 11 (lane 11B): the formula expression language — the CLIENT's half.
 *
 * Its server twin is `api/services/journal_two/formula_engine.py`; the grammar,
 * the limits and every error CODE are the same, and both test suites read ONE
 * shared vector file (`./formulaVectors.json`), so the editor's live preview and
 * the server that sorts a table cannot disagree about what a formula means.
 *
 * ⛔⛔ NO `eval`, NO `new Function`, NO `Function(...)`, NO string `setTimeout`,
 * NO dynamic property access with the member's text. The text is only matched
 * against a fixed token grammar, and an identifier that is not one of the five
 * function names is an error — so `constructor`, `__proto__` and `prototype`
 * name nothing. `formulaEngine.noEval.test.js` scans this file and also spies on
 * the globals while every vector runs.
 *
 * Grammar (whitespace is space, tab, CR, LF):
 *   formula    := comparison END
 *   comparison := additive [ ("<"|"<="|">"|">="|"="|"!=") additive ]   (yields 1 or 0)
 *   additive   := term { ("+"|"-") term }
 *   term       := unary { ("*"|"/") unary }
 *   unary      := ("-"|"+") unary | primary
 *   primary    := NUMBER | REF | FUNC "(" [ comparison {"," comparison} ] ")" | "(" comparison ")"
 *   REF        := "{Name}" (as the member types it) | "{@propertyId}" (as it is stored)
 *   FUNC       := round | abs | min | max | if
 */

export const MAX_LENGTH = 2000
export const MAX_TOKENS = 500
export const MAX_DEPTH = 32
export const MAX_NUMBER_CHARS = 32
export const MAX_ARGS = 32
export const MAX_ROUND_PLACES = 10
export const MAX_REF_CHARS = 100

// ⛔ A Map, never an object literal: `FUNCTIONS[word]` on a plain object would
// answer for `constructor` and `__proto__`. A Map answers only for its keys.
const FUNCTIONS = new Map([
  ['round', [1, 2]],
  ['abs', [1, 1]],
  ['min', [1, MAX_ARGS]],
  ['max', [1, MAX_ARGS]],
  ['if', [3, 3]],
])
export const FUNCTION_NAMES = Object.freeze([...FUNCTIONS.keys()])
const COMPARISONS = new Set(['<', '<=', '>', '>=', '=', '!='])

const NUMBER_RE = /(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/y
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y
const ID_RE = /^[A-Za-z0-9_:-]{1,64}$/
const WS = ' \t\r\n'

export class FormulaError extends Error {
  constructor(code, message, position = null) {
    super(message)
    this.name = 'FormulaError'
    this.code = code
    this.position = position
  }
}

export class FormulaEvalError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FormulaEvalError'
    this.code = code
  }
}

const isDigit = (ch) => ch >= '0' && ch <= '9'
const isAlpha = (ch) => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')

// ── Tokenizer ─────────────────────────────────────────────────────────────────

export function tokenize(text) {
  if (typeof text !== 'string') throw new FormulaError('syntax', 'A formula must be text')
  if (text.length > MAX_LENGTH) {
    throw new FormulaError('too_long', `A formula can be at most ${MAX_LENGTH} characters long`)
  }
  const out = []
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (WS.includes(ch)) { i += 1; continue }
    if (out.length >= MAX_TOKENS) {
      throw new FormulaError('too_many_tokens', `A formula can have at most ${MAX_TOKENS} parts`)
    }
    if (isDigit(ch) || ch === '.') {
      NUMBER_RE.lastIndex = i
      const m = NUMBER_RE.exec(text)
      if (!m) throw new FormulaError('syntax', `Unexpected "." at character ${i + 1}`, i)
      const raw = m[0]
      if (raw.length > MAX_NUMBER_CHARS) {
        throw new FormulaError('number_too_large', `The number at character ${i + 1} is too long`, i)
      }
      const value = Number(raw)
      if (!Number.isFinite(value)) {
        throw new FormulaError('number_too_large', `The number at character ${i + 1} is too large`, i)
      }
      out.push({ kind: 'num', value, pos: i })
      i += raw.length
      continue
    }
    if (ch === '{') {
      const close = text.indexOf('}', i + 1)
      const inner = close < 0 ? '' : text.slice(i + 1, close)
      if (close < 0 || inner.includes('{')) {
        throw new FormulaError('syntax', `The property at character ${i + 1} is missing its closing }`, i)
      }
      const label = inner.trim()
      if (!label) throw new FormulaError('syntax', `Empty property name at character ${i + 1}`, i)
      if (label.length > MAX_REF_CHARS) {
        throw new FormulaError('syntax', `The property name at character ${i + 1} is too long`, i)
      }
      if (label.startsWith('@')) {
        const pid = label.slice(1).trim()
        if (!ID_RE.test(pid)) throw new FormulaError('syntax', `Not a property id at character ${i + 1}`, i)
        out.push({ kind: 'ref', value: { kind: 'id', key: pid }, pos: i })
      } else {
        out.push({ kind: 'ref', value: { kind: 'name', key: label }, pos: i })
      }
      i = close + 1
      continue
    }
    if (ch === '}') throw new FormulaError('syntax', `Unexpected } at character ${i + 1}`, i)
    if (isAlpha(ch) || ch === '_') {
      IDENT_RE.lastIndex = i
      const word = IDENT_RE.exec(text)[0]
      out.push({ kind: 'ident', value: word, pos: i })
      i += word.length
      continue
    }
    const two = text.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '!=') {
      out.push({ kind: 'op', value: two, pos: i })
      i += 2
      continue
    }
    if ('<>=+-*/'.includes(ch)) { out.push({ kind: 'op', value: ch, pos: i }); i += 1; continue }
    if (ch === '(') { out.push({ kind: 'lp', value: ch, pos: i }); i += 1; continue }
    if (ch === ')') { out.push({ kind: 'rp', value: ch, pos: i }); i += 1; continue }
    if (ch === ',') { out.push({ kind: 'comma', value: ch, pos: i }); i += 1; continue }
    throw new FormulaError('syntax', `Unexpected character ${JSON.stringify(ch)} at character ${i + 1}`, i)
  }
  return out
}

// ── Parser ────────────────────────────────────────────────────────────────────
// AST: {t:'num',v} · {t:'ref',kind,key} · {t:'neg',a} · {t:'pos',a}
//      {t:'bin',op,a,b} · {t:'cmp',op,a,b} · {t:'call',name,args}

function describe(tok) {
  if (tok.kind === 'num') return 'number'
  if (tok.kind === 'ref') return 'property'
  return `"${tok.value}"`
}

function parseTokens(tokens) {
  let i = 0
  let depth = 0
  const peek = () => (i < tokens.length ? tokens[i] : null)
  const take = () => { const tok = tokens[i]; i += 1; return tok }
  const where = () => { const t = peek(); return t ? `at character ${t.pos + 1}` : 'at the end' }
  const enter = () => {
    depth += 1
    if (depth > MAX_DEPTH) throw new FormulaError('too_deep', `A formula can nest at most ${MAX_DEPTH} levels deep`)
  }
  const leave = () => { depth -= 1 }

  function comparison() {
    const left = additive()
    const tok = peek()
    if (tok && tok.kind === 'op' && COMPARISONS.has(tok.value)) {
      take()
      const right = additive()
      const nxt = peek()
      if (nxt && nxt.kind === 'op' && COMPARISONS.has(nxt.value)) {
        throw new FormulaError('syntax', `Compare two things at a time (${describe(nxt)} ${where()})`, nxt.pos)
      }
      return { t: 'cmp', op: tok.value, a: left, b: right }
    }
    return left
  }
  function additive() {
    let node = term()
    for (;;) {
      const tok = peek()
      if (tok && tok.kind === 'op' && (tok.value === '+' || tok.value === '-')) {
        take()
        node = { t: 'bin', op: tok.value, a: node, b: term() }
      } else return node
    }
  }
  function term() {
    let node = unary()
    for (;;) {
      const tok = peek()
      if (tok && tok.kind === 'op' && (tok.value === '*' || tok.value === '/')) {
        take()
        node = { t: 'bin', op: tok.value, a: node, b: unary() }
      } else return node
    }
  }
  function unary() {
    const tok = peek()
    if (tok && tok.kind === 'op' && (tok.value === '-' || tok.value === '+')) {
      take()
      enter()
      const inner = unary()
      leave()
      return { t: tok.value === '-' ? 'neg' : 'pos', a: inner }
    }
    return primary()
  }
  function primary() {
    const tok = peek()
    if (!tok) throw new FormulaError('syntax', 'The formula ends too soon')
    if (tok.kind === 'num') { take(); return { t: 'num', v: tok.value } }
    if (tok.kind === 'ref') { take(); return { t: 'ref', kind: tok.value.kind, key: tok.value.key } }
    if (tok.kind === 'lp') {
      take()
      enter()
      const node = comparison()
      const close = peek()
      if (!close || close.kind !== 'rp') throw new FormulaError('syntax', `Missing ) ${where()}`, close ? close.pos : null)
      take()
      leave()
      return node
    }
    if (tok.kind === 'ident') {
      const name = tok.value.toLowerCase()
      if (!FUNCTIONS.has(name)) {
        throw new FormulaError('unknown_name',
          `Unknown name "${tok.value}" at character ${tok.pos + 1}. Put a property name in braces, like {Entry}`, tok.pos)
      }
      take()
      const lp = peek()
      if (!lp || lp.kind !== 'lp') throw new FormulaError('syntax', `${name} needs ( after it`, tok.pos)
      take()
      enter()
      const args = []
      if (peek() && peek().kind === 'rp') {
        take()
      } else {
        for (;;) {
          args.push(comparison())
          const sep = peek()
          if (sep && sep.kind === 'comma') { take(); continue }
          if (sep && sep.kind === 'rp') { take(); break }
          throw new FormulaError('syntax', `Missing , or ) ${where()}`, sep ? sep.pos : null)
        }
      }
      leave()
      const [lo, hi] = FUNCTIONS.get(name)
      if (args.length < lo || args.length > hi) {
        const want = lo === hi ? String(lo) : (hi - lo === 1 ? `${lo} or ${hi}` : `at least ${lo}`)
        throw new FormulaError('arity', `${name} takes ${want} value${hi !== 1 ? 's' : ''}, not ${args.length}`, tok.pos)
      }
      return { t: 'call', name, args }
    }
    throw new FormulaError('syntax', `Unexpected ${describe(tok)} at character ${tok.pos + 1}`, tok.pos)
  }

  if (!tokens.length) throw new FormulaError('syntax', 'The formula is empty')
  const node = comparison()
  const rest = peek()
  if (rest) throw new FormulaError('syntax', `Unexpected ${describe(rest)} ${where()}`, rest.pos)
  return node
}

export function parse(text) {
  return parseTokens(tokenize(text))
}

/** Every `{kind, key}` reference, first-seen order, once each. */
export function refsOf(node) {
  const out = []
  const seen = new Set()
  const stack = [node]
  while (stack.length) {
    const n = stack.pop()
    if (n.t === 'ref') {
      const id = `${n.kind}\u0000${n.key}`
      if (!seen.has(id)) { seen.add(id); out.push({ kind: n.kind, key: n.key }) }
    } else if (n.t === 'neg' || n.t === 'pos') stack.push(n.a)
    else if (n.t === 'bin' || n.t === 'cmp') { stack.push(n.b); stack.push(n.a) }
    else if (n.t === 'call') for (let k = n.args.length - 1; k >= 0; k -= 1) stack.push(n.args[k])
  }
  return out
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

function finite(x) {
  if (!Number.isFinite(x)) throw new FormulaEvalError('overflow', 'The result is too large to show')
  return x
}

/** Round half away from zero on the SHORTEST decimal form (String(x)) — the same
 *  digits Python's repr prints. Mirrored digit for digit in formula_engine.py. */
export function roundHalfAway(x, places) {
  if (x === 0) return 0
  const neg = x < 0
  const s = String(Math.abs(x))
  let mant = s
  let exp = 0
  const ei = s.indexOf('e')
  if (ei >= 0) { mant = s.slice(0, ei); exp = parseInt(s.slice(ei + 1), 10) }
  const dot = mant.indexOf('.')
  const ip = dot >= 0 ? mant.slice(0, dot) : mant
  const fp = dot >= 0 ? mant.slice(dot + 1) : ''
  let digits = ip + fp
  let point = ip.length + exp
  const stripped = digits.replace(/^0+/, '')
  point -= digits.length - stripped.length
  digits = stripped
  if (!digits) return 0
  const keep = point + places
  if (keep >= digits.length) return x
  if (keep < 0) return 0
  const up = digits[keep] >= '5'
  let kept = digits.slice(0, keep)
  if (up) kept = incrementDecimal(kept || '0')
  if (!kept || /^0+$/.test(kept)) return 0
  const result = Number(`${kept}e${point - keep}`)
  return neg ? -result : result
}

function incrementDecimal(s) {
  const arr = s.split('')
  let k = arr.length - 1
  while (k >= 0) {
    if (arr[k] === '9') { arr[k] = '0'; k -= 1 } else { arr[k] = String.fromCharCode(arr[k].charCodeAt(0) + 1); break }
  }
  const joined = arr.join('')
  return k < 0 ? `1${joined}` : joined.replace(/^0+(?=\d)/, '')
}

/** The number `node` stands for. `lookup(kind, key)` returns a number or throws
 *  FormulaEvalError (missing / not a number / unknown property). */
export function evaluate(node, lookup) {
  return finite(evalNode(node, lookup)) + 0 // `+ 0` turns -0 into 0
}

function evalNode(node, lookup) {
  switch (node.t) {
    case 'num': return node.v
    case 'ref': {
      const v = lookup(node.kind, node.key)
      if (typeof v !== 'number') throw new FormulaEvalError('not_number', 'A value this formula uses is not a number')
      return finite(v)
    }
    case 'neg': return -evalNode(node.a, lookup)
    case 'pos': return evalNode(node.a, lookup)
    case 'bin': {
      const a = evalNode(node.a, lookup)
      const b = evalNode(node.b, lookup)
      if (node.op === '+') return finite(a + b)
      if (node.op === '-') return finite(a - b)
      if (node.op === '*') return finite(a * b)
      if (b === 0) throw new FormulaEvalError('div_zero', 'Division by zero')
      return finite(a / b)
    }
    case 'cmp': {
      const a = evalNode(node.a, lookup)
      const b = evalNode(node.b, lookup)
      let ok
      if (node.op === '<') ok = a < b
      else if (node.op === '<=') ok = a <= b
      else if (node.op === '>') ok = a > b
      else if (node.op === '>=') ok = a >= b
      else if (node.op === '=') ok = a === b
      else ok = a !== b
      return ok ? 1 : 0
    }
    case 'call': {
      const { name, args } = node
      if (name === 'if') {
        const cond = evalNode(args[0], lookup)
        return evalNode(cond !== 0 ? args[1] : args[2], lookup)
      }
      const vals = args.map((a) => evalNode(a, lookup))
      if (name === 'abs') return Math.abs(vals[0])
      if (name === 'min') return Math.min(...vals)
      if (name === 'max') return Math.max(...vals)
      if (name === 'round') {
        let places = 0
        if (vals.length === 2) {
          const p = vals[1]
          if (p !== Math.floor(p) || p < 0 || p > MAX_ROUND_PLACES) {
            throw new FormulaEvalError('bad_round', `round's places must be a whole number from 0 to ${MAX_ROUND_PLACES}`)
          }
          places = p
        }
        return finite(roundHalfAway(vals[0], places))
      }
      break
    }
    default: break
  }
  throw new FormulaEvalError('syntax', 'Not a formula')
}

/**
 * Rewrite `{Name}` → `{@id}` (to store) using a Map keyed by the lowercased
 * name; a name mapped to null is shared by two properties.
 */
export function toStored(text, nameToId) {
  const tokens = tokenize(text)
  let out = ''
  let last = 0
  for (const tok of tokens) {
    if (tok.kind !== 'ref' || tok.value.kind !== 'name') continue
    const close = text.indexOf('}', tok.pos + 1)
    const key = tok.value.key.trim().toLowerCase()
    if (nameToId.has(key) && nameToId.get(key) === null) {
      throw new FormulaError('ambiguous_ref', `Two properties are named "${tok.value.key}"; rename one`, tok.pos)
    }
    const pid = nameToId.get(key)
    if (!pid) throw new FormulaError('unknown_ref', `No number property is named "${tok.value.key}"`, tok.pos)
    out += `${text.slice(last, tok.pos)}{@${pid}}`
    last = close + 1
  }
  return out + text.slice(last)
}

/** Rewrite `{@id}` → `{Name}` (to show). An id with no live property stays as
 *  `{@id}`, which the editor reports as a deleted property. */
export function toDisplay(text, idToName) {
  let tokens
  try { tokens = tokenize(text) } catch { return text }
  let out = ''
  let last = 0
  for (const tok of tokens) {
    if (tok.kind !== 'ref' || tok.value.kind !== 'id') continue
    const name = idToName.get(tok.value.key)
    if (!name) continue
    const close = text.indexOf('}', tok.pos + 1)
    out += `${text.slice(last, tok.pos)}{${name}}`
    last = close + 1
  }
  return out + text.slice(last)
}
