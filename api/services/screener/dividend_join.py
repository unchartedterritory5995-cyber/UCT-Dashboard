"""Dividend-history join — cash actually paid, off `breadth_dividends.db`.

Two O(1) bounds probes plus ONE bulk windowed read per build, grouped in
Python. The query count is CONSTANT in the target list: `dividends` is
434,767 rows across 45,869 tickers (measured 2026-08-23) and a loop over
~3,700 targets would re-walk `ix_div_ex` once per symbol.

The screener carries `dividend_yield` and `payout_ratio` today, both from the
Finviz artifact, both point-in-time. It carries no ex-date, no trailing
dividend, no growth and no cadence. This reader adds the facts a PAYMENT
LEDGER can support and refuses the ones it cannot.

────────────────────────────────────────────────────────────────────────────
WHAT THIS STORE IS, MEASURED — NOT INHERITED
────────────────────────────────────────────────────────────────────────────

`breadth_dividends.db::dividends` is `(ticker TEXT, ex_date INTEGER YYYYMMDD,
cash REAL)`, PRIMARY KEY `(ticker, ex_date)`, one index on `ex_date`. Written
by `api/services/breadth_dividends.py::refresh()` — a daily paged sweep of the
vendor's dividend endpoint BY EX-DATE across the whole market, not per ticker.

Re-measured 2026-08-23 against the live artifact: 434,767 rows · 45,869
tickers · ex_date 20240601 → 20260810. Of `cap_universe.json` (3,742):
**2,022 covered · 1,845 with ≥4 payments · 661 with an ex-date ≥ 20260701.**
Do not re-type those numbers anywhere; the recipe is in the report beside this
module and every count below is derived at call time.

⛔⛔ **THE STORE IS STRUCTURALLY FORWARD-BLIND, AND THAT KILLS THE OBVIOUS
COLUMN.** `refresh()` requests `ex_dividend_date.lte=<today>` and its own
docstring says why: *"The vendor also returns ex-dates years into the FUTURE
(declared-but-unpaid), which must be dropped — a future dividend would scale
down history for an event that has not happened."* That is correct for the
back-adjustment this store exists to serve, and it means **there is no next
ex-dividend date in here at all.** Every row is at or before the sweep date.
So this reader emits *days SINCE the most recent ex-date* and never *days
until the next one* — an "upcoming ex-date" derived from this table would be
an extrapolation wearing a measurement's name. A company that STOPPED paying
therefore cannot read as "upcoming" here by construction; its last ex-date is
simply old, and `div_days_since_ex` says so out loud.

⛔ **AND A FORWARD EX-DATE ALREADY HAS A WRITER.**
`api/services/dividends_calendar.py` builds the forward (`date >= today`)
dividend calendar from yfinance for the Calendar surface. Even if this store
could answer, answering would be a second authority over one value — this
repo's most repeated defect. Two independent reasons; the column stays unbuilt
here.

⛔ **NO YIELD.** `dividend_yield` is owned by the Finviz artifact. This module
never divides by a price, never reads one, and emits no yield-shaped column.
The tension is real (a ledger-derived TTM yield would be fresher than a
scraped one) and it is recorded in the report, not resolved here.

⛔ **NO MULTI-YEAR STREAK, NO CAGR.** Coverage is ~26 months, which supports
exactly two comparable annual periods. A "consecutive years increasing" count
needs three. Refused, not approximated.

────────────────────────────────────────────────────────────────────────────
THE AS-OF IS DERIVED FROM THE DATA, NEVER FROM THE CLOCK
────────────────────────────────────────────────────────────────────────────

`as_of` = the newest ex_date in the whole store that is a real calendar day
(`_edge_date`, NOT a bare `MAX()` — see `_BOUND_PROBE`). Validated as a
freshness proxy rather than assumed: every recent business day in the artifact
carries 100-800 tickers going ex (20260810: 117, 20260807: 226, 20260803:
827), so the market-wide newest ex-date tracks the sweep date to within a
session or two.

**Every window in this module is anchored to `as_of`, not to today.** A store
that has not refreshed for a week then answers *correctly about the period it
covers* instead of answering wrongly about the present — the failure mode
`darkpool_agg` has and does not guard (it emitted `dp_notional_1d` for 482
tickers off a six-week-old session). The wall clock is read in exactly one
place, `_today()`, and only to decide whether to COUNT the store as stale or
REFUSE it outright. No emitted number can move when the clock moves; that is
deliberate and testable.

- age > `_STALE_DAYS` → served, and counted as `stale:<n>d`.
- age > `_MAX_STALE_DAYS` → `{}`, counted. Rationale, not a round number: the
  writer refreshes DAILY, so a store this old means the sweep has failed ~45
  times running. That is a broken pipeline, not a data condition, and by then
  the trailing-twelve-month window has drifted half a quarterly payment cycle
  away from the date `snapshot_date` claims.

────────────────────────────────────────────────────────────────────────────
ONE 24-MONTH WINDOW, AND WHY EVERY FACT SHARES IT
────────────────────────────────────────────────────────────────────────────

    prior window  = (as_of − 730d, as_of − 365d]
    ttm window    = (as_of − 365d, as_of]
    span          = the union — one bulk SELECT, one grouping pass

Cadence, the outlier median and both growth legs all read the same span, so no
two columns on a row can disagree about which period they describe.

`div_growth_1y_pct` additionally requires the STORE to cover the prior
window's start (`MIN(ex_date) <= prior_start`). Without that guard a store
whose history had been pruned short would count fewer prior-year payments than
actually occurred and manufacture growth out of missing rows. Measured today:
`MIN(ex_date)` 20240601 vs a prior-start of 20240810 — covered, with 70 days
of margin. When it is not covered the column is omitted for EVERY ticker and
the refusal is counted once, not fabricated per row.

────────────────────────────────────────────────────────────────────────────
⛔⛔ 0 AND ABSENT ARE DIFFERENT FACTS
────────────────────────────────────────────────────────────────────────────

A ticker with NO row in the 24-month span gets **no keys at all** and reads
NULL on every column downstream. A ticker WITH rows gets measurements — and
for a company that stopped paying, `div_ttm_cash` is a genuine `0.0` and
`div_payments_ttm` a genuine `0`, because the presence of its payment history
is the evidence that we looked. This is `pattern_join`'s flag distinction:
the confident negative is earned by having seen the symbol at all. 37 covered
`cap_universe` tickers sit in that lapsed state today.

`div_ttm_outlier` carries the same three-way: `1` = an anomalous payment is in
the TTM window · `0` = we had a reliable median and nothing is anomalous ·
ABSENT = fewer than `_MIN_OUTLIER_PAYMENTS` payments in the span, so there is
no median worth screening against.

────────────────────────────────────────────────────────────────────────────
THE TWO TRAPS, AND EXACTLY WHAT IS DONE ABOUT THEM
────────────────────────────────────────────────────────────────────────────

**1. A special dividend distorts TTM and growth.** The schema has no dividend
TYPE field — `(ticker, ex_date, cash)` is all there is — so a special can only
be inferred from magnitude. `div_ttm_cash` still reports the full sum: cash
paid is cash paid, and silently deleting a real payment would be inventing a
number. What changes is that the row SAYS SO (`div_ttm_outlier = 1`) and that
`div_growth_1y_pct` is REFUSED when an outlier sits in either window, because
year-over-year "growth" across a one-off is not a policy signal and a member
would read PGR's +187% (a $4.50 → $13.50 annual variable) as a dividend raise.
Measured: 109 covered tickers carry a ≥`_OUTLIER_MULT`× payment; 102 of them
have one inside a comparison window.

**2. 🔴 THE STORE IS NOT SPLIT-ADJUSTED — MEASURED, NOT SUSPECTED.** TSCO's
rows run `20240826 $1.10 · 20241125 $1.10 · 20250226 $0.23 · …` straight
through its 5:1 split. Raw vendor `cash_amount` is stored on whatever share
base was current at the ex-date, so a per-share year-over-year comparison
across a split is meaningless — and **a split and a dividend cut are
indistinguishable from this table alone.** The same magnitude gate that
catches specials catches these: TSCO's $1.10 is 4.7× its span median, so its
growth is refused. Measured today, of the 1,574 tickers where growth survives
every gate, **5 land within 1.5 points of a canonical split ratio and all
five are verifiable dividend CUTS, not splits** (DOW $0.70→$0.35, BCE, HUN,
BAX, PPC). A clean 2:1 split on an otherwise-flat dividend is the residual
hole the magnitude gate cannot see; closing it needs a split source this
module deliberately does not open. Recorded as a wiring requirement.

**Cut-to-zero is the one growth answer no artifact can fake.** When the TTM
window is empty and the prior window is not, `-100.0` ships regardless of
outliers: no split and no special takes a payer to zero.

────────────────────────────────────────────────────────────────────────────
FAILURE CONTRACT
────────────────────────────────────────────────────────────────────────────

Never raises into the build. A missing store, an absent table, a
`sqlite3.Error`, an empty table, or a refused-stale store all return `{}` with
a counted `_note(...)`. Malformed rows are dropped individually and counted —
including at the EDGES, which is the case a naive reader gets wrong: one
corrupt `ex_date` would otherwise become `MAX()` and take the whole source
down with it.
Per-ticker refusals (no history, growth gated) are counted too — an uncounted
refusal is indistinguishable from an empty answer, and only the RATIO tells a
dead source from a genuinely thin universe.

⚠️ Every emitted key is a literal subscript-assign on `row` — never a loop
over a name→value mapping. The scalar-population rail derives column writers
by AST over `d["col"] = v`; a dynamically-built mapping is invisible to it
(see `context_joins`' module docstring).
"""
from __future__ import annotations

