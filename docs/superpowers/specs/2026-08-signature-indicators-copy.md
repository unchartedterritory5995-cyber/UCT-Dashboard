# UCT Signature Indicators — Owner Review Pack

**Status:** numbers, blurbs and tooltips **APPROVED 2026-08-01**; landing copy (§6) is **NOT**
approved and is **not live copy**. **Branch:** `feat/phase-a-signature` · **Date:** 2026-08-01 ·
**Phase A, Tasks 0–12 complete, unshipped.**

> **Owner amendment, 2026-08-01 (pre-launch).** `FCB_VOL_MULT` was tightened **1.25 → 1.5** and
> the FCB rule version bumped **`fcb-v1` → `fcb-v2`** (the multiple changes output, and the
> ledger's uniqueness key includes the version, so rows written under the old gate stay
> attributable to `fcb-v1`). §2, §4, §5 and §7(a) below reflect the shipped 1.5. This was a
> judgement call between the two ends of a convention, **not** a measurement — the honesty floor
> immediately below still applies to it and to every other number here.

This is the document you read before Phase A ships. It contains (1) the plain-language honesty
blurb for each of the three indicators, citing the exact numbers that are in the code today;
(2) the repaint statement for each, with its mechanism; (3) the toolbar tooltip strings that are
shipped in the branch right now, plus proposed refinements; (4) the full v1 rules table for
tuning; (5) a DRAFT landing-page section that does **not** ship without your explicit "ship it";
(6) what the signal ledger starts recording on deploy day; (7) the approval checklist.

**Read this first — the honesty floor for the whole pack.**

> None of the numbers below were derived from a backtest. There is no backtest. Every constant in
> `rules.py` is a **reasonable default chosen from convention and from what the existing data
> stores can actually support** — not a researched optimum. Where a number is more permissive or
> more restrictive than convention, this document says so and says which direction the error
> runs. The signal ledger (§5) exists precisely because we are shipping without measurement: it
> starts the clock on real, timestamped, append-only evidence from deploy day forward. Any copy
> that implies these thresholds were validated would be a lie, and the house rule against
> unmeasured accuracy claims applies to every line here.

---

## 1. Dark Pool Levels (`dpl-v1`)

### 1a. How it's computed — honesty blurb

> Dark Pool Levels finds the price areas where the most off-exchange size actually traded. It
> reads the **confirmed** dark-pool print ledger — the nightly-settled table, never the intraday
> preview feed — and takes the last **20** trading dates it holds. Every print in that window is
> grouped with its neighbours into clusters no wider than **0.25% of the median print price**;
> clusters totalling less than **$10 million** in notional are discarded. What's left is ranked by
> total notional and the **top 5** are drawn. Each level's price is the notional-weighted centre of
> its cluster, and the shaded band around it is exactly one cluster width, positioned so every
> print that built the level sits inside it. The chart also reports how many of those 20 dates
> actually carried prints for this ticker, so a thin window is visible rather than assumed.

**Verbatim source of every number:** `api/services/signature/rules.py` —
`DPL_WINDOW_DAYS = 20`, `DPL_BIN_PCT = 0.0025`, `DPL_MIN_CLUSTER_NOTIONAL = 10_000_000.0`,
`DPL_TOP_K = 5`. Clustering and the zone clamp: `api/services/signature/darkpool_levels.py`.

**Two precision notes that belong in an internal doc, not in the blurb:**
- The 20-date window is the last 20 distinct dates present in `darkpool_trades` **table-wide**, not
  per-ticker (`darkpool_db._resolve_dates`). A ticker that printed on only 6 of those dates gets a
  6-date result. That is what `datesCovered` in the payload reports, and it is why the blurb says
  "how many of those dates actually carried prints" instead of promising 20.
- Clustering is **adjacency-based, anchored at the cluster low**, not a fixed grid. A fixed grid
  would have put a bin edge exactly at the median price (the densest part of the distribution) and
  split real levels in half. This was found and fixed during the build; it does not need to be in
  customer copy, but it is the reason the blurb can honestly say "no wider than 0.25%".

### 1b. Repaint statement

> **Non-repainting — computed from confirmed prints only.** The levels are built from the
> settled dark-pool ledger, not from the intraday preview table, so a level that appears today
> was built from prints that were already final. A level's price does not move as the session
> develops. As new sessions enter the 20-date window and old ones fall out, the *set* of levels
> changes — that is the window advancing, not a value being restated.

