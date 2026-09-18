# j.4 — the per-layer table, and R29's decision

**Measured 2026-09-18 at `47432b179`+.** Instrument: `translatePine` →
`memberPaneDefinition` → `createBinder().sync()` over
`tests/fixtures/member/uncharted-clouds.pine`, host lane, strict.

## 1. The three layers, end to end

| stage | reading |
|---|---|
| translator | **23 outputs · 0 refusals · 20 fills · 20 carrying a colour PAIR** |
| pane document | **24 rows · 22 hidden · 2 visible · 20 fills · ONE condition row (`out24`)** |
| binder | `ok: true` · **bound 2** · released 0 · **`notes: []`** |
| renderer | **20 `attachPrimitive` calls — every fill draws** |

⭐ **`bound: 2` IS R27-AS-AMENDED, NOT A SHORTFALL.** Only the two visible plots
bind a series; the 21 hidden anchors bind none, because the fill primitive takes
COLUMNS and borrows the host's `priceToCoordinate`. 20 primitives attach against 2
bound series, which is the whole point of the hosted-fill path.

⭐ **`notes: []` IS THE NEW CHANNEL STAYING QUIET.** Clouds HAS a visible host, so
there is nothing to report — the same run reports one note per fill when the host
is removed (`hostlessFillNotes.test.js`).

⚠️ **22 hidden, not 21.** The prompt predicted 21; the 22nd is **R34's condition
row**, which is hidden by construction. 21 author anchors + 1 derived row.

## 2. The per-layer table — 21 layers, 20 fills

Every fill carries the author's pair: `#00897B` (teal, `bullColor`) /
`#880E4F` (maroon, `bearColor`), both through `input.color`'s defaults (R33a).

| layer | anchor | with | hidden | colorUp | colorDown | opacity | transparency |
|---|---|---|---|---|---|---|---|
| 0 | `out3` | `out4` | yes | `#00897B` | `#880E4F` | 0.050 | **95.0** |
| 1 | `out4` | `out5` | yes | `#00897B` | `#880E4F` | 0.075 | 92.5 |
| 10 | `out13` | `out14` | yes | `#00897B` | `#880E4F` | 0.300 | **70.0** |
| 18 | `out21` | `out22` | yes | `#00897B` | `#880E4F` | 0.500 | 50.0 |
| 19 | `out22` | `out23` | yes | `#00897B` | `#880E4F` | 0.525 | **47.5** |

**Transparency runs 95.0 → 47.5 across the twenty layers, in 20 DISTINCT values.**
That distinctness is the feature: one flat band would satisfy a "carries a colour"
check and lose the gradient entirely, which is why the count of distinct alphas is
asserted rather than the endpoints alone.

⭐ The three checked layers land exactly on the values **derived** from the
script's own constants (`maxTransparency 95`, `minTransparency 45`, `numLayers 21`
⇒ step 2.5; `u = color.t(color.teal) = 0`). Nothing here is hand-typed.

**Every layer is WITHIN.** There is no "outside" row and no "not drawn" row, so
the "every outside measured to a cause" column is empty by measurement.

## 3. The member door — captured

`docs/pine/capture/member-door-clouds-pasted-2026-09-18.jpg` — Clouds pasted into
the Pine import box on the rig (port **8130**, sandbox outside every worktree,
listener identity confirmed at 41 s old), verified byte-exact at the textarea:
**9,811 chars, checksum 268937636**, carried by clipboard rather than retyped.

⚠️ **THE SAVE DID NOT COMPLETE, AND THAT IS WHERE THIS STOPPED.** The builder
sheet's `Save` and `Cancel` both left the sheet open, and rather than keep
clicking through a surface whose click path is undocumented, the rig was stopped.
**The engine-side result above does not depend on that** — it is measured through
the same `memberPaneDefinition` + `binder.sync()` the door itself calls — but the
*rendered* member-door screenshot of twenty drawn clouds is still owed.

## 4. ⛔ R29 — #145 STAYS DRAFT. The failing condition, named.

> R29 flips draft → ready **only** when j.4 reports Clouds within Wave 1's
> tolerance **on both tables at both tiers** AND CI is green.

**The vendor half was never captured, so "both tables at both tiers" is
UNMEASURED — not failed.** The layout now exists (R37, `01f1AcIj`) and the lane is
unblocked, but the capture itself did not run.

⛔ **Unmeasured is not the same as outside tolerance**, and collapsing them is the
`CoverageLine` defect this repo already refuses. #145 therefore stays **Draft**,
with the condition named: *the vendor capture on `01f1AcIj`, both tables, both
mobile tiers.*

⭐ **What IS measured meets its bar:** 23 outputs, 20 fills, 20 colour pairs, a
real 20-value gradient, one deduped condition row, 20 primitives attached, and a
silent notes channel. Every engine-side claim j.4 was written to make.
