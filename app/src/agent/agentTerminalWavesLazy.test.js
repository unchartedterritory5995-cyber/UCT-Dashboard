// The Terminal data waves load LAZILY (2026-11-23): builtins.js and the AgentPanel chunk hold no static path to them.
//
// Why: while builtins.js imported terminalDataLocal.js and terminalDataWave2..11.js, the Terminal panel models those
// reuse were static dependencies of the lazy AgentPanel chunk, so every model chunk's file name sat in the ENTRY
// chunk's preload list for that import. Wave 11 added six (+243 B) and put the Notebook first-open byte budget
// (.github/workflows/notebook-bytes.yml, a promotion gate) 209 B over. Now the waves live in terminalWaves.js, reached
// only by terminalWavesLoader.js's import(), which useAgent.js chains after registerServerGatedBuiltins(); builtins.js
// reaches them only through terminalWavesHook.js, which imports nothing and which terminalWaves.js fills when it loads.
//
//   (a) builtins.js, the hook, the loader, useAgent.js and the whole static graph of AgentPanel.jsx (read from the files)
//       name no wave module and not terminalWaves.js; terminalWaves.js reaches all eleven; nothing else outside tests
//       imports one statically (the capability-regression registry, test infrastructure, imports terminalWaves.js).
//   (b) the loader asks for the chunk ONCE, re-runs the idempotent registration on every call, survives a rejected
//       import (logs, resolves null, the next call retries) and a register that throws.
//   (c) before anything in this file has loaded terminalWaves.js, registerServerGatedBuiltins() registers no wave even
//       when the server serves one; once it is imported, the same call registers the served wave-11 kind SYNCHRONOUSLY;
//       with the hook cleared it registers none again. So the hook is the only path from builtins.js to the waves, and
//       the test files that import './terminalWaves' get exactly the behaviour they had before the split. (c) runs
//       BEFORE (b): (b)'s real-chunk case loads terminalWaves.js into this file's module graph, and this file imports
//       it nowhere else.
// No model, no provider: /api/agent/config is stubbed with a synthetic shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { allCapabilityNames } from './capabilities'
import { registerServerGatedBuiltins } from './builtins'
import { runTerminalWaves, setTerminalWavesRegistrar } from './terminalWavesHook'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { loadTerminalWaves, _setTerminalWavesImportForTest, _resetTerminalWavesLoaderForTest } from './terminalWavesLoader'
import { _resetTerminalWave11ForTest, KINDS as W11_KINDS, CAPABILITIES as W11_CAPS } from './capabilities/terminalDataWave11'

const HERE = __dirname
const SRC = path.resolve(HERE, '..')
const at = (rel) => path.join(SRC, ...rel.split('/'))
const rel = (abs) => path.relative(SRC, abs).split(path.sep).join('/')
const read = (abs) => fs.readFileSync(abs, 'utf8')
const parse = (src) => Parser.extend(jsx()).parse(src, { ecmaVersion: 'latest', sourceType: 'module' })

const WAVE_MODULES = ['terminalDataLocal', ...Array.from({ length: 10 }, (_, i) => `terminalDataWave${i + 2}`)].map(n => `agent/capabilities/${n}.js`)
const WAVES_MODULE = 'agent/terminalWaves.js'
const HOOK_MODULE = 'agent/terminalWavesHook.js'
const isWaveSpec = (spec) => /(^|\/)(terminalDataLocal|terminalDataWave\d+|terminalWaves)(\.js)?$/.test(spec.split('?')[0])

function walkAll(n, fn) {
  if (!n || typeof n !== 'object') return
  if (Array.isArray(n)) { for (const x of n) walkAll(x, fn); return }
  if (typeof n.type === 'string') fn(n)
  for (const k of Object.keys(n)) { if (k !== 'loc') { const v = n[k]; if (v && typeof v === 'object') walkAll(v, fn) } }
}
/** { stat, dyn }: the module's static import / re-export sources and its literal import() sources. */
const specCache = new Map()
function specsOf(abs) {
  if (specCache.has(abs)) return specCache.get(abs)
  const out = { stat: [], dyn: [] }
  if (/\.(js|jsx|mjs)$/.test(abs)) {
    const ast = parse(read(abs))
    for (const n of ast.body) {
      if (n.type === 'ImportDeclaration') out.stat.push(n.source.value)
      else if ((n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) out.stat.push(n.source.value)
    }
    walkAll(ast, (n) => { if (n.type === 'ImportExpression') out.dyn.push(n.source.type === 'Literal' ? n.source.value : '<computed>') })
  }
  specCache.set(abs, out)
  return out
}
const EXT = ['', '.js', '.jsx', '.mjs', '/index.js', '/index.jsx']
function resolveSpec(from, spec) {
  if (typeof spec !== 'string' || !(spec.startsWith('.') || spec.startsWith('/src/'))) return null   // a package
  const s = spec.split('?')[0]
  const base = s.startsWith('/src/') ? path.join(SRC, s.slice(5)) : path.resolve(path.dirname(from), s)
  for (const e of EXT) { const p = base + e; if (fs.existsSync(p) && fs.statSync(p).isFile()) return p }
  return null
}
/** Every module reachable from `roots` through STATIC imports only (what a chunk statically needs), as app/src-relative paths. */
function staticClosure(roots) {
  const seen = new Set()
  const stack = roots.map(at)
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    for (const s of specsOf(f).stat) { const r = resolveSpec(f, s); if (r && !seen.has(r)) stack.push(r) }
  }
  return new Set([...seen].map(rel))
}

