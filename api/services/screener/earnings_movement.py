"""Earnings-date MOVEMENT — the fact no rival screener can answer.

`calendar_dates.db::calendar_date_history` is one row per symbol carrying the
CURRENT believed report date plus `prev_date`, the date it was believed to be
before the last change. Every benchmarked rival OVERWRITES its earnings date;
none keeps the prior one, so "this company quietly rescheduled" is a fact this
product holds and they structurally cannot. The 594-metric benchmark instrument
has no row for it — it cannot score as a win and it is an edge regardless.

⛔⛔ **THIS MODULE MUST NEVER ANSWER "WHEN DOES THIS COMPANY REPORT."**
`next_earnings_date` / `earnings_session` / `days_to_earnings` have one writer
already — the FMP-backed `screener_earnings_dates.json` artifact read by
`api/services/screener/earnings_dates.py::read_earnings_dates`. A second
authority over the single most consequential date in the product is this repo's
most-repeated defect wearing its best disguise, because `calendar_date_history`
CAN answer it (`report_date` is right there, fresher than the FMP artifact, on
3,096 symbols). It does not, here. This reader emits the MOVEMENT and nothing
from which the date can be reconstructed:

  * `earnings_date_moved_days` is `report_date - prev_date`. Neither operand
    leaves this function.
  * `earnings_date_moved_age_days` is measured against `updated_at`, a write
    timestamp, never against a report date.
  * `earnings_date_moved` is a 0/1 classification.

The one bounded inference a member could draw from this reader is that a symbol
carrying ANY key has a report date at or after the build date (the expiry gate
below). That is a coarse presence fact already answered precisely, and for more
symbols, by `next_earnings_date`; it cannot produce a date. Nothing else leaks.

──────────────────────────────────────────────────────────────────────────────
WHAT THE STORE ACTUALLY SAYS, AND THE THREE PLACES IT WOULD LIE
──────────────────────────────────────────────────────────────────────────────

Writer: `api/services/calendar_date_integrity.py` (`observe` / `observe_many`),
fed from the same Finnhub/FMP calendar payloads the calendar tab already pulls
plus `earnings_table._next_report_date`. On a fresh observation it INSERTs; on a
DIFFERENT date it moves the old date into `prev_date` and stamps `updated_at`;
on an identical date `observe_many` writes nothing at all and `observe` bumps
`updated_at` only.

**(1) A ±90-day "move" is the calendar advancing, not a reschedule.** When a
company reports, the provider's next-report date rolls to the following quarter
and the writer faithfully records a ~90-day "change". Measured on the
2026-08-23 store: of 350 movers whose report date is still in the future,
**216 sit in a tight +88..+113-day band** and exactly one other row exceeds 45
days. Shipping those as "this company delayed earnings by three months" would
make the column mostly noise and occasionally alarming. `_ROLLOVER_DAYS` is the
ceiling; a delta at or beyond it classifies as NOT a reschedule.
Re-derive: histogram `julianday(report_date) - julianday(prev_date)` over
`prev_date IS NOT NULL` and look for the empty band — on 2026-08-23 it ran from
+57 to +87.

**(2) A one-day "move" is very likely the same event redescribed.** The store is
fed by several providers, and an after-close report on Tuesday is routinely
listed as Wednesday by a feed that buckets on the session the market reacts. On
the 2026-08-23 store, **85 of the 133 future-dated sub-quarter moves are exactly
±1 day, split 40 pulled / 45 pushed** — the symmetry of feed disagreement, not
of corporate behaviour. `_MIN_MOVE_DAYS` floors it: |delta| < 2 is not reported
as a move. This deliberately loses a genuine one-day delay. Missing a name is
the safe direction for a screener; announcing a reschedule that never happened
is not.

**(3) A move whose new date has already PASSED is expired, not a signal.** The
company reported; the movement chip would be about an event in the past, and
the store's belief about that symbol is no longer forward-looking. Such a symbol
gets NO keys at all — not `earnings_date_moved = 0`, which would flatly deny a
move that did happen. Mirrors `earnings_dates.run_pull`'s `if rd < today:
continue`. On 2026-08-23 this gate dropped 460 of the 810 recorded movers.

──────────────────────────────────────────────────────────────────────────────
0 IS "WE LOOKED AND THE ANSWER IS NO"; ABSENT IS "WE KNOW NOTHING"
──────────────────────────────────────────────────────────────────────────────

Same contract as `pattern_join`'s per-detector flags. A symbol present in the
store with a still-future report date and no qualifying reschedule gets
`earnings_date_moved = 0`: the store tracks it and has recorded no reschedule.
A symbol the store has never seen, or whose date has expired, or whose row is
malformed, gets no key at all and reads NULL downstream.

⚠️ **The honest limit on that 0, and it must reach the manifest.** `observe_many`
writes NOTHING when a re-observation agrees, so the store cannot distinguish
"confirmed unchanged across twenty sightings" from "seen once, never
re-observed" — measured: on the 2026-08-23 store, **every** `prev_date IS NULL`
row has `updated_at == first_seen`, i.e. exactly one write. `0` therefore means
"no reschedule has been RECORDED for this symbol", which is exactly true and is
weaker than "this date is confirmed stable". Do not let a manifest description
promise the stronger thing.

`earnings_date_moved_days` is SIGNED and carries direction and size in one
number: **positive = pushed back (later), negative = pulled forward (earlier)**.
There is deliberately no separate direction column — it would be `sign()` of
this one, a second authority over one value. Likewise no magnitude column; if
the filter surface cannot express `|x| >= n`, that belongs in the filter
surface, not in a restated column here.

Freshness: this reader NAMES its own staleness rather than answering off a dead
store in silence (`darkpool_agg` is the family's one reader that cannot, and
the 2026-08-23 discovery called it out). The newest `updated_at` in the table is
derived from the rows already read — no second query — and an age past
`_STALE_DAYS` is SERVED but COUNTED, matching `earnings_dates.read_earnings_dates`.

Failure contract, matching every reader in this package: a missing store, a
missing table, or an unreadable file returns `{}` with a counted `_note`; an
empty table returns `{}` counted as "empty"; an individual malformed row costs
only that row and is counted. Nothing here raises into the build.
"""
from __future__ import annotations

