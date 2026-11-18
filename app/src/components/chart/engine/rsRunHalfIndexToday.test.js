// ─── ⭐⭐ RS RATING L10 — THE RATING LABEL IS DRAWN IN SESSION, WHEN THE INDEX ANSWER ENDS AT TODAY ─────
//
// ⚰️ 2026-11-17, production (smoke@ on AGL): before the open the run half drew RS Rating's label and
// dots; in session every chart refused it, `runtime:request`. The chart's own daily answer ends at
// today's forming bar (the equity serve appends it), SPX's ended at yesterday, so
// `requestSupply.js` held the newest bar back ("`SPX` has no bar for 2026-11-17 yet") and the run
// drew nothing (`runtimeColumns.js`, RS RATING L5: a last-bar label would carry that read).
// The server now ends a cash index's daily answer at today's session too
// (`api/index_bars.py::with_todays_session`, `tests/test_index_developing_bar.py`); the engine
// needed no change. This rail holds the engine's half of that, on data in the SHAPES the server
// answers with (synthetic values, no vendor data):
//   * the chart's daily rows keyed by ISO day ('2026-11-17', as `/api/bars/AGL?tf=D` serves them);
//   * SPX's daily rows keyed by the UTC midnight of the session date in unix SECONDS (as
//     `/api/bars/SPX?tf=D` serves them), today's included;
//   * the RS seed's rows keyed by ISO day.
// The two key shapes meet in ONE place: `otherSymbols.js::witnessedBarsOf` re-keys every row of a
// witnessed spelling (`SP:SPX`) by `interpret.js::isoDay`, and `requestAlignment` then matches the
// chart's rows by exact key. Both paths a member reaches RS Rating by are run: the door's definition,
// and the stored row as "Your indicators" installs it (the same document through JSON).
// ⛔ CONTROL: the same forming chart with SPX ending at yesterday is refused `runtime:request` and
// draws nothing; that is production before the fix, and it is what turns this rail red if the
// index answer loses today's bar or the re-keying stops reading unix seconds.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import * as registry from './nativeRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { runtimeColumnsFor, resetRuntimeSessions, resetRuntimeLedgers } from './runtime/runtimeColumns'
import { runHalfOf, runtimeObjectsOf } from './runtime/runtimeObjects'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList, runtimeSourceHash } from './runtimeKill'
import { setRunHalfObjectEvidence } from './runHalfRailSeam'

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const SEED_KEY = 'SEED_FRED6725_RS_RATING:RSRATING'
const TODAY = '2026-11-17'
const utcMidnight = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000

// 600 weekday sessions ending at TODAY (the chart's forming bar)
const SESSIONS = (() => {
  const out = []
  for (let t = Date.parse(`${TODAY}T00:00:00Z`); out.length < 600; t -= 86400000) {
    const wd = new Date(t).getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(new Date(t).toISOString().slice(0, 10))
  }
  return out
})()
const CHART = SESSIONS.map((t, i) => {
  const c = 80 + 20 * Math.sin(i / 17) + i * 0.05
  return { t, o: c - 0.4, h: c + 1.1, l: c - 1.2, c, v: 1e6 + i }
})
const spxRow = (iso, i) => {
  const c = 5400 + 300 * Math.sin(i / 41) + i * 3
  return { t: utcMidnight(iso), o: c - 5, h: c + 20, l: c - 22, c, v: 3e9 }
}
const SPX_THROUGH_YESTERDAY = SESSIONS.slice(0, -1).map(spxRow)
const SPX_THROUGH_TODAY = SESSIONS.map(spxRow)
const SEED = SESSIONS.slice(-35, -1).map((t, i) => ({ t, o: 0, h: 1000, l: 0, c: 300 - 7 * i, v: 0 }))

function ctxWith(spx) {
  return {
    tf: 'D', newestBarIsForming: true, historyFromListing: true,
    symbol: { ticker: 'AGL', exchange: 'NYSE', industry: 'Medical Care Facilities', sector: 'Healthcare', securityType: 'stock' },
    secondary: new Map([['SPX', { bars: spx, status: 'available' }], [SEED_KEY, { bars: SEED, status: 'available' }]]),
    exchangeOf: (t) => (t === 'SPX' ? 'SP' : null),
  }
}

const PATHS = {
  door: () => memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_rs-l10-door' }).definition,
  'your indicators': () => {
    const stored = JSON.parse(JSON.stringify(memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_rs-l10-saved' }).definition))
    return stored
  },
}

let installed = []
function install(def) {
  const { installed: got, errors } = registry.installUserDefinitions([def])
  expect(got.length, errors.join(' | ')).toBe(1)
  installed.push(got[0].id)
  return got[0]
}

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
  // production admits RS Rating's run half by its recorded captures (`runtime_kill` →
  // `run_half_evidence`); the same admission, for this script's hash
  setRunHalfObjectEvidence([{ sha256: runtimeSourceHash(RS), captures: [
    { capture: 'a', verdict: 'MATCH', objectsV2: true, runtimeOn: true },
    { capture: 'b', verdict: 'MATCH', objectsV2: true, runtimeOn: true }] }])
})
afterEach(() => {
  for (const id of installed) registry.uninstallUserDefinition(id)
  installed = []
  setRunHalfObjectEvidence([])
  setRuntimeKillList([])
  resetRuntimeSessions()
  resetRuntimeLedgers()
  vi.unstubAllEnvs()
})

describe('L10 — in session, with the index answer ending at today, RS Rating draws its rating', () => {
  it('the fixture is shaped as the server answers: ISO chart keys, unix-second SPX keys, today forming', () => {
    expect(CHART[CHART.length - 1].t).toBe(TODAY)
    expect(SPX_THROUGH_TODAY[SPX_THROUGH_TODAY.length - 1].t).toBe(1794873600)
    expect(SPX_THROUGH_YESTERDAY[SPX_THROUGH_YESTERDAY.length - 1].t).toBe(utcMidnight('2026-11-16'))
  })

  for (const [name, build] of Object.entries(PATHS)) {
    it(`${name}: the run half is served and the rating label is drawn on the forming bar`, () => {
      const def = install(build())
      const cols = registry.computeFor(def, CHART, {}, ctxWith(SPX_THROUGH_TODAY))
      expect(runHalfOf(cols)).toEqual({ state: 'served', code: null })
      const drawn = runtimeObjectsOf(cols)
      expect(drawn).not.toBeNull()
      const labels = drawn.live.filter((o) => o.family === 'label' && o.createdBar === CHART.length - 1)
      expect(labels.map((o) => o.props.text.trim())).toEqual(['RS Rating', expect.stringMatching(/^\d{1,2}$/)])
    })

    it(`${name}: ⛔ CONTROL — SPX ending at yesterday is refused runtime:request and draws nothing`, () => {
      const def = install(build())
      const cols = registry.computeFor(def, CHART, {}, ctxWith(SPX_THROUGH_YESTERDAY))
      expect(runHalfOf(cols)).toEqual({ state: 'refused', code: 'runtime:request' })
      expect(runtimeObjectsOf(cols)).toBeNull()
    })
  }
})
