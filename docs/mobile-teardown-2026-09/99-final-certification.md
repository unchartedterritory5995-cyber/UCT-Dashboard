# Final certification — UCT mobile charting vs TradingView iOS

**Deliverable J.** Every number below is reproducible from the artifacts named beside it.

---

# ⚖️ VERDICT

> # RESEARCH CERTIFIED WITH EXPLICIT RESIDUAL GAPS

**Not FULL**, and the reasons are named, not hedged: an independent adversarial reviewer returned
**MATERIALLY FLAWED** and was right on every load-bearing claim; two of the twenty task flows were
never measured; three high-value drawing behaviours remain unreachable; and the corpus's evidence
schema conflated two products' tiers for most of the study's life.

**Not NOT-CERTIFIED**, and those reasons are named too: every finding the reviewer overturned has
been withdrawn in writing rather than quietly edited; the distribution was **recomputed from a
machine-readable ledger** rather than re-argued; the census arithmetic survived a hostile recount
intact; and the conclusions that remain are each traceable to a device observation, a persisted
server record, or a source line.

---

## 1 · Scale

| | count | artifact |
|---|---:|---|
| TradingView iOS interactions censused | **432** (+2 UCT comparison rows = 434 rows) | `ledger/TV_IOS_CENSUS_V1_FROZEN_2026-09-07.jsonl` |
| UCT observation rows | **60** | `lanes/uct-*.jsonl` (7 lanes) |
| **Comparable interactions** (both sides observed) | **86** | `ledger/PARITY_COMPARISONS_V2.jsonl` |
| …of those, high-frequency / high-value | **40** | same, `weight: HIGH` |
| Task flows specified end-to-end | **20 / 20** | `70-task-flow-comparisons.md` |
| Prototype flows | **8 / 8** (1 conditional, 1 partly blocked) | `prototype/00-*` |
| Backlog items | **23** | `85-implementation-backlog-and-waves.md` |

## 2 · Evidence distribution

**TradingView census (434 rows):** NATIVE_VERIFIED 137 (31.6%) · OFFICIAL_DOC_VERIFIED 129
(29.7%) · VIDEO_VERIFIED 12 (2.8%) · INFERRED_NOT_VERIFIED 156 (35.9%). Recount by a hostile
reviewer: **exact**, including all eighteen per-area pairs.

⚠️ **Qualified by `95-census-errata.md` E6:** of the 137 native rows, **74** have an action verb of
*Observe / Read / Note*, **31** are self-labelled `(presence)`, and **6** exercise a non-tap
gesture. **"Native" states where the observation happened, not that the task was completed.**

**UCT side of the 86 comparisons:**

| tier | n | what it means |
|---|---:|---|
| RESPONSIVE_TOUCH_VARIANT_VERIFIED | 34 | 390px **fine-pointer** frame — the tier that produced **five false negatives** |
| NATIVE_VERIFIED (app / persisted server record) | 17 | pointer-independent |
| NOT_MEASURED | 15 | never counted as a gap |
| REAL_COARSE_POINTER_VERIFIED | 13 | physical iPhone 15 / iOS 17.5 |
| SOURCE_ONLY | 4 | read in `origin/master` |
| ACCESS_BLOCKED | 3 | unreachable through the harness |

**High-value native coverage:** of the 40 high-value comparisons, **30 have a UCT side that is
device-verified, app/server-measured, or source-verified**; 4 are `TV_UNVERIFIED`, 3 are
`ACCESS_BLOCKED`, and the remainder rest on the fine-pointer frame for claims a pointer cannot
change.

## 3 · Parity distribution (n = 86)

PARITY 22 (25.6%) · TV_UNVERIFIED 14 (16.3%) · **UCT_AHEAD 10 (11.6%)** · PRODUCT_MODEL_DIFFERENCE
8 (9.3%) · PARITY_BUT_WORSE_UX 7 (8.1%) · PARTIAL 6 (7.0%) · TRADINGVIEW_AHEAD 5 (5.8%) · BROKEN 5
(5.8%) · ACCESS_BLOCKED 3 · DESKTOP_ONLY 3 · MISSING 2 · NOT_DISCOVERABLE 1 · **MOBILE_UNUSABLE 0**.

**At parity or better: 32 of 86 (37.2%).**

## 4 · Weighted distribution — high-frequency / high-value (n = 40)

