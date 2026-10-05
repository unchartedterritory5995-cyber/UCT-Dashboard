// app/src/components/chart/engine/ast/pineProbeReplay.test.js
//
// ─── C24 — A PROBE'S RESOLUTION IS REPLAYED, NEVER SKIPPED (`resolveProbed`) ──
//
// `boundedBarssinceThroughBinding` asks `constIntOf` of both operands of every
// comparison, and `constIntOf` answers by RESOLVING. The ordinary path then
// resolved the same operands again, so a comparison inside a binding another
// comparison reads doubled at every level. Skipping the probe was tried and
// reverted: `resolve` MINTS Track F parameter ids, and the probe is the first
// resolution, so skipping it moved saved ids (objects triage § C9). C24 keeps
// the probe and replays its tree for the repeat — and only when the probe did
// no first-time work, so the repeat it replaces would have minted nothing and
// cost exactly the steps it charges.
//
// ⛔ EVERY PINNED NUMBER BELOW WAS MEASURED ON THE PRE-C24 TREE (d6bb8b336).
// They are the proof that the step budget reads what it read before — do not
// re-pin them to make a change pass; a moved number is a moved `pine:timeout`.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { translatePine, Resolver } from './pine.js'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
const REPO = path.resolve(HERE, '../../../../../..')

/** `x_k = x_{k-1} > open ? high : low`: every level is a comparison whose
 *  operand is the previous level, so a doubled resolve doubles per level. */
function chain(depth) {
  const lines = ['//@version=5', 'indicator("c24 chain")',
    'len = input.int(5, "Len", minval = 1, maxval = 50)', 'x0 = ta.sma(close, len)']
  for (let i = 1; i <= depth; i++) lines.push(`x${i} = x${i - 1} > open ? high : low`)
  lines.push(`plot(x${depth}, "out")`)
  return lines.join('\n') + '\n'
}

/** Runs `fn` with every Resolver's REAL work counted (`checkBudget` runs once
 *  per real resolve; a replay never calls it) and every Resolver's final
 *  `budgetSteps` collected in construction order. */
function measure(fn) {
  const seen = []
  const set = new Set()
  let calls = 0
  const orig = Resolver.prototype.checkBudget
  Resolver.prototype.checkBudget = function (tok) {
    calls += 1
    if (!set.has(this)) { set.add(this); seen.push(this) }
    return orig.call(this, tok)
  }
  let result
  try { result = fn() } finally { Resolver.prototype.checkBudget = orig }
  return { result, calls, steps: seen.map((r) => r.budgetSteps) }
}

const MANIFEST = { strict: true, paramManifest: true }
const PLAIN = { strict: true }

