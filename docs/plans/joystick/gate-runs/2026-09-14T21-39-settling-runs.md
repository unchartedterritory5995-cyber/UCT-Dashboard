# Settling runs — the two provisional baseline entries, 2026-09-14

⛔ **Not a gate.** Two single-file `vitest run` invocations, executed exactly as each entry's
`what_would_settle_it` specifies. No full gate was run.

**Executed on master `8e6f892a75ee60b76422bbf0a83f8563895b23ed`** (`8e6f892a7`). Both target files
are **byte-identical** to their blobs at the baseline SHA `1216958ed`, so these runs measure the
same code the baseline run measured.

---

## The wait — stated, because it is most of what happened

The box was held by the **notebook-k** workstream running **three consecutive six-shard gates**:

| time | state |
|---|---|
| 18:25:49 | pid **50356**, shard 6/6, 33.8 min old — NOT CLEAR |
| 18:51:20 | first waiter hit its 25-min limit, `VERDICT=TIMEOUT` |
| 18:51:30 | 50356 gone; successor **pid 29740**, shard 4/6 — still NOT CLEAR |
| 19:02:21 | `VERDICT=CLEAR`, free 11.8 GB |
| ~19:02:50 | **pid 50288** starts, shard 1/6 — a third gate, seconds into run #9 |
| 19:34:58 | clear again; run A executed |
| 21:37:25 | clear; run B executed |

⚰️ **THE WRAPPER-EXIT TRAP, THIRD SIGHTING, AND THE FIRST THAT WOULD HAVE CORRUPTED A
MEASUREMENT.** The first waiter's own last line read `TIMEOUT - box never cleared within 25 min`
and it exited **2**; the harness reported **exit code 0**. Read as "clear", it would have sent the
settling run into a live six-shard gate and produced exactly the load-contaminated answer this
whole procedure exists to exclude. Every verdict here therefore rides on a `VERDICT=` line in the
output, never on an exit code.

⚠️ **And a method error of mine, recorded because it invalidated two runs.** Checking box clearance
only at the **endpoints** is insufficient — the third gate appeared *between* my pre-check and
post-check. Clearance must be sampled **during** the run.

---

## Entry #9 — `src/lib/presentation/presentationSingleFormatter.test.js`

`what_would_settle_it`, quoted from `gate-baseline.json`:

> *"npx vitest run src/lib/presentation/presentationSingleFormatter.test.js — ALONE, on a quiet box.
> Passes alone => load-sensitive, move to load_sensitive.names and REMOVE from failures[]. Fails
> alone => genuine, keep."*

### Five runs, because the first two disagreed

| run | box before | result | totals line (verbatim) | Duration | test time |
|---|---|---|---|---|---|
| A | clear | ✅ | `Tests  12 passed (12)` | 2.70s | 2.00s |
| B | clear | ⛔ | `Tests  1 failed \| 11 passed (12)` | 30.58s | **15.31s** |
| 3 | clear | ✅ | `Tests  12 passed (12)` | 3.02s | 2.18s |
| 4 | **gate + 6 vitest** | ✅ | `Tests  12 passed (12)` | 2.86s | 2.04s |
| 5 | **gate + 6 vitest** | ✅ | `Tests  12 passed (12)` | 3.10s | 2.25s |

Run B's failure, verbatim:

```
 FAIL  src/lib/presentation/presentationSingleFormatter.test.js > ⚠️ formatPercent is DECLARED AND
 ADOPTED BY NOTHING — stated, not hidden > nothing outside lib/presentation imports formatPercent from S10
Error: Test timed out in 15000ms.
```

An earlier contended run (19:03, third gate live) also timed out, at **40,946 ms**.

### VERDICT: **INCONCLUSIVE** — entry stays `provisional: true`

It is the third branch of the ruling: *timeout again alone*. It did not fail an assertion; it ran
out of time. And the runs do not agree with each other.

⛔ **The "load" classification is NOT supported by this measurement, and that is the real finding.**
`docs/breadth/gates.md:24` calls it *"load (15 s timeout)"*, and `:37` records it *"passing when run
alone … (3 files, 35/35)"*. But here it **failed on a clear box** (run B) and **passed twice while a
six-shard gate with six vitest workers was running** (runs 4, 5). Load does not predict the outcome
in either direction.

