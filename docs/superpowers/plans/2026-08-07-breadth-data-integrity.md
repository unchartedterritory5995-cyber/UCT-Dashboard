# Breadth data integrity — fix plan (2026-08-07)

Written to survive a context compaction. **This file is the source of truth for
what is done, what is not, and what to do next.** It assumes no memory of the
session that produced it.

---

## STATUS — 2026-08-08: P0–P5 COMPLETE, three owner decisions open

`breadth_freeze_audit.py --days 150` reports **0 unexplained, exit 0** for the
first time. Dashboard shipped to master (`030e69bc..f97983e7`) and verified live.

| item | outcome |
|---|---|
| P0 universe | fixed `f3d4dc8` — last-good fallback + 5% step warning |
| P1 cboe | **86 rows re-dated** `22c42ff`; second dry run 150/150 correct |
| P1b score | dissolved — it is derived at read time, so it corrected itself |
| P2 metrics | `uct_exposure` fabrication found + repaired `cc5e433`; a NEW window bug found + fixed `a80b1ea1`; the other five verified sound |
| P3 slope | tightened to strict `>`/`<` in all three copies `c4c4ed4` / `23dde7cc` |
| P4 NAAIM | sources exhausted — the publisher withdrew the data. **Chatter route ACCEPTED 8/8**; selection reworked to newest-survey-wins |
| P5 ship | pushed, deployed, verified live; freeze audit clean |

**Found during the work, not in the original plan:**

- **`get_history(days)` let the request change the answer.** Rolling metrics were
  derived over only the rows fetched, so the same date returned different values
  from a 30-day vs a 200-day read (`ratio_5day` 3.77 vs 1.16; `adv_decline_cum`
  wrong on 30 of 30). `get_latest()` calls `get_history(1)`, making the most-read
  row the worst one. Fixed with a 15-row warm-up + an absolute A/D seed;
  **verified live: 0 disagreements across all five fields.**
- **`uct_exposure` was fabricated on 33 January–February sessions**, all reading
  exactly 14.0, all written in one backfill run on 2026-03-22. It drives position
  sizing. Nulled; there is no source to recover the true values from.
- **`^VIX6M` went dark after 2026-07-17**, like `^VXMT` before it. The
  `.dropna().iloc[-1]` shape in both readers carried 22.28 forward — this repair
  *introduced* that and the freeze audit caught it the same hour.

### Open — owner decisions only

1. **Universe history.** ~1/3 of 120 sessions were collected on the wrong
   population. Leave / normalise at display / backfill / mark. The audit now
   carries a `STEP_CHANGE` kind that reports these every run as context and
   **fails the gate on any NEW swap** (`STEP_GATE_FROM = "2026-08-08"`).
2. ~~**72 `uct_exposure` rows disagree with `market_regimes`.**~~ ✅ **RESOLVED —
   not a defect.** In all 72 the regime row was created BEFORE the snapshot
   (2026-03-23: regime 12:31, snapshot 21:31), so the collector did read a real
   value. `record_market_regime` is an UPSERT whose DO UPDATE rewrites
   `exposure_pct` but touches neither `source` nor `created_at` — both describe
   only the FIRST writer, so a row labelled `morning_wire` can hold a value the
   brain wrote later — and `autonomous_brain` re-upserts five times a day. The
   snapshot is the 4:15 PM ET reading, as-of the same moment as every other
   field in that row; the table is mutable current state. **Different moments,
   not different facts.** Leaving them is the justified default; adopting the
   table's value would put a post-close revision in one field of a 4:15 row.
3. ~~**NAAIM.**~~ ✅ **DECIDED — chatter route accepted, no subscription.**
   Selection reworked to newest-survey-wins; YCharts added; wire cache demoted
   to a fallback tier. See P4.
4. **Labels** (P3 items 1–2): closing-basis new highs, and Stage 2 = MA stack
   only. Both are internally correct but narrower than the published NH/NL and
   the full Minervini template. Keep, relabel, or add a variant.

Worktree: `C:\Users\Patrick\uct-worktrees\breadth-live` (branch
`feat/breadth-live`). Sister repos: `C:\Users\Patrick\uct-intelligence`
(collector + audit tools), `C:\Users\Patrick\morning-wire` (wire engine).

