#!/usr/bin/env node
// tools/pine_runtime_closure.mjs
//
// ─── ⭐⭐ W5-T2 — IS THE RUNTIME LANE'S COMPUTE CLOSURE HOST-NEUTRAL? ───────────────
//
// docs/pine/SERVER-RUNTIME-DESIGN.md 2.1 (the walk), 2.2 H3/H4/H5 (what may not be in
// it) and section 8 step 4 (the gate): one semantic source runs on two hosts (the
// browser's worker and the server bundle), so the code that COMPUTES a run may hold
// no transport, no network, no build flag and no clock it does not let the host inject.
//
//   node tools/pine_runtime_closure.mjs            print the closure and every finding
//   node tools/pine_runtime_closure.mjs --check    the same; exit 1 on any finding
//   node tools/pine_runtime_closure.mjs --json     the closure as JSON (modules, findings)
//   --repo DIR     walk another checkout (the control tree of the rail)
//
// Exit 0 clean · 1 a finding (named, with the import chain that reaches it) · 2 the walk
// could not be made (an entry or an import that does not resolve). ⛔ 2 is never clean.
//
// What it walks: every RELATIVE `import … from`, `export … from`, side-effect `import '…'`
// and literal `import('…')`, extensionless and `index.js` forms, from the ROOTS below,
// over source with comments blanked (line numbers kept). A bare specifier is listed, a
// `.json` is listed and not walked. It is a static walk: it over-reports (an import
// spelled inside a string counts), which is the safe direction for a gate.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE = 'app/src/components/chart/engine'

/** The compute closure: the server bundle's entry and the module it re-exports. */
export const ROOTS = Object.freeze([
  `${ENGINE}/runtime/serverEntry.js`,
  `${ENGINE}/runtime/runtimeColumns.js`,
])

/** ⛔ Modules that may never be in the closure, each with why (design 2.2). */
export const FORBIDDEN_MODULES = Object.freeze({
  [`${ENGINE}/nativeRegistry.js`]: 'the chart registry: reaches serverCompute, runtimeKill and runtimePaneGate (H4)',
  [`${ENGINE}/objectColumns.js`]: 'the C18 object reader: imports the registry; the runtime lane registers through objectRuntimeSeam.js (H4)',
  [`${ENGINE}/serverCompute.js`]: 'fetches server columns (H4)',
  [`${ENGINE}/runtimeKill.js`]: 'fetches the kill and allow lists (H4)',
  [`${ENGINE}/runtimePaneGate.js`]: 'a build gate (import.meta.env): it decides whether a pane runs, so it belongs to the door (H3)',
  [`${ENGINE}/lowerTfGate.js`]: 'a build gate (import.meta.env): registered at the door through lowerTfServing.js (H3)',
  [`${ENGINE}/liveTail.js`]: 'the benchmark tail store: the door\'s request and a page-level cache with its wall clocks (H4/H5); the `liveTail` grammar is the leaf liveTailSchema.js',
  'app/src/lib/runtimePanePermission.js': 'fetches the member permission (H4)',
  [`${ENGINE}/runtime/runtimeAsync.js`]: 'the browser transport (H1)',
  [`${ENGINE}/runtime/runtimeWorker.js`]: 'the browser transport (H1)',
})