That last sentence is deliberate and I recommend keeping it. "Non-repainting" is a strong claim
and the honest version of it here has an asterisk: individual levels don't restate, but the
rolling window means the level set on Friday is not necessarily the level set from Monday. Saying
that ourselves is worth more than having a customer discover it.

### 1c. Toolbar tooltip

**Previous string** (`app/src/components/chart/signatureToggles.js`, replaced 2026-08-01):

```
Top dark-pool notional levels (20 sessions, confirmed prints only). Non-repainting.
```

**TAKEN 2026-08-01 — this is the live string:**

```
Top 5 dark-pool notional levels from the last 20 sessions. Non-repainting: computed from confirmed prints only.
```

Why change it: the house rule is that a "non-repainting" claim must state its mechanism, and the
shipped string asserts it as a bare word at the end. The refinement also states the **5**, which
is the thing a user is actually looking at on the chart.

---

## 2. Flow-Confirmed Breakout (`fcb-v2`)

### 2a. How it's computed — honesty blurb

> Flow-Confirmed Breakout marks a daily breakout only when the options tape agreed with it on the
> same day. Two things must both be true. First, the price leg: the session must close above the
> highest high of the prior **20** sessions, on volume of at least **1.5×** the 20-session average
> (a downside signal is the mirror — close below the prior 20-session low). Second, the flow leg:
> that same session's options tape must show at least **$500,000** in call premium **and** at least
> **1.75×** as much call premium as put premium (again mirrored for the downside). If either leg
> fails, nothing is drawn. There is no partial signal and no forming-bar preview. Daily timeframe
> only in v1 — the toggle simply does nothing on intraday charts rather than showing you a signal
> the rule was never designed for.

**Verbatim source of every number:** `rules.py` — `FCB_LOOKBACK = 20`, `FCB_VOL_MULT = 1.5`,
`FCB_MIN_CALL_PREM = 500_000.0`, `FCB_DOMINANCE = 1.75`. Detector:
`api/services/signature/flow_breakout.py`.

**Precision notes for internal use:**
- The chart scans the **last 60 daily bars** (`_fetch_bars(sym, count=60)` in
  `api/routers/signature.py`). With a 20-bar lookback that's roughly the last 40 evaluable
  sessions, so arrows go back about two months, not two years. If you want deeper history on the
  chart, that count is the lever.
- The dominance ratio floors the opposite side at $1 (`max(put_prem, 1.0)`) so a day with zero put
  premium can't make "1.75× puts" trivially true. Correctness detail, not copy.

### 2b. Repaint statement

> **Non-repainting — evaluated on closed bars only.** When you load a chart, the current session
> is never evaluated: the newest bar is excluded from the scan by construction. The only path that
> evaluates a session's final bar is the **nightly ledger sweep, which runs at 8:05 PM ET, after
> the session settles** — and even then it only trusts that final bar when the bar store's newest
> session matches the session the exchange calendar says should exist. An arrow that appeared on
> your chart was computed from a bar that was already finished. It does not appear mid-session and
> then disappear.

Mechanism is stated in full, per the house rule. The 8:05 PM ET time is real and load-bearing:
extended hours run to 8:00 PM ET and the bar store keeps refreshing today's partial daily bar
from user fetches, not from a clock, so an earlier sweep would have read a bar that was still
being written into an append-only ledger with no correction path.

### 2c. Toolbar tooltip

**Previous string** (replaced 2026-08-01):

```
Breakouts confirmed by same-session options flow. Confirmed bars only. Non-repainting.
```

**TAKEN 2026-08-01 — this is the live string:**

```
Daily breakouts confirmed by same-session options flow. Non-repainting: evaluated on closed bars only.
```

Why change it: "Confirmed bars only. Non-repainting." says the same thing twice without saying
the mechanism once. The refinement folds them into one claim-plus-mechanism and adds "Daily",
which explains to a user on a 5-minute chart why the toggle is doing nothing.

---

## 3. GEX Walls (`gxw-v1`)

### 3a. How it's computed — honesty blurb