⭐ What the numbers actually show: the test's own *test time* swings **2.00s → 15.31s**, a 7×
spread, against a **15s** ceiling. It is an intermittent sitting on its own timeout boundary — not
a load artefact, and not a false assertion. One failure in five.

### What would settle it

Raise the timeout and see whether the **assertion** passes — `it(..., { timeout: 60000 })` or a
`testTimeout` override on that one case. If it passes with room, it is a slow test with a
mis-set ceiling and belongs on `load_sensitive.names`, not in `failures[]`. If it fails with room,
the assertion is genuinely false and it belongs in the baseline.
⛔ **Not done here: that is a change to S10's test file, and only its owner should make it.**
Filed on **R-30**.

---

## Entry #10 — `src/surfaces/manifest.test.js`

`what_would_settle_it`, quoted:

> *"npx vitest run src/surfaces/manifest.test.js — ALONE, on a quiet box."*

Totals line, verbatim:

```
 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
   Duration  2.96s (transform 92ms, setup 192ms, import 117ms, tests 2.51s, environment 0ms)
```

Failure, verbatim:

```
- []
+ [
+   "/admin/wisdom",
+ ]
 ❯ src/surfaces/manifest.test.js:112:75
   expect(missing, `routes with no manifest row: ${missing.join(', ')}`)
```

⚠️ **That run was contended** (a gate was live), so it is not relied on alone.

### VERDICT: **BANKED** — `provisional: false`

Settled **statically**, which is immune to the box-clearance objection entirely, because the
assertion is over data and not timing:

| probe | result |
|---|---|
| is `/admin/wisdom` a Layout-hosted route? | **yes** — `App.jsx:650` `<Route path="/admin/wisdom" element={<WisdomAdmin />} />` |
| is it declared in the manifest? | **no** — `app/src/surfaces/manifest.js`, **0** occurrences |
| who introduced it? | `7b3408a8f feat(wisdom): S-F admin page /admin/wisdom — queue, metrics with n, capture, jobs, budget, reports` |

The rail is telling the truth. A missing manifest row cannot be manufactured by load, and the run
completed in 2.96s nowhere near a timeout.

⭐ **Ownership refinement for R-31:** the *rail* is S1's (`b7e7541a0`), but the *missing
declaration* was introduced by the **wisdom** workstream. The fix is theirs or S1's to agree; the
row is recorded against both.

⚠️ `surfaces/manifest` is **not** in `docs/breadth/gates.md`'s classification table at all, so
there was no prior judgement to inherit and none was invented.

---

## Baseline after these runs: **10 — unchanged**

| # | entry | status |
|---|---|---|
| 8 | `reachable` (R-29) | **banked** — `provisional: false` (was already settled: rail red, re-verified on master) |
| 9 | `presentationSingleFormatter` | **provisional: true** — INCONCLUSIVE, five runs recorded |
| 10 | `surfaces/manifest` | **banked** — `provisional: false`, settled by static proof |

Nothing was removed, because nothing passed alone *reliably*. ⛔ Per the baseline's own rule a
timeout is never banked as permitted breakage — #9 remains banked **only** under owner ruling R1,
and it remains flagged so that the next reader is not misled by the number.

## H14 — other load-classified baseline entries

A rail that fails only under load is a hazard class, so the rest of the baseline was cross-checked
against `gates.md`. **Listed, not acted on.**

| entry | `gates.md` classification |
|---|---|
| `ThemeTrackerPage.chartmount` › passes stored=null with no onStore | **load-sensitive (~4 s)** |
| `ThemeTrackerPage.chartmount` › selecting a holding mounts ChartPane | **load-sensitive (~4 s)** |
| `presentationSingleFormatter` › nothing outside lib/presentation imports formatPercent | **load (15 s timeout)** |

The two `ThemeTrackerPage.chartmount` rows were banked **before** today and are not this
programme's to unwind. ⚠️ Together with #9 that is **three of ten** baseline entries carrying a
load classification — and #9's five runs show that classification can itself be wrong, which is
reason to re-measure the other two before trusting them, not reason to remove them.

⚠️ **Instrument note:** a first pass of this cross-reference reported `surfaces/manifest` as
*"rail red"*. That was a substring false match — the stem `manifest` hit the `manifestProse` row.
Corrected above; `surfaces/manifest` has no classification.
