// app/src/components/chart/builder/memberPane/runtimeWallTimeDoor.test.js
//
// ─── A WALL_TIME STOP REACHES THE MEMBER BY NAME (pine/runtime-walls-4) ──────
//
// `vm.js` stops a run past `WALL_TIME` with `RuntimeLimitError` code
// `WALL_TIME_EXCEEDED` (`runtime/__tests__/wallTime.test.js`). This is the other
// half: through the REAL member door — `memberPaneDefinition` → installed →
// `computeFor` — the stop arrives as a named column error on every column the
// document declares, never a blank series, never a throw. The door runs the VM
// with its DEFAULT clock, so the clock is driven the only way it can be from out
// here: `performance.now`, which `limits.js::defaultClock` reads at call time.
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition, loadRuntimeLaneDoor } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'

beforeAll(async () => { await loadRuntimeLaneDoor() })
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const d of registry.listUserDefinitions()) registry.uninstallUserDefinition(d.id)
})

const REPO = path.resolve(process.cwd(), '..')
const SOURCE = fs.readFileSync(path.join(REPO, 'corpus/committed/kernel-channel-backquant__d8c4b7f75c.pine'), 'utf8')
const BARS = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'), 'utf8'))
  .bars.slice(-600)
const CTX = { tf: 'D', newestBarIsForming: false }

function install() {
  vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
  const d = memberPaneDefinition({ source: SOURCE, id: 'u_member-pane-walltime' })
  expect(d.ok, d.reason).toBe(true)
  expect(d.lane).toBe('runtime')
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(errors).toEqual([])
  return installed[0]
}

describe('⭐ the member door reports WALL_TIME_EXCEEDED by name', () => {
  it('⭐ a clock that races past 5,000 ms stops every column with code WALL_TIME_EXCEEDED', () => {
    const def = install()
    let t = 0
    // one second per read: the default 5,000 ms wall is passed on the sixth check
    vi.spyOn(performance, 'now').mockImplementation(() => { t += 1000; return t })
    const cols = registry.computeFor(def, BARS, undefined, CTX)
    vi.restoreAllMocks()
    const errs = registry.columnErrors(cols)
    const keys = Object.keys(errs)
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) {
      expect(errs[k].code, k).toBe('WALL_TIME_EXCEEDED')
      expect(errs[k].limit, k).toBe('WALL_TIME')
      expect(errs[k].message, k).toMatch(/^WALL_TIME_EXCEEDED — ceiling 5000, reached \d+$/)
    }

    // ⚠️ THE STOP IS REMEMBERED FOR THESE BARS, deliberately: the lane caches a
    // run per bars array (`pineRuntimeLane.js::RUNS`), failures included, so a
    // script that met the wall is not re-run — and does not freeze the tab for
    // another five seconds — on every recompute of the same data. A new fetch is
    // a new array and runs again.
    const clock = vi.spyOn(performance, 'now')
    const again = registry.columnErrors(registry.computeFor(def, BARS, undefined, CTX))
    expect(clock).not.toHaveBeenCalled()
    expect(Object.values(again).every((e) => e.code === 'WALL_TIME_EXCEEDED')).toBe(true)
  })

  it('⛔ CONTROL: the same document on the real clock computes with no column error', () => {
    const def = install()
    // a fresh array: the stop above is remembered for THAT one (see above)
    const cols = registry.computeFor(def, BARS.slice(), undefined, CTX)
    expect(registry.columnErrors(cols)).toEqual({})
  })
})