> GEX Walls draws three dealer-positioning levels from the **live** options chain: the call wall,
> the put wall, and zero gamma. It reads expiries inside the next **7 days** and draws a level only
> when it sits within **±15%** of spot — a wall 40% away is arithmetic, not a level anyone is going
> to trade against. The chain is re-read on request and held for **10 minutes**; if a fresh read
> can't complete, the last good set is served for up to **30 minutes** while a new one is fetched in
> the background. Some sessions there is nothing inside the band and the chart correctly draws
> nothing — that is the indicator working, not failing.

**Verbatim source of every number:** `rules.py` — `GXW_DTE = "week"` (which
`api/gex_service.py` maps to **the next 7 days**), `GXW_MAX_DIST_PCT = 0.15`,
`GXW_TTL_S = 600` (10 min), `GXW_MAX_AGE_S = 1800` (30 min). Shaping:
`api/services/signature/gex_walls.py`.

### 3b. Freshness statement — **NOT a non-repainting claim**

> **This is a live level set, and we say so.** GEX Walls is not computed from settled history; it
> is recomputed from the current options chain, cached for 10 minutes, and served up to 30 minutes
> stale during an outage. The walls move as the chain moves, intraday, by design — that is what
> makes them useful and it is also what disqualifies them from any "non-repainting" claim. The
> chart shows what the chain said at most ten minutes ago. Anything more precise than that would
> be us overstating our own freshness.

This is the one place in the pack where I am deliberately declining to make the marketing claim.
Dark Pool Levels and Flow-Confirmed Breakout earn "non-repainting". GEX Walls does not, and
claiming it would be exactly the vendor behaviour the whole receipts positioning is built against.
The shipped tooltip already gets this right, which is why the proposed change below is small.

### 3c. Toolbar tooltip

**Previous string** (replaced 2026-08-01):

```
Call/Put walls + zero gamma from the live options chain. Cached 10 min.
```

**TAKEN 2026-08-01 — this is the live string:**

```
Call/Put walls + zero gamma from the live options chain (expiries within 7 days, strikes within 15% of spot). Live level set, cached 10 min.
```

Why you might not want it: it is long for a hover tooltip. Why you might: it is the only surface
where a user learns the ±15% band exists, and "Live level set" is the phrase that tells them not
to expect the other two indicators' stability. **Taken.** (The shorter fallback, if length ever
becomes a problem in use: `Call/Put walls + zero gamma from the live options chain. Live level set, cached 10 min.`)

### 3d. Locked, unrelated to your decision

Free users see all three rows **disabled rather than hidden**, with a single replacement tooltip:

```
Premium — UCT Signature indicators
```

This is the merchandising decision already made in the build (show the feature, gate the feature).
It is the only copy an unpaid user reads on this surface.

---

## 4. The v1 rules table — for tuning

Every constant lives in one file, `api/services/signature/rules.py`, so tuning is a one-file diff
and a redeploy. Version strings (`dpl-v1` / `fcb-v2` / `gxw-v1`) are stamped onto every payload and
every ledger row — **if you change a number that changes output, the version string should bump**,
because the ledger's uniqueness key includes it and old rows must stay attributable to the rule
that produced them.

### Dark Pool Levels

| Constant | Value | In trader terms | Tune-me note |
|---|---|---|---|
| `DPL_WINDOW_DAYS` | `20` | How far back the level search looks: the last 20 trading dates in the confirmed print ledger. | Roughly a month of tape. Shorter reacts faster to a new institutional zone; longer keeps old shelves alive after they stop mattering. Low sensitivity — safe to leave. |
| `DPL_BIN_PCT` | `0.0025` (0.25%) | How wide a "price area" is. On a $200 stock that's a 50-cent band. | **The highest-leverage number here.** Wider = fewer, fatter, more confident levels; narrower = more precise levels, but prints fragment across bins and each fragment can fall under the $10M floor and vanish. 0.25% is a convention, not a measurement. |
| `DPL_MIN_CLUSTER_NOTIONAL` | `$10,000,000` | The size floor: an area must have $10M of dark-pool notional to be called a level. | **Flagged — this is an absolute floor on a relative quantity.** $10M is a rounding error on SPY and a genuinely rare event on a $2B name, so as written this indicator is effectively megacap-scoped. It ships that way. Recommendation is in §7(a). |
| `DPL_TOP_K` | `5` | How many levels are drawn. | Five gold dashed lines is already visually dense; only rank 1 carries a price label on the axis (see §7f). Going to 7+ costs legibility, not compute. |

