# Breadth "current reading" — integration contract for the UCT Agent

Owner ruling, 2026-10-12. Breadth-side implementation: `api/services/breadth_current.py`.
Status: **local only, not deployed**. The Agent code is untouched. The Agent team wires this in
behind its own flag.

## Why

On Mon 2026-10-12 the Agent answered a present-tense question "as of October 8 close". Nothing
was missing:

- Oct 9 was collected on time (row stored 2026-10-09 20:21 UTC).
- Oct 9 was waiting, by design, for the next session's row. The V2 producer finalizes D only
  once the D+1 row exists (the "hindsight gate").
- Oct 12 was trading, and the live engine had a timestamped reading for US, NYSE and Nasdaq.

The finalized-only read was correct for history, and wrong for "now".

## The call

```python
from api.services import breadth_current
r = breadth_current.reading(universe, metric)   # universe: "us" | "nyse" | "nasdaq"
```

- It never computes inline. It reads the cached live payload, and a stale payload kicks a
  background refresh. It never raises.
- Diagnostic route (push-secret): `GET /api/breadth-monitor/current?universe=us&metric=pct_above_50sma`.

### Response

| field | meaning |
|---|---|
| `ok` | a reading exists |
| `value` | the reading (same number the member's chart shows) |
| `status` | `intraday` · `provisional` · `finalized` |
| `session` | the trading session the value belongs to |
| `observed_at` | ET timestamp of the live observation (`intraday` / `provisional` only) |
| `age_s` | seconds since `observed_at` |
| `current` | **True only if this is the reading a present-tense question means** |
| `stale_reason` | why not current (always set when `current` is False) |
| `label` | ready-to-show tag: `Intraday · 11:52 AM ET`, `Provisional close · Oct 9`, `Finalized close · Oct 8` |
| `expected_session` | the session "now" refers to (today once 09:30 ET has passed on a trading day, else the last completed session) |
| `market_open` | regular session in progress |
| `finalized_session` | newest finalized session for this measure |
| `population_drift` | live population vs canonical universe (≤ 5% to be used) |
| `accuracy_tier` | `validated` · `approximate` · `finalized_only` (below) |

### Status meanings

- **intraday**: today's session while it trades, measured by the live engine. It does not have
  to equal the eventual finalized value.
- **provisional**: a completed session measured from closing prices, not yet finalized. This
  covers today after 16:00 ET, and the previous session until its D+1 gate lands.
- **finalized**: the canonical value. It is what history, backtests and charts' sealed bars use.

## Rules the Agent applies

1. **Present-tense questions** ("now", "currently", "today", unqualified): call `reading()`.
   - If `current` is True, answer with `value` and show `label`.
   - No extra warnings are needed: "Intraday" plus the time is the disclosure.
2. **`current` is False**: never present the value as current. Say what it is (`label`) and
   that a live reading is unavailable. `stale_reason` is for logs, not members.
3. **Historical, backtesting and explicit closing questions** ("at Friday's close", "on
   Oct 8", "over the last month"): use the finalized store only, as today. Policy D5 is
   unchanged for these.
4. **Outside market hours**: `reading()` already prefers the latest completed session.
   - Provisional is labelled "Provisional close".
   - Finalized is labelled "Finalized close".
5. **One pipeline**: values come only from the existing live engine and the canonical store.
   The Agent must not recompute breadth.
6. **Model-data isolation is unchanged.** UCT-derived breadth values must not enter
   model-facing plans, history or chat naming. Whatever path the Agent uses today for
   finalized values governs these too.

## Accuracy tiers

The tiers come from a production replay on 2026-10-12. It took 20 sessions × US/NYSE/Nasdaq,
predicted each with the live method, and graded it against the session's finalized value.
The replay is read-only (`/api/breadth-monitor/live-universes/reconcile`).

| tier | measures | handling |
|---|---|---|
| `validated` | % above 5/10/20/40/50/100/150/200-day SMA; up/down 4% today; up/down 25% month and quarter; up/down 50% month; up/down 20% in 5 days; near 52-week high; 5/10-day ratios | Serve intraday/provisional normally. All passed (≤ 1 pt for percentages) in every universe. |
| `approximate` | advancing, declining, A−D, unchanged, magna up/down, stage 2/4 counts | Serve with the label. These drift by up to ~1.5% of the universe, so never quote them to the single name. |
| `finalized_only` | 52-week new highs/lows, net NH−NL, 20-day new highs/lows, hi/lo ratio; McClellan oscillator/summation; new all-time highs | `reading()` returns the finalized value with `current: False`. |

Notes on the `finalized_only` tier:

- **NH/NL family.** The replay grades the closing-price method, while live rows use the
  intraday high/low basis. This tier means "unproven", not "known wrong".
- **Promotion.** It can be promoted once a grade of provisional rows against their own
  finalized values (same NH/NL basis) passes.
- **McClellan.** There is no live reading for it by design.

## Timing the Agent should expect

| when (ET) | what `reading()` returns |
|---|---|
| trading day 09:30–16:00 | `intraday`, refreshed about every 55 s |
| 16:00 to the next 09:30 | `provisional` for today |
| D+1 ~16:30–20:30 | D becomes `finalized` once the D+1 row lands and the producer ticks |
| weekend / holiday | the last session, `provisional` until Monday's row finalizes it |

So the newest finalized session is normally **one session behind**. That is not a gap.
`GET /api/breadth-monitor/pipeline` shows each session's stage when in doubt.
