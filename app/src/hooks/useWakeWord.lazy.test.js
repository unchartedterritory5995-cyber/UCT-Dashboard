// app/src/hooks/useWakeWord.lazy.test.js
//
// ─── 🔴 THE RAIL THAT KEEPS ~900 KB GZ OFF EVERY MEMBER'S FIRST LOAD ────────
//
// `@picovoice/porcupine-web` inlines its wake-word model as base64 wasm:
// ~3.5 MB raw / ~900 KB gzipped, the single largest artifact this app can
// download. It is reached from exactly one place — `hooks/useWakeWord.js` —
// and that hook already does nothing unless the member has turned the wake
// word ON (`wakeEnabled` defaults to FALSE in context/VoiceContext.jsx).
//
// It used to be a STATIC import, so the wasm shipped to everyone anyway. The
// `lazy()` + `isPaid` gate in App.jsx did not save anyone, because "everything
// is paid + a free trial" — the gate excluded nobody.
//
// ⛔ AN AST, NEVER A GREP. `lesson_probe_names_must_be_derived_not_typed`: a
// grep for "@picovoice" in this repo matches the import, the doc comment above
// it, `test-setup.js`'s `vi.mock`, and a test stub — four hits, one edge. Only
// the parsed `source` of an `ImportDeclaration` is a static edge, and only an
// `ImportExpression` is a lazy one.
//
// ⭐ WHY THE ROOT IS `GlobalVoiceLayer.jsx` AND NOT `App.jsx`. The first draft
// of this rail walked from the app entry and asserted picovoice was not
// statically reachable. It passed — VACUOUSLY. `App.jsx` reaches the voice
// layer through `lazy(() => import('./components/voice/GlobalVoiceLayer'))`, a
// DYNAMIC edge, so a static-only walk from the entry never arrives at this
// hook at all and would have gone on passing with the static import restored.
// The control below is what caught that, which is the entire reason it exists.
//
// So the question asked here is the one that actually maps to a chunk boundary:
// **starting at the module Rollup makes a chunk for, is picovoice reachable
// without crossing an `import()`?** If yes, the wasm is inside the
// GlobalVoiceLayer chunk and ships to every paid member on auth. If no, it is
// its own chunk and arrives only when the wake word is switched on.
//
// 🧪 The controls are the point. A rail nobody has seen fail is not a rail
// (`lesson_gate_that_cannot_fail`), and a `str.replace` that silently matched
// nothing would make the mutation VACUOUS (`lesson_test_that_passes_vacuously`)
// — so the planted-cut control asserts its own edit applied before trusting the
// red.

import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'api'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`useWakeWord.lazy.test: could not find the repo root from ${process.cwd()}`)
})()

const SRC = path.join(ROOT, 'app', 'src')
const HOOK = path.join(SRC, 'hooks', 'useWakeWord.js')
/** The lazy boundary Rollup emits the voice chunk for — see the note above. */
const VOICE_CHUNK_ROOT = path.join(SRC, 'components', 'voice', 'GlobalVoiceLayer.jsx')
/** ⚠️ CRLF normalised at the door — `core.autocrlf` is on in this checkout. */
const read = (abs) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')

const parse = (src) => Parser.extend(jsx()).parse(src, {
  ecmaVersion: 'latest', sourceType: 'module',
})

function walkAst(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((n) => walkAst(n, visit)); return }
  if (typeof node.type === 'string') visit(node)
  for (const v of Object.values(node)) if (v && typeof v === 'object') walkAst(v, visit)
}

/** Static (`import …` / `export … from`) vs lazy (`import(…)`) specifiers. */
function specifiersOf(src) {
  const staticSpecs = []
  const dynamicSpecs = []
  walkAst(parse(src), (n) => {
    if ((n.type === 'ImportDeclaration'
      || n.type === 'ExportNamedDeclaration'
      || n.type === 'ExportAllDeclaration')
      && n.source && typeof n.source.value === 'string') staticSpecs.push(n.source.value)
    if (n.type === 'ImportExpression'
      && n.source && n.source.type === 'Literal'
      && typeof n.source.value === 'string') dynamicSpecs.push(n.source.value)
  })
  return { staticSpecs, dynamicSpecs }
}

const CODE_EXT = ['.js', '.jsx']

