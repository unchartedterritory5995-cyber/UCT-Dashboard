// @vitest-environment node
// app/src/components/chart/engine/__tests__/runtimeSwitchOn.test.js
//
// ─── ⭐⭐ GT (2026-10-02) — THE RUNTIME PANE'S SWITCH-ON RULINGS, CLIENT HALF ───
//
// The server half is `tests/test_pine_runtime_switch_on.py`. This file rails:
//   * D1 — `runtimePaneEnabled()` needs BOTH the build flag AND the per-member
//     permission the server sends on the auth payload (`pine_runtime_pane_enabled`),
//     latched per tab (first payload wins; nothing latched = not permitted);
//   * D6 — the starter allowlist: an allowlisted script attaches through the
//     runtime lane, any other declines BY NAME (`runtime:not-yet-graded`) with
//     the HOST lane's sentence, and an empty list attaches nothing; a stored row
//     the server stamped `meta.runtimeNotGraded` is refused at the install door.
//
// ⛔ `src/test-setup.js` PERMITS the pane and grades EVERY script before each test
// (so the lane's own suites keep measuring the lane). Every test here RESETS both
// first, so these doors are measured in their production state: fail closed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../nativeRegistry'
import {
  runtimePaneEnabled, runtimePaneBuilt, runtimePanePermitted, latchRuntimePanePermission,
  runtimePanePermissionDebug, __resetRuntimePanePermission,
} from '../runtimePaneGate'
import {
  setRuntimeAllowList, runtimeAllowList, runtimeNotGradedOf, setRuntimeKillList,
  __resetRuntimeAllowList,
} from '../runtimeKill'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'runtime_documents', 'documents.json')
const ALLOWLIST = path.join(REPO, 'api', 'data', 'pine_runtime_allowlist.json')
const docs = () => Object.fromEntries(
  JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).documents.map((d) => [d.slug, d.definition]))

const ON = { VITE_PINE_RUNTIME_PANE_ENABLED: '1' }
const OFF = { VITE_PINE_RUNTIME_PANE_ENABLED: '0' }

const flagsOn = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
}

beforeEach(() => {
  __resetRuntimePanePermission()
  __resetRuntimeAllowList()
})
afterEach(() => {
  setRuntimeKillList([])
  vi.unstubAllEnvs()
})

describe('GT D1 — the per-member permission, latched per tab', () => {
  it('⛔ nothing latched = NOT permitted, even with the build flag on', () => {
    expect(runtimePaneBuilt(ON)).toBe(true)
    expect(runtimePanePermitted()).toBe(false)
    expect(runtimePaneEnabled(ON)).toBe(false)
  })

  it('needs BOTH: permission without the build flag is off, and the two together are on', () => {
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
    expect(runtimePaneEnabled(OFF)).toBe(false)
    expect(runtimePaneEnabled({})).toBe(false)
    expect(runtimePaneEnabled(ON)).toBe(true)
  })

  it('⛔ the FIRST payload carrying the key wins; a later disagreement is counted, not applied', () => {
    expect(latchRuntimePanePermission({ hub_preview_enabled: true })).toBe(null) // no key: no latch
    latchRuntimePanePermission({ pine_runtime_pane_enabled: false })
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
    expect(runtimePaneEnabled(ON)).toBe(false)
    expect(runtimePanePermissionDebug().ignoredDisagreements).toBe(1)
  })

  it('⛔ a non-boolean value never latches (a string "true" is not the server saying yes)', () => {
    latchRuntimePanePermission({ pine_runtime_pane_enabled: 'true' })
    latchRuntimePanePermission(null)
    expect(runtimePanePermitted()).toBe(false)
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
    expect(runtimePanePermitted()).toBe(true)
  })

  it('AuthContext feeds EVERY auth payload to the latch (one map, four paths)', () => {
    const src = fs.readFileSync(path.join(REPO, 'app', 'src', 'context', 'AuthContext.jsx'), 'utf8')
    const at = src.indexOf('const applyServerFlags')
    const body = src.slice(at, src.indexOf('const [loading', at))
    expect(at).toBeGreaterThan(0)
    expect(body).toMatch(/latchRuntimePanePermission\(data\)/)
  })

  it('⛔ with the permission withheld, the install door refuses a runtime document', () => {
    flagsOn()
    const d = docs()['adx-and-di-for-v4']
    try {
      const r = registry.installUserDefinitions([d])
      expect(r.installed).toEqual([])
      latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
      setRuntimeAllowList([d.meta.runtimeSourceHash])
      expect(registry.installUserDefinitions([d]).installed.map((x) => x.id)).toEqual([d.id])
    } finally { registry.uninstallUserDefinition(d.id) }
  })

  it('⛔ with the permission withheld, the member door never routes to the runtime lane', () => {
    flagsOn()
    const d = docs()['adx-and-di-for-v4']
    setRuntimeAllowList([d.meta.runtimeSourceHash])
    const off = memberPaneDefinition({ source: d.compute.source, id: d.id })
    expect(off.lane).not.toBe('runtime')
    expect(off.runtimeDeclined).toBeUndefined()
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
    expect(memberPaneDefinition({ source: d.compute.source, id: d.id }).lane).toBe('runtime')
  })
})

