"""Evaluate one scan definition across the universe. SEQUENTIAL, LOCAL, OFF THE
REQUEST PATH.

⭐ MODELLED ON `screener/snapshot_builder`, NOT ON `rs_ranking`. `snapshot_builder`
reads `bars_sqlite.get_bars(t,"D",400)` -- local, no network -- which is why a
4,000-ticker fully sequential nightly build is affordable, and it is one of only
TWO jobs in the survey that counts AND logs per-symbol failures (`{built, skipped,
errors}`). `rs_ranking`'s 12 workers work only because it is I/O-bound on network
fetches.

⛔⛔ THREADS ARE FORBIDDEN, AND THE REASON IS THE CORRECTNESS GUARANTEE ITSELF.
MEASURED (GT §2.4, LOCAL): 400 symbols x 400 bars, worst-case corpus AST
(`stdev_band`), CPython 3.14.0 with `sys._is_gil_enabled() -> True`:

    serial          613 ms   (1.533 ms/sym)
    ThreadPool( 4)  615 ms   speedup x1.00
    ThreadPool( 8)  981 ms   speedup x0.62
    ThreadPool(16) 1123 ms   speedup x0.55

Zero at 4, actively NEGATIVE at 8 and 16. `ast_interpret`'s own docstring says
why: 'PLAIN LOOPS, NOT NUMPY ... numpy changes summation order, and a 1e-9 equality
across two languages only holds if the accumulations happen in the same order.'
THE 1e-9 CROSS-LANE GUARANTEE IS WHAT MAKES THIS GIL-BOUND. The thing that makes a
user's alert fire the same way on the server and on their chart is the same thing
that makes the sweep un-parallelisable, and buying throughput here would be
spending the guarantee. Process-level parallelism is the only real option and the
web pod is deliberately single-process (in-process SSE state) -- an architectural
constraint, not a tuning knob.

⛔ A MEMBER REQUEST NEVER TRIGGERS AN EVALUATION. Not bounded on the request path
-- ABSENT from it. `/confluence-scan`'s four bounds (`_DPC_SCAN_BUDGET_S = 10.0`
wall clock, `_DPC_COLD_LANE_SLOTS = 2` of 64 ~ 3%, `_DPC_COLD_PACE_S = 0.25`,
`_DPC_WARM_PACE_S = 1.0` background warmer) are the template for the BACKGROUND
lane's manners; they are not a licence to run this in a handler.

⭐ COST, MEASURED (GT §2.3, LOCAL, warm 2.5 GB bars.db on NVMe): one median user
AST over 3,742 symbols ~5.4 s serial, worst-case corpus AST ~8.1 s, one native
(RSI) ~2.3 s; `get_bars(D,400)` median 0.84 ms, end-to-end get_bars+rsi median
0.608 ms. ⚠️ Railway's `/data` is a NETWORK-ATTACHED VOLUME and I/O will be worse
there by an UNMEASURED factor. The relative finding (compute is not the
bottleneck; threads do not help) is a property of the code and does transfer.

───────────────────────────────────────────────────────────────────────────────
🔴 THE SWEEP IS BOUNDED BY THE MARKET OPEN, AND STOPPING EARLY IS REPORTED.

RE-MEASURED 2026-08-09 on this box rather than quoted: `close > sma(close,50)`
over the real 3,742-symbol universe against the real 2.6 GB `bars.db` is
**42.4 s of COMPUTE ALONE** (11.3 ms/symbol; 43% bars read, 57% interpret), with
other agents resident. The performance audit measured **23.5 s** warm on the same
box hours earlier and the COST paragraph above quotes **5.4 s** from an idle one.
Add the audit's measured **19-26 s** of `definition_record` writes on a
definition's FIRST sweep and one definition costs **~25-70 s**.

⭐ THE SPREAD BETWEEN THOSE THREE NUMBERS IS THE WHOLE ARGUMENT FOR A CLOCK
RATHER THAN A DEFINITION CAP. A count that is safe on an idle box is not safe on
a contended one and neither number transfers to Railway's network-attached
`/data`; a wall clock is right on every box because it measures the thing that
actually matters.

    10 definitions   ~4-12 min     done long before the open
    100              ~42-117 min   into the pre-market
    500              3.5-10 hours  🔴 STRAIGHT THROUGH THE OPEN

⛔ `max_instances=1` PREVENTS OVERLAP AND DOES NOT PREVENT OVERRUN, and nothing
else noticed the crossing. So `run_sweep` — the only thing that knows how long it
has been running — stops STARTING definitions at `sweep_deadline()`, which is the
market open MINUS `SWEEP_STOP_BEFORE_OPEN` and is DERIVED, never typed.

⛔ THE CHECK IS BETWEEN DEFINITIONS, NEVER INSIDE THE PER-SYMBOL LOOP. A
mid-definition abort would leave a `scan_coverage` row describing a partial
universe as though it were complete — indistinguishable from a quiet market,
which is the one reading E-2's three-state design exists to keep impossible. A
definition is swept or it is not, so the worst-case overrun is exactly ONE
definition and the margin is sized for it.

⛔ AND `unswept` IS A FIFTH OUTCOME AT THE SWEEP'S OWN GRAIN, NOT A SIXTH SYMBOL
OUTCOME. The four below describe one definition's universe; `unswept` describes
DEFINITIONS. It is not `dropped` (we tried and failed — re-run them), not
`not_computable` (it ran and the maths had nothing to say), and not `withheld`
(your plan stops here). "We ran out of night" is its own fact, it is fixed by a
different action — start earlier, or thin the list — and folding it into any of
the other four would make a truncated sweep read as a broken one.

⭐ AND THE TAIL IS NOT ABANDONED. A budget that always cuts at the same point
starves the same definitions forever, so the order is DERIVED FROM THE ARTIFACT
rather than remembered in a cursor: a definition carrying no `scan_coverage` row
for the PREVIOUS session leads this run. No new state, nothing to lose on a
redeploy, and it cannot go stale the way a stored cursor can — it reads the
receipts the last run actually wrote.

───────────────────────────────────────────────────────────────────────────────
🔴 FOUR OUTCOMES, NOT TWO, AND THE RECEIPT CARRIES ALL FOUR.

    evaluated       we looked at it -- the closed identity's left-hand side
      answered      it ran and the answer is real
      not_computable  it ran and the maths had nothing to say
      dropped       we tried and failed; here they are, re-run them
    withheld        the member's plan stops here -- NEVER a drop

⛔ `withheld` IS NOT `dropped` AND IT IS NOT IN THE IDENTITY. Dropped means "we
tried and failed"; withheld means "your plan stops here". Fold either into the
other and a capped screen reads as broken while a broken one reads as capped, and
a trader acts on the difference. `withheld` sits OUTSIDE
`evaluated == answered + dropped + not_computable` because a withheld symbol was
never looked at -- putting it inside would make the identity a statement about
billing.

🔴 AND `not_computable` IS DETECTED, NOT HOPED FOR.
`ast_interpret.unresolved_scalars(tree, row)` is called and the symbol is DROPPED
FROM EVALUATION BEFORE `interpret` ever sees it, because E-1 measured that
`interpret(market_cap > 1e9)` on a symbol with **no market cap returns `0.0`, not
`None`** -- `_cmp` answers 0 against NaN, and that rule is pinned by 17 frozen
conformance digests, so it is not changing. Without this call *"failed the filter"*
and *"we had no data"* are the same value at the top of the tree, and at universe
scale that is a screen silently dropping symbols and looking like a quiet market.
"""
from __future__ import annotations

import contextlib
import datetime
import logging
import math
import os
from typing import Any, Mapping, Optional, Sequence
from zoneinfo import ZoneInfo

from api.services import ast_freshness
from api.services import ast_interpret
from api.services import ast_table
from api.services import definition_record
from api.services import scan_definition
from api.services.screener import scan_store
from api.services.screener import snapshot_builder
from api.services.screener import snapshot_db
from api.services.signature import ledger

log = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# the closed vocabularies
# --------------------------------------------------------------------------- #

#: Why a WHOLE RUN refused. Closed, like `scan_definition.GATES`, so a caller can
#: branch on it and know the branch list is finite.
#:
#: ⭐ THE LAST TWO ARE THE LIVE MODE'S, AND BOTH ARE FACTS ABOUT THE WHOLE RUN
#: rather than about any symbol: `tf` — the live sweep evaluates the daily
#: timeframe only in Wave 1 — and `cadence`, a tree whose scalars declare a
#: NIGHTLY ceiling, which no schedule can lift (`cadence_ceiling`).
RUN_GATES = ("snapshot-stale", "no-definition", "not-scannable", "no-universe",
             "tf", "cadence")

#: Why ONE symbol was tried and failed. Each is a fact about that symbol, and
#: every one of them is re-runnable: fix the bars, rebuild the snapshot, run again.
#:
#:   no-live-quote -- the feed refused this symbol; `detail` carries one of
#:                    `live_tier.SKIP_REASONS` VERBATIM rather than a second
#:                    spelling of it. ⛔ THAT TUPLE'S WORDS ARE NOT RE-TYPED HERE:
#:                    that tuple is the declaration, this is a pointer to it, and
#:                    `test_a_quote_the_live_tier_would_refuse_is_refused_HERE_
#:                    with_ITS_reason` asserts the forwarded word is a MEMBER of
#:                    it. Re-runnable NEXT TICK -- five minutes, not tonight,
#:                    which is what makes it a drop and not a refusal.
DROP_REASONS = ("no-bars", "stale-bars", "no-screener-row", "refused", "no-live-quote")

#: ⛔ ITS OWN BUCKET, controller resolution 5. "We could not compute it at the last
#: confirmed bar" is not "something broke", and a member reading one number for
#: both cannot tell a short-history universe from a failing one.
NOT_COMPUTABLE_REASON = "not-computable"

#: Why a symbol was never looked at. ⚠️ E-7 owns the entitlement axes and the
#: numbers; E-3 owns the WORD, so the sweep and the coverage line cannot end up
#: with two spellings of one fact.
#:
#: ⛔ `toolkit:history` IS A REFUSAL, NEVER A TRIM, AND THAT IS WHY IT IS A
#: WITHHOLDING. E-7 measured `ema(close,20)` at 15.269399733598789 over 400 bars
#: and 15.269384587868412 over the last 120 — two different indicators under one
#: name, and `pytest.approx`'s default `rel=1e-6` calls them EQUAL, so a trim
#: fails the obvious test. Spec §1.4 gates BREADTH, never MECHANICS: a plan may
#: say "you may not ask about that much of the past", it may not answer the same
#: question with a worse number. See `entitlements.apply_history_cap`, whose two
#: outcomes are the bars UNCHANGED or this reason.
SYMBOLS_WITHHELD = "toolkit:symbols"
HISTORY_WITHHELD = "toolkit:history"
WITHHELD_REASONS = (SYMBOLS_WITHHELD, HISTORY_WITHHELD)

#: Why a whole DEFINITION was never swept. ⛔ ITS OWN WORD AT ITS OWN GRAIN — see
#: the module header. `dropped`/`not_computable`/`withheld` are facts about a
#: SYMBOL inside one definition's run; this is a fact about the RUN, and the
#: action that fixes it is different from all three.
UNSWEPT_REASON = "budget:market-open"

#: `_DPC_WARM_MAX_QUEUE`'s shape: a bounded list beside a true count. ⚠️ THE
#: COUNTS ARE NEVER CAPPED; only the enumeration is, and `truncated` says so.
#: ⛔ ONE BOUND FOR EVERY SUCH LIST IN THIS MODULE -- `dropped_symbols` and
#: `unswept_definitions` share it rather than declaring a second number, because
#: two names for one bound is two things to keep true.
#: E-2 measured `scan_coverage` at 4,194 B/row with a 41-symbol `dropped_json`
#: -- an unbounded list inside a stored row is how a receipt becomes the thing
#: that fills the disk.
_DROPPED_LISTED_MAX = 200

#: The bars window, matching `snapshot_builder._read_daily_bars`. Widened only
#: when the TREE says it needs more -- `max_lookback` is the tree's own
#: declaration and the same number the repaint linter and the budget read.
_MIN_BARS = 400
_MAX_BARS = 5000

#: ⏳ OWNER -- design §8.5, and it is LESS OPEN THAN IT LOOKS. The sweep lands at a
#: fixed hour AFTER the 03:00 ET snapshot build; WHICH hour is the owner's.
#: ⛔ ONE PLACE. Spreading this constant is how a schedule acquires a second
#: authority.
#:
#: ⭐ BUT "WHETHER AN INTRADAY CADENCE IS WANTED" IS ALREADY ANSWERED PER TREE, AND
#: THE ANSWER IS DERIVED, NOT SET HERE. Measured over the manifest 2026-08-09, all
#: 54 declared scalars are unanimous: `cadence: nightly`, `store: screener_rows`,
#: `grain: date`. So a scan naming ANY scalar has a NIGHTLY ceiling no schedule can
#: lift -- re-running it at noon re-reads the same 03:00 snapshot. A bars-only scan
#: has no such ceiling. `cadence_ceiling(tree)` reads that off the manifest's own
#: declarations, so a fifty-fifth scalar with a different cadence moves the answer
#: with no edit here. ⛔ NOTHING HAND-LISTS WHICH SCALARS ARE NIGHTLY.
SWEEP_HOUR_ET = 5
SWEEP_MINUTE_ET = 0

#: The bars-store timeframe this sweep defaults to. `scan_store` keys on the CODE
#: (`D`); `definition_record` keys on the PRODUCT LABEL (`1D`). Both spellings are
#: DERIVED from `ledger._BARS_STORE_TF_KEYS`, never typed here, so a ninth
#: timeframe is accepted the day the map declares it.
DEFAULT_TF = "D"