---

## 0. The pattern behind almost every defect found

Eight defects were found in one audit pass. Six are the same failure:

> **An absence rendered as a plausible number.**

NAAIM froze at a hardcoded 75.00 for 93 sessions. `cboe_putcall` silently
substituted the prior session. `breadth_score` scored a missing input as 0,
which is identical to the worst possible reading. `vix_term_structure` was
never populated and the detector skipped it *because* it was empty.

Corollary that keeps proving true: **the detector that exists to catch this
missed it**, because it was written against the shape of the last incident
(frozen values) rather than the shape of the failure (data not tracking
reality). When adding a check, ask what the *absence* of the thing looks like.

Second recurring lesson: **agreement is not correctness.** `reconcile` shows the
live path and the collector agree at 0 failures — but they can agree perfectly
on a wrong definition. Verify definitions separately from implementations.

---

## 1. State of play

### Shipped to production and verified
- Live intraday breadth, per-minute sampler, dividend-corrected price basis
  (`BREADTH_DIVIDEND_BASIS=1`), reconcile at **0 failures**, anchor correctly
  disabled, accuracy tiers re-graded. Master `c27b7a85`.
- Phone strip wrap fix; heat map intact.

### Shipped 2026-08-08 — all of the below are on master and deployed
| commit | repo | what |
|---|---|---|
| `498bb759` | dashboard | breadth_score renormalization |
| `a95e012b` | dashboard | 20 Data Charts presets + browser gate |
| `a80b1ea1` | dashboard | **get_history window fix** (warm-up + absolute A/D seed) |
| `23dde7cc` | dashboard | strict stage slope + mirrored test copy |
| `937d34d` | uct-intelligence | cboe date fix, `^VIX6M`, `iwm_close` |
| `22c42ff` | uct-intelligence | **`--patch-cboe-date`** — 86 rows re-dated |
| `cc5e433` | uct-intelligence | **`--patch-exposure-gaps`** — 34 fabricated rows nulled |
| `c4c4ed4` | uct-intelligence | strict stage slope + shared `_stage_mask` |
| `f05bb86` | uct-intelligence | 6-month VIX date-exact, no walk-back |
| `f3d4dc8` | uct-intelligence | universe last-good fallback + 5% step warning |
| `a6e2d10` | uct-intelligence | freeze audit: NULL_TAIL / ALL_NULL / MISSING |
| `d70baeb` | morning-wire | dist_days from state |

Dashboard pushed `030e69bc..3d60525b`. Collector/wire commits are local to their
repos and take effect on the next scheduled run (collector 3:15 PM CT weekdays;
wire 6:35 AM CT) — the **history** repairs were applied directly and verified.

⚠️ **Deploy window: web pushes only ≥4:20 PM ET or <9:15 AM ET**, enforced by
`.git/hooks/pre-push`. Master moves constantly from parallel sessions — always
`git fetch` → merge master INTO the branch → re-verify → push. **Never force.**

---

## 2. Work items, in priority order

### P0 — Universe bimodality ✅ FORWARD FIX DONE (`f3d4dc8`); history is the open owner decision

**Symptom.** `universe_count` oscillates between ~2,650–2,750 and ~3,600–3,736.
Not drift — a switch. 39 of 119 sessions moved >1%; full range 36.7%.

```
7/24 → 7/27   3652 → 2637  (-1015)   stage2 1147 → 763
5/22 → 5/26   2731 → 3711  (+980)    stage2  825 → 1207
5/26 → 5/27   3711 → 2744  (-967)    stage2 1207 → 821
4/06 → 4/07   3606 → 2662  (-944)    stage2  891 → 647
```

**Impact.** Every COUNT metric carries ~35% step artifacts unrelated to price:
`new_52w_highs/lows`, `new_20d_highs/lows`, `new_ath`, `stage2_count`,
`stage4_count`, `up/down_4pct_today`, `up/down_20pct_5d`, the 25%/50% mover
family, `magna_up/down`, `hvc_52w`. `stage2_count` tracked the universe
one-for-one across every step above.