describe('C24 — the comparison probe is replayed, not resolved twice', () => {
  it('⭐ real resolution work grows linearly with nesting, not exponentially', () => {
    const d6 = measure(() => translatePine(chain(6), MANIFEST))
    const d12 = measure(() => translatePine(chain(12), MANIFEST))
    // Pre-C24: 955 and 61,435 real resolves (2^depth). Replayed: 184 and 574.
    expect(d12.calls, 'the probe is being resolved twice again').toBeLessThan(1000)
    expect(d12.calls / d6.calls).toBeLessThan(4)
    // …and the output is the same translation, one output, no refusal.
    expect(d12.result.refusals || []).toEqual([])
    expect(d12.result.outputs.length).toBe(1)
  })

  it('⛔ the step budget is charged as if the repeat had run — pinned pre-C24', () => {
    for (const [depth, opts, steps] of [
      [6, PLAIN, 953], [6, MANIFEST, 955], [12, PLAIN, 61433], [12, MANIFEST, 61435],
    ]) {
      expect(measure(() => translatePine(chain(depth), opts)).steps, `chain(${depth})`)
        .toEqual([steps])
    }
  })

  it('⛔ a probe that minted a parameter is not replayed — ids stay where they were', () => {
    const { result } = measure(() => translatePine(chain(12), MANIFEST))
    expect(result.inputParams.map((p) => [p.id, p.sourceName, p.min, p.max]))
      .toEqual([['__uct_param_1001', 'len', 1, 50]])
  })

  it('⛔ the first-time mark sees a mint even when no Map of the resolver grows', () => {
    // `paramMint` is SHARED by every output's Resolver and is not a Map field of
    // any of them, and an input first resolved while minting is withheld (R36's
    // closing folds) records its `usedInputs` entry then — so a later minting
    // resolve grows nothing the generic size sum can see. The mark reads the
    // counter directly for exactly that case.
    const self = { firstTimeWork: 0, usedInputs: new Map([['1:1', {}]]),
      paramMint: { counter: 3, byNode: new Map([[{}, {}]]) } }
    const before = Resolver.prototype.firstTimeMark.call(self)
    self.paramMint.counter += 1
    expect(Resolver.prototype.firstTimeMark.call(self)).not.toBe(before)
    const again = Resolver.prototype.firstTimeMark.call(self)
    self.firstTimeWork += 1
    expect(Resolver.prototype.firstTimeMark.call(self)).not.toBe(again)
    const sized = Resolver.prototype.firstTimeMark.call(self)
    self.usedInputs.set('2:2', {})
    expect(Resolver.prototype.firstTimeMark.call(self)).not.toBe(sized)
  })

  it('⛔ every corpus Resolver ends on the same budgetSteps as before C24', () => {
    // Chosen because each once moved: artemis (a `var` read cache), htf-liquidity
    // and pro-trading-art (a window's `readMemo`), adaptive-trend-following and
    // 72s-hull (Track F minting — the two § C9 names).
    const PINNED = {
      // ⭐ C28 moved artemis and 72s-hull (`Resolver.staleSnapshotRead`): a name
      // bound below a write the walk could not fold now refuses at the read
      // instead of resolving on through the declaration, so fewer Resolvers are
      // built and fewer steps spent. 72s-hull's outputs are byte-identical (the
      // refusal is inside a probe); artemis withholds four cells TradingView
      // does not draw (`vendorHarness.c28StaleSnapshot`). Pre-C28: artemis
      // plain [603, 758613, 'b59350139db56c8b'] / manifest [603, 758621,
      // '71eed9b8287182f3'], 72s-hull [101, 1387, 'a3aad37da07d35dd'] both.
      // ⭐ C28b moved artemis and htf-liquidity again: a `request.security` whose
      // timeframe is `''` (an `input.timeframe('')`) is the identity now, so it
      // resolves on instead of refusing — more steps, outputs byte-identical
      // (translation census). Pre-C28b: artemis [521, 405316, '0ed727028fb37e4b']
      // / [521, 405324, '4fd1716a833c1b5d'], htf-liquidity [691, 5704,
      // '83d96de74e5b2d0d'] both.
      // ⭐ C32 moved artemis: its KNN memory (`knnF1`, 100 slots, read above its
      // writer) is a window now, so `str.tostring(kSize)` resolves — four more
      // Resolvers, 122 more steps; plot outputs byte-identical (translation
      // census), one more cell served (`vendorHarness.c32Collections`). Pre-C32:
      // plain [521, 405996, '65582febd0bccf56'] / manifest [521, 406004,
      // '41fd10acf67ccfb8'].
      // ⭐ C31 moved artemis: its KNN panel's `fTxt` cell — a block local declared
      // below an unfoldable `for` — is bound and read now (TradingView's
      // `O-  V-  S-`, `vendorHarness.c31Loops`), so six more Resolvers are built
      // for the three comparisons it reads. Plots byte-identical (translation
      // census). Pre-C31: [521, 405996, '65582febd0bccf56'] / [521, 406004,
      // '41fd10acf67ccfb8'].
      // ⭐ C37 moved artemis: 48 colour slots the object lane dropped are read now
      // — `color.new(thOb, 100 - divRegAlpha)`, `color.new(thOb, isLight ? 55 :
      // 45)` and its tint helper's conditions, each a transparency or a colour
      // test the Resolver is asked for. Plot outputs byte-identical (translation
      // census); every one of the 48 slots is TradingView's colour
      // (`vendorHarness.c37ObjectColours`). On the wave-8 + C29/C30/C32/C34/C35
      // base alone C37 read plain [722, 426212, '55e872139c194b7f'] / manifest
      // [722, 426220, 'c489c4af4d0b625d'] against [525, 406118] / [525, 406126]:
      // 197 more Resolvers, 20,094 more steps.
      'artemis-oscillator-pro__ea1097ca9e': {
        // ⭐ Wave 9 carries BOTH (C32 +4 Resolvers / +122 steps, C31 +6 / +3,759): the
        // measured sum, exactly additive — 521 + 4 + 6, 405,996 + 122 + 3,759 —
        // was plain [531, 409877, 'f38c24a72a987c60'] / manifest [531, 409885,
        // '61f060f7ebfeaf71'] before C37 merged. With C37 on top, MEASURED on the
        // merged tree (C31's cell and C37's colours read some of the same names,
        // so this is the measurement, not a sum):
        // ⭐ B1 moved artemis: its `barcolor(barCol)` is carried as a paint now
        // (`pine.js::resolvePaints`), read by ONE more Resolver of its own — 8 steps,
        // resolving `barCol` to `na` (no paint; TradingView's capture reads `na` on all
        // 632 bars, `vendorHarness.b1Paints`). Every output, presentation and the object
        // program byte-identical (translation census). Pre-B1: plain [729, 429977,
        // '60011f510b56bd70'] / manifest [729, 429985, 'bde49be716751a27'].
        plain: [730, 429985, '9817f6afa92980bd'], manifest: [730, 429993, 'b3663793714b5924'] },
      // ⭐ C22 moved htf-liquidity (7fc4c8cc5 — its window reads now resolve
      // where they stand; drawing identical, no refusal moved). Re-pinned from
      // the C22 tree WITHOUT C24 (783ed6a50), which reads 5704 / 83d96de7…
      // exactly as the merged tree does: C24's replay still charges what the
      // repeat would have. Pre-C22, pre-C24: [691, 4876, 'f537521acc6fad15'].
      // ⭐ C33 moved htf-liquidity: its thirty `if show_x and <another symbol's
      // request>` guards are asked, once per `if`, whether the input gate alone
      // reads (`partialAndGuard`) — each term costs a Resolver. Every cell under
      // them is still refused by its own text, the latches nothing reads are
      // pruned, and the object program is wave 8's - the same 71 ops over the same
      // 41 trees, interned in another order (program dump diff). Pre-C33: [691, 5824, '9ae53426ed6cfe3f'] both.
      // ⭐ C47 moved htf-liquidity: its three helpers whose body is `result = switch x`
      // (`get_size`, `get_line_style`, `get_table_position`) are readable by the
      // object pass's Resolver now (`pine.js`: `objectLane`), so a call to one
      // resolves into the switch before it refuses where it always did (an enum
      // word is not a number) — 20 more steps, the same 856 Resolvers. The object
      // program and every output are byte-identical (translation census: the
      // script is not among the changed rows). Pre-C47: [856, 7174,
      // 'ff55463c3a36e466'] both.
      'htf-liquidity-dashboard-tfo__ec8f8316a4': {
        plain: [856, 7194, 'c264e378ba65bd90'], manifest: [856, 7194, 'c264e378ba65bd90'] },
      // ⭐ H7 (step 92h) moved pro-trading-art: a window reduction's ambiguity is now
      // "a real AND an `na` element both present" (an empty / all-`na` window is the
      // measured `na`, CAP4 Q-RT7a), one more token run per read — 216 more steps,
      // same 85 Resolvers. Pre-H7: [85, 356778, '9fcabbf403bf29e0'] both.
      'pro-trading-art-double-top-bottom-with-alert__5321f25fcb': {
        plain: [85, 356994, '746ef82d8c5ee0aa'], manifest: [85, 356994, '746ef82d8c5ee0aa'] },
      // ⭐ WAVE 16 (H5 B, 2026-10-03) moved adaptive-trend: default parameters now
      // resolve on the plot lane, so its `pine:function-def` wall is gone and the walk
      // goes further before `pine:block` (corpus_metric guards: function-def dropped,
      // script still refused — no member-visible change). 2 fewer Resolvers, ~1,146
      // more steps. Pre-wave-16: plain [38, 20104, '1c4c4d2d8bb41941'] / manifest
      // [38, 20110, '751365c865ed51f9'].
      'adaptive-trend-following-suite-alpha-extract__d615e5a027': {
        plain: [36, 21250, '3c20665225e9541d'], manifest: [36, 21256, '88d23acb3dae910a'] },
      // ⭐ C43 moved 72s-strategy: `label.set_x(pvtLabel, label.get_x(pvtLabel) +
      // ((time-time[1]) * 21))` — a getter in `+` arithmetic as a bar coordinate —
      // is read now (`pine.js::stateArith`), so one more Resolver is built for the
      // getter-free operand, 6 more steps. Plots byte-identical (translation
      // census). Pre-C43: [101, 931, 'b03efcd81da53a58'] both.
      // ⭐ WAVE 16 (2026-10-03) moved 72s-strategy: one more Resolver, 513 more steps.
      // The script stays refused with the SAME guards (pine:statement, pine:strategy-call;
      // corpus_metric unchanged), so nothing a member sees moves. ATTRIBUTION NOT
      // BISECTED: the wave's host-lane changes that add resolver work on conditions are
      // F2's v4/v5 and/or/not na re-read and H2's block-valued reassignment; recorded as
      // the measured wave-16 cost. Pre-wave-16: [102, 937, '6aa396f1a09699d5'] both.
      // ⭐ F1 (wave 16) +1 Resolver, +33 steps: its const-int division fold
      // (`pineConstIntValue`) resolves one more operand. Pre-F1: [103, 1450, 'ae4f9119eeecd7d5'].
      // ⭐ RT12 +1 Resolver, +7 steps: four lines `normOrder := 0, alert(…)` /
      // `riskOrder := 0, alert(…)` split into their two statements now
      // (`commaCallSplit`; the old reader kept each line whole, so the `:=` was never
      // seen). The script stays refused with the same first guard (`pine:statement`,
      // the one-line `xhma(…) => _return = …` body, line 71). Pre-RT12: [104, 1483,
      // '5adeff2487d271ca'] both.
      '72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt': {
        plain: [105, 1490, '8ede6e25a25f20de'], manifest: [105, 1490, '8ede6e25a25f20de'] },
    }
    const got = {}
    for (const name of Object.keys(PINNED)) {
      const file = path.join(REPO, 'corpus/committed', `${name}.pine`)
      expect(fs.existsSync(file), `${name} left the corpus — this rail is vacuous`).toBe(true)
      const src = fs.readFileSync(file, 'utf8')
      got[name] = {}
      for (const [mode, opts] of [['plain', PLAIN], ['manifest', MANIFEST]]) {
        const { steps } = measure(() => translatePine(src, opts))
        got[name][mode] = [steps.length, steps.reduce((a, b) => a + b, 0),
          createHash('sha256').update(JSON.stringify(steps)).digest('hex').slice(0, 16)]
      }
    }
    expect(got).toEqual(PINNED)
  }, 60000)

  it('⛔ a step cap refuses at the same node as before — a replay never jumps it', () => {
    // Every cap from 100 to 61,500 in steps of 100, run-length encoded as
    // `from-to=line:column` of the `pine:timeout` refusal (pinned pre-C24).
    const PINNED = '100-30700=16:7 30800-46000=15:7 46100-53700=14:7 53800-57500=13:6 '
      + '57600-59500=12:6 59600-60400=11:6 60500-60900=10:6 61000-61100=9:6 '
      + '61200-61200=8:6 61300-61300=7:6 61400-61400=5:18 61500-61500=clean'
    const src = chain(12)
    const runs = []
    for (let cap = 100; cap <= 61500; cap += 100) {
      const r = translatePine(src, { ...MANIFEST, maxSteps: cap, budgetMs: 0 })
      const loc = (r.refusals || []).filter((x) => x.guard === 'pine:timeout')
        .map((x) => `${x.line}:${x.column}`).join(',') || 'clean'
      const last = runs[runs.length - 1]
      if (last && last[2] === loc) last[1] = cap
      else runs.push([cap, cap, loc])
    }
    expect(runs.map(([a, b, l]) => `${a}-${b}=${l}`).join(' ')).toBe(PINNED)
  }, 60000)
})