// ── (a) the production graph ────────────────────────────────────────────────────────────────────────────────────────────
describe('(a) builtins.js and the AgentPanel chunk hold no static path to the waves', () => {
  it('builtins.js imports no wave and not terminalWaves.js, statically or dynamically; it reaches them through the hook alone', () => {
    const { stat, dyn } = specsOf(at('agent/builtins.js'))
    expect(stat.length).toBeGreaterThan(40)                                  // non-vacuity: the real import list was read
    expect(stat).toContain('./capabilities/terminalData')                    // wave 1's sector answer stays (not local-only, no panel model)
    expect([...stat, ...dyn].filter(isWaveSpec)).toEqual([])
    expect(stat.filter(s => /terminalWaves/.test(s))).toEqual(['./terminalWavesHook'])
    expect(read(at('agent/builtins.js'))).toMatch(/\n\s*runTerminalWaves\(\)[^\n]*\r?\n\}/)   // the last call of registerServerGatedBuiltins
  })

  it('the hook imports nothing at all; terminalWaves.js imports the hook and hands it registerTerminalWaves', () => {
    const hook = specsOf(at(HOOK_MODULE))
    expect([...hook.stat, ...hook.dyn]).toEqual([])
    expect(specsOf(at(WAVES_MODULE)).stat).toContain('./terminalWavesHook')
    expect(read(at(WAVES_MODULE))).toMatch(/^setTerminalWavesRegistrar\(registerTerminalWaves\)\r?$/m)
  })

  it('the loader reaches terminalWaves.js ONLY through one import(), and useAgent.js only through the loader', () => {
    const loader = specsOf(at('agent/terminalWavesLoader.js'))
    expect(loader.stat).toEqual([])
    expect(loader.dyn).toEqual(['./terminalWaves'])
    const ua = specsOf(at('agent/useAgent.js'))
    expect(ua.stat).toContain('./terminalWavesLoader')
    expect([...ua.stat, ...ua.dyn].filter(isWaveSpec)).toEqual([])
    expect(read(at('agent/useAgent.js'))).toMatch(/registerServerGatedBuiltins\(\); return loadTerminalWaves\(\)/)
  })

  it('the static graph of AgentPanel.jsx (the lazy chunk the entry preloads) holds no wave module and not terminalWaves.js', () => {
    const closure = staticClosure(['agent/AgentPanel.jsx'])
    // non-vacuity: the walk really crossed the Agent (and would see a wave if one were imported)
    expect(closure.size).toBeGreaterThan(300)
    for (const f of ['agent/useAgent.js', 'agent/builtins.js', 'agent/terminalWavesLoader.js', HOOK_MODULE,
      'agent/capabilities.js', 'agent/capabilities/terminalData.js', 'agent/routing.js']) expect(closure, f).toContain(f)
    expect([...closure].filter(f => WAVE_MODULES.includes(f) || f === WAVES_MODULE)).toEqual([])
  }, 60000)

  it('CONTROL: the same walk from terminalWaves.js reaches all eleven wave modules', () => {
    const closure = staticClosure([WAVES_MODULE])
    for (const f of WAVE_MODULES) expect(closure, f).toContain(f)
  })

  it('nothing else in app/src imports a wave or terminalWaves.js statically (wave 9 may use wave 6 inside the lazy chunk)', () => {
    const files = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (!['node_modules', '__fixtures__'].includes(e.name)) walk(p) }
        else if (/\.(js|jsx|mjs)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) files.push(p)
      }
    }
    walk(SRC)
    expect(files.length).toBeGreaterThan(500)
    const importers = []
    for (const f of files) {
      if (!/terminalDataLocal|terminalDataWave|terminalWaves/.test(read(f))) continue          // exact pre-filter: an import names the module
      for (const s of specsOf(f).stat) if (isWaveSpec(s)) importers.push(`${rel(f)} -> ${s}`)
    }
    expect(importers.sort()).toEqual([
      ...WAVE_MODULES.map(m => `${WAVES_MODULE} -> ./capabilities/${path.basename(m, '.js')}`),
      'agent/capabilities/terminalDataWave9.js -> ./terminalDataWave6',
      // test infrastructure, imported only by test files (capability inventory, golden workflows, corpus)
      'agent/qa/capabilityRegression/testing/registry.js -> ../../../terminalWaves',
    ].sort())
  }, 60000)
})

