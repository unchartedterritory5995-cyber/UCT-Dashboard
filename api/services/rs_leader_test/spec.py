"""The Leader score test's specification: every number, named, fixed in advance.

PRE-REGISTERED 2026-11-14 (plan ``2026-11-14-uct-rs-screens-plan-v2.md`` section 8;
the quant review in ``REVIEWS-SUMMARY.md``). The test was written before any result
existed. A number here does not change in place: a different horizon, floor, block
or bar is a NEW dated specification with its own record, never an edit to this one
after a run has been read.

The qualifier gate's numbers are WRITTEN here, not read from the live starter
(``rs_screens.leaders``): a later change to the screen a member sees must not move a
test that was fixed on this date. ``tests/test_rs_screens_u9_harness_stats.py`` holds
the two equal today and says what a difference means.

Pure constants: no I/O.
"""
from __future__ import annotations

import math

PREREGISTERED = "2026-11-14"

# ── data ─────────────────────────────────────────────────────────────────────
#: The newest stored rating sessions the harness refuses to read without
#: ``--unlock-holdout``.
HOLDOUT_SESSIONS = 252
#: Every fifth stored session is a formation date, counted from the oldest.
FORMATION_STEP = 5
#: The benchmark of the RS line, of the SPY baseline and of the market split.
BENCHMARK = "SPY"
#: Calendar days of bars read before the first formation date: enough for a year of
#: sessions twice over, so every lookback below is full and the smoothed averages
#: (the RS line's EMA, the true range) have settled.
WARMUP_CALENDAR_DAYS = 800

# ── the universe on a formation date (from bars as of that date) ─────────────
UNIVERSE_MIN_PRICE = 10.0
UNIVERSE_MIN_DOLLAR_VOLUME = 20_000_000.0
#: Sessions in the average volume behind the dollar-volume floor (the screener's
#: ``dollar_vol_30d``: the close times the mean volume of the last 30 sessions).
DOLLAR_VOLUME_SESSIONS = 30
#: Bars the current listing must hold, the formation date included.
MIN_LISTING_BARS = 253
#: The Group part's "1-month change": the close against the close this many sessions
#: back (the screener's ``chg_pct_1m``).
GROUP_CHANGE_SESSIONS = 21

# ── the qualifiers: the UCT RS Leaders gate, point in time ───────────────────
GATE_MIN_RATING = 80
GATE_MIN_ADR_PCT = 3.0
ADR_SESSIONS = 21
TREND_AVERAGE_SESSIONS = 200
TREND_RISING_SESSIONS = 20
HIGH_SESSIONS = 252
GATE_MAX_BELOW_HIGH_PCT = -25.0
RS_LINE_EMA_SESSIONS = 21
#: Fewer scored qualifiers than this on a date and the date is skipped.
MIN_QUALIFIERS = 25

# ── portfolios and returns ───────────────────────────────────────────────────
QUANTILES = 5
TOP_N = 50
#: Exit at the close this many sessions after the formation date; entry is always the
#: next session's open.
HORIZONS = (5, 10, 21, 63)
PRIMARY_HORIZON = 21
#: Taken off every position a formed portfolio holds, in percentage points. A
#: baseline is a yardstick, not a trade, and is not charged.
ROUND_TRIP_COST_PCT = 0.2
#: The primary baseline's daily-range floor (equal-weight liquid names at or above it).
BASELINE_MIN_ADR_PCT = 3.0

# ── inference ────────────────────────────────────────────────────────────────
BOOTSTRAP_BLOCK_SESSIONS = 63
BOOTSTRAP_DRAWS = 2000
BOOTSTRAP_INTERVAL = 0.90
BOOTSTRAP_SEED = 20261114
#: The block in formation dates: 63 sessions at one date every 5 is 13 dates.
BOOTSTRAP_BLOCK_DATES = math.ceil(BOOTSTRAP_BLOCK_SESSIONS / FORMATION_STEP)

# ── the pass rule ────────────────────────────────────────────────────────────
YEARS_COMPARED = 4
YEARS_POSITIVE_MIN = 3
YEAR_MIN_FORMATION_DATES = 20
SPEARMAN_MIN = 0.8

# ── leave one part out (a report; the harness never changes a weight) ────────
LEAVE_ONE_OUT_MIN_GAIN_PCT = 0.25
LEAVE_ONE_OUT_YEARS_MIN = 3

# ── descriptive extras ───────────────────────────────────────────────────────
EXCURSION_HORIZONS = (10, 21)
#: "Extended": this many average true ranges above the 50-day average.
EXTENDED_ATR_MULTIPLE = 4.0
EXTENDED_AVERAGE_SESSIONS = 50
ATR_SESSIONS = 14
REGIME_AVERAGE_SESSIONS = 200

#: Printed with every verdict, word for word.
CAVEAT = ("Universe as held: stocks that later delisted are missing, which flatters "
          "every number here.")

#: What the stored data cannot give a point-in-time gate, said in the output.
GATE_OMISSIONS = (
    "market cap $300M+ (no share count history is stored)",
    "the buyout-pending exclusion (the Setup flag is not stored per session)",
)


def as_dict() -> dict:
    """Every constant above, for the output file."""
    return {k: (list(v) if isinstance(v, tuple) else v)
            for k, v in sorted(globals().items())
            if k.isupper() and isinstance(v, (int, float, str, tuple))}