NOT affected: `pct_above_*` (coverage-invariant by construction) and
`breadth_score` (divides stage2 by universe_count, uses `hi_ratio` not the raw
count). That design decision is load-bearing — preserve it.

**Hypothesis (unproven).** The ~3,700 figure matches the full cap universe
(`api/data/cap_universe.json`, 3,685–3,742 tickers); ~2,700 looks like a
market-cap/liquidity-filtered subset. Suspect the collector sometimes takes a
fallback universe path. **Prove it before fixing.**

**Root cause, proven.** Three universe paths. The `cap_universe_cache.json`
fallback is a bare ~3,729-ticker list with **no cap data**, so the CS/ADRC +
$300M + price + volume filters cannot be reapplied to it — there is nothing to
filter on. When the clean path failed, the collector silently measured the whole
cache instead of the filtered ~2,700.

**Fixed (`f3d4dc8`).**
1. ✅ A `breadth_universe_last_good.json` fallback (atomic write) sits ahead of
   the cap cache. Yesterday's filtered universe misses a day of new listings —
   a rounding error next to a 1,000-name population swap.
2. ✅ `_warn_on_universe_step()` shouts when the count moves ≥5%
   (`UNIVERSE_STEP_WARN_PCT`), far above organic churn and far below the ~35%
   swaps that happened.
3. ✅ 27 tests (`test_breadth_universe_continuity.py`).

**Still open — owner decision:** ~1/3 of the 120 stored sessions were collected
on the wrong population. Leave them, normalise at display time, backfill, or
mark them. Not rewritten without asking.

✅ **`STEP_CHANGE` shipped in `breadth_freeze_audit.py`.** Fires when a metric in
`STEP_METRICS` (currently `universe_count`, 5%) moves more session-over-session
than the market can explain. On the stored history it finds **7 steps over 5%,
worst 2731→3711 (+35.9%) on 2026-05-26**.

Steps before `STEP_GATE_FROM = "2026-08-08"` print every run as context but do
not fail the gate — flagging the known pre-fix swaps forever would train whoever
reads it to ignore the detector, which is exactly how the 93-session NAAIM
freeze survived. They are never hidden. A NEW swap fails loudly, and a new step
beside old ones still fails (the worst step is chosen from the GATED set).
9 tests, 6/6 mutations killed. **Move the floor only when the history behind it
is actually repaired.**

---

### P1 — `cboe_putcall` history repair ✅ DONE (`22c42ff`)

Forward fix was `937d34d`. History repaired 2026-08-08 with a NEW flag,
**`--patch-cboe-date`** (an earlier draft of this plan named a `--backfill-cboe`
that never existed).

Measured over all 150 stored rows, not the 13-row sample: **78 of 86 checkable
sessions held the previous session's ratio**; 6 of the 8 "matches" were
coincidence (adjacent days printing the same number) and only 2026-07-09 and
2026-07-10 were genuinely right. The misdating **starts 2026-03-23** — everything
before that is correct.

Built as a **date lookup, never a shift**: a blind `shift(+1)` would have
corrupted the two days the collector got right. 86 rows changed, 64 already
correct, second dry run reports 150/150 correct.

Two things it surfaced:
- The date list must come from the SNAPSHOTS. The sibling patchers read
  `market_regimes`, which starts 2026-02-20 and carries weekend/holiday rows —
  it would have skipped 34 Jan/Feb snapshots and reported 12 phantom gaps.
- The 90-day history cap was a politeness budget, not a limit of the source
  (the CDN serves 2025-11-04 fine). It was capping the repair.

**P1b dissolved.** `breadth_score` is computed at READ time
(`breadth_monitor.py:274/319`) and never written by the collector, so re-dating
the input corrected the score automatically — verified on the canary
(2026-03-23: cboe 1.01→0.99, score recomputed to 41.6).

---

### P2 — Verify the remaining unverified metrics ✅ DONE