### Flow-Confirmed Breakout

| Constant | Value | In trader terms | Tune-me note |
|---|---|---|---|
| `FCB_LOOKBACK` | `20` | The breakout window: close must clear the highest high (or lowest low) of the prior 20 sessions. | Conventional monthly-range breakout. **Do not set this to 0** — the detector divides by it (known footgun, unreachable today, documented). |
| `FCB_VOL_MULT` | `1.5` | Volume gate: the breakout bar needs 1.5× its own 20-session average volume. | **Owner's chosen middle (tightened from 1.25 on 2026-08-01).** Convention for a volume-confirmed breakout runs 1.25×–2.0×; 1.5 sits in the centre of that band rather than at either end. It trades some ledger volume for a cleaner chart — fewer marginal arrows, fewer rows to tighten against later. Still a judgement, not a measurement; the ledger (§5) is what will eventually replace it with one. Revisit at 4–6 weeks of record. |
| `FCB_MIN_CALL_PREM` | `$500,000` | The flow floor: the session needs at least half a million in call premium (put premium for a bear signal). | **Flagged — same absolute-vs-relative problem as the dark-pool floor.** $500k is a quiet hour on SPY and a standout day on a mid-cap. It scopes the indicator toward liquid names. |
| `FCB_DOMINANCE` | `1.75` | One-sidedness: calls must outweigh puts by 1.75× (mirrored for bears). | This is the "the tape actually agreed" test and it is the part of the rule I'd defend hardest. 1.5 would let mixed days through; 2.0 would make it rare. Moderate sensitivity. |
| bar scan depth | `60` daily bars | How much chart history gets arrows: ~40 evaluable sessions after the 20-bar lookback. | **Lives in `api/routers/signature.py`, not `rules.py`** (`_fetch_bars(sym, count=60)`). If you want a year of arrows on the chart, this is the number, and moving it into `rules.py` should happen at the same time. |

### GEX Walls

| Constant | Value | In trader terms | Tune-me note |
|---|---|---|---|
| `GXW_DTE` | `"week"` | Which expiries feed the calculation: the next 7 days. | Near-dated is where dealer gamma actually pins price. `"month"` (30d) would produce steadier but less actionable walls. |
| `GXW_MAX_DIST_PCT` | `0.15` (±15%) | Draw a wall only if it's within 15% of spot. | Matches `gex_service`'s own internal `WALL_MAX_DIST_PCT` default of 15.0, so this is a second application of the same band rather than a new opinion. Note: when nothing is inside the band, the underlying service falls back to the full strike list and our filter then drops those — **a healthy payload with zero levels is a normal state**, not an error. |
| `GXW_TTL_S` | `600` (10 min) | How long a chain read is considered fresh. | Every miss is a live ~20s Schwab chain request. Lowering this is directly a cost/latency decision, not just a freshness one. |
| `GXW_MAX_AGE_S` | `1800` (30 min) | How stale a cached set may be served during an outage before we'd rather show nothing. | 3× the TTL, per house convention. |

### Not in `rules.py` today (tuning wrinkles, flagged for honesty)

| Where | Value | Why it matters |
|---|---|---|
| `api/routers/signature.py` `_DPL_TTL_S` | `600` | Dark-pool cache freshness. Tuning it is a second-file diff. |
| `api/routers/signature.py` `_FCB_TTL_S` | `300` | Flow-breakout cache freshness. Same. |
| `api/routers/signature.py` `_fetch_bars` count | `60` | Arrow history depth (above). |
| `app/src/hooks/useSignatureIndicators.js` | `refreshInterval: 120_000` | The chart re-polls all three endpoints every 2 minutes per mounted chart. Directly relevant to decision §7(d). |

**Recommendation:** if you tune anything, the router TTLs and the bar count should move into
`rules.py` in the same commit so "all the tunable numbers are in one file" stays true.

---

## 5. What the ledger records from day one

The receipts clock starts at deploy, not later.