PARITY 15 (37.5%) · **UCT_AHEAD 7 (17.5%)** · TV_UNVERIFIED 4 · ACCESS_BLOCKED 3 · PARTIAL 3 ·
PARITY_BUT_WORSE_UX 2 · BROKEN 2 · PRODUCT_MODEL_DIFFERENCE 2 · NOT_DISCOVERABLE 1 · DESKTOP_ONLY 1
· **TRADINGVIEW_AHEAD 0** · MISSING 0.

> ### **On the interactions a trader actually repeats, UCT is at parity or ahead on 22 of 40 — 55%.**

⚠️ **The zero must not be quoted alone.** TradingView's high-value advantages exist; they are
classified by the *nature* of the gap rather than as a generic "TV wins" — `DESKTOP_ONLY`
(`CMP-069`), `NOT_DISCOVERABLE` (`CMP-034`), `PARTIAL` ×2 (`CMP-055`, `CMP-070`),
`PARITY_BUT_WORSE_UX` (`CMP-083`).

## 5 · Backlog

| priority | n | |
|---|---:|---|
| **P0** | 3 | phone Layouts sheet · watchlist row · legend-key migration |
| **P1** | 6 | all-tools grid · alert binding · the phone-presentation rule · `_COARSE_POINTER` hook · 2 measurement debts |
| **P2** | 7 | workspace scope model · sync highwatermark · Hide · narration · indicator band · mid-draw cancel · 1 measurement debt |
| **P3** | 5 | formula truncation · redo first-use · object tree · sort targets · search disambiguation |
| **P4** | 2 | templates · replay/compare doors **or a register** |

**Six of the 23 are `MEASURE-*` or measurement-gated** — the study refuses to design into its own
unmeasured areas.

## 6 · The ten UCT advantages

`CMP-010` one-tap watchlist→chart (TV needs two, forever) · `CMP-015` eight intervals at depth
zero · `CMP-020` crosshair content, incl. four live MA values · `CMP-025` an indicator picker that
explains itself · `CMP-040` `Set level…` exact numeric placement, pre-filled · `CMP-051`
price→alert in two interactions with zero typing · `CMP-060` the three most-flipped chart settings
inline in the price sheet · `CMP-065` leave-and-return with nothing lost · `CMP-067` redo exists at
all (qualified) · `CMP-071` measured phone→desktop workspace continuity.

**Plus one the study twice mistook for a defect:** UCT deliberately strips desktop furniture off
the phone canvas (`display:none` on the `$-Vol` strip and the A/L/% chips, with a comment saying
why). That rule *is* the remedy for the study's largest root cause.

## 7 · The six genuine TradingView advantages

1. **The phone layout door** (`CMP-069`) — full CRUD on the phone vs none. The largest gap.
2. **Alert binding** (`CMP-055`) — the alert follows the line; UCT's snapshots a price.
3. **Tool discoverability** (`CMP-034`) — searchable tabbed picker vs 3 of 18 visible.
4. **Placement narration** (`CMP-039`) — "point 1 of 2" plus both-axis echo.
5. **Object vocabulary** (`CMP-045`, `CMP-081`, `CMP-046`) — Hide, object tree, templates.
6. **Catalogue breadth** (`CMP-016`, `CMP-058`) — a deliberate UCT scope choice, listed for completeness.

## 8 · Withdrawn / disproven — 13 items

Full list with evidence: `85-implementation-backlog-and-waves.md` **TOMBSTONE**. The three that
had been ranked highest at some point in this study, and all three are dead:

- *"Build a bare-chart price→action bridge"* — it ships, and is **broader** than TradingView's.
- *"Add an OHLC row to the crosshair"* — it exists, plus four MA values.
- *"UCT has no object→alert"* — it ships, in three gestures with zero typing.

Plus, from the adversarial review: the `$ Vol`/`Avg 50D` advantage, the 17×11px tap-target defect,
the `autoCapitalize` "free win", and *"UCT has no bar replay on any platform"* — the last written
into a frozen ledger as a universal negative reached by grep.

## 9 · Unresolved and access-blocked

| item | status | route to close |
|---|---|---|
| Grab radius 15px, handle radius 7px + halo, auto-select-after-placement, `DrawingQuickBar` | **ACCESS_BLOCKED** ×4 | `MEASURE-01` — Appium `driver.tap`. ⚠️ Cause **not isolated** between harness synthesis and UCT's own pointer accounting |
| Flow G — portrait ↔ landscape | **NOT MEASURED** | `MEASURE-02` — one BrowserStack session |
| Flows F08/F09 — indicator legend-row affordances | **NOT MEASURED** (4 comparisons) | `MEASURE-03` |
| `CMP-086`'s real-world incidence | mechanism verified, **population unmeasured** | count stored blobs carrying legacy `header.showLegend` |
| `UCT-P9-0005`'s real-user trigger | mechanism + divergence verified, **trigger inferred** | reproduce a failed push |
| `UCT-P9-0008`'s device consequence | code shape verified, **consequence inferred** | an iPad with a Magic Keyboard |

