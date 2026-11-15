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
import { runHalfEvidenceAdmits, setRunHalfObjectEvidence } from './runHalfRailSeam'

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