import contextlib
import datetime
import os
import pathlib
import sqlite3

from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

#: |delta| below this is not reported as a reschedule — see docstring (2).
_MIN_MOVE_DAYS = 2

#: |delta| at or above this is the quarterly calendar advancing, not a
#: reschedule — see docstring (1). Sits inside the empty band measured between
#: the reschedule population and the quarter-rollover cluster.
_ROLLOVER_DAYS = 45

#: Served-but-counted past this age. Chosen above the widest observed gap
#: between consecutive write-days so the natural cadence never trips it;
#: re-derive by diffing adjacent `DISTINCT date(updated_at)` values (the
#: 2026-08-23 store's widest gap was 4 days across 27 write-days).
_STALE_DAYS = 7


def _note(failures, source, outcome) -> None:
    if failures is None:
        return
    key = outcome if isinstance(outcome, str) else type(outcome).__name__
    failures.setdefault(source, {})
    failures[source][key] = failures[source].get(key, 0) + 1


def _today_et() -> datetime.date:
    """Real ET today. The pod's clock is UTC and a report date is an ET
    calendar fact, so a naive local date would expire an evening's rows a day
    early — the same trap `earnings_dates._now_et` exists to close. Tests
    inject `today` and never reach this."""
    return datetime.datetime.now(_ET).date()


def _store_path() -> str:
    """The store's path has exactly ONE owner — `calendar_date_integrity`'s
    module-level `_DB_PATH`, which resolves `CALENDAR_DATES_DB_PATH` then falls
    back to the repo's `data/` directory. Re-deriving that here would be a
    second authority over one value. Importing the module runs only that path
    resolution; `_ensure_init()` (which CREATEs) is never called from here."""
    from api.services import calendar_date_integrity
    return calendar_date_integrity._DB_PATH


def _connect_ro(path: str) -> sqlite3.Connection:
    """Read-only URI connection. `os.path.abspath` first because a POSIX-style
    default like `/data/calendar_dates.db` is drive-relative on Windows and
    `Path.as_uri()` refuses it; `mode=ro` genuinely refuses writes (a write
    raises `attempt to write a readonly database`), so this is a guard, not a
    decoration."""
    uri = pathlib.Path(os.path.abspath(path)).as_uri() + "?mode=ro"
    return sqlite3.connect(uri, uri=True, timeout=30)


def _iso_date(raw):
    """`YYYY-MM-DD` (or a longer ISO string truncated to its date) or None. A
    row the store wrote by hand or a provider corrupted must cost that row, not
    the read."""
    if not raw:
        return None
    try:
        return datetime.date.fromisoformat(str(raw)[:10])
    except (TypeError, ValueError):
        return None


