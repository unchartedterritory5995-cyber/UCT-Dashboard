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
      .toEqual([['__uct_param_1', 'len', 1, 50]])
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
      'artemis-oscillator-pro__ea1097ca9e': {
        // ⭐ Wave 9 carries BOTH (C32 +4 Resolvers / +122 steps, C31 +6 / +3,759): the
        // measured sum, exactly additive — 521 + 4 + 6, 405,996 + 122 + 3,759.
        // ⭐ C41 moved artemis: its oscillator is requested at `"15"`, `"60"` and `"240"`,
        // each BELOW a daily chart. Those were refused at the request (the child never
        // resolved); they are `ltf` reads now (`engine/lowerTf.js`), so each child — the
        // whole oscillator expression — is resolved once per request: the same 531
        // Resolvers, 103,890 more steps. Plot outputs byte-identical (translation
        // census). Pre-C41: plain [531, 409877, 'f38c24a72a987c60'] / manifest
        // [531, 409885, '61f060f7ebfeaf71'].
        plain: [531, 513767, 'd7a0547e09a51fe8'], manifest: [531, 513775, '77b51e036b23b7ac'] },
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
      'htf-liquidity-dashboard-tfo__ec8f8316a4': {
        plain: [856, 7174, 'ff55463c3a36e466'], manifest: [856, 7174, 'ff55463c3a36e466'] },
      'pro-trading-art-double-top-bottom-with-alert__5321f25fcb': {
        plain: [85, 356778, '9fcabbf403bf29e0'], manifest: [85, 356778, '9fcabbf403bf29e0'] },
      'adaptive-trend-following-suite-alpha-extract__d615e5a027': {
        plain: [38, 20104, '1c4c4d2d8bb41941'], manifest: [38, 20110, '751365c865ed51f9'] },
      '72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt': {
        plain: [101, 931, 'b03efcd81da53a58'], manifest: [101, 931, 'b03efcd81da53a58'] },
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