| metric | verdict |
|---|---|
| `uct_exposure` | 🔴 **FABRICATED on 33 sessions** — see below (`cc5e433`) |
| `ratio_5day`, `ratio_10day` | 🔴 **request-dependent** — see below (`a80b1ea1`) |
| `hi_ratio`, `lo_ratio` | ✅ denominator IS `universe_count`, not a constant |
| `atr_ext_7` | ✅ integer is correct — it is a COUNT (2–34), not a truncated ratio |
| `market_phase` | ✅ returns nothing rather than something when the table has no row |
| `is_ftd` / `manual_ftd` | ✅ sparse by design — 9 of 150, `manual_ftd` overrides 4 |
| `up_vol_ratio`, `hvc_52w` | ✅ 115 distinct values over 0.22–5.73; `hvc_52w` a count 0–163 |

**`uct_exposure` was fabricated.** `_fetch_uct_exposure` falls back to
`wire_data.json`, which holds TODAY'S live exposure with no date attached.
`market_regimes` begins 2026-02-20, so every backfilled date before that took
the fallback: **33 sessions from 2026-01-02 to 2026-02-19 all stored exactly
14.0**, and `_created_at` confirms all 33 were written in the same backfill run
on 2026-03-22. This metric drives position sizing. A request for a past date the
table has no record of now returns None, and the 34 unbacked rows are nulled —
there is no source to recover the true values from.

**A defect not in this plan: `get_history(days)` let the request change the
answer.** The derivation loop reaches backward past the row it computes (`w10` 9
rows, `qqq_day_pct` 1, the `is_ftd` drawdown window 15) but the fetch was
`LIMIT days`, so the same date returned different numbers per request. Measured
days=30 vs days=200 over their 30-day overlap: `ratio_5day` 4/30 (3.77 vs 1.16),
`ratio_10day` 9/30, `avg_10d_cpc` 8/30 (None vs 0.92 — a manufactured absence),
`breadth_score` 2/30, `adv_decline_cum` **30/30** (1538 vs 11640). `get_latest()`
calls `get_history(1)`, which made the most-read row the worst case. Fixed with
a 15-row warm-up prefix plus an absolute A/D seed; **verified live: 0
disagreements on all five fields.**

---

### P3 — Definitional decisions (owner input needed, not bugs)

1. **New highs/lows are CLOSING-basis.** `count_nd_highs` takes the rolling max
   of closes and counts `close >= max * 0.999`. NYSE/WSJ/Barchart publish
   **intraday**-basis, which is systematically higher. Internally consistent
   and the Stockbee convention — but not comparable to published NH/NL. Decide:
   keep, relabel in the UI, or add an intraday-basis variant.
2. **"Stage 2" is the MA stack only** (`price > SMA50 > SMA150 > SMA200`, SMA200
   ≥ 22 sessions ago). Minervini's full template also requires ≥30% above the
   52-week low, within 25% of the high, and an RS rating. Defensible
   simplification — decide whether to relabel or extend.
3. ~~**Cosmetic:** the slope test uses `>=` / `<=`.~~ ✅ **DONE** — tightened to
   strict `>` / `<` in all THREE copies (`c4c4ed4`, `23dde7cc`): collector
   `count_stage`, collector `list_stage`, and the dashboard live path. The two
   collector copies now share one `_stage_mask`, because a drift between the
   count and its drill list would surface as a modal disagreeing with the number
   the user clicked. The dashboard's `test_reference_matches_collector_source`
   AST-compares its mirrored copy and caught the refactor immediately.

Items 1 and 2 remain **owner decisions** and are deliberately not implemented.
Both definitions are now written down in `count_stage`'s docstring.

---

### P4 — NAAIM latency (owner: do NOT buy the subscription)

**Already solved and verified running:** the freeze bug, the poisoned history
(all 149 rows real), the paywall workaround via public chatter (blind backtest
9 correct / 0 wrong vs naive consensus 3/5), and the settle-polling job
("UCT NAAIM Settle", Thu+Fri 14:00 CT every 2h for 20h).

**Latency: SOURCES EXHAUSTED 2026-08-08. There is nothing left to find — the
publisher withdrew the data.**