#: The three ways `evaluate_one` may be asked to run — ONE parameter, the single
#: authority over what a run WRITES (contract ruling 8/25, lane W4a.1). ⛔ CLOSED,
#: like `RUN_GATES`: a caller branches on it, and a mode nobody declared refuses
#: rather than quietly behaving as one of these.
#:
#:   nightly    the sweep. Files `scan_hits`, `scan_coverage` and the rule record.
#:   live       the five-minute intraday cycle (spec §5.5, lane W4b.3). Evaluates
#:              on the FORMING bar and writes `scan_hits_live` — and only that.
#:              ⛔⛔ NEVER A NIGHTLY TABLE. A forming-bar answer filed into
#:              `scan_coverage` would record it as that session's CLOSED-bar
#:              coverage: a second authority over what this session's screen said,
#:              which is the exact defect the two-table split exists to prevent.
#:              The rail is `tests/test_scan_live_sweep.py::test_NO_function_
#:              reachable_under_mode_LIVE_calls_a_NIGHTLY_WRITER`, whose offender
#:              set is DERIVED from `scan_store`'s and `definition_record`'s own
#:              table constants and which carries a planted-offender control.
#:   on-demand  a member's run-now (W4a, spec §5.5): the SAME loop, the SAME four
#:              outcomes, the SAME hash — and NOTHING written.
MODES = ("nightly", "live", "on-demand")
NIGHTLY, LIVE, ON_DEMAND = MODES

#: The name lane W4a shipped, pointing at the SAME OBJECT rather than re-typed.
#: Two tuples spelling one closed set is two things to keep true.
EVALUATE_MODES = MODES

#: ⏰ THE ONLY NUMBER THE BUDGET DECLARES — how long before the regular session
#: opens the sweep must have stopped starting definitions. ⛔ THE OPEN ITSELF IS
#: NOT A NUMBER HERE: `market_open_et` derives it from the bars store's own
#: canonical session anchor, so a schedule change on the exchange moves this
#: deadline with no edit in this file. Spelling 09:30 beside that derivation
#: would be a second authority over the one fact the deadline hangs on.
#:
#: ⭐ THE SIZE IS THE MEASURED WORST-CASE OVERRUN, NOT A ROUND NUMBER. The check
#: is between definitions, so the sweep can overrun its deadline by at most ONE
#: definition — re-measured on this box at 42.4 s of compute plus the audit's
#: 19-26 s of first-sweep writes, call it ~70 s, and Railway's network-attached
#: `/data` is worse by a factor nobody has measured. 30 minutes is ~25x that
#: worst case, which is the right shape of margin for a bound whose whole job is
#: to be wrong in the safe direction.
SWEEP_STOP_BEFORE_OPEN = datetime.timedelta(minutes=30)

#: ⏰ THE REGULAR SESSION'S LENGTH, DECLARED ONCE — the live cycle's window is
#: `market_open_et(day)` (DERIVED from the bars store's own anchor) through that
#: open PLUS this, half-open at both ends.
#:
#: ⚠️ THE REPO ALREADY TYPES 16:00 IN TWO PLACES — `massive._detect_session` and
#: `bars_fetch._is_market_open` — and neither is called here, because each reads
#: its OWN clock and this module has exactly one (`_now_et`). Two clocks would put
#: a cycle inside the session by one and outside it by the other at the boundary
#: minute. `test_the_live_window_AGREES_with_bars_fetch_is_market_open_at_BOTH_
#: boundaries` drives the other one's clock to the same four instants and demands
#: the same answer, so the three stay consistent without a second authority.
REGULAR_SESSION_LENGTH = datetime.timedelta(hours=6, minutes=30)

#: ⭐ THE MEASURED WORST CASE FOR ONE DEFINITION, ROUNDED UP. 42.4 s of compute
#: for `close > sma(close,50)` over 3,742 symbols on this box, contended (module
#: header). The live mode writes no rule record, so the audit's 19-26 s of
#: first-sweep writes do not apply — 60 s is ~1.4x, which is the right shape of
#: margin for a bound whose job is to be wrong in the safe direction.
#: ⛔ IT IS SUBTRACTED FROM THE INTERVAL, NEVER ADDED TO A DEADLINE: the check is
#: BETWEEN definitions, so a cycle overruns by at most one definition and the
#: next tick must still find the slot free.
LIVE_DEFINITION_WORST_CASE_S = 60

#: Why a whole LIVE CYCLE did not sweep everything it was handed. ⛔ ITS OWN WORD,
#: NOT `UNSWEPT_REASON`: "we ran out of the five-minute interval" and "we ran out
#: of night" are different facts fixed by different actions, and one word for both
#: would hide which bound fired.
LIVE_UNSWEPT_REASON = "budget:live-interval"

#: Every word a live cycle can answer `skipped_reason` with. Closed, like
#: `RUN_GATES`: a caller branches on it, and a status surface that met a seventh
#: word would have nothing to say about it.
#:
#:   disabled         the flag is off — and the cycle touched NO store to say so.
#:   closed           outside the regular session (weekend, holiday, after hours).
#:   build_in_flight  the 03:00 snapshot builder holds its lock; we stop BETWEEN
#:                    definitions rather than contend with it.
#:   no-definitions   nobody has a live scan. Not an error.
#:   no-universe      the universe read came back empty — never sweep zero symbols
#:                    and file the result.
#:   budget           the wall clock ran out; the ones we did not reach are NAMED
#:                    and lead the next cycle.
LIVE_SKIP_REASONS = ("disabled", "closed", "build_in_flight", "no-definitions",
                     "no-universe", "budget")

#: The exchange's clock. Every ET instant in this module comes from here.
_ET = ZoneInfo("America/New_York")


class ScanRunRefused(Exception):
    """The whole run cannot honestly proceed, and the gate that said so.

    The message leads with ``[gate:<name>]`` so a test binds to the GATE rather
    than to the prose -- prose gets edited, a gate does not. Same shape as
    ``scan_definition.ScanRefused`` on purpose: two refusal vocabularies for one
    lane is how a caller ends up pattern-matching sentences.
    """

    def __init__(self, gate: str, detail: str) -> None:
        if gate not in RUN_GATES:
            raise ValueError(
                f"{gate!r} is not one of this sweep's run gates {RUN_GATES}. The "
                "set is closed on purpose: a caller branches on it.")
        self.gate = gate
        self.detail = detail
        super().__init__(f"[gate:{gate}] {detail}")


# --------------------------------------------------------------------------- #
# the preconditions -- refuse loudly, because the alternative is a plausible
# wrong answer
# --------------------------------------------------------------------------- #

def _as_of_date(as_of: int) -> datetime.date:
    year, rest = divmod(int(as_of), 10_000)
    month, day = divmod(rest, 100)
    return datetime.date(year, month, day)


def expected_session() -> int:
    """The most recent session (YYYYMMDD) the bars store should have data for.

    ⛔ DELEGATED TO THE BARS STORE'S OWN CALENDAR, never re-derived. It already
    handles weekends, the pre-open roll and the NYSE holiday walk-back, and it is
    the same function the store's staleness logic uses -- two calendars that
    disagreed would make this sweep's gate fire on days the store itself considers
    current. `signature.sweep._expected_session` reaches the same function for the
    same reason; the map is shared, not copied.

    ⭐ AND THE PRE-OPEN ROLL IS WHY THE SWEEP RUNS BEFORE 09:35 ET. At 05:00 ET
    this answers with YESTERDAY'S session, which IS the last CONFIRMED bar -- the
    one thing a screen may read and a chart must not assume.
    """
    from api.services.bars_fetch import _expected_latest_session_yyyymmdd
    return int(_expected_latest_session_yyyymmdd())


def previous_session(as_of: int) -> Optional[int]:
    """The trading session immediately BEFORE ``as_of``, or ``None``.

    ⛔ THE SAME CALENDAR `expected_session` DELEGATES TO, ASKED A DIFFERENT
    QUESTION — never a second weekend/holiday walk-back of this module's own.
    The probe is MIDNIGHT of `as_of`: the store's pre-open roll makes that answer
    "the last session strictly before today", which is exactly the previous
    session, with the NYSE holiday walk already applied.

    ⭐ IT EXISTS FOR FAIRNESS, NOT FOR CORRECTNESS. `_resume_order` uses it to put
    the definitions the LAST run never reached at the FRONT of this one.
    """
    from api.services import bars_fetch
    day = _as_of_date(as_of)
    probe = datetime.datetime(day.year, day.month, day.day, tzinfo=_ET)
    try:
        prev = int(bars_fetch._expected_latest_session_yyyymmdd(probe))
    except Exception:                                        # pragma: no cover
        return None
    return prev if prev < int(as_of) else None


def _now_et() -> datetime.datetime:
    """The ONE clock this module reads.

    ⛔ ONE SOURCE, ON PURPOSE. `lesson_a_half_faked_clock_manufactures_false_positives`
    measured 15 false time-bombs per real one, every one of them from a test that
    froze one clock and left another running. There is exactly one here, so a test
    that freezes it has frozen all of them — and `sweep_deadline` reads it too.
    """
    return datetime.datetime.now(_ET)


def market_open_et(day: datetime.date) -> datetime.datetime:
    """When the regular session opens on ``day``, in ET. ⛔ DERIVED, NEVER TYPED.

    🔴 THE AUTHORITY IS `bars_fetch.bucket_60_et_unix_seconds`, which `CLAUDE.md`
    names the single source of truth for session alignment and which BOTH the REST
    resample path and the WebSocket rollup path already share. Its contract states
    the open in the only way this module can honestly read it: *"9:30-9:59 ET:
    anchor at 9:30 ET (the special 'clean open' 30-min bar); all other times: floor
    to clock-hour ET"*. So the session open is **the one bucket in the day that is
    not a clock hour**, and that is what this looks for.

    ⛔ WHY NOT JUST WRITE 09:30. Because it is already written — in
    `bucket_60_et_unix_seconds`, in `bars_liveness.is_market_open`, in
    `live_massive_router._MARKET_OPEN_ET_MIN`, in `flow_gap_autofill`. A fifth copy
    beside a budget nobody re-reads is `lesson_probe_names_must_be_derived_not_typed`
    exactly, and it is the shape that has already cost this repo three outages: a
    value re-typed next to the thing that owns it, agreeing on the day it is written
    and silently disagreeing later. Reading it costs ~3 ms, once per sweep.

    ⚠️ IT IS THE CLOCK-TIME OPEN, NOT A TRADING-DAY TEST. A Saturday still answers
    09:30 — there is no session, so nothing asks. `sweep_deadline` wants "the hours
    the market would be open", and a bound that is present on a closed day and
    absent on an open one would be the wrong way round.

    :raises RuntimeError: the anchor function stopped declaring a session open at
        all, which would silently unbound this sweep.
    """
    from api.services import bars_fetch
    for minute in range(24 * 60):
        hour, minute_of_hour = divmod(minute, 60)
        probe = datetime.datetime(day.year, day.month, day.day, hour,
                                  minute_of_hour, tzinfo=_ET)
        anchor = int(bars_fetch.bucket_60_et_unix_seconds(int(probe.timestamp())))
        if anchor != int(probe.replace(minute=0).timestamp()):
            return datetime.datetime.fromtimestamp(anchor, tz=_ET)
    raise RuntimeError(
        "no session-open anchor could be derived for "
        f"{day.isoformat()}: every minute of the day buckets to its own clock "
        "hour, so `bars_fetch.bucket_60_et_unix_seconds` no longer declares a "
        "session open. REFUSING to guess — a budget that fell back to a typed "
        "09:30 would be the second authority this function exists to avoid.")


def sweep_deadline(now: Optional[datetime.datetime] = None) -> datetime.datetime:
    """The instant after which `run_sweep` will not START another definition.

    ``market_open_et(today) - SWEEP_STOP_BEFORE_OPEN``, in ET.

    ⭐ TODAY'S OPEN, NOT "THE NEXT ONE". A sweep that began at 10:00 ET is already
    running while members trade, and rolling the deadline forward to tomorrow's
    open would hand it another twenty-three hours — bounding the clock while
    losing the thing the bound is FOR. So the deadline for a run started after the
    open is already past, the run stops immediately, and it says so.

    ⚠️ THE COST OF THAT SIMPLICITY, STATED RATHER THAN HIDDEN: a manual re-run
    after the close is also refused, because this asks "is the open behind us"
    and not "is the market open right now" (which would need a second derived
    number — the close — and a second thing to keep true). A caller who knows
    better passes `run_sweep(deadline=...)` explicitly. The scheduled job runs at
    `SWEEP_HOUR_ET`, hours before the deadline, and
    `test_the_SCHEDULED_hour_falls_INSIDE_its_own_budget_window` is the rail that
    keeps the two consistent if either moves.
    """
    now = now or _now_et()
    return market_open_et(now.date()) - SWEEP_STOP_BEFORE_OPEN


def live_enabled() -> bool:
    """`SCAN_LIVE_SWEEP_ENABLED`, default OFF, READ PER CALL.

    ⭐ THE LIVE TIER'S IDIOM, AND THE REASON IS ROLLBACK: unset the variable and
    the NEXT TICK answers `disabled` — no deploy, no rebuild, no code change. A
    module-level capture would make the rollback need a restart, which is the one
    thing you cannot count on having time for.
    """
    return os.environ.get("SCAN_LIVE_SWEEP_ENABLED", "0") == "1"


def live_interval_s() -> int:
    """The live cadence in seconds (`SCAN_LIVE_INTERVAL_S`, default 300).

    Read at REGISTRATION by `main.py` — changing it needs a restart, the live
    tier's documented trade — and again per cycle, because the BUDGET is derived
    from it and a receipt should describe the interval it actually ran under.

    ⛔ FLOORED AT 30 s. Below that the cycle spends more time starting than
    sweeping and the snapshot itself is only 30 s fresh, so a smaller number buys
    nothing and costs the pod everything. An unparseable value falls back rather
    than raising: a scheduled job that dies on a typo'd env var is an outage.
    """
    try:
        return max(30, int(float(os.environ.get("SCAN_LIVE_INTERVAL_S", "") or 300)))
    except ValueError:
        return 300


