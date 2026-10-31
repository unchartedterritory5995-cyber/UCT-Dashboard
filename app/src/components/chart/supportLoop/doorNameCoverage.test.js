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
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { translatePine } from '../engine/ast/pine'
import BUILTINS from './pineBuiltins.json'
import FIXES from './fixedGaps.json'
import {
  buildDoorNameCoverage, probeName, probeFix, fixedOnMaster, probeScript,
} from './doorNameCoverage'

const FILE = path.resolve(process.cwd(), 'src/components/chart/supportLoop/doorNameCoverage.json')
const LF = String.fromCharCode(10)

describe('doorNameCoverage.json is the current build\'s answer', () => {
  it('regenerates byte-for-byte (WRITE_DOOR_NAME_COVERAGE=1 rewrites it)', () => {
    const built = buildDoorNameCoverage({ names: BUILTINS.names, fixes: FIXES.fixes, translate: translatePine })
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