function resolve(fromFile, spec) {
  if (!spec.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = [base, ...CODE_EXT.map((e) => base + e),
    ...CODE_EXT.map((e) => path.join(base, `index${e}`))]
  for (const c of candidates) {
    if (!CODE_EXT.includes(path.extname(c))) continue
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

const IS_PICOVOICE = (s) => s === '@picovoice/porcupine-web'
  || s === '@picovoice/web-voice-processor'
  || s.startsWith('@picovoice/')

/**
 * Walk the STATIC-ONLY relative import graph from `roots` and return every
 * file that statically imports a picovoice package.
 *
 * Static-only is the point: an `import()` is a chunk boundary, so a package
 * reached only across one is NOT in this chunk.
 *
 * @param {Map<string,string>} overrides abs path -> source to use INSTEAD of
 *        disk, so a control can plant a cut without touching the working tree.
 */
function staticPicovoiceImporters(overrides = new Map(), roots = [VOICE_CHUNK_ROOT]) {
  const seen = new Set()
  const queue = [...roots]
  const offenders = []
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const src = overrides.has(file) ? overrides.get(file) : read(file)
    const { staticSpecs } = specifiersOf(src)
    if (staticSpecs.some(IS_PICOVOICE)) offenders.push(rel(file))
    for (const spec of staticSpecs) {
      const next = resolve(file, spec)
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  return { offenders, visited: seen }
}

describe('🔴 the wake-word wasm never reaches the eager bundle', () => {
  it('nothing in the GlobalVoiceLayer chunk statically imports picovoice', () => {
    const { offenders } = staticPicovoiceImporters()
    expect(offenders).toEqual([])
  })

  it('nor does anything else under app/src — the wasm has exactly one door', () => {
    // ⛔ DERIVED from the tree, never a hand-list: a list agrees with today's
    // contents right up until somebody adds the next static importer.
    const files = []
    const stack = [SRC]
    while (stack.length) {
      const dir = stack.pop()
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) stack.push(p)
        else if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) files.push(p)
      }
    }
    expect(files.length).toBeGreaterThan(200) // the sweep actually swept
    const offenders = files
      .filter((f) => specifiersOf(read(f)).staticSpecs.some(IS_PICOVOICE))
      .map(rel)
    expect(offenders).toEqual([])
    // ⏱️ 30s, not the 5s default: this parses every source file under app/src
    // (~1,400 of them) with acorn. It is the slowest assertion in the file and
    // the one least worth trading away for speed.
  }, 30000)

  it('useWakeWord still reaches picovoice — but only through import()', () => {
    const { staticSpecs, dynamicSpecs } = specifiersOf(read(HOOK))
    // The capability is still wired…
    expect(dynamicSpecs.filter(IS_PICOVOICE).sort()).toEqual([
      '@picovoice/porcupine-web',
      '@picovoice/web-voice-processor',
    ])
    // …and it is not ALSO pulled in eagerly.
    expect(staticSpecs.filter(IS_PICOVOICE)).toEqual([])
  })

  // ── controls ────────────────────────────────────────────────────────────
  // Without these, both assertions above could be green for the wrong reason:
  // a walker that reached nothing, or a matcher that matched nothing.

  it('CONTROL: the walker actually reaches useWakeWord (else the rail is vacuous)', () => {
    const { visited } = staticPicovoiceImporters()
    expect([...visited].map(rel)).toContain('app/src/hooks/useWakeWord.js')
  })

  it('CONTROL: a static-only walk from App.jsx would NOT reach it — why the root is the chunk', () => {
    // This is the draft that passed for the wrong reason, kept as a control so
    // nobody "simplifies" the root back to the app entry.
    const roots = ['main.jsx', 'App.jsx'].map((f) => path.join(SRC, f)).filter((p) => fs.existsSync(p))
    expect(roots.length).toBeGreaterThan(0)
    const { visited } = staticPicovoiceImporters(new Map(), roots)
    expect([...visited].map(rel)).not.toContain('app/src/hooks/useWakeWord.js')
  })

  it('CONTROL: a planted STATIC import is detected — the rail can fail', () => {
    const original = read(HOOK)
    const mutated = original.replace(
      "import { useEffect, useRef } from 'react'",
      "import { useEffect, useRef } from 'react'\nimport { PorcupineWorker } from '@picovoice/porcupine-web'",
    )
    // ⛔ never trust a replace that may have matched nothing.
    expect(mutated).not.toBe(original)

    const { offenders } = staticPicovoiceImporters(new Map([[HOOK, mutated]]))
    expect(offenders).toContain('app/src/hooks/useWakeWord.js')
  })
})