import contextlib
import datetime
import math
import pathlib
import sqlite3
import statistics

# ── contract ─────────────────────────────────────────────────────────────

#: Served but counted past this; the store's writer refreshes daily.
_STALE_DAYS = 7
#: Refused entirely past this — see the module docstring for the derivation.
_MAX_STALE_DAYS = 45

_TTM_DAYS = 365
_SPAN_DAYS = 730

#: A cadence needs at least this many OBSERVED GAPS (so one more payment than
#: this). Below it the median spacing is not a schedule, it is a coincidence —
#: an annual payer inside a 24-month window has two payments and one gap, and
#: "annual" would be a guess.
_MIN_CADENCE_GAPS = 3

#: A payment at or above this multiple of the ticker's own span median is
#: anomalous: a special dividend, or an unadjusted share-base change. The
#: store cannot say which, so neither does the column name.
_OUTLIER_MULT = 3.0
#: No median is worth screening against below this many payments in the span.
_MIN_OUTLIER_PAYMENTS = 4

#: (label, min_days, max_days) over the MEDIAN observed gap. Anything outside
#: every band is `irregular` — which is an ANSWER, not a refusal: a stream with
#: four payments and no discernible rhythm genuinely has no cadence.
_CADENCE_BANDS = (
    ("monthly", 22, 45),
    ("quarterly", 70, 115),
    ("semiannual", 150, 225),
    ("annual", 300, 430),
)

