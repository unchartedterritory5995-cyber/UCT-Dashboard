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
RUN_GATES = ("snapshot-stale", "no-definition", "not-scannable", "no-universe")

#: Why ONE symbol was tried and failed. Each is a fact about that symbol, and
#: every one of them is re-runnable: fix the bars, rebuild the snapshot, run again.
DROP_REASONS = ("no-bars", "stale-bars", "no-screener-row", "refused")

#: ⛔ ITS OWN BUCKET, controller resolution 5. "We could not compute it at the last
#: confirmed bar" is not "something broke", and a member reading one number for
#: both cannot tell a short-history universe from a failing one.
NOT_COMPUTABLE_REASON = "not-computable"

#: Why a symbol was never looked at. ⚠️ E-7 owns the entitlement axes and the
#: numbers; E-3 owns the WORD, so the sweep and the coverage line cannot end up
#: with two spellings of one fact. Today exactly one reason can be produced.
WITHHELD_REASONS = ("toolkit:symbols",)

#: `_DPC_WARM_MAX_QUEUE`'s shape: a bounded list beside a true count. ⚠️ THE
#: COUNTS ARE NEVER CAPPED; only the enumeration is, and `truncated` says so.
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
    stale date in the detail, because `DROP_REASONS` is a closed set and a fifth
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

    ⚠️ ONE AXIS IS APPLIED HERE AND IT IS `max_symbols` -- BREADTH. `max_history_bars`
    is DELIBERATELY NOT applied: trimming the bars an EMA is seeded from changes
    the number, and spec §1.4 says a toolkit gates BREADTH, NEVER MECHANICS --
    nobody is sold a worse RSI. If the owner wants a history axis it has to be a
    declared, reported outcome (a shorter window makes a long average
    `not_computable`, which is honest) rather than a quietly different value, and
    that is E-7's call to make out loud.
    """
    syms = list(universe)
    cap = getattr(limits, "max_symbols", None) if limits is not None else None
    if cap is None:
        return syms, 0, None
    if isinstance(cap, bool) or not isinstance(cap, int) or cap < 0:
        raise ValueError(
            f"limits.max_symbols must be a non-negative int or None, got {cap!r}")
    if cap >= len(syms):
        return syms, 0, None
    return syms[:cap], len(syms) - cap, WITHHELD_REASONS[0]


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


def _write_rule_record(def_hash: str, rev: int, tf_label: str, rows: Sequence[dict]) -> int:
    """The ONE production call into `definition_record`'s write door.

    ⛔ ONE SITE, AND THE ZERO IT REPLACED WAS ASSERTED. E-6 shipped
    `test_the_record_has_NO_PRODUCTION_WRITER_YET_and_the_ZERO_is_ASSERTED` -- an
    `==` on a derived AST census with a planted-writer control -- and said in its
    own docstring that the number becomes ONE when the sweep lands and the test is
    EDITED to say so. It has been. Deleting it instead is how a second writer
    arrives unnoticed.

    ⛔ AND IT GOES THROUGH THAT MODULE'S DOOR, never a connection of its own. A
    caller that opened `signal_ledger.db` itself would be a second authority over
    one value; E-6's concern 2 names the batching door on `definition_record` as
    the only sanctioned answer if throughput ever needs beating.

    ⛔ A REFUSAL HERE IS COUNTED AND NAMED, NEVER SWALLOWED AND NEVER FATAL. The
    rule record is a SECOND store with its own rules -- forward-only from the
    origin, no inverted window, no empty window -- and it is right to refuse. But
    the SCREEN's answer is already written by the time this runs, and a `ValueError`
    escaping here would take the receipt down with it: a completed sweep would look
    like a sweep that never happened, which is the one reading E-2's three-state
    design exists to keep impossible. So the count comes back beside the writes.
    """
    written = refused = 0
    for row in rows:
        try:
            if definition_record.record_evaluation(
                    def_hash, rev, tf_label, row["sym"], row["first"],
                    row["through"], bars_evaluated=row["evaluated"],
                    bars_true=row["true"]):
                written += 1
        except ValueError as exc:
            refused += 1
            log.warning("[scan] rule record refused %s %s [%s..%s]: %s",
                        def_hash[:15], row["sym"], row["first"], row["through"],
                        exc)
    return written, refused


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


def evaluate_one(definition: Any, tf: str = DEFAULT_TF, *,
                 universe: Optional[Sequence[str]] = None,
                 as_of: Optional[Any] = None,
                 limits: Any = None) -> dict:
    """Run one scan definition over the universe and STATE ITS OWN COVERAGE.

    Returns::

        {def_hash, rev, tf, as_of, freshness,
         hits: [...],
         cadence,
         evaluated, answered, dropped, not_computable,
         withheld, withheld_reason,
         dropped_symbols: [{ticker, reason, detail?}], dropped_listed, truncated,
         recorded, record_refused}

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

    # ⭐ THE GATE APPLIES WHERE ITS REASON APPLIES. A tree that names no declared
    # scalar reads nothing out of `screener_rows`, so a stale snapshot cannot make
    # its answer wrong -- and refusing it anyway would be a gate firing for a
    # reason that is not true, which teaches a reader to ignore the gate.
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
    # ⭐ AND THE HONEST RE-RUN CADENCE COMES OFF THE SAME TREE. See
    # `cadence_ceiling`: a scan naming any declared scalar is capped by that
    # scalar's own declared cadence, because re-reading the nightly snapshot an
    # hour later returns the same answer while implying new information.
    cadence = cadence_ceiling(tree)

    # `max_lookback` resolves every call on its way to a number, so a tree naming
    # a function the table does not declare refuses HERE — once, loudly — rather
    # than 3,742 times inside the loop.
    try:
        lookback = ast_interpret.max_lookback(tree)
    except ast_interpret.TableRefusal as exc:
        raise ScanRunRefused("not-scannable", str(exc)) from exc
    want = min(_MAX_BARS, max(_MIN_BARS, lookback + _MIN_BARS))
    pad = max(0, lookback - 1)
    rows_by_ticker = snapshot_db.get_rows(kept) if scalar_columns else {}

    record_rev = rev if (isinstance(rev, int) and not isinstance(rev, bool)
                         and rev >= 0) else None
    tf_label = ledger._BARS_STORE_TF_KEYS.get(tf_code)
    throughs: dict = {}
    if record_rev is not None and tf_label:
        throughs = definition_record.latest_through_by_symbol(
            def_hash, record_rev, tf_label)

    hits: list = []
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
            if not bars:
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

            column = ast_interpret.interpret(tree, bars, scalars=scalars)
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

            if record_rev is not None and tf_label:
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

    scan_store.record_hits(def_hash, tf_code, session, hits)
    scan_store.record_coverage(
        def_hash, tf_code, session,
        evaluated=evaluated, answered=answered, dropped=dropped,
        not_computable=not_computable, dropped_symbols=unanswered,
        freshness=freshness)

    recorded = record_refused = 0
    if record_rev is not None and tf_label and pending_record:
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
    }


