// Test-only source scanners behind the P0 census / one-key rails. Never imported by product code.
//
// Every count is taken over CODE (comments stripped with the shared sourceScan helper), so a
// comment that mentions `.setData(` or a `${sym}_${tf}` pattern never moves a ratchet.
import fs from 'node:fs'
import path from 'node:path'
import { stripComments } from '../engine/__tests__/sourceScan'
import { APP_SRC } from './railSupport'

const SKIP_DIR = /(^|\/)(node_modules|__tests__|__fixtures__|testing|\.[^/]+)(\/|$)|^components\/chart\/rails\//
const isTest = (f) => /\.(test|spec)\.(jsx?|mjs)$/.test(f)

/** Every product source file under app/src (relative, forward slashes). */
export function productFiles() {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      const rel = path.relative(APP_SRC, p).split(path.sep).join('/')
      if (e.isDirectory()) { if (!SKIP_DIR.test(rel + '/')) walk(p); continue }
      if (/\.(jsx?|mjs)$/.test(e.name) && !isTest(e.name) && !SKIP_DIR.test(rel)) out.push(rel)
    }
  }
  walk(APP_SRC)
  return out.sort()
}

/** The bar-data scope: the chart, its data layer, hooks, and the /charts page. */
export function inBarScope(rel) {
  if (rel === 'components/StockChart.jsx') return true
  if (/^components\/chart\/[^/]+\.(jsx?|mjs)$/.test(rel)) return true
  if (/^components\/chart\/engine\/(liveTail|secondaryBars|lowerTf|binder)\.js$/.test(rel)) return true
  if (/^(utils|lib|hooks)\//.test(rel)) return true
  if (/^pages\/charts\//.test(rel)) return true
  return false
}

const _code = new Map()
export function code(rel) {
  if (!_code.has(rel)) _code.set(rel, stripComments(fs.readFileSync(path.join(APP_SRC, rel), 'utf8')))
  return _code.get(rel)
}
const _raw = new Map()
function raw(rel) {
  if (!_raw.has(rel)) _raw.set(rel, fs.readFileSync(path.join(APP_SRC, rel), 'utf8'))
  return _raw.get(rel)
}
/** 1-based line of the first occurrence of `snippet` in the ORIGINAL file (informational only). */
export function lineOf(rel, snippet) {
  const i = raw(rel).indexOf(snippet)
  return i < 0 ? null : raw(rel).slice(0, i).split('\n').length
}

const count = (src, re) => (src.match(re) || []).length

// ── single-writer census metrics ─────────────────────────────────────────────
const SERIES_RECEIVER = /([A-Za-z_$][\w$]*)(?:\.current)?\??\.update\(/g
const SERIES_ALIAS = /eries|^_?vs$|^s$|^ls$|^ts$/
export const WRITER_METRICS = {
  /** `.setData(` call sites (any series). */
  setData: (src) => count(src, /\.setData\(/g),
  /** `.update(` call sites whose receiver is a series (name contains "eries" or a known alias). */
  seriesUpdate: (src) => {
    let n = 0
    for (const m of src.matchAll(SERIES_RECEIVER)) if (SERIES_ALIAS.test(m[1])) n++
    return n
  },
  /** direct writes to THE candle series. */
  candleWrites: (src) => count(src, /candleSeriesRef\.current\??\.(?:update|setData)\(/g),
  /** live-writer state: assignments to the developing-bar refs P3 deletes. */
  liveRefAssign: (src) => count(src, /\b(?:liveBarRef|lastBarRef)\.current\s*=(?!=)/g),
  /** independent bar caches: import sites of a bar-cache module. */
  barCacheImports: (src) => count(src, /\bfrom\s+['"][^'"]*\/(?:barsMemCache|barsIDB|prefetchBars|barsPackClient|barsPackIngest|todayPackClient)(?:\.js)?['"]/g),
  /** SWR-level BAR caches: useSWR( hooks and swr preload( calls in files that fetch bars. */
  swrCaches: (src) => (/\/api\/bars|barsMemCache|barsIDB|prefetchBars/.test(src)
    ? count(src, /\buseSWR(?:Immutable)?\(/g) + (/from\s+['"]swr['"]/.test(src) ? count(src, /\bpreload\(/g) : 0)
    : 0),
  /** IndexedDB stores opened. */
  idbOpen: (src) => count(src, /indexedDB\.open\(/g),
}

export function writerCensus() {
  const files = {}
  for (const rel of productFiles()) {
    if (!inBarScope(rel)) continue
    const src = code(rel)
    const row = {}
    for (const [k, fn] of Object.entries(WRITER_METRICS)) { const n = fn(src); if (n) row[k] = n }
    if (Object.keys(row).length) files[rel] = row
  }
  return files
}

/** Rollout percentage gates: `const NAME_PCT = 0|100` in bar-scope files. */
export function rolloutPctConstants() {
  const out = []
  for (const rel of productFiles()) {
    if (!inBarScope(rel)) continue
    for (const m of code(rel).matchAll(/\bconst\s+([A-Z][A-Z0-9_]*_PCT)\s*=\s*(0|100)\b/g)) out.push(`${rel}:${m[1]}`)
  }
  return out.sort()
}

// ── one-key / one-url / one-freshness ────────────────────────────────────────
/** `${sym…}_${tf…}` / `${sym…}:${tf…}` template pieces: a bar cache / pair key built inline. */
const KEY_RE = /\$\{[^}`]*\b(?:sym|symbol|ticker|_sym|s|meta\.sym)\b[^}`]*\}[_:]\$\{[^}`]*(?:tf|Tf|TF|timeframe|interval)[^}`]*\}/g
/** a literal that starts an /api/bars/… or /api/bars-history/… URL. */
const URL_RE = /[`'"]\/api\/bars(?:-history)?\/[^`'"\n]{0,48}/g
/** a function/arrow DEFINITION whose name says it judges bar freshness. */
const DEF_RE = /(?:function\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)\s*(?:=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)|\()/g
const FRESH_SEGMENTS = new Set(['fresh', 'stale', 'freshness', 'currentness'])
const FRESH_PHRASE = /classify\w*Tail|CurrentEnough|NeedsRefresh|IntradayGap/
const NOT_FRESH = /^fmtFresh$|StaleChunk/
/** Name judges freshness: a camelCase / snake segment is fresh|stale|freshness|currentness. */
function isFreshnessName(n) {
  if (NOT_FRESH.test(n)) return false
  if (FRESH_PHRASE.test(n)) return true
  return n.split(/_|(?=[A-Z])/).some((seg) => FRESH_SEGMENTS.has(seg.toLowerCase()))
}

function multiset(items) {
  const m = {}
  for (const x of items) m[x] = (m[x] || 0) + 1
  return m
}

export function oneKeyCensus() {
  const keyBuilders = {}, barsUrls = {}, freshness = {}
  for (const rel of productFiles()) {
    const src = code(rel)
    const keys = [...src.matchAll(KEY_RE)].map((m) => m[0])
    if (keys.length) keyBuilders[rel] = multiset(keys)
    const urls = [...src.matchAll(URL_RE)].map((m) => m[0].slice(1))
    if (urls.length) barsUrls[rel] = multiset(urls)
    if (inBarScope(rel)) {
      const defs = [...src.matchAll(DEF_RE)].map((m) => m[1]).filter(isFreshnessName)
      if (defs.length) freshness[rel] = multiset(defs)
    }
  }
  return { keyBuilders, barsUrls, freshness }
}

/** Compare a {file: {item: n}} census to its baseline. Returns {grew, shrank} lists. */
export function diffMultisets(now, base) {
  const grew = [], shrank = []
  const files = new Set([...Object.keys(now), ...Object.keys(base)])
  for (const f of [...files].sort()) {
    const a = now[f] || {}, b = base[f] || {}
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[k] || 0, y = typeof b[k] === 'object' ? b[k].n : (b[k] || 0)
      if (x > y) grew.push(`${f}: ${JSON.stringify(k)} ${y} -> ${x}`)
      else if (x < y) shrank.push(`${f}: ${JSON.stringify(k)} ${y} -> ${x}`)
    }
  }
  return { grew, shrank }
}