| source | latest available | status |
|---|---|---|
| naaim.org public page/chart | 2026-04-29 | **three-month delay, stated policy on the page** |
| @NAAIM_Official on X | 2026-07-31 (79.70) | stopped — that post says "the LAST WEEK of free public access" |
| YCharts | 2026-07-29, updated 07-30 | feed stopped |
| MacroMicro | 2026-07-29 | feed stopped |
| CEIC | Jul 2026 | feed stopped |
| Barchart, TradingView, Yardeni, Nasdaq Data Link | — | 404/403, no series |
| StockCharts, isabelnet, naaim tag page | — | no dated readings |

The aggregators did not lag; they **lost the feed on 2026-08-01** along with
everyone else. YCharts even published on a Thursday 10:00 EDT schedule (~21h
post-survey) right up to the cutoff — that was a licensed feed, and it is gone.

**The reframe that matters:** even when it was free, @NAAIM_Official posted the
number on **Fridays**, ~48h after the Wednesday survey. The chatter route's +47h
median is already AT the speed of the fastest free channel that ever existed.
There was never a latency win available to find.

✅ Not a defect: `naaim_date` is correctly populated on every row, so a carried
79.7 is transparently attributed to the 2026-07-29 survey rather than passing as
current.

✅ **OWNER DECIDED 2026-08-08: accept the chatter route.** No subscription.

That made source SELECTION load-bearing, and ordering had quietly stopped being
safe: a frozen aggregator stays inside the 21-day staleness window for three
weeks after it stops, so anything ranked above chatter would have served a
value one survey behind while chatter carried the current week.

`_fetch_naaim` now asks **every** source and takes the **newest survey date**;
confidence only settles ties on the same date. New scrapers can be added
anywhere in the list without reasoning about precedence.

- **YCharts added** as a scraped, dated source (a named vendor outranks tweet
  consensus on ties). Frozen at 2026-07-29 today so it loses on recency; if
  licensing resumes it wins again on its own. **Verified live: YCharts and
  chatter independently corroborate at 79.70.**
- **The wire cache is a separate FALLBACK tier**, tried only when no live source
  answers. Its date means when it was *cached*, not the survey date — ranked
  together, a cache stamped today beats a survey from four days ago on every
  run, which is the cache permanently shadowing a live fetch. A pre-existing
  test caught this.
- **The source table holds NAMES, not function objects.** A tuple of references
  resolves at import and severs every source from
  `monkeypatch.setattr(bc, "_naaim_from_…")` — the same private-copy trap as
  `from module import fn`. Ten tests silently started hitting the live network
  (2.6s → 211s, one real 429) before it was switched to late binding.
- The log now separates **corroboration** from **CONFLICT** — two sources naming
  the same survey with different numbers is the only case worth a human's time.

⚠️ Guards that exist because the backtest produced a WRONG answer without them:
require decimals; exclude the prior week's value (21 accounts once "agreed" on
the wrong number); require ≥2 independent accounts; merge rounding variants;
strip urls/prices/years before matching. **A wrong number is worse than a
missing one — ambiguity must return None.**

---

### P5 — Ship ✅ DONE

1. ✅ Pushed `030e69bc..3d60525b` (Sat 2026-08-08 ~01:36 ET, window open, tape
   closed). Master had moved 43 commits — merged, re-verified, pushed. Never
   forced.
2. ✅ `vxmt` = 21.02 and `vix_term_structure` = 1.411 on 2026-08-07 — exactly the
   ~21.0 / ~1.41 predicted here. `iwm_close` filled (0 rows now missing it).
   `cboe_putcall` is date-correct on 150/150.
   ⚠️ These did NOT come from the scheduled run — they needed a source change.
   yfinance dropped the **whole CBOE index family** on 2026-07-17 (`^VIX6M`,
   `^VIX3M`, `^VIX9D`, `^VIX1D` all stop the same day; `^VXMT`/`^VXV` return
   nothing; plain `^VIX` keeps printing). The 6-month VIX now comes from CBOE's
   own CDN — `.../delayed_quotes/charts/historical/_VIX6M.json`, 4,679 bars back
   to 2008 — with yfinance as fallback.
3. ⏳ Wire writes `spy_dist_days` / `qqq_dist_days` on its next run (Mon 6:35 AM
   CT). State already holds exactly the predicted 2 SPY / 3 QQQ.
