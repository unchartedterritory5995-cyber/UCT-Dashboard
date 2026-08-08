# Breadth data integrity — fix plan (2026-08-07)

Written to survive a context compaction. **This file is the source of truth for
what is done, what is not, and what to do next.** It assumes no memory of the
session that produced it.

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

### Committed but NOT deployed
| commit | repo | what |
|---|---|---|
| `498bb759` | dashboard | breadth_score renormalization |
| `a95e012b` | dashboard | 20 Data Charts presets + browser gate |
| `937d34d` | uct-intelligence | cboe date fix, `^VIX6M`, `iwm_close` |
| `d70baeb` | morning-wire | dist_days from state |
| `a6e2d10` | uct-intelligence | freeze audit: NULL_TAIL / ALL_NULL / MISSING |

⚠️ The dashboard commits are on `feat/breadth-live`, **not master**. The
collector/wire commits are local to their repos and take effect on the next
scheduled run (collector 3:15 PM CT weekdays; wire 6:35 AM CT).

⚠️ **Deploy window: web pushes only ≥4:20 PM ET or <9:15 AM ET**, enforced by
`.git/hooks/pre-push`. Master moves constantly from parallel sessions — always
`git fetch` → merge master INTO the branch → re-verify → push. **Never force.**

---

## 2. Work items, in priority order

### P0 — Universe bimodality (the biggest, and unstarted)

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

**Steps.**
1. Find every place the collector resolves its ticker list
   (`uct-intelligence/scripts/breadth_collector.py`). Identify the branch that
   yields ~3,700 vs ~2,700.
2. Determine which is *intended*. The stored `universe_list` drill payload per
   date is the evidence — diff a 3,700-day against a 2,700-day and characterise
   what the extra ~1,000 names are (micro caps? ETFs? OTC?).
3. Fix so one definition is used every day. Log the universe size and the
   branch taken on every run.
4. Add a guard: refuse to store a snapshot whose `universe_count` deviates
   >5% from the trailing median, or store it flagged. A silent 35% jump must
   become loud.
5. **History repair decision (ask the owner):** either backfill affected days
   under the canonical universe, or add a `universe_count`-normalised view so
   charts stop showing artifacts. Do not rewrite history without asking.
6. Extend `breadth_freeze_audit.py` with a STEP_CHANGE kind — a >5%
   session-over-session move in `universe_count` — so this can never run for
   months again.

**Verification.** Recompute a known step day both ways and show the count
metrics no longer jump. The 7/24→7/27 pair is the sharpest test case.

---

### P1 — `cboe_putcall` history repair

The forward fix is committed (`937d34d`): it now fetches a specific date and
returns None when unpublished, instead of walking back and stamping another
day's value as today's. **History is still misdated.**

Measured 2026-08-07: **12 of 13 sessions stored the previous session's ratio.**
The 13th only "matched" because two consecutive days both printed 0.91 — the
true rate is 13/13.

**Steps.**
1. Use the existing `--backfill-cboe` path (`breadth_collector.py` ~line 2780,
   `m["cboe_putcall"] = cboe_hist.get(date_str)`) which already keys by date.
2. **Dry run first**, diffing every date old vs new. Expect ~every row to shift
   by one session.
3. Canary 2 rows, verify, then full apply, then re-run the dry run — it must
   report 0 changes (idempotent). This is the sequence that worked for the
   NAAIM repair.
4. **`breadth_score` was computed FROM the shifted value** (10 of 100 points).
   After re-dating, recompute stored scores for affected rows — or accept and
   document the drift. Owner's call; flag it.

---

### P2 — Verify the remaining unverified metrics

Never independently checked. Same method that worked: compare against a
*different* provider or the upstream's own publication, not the feed that
produced the value.

