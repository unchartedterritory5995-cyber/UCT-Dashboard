// app/src/components/chart/supportLoop/doorNameCoverage.test.js
//
// ⭐ THE COMMITTED "WHICH GAPS ARE FIXED" FILE IS THE CURRENT BUILD'S ANSWER.
// `doorNameCoverage.json` is regenerated here, through the Pine door, and compared
// with the committed bytes. A fix that changes what the door accepts reds this
// file until the JSON is regenerated in the same change:
//
//   (cd app && WRITE_DOOR_NAME_COVERAGE=1 node node_modules/vitest/vitest.mjs run \
//      src/components/chart/supportLoop/doorNameCoverage.test.js)
//
// Spec: docs/pine/support-loop/PHASE-B.md.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { translatePine } from '../engine/ast/pine'
import { inspectSource } from '../builder/PineBox'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { editorStatus } from '../builder/editorStatus'
import BUILTINS from './pineBuiltins.json'
import FIXES from './fixedGaps.json'
import { RUNS_STATES } from './assistantPineReference'
import {
  buildDoorNameCoverage, probeName, probeFix, fixedOnMaster, probeScript, NAMED_PROBE_ARGS,
} from './doorNameCoverage'

const FILE = path.resolve(process.cwd(), 'src/components/chart/supportLoop/doorNameCoverage.json')
const LF = String.fromCharCode(10)
// the member's chart gates, as assistantPineReference.test.js sets them (the two files ask one paste path)
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

/** ⭐⭐ (train e95) The member's paste path on one whole probe script, as the assistant reference asks it
 *  (`assistantPineReference.test.js::verdictOf`): served when the pane builds and the status reads as running. */
let n = 0
function serves(source) {
  const report = inspectSource(source, 'pine')
  const pane = memberPaneDefinition({ source, id: `u_dnc_${n += 1}`, name: 'probe' })
  const status = editorStatus({ report, pane, savedRow: null, inspectedSource: source })
  const ok = pane.ok === true && RUNS_STATES.includes(status.state)
  return { ok, guard: ok ? null : (pane.ok === true ? `status:${status.state}` : (pane.guard || 'not-built')) }
}

describe('doorNameCoverage.json is the current build\'s answer', () => {
  it('regenerates byte-for-byte (WRITE_DOOR_NAME_COVERAGE=1 rewrites it)', () => {
    const built = buildDoorNameCoverage({ names: BUILTINS.names, fixes: FIXES.fixes, translate: translatePine, serves })
    const text = `${JSON.stringify(built, null, 1)}${LF}`
    if (process.env.WRITE_DOOR_NAME_COVERAGE === '1') fs.writeFileSync(FILE, text)
    const committed = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, LF)
    expect(committed === text,
      'doorNameCoverage.json is stale: the door now answers differently. Regenerate it with '
      + 'WRITE_DOOR_NAME_COVERAGE=1 (see this file\'s header) and commit it with the fix.').toBe(true)
  }, 300_000)
})

describe('the probe can say yes, and can say no', () => {
  it('a name the door serves reads reachable (control: ta.sma)', () => {
    expect(probeName('ta.sma', translatePine).status).toBe('reachable')
  })
  it('a name nobody defines reads name-unknown, never reachable', () => {
    expect(probeName('ta.zz_not_a_function', translatePine).status).toBe('name-unknown')
  })
  it('a refusal about ANOTHER token is not attributed to the name', () => {
    // The probe for a name the translator refuses on some other token must not
    // turn that refusal into "the door knows this name".
    const fake = () => ({ outputs: [{ refusal: { guard: 'pine:arity', token: 'other.name' } }] })
    expect(probeName('ta.alma', fake).status).toBe('unprobed')
  })
  it('⭐⭐ (train e95) a data read is probed with the call a member\'s door serves, never its bare call', () => {
    for (const [name, args] of Object.entries(NAMED_PROBE_ARGS)) {
      expect(probeName(name, translatePine, serves), name).toEqual({ status: 'reachable', probe: `${name}${args}`, guard: null })
    }
    // CONTROL: the bare call translates with no refusal, so the generic probes would have reached it first
    expect(probeFix({ probe: probeScript('request.earnings()') }, translatePine).status).toBe('fixed')
  })
  it('⭐⭐ (train e95) a probe the member\'s paste path refuses is not the name\'s call: the next one is', () => {
    expect(probeName('ta.highestbars', translatePine).probe).toBe('ta.highestbars(close)')
    expect(serves(probeScript('ta.highestbars(close)')).ok).toBe(false)
    expect(probeName('ta.highestbars', translatePine, serves).probe).toBe('ta.highestbars(close, 14)')
    // CONTROL: a paste path that serves nothing leaves the name known to the door and not reachable
    const none = probeName('ta.sma', translatePine, () => ({ ok: false, guard: 'pine:install' }))
    expect([none.status, none.probe]).toEqual(['call-unmapped', null])
    expect(probeName('ta.sma', translatePine, serves).status).toBe('reachable')
  })
  it('a fix entry is fixed only when its repro translates', () => {
    expect(probeFix({ probe: probeScript('ta.sma(close, 14)') }, translatePine).status).toBe('fixed')
    expect(probeFix({ probe: probeScript('ta.zz_not_a_function(close)') }, translatePine).status).toBe('open')
  })
})

describe('fixedOnMaster — every uncertainty resolves to OPEN', () => {
  const manifest = {
    names: {
      'a.known': { status: 'call-unmapped' }, 'a.served': { status: 'reachable' },
      'a.unknown': { status: 'name-unknown' }, 'a.unprobed': { status: 'unprobed' },
    },
    fixes: [{ name: 'a.known', kind: 'call-unmapped', status: 'fixed' },
      { name: 'a.served', kind: 'call-unmapped', status: 'open' }],
  }
  it('name-unknown gaps drop off ONLY when the door serves the name', () => {
    // the door knows the name but cannot map the call: the paste still loses it
    expect(fixedOnMaster(manifest, 'a.known', 'name-unknown')).toBe(false)
    expect(fixedOnMaster(manifest, 'a.served', 'name-unknown')).toBe(true)
    expect(fixedOnMaster(manifest, 'a.unknown', 'name-unknown')).toBe(false)
    expect(fixedOnMaster(manifest, 'a.unprobed', 'name-unknown')).toBe(false)
    expect(fixedOnMaster(manifest, 'a.absent', 'name-unknown')).toBe(false)
  })
  it('call-unmapped gaps drop off ONLY through a passing fix-ledger repro', () => {
    expect(fixedOnMaster(manifest, 'a.known', 'call-unmapped')).toBe(true)
    expect(fixedOnMaster(manifest, 'a.served', 'call-unmapped')).toBe(false)
    expect(fixedOnMaster(manifest, 'a.unknown', 'call-unmapped')).toBe(false)
  })
})