From the moment Phase A ships, every Flow-Confirmed Breakout signal is written to an **append-only**
SQLite ledger (`signature_signals` in `/data/signal_ledger.db`). Each row stores the indicator, the
rule version that produced it (`fcb-v2`), the symbol, the timeframe (`1D`), the direction, the bar
it fired on, the price, the call/put premium that confirmed it — and `first_seen_at`, a timestamp
stamped once at insert and never modified. There is **no UPDATE path in the module**: a row cannot
be edited or backdated, only added, and a duplicate is refused by a uniqueness key rather than
overwriting. Two things write to it: the chart itself, whenever a paying user opens a symbol
(closed bars only), and a **nightly sweep at 8:05 PM ET on weekdays** that walks a fixed symbol list
— **SPY, QQQ, NVDA, TSLA, AAPL, MSFT, AMD, META, AMZN, GOOGL** by default — whether or not anyone
looked at those charts that day. That sweep is what makes the record accrue continuously instead of
only where traffic happened to land. Nothing is published from the ledger in Phase A; it is
write-only, private, and its entire job right now is to be an honest, timestamped, un-editable
record that exists **before** we ever make a performance claim. Dark Pool Levels and GEX Walls do
not write to it — they are level sets, not signals, and there is nothing to time-stamp.

---

## 6. DRAFT landing-page section

> ## DRAFT — DO NOT SHIP
> **This copy does not go on any public page without an explicit "ship it" from the owner.**
> House rule `feedback_explicit_ship_gate`: "looks great" is not deploy approval. This section is
> also **not in this branch's ship** — Phase A ships the indicators; the landing copy can lag.

---

### The first indicators that show their receipts

Most indicators are a formula with a marketing department. Ours come with a paper trail.

Three UCT Signature indicators ship on every chart in the platform. Each one is computed on our
servers from data most platforms don't have — the confirmed dark-pool print ledger, the options
tape, the live gamma chain — and each one tells you exactly how it was built and exactly what it
can and cannot promise.

**Dark Pool Levels** finds where the off-exchange size actually traded. Twenty sessions of
confirmed prints, clustered into price areas, the five heaviest drawn on your chart. Built from
settled prints only, so a level doesn't move on you as the day goes on.

**Flow-Confirmed Breakout** waits for two things to agree. Price has to clear its twenty-session
range on real volume, and the options tape has to have been leaning the same way on the same day.
If only one of them is true, we draw nothing. It is evaluated on closed bars — the current session
is never scored, so an arrow can't appear at 11 AM and be gone by the close.

**GEX Walls** draws the call wall, the put wall, and zero gamma off the live chain. This one moves,
because the chain moves, and we say so instead of pretending otherwise.

And behind all three, from the day they launched: an append-only signal ledger. Every signal, the
moment it fired, the rule version that produced it, written once and never edited. We are not
showing you a win rate today, because we haven't earned the right to. We started the record
instead.

**Navigate the market, effectively.**

---

> **Notes on the draft, for the owner:**
> - There is **no accuracy claim, no win rate, no backtest, no countdown, no "limited spots"** in
>   the above. That is the whole point of the section and I'd defend every omission.
> - The last paragraph — "we are not showing you a win rate today, because we haven't earned the
>   right to" — is the strongest line in the draft and also the most exposed. It is a promise that
>   we will show one later. Only ship it if you intend to keep it.
> - "Most indicators are a formula with a marketing department" is the one line with real voice on
>   it. It's also the one line most likely to be read as a shot at a competitor. Cut it and the
>   section still works.
> - **My recommendation is to HOLD this** — see §7(c).

---

## 7. Owner decision list

Each decision has a recommendation and the reasoning behind it. Where I don't have evidence, I say
so rather than dressing an opinion up as one.

### (a) Approve or tune each indicator's numbers

**Dark Pool Levels — recommendation: APPROVE AS-IS, with one measurement before Phase B.**
Window 20, bin 0.25%, top 5 are all safe conventional defaults with low blast radius. The one I
want on your radar is the **$10M cluster floor**: it's an absolute number applied to tickers of
wildly different liquidity, which quietly makes this a megacap indicator. I am **not** recommending
you change it now — I'd be guessing, and $10M at least guarantees that every level drawn is a real
institutional footprint rather than noise. What I'd recommend instead is a concrete measurement
before Phase B: count how many of the top 200 traded tickers produce at least one level under the
current floor. If that number is small and you want broader coverage, the fix is a liquidity-
relative floor, not a smaller constant.