def _live_cycle_budget_s() -> int:
    """How long a cycle may keep STARTING definitions: the interval minus ONE
    worst-case definition. Positive by construction while the floor above (30 s)
    stays over `LIVE_DEFINITION_WORST_CASE_S`… which it does not — so the caller
    treats a non-positive budget as "sweep one and stop", which the between-
    definitions check already does on its own."""
    return live_interval_s() - LIVE_DEFINITION_WORST_CASE_S


def _live_session_state(now: datetime.datetime) -> Optional[str]:
    """``None`` inside the regular session of a trading day, else ``"closed"``.

    ⛔ BOTH ENDS ARE DERIVED. The open is `market_open_et` — the bars store's own
    session anchor, the same one `sweep_deadline` reads — and the close is that
    plus `REGULAR_SESSION_LENGTH`. Nothing here types 09:30 or 16:00.

    ⛔ AND THE TRADING-DAY TEST IS THE BARS STORE'S HOLIDAY TABLE, not a second
    calendar of this module's own: `market_open_et` answers 09:30 on a Saturday
    (correctly — it is the clock-time open, not a session test), so the weekend
    and the NYSE holiday walk have to be asked separately, and they are asked of
    the module that already owns them.

    ⚠️ HALF-OPEN: `open <= now < close`. A cycle firing AT 16:00 would read a
    forming bar the exchange has already settled and file it as live.
    """
    from api.services import bars_fetch
    if now.weekday() >= 5 or bars_fetch._is_nyse_holiday(int(now.strftime("%Y%m%d"))):
        return "closed"
    open_at = market_open_et(now.date())
    if now < open_at or now >= open_at + REGULAR_SESSION_LENGTH:
        return "closed"
    return None


def _assert_snapshot_is_current(as_of: int) -> str:
    """🔴 THE SCALARS COME FROM `screener_rows`, SO A STALE SNAPSHOT IS A SCREEN
    ANSWERING ON LAST MONTH'S FUNDAMENTALS UNDER TODAY'S DATE.

    This is checkable and it is live on this box: `C:\\data\\screener.db` holds
    3,589 rows, 3,583 of them stamped `snapshot_date = 2026-07-11` -- a month
    stale (GT §0.4, LOCAL). That is a POSITIVE CONTROL sitting on the developer's
    disk: run the sweep here today and this gate must fire.

    ⛔ AND THE STALENESS IS NOT SELF-HEALING. `api/main.py` -- the block that tops
    up an under-filled `screener.db` on deploy -- sits AFTER a `return True`
    inside `register_pattern_vision_jobs` and is UNREACHABLE DEAD CODE (GT §0.4,
    AST-verified). A cold or stale `screener.db` waits until 03:00 ET with no boot
    top-up. Per controller resolution 8 this is a REAL BUG WITH ITS OWN TASK and
    is NOT E-1..E-3's -- E-3 REFUSES to build on it, and the dead block is a
    FINDING carried in this task's report.

    ⚠️ THE COMPARISON IS `snapshot_date >= the session being screened`, not
    equality. `snapshot_builder` stamps the CALENDAR DAY it ran; `as_of` is the
    last CONFIRMED session, which on a Monday morning is the previous Friday. An
    equality would refuse every correct Monday and pass nothing -- a gate that
    cannot succeed is as useless as one that cannot fail.

    🔴 AND THE STATISTIC IS THE **MEDIAN** ROW, NOT `MAX(snapshot_date)`, BECAUSE
    THE MAX MISSES THE LIVE CONTROL. Measured on this box 2026-08-09:
    `C:\\data\\screener.db` holds 3,589 rows -- **3,583 stamped 2026-07-11, five
    stamped 2026-07-10, and exactly ONE stamped 2026-08-08.** `snapshot_db.status()`
    reports the MAX, so a gate reading it sees "today" and waves through a
    month-stale snapshot on the strength of a single row. The median is a RANK
    statistic, not a tunable threshold: it says "most of this snapshot", it needs
    no number, and it goes stale the moment half the universe stops rebuilding.
    """
    status = snapshot_db.status()
    stamped = _median_snapshot_date()
    if not status.get("rows") or not stamped:
        raise ScanRunRefused(
            "snapshot-stale",
            f"the screener snapshot holds {status.get('rows') or 0} rows and its "
            f"median row is stamped {stamped!r}. Every declared scalar this tree "
            "reads comes out of `screener_rows`; with no snapshot the sweep would "
            "answer on holes and call them zeros.")
    try:
        built = datetime.date.fromisoformat(str(stamped))
    except ValueError as exc:
        raise ScanRunRefused(
            "snapshot-stale",
            f"the screener snapshot is stamped {stamped!r}, which is not a date "
            f"({exc}). A snapshot whose age cannot be read cannot be trusted.")
    session = _as_of_date(as_of)
    if built < session:
        raise ScanRunRefused(
            "snapshot-stale",
            f"the screener snapshot's median row was built {built.isoformat()} "
            f"(newest {status.get('latest_snapshot_date')!r}) and this sweep "
            f"screens the {session.isoformat()} session. A scan over stale "
            "fundamentals returns a plausible, ranked, wrong answer under today's "
            "date.")
    return built.isoformat()


