// Shared fixtures for the W5-T6 rails. ⛔ No key is committed: the HMAC keys come from the
// environment (PINE_RUNTIME_TEST_SECRET / PINE_RUNTIME_TEST_SECRET_2) and, when unset, are drawn
// fresh from the OS RNG for this process only.
import { createHash, randomBytes } from 'node:crypto'
import { barsSha256, BAR_COLUMNS } from '../protocol.mjs'
// W5-T7b: the seal's codec in the rails is T3's own module (the service reads the bundle's copy of it)
import { columnDigest, decodeColumn } from '../../../app/src/components/chart/engine/runtime/columnDigest.js'

export const SECRET = process.env.PINE_RUNTIME_TEST_SECRET || randomBytes(32).toString('hex')
export const SECRET_2 = process.env.PINE_RUNTIME_TEST_SECRET_2 || randomBytes(32).toString('hex')

export const IDENTITY = Object.freeze({
  script_engine: 5, runtime_language: 'pine', runtime_frontend: 1, runtime_ir: 1,
  bundle_sha256: 'ab'.repeat(32),
})
export const TFS = Object.freeze(['1', '5', '15', '30', '60', 'D', 'W', 'M'])
export const CODEC = Object.freeze({ columnDigest, decodeColumn })
export const DOOR = Object.freeze({ identity: IDENTITY, codec: CODEC, tfSet: TFS, maxBars: 32768 })

export function f64b64(values) {
  const b = Buffer.alloc(values.length * 8)
  values.forEach((x, i) => b.writeDoubleLE(x, i * 8))
  return b.toString('base64')
}

/** Bars in wire form, with a correct hash. */
export function barsWire(n = 5) {
  const cols = {
    t: Array.from({ length: n }, (_, i) => 1_700_000_000_000 + i * 86_400_000),
    o: Array.from({ length: n }, (_, i) => 100 + i),
    h: Array.from({ length: n }, (_, i) => 101 + i),
    l: Array.from({ length: n }, (_, i) => 99 + i),
    c: Array.from({ length: n }, (_, i) => 100.5 + i),
    v: Array.from({ length: n }, (_, i) => 1000 * (i + 1)),
  }
  const wire = { n }
  const bytes = {}
  for (const k of BAR_COLUMNS) { wire[k] = f64b64(cols[k]); bytes[k] = Buffer.from(wire[k], 'base64') }
  wire.sha256 = barsSha256(n, bytes)
  return wire
}

export const DOC_TEXT = JSON.stringify({ compute: { fn: 'runtime', source: '//@version=5\nindicator("x")\nplot(close)' }, id: 'u_0123456789ab' })

export function validRequest({ jobs = 2, doc = DOC_TEXT } = {}) {
  return {
    protocol: 1,
    profile: 'alert',
    engine: { ...IDENTITY },
    definition: {
      def_id: 'u_0123456789ab', version: 7,
      doc_sha256: createHash('sha256').update(Buffer.from(doc, 'utf8')).digest('hex'), doc,
    },
    owner: 'hmac:9f1c0123456789ab',
    jobs: Array.from({ length: jobs }, (_, i) => ({
      job: `SYM${i}|D`,
      symbol: { ticker: `SYM${i}`, exchange: 'NASDAQ' },
      tf: 'D',
      bars: barsWire(5),
      ctx: { newestBarIsForming: false, historyFromListing: true, runtimeInputs: { length: 14 } },
      want: ['value'],
    })),
  }
}

/** A deterministic PRNG (mulberry32), so a fuzz failure names a seed that reproduces it. */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Paths whose value may legally take more than one JSON type, and the open-keyed map. */
const MULTI_TYPED = new Map([
  ['engine.script_engine', ['number', 'string']], ['engine.runtime_language', ['number', 'string']],
  ['engine.runtime_frontend', ['number', 'string']], ['engine.runtime_ir', ['number', 'string']],
  ['definition.doc', ['string', 'null']],
])
const OPTIONAL = new Set(['want', 'runtimeInputs'])
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)
const SAMPLES = { null: null, number: 7, string: 'x', boolean: true, array: [], object: {} }

function nodes(v, path = '', out = []) {
  out.push({ path, value: v })
  if (path.endsWith('runtimeInputs')) return out
  if (Array.isArray(v)) v.forEach((x, i) => nodes(x, `${path}[${i}]`, out))
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) nodes(v[k], path ? `${path}.${k}` : k, out)
  return out
}
const norm = (p) => p.replace(/^jobs\[\d+\]/, 'jobs[]')

function setAt(root, path, fn) {
  const parts = path.match(/[^.[\]]+/g)
  let o = root
  for (const p of parts.slice(0, -1)) o = o[p]
  fn(o, parts[parts.length - 1])
}

/**
 * One mutation that MUST make a valid request invalid at the schema (400): an unknown key, a
 * wrong JSON type, a missing required key, a truncated text, or a non-UTF-8 byte.
 * Returns { name, body: Buffer }.
 */
export function mutate(rand) {
  const req = validRequest()
  const all = nodes(req).filter((n) => n.path !== '')
  const pick = (xs) => xs[Math.floor(rand() * xs.length)]
  const op = Math.floor(rand() * 5)
  if (op === 0) {
    const objs = [{ path: '', value: req }, ...all.filter((n) => typeOf(n.value) === 'object' && !n.path.endsWith('runtimeInputs'))]
    const n = pick(objs)
    n.value.zz_unknown = 1
    return { name: `extra key at ${n.path || 'body'}`, body: Buffer.from(JSON.stringify(req)) }
  }
  if (op === 1) {
    const n = pick(all)
    const allowed = MULTI_TYPED.get(n.path) || [typeOf(n.value)]
    const wrong = Object.keys(SAMPLES).filter((t) => !allowed.includes(t))
    const t = pick(wrong)
    setAt(req, n.path, (o, k) => { o[k] = SAMPLES[t] })
    return { name: `${t} at ${n.path}`, body: Buffer.from(JSON.stringify(req)) }
  }
  if (op === 2) {
    const keyed = all.filter((n) => !/\]$/.test(n.path) && !OPTIONAL.has(n.path.split('.').pop()))
    const n = pick(keyed)
    setAt(req, n.path, (o, k) => { delete o[k] })
    return { name: `missing ${norm(n.path)}`, body: Buffer.from(JSON.stringify(req)) }
  }
  const text = Buffer.from(JSON.stringify(req))
  if (op === 3) {
    const cut = 1 + Math.floor(rand() * (text.length - 1))
    return { name: `truncated at ${cut}`, body: text.subarray(0, cut) }
  }
  const at = 1 + Math.floor(rand() * (text.length - 2))
  const bad = Buffer.from(text)
  bad[at] = 0xff
  return { name: `byte 0xff at ${at}`, body: bad }
}