def _stamp_date_et(raw):
    """The ET calendar date of an aware ISO-8601 UTC timestamp, so an age is
    measured between two ET dates rather than across timezones. Naive stamps
    are read as UTC (the writer only ever writes aware UTC via
    `datetime.now(timezone.utc).isoformat()`; this is the defensive branch)."""
    if not raw:
        return None
    try:
        stamp = datetime.datetime.fromisoformat(str(raw))
    except (TypeError, ValueError):
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=datetime.timezone.utc)
    return stamp.astimezone(_ET).date()


def read_earnings_movement(targets, failures=None, today=None) -> dict:
    """`{TICKER: {column: value}}` for the earnings-date MOVEMENT columns.

    ONE bulk read of the whole 3,096-row table, grouped in Python — never a
    query per ticker. The table is small enough that a full scan beats an
    `IN (...)` list of ~3,700 placeholders, and it is the same shape as
    `context_joins.read_index_flags` / `read_etf_flags`.

    Columns (see the module docstring for why each one is shaped this way):
      `earnings_date_moved`          int 0/1 — a qualifying reschedule is on record
      `earnings_date_moved_days`     int, SIGNED days; + = pushed back, - = pulled forward
      `earnings_date_moved_age_days` int >= 0 — whole days since the store last
                                     wrote this symbol's row

    `today` is injectable (ET date) purely so tests can freeze the clock; the
    build calls this with `(targets, failures)` like every other reader.
    """
    today = today or _today_et()

    try:
        path = _store_path()
        with contextlib.closing(_connect_ro(path)) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT sym, report_date, prev_date, updated_at "
                "FROM calendar_date_history"
            ).fetchall()
    except Exception as e:  # noqa: BLE001 — a dead store degrades, never raises into the build
        _note(failures, "earnings_moved", e)
        return {}

    if not rows:
        _note(failures, "earnings_moved", "empty")
        return {}

    by_sym: dict = {}
    newest_write = None
    for r in rows:
        sym = str(r["sym"] or "").strip().upper()
        if not sym:
            _note(failures, "earnings_moved", "malformed")
            continue
        by_sym[sym] = r
        stamp = _stamp_date_et(r["updated_at"])
        if stamp is not None and (newest_write is None or stamp > newest_write):
            newest_write = stamp

    # Absolute freshness, derived from the rows already in hand (no second
    # query). Served, never silently: a stale store makes the `0` answer decay
    # long before the `1` answers do, and an operator has to be able to see it.
    if newest_write is None:
        _note(failures, "earnings_moved", "no_timestamps")
    else:
        store_age = (today - newest_write).days
        if store_age > _STALE_DAYS:
            _note(failures, "earnings_moved", f"stale:{store_age}d")

    out: dict = {}
    for t in targets:
        tu = str(t or "").strip().upper()
        if not tu:
            continue
        r = by_sym.get(tu)
        if r is None:
            continue  # the store has never seen this symbol -> every column NULL

        report_date = _iso_date(r["report_date"])
        if report_date is None:
            # Without a report date the expiry gate cannot run, so we cannot
            # tell a live signal from an expired one. Say nothing, count it.
            _note(failures, "earnings_moved", "malformed")
            continue
        if report_date < today:
            # The belief has expired — the company already reported. Not a 0
            # (that would deny a move that did happen), not a 1 (it is stale).
            continue

        prev_raw = r["prev_date"]
        if not prev_raw:
            out[tu] = {"earnings_date_moved": 0}
            continue

        prev_date = _iso_date(prev_raw)
        if prev_date is None:
            # A move we cannot size is a move we cannot classify, and an
            # unclassified move is ~62% likely to be a quarter rollover.
            _note(failures, "earnings_moved", "malformed")
            continue

        delta = (report_date - prev_date).days
        if abs(delta) < _MIN_MOVE_DAYS or abs(delta) >= _ROLLOVER_DAYS:
            # Below the floor: a one-day delta is the same event redescribed.
            # At or past the ceiling: the quarterly calendar advancing.
            # Either way the store looked and there is no reschedule to report.
            out[tu] = {"earnings_date_moved": 0}
            continue

        row = {"earnings_date_moved": 1, "earnings_date_moved_days": delta}
        stamp = _stamp_date_et(r["updated_at"])
        if stamp is not None:
            # Clamp a clock-skewed future stamp to 0 ("recorded today") rather
            # than shipping a negative age. A recency we cannot compute is
            # ABSENT — never 0, which would read as "changed today".
            age = (today - stamp).days
            row["earnings_date_moved_age_days"] = age if age > 0 else 0
        else:
            _note(failures, "earnings_moved", "no_timestamp_on_move")
        out[tu] = row

    return out