| metric | why it matters | how to check |
|---|---|---|
| `uct_exposure` | 0–150, drives position sizing | pushed by the wire; recompute from its inputs and diff |
| `ratio_5day`, `ratio_10day` | 15 of 100 score points | derived in `get_history`; recompute by hand from up/down_4pct history |
| `hi_ratio`, `lo_ratio` | 10 score points | derived; confirm the denominator is universe_count and not a stale constant |
| `atr_ext_7` | in `froth` preset | integer-valued in storage — confirm that is intended, not truncation |
| `market_phase` | regime label | compare against the wire's own classification |
| `is_ftd` / `manual_ftd` | follow-through day | sparse by design; confirm the sparse path is deliberate |
| `up_vol_ratio`, `hvc_52w` | partial-session by design | confirm the EOD value settles correctly |

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
3. **Cosmetic:** the slope test uses `>=` for stage 2 and `<=` for stage 4, so a
   perfectly flat SMA200 satisfies both. Harmless today (the price/MA ordering
   conditions are mutually exclusive) but sloppy — tighten to `>` / `<`.

---

### P4 — NAAIM latency (owner: do NOT buy the subscription)

**Already solved and verified running:** the freeze bug, the poisoned history
(all 149 rows real), the paywall workaround via public chatter (blind backtest
9 correct / 0 wrong vs naive consensus 3/5), and the settle-polling job
("UCT NAAIM Settle", Thu+Fri 14:00 CT every 2h for 20h).

**Unsolved: latency.** Median +47h to first public mention, +57h to
corroboration. naaim.org's own free page states a three-month delay, so chatter
is the floor via that route.

Owner's direction: find it elsewhere via search + the Twitter API rather than
paying. Ideas not yet tried:
- Aggregators that may republish faster: MacroMicro, YCharts, CEIC, Koyfin.
- NAAIM member firms publishing the figure in their own weekly notes.
- Newsletter/RSS syndication that quotes it on publication day.
- Widening the X search beyond the current blanket query — **but note the
  window is deliberately capped at the 7-day publication cadence; widening it
  to +9d immediately returned the NEXT survey's number.**

⚠️ Guards that exist because the backtest produced a WRONG answer without them:
require decimals; exclude the prior week's value (21 accounts once "agreed" on
the wrong number); require ≥2 independent accounts; merge rounding variants;
strip urls/prices/years before matching. **A wrong number is worse than a
missing one — ambiguity must return None.**

---

### P5 — Ship what is already committed

1. Push `feat/breadth-live` to master (presets + breadth_score renormalization).
   Window ≥4:20 PM ET. Merge master in first; it moves constantly.
2. Confirm the collector fixes land on the next scheduled run: `vxmt` and
   `vix_term_structure` populate (expect ~21.0 and ~1.41), `iwm_close`
   populates (~301), `cboe_putcall` is either the correct date or null.
3. Confirm the wire fix writes `spy_dist_days` / `qqq_dist_days` (expect 2 / 3).
4. Re-run `python scripts/breadth_freeze_audit.py --days 150` — the three
   currently-unexplained findings should clear as the fixes take effect.

---

## 3. Tools available (use these, do not rebuild)

| tool | purpose |
|---|---|
| `uct-intelligence/scripts/breadth_freeze_audit.py` | CONSTANT / FROZEN / NULL_TAIL / ALL_NULL / MISSING. Exit 1 on unexplained. 19 tests. |
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
- **`^VXMT` and `^CPC` are both delisted from yfinance.** Assume any yfinance
  symbol can vanish; check `rows == 0` rather than trusting a None.
- **My own probes were wrong 6+ times** — `Number(null) === 0`, a 60-point
  downsample cap read as a dead sampler, `clock` read from a field the API never
  had, `window.echarts` not being global, `$?` after a pipe returning `tail`'s
  code. **Before reporting a defect from a script, confirm the field/limit
  exists in the code.**
- **CSS: a preset without `group` becomes a core pill**; all `pct_above_*` are
  toned NEUTRAL against a ramp of exactly 6, so a 7th series repeats a colour.
