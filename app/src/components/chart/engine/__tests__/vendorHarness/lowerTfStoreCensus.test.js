// app/src/components/chart/engine/__tests__/vendorHarness/lowerTfStoreCensus.test.js
//
// ─── ⭐ LTF — THE LOWER-TIMEFRAME SCRIPTS UNDER THE STORE-AGREEMENT RULE ──────────
//
// The twelve corpus scripts P1's wave-19 wall map (`docs/pine/wave19-wall-map.md`,
// family C-LTF) found blocked ONLY by lower-timeframe data, plus the two scripts whose
// lower reads C41 already serves on TradingView's bars (ema-ribbon, artemis). Each is
// built through the grader's own member door with the lower-timeframe flag ON and the
// objects pane ON, and every code its document stamps is put to
// `lowerTfStoreRule.js` exactly as the product's bind would put it for OUR bars.
//
// Opt-in output: `LTF_CENSUS_OUT=<file.json>` writes one row per script.
// ⛔ It pins what is measured today — which scripts attach and which codes our store
// serves — so a rule change, an evidence change or a door change that moves either is
// seen, not absorbed.

import { describe, it, expect, vi, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { enterMemberDoor } from './ourSide'
import { enterDoorState } from './harness'
import { lowerTfCodesOf } from '../../lowerTf'
import { lowerTfStoreRefusal, lowerTfChildrenOf, demandOf } from '../../lowerTfStoreRule'

afterAll(() => { vi.unstubAllEnvs() })

const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')

export const C_LTF_TWELVE = Object.freeze([
  '3-level-zigzag-semafor', 'ai-supertrend-x-pivot-percentile-strategy-presenttrading',
  'delta-volume-candles-lucf', 'fair-value-gap', 'liquidity-engulfing-displacement-msf',
  'liquidity-levels-sonarlab', 'mtf-dashboard-pro-rsi-fib-sr-volume-strixedge',
  'multi-timeframe-rsi-buy-sell-strategy-tradedots', 'multi-timeframe-trend-indicator',
  'smart-money-breakout-channels-algoalpha', 'volume-profile-bar-magnified-order-blocks-jacobmagleby',
  'zigzag-ma-pattern-recognition',
])
const SERVED_ON_TV_BARS = Object.freeze(['ema-ribbon-trend-filter-strixedge', 'artemis-oscillator-pro'])

function sourceOf(slug) {
  const f = fs.readdirSync(CORPUS).find((x) => x.startsWith(`${slug}__`) && x.endsWith('.pine'))
  if (!f) throw new Error(`no committed corpus script ${slug}`)
  return fs.readFileSync(path.join(CORPUS, f), 'utf8')
}

function rowOf(slug) {
  enterDoorState('on')
  vi.stubEnv('VITE_PINE_LOWER_TF_ENABLED', '1')
  const door = enterMemberDoor(sourceOf(slug))
  const def = door.def || (door.built && door.built.definition) || null
  const codes = def ? lowerTfCodesOf(def) : []
  const perCode = {}
  for (const code of codes) {
    const children = lowerTfChildrenOf(def).get(code) || []
    const refusal = lowerTfStoreRefusal(def, code)
    perCode[code] = {
      reads: children.map((c) => { const d = demandOf(c); return `${d.fields.join('')}@${d.reach === Infinity ? 'inf' : d.reach}` }),
      served: refusal === null,
      reason: refusal ? refusal.why : null,
    }
  }
  return {
    slug,
    attached: door.stage === null,
    stage: door.stage,
    refusal: door.refusal ? door.refusal.slice(0, 240) : null,
    codes,
    perCode,
    servedCodes: codes.filter((c) => perCode[c].served),
  }
}

describe('LTF · the lower-timeframe scripts under the store-agreement rule (flag on, objects pane on)', () => {
  const rows = []

  for (const slug of [...C_LTF_TWELVE, ...SERVED_ON_TV_BARS]) {
    it(slug, () => {
      const r = rowOf(slug)
      rows.push(r)
      // every stamped code is decided, and a served code reads only what the rule clears
      for (const code of r.codes) {
        expect(typeof r.perCode[code].served).toBe('boolean')
        if (!r.perCode[code].served) expect(r.perCode[code].reason).toMatch(/^lower-tf:store-disagrees: /)
      }
    }, 120000)
  }

  it('⭐ THE CENSUS — no script\'s lower read is served from our store; every stamped code is refused by name', () => {
    expect(rows.length).toBe(C_LTF_TWELVE.length + SERVED_ON_TV_BARS.length)
    const out = process.env.LTF_CENSUS_OUT
    if (out) fs.writeFileSync(out, `${JSON.stringify(rows, null, 1)}\n`)
    const served = rows.flatMap((r) => r.servedCodes.map((c) => `${r.slug}@${c}`))
    expect(served).toEqual([])
    // the scripts that reach the bind with lower reads at all (attached, codes stamped)
    const reaching = rows.filter((r) => r.codes.length).map((r) => r.slug).sort()
    expect(reaching).toEqual(EXPECTED_REACHING)
  })
})

/** Pinned from the measurement (see `## LTF` in the triage doc). Ten of the twelve stop at
 *  the member door on ANOTHER wall before any lower read is decided (each row's `refusal`);
 *  artemis attaches with no lower read stamped; ema-ribbon's reads are EMAs of `close`;
 *  mtf-dashboard-pro stamps 15 / 60 / 240 but its installed document holds no `ltf` read
 *  (they sit in translation outputs the door did not keep) — refused, so nothing is fetched. */
const EXPECTED_REACHING = ['ema-ribbon-trend-filter-strixedge', 'mtf-dashboard-pro-rsi-fib-sr-volume-strixedge']
