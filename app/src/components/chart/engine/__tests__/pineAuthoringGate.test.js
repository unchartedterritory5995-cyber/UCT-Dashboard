// A1 — the Pine Editor's build flag: one reader, literal '1' only, declared
// dark in both ledgers, consulted by exactly the one surface it gates.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import {
  pineAuthoringEnabled, pineAuthoringBuilt, pineAuthoringPermitted, latchPineAuthoringPermission,
  __resetPineAuthoringPermission, __permitPineAuthoringForTests,
} from '../pineAuthoringGate'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..', '..', '..', '..', '..')
const REPO = path.resolve(APP, '..')
const GATE_SRC = path.resolve(HERE, '..', 'pineAuthoringGate.js')

/** ⛔ DERIVED FROM THE SOURCE, NEVER TYPED. */
const GATE_NAME = /import\.meta\.env\.(VITE_[A-Z0-9_]+)/.exec(fs.readFileSync(GATE_SRC, 'utf8'))?.[1]

function sourceFiles(dir = path.join(APP, 'src'), out = []) {
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = path.join(dir, entry)
    if (fs.statSync(full).isDirectory()) { sourceFiles(full, out); continue }
    if (/\.[cm]?jsx?$/.test(entry) && !/\.(test|spec)\./.test(entry)) out.push(full)
  }
  return out
}

afterEach(() => { vi.unstubAllEnvs(); __permitPineAuthoringForTests() })

describe('pineAuthoringGate', () => {
  it('reads ONE variable, and the rail found it', () => {
    expect(GATE_NAME).toBe('VITE_PINE_AUTHORING_ENABLED')
  })

  it.each([[undefined, false], ['', false], ['0', false], ['true', false], ['yes', false],
    [' 1', false], ['1', true]])('%j -> %s', (v, want) => {
    if (v !== undefined) vi.stubEnv(GATE_NAME, v)
    expect(pineAuthoringEnabled()).toBe(want)
  })

  it('⛔ is declared DARK in both ledgers, naming this reader', () => {
    const fe = JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'frontend_feature_flags.json'), 'utf8'))
    const row = fe.flags[GATE_NAME]
    expect(row).toBeTruthy()
    expect(row.status).toBe('pending')
    expect(row.readBy).toEqual(['app/src/components/chart/engine/pineAuthoringGate.js::pineAuthoringEnabled'])
    const be = JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'feature_flags.json'), 'utf8'))
    expect(be.build_flags[GATE_NAME].status).toBe('dark')
  })

  it('⛔ two consumers, both named: the builder sheet (the tab, the O6 attach) and the toolbar that owns it (the A6 "Edit script" doors)', () => {
    const callers = sourceFiles()
      .filter((f) => f !== GATE_SRC && fs.readFileSync(f, 'utf8').includes('pineAuthoringEnabled('))
      .map((f) => path.relative(APP, f).split(path.sep).join('/'))
      .sort()
    expect(callers).toEqual([
      'src/components/chart/ChartToolbar.jsx',
      'src/components/chart/builder/BuilderSheet.jsx',
    ])
  })

  // ⭐⭐ A2 (O3) — the per-member stage. The build flag alone is NOT enough.
  describe('the per-member stage (PINE_AUTHORING_STAGE via pine_authoring_enabled)', () => {
    it('⛔ build flag ON + nothing latched = OFF (fail closed)', () => {
      vi.stubEnv(GATE_NAME, '1')
      __resetPineAuthoringPermission()
      expect(pineAuthoringBuilt()).toBe(true)
      expect(pineAuthoringPermitted()).toBe(false)
      expect(pineAuthoringEnabled()).toBe(false)
    })

    it('needs BOTH: stage yes + build off is OFF; stage yes + build on is ON', () => {
      __resetPineAuthoringPermission()
      latchPineAuthoringPermission({ pine_authoring_enabled: true })
      expect(pineAuthoringEnabled()).toBe(false)
      vi.stubEnv(GATE_NAME, '1')
      expect(pineAuthoringEnabled()).toBe(true)
    })

    it('latches the FIRST boolean per tab; a payload without the key latches nothing; a later disagreement is ignored', () => {
      vi.stubEnv(GATE_NAME, '1')
      __resetPineAuthoringPermission()
      expect(latchPineAuthoringPermission({ pine_runtime_pane_enabled: true })).toBe(null)
      expect(latchPineAuthoringPermission({ pine_authoring_enabled: 'true' })).toBe(null)
      latchPineAuthoringPermission({ pine_authoring_enabled: false })
      latchPineAuthoringPermission({ pine_authoring_enabled: true })
      expect(pineAuthoringEnabled()).toBe(false)
    })

    it('⛔ the latch is fed by AuthContext (the one writer) and lives outside the engine dir', () => {
      const ctx = fs.readFileSync(path.join(APP, 'src', 'context', 'AuthContext.jsx'), 'utf8')
      expect(ctx).toMatch(/latchPineAuthoringPermission\(data\)/)
      expect(ctx).not.toMatch(/components\/chart\/engine/)
    })
  })
})