**Flow-Confirmed Breakout — DECIDED 2026-08-01: `FCB_VOL_MULT = 1.5`, version `fcb-v2`. Revisit
at 4–6 weeks of ledger.** The recommendation put to the owner was to ship at 1.25 — the permissive
end of the conventional 1.25×–2.0× range — on the argument that the ledger's whole value is
accumulating real timestamped signals and a tight gate produces almost nothing to accumulate. The
stated alternative was 1.5: a sharper chart from day one at the cost of a thinner record. **The
owner took 1.5.** That is the shipped number.

Recording it honestly, because this is the doc that has to stay true: there was no data either way
then and there is none now. 1.5 is the centre of a convention, chosen over the loose end — a
defensible judgement between two defensible judgements, not a finding. What actually changes is
the accrual rate: fewer signals per week means the 4–6 week review lands on a smaller population,
so treat that review as a first look rather than a verdict. The version bump to `fcb-v2` is what
keeps the two populations separable when it happens — every row already in the ledger stays
stamped `fcb-v1` and can never be silently pooled with rows the new gate produced.

**GEX Walls — recommendation: APPROVE AS-IS.** The ±15% band matches the underlying service's own
default, so we're not inventing a second opinion about what "near spot" means. 7-day expiries is
where dealer gamma actually pins price. 10-minute cache against a ~20-second live chain request is
a reasonable cost posture. Nothing here is flagged.

### (b) Approve the blurbs and the tooltips

**Recommendation: APPROVE the three blurbs; TAKE the DPL and FCB tooltip refinements; GEX tooltip
your call.** The two refinements exist for one reason: the house rule says a "non-repainting" claim
must state its mechanism, and both shipped strings currently assert it as a bare word. That is
exactly the kind of unbacked assertion the receipts positioning is supposed to make us incapable
of. The GEX change is optional — the shipped string is already honest, the refinement just teaches
the ±15% band and the phrase "live level set". If any tooltip reads long to you, cut from the
middle, never from the mechanism clause.

### (c) Landing copy — ship or hold

**Recommendation: HOLD.** Two reasons, in order of weight. First, the section's centrepiece claim
is the ledger, and on launch day the ledger is empty — the copy is strongest after it has four to
six weeks of real rows behind it, because then "we started the record instead" is a thing we can
show rather than a thing we assert. Second, the landing page isn't in this branch's ship anyway,
so holding costs nothing and forces no schedule. If you want something on the site at launch, the
minimal honest version is the three indicator paragraphs without the ledger paragraph.

### (d) Should multi-chart grid cells inherit Signature overlays, or join the "lite profile"?

**Context:** the Signature toggles are a **user-global** settings blob, so one flip on your primary
chart arms every mounted chart at once — including all 16 cells of a multi-chart grid. Each armed
chart polls three endpoints every 120 seconds. A 16-cell grid with all three on is up to 48 polls
every two minutes, and a GEX cache miss is a live ~20-second Schwab chain request. The worst case
is a cold pod right after a deploy plus an armed 16-cell grid: up to 48 cold builds at once.