/** ⛔ What reachable source may never contain (comments blanked). */
export const FORBIDDEN_PATTERNS = Object.freeze({
  network: /\b(?:fetch|importScripts|sendBeacon)\s*\(|\b(?:WebSocket|XMLHttpRequest|EventSource)\b/,
  'build flag': /\bimport\.meta\.env\b/,
  storage: /\b(?:localStorage|sessionStorage|indexedDB)\b/,
  'dynamic code': /\beval\s*\(|\bnew\s+Function\s*\(/,
  worker: /\bnew\s+Worker\s*\(|\bself\.onmessage\b|\bpostMessage\s*\(/,
  timer: /\b(?:setTimeout|setInterval|setImmediate|queueMicrotask|requestAnimationFrame)\s*\(/,
})

/** A wall-clock read: `Date.now()`, `performance.now()`, a bare `new Date()` or `Date()`. */
export const CLOCK = /\b(?:Date|performance)\.now\s*\(|\bnew\s+Date\s*\(\s*\)|(?<![.\w])Date\s*\(\s*\)/

/** ⭐ H5 — the ONLY wall-clock reads allowed in the closure: each is the DEFAULT of a clock
 *  the host injects (`opts.now`), named by its file and its exact line. A new clock read
 *  anywhere is a finding, and so is an entry here that no longer matches (no stale list). */
export const ALLOWED_CLOCKS = Object.freeze([
  { file: `${ENGINE}/ast/pine.js`, line: 'const wallNow = () => Date.now()' },
  { file: `${ENGINE}/runtime/runtimeColumns.js`, line: "const hostNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())" },
  { file: `${ENGINE}/runtime/vm.js`, line: "const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())" },
])

/** The bare npm imports the bundle inlines (design 2.1). */
export const ALLOWED_BARE = Object.freeze(['jsep'])

/** ⭐ A gate cut from the closure still has to be REGISTERED at its door: the door's own
 *  closure must reach it, or a build that serves on the flag would quietly stop serving. */
export const DOOR_REGISTRATIONS = Object.freeze([
  { door: `${ENGINE}/nativeRegistry.js`, reaches: `${ENGINE}/lowerTfGate.js`, why: 'registers the lower-timeframe gate (lowerTfServing.js)' },
])

/** The pine-runtime service's watch patterns (design 3.1). */
export const WATCH_PATTERNS = Object.freeze([
  'services/pine_runtime/**',
  'app/src/components/chart/engine/**',
  'app/src/lib/marketClock/**',
  'app/src/components/chart/indicators.js',
  // train (W5-T2 x W5-T7/INT): the bundle exports NATIVE_TFS, so timeframes.js is in the closure
  'app/src/components/chart/timeframes.js',
  'app/src/components/chart/builder/authoring/crossContext.json',
  'app/package.json',
  'app/package-lock.json',
  'app/vite.config.js',
])
/** `**` is any depth, `*` is one segment; everything else is literal. */
export function globMatch(glob, path) {
  if (glob.endsWith('/**')) return path.startsWith(glob.slice(0, -2))
  return glob === path
}
export const watched = (path) => WATCH_PATTERNS.some((g) => globMatch(g, path))

const IMPORT_RE = /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]/g
const BACKSLASH = String.fromCharCode(92)

/** Comments blanked, newlines kept, so a finding's line number is the file's. Strings are
 *  skipped over (a `//` inside a URL string is not a comment). ⚠️ A regex literal holding a
 *  quote can desynchronise the string skip; the walk then over-reports (the safe side). */
export function stripComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      out += src.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
    } else if (c === '/' && d === '/') {
      let j = i
      while (j < n && src[j] !== '\n') j += 1
      out += ' '.repeat(j - i)
      i = j
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n && src[j] !== c && !(c !== '`' && src[j] === '\n')) { if (src[j] === BACKSLASH) j += 1; j += 1 }
      out += src.slice(i, j + 1)
      i = j + 1
    } else {
      out += c
      i += 1
    }
  }
  return out
}

const relOf = (repo, abs) => relative(repo, abs).split(sep).join('/')

function resolveSpec(fromAbs, spec) {
  const base = resolve(dirname(fromAbs), spec)
  for (const cand of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, join(base, 'index.js')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return null
}

/** The closure from `roots`: `{modules: Map<rel, {parent, source}>, json, bare, unresolved}`. */
export function walk(roots = ROOTS, repo = REPO) {
  const modules = new Map()
  const json = new Set()
  const bare = new Map()
  const unresolved = []
  const queue = []
  for (const r of roots) {
    const abs = resolve(repo, r)
    if (!existsSync(abs)) { unresolved.push({ from: '(root)', spec: r }); continue }
    if (!modules.has(relOf(repo, abs))) { modules.set(relOf(repo, abs), { parent: null }); queue.push(abs) }
  }
  while (queue.length) {
    const abs = queue.shift()
    const src = stripComments(readFileSync(abs, 'utf8'))
    modules.get(relOf(repo, abs)).source = src
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2] || m[3]
      if (!spec.startsWith('.')) { if (!bare.has(spec)) bare.set(spec, relOf(repo, abs)); continue }
      const hit = resolveSpec(abs, spec)
      if (!hit) { unresolved.push({ from: relOf(repo, abs), spec }); continue }
      const r = relOf(repo, hit)
      if (r.endsWith('.json')) { json.add(r); continue }
      if (!modules.has(r)) { modules.set(r, { parent: relOf(repo, abs) }); queue.push(hit) }
    }
  }
  return { modules, json, bare, unresolved }
}

/** The import chain the walk took to reach `r`, from its root. */
export function chainOf(modules, r) {
  const chain = []
  for (let c = r; c; c = modules.get(c) && modules.get(c).parent) chain.unshift(c)
  return chain.join(' -> ')
}

/** Every finding, each a sentence a reviewer can act on. */
export function findings(closure = walk(), { repo = REPO } = {}) {
  const { modules, json, bare } = closure
  const out = []
  for (const [m, why] of Object.entries(FORBIDDEN_MODULES)) {
    if (modules.has(m)) out.push(`forbidden module ${m} (${why}): ${chainOf(modules, m)}`)
  }
  for (const [spec, from] of bare) {
    if (!ALLOWED_BARE.includes(spec) && !spec.startsWith('node:')) {
      out.push(`bare import '${spec}' in ${from}: the bundle may inline only ${ALLOWED_BARE.join(', ')}`)
    }
  }
  const clocksSeen = new Set()
  for (const [m, info] of modules) {
    info.source.split('\n').forEach((line, i) => {
      for (const [kind, re] of Object.entries(FORBIDDEN_PATTERNS)) {
        if (re.test(line)) out.push(`${kind} in the closure at ${m}:${i + 1}: ${line.trim().slice(0, 120)}`)
      }
      if (CLOCK.test(line)) {
        const allowed = ALLOWED_CLOCKS.findIndex((a) => a.file === m && a.line === line.trim())
        if (allowed >= 0) clocksSeen.add(allowed)
        else out.push(`wall clock the host cannot inject at ${m}:${i + 1}: ${line.trim().slice(0, 120)} (route it through the injected opts.now)`)
      }
    })
  }
  ALLOWED_CLOCKS.forEach((a, i) => {
    if (!clocksSeen.has(i)) out.push(`stale ALLOWED_CLOCKS entry: ${a.file} no longer holds \`${a.line}\` in the closure`)
  })
  for (const m of [...modules.keys(), ...json]) {
    if (!watched(m)) out.push(`outside the service's watch patterns: ${m} (a change to it would not redeploy pine-runtime)`)
  }
  for (const d of DOOR_REGISTRATIONS) {
    const door = walk([d.door], repo)
    if (!door.modules.has(d.reaches)) out.push(`door registration missing: ${d.door} no longer reaches ${d.reaches}, which ${d.why}`)
  }
  return out
}

function main(argv) {
  const at = argv.indexOf('--repo')
  const repo = at >= 0 ? resolve(argv[at + 1]) : REPO
  const closure = walk(ROOTS, repo)
  if (closure.unresolved.length) {
    for (const u of closure.unresolved) console.error(`closure: cannot resolve '${u.spec}' from ${u.from}`)
    return 2
  }
  const found = findings(closure, { repo })
  const lines = [...closure.modules.values()].reduce((a, m) => a + m.source.split('\n').length, 0)
  const all = [...closure.modules.keys(), ...closure.json]
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ roots: ROOTS, modules: [...closure.modules.keys()].sort(), json: [...closure.json].sort(),
      bare: [...closure.bare.keys()].sort(), lines, findings: found }, null, 1))
  } else {
    console.log(`closure: ${closure.modules.size} modules, ${lines} lines, ${closure.json.size} JSON, bare: ${[...closure.bare.keys()].join(', ') || 'none'}`)
    console.log(`watch coverage: ${all.filter(watched).length}/${all.length} in the service's watch patterns`)
    for (const f of found) console.log(`FINDING ${f}`)
    console.log(found.length ? `closure: ${found.length} finding(s)` : 'closure: host-neutral (0 findings)')
  }
  return argv.includes('--check') && found.length ? 1 : 0
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
if (isMain) process.exitCode = main(process.argv.slice(2))