#: How far in from each end of `ix_div_ex` to walk looking for a parseable
#: extreme. A bare `MIN()/MAX()` is NOT fail-soft here: SQLite orders TEXT
#: after every INTEGER, so ONE corrupt `ex_date` becomes the store's maximum,
#: fails to parse, and takes the entire source down — a single bad row must
#: degrade to "that row does not exist", never to "this store is unreadable".
#: This many unparseable extremes in a row IS a broken store, and then it does.
_BOUND_PROBE = 32

_SOURCE = "dividend_join"


# ── helpers ──────────────────────────────────────────────────────────────

def _note(failures, source, outcome) -> None:
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def _today() -> datetime.date:
    """The ONLY wall-clock read in this module, and it decides nothing that
    is emitted — only whether the store is counted stale or refused. Kept as
    a seam so a test can freeze it without half-faking anything else."""
    return datetime.date.today()


def _db_path() -> str:
    """The dividends store's location, from its OWNER.

    `breadth_dividends.DB_PATH` is the one authority on where this file
    lives (env `BREADTH_DIVIDENDS_DB`, default `/data/breadth_dividends.db`).
    Read at CALL time, never captured at import, so a monkeypatched attribute
    is honoured. Restating the literal here would be a second authority over
    one value.
    """
    from api.services import breadth_dividends
    return breadth_dividends.DB_PATH


def _connect(path: str) -> sqlite3.Connection:
    """Read-only URI connection. A seam so a test can count `execute` calls."""
    uri = pathlib.Path(path).resolve().as_uri() + "?mode=ro"
    return sqlite3.connect(uri, uri=True, timeout=30)


