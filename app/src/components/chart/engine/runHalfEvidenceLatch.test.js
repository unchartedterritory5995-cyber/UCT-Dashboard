// ─── ⭐⭐ RS RATING L8 — THE RUN HALF'S OBJECT EVIDENCE, LATCHED FROM THE KILL READ ─────────
//
// `GET /api/user-definitions/runtime-kill` carries `run_half_evidence` (from the committed
// allowlist records, `runtime_definitions.py::run_half_evidence`; ABSENT when empty) and
// `runtimeKill.js::latchRuntimeLists` latches it, with the other keys of that read, into
// `runHalfRailSeam.js::setRunHalfObjectEvidence`. Both readers (`MemberPane` and the recheck) go
// through that one latch. Rails: absent key admits nothing and clears; fewer than 2 MATCH
// captures do not admit; a sha mismatch does not admit; a control admits.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { latchRuntimeLists, runtimeSourceHash, runtimeKillList } from './runtimeKill'
import {
  runHalfEvidenceAdmits, runHalfEntryAdmits, setRunHalfObjectEvidence, RUN_HALF_EVIDENCE_MIN_CAPTURES,
  runHalfSettingsEntryAdmits, runHalfSettingsAdmitted,
} from './runHalfRailSeam'

const SRC = '//@version=5\nindicator("rs")\nplot(close)\n'
const OTHER = '//@version=5\nindicator("rs")\nplot(open)\n'
const ok = (capture) => ({ capture, verdict: 'MATCH', objectsV2: true, runtimeOn: true })
const read = (evidence) => ({ kill: [], allow: [], save_enabled: false,
  ...(evidence === undefined ? {} : { run_half_evidence: evidence }) })

afterEach(() => setRunHalfObjectEvidence([]))

describe('L8 — the kill read latches the run half\'s evidence', () => {
  it('CONTROL: two distinct objects-v2 MATCH captures, runtime pane on, admit THIS script', () => {
    latchRuntimeLists(read([{ sha256: runtimeSourceHash(SRC), captures: [ok('rddt'), ok('nvda')] }]))
    expect(runHalfEvidenceAdmits(runtimeSourceHash(SRC))).toBe(true)
  })

  it('⛔ an absent key admits nothing, and clears what an earlier read latched', () => {
    latchRuntimeLists(read([{ sha256: runtimeSourceHash(SRC), captures: [ok('rddt'), ok('nvda')] }]))
    latchRuntimeLists(read(undefined))
    expect(runHalfEvidenceAdmits(runtimeSourceHash(SRC))).toBe(false)
  })

  it('⛔ fewer than 2 MATCH captures do not admit (one; the same one twice; one not MATCH)', () => {
    const h = runtimeSourceHash(SRC)
    for (const captures of [[ok('rddt')], [ok('rddt'), ok('rddt')],
      [ok('rddt'), { ...ok('spy'), verdict: 'INCONCLUSIVE' }], [ok('rddt'), { ...ok('spy'), objectsV2: false }]]) {
      latchRuntimeLists(read([{ sha256: h, captures }]))
      expect(runHalfEvidenceAdmits(h), JSON.stringify(captures)).toBe(false)
    }
  })

  it('⛔ evidence for another script\'s sha256 does not admit this one', () => {
    latchRuntimeLists(read([{ sha256: runtimeSourceHash(OTHER), captures: [ok('rddt'), ok('nvda')] }]))
    expect(runHalfEvidenceAdmits(runtimeSourceHash(SRC))).toBe(false)
  })

  it('the same latch carries the other keys (one function, every key of the read)', () => {
    latchRuntimeLists({ kill: ['u_0123456789ab'], allow: [] })
    expect(runtimeKillList()).toEqual(['u_0123456789ab'])
    latchRuntimeLists({ kill: [], allow: [] })
  })

  it('both readers latch through it (MemberPane\'s mount read and the recheck)', () => {
    const here = path.resolve(process.cwd(), 'src/components/chart')
    const pane = fs.readFileSync(path.join(here, 'builder/memberPane/MemberPane.jsx'), 'utf8')
    const kill = fs.readFileSync(path.join(here, 'engine/runtimeKill.js'), 'utf8')
    expect(pane).toMatch(/latchRuntimeLists\(d\)/)
    expect(pane).not.toMatch(/setRuntimeAllowList\(d\.allow\)/)
    const recheck = kill.slice(kill.indexOf('function maybeRefreshRuntimeLists'), kill.indexOf('export function latchRuntimeLists'))
    expect(recheck.length).toBeGreaterThan(100)
    expect(recheck).toMatch(/latchRuntimeLists\(d\)/)
  })
})

// ─── ⭐⭐ RS RATING L9 — THE L7 SUBSTITUTED PATH, NEVER A LOOSER RULE ──────────────────────────
// A record with `admission: "substituted"` and `substituted: [names]` counts captures graded
// MATCH_SUBSTITUTED whose OWN names equal the record's; a record without `admission` still counts
// MATCH only. ONE rule, pinned for both sides by tests/fixtures/ast/run_half_evidence_parity.json
// (`runtime_definitions.py::run_half_entry_admits` reads the same cases).
const PARITY = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), '..', 'tests/fixtures/ast/run_half_evidence_parity.json'), 'utf8'))
const sub = (capture, names = ['syminfo.industry']) => ({
  capture, verdict: 'MATCH_SUBSTITUTED', objectsV2: true, runtimeOn: true, substituted: names })
