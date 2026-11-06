// app/src/components/chart/engine/runtime/brokerPinsLock.js
//
// ─── THE PIN LEDGER'S LOCK: A PURE CHECK (W9 design rule 7) ──────────────────
//
// `brokerPins.lock.json` is append-only: `{ "<SCRIPT_ENGINE_VERSION>": "<sha256 of
// brokerPins.resolved.json>" }`. A pin landing is an engine change and takes one
// bump (the coordinator's, in merge order). This function is the whole rule; the
// rail (`__tests__/brokerPinsLock.test.js`) feeds it fixtures and the real files.
// It is NOT imported by the bundle.
//
//   * the entry that GOVERNS is the one at the greatest version <= the current
//     `SCRIPT_ENGINE_VERSION`. A non-pin bump (any other lane's) leaves the ledger
//     alone and so leaves the governing entry true: green, no lock edit.
//   * a ledger change with no new entry: the governing entry holds the old sha: red.
//   * the lock only grows: an older entry edited or removed, or a new entry not
//     above every existing key, is red.
//
// `olderDigest` is the committed digest of every entry except the greatest, so an
// edit to history cannot hide. Appending an entry moves it (the coordinator updates
// the constant in the same merge, which is the visible act the rule asks for).

export const REASONS = Object.freeze({
  notCanonical: 'ledger-not-canonical',
  badKey: 'lock-key-not-a-version',
  outOfOrder: 'lock-entry-not-above-every-older-key',
  future: 'lock-entry-above-the-current-version',
  noGoverning: 'no-lock-entry-at-or-below-the-current-version',
  changedWithoutEntry: 'ledger-changed-without-a-lock-entry',
  olderEdited: 'older-lock-entry-edited-or-removed',
})

/** Canonical JSON: keys sorted at every level, no spaces, one trailing newline. */
export function canonicalJson(value) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const o = {}
      for (const k of Object.keys(v).sort()) o[k] = walk(v[k])
      return o
    }
    return v
  }
  return JSON.stringify(walk(value)) + '\n'
}

const isVersionKey = (k) => /^[1-9][0-9]*$/.test(k)

/** The lock's keys in FILE order. JS objects reorder integer-like keys, so order and
 *  duplicates are read from the text, never from the parsed object. */
export function lockKeysInFileOrder(lockText) {
  return [...String(lockText).matchAll(/"([^"]*)"\s*:\s*"/g)].map((m) => m[1])
}

/** sha256 over the older entries in file order (every entry except the last). */
export function olderEntriesDigest(lockText, sha256) {
  const lock = JSON.parse(lockText)
  const keys = lockKeysInFileOrder(lockText)
  const older = keys.slice(0, -1).map((k) => [k, lock[k]])
  return sha256(JSON.stringify(older))
}

/**
 * @param {{version:number, lockText:string, resolvedText:string, olderDigest:string,
 *          sha256:(s:string)=>string}} a
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function checkLock({ version, lockText, resolvedText, olderDigest, sha256 }) {
  const reasons = []
  let parsed = null
  try { parsed = JSON.parse(resolvedText) } catch { parsed = null }
  if (parsed === null || canonicalJson(parsed) !== resolvedText) reasons.push(REASONS.notCanonical)

  let lock = {}
  try { lock = JSON.parse(lockText) } catch { lock = {} }
  const fileKeys = lockKeysInFileOrder(lockText)
  if (fileKeys.some((k) => !isVersionKey(k))) reasons.push(REASONS.badKey)
  const keys = fileKeys.filter(isVersionKey).map(Number)
  // append-only: the file's own order is strictly ascending, so an entry written
  // under a version that is not above every older key is an out-of-order append.
  for (let i = 1; i < keys.length; i += 1) {
    if (!(keys[i] > keys[i - 1])) { reasons.push(REASONS.outOfOrder); break }
  }
  if (keys.some((k) => k > version)) reasons.push(REASONS.future)

  const governing = keys.filter((k) => k <= version).sort((a, b) => a - b).pop()
  if (governing === undefined) {
    reasons.push(REASONS.noGoverning)
  } else if (lock[String(governing)] !== sha256(resolvedText)) {
    reasons.push(REASONS.changedWithoutEntry)
  }
  if (olderEntriesDigest(lockText, sha256) !== olderDigest) reasons.push(REASONS.olderEdited)
  return { ok: reasons.length === 0, reasons }
}

// ─── the explicit-pin-set argument is for tests only (design rule 2) ─────────
//
// `pinned(rule, explicitSet)` exists so a test can pass its own set. A call that
// passes a second argument anywhere outside a test would let a caller choose what
// is pinned. This reads SOURCE TEXT (comments and strings removed), so a mention
// in prose is not a site, and returns every `pinned(` call with a top-level comma.

function stripCommentsAndStrings(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i += 1; continue }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue }
    if (c === '"' || c === "'" || c === '`') {
      const q = c
      i += 1
      while (i < n && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1 }
      i += 1
      out += '""'
      continue
    }
    out += c
    i += 1
  }
  return out
}

export function pinSetArgumentSites(sources) {
  const sites = []
  for (const { path, text } of sources) {
    if (/(^|[\\/])__tests__([\\/]|$)/.test(path) || /\.test\.[cm]?jsx?$/.test(path)) continue
    const code = stripCommentsAndStrings(text)
    const rx = /(^|[^\w$.])pinned\s*\(/g
    let m
    while ((m = rx.exec(code))) {
      const before = code.slice(Math.max(0, m.index - 12), m.index + m[1].length)
      if (/function\s*$/.test(before)) continue // the definition, not a call
      let depth = 1
      let j = m.index + m[0].length
      let comma = false
      while (j < code.length && depth > 0) {
        const ch = code[j]
        if (ch === '(' || ch === '[' || ch === '{') depth += 1
        else if (ch === ')' || ch === ']' || ch === '}') depth -= 1
        else if (ch === ',' && depth === 1) comma = true
        j += 1
      }
      if (comma) sites.push({ path, line: code.slice(0, m.index).split('\n').length })
    }
  }
  return sites
}