// ── the served-kind stub ────────────────────────────────────────────────────────────────────────────────────────────────
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
function wire(kinds) {
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url) === '/api/agent/config') return json({ stream: false, nl1: false, data: kinds !== null, scan: false, data_kinds: kinds || [] })
    return json({}, 404)
  })
}
const realFetch = globalThis.fetch
const reset = () => { _resetAgentConfig(); _resetTerminalWave11ForTest(); _resetTerminalWavesLoaderForTest() }
const count = (name) => allCapabilityNames().filter(n => n === name).length

// ── (c) the hook (runs before (b): see the header) ────────────────────────────────────────────────────────────────────
describe('(c) registerServerGatedBuiltins() runs the waves through the hook, and only through it', () => {
  beforeEach(reset)
  afterEach(() => { reset(); globalThis.fetch = realFetch })

  it('dark before terminalWaves.js loads, SYNCHRONOUS once it is imported, dark again with the hook cleared', async () => {
    const others = Object.values(W11_CAPS).filter(n => n !== W11_CAPS.lockups)
    wire([W11_KINDS.lockups])
    await loadAgentConfig()

    // 1. terminalWaves.js has not loaded in this module graph: the served kind registers nothing, the hook answers []
    expect(runTerminalWaves()).toEqual([])
    expect(registerServerGatedBuiltins()).toBeUndefined()
    expect(count(W11_CAPS.lockups)).toBe(0)

    // 2. what a test file's `import './terminalWaves'` does: the same call now registers it before it returns, once
    const waves = await import('./terminalWaves')
    registerServerGatedBuiltins()
    expect(count(W11_CAPS.lockups)).toBe(1)                                  // no await between the call and this line
    registerServerGatedBuiltins()
    expect(count(W11_CAPS.lockups)).toBe(1)
    for (const n of others) expect(count(n), n).toBe(0)

    // 3. the hook cleared (the wave unregistered): builtins.js has no other way to the waves
    _resetTerminalWave11ForTest()
    setTerminalWavesRegistrar(null)
    registerServerGatedBuiltins()
    expect(count(W11_CAPS.lockups)).toBe(0)
    setTerminalWavesRegistrar(waves.registerTerminalWaves)                   // as the app leaves it once the chunk has loaded
  })
})

// ── (b) the loader ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe('(b) terminalWavesLoader: one chunk request, idempotent registration, never throws', () => {
  let warn
  beforeEach(() => { reset(); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
  afterEach(() => { reset(); warn.mockRestore(); globalThis.fetch = realFetch })

  it('asks for the chunk once however often it is called, and registers on every call', async () => {
    let imports = 0; let registers = 0
    _setTerminalWavesImportForTest(async () => { imports += 1; return { registerTerminalWaves: () => { registers += 1; return ['x'] } } })
    const [a, b] = await Promise.all([loadTerminalWaves(), loadTerminalWaves()])
    const c = await loadTerminalWaves()
    expect([a, b, c]).toEqual([['x'], ['x'], ['x']])
    expect(imports).toBe(1)
    expect(registers).toBe(3)
    expect(warn).not.toHaveBeenCalled()
  })

  it('a rejected import is logged and resolves null (never rejects); the next call asks again and registers', async () => {
    let imports = 0
    _setTerminalWavesImportForTest(async () => {
      imports += 1
      if (imports === 1) throw new Error('Failed to fetch dynamically imported module')
      return { registerTerminalWaves: () => ['y'] }
    })
    await expect(loadTerminalWaves()).resolves.toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[uct-agent\] the Terminal data answers did not load \(Failed to fetch dynamically imported module\)/)
    await expect(loadTerminalWaves()).resolves.toEqual(['y'])
    expect(imports).toBe(2)
    await expect(loadTerminalWaves()).resolves.toEqual(['y'])
    expect(imports).toBe(2)                                                  // loaded now: no third request
  })

  it('a register that throws is logged and resolves null', async () => {
    _setTerminalWavesImportForTest(async () => ({ registerTerminalWaves: () => { throw new Error('boom') } }))
    await expect(loadTerminalWaves()).resolves.toBeNull()
    expect(String(warn.mock.calls[0][0])).toMatch(/\(boom\)/)
  })

  it('the REAL chunk: a served wave-11 kind registers once across repeated loads; a dark config registers none', async () => {
    wire([W11_KINDS.rank])
    await loadAgentConfig()
    expect(count(W11_CAPS.rank)).toBe(0)
    await expect(loadTerminalWaves()).resolves.toEqual([W11_CAPS.rank])
    await expect(loadTerminalWaves()).resolves.toEqual([])                   // idempotent: nothing new to register
    expect(count(W11_CAPS.rank)).toBe(1)
    reset()
    wire([])
    await loadAgentConfig()
    await expect(loadTerminalWaves()).resolves.toEqual([])
    for (const n of Object.values(W11_CAPS)) expect(count(n), n).toBe(0)
    expect(warn).not.toHaveBeenCalled()
  })
})
