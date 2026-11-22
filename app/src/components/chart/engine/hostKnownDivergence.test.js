// HOST KNOWN-DIVERGENCE (owner decision 2026-11-17) — the host lane's twin of the runtime kill list,
// railed at its two browser doors with the list ON (as in the app). `src/test-setup.js` turns it off for
// every other suite (the measuring suites grade the engine); each test here resets it first.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { validateUserDefinitions } from './nativeRegistry'
import { runtimeSourceHash } from './runtimeKill'
import LIST from './hostKnownDivergence.json'
import { familyOf } from '../builder/editorStatus'
import {
  HOST_KNOWN_DIVERGENCE_GUARD, HOST_KNOWN_DIVERGENCE_STAMP, hostKnownDivergenceOf, hostKnownDivergenceList,
  hostKnownDivergenceActive, __resetHostKnownDivergence, __ignoreHostKnownDivergenceForTests,
  __setHostKnownDivergenceForTests,
} from './hostKnownDivergence'

const REPO = path.resolve(process.cwd(), '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
// listed: RDDT and SPY daily grade DIVERGE (TradingView holds 31 table cells, ours 30); it transfers on the production
// lane. (contraction-box-doji-lines stood here until engine 78 (#1858), Pine's tolerant compare, re-graded both its
// SPY captures to MATCH and its entry was lifted.)
const LISTED = read('corpus/committed/heat-map-seasons__53acdf3223.pine')
// control: not listed, both committed captures grade MATCH on the production lane
const CONTROL = read('corpus/committed/atr-bands__ad60b125e6.pine')

beforeEach(() => {
  __resetHostKnownDivergence()
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')     // as in production: the listed script draws objects only
})
afterEach(() => {
  vi.unstubAllEnvs()
  __ignoreHostKnownDivergenceForTests()
})

describe('the list', () => {
  it('is the committed file, ON, with every entry a 64-hex source hash', () => {
    expect(hostKnownDivergenceActive()).toBe(true)
    expect(LIST.scripts.length).toBeGreaterThan(0)
    expect(hostKnownDivergenceList().length).toBe(LIST.scripts.length)
    expect(hostKnownDivergenceList()).toContain(runtimeSourceHash(LISTED))
    expect(hostKnownDivergenceList()).not.toContain(runtimeSourceHash(CONTROL))
  })

  it('is ON in the app: no source outside the rails turns it off (the seam is called by the test grant only)', () => {
    const SRC = path.join(REPO, 'app', 'src')
    const callers = []
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) { if (ent.name !== 'node_modules' && ent.name !== '__tests__') walk(p); continue }
        if (!/\.(js|jsx)$/.test(ent.name) || /\.test\./.test(ent.name)) continue
        if (fs.readFileSync(p, 'utf8').includes('__ignoreHostKnownDivergenceForTests')) callers.push(path.relative(SRC, p).replace(/\\/g, '/'))
      }
    }
    walk(SRC)
    // ⭐ the test grant lives in `testing/runtimeGate.js` since the GATE-BLIND rail (2026-11-19); test-setup.js calls it
    expect(callers.sort()).toEqual(['components/chart/engine/hostKnownDivergence.js', 'test-setup.js', 'testing/runtimeGate.js'])
  })

  it('names the script by its source hash, the CRLF form included', () => {
    expect(hostKnownDivergenceOf(LISTED).guard).toBe(HOST_KNOWN_DIVERGENCE_GUARD)
    expect(hostKnownDivergenceOf(LISTED.replace(/\n/g, '\r\n'))).not.toBe(null)
    expect(hostKnownDivergenceOf(CONTROL)).toBe(null)
    expect(hostKnownDivergenceOf(LISTED + ' ')).toBe(null)                 // another text is another script
  })
})

describe('the member preview door', () => {
  it('refuses a listed script BY NAME, naming the capture and what differs, withheld until fixed', () => {
    const r = memberPaneDefinition({ source: LISTED, id: 'u_111111111111', name: 'listed' })
    expect(r.ok).toBe(false)
    expect(r.definition).toBe(null)
    expect(r.guard).toBe(HOST_KNOWN_DIVERGENCE_GUARD)
    expect(r.reason).toMatch(/draws something that differs from TradingView/)
    expect(r.reason).toMatch(/capture heat-map-seasons-rddt-1d-2026-09-28/)   // names the capture
    expect(r.reason).toMatch(/TradingView 31, ours 30/)                   // the diverging item, from the list
    expect(r.reason).toMatch(/withheld until that is fixed/)
    expect(r.reason).not.toMatch(/\u2014/)
  })

  it('CONTROL: the same script draws when the list is not consulted, so the refusal is the list and nothing else', () => {
    __ignoreHostKnownDivergenceForTests()
    const r = memberPaneDefinition({ source: LISTED, id: 'u_111111111111', name: 'listed' })
    expect(r.ok).toBe(true)
  })

  it('CONTROL: an unlisted script whose captures grade MATCH still draws with the list ON', () => {
    const r = memberPaneDefinition({ source: CONTROL, id: 'u_222222222222', name: 'control' })
    expect(r.ok).toBe(true)
    expect(r.guard == null || r.guard !== HOST_KNOWN_DIVERGENCE_GUARD).toBe(true)
  })

  it('a synthetic list refuses whatever it names (the door reads the list, not a constant)', () => {
    __setHostKnownDivergenceForTests({ scripts: [{ slug: 'synthetic', sha256: runtimeSourceHash(CONTROL), reason: 'SYNTHETIC' }] })
    const r = memberPaneDefinition({ source: CONTROL, id: 'u_222222222222', name: 'control' })
    expect(r.guard).toBe(HOST_KNOWN_DIVERGENCE_GUARD)
    expect(r.reason).toMatch(/SYNTHETIC/)
  })
})

describe('the editor status panel', () => {
  it('names the family: a drawn difference on a captured chart, withheld until fixed', () => {
    const f = familyOf(HOST_KNOWN_DIVERGENCE_GUARD)
    expect(f.id).toBe('divergence')
    expect(f.why).toMatch(/draws something that differs from what TradingView draws/)
    expect(f.why).toMatch(/names the capture/)
    expect(f.why).toMatch(/withheld until/)
  })
})

describe('the install door (a served row)', () => {
  const doc = () => {
    __ignoreHostKnownDivergenceForTests()
    const d = memberPaneDefinition({ source: CONTROL, id: 'u_333333333333', name: 'saved' }).definition
    __resetHostKnownDivergence()
    return d
  }

  it('refuses a host row the server stamped, by its sentence, and keeps it (killedIds, not deleted)', () => {
    const d = doc()
    d.meta = { ...d.meta, [HOST_KNOWN_DIVERGENCE_STAMP]: 'pine:known-divergence: SERVER SENTENCE' }
    const v = validateUserDefinitions([d])
    expect(v.defs).toEqual([])
    expect(v.killedIds).toEqual(['u_333333333333'])
    expect(v.errors.join('\n')).toMatch(/SERVER SENTENCE/)
    expect(v.errors.join('\n')).toMatch(/the saved definition is kept/)
  })

  it('CONTROL: the same row, unstamped, installs', () => {
    const v = validateUserDefinitions([doc()])
    expect(v.errors).toEqual([])
    expect(v.defs.map((x) => x.id)).toEqual(['u_333333333333'])
  })
})