const subRead = (captures, extra = {}) => read([{ sha256: runtimeSourceHash(SRC), admission: 'substituted',
  substituted: ['syminfo.industry'], captures, ...extra }])

describe('L9 — run-half evidence on the substituted path', () => {
  it('CONTROL: two substituted captures naming exactly the record\'s inputs admit', () => {
    latchRuntimeLists(subRead([sub('rddt'), sub('nvda')]))
    expect(runHalfEvidenceAdmits(runtimeSourceHash(SRC))).toBe(true)
  })

  it('⛔ substituted captures on a record WITHOUT admission do not admit', () => {
    latchRuntimeLists(read([{ sha256: runtimeSourceHash(SRC), captures: [sub('rddt'), sub('nvda')] }]))
    expect(runHalfEvidenceAdmits(runtimeSourceHash(SRC))).toBe(false)
  })

  it('⛔ captures naming other inputs than the record\'s do not admit', () => {
    latchRuntimeLists(subRead([sub('rddt'), sub('nvda', ['syminfo.sector'])]))
    expect(runHalfEvidenceAdmits(runtimeSourceHash(SRC))).toBe(false)
    latchRuntimeLists(subRead([sub('rddt'), sub('nvda', ['syminfo.industry', 'syminfo.sector'])]))
    expect(runHalfEvidenceAdmits(runtimeSourceHash(SRC))).toBe(false)
  })

  it('⛔ fewer than 2 distinct substituted captures do not admit', () => {
    for (const captures of [[sub('rddt')], [sub('rddt'), sub('rddt')]]) {
      latchRuntimeLists(subRead(captures))
      expect(runHalfEvidenceAdmits(runtimeSourceHash(SRC)), JSON.stringify(captures)).toBe(false)
    }
  })

  it('the client rule answers every parity case (the server reads the same file)', () => {
    expect(PARITY.min_captures).toBe(RUN_HALF_EVIDENCE_MIN_CAPTURES)
    const wrong = PARITY.cases.filter((c) => runHalfEntryAdmits(c.entry) !== c.admits).map((c) => c.name)
    expect(wrong).toEqual([])
    // and through the latch, as a member's chart reads it
    const h = runtimeSourceHash(SRC)
    const viaLatch = PARITY.cases.filter((c) => c.entry).filter((c) => {
      latchRuntimeLists(read([{ ...c.entry, sha256: h }]))
      return runHalfEvidenceAdmits(h) !== c.admits
    }).map((c) => c.name)
    expect(viaLatch).toEqual([])
  })

  it('⭐ SETTINGS PARITY (2c) — the client settings rule answers every settings case (the server reads the same file)', () => {
    const cases = PARITY.settings_cases
    const wrong = cases.filter((c) => {
      const r = runHalfSettingsEntryAdmits(c.entry, c.moved)
      return r.ok !== c.ok || JSON.stringify(r.missing) !== JSON.stringify(c.missing)
    }).map((c) => c.name)
    expect(wrong).toEqual([])
    // and through the latch: the kill read carries each capture's `inputs` to the member's chart
    const h = runtimeSourceHash(SRC)
    const viaLatch = cases.filter((c) => c.entry && c.entry.sha256).filter((c) => {
      latchRuntimeLists(read([{ ...c.entry, sha256: h }]))
      const r = runHalfSettingsAdmitted(h, c.moved)
      return r.ok !== c.ok || JSON.stringify(r.missing) !== JSON.stringify(c.missing)
    }).map((c) => c.name)
    expect(viaLatch).toEqual([])
    expect(cases.some((c) => c.ok) && cases.some((c) => !c.ok)).toBe(true)
  })
})

// ─── L9b — on the substituted path the objects-v2 grade may itself be MATCH_SUBSTITUTED ──────
const subV2 = (capture, v2 = ['syminfo.industry']) => ({ ...sub(capture), objectsV2: false, objectsV2Substituted: v2 })

describe('L9b — objects-v2 MATCH_SUBSTITUTED on the substituted path', () => {
  it('CONTROL: it counts when its names are the record\'s', () => {
    latchRuntimeLists(subRead([subV2('rddt'), subV2('nvda')]))
    expect(runHalfEvidenceAdmits(runtimeSourceHash(SRC))).toBe(true)
  })

  it('⛔ it never counts on a plain record', () => {
    const plain = (capture) => ({ capture, verdict: 'MATCH', objectsV2: false, runtimeOn: true,
      objectsV2Substituted: ['syminfo.industry'] })
    latchRuntimeLists(read([{ sha256: runtimeSourceHash(SRC), captures: [plain('rddt'), plain('nvda')] }]))
    expect(runHalfEvidenceAdmits(runtimeSourceHash(SRC))).toBe(false)
  })

  it('⛔ naming other inputs, or none, it does not count', () => {
    for (const v2 of [['syminfo.sector'], [], null]) {
      latchRuntimeLists(subRead([subV2('rddt'), subV2('nvda', v2)]))
      expect(runHalfEvidenceAdmits(runtimeSourceHash(SRC)), JSON.stringify(v2)).toBe(false)
    }
  })
})
