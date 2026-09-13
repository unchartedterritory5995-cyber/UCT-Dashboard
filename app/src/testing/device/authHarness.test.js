// @vitest-environment node
/* The harness's own rails — because a test harness is a product too.
 *
 * ⛔ WHAT THIS FILE IS ACTUALLY FOR. Every check here is a FALSE POSITIVE this
 * program has already shipped in some other instrument: a run that reported
 * success while measuring nothing. The device minute is unrepeatable and
 * expensive, so the harness has to be trustworthy BEFORE it is pointed at a
 * phone — a bad reading there costs a device and, worse, gets believed.
 */
import { describe, it, expect as vExpect, vi } from 'vitest'
import {
  STATE, step, runSteps, expect as hExpect, until, settle, summarise,
} from './authHarness'

const ok = (id, tier = 1, needs = []) => step(id, tier, id, needs, async () => hExpect('x', true, 'x'))
const bad = (id, tier = 1, needs = []) => step(id, tier, id, needs, async () => { throw new Error('boom') })

describe('a failed prerequisite can never read as PASS', () => {
  it('⛔⛔ a broken login BLOCKS every downstream flow — it does not pass them', async () => {
    const steps = [
      bad('auth'),
      ok('app', 1, ['auth']),
      ok('ws-write', 1, ['app']),
      ok('ws-readback', 1, ['ws-write']),
    ]
    const r = await runSteps(steps, {})
    vExpect(r.find((x) => x.id === 'auth').state).toBe(STATE.FAIL)
    for (const id of ['app', 'ws-write', 'ws-readback']) {
      const row = r.find((x) => x.id === id)
      vExpect(row.state, `${id} must be BLOCKED, never PASS`).toBe(STATE.BLOCKED)
    }
    // And it must NAME what blocked it, or the report is unreadable at 3am.
    vExpect(r.find((x) => x.id === 'app').note).toContain('auth')
  })

  it("⛔ a blocked step's body NEVER RUNS — the guard is enforcement, not a label", async () => {
    const body = vi.fn(async () => hExpect(1, true, 1))
    const r = await runSteps([bad('auth'), step('app', 1, 'app', ['auth'], body)], {})
    vExpect(body).not.toHaveBeenCalled()
    vExpect(r[1].state).toBe(STATE.BLOCKED)
  })

  it('NON-VACUITY · the same runner DOES pass a step whose prerequisite passed', async () => {
    // Without this control the two cases above would also pass if `runSteps`
    // simply blocked everything, which is the classic gate-that-cannot-fail.
    const r = await runSteps([ok('auth'), ok('app', 1, ['auth'])], {})
    vExpect(r.map((x) => x.state)).toEqual([STATE.PASS, STATE.PASS])
  })
})

describe('DEVICE_WORKSPACE_ROUNDTRIP reports the truth', () => {
  const roundTrip = (states) => summarise(
    ['ws-write', 'ws-readback', 'ws-reload', 'ws-nosymloss'].map((id, i) => ({
      id, tier: 1, title: id, state: states[i],
    })),
  ).deviceWorkspaceRoundTrip

  it('PASS only when every leg passed', () => {
    vExpect(roundTrip([STATE.PASS, STATE.PASS, STATE.PASS, STATE.PASS])).toBe(STATE.PASS)
  })

  it('⛔⛔ a broken READ-BACK makes it FAIL — never PASS, never quietly BLOCKED', () => {
    vExpect(roundTrip([STATE.PASS, STATE.FAIL, STATE.BLOCKED, STATE.BLOCKED])).toBe(STATE.FAIL)
  })

  it('⛔ a leg that never ran is BLOCKED, which is NOT the same as PASS', () => {
    vExpect(roundTrip([STATE.PASS, STATE.BLOCKED, STATE.BLOCKED, STATE.BLOCKED])).toBe(STATE.BLOCKED)
  })

  it('⛔ a MISSING leg cannot be read as success', () => {
    const s = summarise([{ id: 'ws-write', tier: 1, title: 'w', state: STATE.PASS }])
    vExpect(s.deviceWorkspaceRoundTrip).toBe(STATE.BLOCKED)
  })
})

describe('the blank-board detector', () => {
  /* The shipped assertion is `held && canvases > 0 && !!symbol`. A migration
   * that half-lands leaves the marker intact and the board empty, so a rail on
   * the marker alone would call that a PASS — which is the single failure mode
   * MOB-08 must not be allowed to hide behind. */
  const detect = (held, canvases, symbol) => {
    try { hExpect(`${held}/${canvases}/${symbol}`, held && canvases > 0 && !!symbol, 'ok'); return STATE.PASS }
    catch { return STATE.FAIL }
  }

  it('passes a healthy board', () => vExpect(detect(true, 1, 'SPY')).toBe(STATE.PASS))

  it('⛔⛔ FAILS a blank board even though the marker survived', () => {
    vExpect(detect(true, 0, 'SPY')).toBe(STATE.FAIL)
  })

  it('⛔ FAILS a board that lost its symbol', () => {
    vExpect(detect(true, 1, '')).toBe(STATE.FAIL)
  })

  it('⛔ FAILS when the marker did not survive', () => {
    vExpect(detect(false, 1, 'SPY')).toBe(STATE.FAIL)
  })
})

describe('semantic waiting, not sleeping', () => {
  it('until() resolves as soon as the condition holds', async () => {
    let n = 0
    const got = await until('a counter', () => (++n >= 3 ? n : null), { timeout: 3000, gap: 5 })
    vExpect(got).toBe(3)
  })

  it('⛔ until() throws BY NAME when the condition never arrives', async () => {
    await vExpect(until('the thing that never comes', () => null, { timeout: 120, gap: 20 }))
      .rejects.toThrow(/never arrived: the thing that never comes/)
  })

  it('settle() waits for a value to STOP changing', async () => {
    let n = 0
    const got = await settle('a settling value', () => (n < 3 ? ++n : 3), { timeout: 3000, gap: 5 })
    vExpect(got).toBe(3)
  })

  it('⛔ settle() throws when the value never stops moving', async () => {
    let n = 0
    await vExpect(settle('a value that never settles', () => ++n, { timeout: 150, gap: 20 }))
      .rejects.toThrow(/never settled/)
  })
})

describe('the harness carries no credential', () => {
  it('⛔⛔ the committed module must never contain the sandbox password', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const url = await import('node:url')
    const here = path.dirname(url.fileURLToPath(import.meta.url))
    const src = fs.readFileSync(path.join(here, 'authHarness.js'), 'utf8')
    // The credential arrives at runtime from a generated file the launcher
    // deletes. If it ever gets inlined here, it lands in git history forever.
    vExpect(src).not.toMatch(/SandboxDevice|password\s*:\s*['"][^'"]+['"]/)
    vExpect(src, 'the credential must arrive as an injected parameter').toContain('cred')
  })
})
