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
import {
  HOST_KNOWN_DIVERGENCE_GUARD, HOST_KNOWN_DIVERGENCE_STAMP, hostKnownDivergenceOf, hostKnownDivergenceList,
  hostKnownDivergenceActive, __resetHostKnownDivergence, __ignoreHostKnownDivergenceForTests,
  __setHostKnownDivergenceForTests,
} from './hostKnownDivergence'

const REPO = path.resolve(process.cwd(), '..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
// listed: SPY daily grades DIVERGE (TradingView holds 204 lines, ours 205); it transfers on the production lane
const LISTED = read('corpus/committed/contraction-box-doji-lines__1486658151.pine')
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

  it('names the script by its source hash, the CRLF form included', () => {
    expect(hostKnownDivergenceOf(LISTED).guard).toBe(HOST_KNOWN_DIVERGENCE_GUARD)
    expect(hostKnownDivergenceOf(LISTED.replace(/\n/g, '\r\n'))).not.toBe(null)
    expect(hostKnownDivergenceOf(CONTROL)).toBe(null)
    expect(hostKnownDivergenceOf(LISTED + ' ')).toBe(null)                 // another text is another script
  })
})

describe('the member preview door', () => {
  it('refuses a listed script BY NAME, with what we know and that it is being fixed', () => {
    const r = memberPaneDefinition({ source: LISTED, id: 'u_111111111111', name: 'listed' })
    expect(r.ok).toBe(false)
    expect(r.definition).toBe(null)
    expect(r.guard).toBe(HOST_KNOWN_DIVERGENCE_GUARD)
    expect(r.reason).toMatch(/does not yet draw exactly as TradingView does/)
    expect(r.reason).toMatch(/204/)                                       // the diverging item, from the list
    expect(r.reason).toMatch(/being fixed/)
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