**Recommendation: SHIP AS-IS AND WATCH — do not build the lever yet.** This matches the perf
tripwire analysis. The reasoning: grid cells cannot reach the toggle UI themselves (the settings
panel isn't in a grid cell), the toggles default off, and the serve-stale layer collapses repeat
requests per symbol — so the bad case requires a specific user doing a specific thing. Building a
`disableSignature` prop now is speculative work against a scenario nobody has hit.

**But the watch has to be a real watch, with a named threshold, or it's just a shrug.** Concretely:
**if `/api/signature/gex-walls` p95 latency spikes after a deploy, ship the lever.** The lever is
already specified — a `disableSignature` prop on `GridChartCell`, mirroring the existing
`disablePatterns` prop that patterns already uses for exactly this reason. It's a small,
pre-designed change we can land in one pass the day we need it. **This should go on the Task 14
ship checklist as an explicit post-deploy watch item, not left as a vibe.**

### (e) The UCT Signature settings group sits 10th of 13 — leave it or promote it?

**DECIDED 2026-08-01: PROMOTED to 4th.** Shipped order: Preset · Type · Candles ·
**UCT Signature** · Background · Watermark · Moving Averages · Volume · Indicators · Display ·
Swing labels · Markers · Crosshair. (Previous order had UCT Signature between Display and Swing
labels.) The relocation was a pure JSX move — same markup, same state keys, same premium gate;
chart + hooks suites green at 466 tests.

**The reasoning, kept:** **PROMOTE IT to 4th, immediately after Candles.** A user has to scroll past nine
sections to discover the premium feature we just built, and free users — the ones the disabled-row
merchandising decision was made for — are the least likely to scroll that far. Moving it above
Background/Watermark puts it in the first screenful without displacing the three controls people
touch most (Preset, Type, Candles).

**Honest cost accounting:** this is a JSX block relocation of about 28 lines in `ChartToolbar.jsx`
with no logic change — a bit more than "one line", but no new state, no new props, no test changes
beyond order-sensitive assertions if any exist. If you'd rather not touch a settings panel right
before a ship, 10th is genuinely fine for launch and this can ride in the first polish pass.

### (f) Dark Pool level titles show notional only — no price text on ranks 2–5. Acceptable?

**What you actually see:** each level draws a gold dashed line labelled `DP $340M` (notional, no
price). **Rank 1 additionally gets a price label on the axis**; ranks 2–5 don't, so their prices are
read off the axis position.

**Recommendation: ACCEPT FOR V1.** This is a deliberate performance decision with precedent: every
visible axis label costs a crosshair-move recompute, and five of them on one chart is the same
pattern behind the known GEX crosshair lag. Notional is also arguably the more useful label —
the price is already legible from where the line sits, but "how much size is here" isn't visible
any other way. The real fix isn't more axis labels, it's a hover legend that shows price, notional,
print count and last date on demand, and that belongs to the Phase B legend/tooltip system rather
than being bolted on now.

### (g) `lastDate` renders ISO (`2026-07-30`) if it's ever surfaced — fine or restyle?

**Current state:** `lastDate` is computed and carried in the payload but **is not rendered anywhere
today** — it's unconsumed metadata. It is stored ISO deliberately, because ISO sorts chronologically
as a plain string and a raw provider `M/D` format does not (`"9/5"` sorts above `"12/31"`, which
misreports across the month boundary that a 20-session window crosses most months).

**Recommendation: KEEP ISO ON THE WIRE, FORMAT AT RENDER TIME — and never ship raw ISO into a
label.** The wire format is correct and shouldn't change. The rule to write down now, before a
Phase B surface consumes it, is that whatever renders it converts to house style (`Jul 30` /
`Jul 30, 2026`) at the presentation layer. No code change needed today; this is a decision recorded
so the first consumer doesn't accidentally ship `2026-07-30` into a tooltip.

---

## 8. Approval checklist

Nothing ships until the numbers and blurbs are approved. Landing copy can lag — it isn't in this
branch's ship.

**From the plan:**

- [x] **DPL numbers approved** (`DPL_WINDOW_DAYS=20`, `DPL_BIN_PCT=0.0025`, `DPL_MIN_CLUSTER_NOTIONAL=$10M`, `DPL_TOP_K=5`)
- [x] **FCB numbers approved** (`FCB_LOOKBACK=20`, **`FCB_VOL_MULT=1.5`** — tightened from 1.25, version now `fcb-v2`, `FCB_MIN_CALL_PREM=$500k`, `FCB_DOMINANCE=1.75`)
- [x] **GXW numbers approved** (`GXW_DTE="week"`, `GXW_MAX_DIST_PCT=0.15`, `GXW_TTL_S=600`, `GXW_MAX_AGE_S=1800`)
- [x] **Blurbs approved** (all three "how it's computed" paragraphs + all three repaint/freshness statements)
- [ ] **Landing copy approved for ship** (recommendation: HOLD — leave unchecked)

**Additional decisions surfaced during the build:**

- [x] **Tooltips approved** — DPL, FCB and GEX refinements all TAKEN (shipped strings in `signatureToggles.js`)
- [ ] **(d) Multi-chart grid cells** — ship-as-is-and-watch (recommended) vs. build `disableSignature` now
- [x] **(e) Settings group position** — PROMOTED to 4th, immediately after Candles
- [ ] **(f) DP notional-only titles** — accept for v1 (recommended) vs. add price text
- [ ] **(g) `lastDate` ISO** — keep ISO on wire, format at render (recommended)

**Then, and only then:** Task 14 — verification and ship, in a deploy window (≥4:20 PM ET or
<9:15 AM ET).
