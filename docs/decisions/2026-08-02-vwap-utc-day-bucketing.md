# Decision: session VWAP anchors on a UTC calendar day, not an ET session

**Decision id:** `VWAP_SESSION_ANCHOR`
**Status:** ✅ **ACCEPTED 2026-08-03 — the owner took the correctness side against §4's measured number. `computeVWAP` now buckets by the ET calendar day; `compute.rev` is 2. Applied cost, re-measured on application: 2,590 changed pixels (0.348118%), identical to §4.**
**Owner of the maths:** `app/src/components/chart/indicators.js` → `computeVWAP`.
**Adjudication row:** `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §11.
**Raised by:** Phase B3, adjudication A7. **Measured:** 2026-08-02, at the VWAP Flip A (Task 8).
**Pinned by:** `app/src/components/chart/engine/__tests__/vwapUtcBucketing.test.js` (names this record), plus `app/src/components/chart/goldenFixtures.test.js` → *computeVWAP session boundaries (pinned bug class)* and `tests/fixtures/indicators/intraday5m_sessions.json`.

> This document exists to price a **visible and numerically wrong** behaviour on a
> shipped chart before anyone changes it. It follows
> `docs/decisions/2026-08-02-macd-head-mask.md` exactly, because that is the
> precedent the owner already acted on: measure the correction in pixels, state
> the standing cost of keeping the current behaviour in values, and leave the
> default alone until the owner decides.
>
> **This one is not the head-mask.** The head-mask was 8 whitespace bars at the
> extreme left of one pane and the maths underneath was already correct. This is
> the maths, and it is wrong by **$14.45** at one session's open.

---

> **Read §1–§8 in the past tense.** They are the analysis the owner decided on,
> preserved verbatim. **§9 is what was actually done**, and the one number to
> quote from this file today is §9's re-measurement, not §4's — they agree, which
> is itself the finding.

## 1. What the behaviour is

`computeVWAP` (`indicators.js:162-183`) **used to restart** its `cumPV`/`cumVol`
accumulator whenever the **UTC calendar day** changed:

```js
const d = new Date(bar.t * 1000)
const dayKey = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
if (dayKey !== currentDay) { cumPV = 0; cumVol = 0; currentDay = dayKey }
```

A session VWAP is supposed to anchor on the **trading session**. The two agree
for regular hours and only for regular hours: 09:30–16:00 ET is always inside one
UTC day, which is exactly why no unit test caught this for the life of the chart.

They stop agreeing the moment extended hours are on — which is the default on
this chart's intraday timeframes, and the only timeframes VWAP renders on at all.

## 2. Where they diverge, and why it moves

* **EDT is UTC-4**, so 20:00 ET *is* 00:00 UTC the next day. The accumulator is
  wiped on the **last bar** of a session that has not ended.
* **EST is UTC-5**, so the same boundary lands at **19:00 ET** — an hour earlier
  and **thirteen 5-minute bars inside** the post-market session.
* And because Monday's 19:00–20:00 ET bars have already opened UTC day 11-04,
  **Tuesday's 04:00 ET open is not a UTC-day boundary at all.** It never resets.
  The entire session accumulates on top of the previous evening's post-market
  volume.

The split hour **moves with the UTC offset**, not with the trading day. That is
the shape of the defect, and it is why an RTH fixture can never show it.

## 3. The correctness cost of KEEPING it, in values

Measured by B3 Task 7 on `app/src/pages/parityBars/intraday5m.json` — 579
five-minute extended-hours bars over Fri 2025-10-31 (EDT), Mon 2025-11-03 and Tue
2025-11-04 (EST), the same series the pixel gate renders.

```
UTC days:            2025-10-31, 11-01, 11-03, 11-04, 11-05   (5)
utcResetIndices:     [0, 192, 193, 373, 566]   ← what today's code does
etResetIndices:      [0, 193, 386]             ← what a session anchor would do
```

### 3a. Three mid-session wipes ET would not have

| bar | ET wall clock | UTC | shipped VWAP | session-anchored | **error** |
|---:|---|---|---:|---:|---:|
| 191 | Fri 19:55 **EDT** | 10-31 23:55 | 101.9382 | 101.9382 | 0.0000 |
| **192** | **Fri 20:00 EDT** | **11-01 00:00** | **106.8533** | **101.9471** | **4.9062** |
| 372 | Mon 18:55 **EST** | 11-03 23:55 | 96.4401 | 96.4401 | 0.0000 |
| **373** | **Mon 19:00 EST** | **11-04 00:00** | **93.7233** | **96.4361** | **2.7128** |
| **566** | **Tue 19:00 EST** | **11-05 00:00** | **112.5800** | **109.4466** | **3.1334** |

### 3b. A WHOLE SESSION carried over — the severe one

| bar | ET wall clock | UTC | shipped VWAP | session-anchored | **error** |
|---:|---|---|---:|---:|---:|
| 385 | Mon 20:00 EST | 11-04 01:00 | 93.0808 | 96.3823 | 3.3015 |
| **386** | **Tue 04:00 EST — the open** | **11-04 09:00** | **93.9178** | **108.3633** | **$14.4455** |
| 387 | Tue 04:05 EST | 11-04 09:05 | 95.0924 | 108.3592 | 13.2669 |
| 400 | Tue 05:10 EST | 11-04 10:10 | 100.8394 | 108.1071 | 7.2677 |
| 450 | Tue 09:20 EST | 11-04 14:20 | 105.5626 | 108.2380 | 2.6754 |
| 565 | Tue 18:55 EST | 11-04 23:55 | 109.1585 | 109.4418 | 0.2832 |

**Summary of the standing cost:** the chart opens Tuesday's session **$14.45**
away from the session-correct VWAP, stays more than **$0.50** wrong for **120 of
that session's 193 bars**, and **207 of the fixture's 579 bars** differ by more
than a cent. A trader reading VWAP as a session mean is reading a number that
includes the previous evening's post-market volume.

## 4. The pixel cost of CORRECTING it

Measured 2026-08-02, two `npm run build` outputs of this branch differing **only**
in `computeVWAP`'s bucketing (ET-session vs UTC-day), diffed on the case that
renders it.

| | |
|---|---|
| **Case** | `vwap_only` — 579 five-minute `intraday5m` bars, tf `5`, 1200×620, `classic_flat` preset, `--instances-side none` (both sides draw the LEGACY block, which is what users see) |
| **Changed pixels** | **2,590** of 744,000 — **0.348118%** of the export |
| **Distribution** | `2,590` on **20 of 20 runs**. Zero variance — the distribution is literally `{2590: 20}` — and every capture on both sides settled on its first re-check (`shots 2/2`, 40 of 40) |
| **Flake bound** | The harness's 95% bound at n=20 is 13.9%, and it does **not** apply here: the number is identical on every run and each build is independently deterministic (`--same-build --repeat 5` on each: **0 px**, exit 0). 2,590 is a fact about these two builds, not a sample. Quote the bound, never "it doesn't flake" |
| **A (UTC-day — SHIPS)** | build **`d64c84c2ebf7`** (dist) — `index-f8ZNkAre.js` |
| **B (ET-session)** | build **`8bbbb44e1110`** (dist) — `index-Dti8eeP5.js` |
| **Exit code** | `1` — correct: this measurement is *supposed* to be non-zero. A **0** would mean the change did not reach the lane being rendered |

The two builds differ in nothing but `computeVWAP`'s `dayKey`. The B side was
validated against `tests/fixtures/indicators/intraday5m_sessions.json` before it
was photographed: its accumulator resets at exactly `[0, 193, 386]` — the
fixture's `etResetIndices` — and its output matches the fixture's
`etSessionVwap` with a **worst absolute difference of 0** across all 579 bars. So
this is the cost of the *correct* series, not of an approximation of it.

**And it moves BOTH lanes, which is the load-bearing part.** The same two builds
diffed with `--instances-side both` — the ENGINE drawing on both sides — report
the **same 2,590 px** (5/5 runs). `computeVWAP` is the single source for the
legacy block and for `nativeRegistry.computeFor('vwap')` alike, so a correction
reaches what users see and what the engine draws together and cannot half-land.
That symmetry is why this is a `compute.rev` bump and not a presentation tweak.

**What the 2,590 pixels are.** The cyan line, across `x ∈ [355, 1077]` and
`y ∈ [168, 441]` — i.e. from the Friday-evening boundary to the right edge, and
vertically across most of the price pane. Max channel delta 205 (cyan against
canvas). It is **not** one contiguous block like the head-mask's 44×4: it is
402 px in the left third, 982 in the middle and **1,206 in the right third**,
because the error grows as the sessions accumulate. The Tuesday session redraws
roughly $14 higher at its open and converges over the day, and the three
mid-session vertical drops disappear.

29× the head-mask's 88 px — and unlike the head-mask it is not confined to the
extreme left of history. It is the part of the chart a trader is looking at, and
on the screenshots the corrected line hugs the candles in every session where the
shipped one detaches from them for a whole day.

## 5. What each option costs

| | |
|---|---|
| **Keep UTC-day bucketing (today's default)** | The chart looks exactly as it always has, and every stored alert, screen and backtest keyed on VWAP keeps its historical meaning. The number remains wrong by up to **$14.45** on an extended-hours session, on an indicator whose entire purpose is to be a session mean. §9.1's cross-lane agreement is unaffected — Python has no VWAP, so there is no lane to disagree with; this is not a parity defect, it is a correctness one. |
| **Anchor on the ET session** | VWAP means what its name says on every timeframe it renders on. **Measured cost: 2,590 changed pixels (0.348118%)**, both lanes, and a `compute.rev` bump on the `vwap` definition — which under spec §3.1 force-migrates every binding with user notification, resets evaluator `last_value`, and suppresses the first post-migration cycle. Anything a user pinned to `vwap@rev 1` stops being reproducible. |

## 6. Why it is NOT bundled into the Flip A commit

Flip A's contract is that `engine_vwap_vs_legacy` measures **0** changed pixels,
and that the 0 is attributable to the migration. Correcting the maths inside that
commit would make the parity number unattributable in exactly the way the
MACD head-mask decision established: a migration commit's pixel count has to
describe the migration.

Concretely: both lanes read `computeVWAP`, so correcting it moves **A and B
together** and `engine_vwap_vs_legacy` would still report **0** — the migration
would look verified while the picture had silently changed underneath it. The
number that shows the change is `vwap_only` measured across two builds, which is
§4, and it belongs to this decision rather than to the migration.

## 7. The rules for applying it, if the owner says yes

- **Its own commit**, never inside a migration. Same rule the head-mask got, and
  §6 is why it matters more here.
- **`compute.rev: 2` on the `vwap` definition** — this is the maths, not the
  presentation, so it is `compute.rev` and NOT `version`. That is the opposite of
  the head-mask, which bumped `version` and left `compute.rev` alone.
  `nativeRegistry.test.js` asserts the current pair; expect it to go red.
- **One implementation, both lanes.** `computeVWAP` is the only place the
  bucketing lives; do not add a second session-boundary helper for the engine.
  If a `computeVWAP` change ever measures **0** on `vwap_only`, one of the lanes
  has stopped reading it.
- **⚠️ `_ET_OFFSET` IS NOT A SESSION BOUNDARY AND MUST NOT BE REUSED AS ONE.**
  `StockChart.jsx:517` resolves ET as a **module-load constant** (−14400 / −18000),
  so a series spanning a DST change is an hour off on one half depending on when
  the page loaded. A session anchor built on it would be correct for half the year
  and silently wrong for the other half — which is the same class of defect this
  record is about. A correct fix needs a per-bar zone resolution
  (`Intl.DateTimeFormat` with `America/New_York`, memoised per day, or an explicit
  offset table like `tools/gen_intraday_fixture.py` uses).
- **The session boundary is 04:00 ET, not 09:30.** The fixture's
  `etResetIndices` are the extended-hours opens, and `etSessionVwap` in
  `tests/fixtures/indicators/intraday5m_sessions.json` is already the correct
  series to assert against — it is what would go from "the reference" to "the
  expectation".
- **These tests are EXPECTED to go red, and must be updated in the same commit:**
  - `app/src/components/chart/goldenFixtures.test.js` → *computeVWAP session boundaries (pinned bug class)* — all three cases
  - `app/src/components/chart/engine/__tests__/vwapUtcBucketing.test.js` — the whole file
  - `app/src/components/chart/engine/__tests__/vwapFlipAParity.test.js` → *…and those numbers are STILL the UTC-day ones, at the bars that prove it*
  - `app/src/pages/parityBars/intraday5m.test.js` → its VWAP bucketing cases
  - `app/src/components/chart/indicators.test.js` → any VWAP session case
  - `tests/fixtures/indicators/_schema.md` — the note describing the pinned bug class

  The check that produced this list, and the one to re-run before applying:
  `grep -rn "computeVWAP\|utcResetIndices\|etSessionVwap\|VWAP_SESSION_ANCHOR" app/src tests tools docs`.
  The head-mask record undercounted its own list by one file; this one was built
  from that grep rather than from memory.
- **Re-run `--cases vwap_only engine_vwap_vs_legacy engine_vwap_dimmed_vs_legacy engine_vwap_dashed_vs_legacy`
  afterwards.** The three `engine_*` cases must stay **0** — they compare two
  lanes of the *same* build, so a correct fix does not move them. `vwap_only`
  `--same-build` must return to **0**, which is what says the new behaviour is as
  deterministic as the old one.

## 8. Recommendation

**Fix it, in its own commit, at the next release that can carry a `compute.rev`
bump — but not before someone who trades off this chart has looked at the two
pictures side by side.**

The correctness argument is one-sided: a session VWAP that includes the previous
evening's volume is not a session VWAP, and $14.45 at an open is not a rounding
difference. The reason it is still the owner's call is §5's right-hand column —
2,590 pixels is a visibly different chart, a `compute.rev` bump breaks every pin
on `vwap@rev 1`, and the people who have been trading against this line for
months have calibrated to the line that is there, wrong or not.

That is a trading decision wearing a correctness decision's clothes, which is
precisely the category this file exists to hand to the owner rather than settle
in a migration.

---

## 9. APPLIED — 2026-08-03

The owner took the correctness side. `computeVWAP` buckets by the **ET calendar
day**, resolved per bar from the IANA zone `America/New_York` via
`Intl.DateTimeFormat`, and the `vwap` definition is on **`compute.rev: 2`**.
Shipped in a commit of its own, per §6 and §7.

### 9a. The pixel cost, RE-MEASURED on application

Same instrument, same case, same 20 runs — the point being to find out whether
the number the owner decided against is the number that was actually paid.

| | |
|---|---|
| **Changed pixels** | **2,590** of 744,000 — **0.348118%** |
| **Distribution** | `{2590: 20}` — 20 of 20 runs, zero variance, `shots=2/2` on all 40 captures |
| **Case** | `vwap_only`, 579 five-minute `intraday5m` bars, tf `5`, 1200×620, `--instances-side none` (both sides draw the LEGACY block — what users see) |
| **A — UTC-day (`HEAD`, pre-decision)** | build **`89f73b36ae29`** · `index-DuPpqyEJ.js` |
| **B — ET-session (SHIPS)** | build **`35ec82560ea5`** · `index-8P8qVvtb.js` |
| **Exit code** | **1** — correct; a **0** would mean the change did not reach the rendered lane |
| **Determinism** | each build `--same-build --repeat 5`: **0 px**, exit 0, both sides |
| **Both lanes** | the SAME **2,590** with `--instances-side both`, 5/5 — one `computeVWAP`, so the correction could not half-land |
| **Shape** | `x` in [355, 1077], `y` in [168, 441], max channel delta 205; 402 px left third, 982 middle, **1,206 right third** — identical to §4 |

**It matched §4 to the pixel, and to the bounding box and the per-third split.**

> ⚠️ **BOTH BUILD IDS DIFFER FROM §4's, AND THAT IS EXPECTED — the number did
> not.** §4's A `d64c84c2ebf7` was an intermediate tree captured mid-Task-8,
> before that task's mutation-driven `defSchema.js` hardening; the committed tree
> it became builds to `89f73b36ae29`, which is what A is here. §4's B
> `8bbbb44e1110` carried the bucketing change *alone*; B here also carries the
> `compute.rev: 2` literal and its comment, so different bytes. **Quote §9's
> pair, not §4's** — a build identity names a tree, and neither of §4's trees
> exists any more.

### 9b. The three engine cases stayed 0, which is what §7 asked

On build **`35ec82560ea5`** alone (two lanes of one build), `--repeat 10`:
`engine_vwap_vs_legacy` · `engine_vwap_dimmed_vs_legacy` ·
`engine_vwap_dashed_vs_legacy` — **0 px each, 10/10, exit 0**. Flip A is intact:
the engine still draws what the legacy block draws, now that both draw the
corrected series. 95% flake bound at 10 clean runs: 25.9%.

### 9c. It is the CORRECT series, asserted permanently

The claim §4 made about the transient measurement build is now a standing test
(`vwapUtcBucketing.test.js` → *the shipped series IS the golden fixture's
etSessionVwap, exactly*): the accumulator resets at exactly `[0, 193, 386]` —
the fixture's `etResetIndices` — and matches `session.etSessionVwap` with a
**worst absolute difference of 0** across all 579 bars.

Two independent readings of one IANA zone agree there: the fixture is derived
from `zoneinfo.ZoneInfo("America/New_York")` in
`tests/fixtures/indicators/_generate.py`, the implementation from
`Intl.DateTimeFormat`'s `America/New_York`.

### 9d. NO FIXTURE WAS RESEEDED — which is why nothing was re-baselined

`tests/fixtures/indicators/*.json` are unchanged, **not one byte**. They already
carried the correct series (`session.etSessionVwap`) and the retired boundaries
(`session.utcResetIndices`) side by side, so applying the decision re-pointed the
assertions and touched no data. Those files are read by BOTH
`goldenFixtures.test.js` and `tests/test_indicator_golden.py` at rel-tol 1e-9; a
reseed would have had to redden both lanes, and there was none to redden.

Every re-pointed case keeps a **non-vacuity half** that recomputes the retired
UTC-day series locally, so "the shipped function is ET-anchored" is measured
against something that can still disagree with it.

### 9e. §7's list, checked — one entry was wrong

| §7 said | what happened |
|---|---|
| `goldenFixtures.test.js` — all three cases | ✅ red, re-pointed |
| `vwapUtcBucketing.test.js` — the whole file | ✅ 3 of 7 red; rewritten, now 8 cases pinning the corrected side |
| `vwapFlipAParity.test.js` → *…STILL the UTC-day ones* | ✅ red, values moved |
| `intraday5m.test.js` → its VWAP bucketing cases | ✅ 2 red, re-pointed |
| `indicators.test.js` → any VWAP session case | ⚪ **did not move** — its session case is two bars a UTC day apart, which is also two ET days apart, so it reads the same under both bucketings |
| `_schema.md` — the pinned-bug-class note | ✅ updated |
| `nativeRegistry.test.js` *"asserts the current pair; expect it to go red"* | ❌ **WRONG — it stayed green.** Its `compute.rev` assertion is MACD's (*"is a PRESENTATION change"*), not VWAP's. The VWAP pair was only ever asserted in `vwapUtcBucketing.test.js`, which did go red. Recorded because a checklist entry that names the wrong file is how a real gate gets skipped. |

### 9f. Live consumers: NONE. Nothing to migrate, no alert changed

§5 said "Python has no VWAP", and that is right, but the wider claim needed
checking because a `compute.rev` bump is supposed to force-migrate bindings.

| consumer | reads VWAP? |
|---|---|
| `api/services/indicator_compute.py` | **No VWAP function at all.** sma · ema · rsi · macd · bb · williams_r · cci · mfi · stoch. There is no `compute_vwap`/`compute_vwap_raw` pair to keep in agreement, so the backend never had this bug to fix. |
| `api/services/indicator_alert_evaluator.py` | `INDICATOR_FUNCS` has 8 keys — `rsi`, `macd`, `stoch`, `williams_r`, `cci`, `mfi`, `price_vs_ma`, `bb`. **No `vwap`.** `_evaluate_one` returns `(None, False)` for an unknown indicator, so even a hand-written `indicator='vwap'` row could never fire. |
| `IndicatorAlertPopover.jsx` | offers those same 8. A user cannot create a VWAP alert. |
| `api/services/strategy_templates.py` | 4 strategies — `rsi_mean_reversion`, `macd_crossover`, `bb_breakout`, `ma_crossover`. **No VWAP rule.** It imports `compute_rsi`/`compute_macd`/`compute_bb` only. |
| `pattern_engine/detectors/uct/avwap_reclaim.py` | its own `_avwap`, anchored on a swing pivot, not a session. Does not import `indicator_compute` and shares no code with `computeVWAP`. Unaffected. |

**Zero stored alerts change value. Zero backtest signals move. Zero rows migrate.**
The `compute.rev` bump is still correct and still required — it is what makes a
future binding, cache or pin able to tell the two series apart — but its §5
consequences ("resets evaluator `last_value`, suppresses the first
post-migration cycle") have **no population to act on today**. The only user
visibly affected is the one looking at an intraday chart.

> ⚠️ **ADDENDUM 2026-08-06 — the table above was true when written and is now
> FALSE in its first two rows.** `vwap` is an alertable address. Do not quote
> §9f without §10.



### 9g. Carried forward

1. **ET midnight, not an explicit 04:00 anchor.** They are identical for every
   bar this feed serves (US equity extended hours open at 04:00 ET, so nothing
   falls in 00:00–04:00), and ET-day is what the fixture oracle is built on. A
   true **overnight (20:00–04:00 ET) tape** would be split at ET midnight by
   this implementation. Named here rather than fixed, because a second,
   unmeasured behaviour change inside the commit whose whole purpose is
   attributability is exactly what §6 forbids.
2. **⚠️ A NINTH WAY THE MEASUREMENT CAN LIE, hit live during this run.**
   `tools/spa_server.py` on an already-bound port **fails silently** — the
   process exits 0, its log is empty, and the port keeps answering 200 from a
   STALE server left by an earlier session. The first attempt at §9a was made
   against builds `25b09976a062` and `9c7b7e62e647` (Task 6's and Task 8's, still
   listening on 5191/5192) and reported a clean, plausible **0 px, 20/20 — exit
   0**. What caught it was comparing the harness's printed build identity against
   the `index-*.js` filename in the dist that had just been built. **Read the
   build-identity line every time; a fresh `npm run build` is no evidence the
   server is serving it.**
3. **`tools/chart_parity_cases.json`'s `vwap_only` `why` carried a stale 6,687.**
   Written into the Flip-A commit `76a67b6e` before §4 measured the real cost,
   and never corrected when `45d719ba` landed 2,590. Fixed in this commit.
4. **⚠️ THE RECORD-CONTENT GATE WAS DECORATIVE, AND THREE MUTATIONS PROVED IT.**
   `vwapUtcBucketing.test.js`'s *"the record states the pixel cost"* was
   `expect(wholeFile).toMatch(/\*\*2,590\*\*/)`. Corrupting §9a's applied number
   left it **green on §4's copy** — the estimate standing in for the
   measurement. Narrowing the assertion to a slice of §9 was **still not
   enough**: `**2,590**`, `89f73b36ae29` and `35ec82560ea5` each appear TWICE
   inside §9 (the measurement table, and the prose discussing it), so
   `toContain` on the slice passed with the table row rewritten. All three
   mutations only died once the assertions matched the **table ROW** — label,
   separator and value together. **Prose about a number is not the number**, and
   a second copy anywhere in scope makes a containment check unfalsifiable.

---

## 10. ADDENDUM — 2026-08-06: §9f's "no population" is no longer true

**Appended, not rewritten.** §9f is preserved verbatim above because it is an
accurate record of what was checked on 2026-08-03 and of the evidence the owner
decided on. Two of its rows describe a tree that no longer exists.

| §9f said | what is true on 2026-08-06 |
|---|---|
| *`indicator_compute.py` — "No VWAP function at all"* | **`compute_vwap` / `compute_vwap_raw` ship**, and they take the CORRECTED ET-session logic (`indicator_compute.py`, "PRESERVED (CORRECTED) BEHAVIOUR"). |
| *`indicator_alert_evaluator.py` — "`INDICATOR_FUNCS` has 8 keys … No `vwap`"* | **`INDICATOR_FUNCS` has 28 addresses across 14 groups, and `vwap` is one of them** (Phase B5). A user can arm a VWAP alert, and `test_a_vwap_alert_can_now_actually_fire` asserts it does. |
| *"its §5 consequences … have no population to act on today"* | **There is now a lane to act on.** Production carries zero armed indicator alerts as of this date, so the population is still empty in fact — but it is no longer empty by construction, which is the difference that matters. |

**What was built because of this.** Phase C Task 7 landed the machinery §5 named,
before the first real population meets it: `api/services/alert_rev_migration.py`.
`migrate_bindings_to_rev(address, new_rev, *, notify)` performs the three effects
in one transaction — `def_rev`, `last_value := NULL`, `rev_migrated_at := now` —
and `suppress_first_cycle(alert)` eats the alert's first post-migration
evaluation. `indicator_alert_evaluator._run_one_cycle` consults it.

**Why the suppression is not optional, measured on this record's own fixture.**
At index 386 of `app/src/pages/parityBars/intraday5m.json` — the third ET session's
open — the UTC-day lane reads **93.9178** and the ET-session lane reads
**108.3633**. An alert holding the first number and computing the second fires
"crossed above 100" on the deploy, and the user is told a level was crossed
because the ANCHOR moved. Resetting `last_value` kills that crossing, but
`above`/`below` never read a previous value at all, so a level binding still
fires immediately on the new number: **the reset covers the crossings and the
suppression covers the cycle, and neither one covers the other's half.**

**Scope, stated so it is not assumed.** This migration path is for ALERT
bindings. It writes `indicator_alerts` and its own side table and **nothing
else** — in particular it does not rewrite `chart_settings` or
`charts_workspace_layout`, whose stored blobs are handled by Phase B's read-time
migration and are correct in production today
(`tests/test_alert_rev_migration.py::test_the_migration_touches_NO_STORED_CHART_SETTINGS_BLOB`).

**The rail that keeps this record and the code in step.** `compute.rev` is
authored in `nativeRegistry.js`; the alert lane keeps `ADDRESS_REVS` beside it
and `test_the_python_rev_table_matches_the_JS_registry` parses the registry
source and fails when they disagree. **The next `compute.rev` bump lands red in
Python until somebody opens the migration module** — which is exactly the moment
the migration is meant to be run, rather than the moment after.