def _to_date(ymd) -> datetime.date | None:
    """`20260810` -> date, or None for anything that is not a real calendar
    day (month 13, day 32, a string, a float, None)."""
    try:
        n = int(ymd)
    except (TypeError, ValueError):
        return None
    try:
        return datetime.date(n // 10000, (n // 100) % 100, n % 100)
    except ValueError:
        return None


def _to_ymd(d: datetime.date) -> int:
    return d.year * 10000 + d.month * 100 + d.day


def _coerce(ticker, ex_date, cash):
    """One raw row -> `(TICKER, ex_ymd, cash)` or None.

    The schema declares all three NOT NULL; a reader that trusts a declaration
    is one hand-edit away from a crash inside the nightly build. A row that
    fails any check is dropped and counted, never defaulted.
    """
    if ticker is None:
        return None
    t = str(ticker).strip().upper()
    if not t:
        return None
    if _to_date(ex_date) is None:
        return None
    try:
        c = float(cash)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(c) or c <= 0:
        return None
    return t, int(ex_date), c


def _edge_date(conn, newest: bool) -> datetime.date | None:
    """The newest (or oldest) ex_date that is a REAL calendar day.

    Index-backed (`ix_div_ex`) and bounded at `_BOUND_PROBE` rows, so this is
    O(1)-ish rather than a table scan. See `_BOUND_PROBE` for why a plain
    `MAX(ex_date)` is the wrong instrument.
    """
    order = "DESC" if newest else "ASC"
    cur = conn.execute(
        "SELECT ex_date FROM dividends WHERE typeof(ex_date) = 'integer' "
        f"ORDER BY ex_date {order} LIMIT {_BOUND_PROBE}")
    for (value,) in cur:
        parsed = _to_date(value)
        if parsed is not None:
            return parsed
    return None


def _cadence(gaps) -> str:
    m = statistics.median(gaps)
    for label, lo, hi in _CADENCE_BANDS:
        if lo <= m <= hi:
            return label
    return "irregular"


# ── the entry point ──────────────────────────────────────────────────────

def read_dividend_fields(targets, failures=None) -> dict:
    """`{TICKER: {div_*}}` for every target with a payment on record.

    Emits, per ticker (see the module docstring for what each absence means):

        div_last_ex_date   TEXT  'YYYY-MM-DD', the NEWEST ex-date on record
        div_days_since_ex  INT   >= 0, as_of minus that date
        div_ttm_cash       REAL  >= 0, cash/share over the trailing 12 months
        div_payments_ttm   INT   >= 0, payments in that window
        div_growth_1y_pct  REAL  TTM vs prior TTM, gated (may be absent)
        div_frequency      TEXT  monthly|quarterly|semiannual|annual|irregular
        div_ttm_outlier    INT   0/1, an anomalous payment sits in the TTM window

    A ticker with no row in the 24-month span is ABSENT from the result — not
    a dict of zeros. A dead, empty or badly-stale store returns `{}`.
    """
    try:
        path = _db_path()
    except Exception as e:                              # noqa: BLE001
        _note(failures, _SOURCE, e)
        return {}

    try:
        with contextlib.closing(_connect(path)) as conn:
            as_of = _edge_date(conn, newest=True)
            cover_from = _edge_date(conn, newest=False)
            if as_of is None or cover_from is None:
                # Either the table is empty or its whole leading/trailing edge
                # is garbage. Both are "this source cannot answer"; the ratio
                # of this counter to the build's ticker count tells them apart.
                _note(failures, _SOURCE, "empty")
                return {}

            age = (_today() - as_of).days
            if age > _MAX_STALE_DAYS:
                # A daily sweep that has missed ~45 runs is a broken pipeline.
                # Serving a TTM window half a payment cycle from the present
                # under a `snapshot_date` as-of would be the darkpool_agg trap.
                _note(failures, _SOURCE, f"stale_refused:{age}d")
                return {}
            if age > _STALE_DAYS:
                _note(failures, _SOURCE, f"stale:{age}d")

            as_of_ymd = _to_ymd(as_of)
            ttm_start_ymd = _to_ymd(as_of - datetime.timedelta(days=_TTM_DAYS))
            span_start_ymd = _to_ymd(as_of - datetime.timedelta(days=_SPAN_DAYS))

            # ONE bulk read of the whole span for the whole market, filtered
            # to the target set in Python — the shape `breadth_dividends._load`
            # already uses, and the shape that survives a 3,742-symbol target
            # list without touching SQLite's bound-variable ceiling.
            rows = conn.execute(
                "SELECT ticker, ex_date, cash FROM dividends "
                "WHERE ex_date > ? AND ex_date <= ?",
                (span_start_ymd, as_of_ymd)).fetchall()
    except sqlite3.Error as e:
        _note(failures, _SOURCE, e)
        return {}
    except Exception as e:                              # noqa: BLE001
        _note(failures, _SOURCE, e)
        return {}

    want = {str(t).strip().upper() for t in (targets or ()) if str(t).strip()}
    if not want:
        return {}

    by_ticker: dict = {}
    for raw in rows:
        rec = _coerce(raw[0], raw[1], raw[2])
        if rec is None:
            _note(failures, _SOURCE, "malformed_row")
            continue
        t, ex, cash = rec
        if t in want:
            by_ticker.setdefault(t, []).append((ex, cash))

    if not by_ticker:
        # The store answered and not one target is in it. That is a real
        # (if extreme) answer for a universe of non-payers, but it is also
        # exactly what a wrong-universe join looks like — count it.
        _note(failures, _SOURCE, "no_targets_covered")
        return {}

    # Coverage gate for the prior-year leg, decided ONCE for the whole build:
    # a store pruned shorter than the prior window would undercount last
    # year's payments and manufacture growth out of missing rows.
    growth_covered = _to_ymd(cover_from) <= span_start_ymd
    if not growth_covered:
        _note(failures, _SOURCE, "growth_uncovered")

    out: dict = {}
    for t in want:
        events = by_ticker.get(t)
        if not events:
            # No payment on record in the span. Absent, never zeroed — see the
            # module docstring. Counted so a dead source and a universe of
            # non-payers can be told apart by ratio.
            _note(failures, _SOURCE, "no_history")
            continue
        events.sort()
        row: dict = {}

        last_ymd = events[-1][0]
        last_date = _to_date(last_ymd)
        row["div_last_ex_date"] = last_date.isoformat()
        row["div_days_since_ex"] = (as_of - last_date).days

        current = [e for e in events if e[0] > ttm_start_ymd]
        prior = [e for e in events if e[0] <= ttm_start_ymd]
        ttm_sum = sum(c for _, c in current)
        prior_sum = sum(c for _, c in prior)
        row["div_ttm_cash"] = round(ttm_sum, 6)
        row["div_payments_ttm"] = len(current)

        # Magnitude anomaly: a special dividend OR an unadjusted split. The
        # store has no type field and no split factor, so the column refuses
        # to name a cause. Absent (not 0) when the history is too thin for a
        # median to mean anything.
        outlier_dates: set | None = None
        if len(events) >= _MIN_OUTLIER_PAYMENTS:
            median_cash = statistics.median([c for _, c in events])
            if median_cash > 0:
                outlier_dates = {ex for ex, c in events
                                 if c >= _OUTLIER_MULT * median_cash}
                row["div_ttm_outlier"] = \
                    1 if any(ex in outlier_dates for ex, _ in current) else 0

        if len(events) > _MIN_CADENCE_GAPS:
            dates = [_to_date(ex) for ex, _ in events]
            gaps = [(dates[i + 1] - dates[i]).days
                    for i in range(len(dates) - 1)]
            row["div_frequency"] = _cadence(gaps)

        # Growth, in refusal order. Each branch omits the key and counts why;
        # none of them substitutes a number.
        if not growth_covered:
            pass                                    # already counted, once
        elif prior_sum <= 0:
            # No prior-year payment to compare against: a new or reinstated
            # payer. An infinite/undefined ratio is not a growth rate.
            _note(failures, _SOURCE, "growth_no_prior")
        elif not current:
            # Cut to zero. Airtight: no split and no special takes a payer to
            # nothing, so this one survives every other gate.
            row["div_growth_1y_pct"] = -100.0
        elif outlier_dates and any(ex in outlier_dates
                                   for ex, _ in current + prior):
            _note(failures, _SOURCE, "growth_outlier_in_window")
        elif len(current) != len(prior):
            # Different payment COUNTS in the two windows: an ex-date that
            # drifted across the boundary, or a cadence change. Either way the
            # sum ratio is a calendar artifact, not a policy signal.
            _note(failures, _SOURCE, "growth_count_mismatch")
        else:
            row["div_growth_1y_pct"] = round((ttm_sum / prior_sum - 1.0) * 100.0, 4)

        out[t] = row
    return out