## 10 · Independent validation

**Verdict returned: MATERIALLY FLAWED.** Adjudication: `90-independent-validation.md`.

- **Accepted and fixed:** 8 findings, each re-verified by me against `origin/master`.
- **Accepted with narrower scope:** 4 — including the correction that *"both overturns were
  fine-pointer artifacts"* named the wrong mechanism (the two passes differed in **four**
  variables and I blamed one).
- **Not accepted in full:** 2 — the "434 = 432+2" framing (an erratum, not a restatement, because
  the frozen ledger must not be edited) and *"the UCT half was mostly asserted"* (true of the
  census-embedded UCT claims, false of the device lanes).
- **New defects found by the review: 2** — `CMP-086` and the phantom `autoCapitalize` item.
- **UCT gaps invented by the review: 0. UCT gaps deleted by it: 2.**

## 11 · Confidence

| claim class | confidence | why |
|---|---|---|
| TradingView's feature **surface** | **HIGH** | 432 interactions, a third native, arithmetic survived a hostile recount |
| TradingView's completed **task flows** | **MEDIUM** | most native rows are *observed*, not *performed*; 6 of 137 exercise a non-tap gesture |
| UCT's **durable-state architecture** (P9) | **HIGH** | measured on both surfaces *and* in the persisted server record, then re-verified in source |
| UCT's **device behaviour** on the chart canvas | **MEDIUM-HIGH** | 13 real-touchscreen comparisons; five false negatives found and corrected |
| UCT's **drawing-selection** behaviour | **NONE** | access-blocked, cause not isolated |
| UCT's **landscape** behaviour | **NONE** | never measured |
| The **weighted parity distribution** | **MEDIUM-HIGH** | mechanically computed from a ledger with per-side tiers; 15 of 86 rows are `NOT_MEASURED` and excluded from gap counts |

---

# The answer to the final product question

> *What makes an exceptional mobile charting product; which of those systems does TradingView
> actually execute better; which has UCT already solved as well or better; and what is the
> smallest coherent set of changes?*

**Five systems make the product.** UCT already wins **the fast loop** (arrive, change symbol,
change timeframe, read a bar, get back to live) and **precision without a mouse** (`Set level…`,
pre-filled). TradingView wins **the durable object you can name** — not because its model is
better, but because **UCT's phone has no door to its own model** — and **objects that mean
something after you make them** (hide, template, enumerate, and an alert that follows its line).
**Nobody wins the fourth**, a feature surface a thumb can find: TradingView hides 15 of 18 hub
entries at its default detent and UCT shows 3 of 18 drawing tools. That is open ground.

**The smallest coherent change set is four moves:**

1. **Put the layout lifecycle on the phone** — a sheet over an API that already returns
   `{global, mine}` and already stores the symbols. Closes the largest gap; no migration.
2. **Make "renders on a phone" mean "has a phone presentation"** — generalise the rule UCT already
   applies to exactly two elements. Closes the largest root cause.
3. **Give durable state a scope model** — four tiers, two things moved, three defects fixed.
4. **Bind alerts to their objects, and add Hide.**

> ### **UCT does not need to become TradingView. It needs a door to its own workspace, a phone-presentation rule, and an alert that follows its line.**

---

## The methodological finding this study should be remembered for

**Five times, this study concluded that UCT lacked something, and five times it was wrong.**

Three were caught by putting a finger on a real device. **The last two were caught by an
adversarial reviewer reading a CSS media query** — and both were cases where UCT had
*deliberately solved* the problem for phones and the harness could not see the branch, so a
considered decision was logged as a defect.

The mechanism was one field. `conf` was made to carry two products' evidence tiers: it described
the TradingView observation while the same row's `notes` carried a UCT verdict read from source.
UCT claims therefore inherited TradingView's tier, and *"UCT has no bar replay on any platform"* —
a universal negative reached by three greps — went into a frozen ledger at
`OFFICIAL_DOC_VERIFIED`.

⭐ **The rule for the next study: one evidence tier per product per row, and a negative claim about
your own product needs the same standard of proof as a positive claim about a competitor's.**
Every artifact here now separates `tv_tier` from `uct_tier` — which is why the corrected
distribution could be recomputed in one command rather than re-argued. That separation arrived at
the end. It should have been the first line of the schema.