4. ✅ `breadth_freeze_audit.py --days 150` → **0 unexplained, exit 0**, first
   time ever. The 3 remaining findings are the documented known-ok ones.

⚠️ **The repair introduced a bug and the audit caught it the same hour.** The
first `--patch-rsp-vix3m` run used `.dropna().iloc[-1]`, which stamped 22.28
across 16 sessions. Re-running an old backfill after a source goes quiet is how
a walk-back gets written into history — check the audit after every repair, not
just before.

---

## 3. Tools available (use these, do not rebuild)

| tool | purpose |
|---|---|
| `uct-intelligence/scripts/breadth_freeze_audit.py` | CONSTANT / FROZEN / NULL_TAIL / ALL_NULL / MISSING. Exit 1 on unexplained. 19 tests. **Run it after every repair, not just before.** |
| `breadth_collector.py --patch-cboe-date` | re-date `cboe_putcall` by published date. Idempotent. `--limit N` for canary runs. |
| `breadth_collector.py --patch-exposure-gaps` | null `uct_exposure` where it was never measured; REPORTS the 72 disagreements without writing them. |
| `breadth_collector.py --patch-rsp-vix3m` | 6-month VIX (CBOE→yfinance), RSP/SPY, IWM/QQQ; fills `iwm_close` only where null. |

⚠️ `--patch-*` and `--backfill` runs now bypass the holiday guard — a repair of
past dates does not care whether the market is open today, and being gated there
sent it to a `SystemExit` that prints one line and vanishes.
| `tools/breadth_preset_check.py` | Clicks all 36 Data Charts presets in a browser, asserts **ink on the canvas**. |
| `tools/breadth_live_open_check.py` | Scheduled market-open checks (`--phase preopen/open/session`); also guards the dividend basis. |
| `tools/breadth_live_visual_check.py` | Serves local `app/dist`, proxies `/api` to production. |
| `GET /api/breadth-monitor/live/reconcile?date=&dividend_basis=` | Replays a past session; both bases in one process. **Expensive — space the calls out or it 502s the pod.** |
| `GET /api/breadth-monitor/live/dividends` | Dividend store health + `basis_enabled`. |

Scheduled: 4 breadth checks weekdays 8:08/8:38/8:44/9:34 CT; NAAIM settle
Thu+Fri; collector 3:15 PM CT; dividend sweep 4:40 ET.

---

## 4. Traps that cost time in this session

- **`railway variables --set` needs the value QUOTED** and `--service web`;
  unquoted it silently no-ops. It DOES auto-deploy.
- **Master moved 7, then 33, then 84 commits mid-ship.** Merge and push in one
  tight round-trip or the push is rejected non-fast-forward.
- **`reconcile` is expensive** — back-to-back calls 502/524 the single-process
  web pod.
- **yfinance dropped the entire CBOE index family on 2026-07-17**, not just one
  symbol: `^VIX6M`, `^VIX3M`, `^VIX9D`, `^VIX1D` all stop the same day, `^VXMT`
  and `^VXV` return nothing, `^CPC` is gone, and plain `^VIX` keeps printing.
  Chasing individual replacements treated a provider outage as a run of
  coincidences — **when one symbol dies, check its siblings before swapping it.**
  Prefer the exchange's own CDN. Check `rows == 0` rather than trusting a None.
- **A forward-fill at the display layer can undo a fix in the data layer.**
  `FFILL_KEYS` carried `cboe_putcall`, a DAILY series, so the one case it ever
  fired was an unpublished session — exactly the case the collector had just
  been changed to show as an honest gap. Two surfaces rendered yesterday's ratio
  as today's. Anything forward-filled must be genuinely weekly.
- **My own probes were wrong 6+ times** — `Number(null) === 0`, a 60-point
  downsample cap read as a dead sampler, `clock` read from a field the API never
  had, `window.echarts` not being global, `$?` after a pipe returning `tail`'s
  code. **Before reporting a defect from a script, confirm the field/limit
  exists in the code.**
- **CSS: a preset without `group` becomes a core pill**; all `pct_above_*` are
  toned NEUTRAL against a ramp of exactly 6, so a 7th series repeats a colour.