def run_sweep(definitions: Sequence[Any], tf: str = DEFAULT_TF, *,
              universe: Optional[Sequence[str]] = None,
              as_of: Optional[Any] = None) -> Optional[dict]:
    """Sweep every definition once. ``None`` when the run could not proceed.

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
    """
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

    seen: set = set()
    swept = refused = hit_rows = recorded = 0
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
            continue
        seen.add(handle)
        try:
            out = evaluate_one(definition, tf, universe=universe, as_of=session)
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
        swept += 1
        hit_rows += len(out["hits"])
        recorded += out["recorded"]

    log.info("[scan] sweep done as_of=%s definitions=%s swept=%s refused=%s "
             "hits=%s recorded=%s", session, len(definitions), swept, refused,
             hit_rows, recorded)
    return {"as_of": session, "tf": scan_store._normalise_tf(tf),
            "definitions": len(definitions), "distinct": len(seen),
            "swept": swept, "refused": refused, "hits": hit_rows,
            "recorded": recorded, "refusals": refusals}


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


def enabled() -> bool:
    """The sweep's own flag, default OFF. ⛔ E-4 has not wired a surface to these
    results yet, so a sweep that ran by default would spend the pod's night
    building rows nothing can read."""
    return os.environ.get("SCAN_SWEEP_ENABLED", "0") == "1"