describe('GT D6 — the starter allowlist', () => {
  beforeEach(() => {
    flagsOn()
    latchRuntimePanePermission({ pine_runtime_pane_enabled: true })
  })

  it('the committed list is adx-and-di-for-v4 only, and its hash is the door\'s', () => {
    const committed = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8')).scripts
    expect(committed.map((s) => s.slug)).toEqual(['adx-and-di-for-v4'])
    expect(committed[0].sha256).toBe(docs()['adx-and-di-for-v4'].meta.runtimeSourceHash)
  })

  it('⭐ an allowlisted script attaches through the runtime lane', () => {
    const d = docs()['adx-and-di-for-v4']
    setRuntimeAllowList([d.meta.runtimeSourceHash])
    const built = memberPaneDefinition({ source: d.compute.source, id: d.id })
    expect(built.ok).toBe(true)
    expect(built.lane).toBe('runtime')
  })

  it('⛔ a script not on the list declines BY NAME with the HOST lane\'s sentence', () => {
    const all = docs()
    setRuntimeAllowList([all['adx-and-di-for-v4'].meta.runtimeSourceHash])
    const d = all['delta-rsi-oscillator-strategy']
    const declined = memberPaneDefinition({ source: d.compute.source, id: d.id })
    expect(declined.ok).toBe(false)
    expect(declined.runtimeDeclined.code).toBe('runtime:not-yet-graded')
    expect(declined.runtimeDeclined.why).toMatch(/has not yet been graded against TradingView/)
    // the host lane's own refusal, verbatim: what the member reads with the lane off
    __resetRuntimePanePermission()
    const host = memberPaneDefinition({ source: d.compute.source, id: d.id })
    expect(host.ok).toBe(false)
    expect(declined.reason).toBe(host.reason)
    expect(declined.guard).toBe(host.guard)
  })

  it('⛔ an EMPTY list attaches nothing (and nothing latched is an empty list)', () => {
    expect(runtimeAllowList()).toEqual([])
    for (const d of Object.values(docs())) {
      const built = memberPaneDefinition({ source: d.compute.source, id: d.id })
      expect(built.ok).toBe(false)
      expect(built.runtimeDeclined.code).toBe('runtime:not-yet-graded')
    }
  })

  it('the kill list still comes FIRST', () => {
    const d = docs()['adx-and-di-for-v4']
    setRuntimeAllowList([d.meta.runtimeSourceHash])
    setRuntimeKillList([d.meta.runtimeSourceHash.slice(0, 12)])
    expect(memberPaneDefinition({ source: d.compute.source, id: d.id }).runtimeDeclined.code).toBe('runtime:killed')
  })

  it('normalises entries: a prefix of 12+ hex counts, an id or junk does not', () => {
    const d = docs()['adx-and-di-for-v4']
    setRuntimeAllowList(`${d.id}, junk, ${d.meta.runtimeSourceHash.slice(0, 12).toUpperCase()}`)
    expect(runtimeAllowList()).toEqual([d.meta.runtimeSourceHash.slice(0, 12)])
    expect(runtimeNotGradedOf({ source: d.compute.source })).toBeNull()
    expect(runtimeNotGradedOf({ hash: 'f'.repeat(64) })).toMatch(/not yet been graded/)
  })

  it('⛔ the install door refuses a row the SERVER stamped not-graded, and keeps it', () => {
    const d = docs()['delta-rsi-oscillator-strategy']
    try {
      expect(registry.installUserDefinitions([d]).installed.length).toBe(1)
      const stamped = { ...d, meta: { ...d.meta, runtimeNotGraded: 'this script (sha256 2d34f6b389ee…) has not yet been graded against TradingView, so it is not drawn bar by bar' } }
      const r = registry.installUserDefinitions([stamped])
      expect(r.installed).toEqual([])
      expect(r.errors.join(' ')).toMatch(/not yet been graded/)
      expect(registry.getDefinition(d.id)).toBeNull()
    } finally { registry.uninstallUserDefinition(d.id) }
  })

  it('MemberPane latches the list from the same read as the kill list', () => {
    const src = fs.readFileSync(path.join(REPO, 'app', 'src', 'components', 'chart', 'builder',
      'memberPane', 'MemberPane.jsx'), 'utf8')
    expect(src).toMatch(/setRuntimeKillList\(d\.kill\)[\s\S]{0,400}setRuntimeAllowList\(d\.allow\)/)
  })
})