def _median_snapshot_date() -> Optional[str]:
    """The snapshot date of the MEDIAN `screener_rows` row, or ``None``.

    ⛔ NOT `MAX`. See `_assert_snapshot_is_current` -- one freshly-rebuilt row out
    of 3,589 moves the MAX by a month and moves the median by nothing, and it is
    the median that describes what the sweep is about to read.
    """
    with contextlib.closing(snapshot_db.connect()) as conn:
        n = conn.execute(
            "SELECT COUNT(*) FROM screener_rows WHERE snapshot_date IS NOT NULL"
        ).fetchone()[0]
        if not n:
            return None
        row = conn.execute(
            "SELECT snapshot_date FROM screener_rows WHERE snapshot_date IS NOT "
            "NULL ORDER BY snapshot_date LIMIT 1 OFFSET ?", (n // 2,)).fetchone()
    return row[0] if row else None


def _row_is_current(row: Optional[Mapping[str, Any]], as_of: int) -> bool:
    """Was THIS symbol's snapshot row rebuilt on or after the session screened?

    ⛔ THE PER-SYMBOL HALF, AND IT IS THE SAME ARGUMENT AS `_bars_are_current`.
    A median that is current does not make every row current: a symbol the
    nightly build skipped keeps last month's fundamentals, and answering on them
    is a plausible, ranked, wrong answer for that symbol specifically. It is
    reported as `no-screener-row` -- for THIS session there is no row -- with the
    stale date in the detail, because `DROP_REASONS` is a closed set and a NEW
    reason is not this task's to declare.
    """
    if not row:
        return False
    stamped = row.get("snapshot_date")
    if not stamped:
        return False
    try:
        return datetime.date.fromisoformat(str(stamped)) >= _as_of_date(as_of)
    except (TypeError, ValueError):
        return False


def cadence_ceiling(tree: Any, opts: Optional[Mapping[str, Any]] = None) -> Optional[str]:
    """How often re-running THIS tree can honestly say something new.

    🔴 A TRUE NUMBER CAN CARRY A FALSE IMPLICATION, and that is the failure this
    answers. Every one of the table's 54 declared scalars is `cadence: nightly`
    out of `screener_rows` at `grain: date` (measured 2026-08-09, unanimous). So a
    scan naming ANY scalar re-read five minutes later returns the SAME answer off
    the SAME nightly snapshot — correct, and `meta.freshness` would correctly badge
    it `as-of-snapshot`, but a member watching it "refresh" reasonably infers new
    information arrived. That is the 2150%-expected-move class: not a stale number,
    a true one implying something false. A bars-only tree has no such ceiling —
    bars stream, so intraday is honest for it.

    ⛔ THE CEILING IS A PROPERTY OF THE TREE, NOT A GLOBAL KNOB, AND IT IS DERIVED
    FROM THE MANIFEST'S OWN `cadence` DECLARATIONS — the same reach machinery
    `meta.freshness` already uses. ⛔ NOTHING HERE HAND-LISTS WHICH SCALARS ARE
    NIGHTLY: a fifty-fifth scalar declaring a different cadence changes this answer
    the day it lands, with no edit in this file.

    ``None`` means "no scalar ceiling" — the bars' own cadence applies.

    ⚠️ TWO DIFFERENT CADENCES ARE REPORTED AS BOTH, NOT COLLAPSED. Ranking them
    would need an ORDER the manifest does not declare, and inventing one here would
    be a second authority over which of two cadences is coarser. Today all 54
    agree, so the joined form is unreachable in production and visible if it ever
    is not.
    """
    cadences = sorted(set(ast_freshness.freshness_for(tree, opts).get("cadences") or []))
    return "/".join(cadences) if cadences else None


def _BAR_FIELD_OF(name: str) -> str:
    """``closedTable.json::series[name].field`` — the ONE declaration of which bar
    key a series reads. ``screener/backtest._bar_fields`` reads the same one.

    ⛔ NOT A LOCAL ``{"close": "c"}``. A second copy of this map is the defect this
    repo has paid for more than any other: it agrees on the day it is written and
    rots silently the day the manifest grows a series. Reading the declaration
    means a sixth series is covered here with no edit in this file.
    """
    from api.services.ast_lint import TABLE
    return TABLE["series"][name]["field"]


def _forming_bar_series(tree: Any) -> set:
    """The table-declared BAR SERIES this tree reads AT OFFSET 0 — i.e. on the
    forming bar.

    ``close > sma(close, 20)`` reads `close` at 0 (a window ``[i-n, i]`` includes
    ``i``); ``high[1] > high[2]`` reads nothing at 0 and is therefore answerable
    from confirmed bars alone. Offsets COMPOSE along the path — the accumulated
    sum decides, not the nearest node — and ``ast_interpret._offset_bars``
    validates each one, so a hand-written blob spelling ``value: -26`` refuses
    here exactly as it would in the interpreter rather than reading as 0.

    ⛔ DERIVED FROM THE MANIFEST'S ``series`` SECTION, NEVER BY REGEX AND NEVER BY
    HAND. A declared SCALAR rides the very same ``{"type": "series"}`` node —
    ``market_cap`` is one — and it is not a bar field; membership in the section
    is what tells the two apart. Clock entries (tableVersion 2) ride it too and
    are likewise absent from that section, which is correct: they are not fields
    the forming bar can be missing. Iterative, like ``ast_freshness._walk``: the
    escape corpus carries an 8,001-node tree.

    ⛔ ``isinstance(name, str)`` IS CHECKED, exactly as ``ast_freshness.scalars_in``
    and ``series_in`` check it. This reads PERSISTED trees, which are user data
    that never went through ``canonicalise``, and no upstream reader refuses a
    non-string name: ``scalars_in`` returns an empty set for it, ``max_lookback``
    returns 0. So ``{"type": "series", "name": {...}}`` reaches here, and without
    the guard ``in`` raises ``TypeError: unhashable type`` — a RAISE, not a
    refusal by name, from a module whose whole contract is to refuse by name.

    ⚠️ CONSERVATIVE AT ONE ARGUMENT INDEX, DELIBERATELY. ``accum``'s SEED argument
    is evaluated at bar ``i - warmup``, not at ``i``, so ``accum(close, self+1,
    250)`` does not truly read ``close`` on the forming bar and this walk reports
    it anyway — the accumulated sum decides everywhere EXCEPT there. The error is
    in the safe direction: a caller refuses a field it could in fact have
    computed, and never computes on a field the feed did not carry.
    """
    series_names = ast_freshness._sections(None)[0]
    found: set = set()
    stack = [(tree, 0)]
    while stack:
        node, off = stack.pop()
        if not isinstance(node, dict):
            continue
        kind = node.get("type")
        if kind == "series":
            name = node.get("name")
            if off == 0 and isinstance(name, str) and name in series_names:
                found.add(name)
            continue
        if kind == "offset":
            child = (node.get("args") or [None])[0]
            stack.append((child, off + ast_interpret._offset_bars(node)))
            continue
        for arg in node.get("args") or []:
            stack.append((arg, off))
    return found


def _bars_are_current(sym: str, bars: Sequence[Mapping[str, Any]], as_of: int) -> bool:
    """⛔ A SCREEN OVER STALE BARS RETURNS A PLAUSIBLE, RANKED, WRONG ANSWER.

    99.0% of cap_universe has daily bars (GT §5.1, LOCAL: 3,704 / 3,742) -- the
    good news. The bad news, same measurement: only 6 of 3,704 carry the store's
    own newest session. On production that is `bars_prewarm`'s job, and
    `BARS_PREWARM_ENABLED` DEFAULTS TO "0" with per-job failures entirely silent.

    So freshness is a DECLARED, PER-SYMBOL, QUERYABLE FACT, and a symbol whose
    newest bar predates the run's `as_of` is DROPPED with reason `stale-bars` --
    never answered. On this box that will drop most of the universe, and that
    number being large and visible is the honest outcome, not a bug in the gate.
    """
    return _last_confirmed_index(bars, as_of) is not None


def _last_confirmed_index(bars: Sequence[Mapping[str, Any]],
                          as_of: int) -> Optional[int]:
    """The index of the bar for the run's OWN session, or ``None``.

    🔴 THE INDEX, NOT `-1`, AND NOT `_last_finite`.
    `alert_user_series._last_finite` returns *"the newest computable number in an
    aligned column"* -- correct for an alert, which asks *"has it happened yet"*.
    WRONG for a screen: on a halted or delisted symbol it walks BACKWARDS until it
    finds a number and answers with a value from forty sessions ago, wearing
    today's `as_of`. That is `lesson_a_derived_reference_needs_a_sanity_bound` at
    universe scale -- a plausible, ranked, wrong answer.

    `-1` is nearly right and fails the other way: the store can carry a partial
    bar for a session that is not yet confirmed, and reading it would publish an
    in-progress candle as a screen result. This looks the session up.
    """
    for i in range(len(bars) - 1, -1, -1):
        t = bars[i].get("t")
        if t is None:
            continue
        try:
            if int(ledger._normalize_bar_time(t)) == int(as_of):
                return i
        except (TypeError, ValueError):
            continue
    return None


# --------------------------------------------------------------------------- #
# the forming bar (spec 5.5) -- the ONLY thing the live mode reads that the
# nightly mode does not
# --------------------------------------------------------------------------- #

#: The drop word for a symbol whose live quote the sanity owner refused.
LIVE_DROP_REASON = "no-live-quote"

#: The prefix of the per-FIELD not-computable detail. ⛔ NAMESPACED, and it names
#: the FIELD: `live:forming-bar:high` tells a member WHICH input the feed did not
#: carry. The whole bar failing because one of five fields is pre-open would throw
#: away four fields that arrived.
LIVE_NOT_COMPUTABLE_DETAIL = "live:forming-bar:"


def live_bars_for(daily_bars: Sequence[Mapping[str, Any]], quote: Any, *,
                  session: int, prev_session: Optional[int] = None) -> dict:
    """The confirmed daily bars through `prev_session` PLUS today's forming bar
    built from the shared snapshot -- or a refusal that names its reason.

    ⛔ THERE IS NO `symbol` PARAMETER, AND ITS ABSENCE IS THE POINT (controller
    ruling, W4b.2 review). W4b.2 declared one, unused; the obvious "use" would have
    been to hand the symbol back inside the refusal so the caller could file the
    drop under it. But the only caller is `evaluate_one`'s `for sym in kept:` loop,
    which holds `sym` on the line above the call and files the drop with it on the
    line below (`_unanswered(sym, got["reason"], ...)`). Returning it would be a
    SECOND AUTHORITY OVER ONE VALUE -- two names for one string, whose disagreement
    would be invisible -- which is this repo's most repeated defect. So the
    parameter is gone rather than left to rot, and
    `test_a_symbol_the_SANITY_OWNER_refuses_is_a_DROP_that_NAMES_the_symbol_and_the_reason`
    pins that the drop record carries the symbol and the owner's word regardless.

    ⛔ THE GATE IS `live_tier.sanity_reason`, REUSED, with the anchor SYNTHESISED
    from the bars themselves (`{price: the last confirmed close, bars_asof: the
    previous session}`). It reads nothing else off the anchor, so there is no
    screener-row coupling to extract and no second copy of the rules to drift:
    the live tier and the live sweep answer "is this quote usable" with one
    function, and a gate added there is honoured here with no edit in this file.

    A forming bar's `o/h/l` are the feed's `day_open/day_high/day_low` -- `None`
    when the feed did not carry them, because `massive._px` maps the provider's 0
    to `None` (a 0 there would sort and filter as a real price of zero). `c` is
    `last_price` and is never `None`: `sanity_reason` has already refused a
    non-positive one. `live_cols` counts the fields that arrived, which is what
    lets a caller refuse PER FIELD instead of throwing the whole bar away.

    ⛔⛔ `volume` IS THE ONE FIELD THAT CAN NEVER BE PER-FIELD-REFUSED, AND A
    CALLER MUST KNOW THAT. `v` is `int(today_vol or 0)` -- an int, ALWAYS, never
    `None` -- so a consumer deriving "which fields are missing" from
    `forming[field] is None` (the only signal handed out here) can never emit
    `live:forming-bar:volume`, even though `_forming_bar_series` can and does
    return `volume`. The distinction was already gone upstream: `massive.py`
    collapses an absent volume to 0 in the parse, so by the time a quote reaches
    this function "no volume yet" and "zero shares traded" are one value. This is
    the last place that could have separated them and it cannot. ⇒ a tree reading
    `volume` at offset 0 computes on a 0 the feed may never have carried, and
    `live_cols` therefore has a FLOOR OF 2 (`c` and `v`) rather than a floor of 1.

    ⚠️ ANY STORE BAR NEWER THAN `prev_session` IS DROPPED. The store can already
    hold a partial candle for today (`bars_prewarm` writes one mid-session); the
    snapshot is the newer description of that SAME forming bar, so it replaces
    whatever partial the store happened to hold rather than sitting beside it.

    ⚠️ The daily bar's `t` is a YYYYMMDD -- `_last_confirmed_index` keys by
    `ledger._normalize_bar_time` and daily bars are dates in this store. The live
    table's `as_of` is the TICK, a unix second. Two encodings, two facts.
    """
    from api.services.screener import live_tier
    bars = list(daily_bars or [])
    if not bars:
        return {"bars": [], "reason": "no-bars", "detail": None, "live_cols": 0}
    prev = prev_session if prev_session is not None else previous_session(int(session))
    idx = _last_confirmed_index(bars, prev) if prev is not None else None
    if idx is None:
        return {"bars": [], "reason": "stale-bars",
                "detail": f"newest bar {bars[-1].get('t')!r}", "live_cols": 0}
    anchor = {"price": bars[idx].get("c"), "bars_asof": prev}
    why = live_tier.sanity_reason(anchor, quote, int(session))
    if why:
        return {"bars": [], "reason": LIVE_DROP_REASON, "detail": why, "live_cols": 0}

    def _f(v):
        # ⛔ `isinstance(v, bool)` IS CHECKED: `isinstance(True, int)` is True and
        # `float(True)` is 1.0, which would read as a real price of one dollar.
        return None if v is None or isinstance(v, bool) else (float(v) if float(v) > 0 else None)

    # ⛔ THE ASYMMETRY BELOW IS DELIBERATE — DO NOT "FIX" IT. `o/h/l` map a 0 to
    # `None` (absent); `v` floors at an int and may legitimately BE 0. Volume
    # genuinely starts at 0 and accumulates, so "0 shares so far" is a TRUE
    # measurement of a session in progress, whereas a price of 0 is never true of
    # anything. Making `v` `None` at 0 would refuse every symbol in the first
    # seconds of the session for a value that was correct.

    forming = {"t": int(session), "o": _f(quote.get("day_open")), "h": _f(quote.get("day_high")),
               "l": _f(quote.get("day_low")), "c": float(quote["last_price"]),
               "v": int(quote.get("today_vol") or 0)}
    live_cols = sum(1 for k in ("c", "v", "o", "h", "l") if forming[k] is not None)
    return {"bars": bars[:idx + 1] + [forming], "reason": None, "detail": None,
            "live_cols": live_cols}


# --------------------------------------------------------------------------- #
# the reads
# --------------------------------------------------------------------------- #

def _read_bars(sym: str, tf: str, want: int) -> list:
    """One symbol's bars, LOCAL. ⛔ No network, ever -- the whole affordability
    argument for a sequential universe sweep is that `bars_sqlite` is a local
    SQLite read, exactly as `snapshot_builder._read_daily_bars` does it."""
    from api.services import bars_sqlite
    rows = bars_sqlite.get_bars(sym, tf, want) or []
    out = []
    for r in rows:
        try:
            out.append({"t": r[0], "o": r[1], "h": r[2], "l": r[3],
                        "c": r[4], "v": r[5]})
        except Exception:                                    # pragma: no cover
            continue
    return out


def _scalar_columns(names: Sequence[str]) -> dict:
    """``{scalar name: screener_rows column}``, READ OFF THE MANIFEST.

    ⛔ NOT A HAND-LIST AND NOT `name == column`. `ast_table.scalar_source` is the
    declaration; a scalar renamed on one side of that map and not the other is
    exactly the two-vocabularies defect this lane has already paid for twice.
    """
    out = {}
    for name in names:
        try:
            src = ast_table.scalar_source(name) or {}
        except KeyError:
            # ⚠️ FAIL CLOSED, NOT SILENT. A name the manifest does not declare has
            # no column, so no value is carried for it -- and `unresolved_scalars`
            # then reports the symbol as `not_computable` NAMING that scalar,
            # rather than the tree quietly reading a NaN as a confident False.
            continue
        column = src.get("column")
        if isinstance(column, str) and column:
            out[name] = column
    return out


def _scalars_for(row: Optional[Mapping[str, Any]], columns: Mapping[str, str]) -> dict:
    if not row:
        return {}
    return {name: row.get(column) for name, column in columns.items()}


# --------------------------------------------------------------------------- #
# entitlement -- the parameter E-7 fills in
# --------------------------------------------------------------------------- #

def _apply_limits(universe: Sequence[str], limits: Any) -> tuple:
    """``(kept, withheld_count, withheld_reason)``.

    ⭐ THE PARAMETER EXISTS NOW SO THE MECHANISM HAS SOMEWHERE TO LAND, and it is
    read by DUCK TYPE rather than by importing `entitlements` -- that module is
    E-7's and does not exist yet, and a sweep that imported it would be a task
    depending on a task that has not shipped.

    ⛔ APPLIED WHERE BREADTH IS PRODUCED, NEVER WHERE IT IS DISPLAYED (E7-A1). A
    UI that hides rows is not entitlement: the rows were computed, they held the
    GIL for those seconds, and a client can ask for them.

    ⚠️ ONE AXIS IS APPLIED HERE AND IT IS `max_symbols` -- BREADTH. The history
    axis is applied at the door instead (`_history_withheld`), because its answer
    is a property of the DEFINITION rather than of any symbol.
    """
    syms = list(universe)
    cap = _cap_of(limits, "max_symbols")
    if cap is None:
        return syms, 0, None
    if cap >= len(syms):
        return syms, 0, None
    return syms[:cap], len(syms) - cap, SYMBOLS_WITHHELD


def _cap_of(limits: Any, field: str) -> Optional[int]:
    """One toolkit number, read by DUCK TYPE and type-checked once.

    ⚠️ `isinstance(True, int)` IS TRUE and `max_symbols=True` would cap a universe
    sweep at ONE symbol while reading as "enabled" -- E-7's `_check_count` opens
    with the same branch for the same reason. Two spellings of the guard is one
    more than the number of places a bool can sneak through.
    """
    if limits is None:
        return None
    cap = getattr(limits, field, None)
    if cap is None:
        return None
    if isinstance(cap, bool) or not isinstance(cap, int) or cap < 0:
        raise ValueError(
            f"limits.{field} must be a non-negative int or None, got {cap!r}")
    return cap


def _history_withheld(want: int, limits: Any) -> bool:
    """Does this plan stop the WHOLE definition short of the history it reads?

    🔴 A REFUSAL, NEVER A TRIM, AND E-7 MEASURED WHY. `ema(close,20)` is
    15.269399733598789 over 400 bars and 15.269384587868412 over the last 120 --
    two different indicators under one name, and the relative difference
    (9.919e-07) is INSIDE `pytest.approx`'s default `rel=1e-6`, so the obvious
    test passes on the broken implementation. Spec §1.4: a toolkit gates BREADTH,
    never MECHANICS. "You may not ask about that much of the past" is honest and
    fixed by upgrading; the same question answered with a worse number is not.

    ⛔ IT IS ASKED ONCE, ABOUT `want`, NOT PER SYMBOL. `want` is what the TREE
    declares it reads (`max_lookback` + the store's floor), so this is a fact
    about the definition and it is settled before a single bar is touched. Asking
    per symbol -- `len(bars) > cap`, which is `entitlements.apply_history_cap`'s
    own signature -- would answer YES for a liquid name and NO for a thin one, so
    a member on a small plan would get results only for the data-poorest tickers
    in the universe. That is a lottery wearing an entitlement's clothes.

    ⚠️ SO THIS IS STRICTLY THE STRONGER TEST, AND THE TWO AGREE WHERE THEY MEET:
    for any symbol carrying the history the tree asked for, this refuses exactly
    when `apply_history_cap` refuses. `test_the_SWEEPs_history_gate_and_apply_history_cap_AGREE`
    drives both over a matrix, the same way E-7 pinned the symbol slice.
    """
    cap = _cap_of(limits, "max_history_bars")
    return cap is not None and int(want) > cap


# --------------------------------------------------------------------------- #
# the rule record -- MONTHLY grain, and the grain is the sweep's choice
# --------------------------------------------------------------------------- #

def _month_of(bar_key: int) -> int:
    return int(bar_key) // 100


def _rule_record_rows(sym: str, bars: Sequence[Mapping[str, Any]],
                      column: Sequence[Any], pad: int,
                      through: Optional[int], as_of: int) -> list:
    """The `definition_record` rows this symbol owes, at MONTHLY grain.

    🔴 MONTHLY, NOT DAILY, AND THE NUMBER IS E-6'S. It measured 241.9 B/row over
    the 3,742-ticker universe: a DAILY row per symbol per session is 0.23 GB/yr
    per definition and **114 GB/yr at 500 definitions** -- Railway will not hold
    that past ~10. *"A row is a window with a tally, of any length"*, so folding a
    month of sessions into one row is 252/12 = **21x cheaper and answers every
    month-or-longer question identically.*

    ⛔ FORWARD-ONLY, AND THE PLANT IS WHAT MAKES IT SO. On the first sweep that
    ever sees a symbol there is no record, and closing "last month" would file a
    tally for sessions that ran before the definition existed -- a backtest wearing
    a receipt's clothes, which `definition_record` has no column to hold and no
    business inferring. So the first sweep plants a ONE-BAR row for the session it
    is actually looking at; that row is the origin, and every later window starts
    strictly after it.

    ⚠️ ONLY COMPLETED MONTHS ARE CLOSED. The month `as_of` falls in is still
    running, and a row written for a half-month would be superseded by nothing --
    the store is append-only.
    """
    if through is None:
        # The caller plants the origin for a symbol with no record. There is no
        # honest month to close before one exists.
        return []
    rows = []
    current = _month_of(as_of)
    buckets: dict = {}
    for i in range(pad, len(column)):
        value = column[i]
        if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if not math.isfinite(float(value)):
            continue
        raw = bars[i].get("t") if i < len(bars) else None
        if raw is None:
            continue
        try:
            key = int(ledger._normalize_bar_time(raw))
        except (TypeError, ValueError):                      # pragma: no cover
            continue
        if key <= through:
            continue
        month = _month_of(key)
        if month >= current:
            continue
        slot = buckets.get(month)
        if slot is None:
            slot = buckets[month] = [key, key, 0, 0]
        slot[0] = min(slot[0], key)
        slot[1] = max(slot[1], key)
        slot[2] += 1
        slot[3] += 1 if float(value) != 0.0 else 0
    for month in sorted(buckets):
        first, last, n, n_true = buckets[month]
        rows.append({"sym": sym, "first": first, "through": last,
                     "evaluated": n, "true": n_true})
    return rows


def _write_rule_record(def_hash: str, rev: int, tf_label: str,
                       rows: Sequence[dict]) -> tuple[int, int]:
    """The ONE production call into `definition_record`'s write door.

    ⛔ ONE SITE, AND THE ZERO IT REPLACED WAS ASSERTED. E-6 shipped
    `test_the_record_has_NO_PRODUCTION_WRITER_YET_and_the_ZERO_is_ASSERTED` -- an
    `==` on a derived AST census with a planted-writer control -- and said in its
    own docstring that the number becomes ONE when the sweep lands and the test is
    EDITED to say so. It has been. Deleting it instead is how a second writer
    arrives unnoticed.

    ⭐ IT GOES THROUGH THE **BATCHING** DOOR, AND THE CENSUS STILL READS ONE.
    `record_evaluations` (plural) is a different door on the SAME module, not a
    second writer: the census is keyed on the call SITE (`…::_write_rule_record`)
    and `_WRITE_DOORS` already lists both spellings, so switching which door this
    site calls changes HOW it writes, never WHO writes.

    ⛔ AND IT GOES THROUGH THAT MODULE'S DOOR, never a connection of its own. A
    caller that opened `signal_ledger.db` itself would be a second authority over
    one value; E-6's concern 2 names the batching door on `definition_record` as
    the only sanctioned answer if throughput ever needs beating -- *"⛔ never a
    caller opening its own connection to this table"*.

    ⚠️ WHY, MEASURED ON THIS SITE RATHER THAN ON THE DOOR. The per-row loop this
    replaced paid a fresh `sqlite3.connect()`, a `PRAGMA journal_mode=WAL` and a
    `commit()` per row, and a first sweep of one definition is one row per
    answered symbol -- 3,704 of them. Measured through THIS function, 3,704 rows,
    both arms driving the real `definition_record`, three runs on a contended box:
    **201-285 rows/s (13.0-18.4 s) before, 103,640-149,738 rows/s (0.025-0.036 s)
    after -- 468x to 642x**, and the write half of a sweep stops being larger than
    the compute half. A unit test on `record_evaluations` proves
    none of that: the door was already measured at 156k rows/s while THIS site
    still looped, which is the *built, tested, green, connected to nothing* shape
    the 2026-08-08 audit named.

    ⚠️ ONE BATCH IS ONE TRANSACTION, SO A CRASH MID-BATCH RECORDS NOTHING RATHER
    THAN A PREFIX -- a real behaviour change from the per-row loop, and the safer
    half of the trade for an append-only receipt store: the next sweep re-derives
    the same windows and `UNIQUE` makes the re-run free, whereas a half-written
    month would sit there forever claiming a tally nobody computed. Asserted, not
    assumed, by `test_the_rule_record_batch_is_ONE_TRANSACTION_so_a_crash_leaves_
    NO_PREFIX`.

    ⛔ A REFUSAL HERE IS COUNTED AND NAMED, NEVER SWALLOWED AND NEVER FATAL. The
    rule record is a SECOND store with its own rules -- forward-only from the
    origin, no inverted window, no empty window -- and it is right to refuse. But
    the SCREEN's answer is already written by the time this runs, and a `ValueError`
    escaping here would take the receipt down with it: a completed sweep would look
    like a sweep that never happened, which is the one reading E-2's three-state
    design exists to keep impossible. So the count comes back beside the writes.

    ⛔ AND THAT INCLUDES A KEY-LEVEL REFUSAL. `record_evaluations` RAISES on a bad
    `def_hash`/`rev`/`tf` rather than returning it per row, deliberately -- it is
    one problem, not N. The per-row loop caught that same `ValueError` once per
    row and reported `refused == len(rows)`, so this site keeps that arithmetic
    (nothing was written, so every row is refused) while logging the one sentence
    ONCE. ⛔ Only `ValueError` is caught: a non-`UNIQUE` `sqlite3.IntegrityError`
    is a DROPPED row, the door re-raises it on purpose, and swallowing it here
    would report a claim of coverage that was never written.
    """
    payload = [{"sym": row["sym"], "first_bar_time": row["first"],
                "through_bar_time": row["through"],
                "bars_evaluated": row["evaluated"], "bars_true": row["true"]}
               for row in rows]
    try:
        out = definition_record.record_evaluations(def_hash, rev, tf_label, payload)
    except ValueError as exc:
        log.warning("[scan] rule record refused the whole batch for %s "
                    "(%d rows, rev=%r tf=%r): %s",
                    def_hash[:15], len(rows), rev, tf_label, exc)
        return 0, len(rows)
    for row, exc in out["refused"]:
        log.warning("[scan] rule record refused %s %s [%s..%s]: %s",
                    def_hash[:15], row.get("sym"), row.get("first_bar_time"),
                    row.get("through_bar_time"), exc)
    return out["written"], len(out["refused"])


# --------------------------------------------------------------------------- #
# the sweep
# --------------------------------------------------------------------------- #

def _assert_coverage_closes(*, evaluated: int, answered: int, dropped: int,
                            not_computable: int,
                            withheld: int = 0,
                            universe: Optional[int] = None) -> None:
    """🔴 THE CLOSED IDENTITY, AND THE SWEEP ASSERTS IT ABOUT ITSELF.

    `escape_census` already does exactly this (*'census arithmetic broke:
    parsed=… refused=… escaped=…'*) and it is why a swallowed case there is
    impossible rather than merely discouraged. Every sweep in the ground-truth
    survey that lost symbols lost them through a hole in this arithmetic:
    `bars_prewarm._warm_one` counts a failure into NEITHER bucket;
    `rs_ranking` has no counter at all; `theme_performance` turns a failed fetch
    into a legitimate-looking None; `scan_volume._job` makes a failed reference
    indistinguishable from an empty market.

    ⛔ A `raise`, NOT A BARE `assert`. `python -O` strips `assert`, and a coverage
    guard that evaporates under an optimisation flag is a guard that is not there.

    ⛔ `withheld` IS CHECKED AGAINST THE UNIVERSE, NOT AGAINST `evaluated`. A
    withheld symbol was never looked at; folding it into the first identity would
    make that identity a statement about billing.
    """
    if evaluated != answered + dropped + not_computable:
        raise AssertionError(
            f"coverage arithmetic broke: evaluated={evaluated} "
            f"answered={answered} dropped={dropped} "
            f"not_computable={not_computable}")
    if universe is not None and evaluated + withheld != universe:
        raise AssertionError(
            f"the universe does not close: evaluated={evaluated} "
            f"withheld={withheld} universe={universe}")


def _assert_sweep_closes(*, handed: int, swept: int, refused: int,
                         duplicate: int, unswept: int) -> None:
    """🔴 THE SAME ARITHMETIC ONE GRAIN UP: every definition handed in is exactly
    one of swept, refused, duplicate, or unswept.

    ⭐ IT IS THE GUARD ON THE BUDGET ITSELF. A `break` that forgot to record what
    it broke out of would leave a receipt reporting 200 swept of 500 handed with
    no fourth number — which reads as "300 vanished" or, worse, as "there were
    only 200", and the whole point of bounding the sweep was that stopping early
    must be VISIBLE. `escape_census` and `_assert_coverage_closes` are the same
    idiom; every sweep in the ground-truth survey that lost work lost it through
    a hole in exactly this shape of arithmetic.

    ⛔ A `raise`, NOT A BARE `assert` -- `python -O` strips `assert`.
    """
    if handed != swept + refused + duplicate + unswept:
        raise AssertionError(
            f"sweep arithmetic broke: handed={handed} swept={swept} "
            f"refused={refused} duplicate={duplicate} unswept={unswept}")


def evaluate_one(definition: Any, tf: str = DEFAULT_TF, *,
                 universe: Optional[Sequence[str]] = None,
                 as_of: Optional[Any] = None,
                 limits: Any = None,
                 mode: str = NIGHTLY,
                 snapshot: Optional[Mapping[str, Any]] = None,
                 tick: Optional[int] = None,
                 prev_session: Optional[int] = None) -> dict:
    """Run one scan definition over the universe and STATE ITS OWN COVERAGE.

    Returns::

        {def_hash, rev, tf, as_of, freshness,
         hits: [...], hit_rows: [{symbol, value, bar_time (+live_cols, src_price
                                  under mode='live')}],
         cadence, tick,
         evaluated, answered, dropped, not_computable,
         withheld, withheld_reason,
         dropped_symbols: [{ticker, reason, detail?}], dropped_listed, truncated,
         recorded, record_refused,
         mode, persisted}

    ⭐ `mode='on-demand'` IS THE ON-DEMAND DOOR (W4a, spec §5.5). The SAME loop,
    the SAME four outcomes, the SAME hash — and NOTHING written: no `scan_hits`,
    no `scan_coverage`, no rule record, and no ledger read either. A member's
    500-symbol run filed under the nightly key would overwrite the universe's
    receipt with a list's, and `coverage(...)` would then describe five names as
    though they were the market. `mode` is the ONE authority over that (`MODES`).

    🔴 `mode='live'` IS THE FIVE-MINUTE CYCLE (spec §5.5), AND IT IS THE SAME LOOP
    WITH TWO DIFFERENCES, BOTH NAMED HERE.

      1. THE BARS. Each symbol's confirmed history through `prev_session` plus
         TODAY'S FORMING BAR, built by `live_bars_for` from the shared 30 s market
         snapshot (`snapshot`, read ONCE per cycle by the caller and passed in).
         A quote the sanity owner refuses is a `no-live-quote` DROP carrying
         `live_tier`'s own word; a forming-bar FIELD the feed did not carry is
         `not_computable` with detail `live:forming-bar:<field>` — per field,
         because failing the whole bar over one of five would throw away four that
         arrived.
      2. THE WRITE. `scan_hits_live` and NOTHING ELSE — no `scan_hits`, no
         `scan_coverage`, no rule record. ⛔⛔ A FORMING-BAR ANSWER FILED INTO
         `scan_coverage` WOULD RECORD IT AS THAT SESSION'S CLOSED-BAR COVERAGE,
         which is a second authority over what this session's screen said and the
         exact defect the two-table split exists to prevent. `MODES` carries the
         rail that keeps this true by AST.

    ⛔ AND IT REFUSES A NIGHTLY-CEILING TREE BEFORE READING A BAR. `cadence_ceiling`
    says whether re-running this tree can honestly say anything new; if it cannot,
    running it every five minutes is a true number carrying a false implication.
    `tick` (the unix second the snapshot was read at) is REQUIRED, never guessed:
    it is the live row's `as_of`.

    ⚠️ `rev` IS READ OFF `definition['compute']['rev']` AND RETURNED. E-6's
    receipt is keyed on it; this function does not invent it and does not default
    it. A definition carrying no usable `rev` still SCANS -- the hits and the
    receipt are `rev`-free -- but no rule-record row can be filed under a
    revision nobody declared, so `recorded` stays 0 and `rev` comes back as it was
    found, hole and all.

    :raises ScanRunRefused: a whole-run gate. ⛔ NOTHING IS WRITTEN when one
        fires: a half-run that left a `scan_coverage` row would be
        indistinguishable from a quiet market, which is the one reading E-2's
        three-state design exists to keep impossible.
    """
    if mode not in MODES:
        raise ValueError(
            f"mode {mode!r} is not one of {MODES}. The set is closed on "
            "purpose: it is the one authority over what this run writes.")

    if not isinstance(definition, dict) or not definition:
        raise ScanRunRefused(
            "no-definition",
            f"a scan is a definition object; got {definition!r}")

    try:
        spec = scan_definition.assert_scannable(definition)
    except scan_definition.ScanRefused as exc:
        raise ScanRunRefused("not-scannable", str(exc)) from exc

    compute = definition["compute"]
    tree = compute.get("ast")
    rev = compute.get("rev")
    def_hash = spec["def_hash"]

    tf_code = scan_store._normalise_tf(tf)
    session = int(scan_store._normalise_as_of(
        as_of if as_of is not None else expected_session()))

    # ⭐ THE HONEST RE-RUN CADENCE, OFF THE TREE, COMPUTED ONCE. See
    # `cadence_ceiling`: a scan naming any declared scalar is capped by that
    # scalar's own declared cadence, because re-reading the nightly snapshot an
    # hour later returns the same answer while implying new information.
    cadence = cadence_ceiling(tree)

    forming_fields: dict = {}
    if mode == LIVE:
        # ⚠️ FUNCTION-LOCAL, AND DELIBERATELY: `scan_volume` pulls `threading` and
        # `massive` in at import, and the nightly sweep needs neither. The AST rail
        # keys on the CALL (`scan_volume.<attr>`), not on the import site.
        from api.services import scan_volume

        # 🔴 THE CADENCE REFUSAL COMES FIRST — before the snapshot gate, before a
        # single bar is read (1.9 µs a tree). A nightly-ceiling tree re-read five
        # minutes later returns the SAME answer off the SAME 03:00 snapshot while
        # implying new information arrived: a true number carrying a false
        # implication, which is the failure `cadence_ceiling` exists to name.
        if cadence and "nightly" in cadence.split("/"):
            raise ScanRunRefused(
                "cadence",
                f"this tree's ceiling is {cadence!r}: re-reading the 03:00 "
                "snapshot five minutes later returns the same answer while "
                "implying new information. The live sweep evaluates bars-only "
                "trees and trees whose every scalar declares a live cadence.")
        if tick is None:
            raise ValueError(
                "mode='live' needs the tick the snapshot was read at. The live "
                "row's `as_of` IS that tick; guessing one would file a "
                "forming-bar answer under an instant nobody measured.")
        # ⭐ WHICH FIELDS OF THE FORMING BAR THIS TREE READS, RESOLVED ONCE per
        # definition rather than 3,742 times inside the loop. `_BAR_FIELD_OF` is
        # the manifest's own series→bar-key declaration, never a local map.
        forming_fields = {n: _BAR_FIELD_OF(n) for n in _forming_bar_series(tree)}

    # ⭐ THE GATE APPLIES WHERE ITS REASON APPLIES. A tree that names no declared
    # scalar reads nothing out of `screener_rows`, so a stale snapshot cannot make
    # its answer wrong -- and refusing it anyway would be a gate firing for a
    # reason that is not true, which teaches a reader to ignore the gate.
    # ⚠️ UNREACHABLE UNDER `mode='live'` TODAY, and by construction rather than by
    # luck: every declared scalar is `cadence: nightly`, so a tree with any
    # `scalar_columns` at all has already been refused at `gate:cadence` above. It
    # is left as `if scalar_columns` because THAT is the condition its reason
    # depends on — the day a scalar declares a live cadence, the gate is right here
    # waiting for it, with no edit.
    scalar_columns = _scalar_columns(spec["scalars"])
    snapshot_stamp = _assert_snapshot_is_current(session) if scalar_columns else None

    if universe is None:
        universe = snapshot_builder._load_universe()
    universe = [str(s).strip().upper() for s in (universe or []) if str(s).strip()]
    if not universe:
        raise ScanRunRefused(
            "no-universe",
            "the sweep was handed no symbols. An empty universe produces an empty "
            "hit list that is indistinguishable from a quiet market.")

    kept, withheld, withheld_reason = _apply_limits(universe, limits)

    # ⛔ THE VERDICT COMES FROM THE TREE, NOT FROM A DEFAULT. `record_coverage`
    # defaults `freshness` to "unknown" because the STORE never sees the tree;
    # the sweep does, so it passes what `ast_freshness` said or every receipt in
    # the table reads `unknown`.
    freshness = ast_freshness.freshness_for(tree)["mode"]

    # `max_lookback` resolves every call on its way to a number, so a tree naming
    # a function the table does not declare refuses HERE — once, loudly — rather
    # than 3,742 times inside the loop.
    try:
        lookback = ast_interpret.max_lookback(tree)
    except ast_interpret.TableRefusal as exc:
        raise ScanRunRefused("not-scannable", str(exc)) from exc
    want = min(_MAX_BARS, max(_MIN_BARS, lookback + _MIN_BARS))
    pad = max(0, lookback - 1)

    # 🔴 THE HISTORY AXIS, AND IT STOPS THE WHOLE DEFINITION RATHER THAN TRIMMING
    # ANY SYMBOL'S BARS. See `_history_withheld`. Everything the member could have
    # been shown is withheld under ONE attributable reason, the loop below runs
    # zero times, and the closed identity still closes because a withheld symbol
    # was never looked at.
    history_withheld = _history_withheld(want, limits)
    if history_withheld:
        kept, withheld, withheld_reason = [], len(universe), HISTORY_WITHHELD

    rows_by_ticker = snapshot_db.get_rows(kept) if scalar_columns else {}

    record_rev = rev if (isinstance(rev, int) and not isinstance(rev, bool)
                         and rev >= 0) else None
    if mode != NIGHTLY:
        # ⛔ THE FORWARD RECORD IS CLOSED-BAR ONLY. A live run answers on a FORMING
        # bar — filing that as a bar's settled outcome would put a candle that is
        # still moving into the record a backtest reads — and an on-demand run is
        # nobody's receipt to file. Neither reads the ledger to seed one either: a
        # run nobody files has nothing to resume from.
        record_rev = None
    tf_label = ledger._BARS_STORE_TF_KEYS.get(tf_code)
    throughs: dict = {}
    if mode == NIGHTLY and record_rev is not None and tf_label:
        throughs = definition_record.latest_through_by_symbol(
            def_hash, record_rev, tf_label)

    hits: list = []
    hit_rows: list = []
    unanswered: list = []
    pending_record: list = []
    evaluated = answered = dropped = not_computable = 0

    def _unanswered(sym: str, reason: str, detail: Optional[str] = None) -> None:
        """⛔ ONE ENUMERATION, BOTH KINDS, EVERY ENTRY CARRYING ITS REASON.
        The list is CAPPED and the counts are not."""
        if len(unanswered) >= _DROPPED_LISTED_MAX:
            return
        entry = {"ticker": sym, "reason": reason}
        if detail:
            entry["detail"] = detail
        unanswered.append(entry)

    for sym in kept:
        evaluated += 1
        try:
            row = rows_by_ticker.get(sym)
            if scalar_columns and not _row_is_current(row, session):
                _unanswered(sym, "no-screener-row",
                            detail=(None if row is None else
                                    f"row stamped {row.get('snapshot_date')!r}"))
                dropped += 1
                continue

            bars = _read_bars(sym, tf_code, want)
            live_cols = 0
            if mode == LIVE:
                # ⭐ THE ONLY THING LIVE READS THAT NIGHTLY DOES NOT. The gate is
                # `live_tier.sanity_reason`, reused — one sanity owner for the live
                # tier and the live sweep, so the two can never disagree about
                # whether a quote is usable.
                got = live_bars_for(bars, scan_volume._snap_lookup(snapshot or {}, sym),
                                    session=session, prev_session=prev_session)
                if got["reason"]:
                    # ⛔ THE SYMBOL IS THIS LOOP'S, THE REASON AND DETAIL ARE THE
                    # OWNER'S. Neither half is composed here.
                    _unanswered(sym, got["reason"], detail=got["detail"])
                    dropped += 1
                    continue
                bars = got["bars"]
                live_cols = got["live_cols"]
                absent = sorted(n for n, f in forming_fields.items()
                                if bars[-1].get(f) is None)
                if absent:
                    # ⛔ PER FIELD, NAMED, AND IN THE `not_computable` BUCKET. The
                    # whole bar failing because one of five fields is pre-open would
                    # throw away four that arrived, and "we could not compute it" is
                    # not "something broke".
                    _unanswered(sym, NOT_COMPUTABLE_REASON,
                                detail=LIVE_NOT_COMPUTABLE_DETAIL + ",".join(absent))
                    not_computable += 1
                    continue
            elif not bars:
                _unanswered(sym, "no-bars")
                dropped += 1
                continue

            index = _last_confirmed_index(bars, session)
            if index is None:
                newest = bars[-1].get("t")
                _unanswered(sym, "stale-bars", detail=f"newest bar {newest!r}")
                dropped += 1
                continue

            scalars = _scalars_for(row, scalar_columns)
            # 🔴 THE HOLE IS ASKED ABOUT BEFORE IT IS EATEN. `_cmp` answers 0
            # against NaN, so `market_cap > 1e9` on a symbol with no market cap
            # is a confident False rather than a hole -- measured by E-1 and
            # pinned by 17 frozen conformance digests, so the fix is HERE and not
            # in the comparison.
            missing = ast_interpret.unresolved_scalars(tree, scalars)
            if missing:
                _unanswered(sym, NOT_COMPUTABLE_REASON,
                            detail="no value for " + ", ".join(missing))
                not_computable += 1
                continue

            # ⭐ `opts={"tf": tf_code}` IS THE CLOCK'S ONLY INPUT (tableVersion 2,
            # lane W2a.2). Without it every clock name in every saved scan is
            # permanently `not_computable` — `compute_clock` fails CLOSED on an
            # absent tf rather than guessing `"D"`, which would make `isdaily` a
            # confident 1 on a five-minute chart. ⛔ THE NORMALISED CODE, not the
            # caller's spelling: `scan_store._TF_CODES` and
            # `indicator_compute.CLOCK_TIMEFRAMES` are the same set of words.
            column = ast_interpret.interpret(tree, bars, scalars=scalars,
                                             opts={"tf": tf_code})
            value = column[index]
            if (value is None or isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(float(value))):
                # ⛔ ITS OWN BUCKET. "We could not compute it" is not "something
                # broke", and a member reading one number for both cannot tell a
                # short-history universe from a failing one.
                _unanswered(sym, NOT_COMPUTABLE_REASON)
                not_computable += 1
                continue

            answered += 1
            if float(value) != 0.0:              # `<ast> != 0`, E-A1
                hits.append(sym)
                # ⭐ THE VALUE AND THE BAR IT CAME FROM, beside the symbol. The
                # sweep discards both; the on-demand door returns them, and the
                # live mode STORES them. Additive — `hits` is unchanged.
                row = {"symbol": sym, "value": float(value),
                       "bar_time": bars[index].get("t")}
                if mode == LIVE:
                    # ⭐ THE TWO FACTS ONLY A LIVE ROW HAS: how much of the forming
                    # bar the feed carried, and the price the answer was computed
                    # at. ⛔ ADDED ONLY HERE. A nightly row carrying `live_cols: 0`
                    # would be a live-shaped fact about a closed bar, and a reader
                    # cannot tell "no live columns" from "not a live row".
                    row["live_cols"] = live_cols
                    row["src_price"] = bars[index].get("c")
                hit_rows.append(row)

            if mode == NIGHTLY and record_rev is not None and tf_label:
                if sym not in throughs:
                    pending_record.append(
                        {"sym": sym, "first": session, "through": session,
                         "evaluated": 1, "true": 1 if float(value) != 0.0 else 0})
                else:
                    pending_record.extend(_rule_record_rows(
                        sym, bars, column, pad, throughs[sym], session))

        except ast_interpret.TableRefusal as exc:
            # ⛔ NOT A PER-SYMBOL DROP. A tree the table refuses is refused for
            # EVERY symbol, and swallowing it here would turn one loud authoring
            # error into a universe of quietly dropped rows -- `record_pass` says
            # the same thing in its own docstring. Nothing is written.
            raise ScanRunRefused("not-scannable", str(exc)) from exc
        except Exception as exc:                             # noqa: BLE001
            # ⛔ COUNTED AND NAMED, NEVER `pass`. `bars_prewarm._warm_one` is the
            # counter-example: `except Exception: pass`, into NEITHER bucket,
            # never printed -- a symbol failing every cycle is invisible.
            _unanswered(sym, "refused",
                        detail=f"{type(exc).__name__}: {exc}"[:160])
            dropped += 1
            log.warning("[scan] %s %s failed: %s", def_hash[:15], sym, exc)

    _assert_coverage_closes(evaluated=evaluated, answered=answered,
                            dropped=dropped, not_computable=not_computable,
                            withheld=withheld, universe=len(universe))

    truncated = len(unanswered) < (dropped + not_computable)

    # ⛔ A WITHHELD RUN WRITES NO RECEIPT, AND THE STORE IS WHY. `scan_hits` and
    # `scan_coverage` are MEMBER-INDEPENDENT by design (E-2 gave them no member
    # column; `run_sweep` dedupes by `def_hash` so two members who typed the same
    # formula share one result set). A per-member entitlement outcome written
    # there would tell EVERY member that this definition evaluated zero symbols
    # today — a plan's boundary published as a fact about the market. The member
    # gets the withholding in their own envelope; the shared store keeps silence,
    # which reads correctly as `coverage(...) is None` — "nobody looked".
    # ⛔ AND AN ON-DEMAND RUN WRITES NOTHING AT ALL — `mode` in the docstring.
    persisted = False
    if mode == NIGHTLY and not history_withheld:
        scan_store.record_hits(def_hash, tf_code, session, hits)
        scan_store.record_coverage(
            def_hash, tf_code, session,
            evaluated=evaluated, answered=answered, dropped=dropped,
            not_computable=not_computable, dropped_symbols=unanswered,
            freshness=freshness)
        persisted = True
    elif mode == LIVE and not history_withheld:
        # 🔴 THE LIVE SIDE TABLE AND NOTHING ELSE. `as_of` is the TICK, not the
        # session: `upsert_live_hits` refuses a YYYYMMDD by name, because the two
        # encodings answer two different questions and one of them silently
        # poisons every later read.
        scan_store.upsert_live_hits(def_hash, tf_code, hit_rows, as_of=tick)
        # ⭐ THE DEMAND RING: symbols a definition just NAMED, so the worker's
        # intraday prewarm ring can order its passes by what is actually being
        # scanned. Bounded and per-process; losing it on a redeploy costs one pass.
        scan_store.note_demand([r["symbol"] for r in hit_rows])
        persisted = True

    recorded = record_refused = 0
    if mode == NIGHTLY and record_rev is not None and tf_label and pending_record:
        recorded, record_refused = _write_rule_record(
            def_hash, record_rev, tf_label, pending_record)

    return {
        "def_hash": def_hash,
        "rev": rev,
        "tf": tf_code,
        "as_of": session,
        "freshness": freshness,
        "cadence": cadence,
        "snapshot_date": snapshot_stamp,
        "hits": hits,
        "evaluated": evaluated,
        "answered": answered,
        "dropped": dropped,
        "not_computable": not_computable,
        "withheld": withheld,
        "withheld_reason": withheld_reason,
        "dropped_symbols": unanswered,
        "dropped_listed": len(unanswered),
        "truncated": truncated,
        "recorded": recorded,
        "record_refused": record_refused,
        "hit_rows": hit_rows,
        "mode": mode,
        "tick": tick,
        "persisted": persisted,
    }


def _resume_order(entries: Sequence[tuple], tf_code: str, as_of: int, *,
                  swept_last_time: Optional[Any] = None) -> list:
    """The sweep's order, with the LAST run's tail at the FRONT.

    🔴 A BUDGET THAT ALWAYS CUTS AT THE SAME POINT STARVES THE SAME DEFINITIONS
    FOREVER. If the clock stops the sweep at 200 of 500 and tomorrow starts from
    the same first definition, the last 300 are never swept again — and nothing
    would ever say so, because each night's receipt looks like a healthy partial.

    ⭐ THE RESUME POINT IS DERIVED FROM THE ARTIFACT, NOT REMEMBERED IN A CURSOR:
    a definition carrying no `scan_coverage` row for the PREVIOUS session was not
    reached last time, so it leads this time. No new table, no marker file,
    nothing to lose on a redeploy — and unlike a stored cursor it cannot go stale
    or disagree with what actually happened, because it reads the receipts the
    last run wrote. `lesson_health_check_reads_a_proxy_not_the_artifact` is the
    same lesson pointed the other way.

    ⛔ `sorted` IS STABLE AND THAT IS LOAD-BEARING. Within each bucket the
    caller's order survives untouched; on a first run, or one where every
    definition was swept last time, this is the identity. It must never sort,
    sample or shuffle beyond the one bit it is entitled to — `apply_symbol_cap`
    refuses the same thing for the same reason ("the order is the caller's").

    ⭐ `swept_last_time` IS THE LIVE CYCLE'S ARTIFACT, AND IT REPLACES THE PROBE
    RATHER THAN JOINING IT. The nightly sweep's artifact is a `scan_coverage` row
    for the PREVIOUS SESSION; a five-minute cycle has no session-grained receipt to
    read, so it hands in a predicate over the LAST CYCLE'S OWN `swept` list -- the
    thing it does write. When it does, the previous-session probe is not consulted
    at all: two answers to "was this reached last time" is exactly the second
    authority this function's one bit of ordering cannot afford.
    """
    if swept_last_time is not None:
        return sorted(entries, key=lambda item: 1 if swept_last_time(item[0]) else 0)

    prev = previous_session(as_of)
    if prev is None:
        return list(entries)

    def _swept_last_time(item) -> int:
        try:
            return 1 if scan_store.coverage(item[0], tf_code, prev) is not None else 0
        except Exception:                                    # pragma: no cover
            # ⛔ A FAIRNESS READ MAY NEVER TAKE THE SWEEP DOWN. Unknown sorts to
            # the front: being swept twice is free, being starved is the bug.
            return 0

    return sorted(entries, key=_swept_last_time)


def _resolve_entries(definitions: Sequence[Any]) -> tuple:
    """PHASE 1 -- resolve every definition to its maths, BEFORE sweeping any.

    Returns `(entries, refused, duplicate, refusals)`, where `entries` is
    `[(def_hash, definition)]` DEDUPED BY HASH.

    ⭐ Validation only (microseconds), and it buys three things the inline shape
    could not: a malformed definition is refused before the pod spends a minute on
    someone else's, duplicates become COUNTABLE instead of silently skipped, and
    the ones a clock never reaches can be NAMED without doing work after the
    deadline.

    ⭐ DEFINITIONS ARE DEDUPED BY `def_hash`. Two members who typed the same
    formula have the same maths, share one result set and cost the pod ONE sweep --
    the property that makes the store member-independent, and the only place in
    this file where the number of MEMBERS could ever have leaked in.

    ⛔ SHARED BY BOTH MODES ON PURPOSE. A second copy of this loop for the live
    cycle would be a second answer to "is this definition scannable", and the two
    would agree on the day it was written.
    """
    seen: set = set()
    entries: list = []
    refused = duplicate = 0
    refusals: list = []
    for definition in definitions:
        try:
            handle = scan_definition.assert_scannable(definition)["def_hash"]
        except scan_definition.ScanRefused as exc:
            refused += 1
            refusals.append({"gate": exc.gate, "detail": str(exc)[:200]})
            continue
        except Exception as exc:                             # noqa: BLE001
            refused += 1
            refusals.append({"gate": "not-scannable", "detail": str(exc)[:200]})
            continue
        if handle in seen:
            duplicate += 1
            continue
        seen.add(handle)
        entries.append((handle, definition))
    return entries, refused, duplicate, refusals


def _sweep_entries(entries: Sequence[tuple], *, evaluate: Any, stop_reason: Any,
                   on_result: Any) -> tuple:
    """PHASE 2 -- sweep each entry under a stop condition CHECKED BETWEEN THEM.

    Returns `(swept, unswept, refused, refusals, stopped)`: the handles swept, the
    handles never started, the count and list of refusals raised by `evaluate`, and
    the word `stop_reason()` answered with (or `None`).

    ⛔ THE STOP IS CHECKED BETWEEN DEFINITIONS, NEVER INSIDE ONE. A mid-definition
    abort would leave a receipt describing a partial universe as a complete one --
    the "quiet market" reading the three-state coverage design exists to keep
    impossible -- so the worst-case overrun is exactly ONE definition and both
    modes size their margin for it.

    ⛔ AND `on_result` RECEIVES EACH ENVELOPE AS IT IS PRODUCED rather than this
    function returning a list of them. The nightly sweep can hand in 500
    definitions over a 3,742-symbol universe; retaining every envelope so a caller
    can sum it afterwards would hold every hit list of every definition in memory
    at once for counts that are three integers.
    """
    swept: list = []
    unswept: list = []
    refused = 0
    refusals: list = []
    stopped = None
    for position, (handle, definition) in enumerate(entries):
        stopped = stop_reason()
        if stopped:
            unswept = [h for h, _ in entries[position:]]
            break
        try:
            out = evaluate(definition)
        except ScanRunRefused as exc:
            refused += 1
            refusals.append({"def_hash": handle, "gate": exc.gate,
                             "detail": exc.detail[:200]})
            continue
        except Exception as exc:                             # noqa: BLE001
            refused += 1
            refusals.append({"def_hash": handle, "gate": "not-scannable",
                             "detail": f"{type(exc).__name__}: {exc}"[:200]})
            log.exception("[scan] sweep failed for %s", handle[:15])
            continue
        swept.append(handle)
        on_result(out)
    return swept, unswept, refused, refusals, stopped


def run_sweep(definitions: Sequence[Any], tf: str = DEFAULT_TF, *,
              universe: Optional[Sequence[str]] = None,
              as_of: Optional[Any] = None,
              deadline: Optional[datetime.datetime] = None,
              mode: str = NIGHTLY) -> Optional[dict]:
    """Sweep every definition once, WITHIN A WALL-CLOCK BUDGET. ``None`` when the
    run could not proceed at all.

    ⛔ A TRANSIENT FAILURE OF THE WHOLE RUN RETURNS `None`, NOT AN EMPTY RESULT.
    `scan_gainers._build_reference` returns `None` on a provider miss *"so the job
    retries next request instead of caching an empty day"*, and `scan_coverage` is
    only written when a definition COMPLETED -- so a half-run leaves no receipt
    and reads as `coverage() is None` = never ran. That is E-2's third reading
    being kept impossible.

    ⭐ DEFINITIONS ARE DEDUPED BY `def_hash`. Two members who typed the same
    formula have the same maths, share one result set and cost the pod ONE sweep;
    that is the property that makes the store member-independent, and it is the
    only place in this file where the number of MEMBERS could ever have leaked in.

    🔴 THE BUDGET LIVES HERE BECAUSE THIS IS THE ONLY THING THAT KNOWS HOW LONG
    IT HAS BEEN RUNNING. The cron registration knows when to START; `max_instances=1`
    prevents a second sweep OVERLAPPING the first and does nothing whatsoever about
    the first one still running at 09:30. `deadline` defaults to `sweep_deadline()`
    — the market open minus `SWEEP_STOP_BEFORE_OPEN`, derived.

    ⛔ CHECKED BETWEEN DEFINITIONS, NEVER INSIDE `evaluate_one`. A definition is
    swept or it is not: a mid-definition abort would write a receipt describing a
    partial universe as a complete one, which is exactly the reading `scan_coverage`
    exists to make impossible.

    🔴 AND WHAT IT DID NOT REACH IS NAMED. `unswept` / `unswept_definitions` /
    `stopped_early` sit BESIDE the other counts, never inside them, for the same
    reason `withheld` does — and the receipt CLOSES:
    ``definitions == swept + refused + duplicate + unswept``. Without that
    identity a sweep that dropped definitions on the floor would look exactly like
    a sweep that had fewer to do.

    ⭐ `mode='live'` IS A SECOND MODE OF THIS FUNCTION, NOT A SECOND FUNCTION.
    Phase 1 (`_resolve_entries`) and phase 2 (`_sweep_entries`) are SHARED; what
    differs is the receipt, the stop condition and what gets written -- see
    `_run_live_cycle`. A copy would be a second answer to "is this definition
    scannable" and a second budget rail to keep true.
    """
    if mode not in MODES:
        raise ValueError(f"mode {mode!r} is not one of {MODES}.")
    if mode == LIVE:
        return _run_live_cycle(list(definitions or []), tf, universe=universe,
                               deadline=deadline)
    if mode == ON_DEMAND:
        raise ValueError(
            "mode='on-demand' is a property of ONE definition's run, not of a "
            "sweep: `evaluate_one(..., mode='on-demand')` is the door (W4a). A "
            "sweep that wrote nothing would leave no receipt for anyone to read.")

    definitions = list(definitions or [])
    if not definitions:
        log.warning("[scan] sweep asked for 0 definitions -- nothing to run")
        return None

    if universe is None:
        universe = snapshot_builder._load_universe()
    if not universe:
        log.warning("[scan] sweep found no universe -- refusing to write an "
                    "empty day's receipts")
        return None

    session = int(scan_store._normalise_as_of(
        as_of if as_of is not None else expected_session()))
    tf_code = scan_store._normalise_tf(tf)
    started = _now_et()
    if deadline is None:
        deadline = sweep_deadline(started)

    # ⭐ PHASE 1 -- RESOLVE EVERY DEFINITION TO ITS MATHS, BEFORE SWEEPING ANY.
    entries, refused, duplicate, refusals = _resolve_entries(definitions)
    seen = {handle for handle, _ in entries}

    entries = _resume_order(entries, tf_code, session)

    # ⭐ PHASE 2 -- SWEEP UNDER THE CLOCK.
    totals = {"hits": 0, "recorded": 0}

    def _tally(out) -> None:
        totals["hits"] += len(out["hits"])
        totals["recorded"] += out["recorded"]

    swept_handles, unswept, refused2, refusals2, stopped = _sweep_entries(
        entries,
        evaluate=lambda definition: evaluate_one(
            definition, tf, universe=universe, as_of=session),
        stop_reason=lambda: UNSWEPT_REASON if _now_et() >= deadline else None,
        on_result=_tally)
    swept = len(swept_handles)
    refused += refused2
    refusals += refusals2
    stopped_early = stopped is not None
    hit_rows, recorded = totals["hits"], totals["recorded"]

    _assert_sweep_closes(handed=len(definitions), swept=swept, refused=refused,
                         duplicate=duplicate, unswept=len(unswept))
    elapsed = (_now_et() - started).total_seconds()

    # ⛔ "WE RAN OUT OF NIGHT" MUST NEVER READ AS "THERE WAS NOTHING TO SCAN", so
    # the line names BOTH numbers and the truncation gets its own WARNING. With
    # zero live definitions today a truncated sweep and an idle one would
    # otherwise log identically.
    log.info("[scan] sweep done as_of=%s handed=%s distinct=%s swept=%s "
             "refused=%s duplicate=%s unswept=%s stopped_early=%s hits=%s "
             "recorded=%s elapsed=%.1fs deadline=%s",
             session, len(definitions), len(seen), swept, refused, duplicate,
             len(unswept), stopped_early, hit_rows, recorded, elapsed,
             deadline.isoformat())
    if stopped_early:
        log.warning(
            "[scan] sweep STOPPED EARLY on its wall-clock budget (%s): %s of %s "
            "distinct definitions swept in %.1fs, %s NEVER LOOKED AT and "
            "carrying NO scan_coverage row for as_of=%s. The deadline was %s "
            "(the market open minus %s). This is NOT an empty night -- the "
            "unswept definitions lead the next run. First unswept: %s",
            UNSWEPT_REASON, swept, len(seen), elapsed, len(unswept), session,
            deadline.isoformat(), SWEEP_STOP_BEFORE_OPEN,
            ", ".join(h[:15] for h in unswept[:5]))

    return {"as_of": session, "tf": tf_code,
            "definitions": len(definitions), "distinct": len(seen),
            "swept": swept, "refused": refused, "duplicate": duplicate,
            "hits": hit_rows, "recorded": recorded, "refusals": refusals,
            "unswept": len(unswept),
            "unswept_definitions": unswept[:_DROPPED_LISTED_MAX],
            "unswept_listed": len(unswept[:_DROPPED_LISTED_MAX]),
            "unswept_reason": UNSWEPT_REASON if stopped_early else None,
            "stopped_early": stopped_early,
            "deadline": deadline.isoformat(),
            "elapsed_seconds": elapsed}


# --------------------------------------------------------------------------- #
# the LIVE cycle (spec 5.5) -- the same two phases, a different receipt, a
# different stop condition, and a different table
# --------------------------------------------------------------------------- #

def _blank_live_receipt(**seed) -> dict:
    """EVERY key a live receipt can carry, on EVERY cycle, whatever stopped it.

    ⛔ THE LIVE TIER'S `_blank_receipt` IDIOM, AND THE REASON IS THE READER. A
    status surface that had to branch on which keys exist would read a missing key
    as a zero, and a `disabled` cycle and a swept one would disagree about what a
    receipt IS. So the shape is declared once here and the cycle only ever
    OVERWRITES entries in it.
    """
    receipt = {
        "cycle_started": None, "cycle_started_iso": None, "cycle_seconds": None,
        "session": None, "tf": None, "tick": None,
        "enabled": False, "interval_s": None, "budget_s": None, "deadline": None,
        "definitions": 0, "distinct": 0, "swept": 0, "refused": 0, "duplicate": 0,
        "unswept": 0, "unswept_definitions": [], "unswept_reason": None,
        "evaluated": 0, "answered": 0, "dropped": 0, "not_computable": 0, "hits": 0,
        "refusals": [], "feed_symbols": 0, "skipped_reason": None,
    }
    receipt.update(seed)
    return receipt


def _finish_live(receipt: dict, started: datetime.datetime, *,
                 skipped: Optional[str] = None, swept: Sequence[str] = (),
                 record: bool = True) -> dict:
    """Close the receipt, LOG IT, and file it -- unless there is nothing to file.

    ⛔ A `disabled` CYCLE TOUCHES NO STORE. A receipt row every five minutes for a
    feature nobody turned on is a table filling up with the word "disabled", and
    the first thing a reader would learn from it is to stop reading it.

    ⚠️ `closed` IS RECORDED WHERE `disabled` IS NOT, and the difference is the
    question each answers. "The flag is off" is knowable from the environment; "the
    last cycle ran and the market was shut" is only knowable from the artifact, and
    a status surface that could not tell that from "nothing has run since the
    deploy" would report a dead scheduler as a quiet evening.
    """
    if skipped is not None and skipped not in LIVE_SKIP_REASONS:
        raise ValueError(
            f"{skipped!r} is not one of this cycle's skip reasons "
            f"{LIVE_SKIP_REASONS}. The set is closed: a caller branches on it.")
    receipt["skipped_reason"] = skipped
    receipt["cycle_seconds"] = (_now_et() - started).total_seconds()
    line = ("[scan-live] cycle %s tf=%s session=%s definitions=%s distinct=%s "
            "swept=%s refused=%s duplicate=%s unswept=%s evaluated=%s answered=%s "
            "dropped=%s not_computable=%s hits=%s feed=%s %.1fs skipped=%s")
    args = (receipt["cycle_started"], receipt["tf"], receipt["session"],
            receipt["definitions"], receipt["distinct"], receipt["swept"],
            receipt["refused"], receipt["duplicate"], receipt["unswept"],
            receipt["evaluated"], receipt["answered"], receipt["dropped"],
            receipt["not_computable"], receipt["hits"], receipt["feed_symbols"],
            receipt["cycle_seconds"], skipped)
    # ⛔ A FEED BLACKOUT READS AS A QUIET MARKET OTHERWISE: every symbol refused or
    # not computable is a WARNING, because "we looked at 3,742 names and answered
    # none" is not the same fact as "nothing matched".
    if skipped in ("budget", "build_in_flight") or (
            receipt["evaluated"] > 0 and receipt["answered"] == 0):
        log.warning(line, *args)
    else:
        log.info(line, *args)
    if record:
        scan_store.record_live_cycle(receipt, swept)
    return receipt


def _run_live_cycle(definitions: Sequence[Any], tf: str, *,
                    universe: Optional[Sequence[str]] = None,
                    deadline: Optional[datetime.datetime] = None) -> dict:
    """ONE five-minute cycle: bars-only definitions over the forming bar, written
    to `scan_hits_live`, with the cycle's own receipt row beside it.

    ⛔ IT NEVER RETURNS `None`. The nightly sweep does, because a half-night must
    leave no receipt at all; a cycle ALWAYS answers with a receipt naming why it
    did what it did, because the next thing to read it is a five-minute-old status
    surface that has to tell "the flag is off" from "the scheduler is dead".

    ⏰ IT READS THE CLOCK FOUR TIMES ON A TWO-DEFINITION RUN -- `started`, once
    before each definition, and once in `_finish_live` -- and the wall-clock test
    feeds exactly that many ticks, so a fifth read anywhere is a StopIteration
    there rather than a silently looser budget.
    """
    from api.services import scan_volume

    started = _now_et()
    tick = int(started.timestamp())
    receipt = _blank_live_receipt(
        cycle_started=tick, cycle_started_iso=started.isoformat(), tf=None,
        definitions=len(definitions), enabled=live_enabled(),
        interval_s=live_interval_s(), budget_s=_live_cycle_budget_s())

    if not live_enabled():
        # ⛔ FIRST, AND IT WRITES NOTHING -- not even to say it did nothing.
        return _finish_live(receipt, started, skipped="disabled", record=False)

    tf_code = scan_store._normalise_tf(tf)
    receipt["tf"] = tf_code
    if tf_code != DEFAULT_TF:
        raise ScanRunRefused(
            "tf",
            f"the live sweep evaluates {DEFAULT_TF!r} only in Wave 1; intraday "
            "timeframes arrive with the prewarm ring's MEASURED per-symbol cost "
            f"(spec 5.5), never assumed. Got {tf_code!r}.")

    state = _live_session_state(started)
    if state:
        return _finish_live(receipt, started, skipped=state)
    if not definitions:
        return _finish_live(receipt, started, skipped="no-definitions")
    if universe is None:
        universe = snapshot_builder._load_universe()
    if not universe:
        # ⛔ NEVER SWEEP ZERO SYMBOLS AND FILE THE RESULT: an empty hit list is
        # indistinguishable from a quiet market.
        return _finish_live(receipt, started, skipped="no-universe")

    session = int(started.strftime("%Y%m%d"))
    prev = previous_session(session)
    receipt["session"] = session
    receipt["tick"] = tick
    if deadline is None:
        deadline = started + datetime.timedelta(seconds=_live_cycle_budget_s())
    receipt["deadline"] = deadline.isoformat()

    entries, refused, duplicate, refusals = _resolve_entries(definitions)
    receipt["distinct"] = len(entries)

    # ⭐ THE CADENCE SELECTION, IN PHASE 1 (1.9 us a tree, before any bar is read).
    # A nightly-ceiling tree is counted `refused` under `gate:cadence` so the
    # arithmetic still closes, and it never reaches `evaluate_one` -- which refuses
    # it the same way for a direct caller, so the two doors give one answer.
    eligible = []
    for handle, definition in entries:
        ceiling = cadence_ceiling(definition["compute"].get("ast"))
        if ceiling and "nightly" in ceiling.split("/"):
            refused += 1
            refusals.append({"def_hash": handle, "gate": "cadence",
                             "detail": f"ceiling {ceiling!r}"})
            continue
        eligible.append((handle, definition))
    entries = eligible

    last = scan_store.last_live_cycle(tf_code)
    reached = set(last["swept"]) if last else set()
    entries = _resume_order(entries, tf_code, session,
                            swept_last_time=lambda handle: handle in reached)

    # ⭐ ONCE PER CYCLE, NEVER PER DEFINITION. ~10k names behind a 30 s cache: a
    # per-definition read would make a 100-definition cycle a hundred trips for one
    # answer, and each definition would answer off a slightly different market.
    snapshot = scan_volume.full_market_snapshot() or {}
    receipt["feed_symbols"] = len(snapshot)

    totals = {"evaluated": 0, "answered": 0, "dropped": 0, "not_computable": 0,
              "hits": 0}

    def _tally(out) -> None:
        for key in ("evaluated", "answered", "dropped", "not_computable"):
            totals[key] += out[key]
        totals["hits"] += len(out["hits"])

    def _stop() -> Optional[str]:
        # ⛔ THE BUDGET FIRST. Both are true stops; the budget is the one whose
        # unswept definitions lead the NEXT cycle, so it must not be masked by a
        # build that happens to start in the same instant.
        if _now_et() >= deadline:
            return "budget"
        # ⛔ PROBED, NEVER HELD. A four-minute hold on `_BUILD_LOCK` would starve
        # the live TIER's own 60 s cadence, which refuses on `build_in_flight`.
        if snapshot_builder.build_in_flight():
            return "build_in_flight"
        return None

    swept, unswept, refused2, refusals2, stopped = _sweep_entries(
        entries,
        evaluate=lambda definition: evaluate_one(
            definition, tf_code, universe=universe, as_of=session, mode=LIVE,
            snapshot=snapshot, tick=tick, prev_session=prev),
        stop_reason=_stop, on_result=_tally)

    receipt.update(
        swept=len(swept), refused=refused + refused2, duplicate=duplicate,
        unswept=len(unswept), unswept_definitions=unswept[:_DROPPED_LISTED_MAX],
        unswept_reason=LIVE_UNSWEPT_REASON if stopped == "budget" else None,
        refusals=refusals + refusals2, **totals)
    _assert_sweep_closes(handed=len(definitions), swept=len(swept),
                         refused=refused + refused2, duplicate=duplicate,
                         unswept=len(unswept))
    return _finish_live(receipt, started, skipped=stopped, swept=swept)


def note_demand(symbols: Sequence[Any]) -> None:
    """Symbols a member or a definition just NAMED, forwarded to the ring's OWNER.

    ⭐ A THIN DELEGATE AND NOTHING ELSE. The lane contract names
    `scan_evaluator.note_demand`, but the ring itself lives on `scan_store` because
    the off-request-path rail forbids a ROUTER importing anything from this module
    -- and W4a's run-now door has to be able to note demand too. A second ring here
    would be a second answer to "what did somebody just ask about".
    """
    scan_store.note_demand(symbols)


def definitions_to_sweep() -> list:
    """Every live `ast` definition on the box, DEDUPED BY MATHS.

    ⚠️ THIS IS THE ONLY MEMBER-SHAPED READ IN THE FILE, AND IT COLLAPSES
    IMMEDIATELY. The store is keyed per member; the sweep is not, and neither is
    anything it writes -- so the member column dies here, at the door, rather than
    being carried into `scan_hits` where E-2 deliberately has no room for it.
    """
    from api.services import user_definitions
    out: list = []
    seen: set = set()
    for row in user_definitions.live_definitions():
        definition = row.get("definition")
        if not isinstance(definition, dict):
            continue
        compute = definition.get("compute")
        if not isinstance(compute, dict) or compute.get("kind") != scan_definition.AST_KIND:
            continue
        handle = row.get("ast_hash")
        if handle in seen:
            continue
        seen.add(handle)
        out.append(definition)
    return out


def sweep_job() -> None:
    """The scheduled entry point. ⛔ THE RETURN VALUE IS COUNTED, NEVER TRUSTED.

    `lesson_scheduler_job_return_value_goes_nowhere`: APScheduler discards what a
    job returns and silence reads as success. So the success criterion is the
    ARTIFACT -- a `scan_coverage` row existing for today's `as_of`, READ BACK out
    of the store -- and that is what this logs.

    ⚠️ IF THIS JOB IS EVER ADDED TO A READINESS SURFACE it must mark done ONLY on
    a read-back row. `rs_ranking`'s warmer calls `readiness.mark_done("rs_rankings")`
    EVEN ON FAILURE, which is how a permanently-green monitor happens
    (`lesson_health_check_reads_a_proxy_not_the_artifact`).
    """
    try:
        definitions = definitions_to_sweep()
    except Exception as exc:                                 # noqa: BLE001
        log.exception("[scan] could not read the definitions to sweep: %s", exc)
        return
    receipt = run_sweep(definitions)
    if not receipt:
        log.warning("[scan] sweep did not run")
        return
    # THE ARTIFACT, NOT THE CALL.
    proven = 0
    for definition in definitions:
        try:
            handle = scan_definition.assert_scannable(definition)["def_hash"]
        except Exception:                                    # noqa: BLE001
            continue
        if scan_store.coverage(handle, receipt["tf"], receipt["as_of"]) is not None:
            proven += 1
    log.info("[scan] sweep receipts read back: %s of %s definitions carry a "
             "scan_coverage row for as_of=%s", proven, receipt["distinct"],
             receipt["as_of"])
    # ⛔ THE SHORTFALL IS EXPLAINED IN THE SAME BREATH AS THE COUNT, OR THE COUNT
    # IS A MYSTERY. "receipts read back: 200 of 500" beside nothing else reads as
    # 300 silent failures; it is the budget, it is expected, and the reader has
    # to be told which of the two it is looking at.
    if receipt.get("stopped_early"):
        log.warning(
            "[scan] %s of those %s have NO receipt because the wall-clock budget "
            "stopped the sweep before it reached them (%s, deadline %s) -- NOT "
            "because they failed. They lead the next run.",
            receipt.get("unswept"), receipt["distinct"],
            receipt.get("unswept_reason"), receipt.get("deadline"))


def live_sweep_job() -> None:
    """The SCHEDULED entry point for the five-minute cycle.

    ⛔ THE FLAG IS CHECKED HERE FIRST, BEFORE `definitions_to_sweep()`. That is the
    only member-shaped read in this file -- it opens the definitions store -- and a
    dark job doing it every five minutes through the session is a cost nobody asked
    for. `run_sweep` re-checks the flag per call, so the two cannot disagree; this
    one is about not paying for a feature that is off.

    ⛔ AND THE RETURN VALUE IS COUNTED, NEVER TRUSTED
    (`lesson_scheduler_job_return_value_goes_nowhere`): APScheduler discards what a
    job returns and silence reads as success. The success criterion is the
    ARTIFACT -- the cycle receipt row, READ BACK out of the store.
    """
    if not live_enabled():
        return
    try:
        definitions = definitions_to_sweep()
    except Exception as exc:                                 # noqa: BLE001
        log.exception("[scan-live] could not read the definitions to sweep: %s", exc)
        return
    receipt = run_sweep(definitions, mode=LIVE)
    # THE ARTIFACT, NOT THE CALL.
    filed = scan_store.last_live_cycle(receipt.get("tf") or DEFAULT_TF)
    log.info("[scan-live] receipts read back: cycle=%s swept=%s hits=%s answered=%s",
             (filed or {}).get("cycle_started"), len(((filed or {}).get("swept") or [])),
             ((filed or {}).get("receipt") or {}).get("hits"),
             ((filed or {}).get("receipt") or {}).get("answered"))
    # ⛔ THE SHORTFALL IS EXPLAINED IN THE SAME BREATH AS THE COUNT, or the count is
    # a mystery: "swept 40 of 90" beside nothing else reads as 50 silent failures.
    if receipt.get("unswept"):
        log.warning(
            "[scan-live] %s of %s definitions were NOT reached (%s, deadline %s) -- "
            "NOT because they failed. They lead the next cycle.",
            receipt.get("unswept"), receipt.get("distinct"),
            receipt.get("unswept_reason") or receipt.get("skipped_reason"),
            receipt.get("deadline"))


def enabled() -> bool:
    """The sweep's own flag, default OFF in code — =1 on Railway web. E-4 IS
    wired (Wave 4): the results feed `query.run_scan`'s scan filter, the
    my_scans meta category, and `GET /api/scans/definition-results`. Default
    stays OFF so a bare local run never spends the night sweeping."""
    return os.environ.get("SCAN_SWEEP_ENABLED", "0") == "1"
