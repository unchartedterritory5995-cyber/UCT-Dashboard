"""Append-only Signature signal ledger.

Invariants (enforced HERE, not in callers — wire/store.py precedent):
- rows are INSERT-only; there is no UPDATE path in this module
- first_seen_at is stamped at insert and immutable
- (indicator, version, sym, tf, bar_time, direction) is UNIQUE: recording
  is idempotent, so request-path recording + the nightly sweep can both
  call record_signal without double-entry.
- bar_time is NORMALIZED before it reaches that key (_normalize_bar_time):
  upstream hands one session in three encodings, and a key that spells the
  same session two ways breaks fire-once silently.
- a signal this store cannot key, or cannot serialize, is REFUSED at the
  door, and every refusal is a ValueError. There is no rewrite path, so a bad
  row is bad forever — raising is the only correction this store has.
- False means EXACTLY ONE thing: this signal is already recorded. A dropped
  write must never be reported as a duplicate (see record_signal).
- `tf` is the product-facing timeframe the surface shows — "1D", never the
  bars-store key "D". That used to be this sentence and nothing else, i.e. a
  convention; it is now ENFORCED at the door (`_PRODUCT_TIMEFRAMES`). A second
  writer arrived in Phase C — the indicator alert lane, whose alerts carry the
  bars-store key because that is what `bars_sqlite.get_bars` takes — so the
  spelling this column has never had to defend became something one caller
  would hand over by simply passing the field it already had. A key that spells
  one timeframe two ways breaks fire-once exactly the way an unnormalized
  `bar_time` does, and orphans every row written the other way.

⚠️ A SECOND TABLE LANDED HERE (2026-08-06) AND IT OWES A JUSTIFICATION
----------------------------------------------------------------------
`signature_signals` IS UNCHANGED — not a column, not an index, not the UNIQUE
key, not one line of `record_signal`. What was added is a separate,
also-append-only `signature_coverage` table answering the one question the
signal table structurally CANNOT: **was this symbol evaluated at all?**

A signal row is evidence that something happened. Its ABSENCE is evidence of
nothing: a genuinely quiet tape and a symbol the nightly sweep never walked
produce the byte-identical empty result. Any consumer that wants to serve "no
signal" as an ANSWER rather than as a shrug has to tell those apart, and no
arrangement of the signal table can, because the fact it needs is about a night
on which nothing was written.

It lives in THIS database, beside the rows it certifies, deliberately. A
receipt in a second file could outlive a signal write that failed, and would
then certify a window whose signals were lost — a confident empty answer, which
is worse than a slow one. One file, one schema init, one backup.

And it is append-only like everything else here: one row per (indicator,
version, sym, tf, evaluated window). Coverage is READ as a containment query
over those rows, never written as an UPDATE. There is still no rewrite path in
this module.
"""
from __future__ import annotations

import contextlib
import json
import math
import os
import sqlite3
import threading
import time
from datetime import datetime

_DB_PATH = os.environ.get("SIGNAL_LEDGER_DB_PATH", "/data/signal_ledger.db")
_WRITE_LOCK = threading.Lock()
# Separate from _WRITE_LOCK, which record_signal already holds by the time it
# writes: a single non-reentrant lock covering both would deadlock.
_INIT_LOCK = threading.Lock()
_INITED = False

# SQLite's INTEGER is signed 64-bit; past it the driver raises OverflowError.
_INT64_LIMIT = 2 ** 63
# Every column the schema declares NOT NULL and stores as TEXT.
_KEY_TEXT_FIELDS = ("indicator", "version", "sym", "tf", "direction")

# The eight timeframes the product actually shows, spelled the way the chart's
# own TF bar spells them (`app/src/pages/charts/widgets/ChartWidget.jsx`). This
# is a WHITELIST rather than a blacklist of the bars-store keys on purpose: the
# failure it exists to stop is a second spelling of one timeframe, and "1d",
# "daily" and "60m" are that failure just as much as "D" is.
_PRODUCT_TIMEFRAMES = frozenset(
    {"1m", "5m", "15m", "30m", "1h", "1D", "1W", "1M"})

# The same eight, keyed by the bars-store code they are stored under, so the
# refusal can say WHICH spelling was handed in instead of only that it was
# wrong. Naming it is the difference between a caller fixing the bug and a
# caller deleting the alert.
_BARS_STORE_TF_KEYS = {"1": "1m", "5": "5m", "15": "15m", "30": "30m",
                       "60": "1h", "D": "1D", "W": "1W", "M": "1M"}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS signature_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indicator TEXT NOT NULL,
  version TEXT NOT NULL,
  sym TEXT NOT NULL,
  tf TEXT NOT NULL,
  direction TEXT NOT NULL,
  bar_time INTEGER NOT NULL,
  price REAL NOT NULL,
  first_seen_at REAL NOT NULL,
  meta_json TEXT,
  UNIQUE(indicator, version, sym, tf, bar_time, direction)
);
CREATE INDEX IF NOT EXISTS idx_sig_sym_seen ON signature_signals(sym, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sig_seen ON signature_signals(first_seen_at DESC);
"""

# The coverage receipt. See the ⚠️ block in the module docstring for why it is
# a second table in this file rather than a second file, and why nothing above
# this line changed to make room for it.
#
# `first_bar_time`/`through_bar_time` are the INCLUSIVE ends of the window the
# rule actually EVALUATED — not the window someone fetched. They go through
# `_normalize_bar_time`, the same collapse the signal key uses, so a receipt and
# the signals it certifies can never be keyed in two different encodings.
_COVERAGE_SCHEMA = """
CREATE TABLE IF NOT EXISTS signature_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indicator TEXT NOT NULL,
  version TEXT NOT NULL,
  sym TEXT NOT NULL,
  tf TEXT NOT NULL,
  first_bar_time INTEGER NOT NULL,
  through_bar_time INTEGER NOT NULL,
  swept_at REAL NOT NULL,
  UNIQUE(indicator, version, sym, tf, first_bar_time, through_bar_time)
);
CREATE INDEX IF NOT EXISTS idx_sig_cov_lookup ON signature_coverage(
  indicator, version, sym, tf, through_bar_time DESC);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_init() -> None:
    """Create the schema on first use.

    Lazy, because the write path is flag-gated but reads are not: a store whose
    schema is only created by an enabled-only job 500s every reader while the
    feature ships dark (wire/store.py, prod 2026-07-31).
    """
    global _INITED
    if _INITED:
        return
    with _INIT_LOCK:
        if _INITED:
            return
        os.makedirs(os.path.dirname(_DB_PATH) or ".", exist_ok=True)
        with contextlib.closing(_connect()) as c:
            # Both scripts, one init. `CREATE TABLE IF NOT EXISTS` is why a pod
            # holding months of signals gains the coverage table on its next
            # ledger touch with no migration step and no separate flag — and
            # why an old build reading this file is unaffected by its presence.
            c.executescript(_SCHEMA + _COVERAGE_SCHEMA)
            c.commit()
        _INITED = True


def _normalize_bar_time(bar_time) -> int:
    """Collapse every upstream encoding of a bar timestamp onto ONE key.

    The same session arrives three ways in this repo:
      * bars_sqlite daily/weekly/monthly ts .... 20260730     (YYYYMMDD int)
      * the fetch layer / /api/bars JSON ....... "2026-07-30" (ISO string)
      * intraday ts ............................ 1753900000   (unix seconds)

    Stored raw, one session keys three ways, so the nightly sweep re-records
    what the request path already recorded and the receipt shows a signal that
    fired once as having fired twice.

    ISO (anything containing "-", so a timestamped form too) is reduced to its
    date and encoded YYYYMMDD. A YYYYMMDD int and an epoch int are already
    unambiguous and pass through verbatim. Anything else RAISES ValueError:
    an append-only store must refuse a key it would have to guess at.
    """
    if isinstance(bar_time, str) and "-" in bar_time:
        head = bar_time.strip()[:10]
        try:
            d = datetime.strptime(head, "%Y-%m-%d").date()
        except (ValueError, TypeError) as exc:
            raise ValueError(f"unparseable bar_time: {bar_time!r}") from exc
        return d.year * 10_000 + d.month * 100 + d.day
    try:
        n = int(float(bar_time))
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"unparseable bar_time: {bar_time!r}") from exc
    if not -_INT64_LIMIT <= n < _INT64_LIMIT:
        # sqlite3 raises OverflowError from inside execute() for these — a
        # refusal shaped differently from every other refusal here.
        raise ValueError(f"bar_time out of range for INTEGER: {bar_time!r}")
    return n


def record_signal(indicator: str, version: str, sym: str, tf: str, direction: str,
                  bar_time, price: float, meta: dict | None = None) -> bool:
    """Record a signal. True if a NEW row landed, False if it already existed.

    Normalization and validation happen BEFORE anything touches the database, so
    a refused signal leaves no trace at all — not even a created file. Every
    refusal raises ValueError; False means ONLY "already recorded".

    The NOT NULL columns are validated here rather than left to the schema
    because sqlite3.IntegrityError is the parent of both the UNIQUE failure and
    the NOT NULL failure: a `version=None` (what `rules.VERSIONS.get(typo)`
    hands you) would otherwise be swallowed as a duplicate, silently dropping
    the write AND suppressing every retry of it under fire-once.

    `tf` is checked against `_PRODUCT_TIMEFRAMES` for the same reason and with a
    worse consequence: a wrong-vocabulary `tf` is a VALID row that keys itself
    away from every other row for the same session, so nothing fails and nothing
    ever surfaces it.
    """
    for name, val in zip(_KEY_TEXT_FIELDS,
                         (indicator, version, sym, tf, direction)):
        if not isinstance(val, str) or not val:
            raise ValueError(f"{name} must be a non-empty str, got {val!r}")

    # ⛔ THE TIMEFRAME VOCABULARY, ENFORCED RATHER THAN DOCUMENTED. `tf` is a KEY
    # column: the same session written "1D" once and "D" once is two rows, and
    # this store has no rewrite path to merge them. The alert lane carries the
    # bars-store code (`bars_sqlite.get_bars(sym, "D", n)`), so handing over the
    # field it already holds is the natural mistake, and it is silent — the write
    # SUCCEEDS and simply orphans itself from every row the surface reads.
    if tf not in _PRODUCT_TIMEFRAMES:
        hint = _BARS_STORE_TF_KEYS.get(tf)
        raise ValueError(
            f"tf must be a product timeframe label — one of "
            f"{sorted(_PRODUCT_TIMEFRAMES)} — got {tf!r}"
            + (f"; that is the bars-store key for {hint!r}, which is how this "
               f"column spells it" if hint else "")
        )

    key_time = _normalize_bar_time(bar_time)
    try:
        px = float(price)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"unusable price: {price!r}") from exc
    if not math.isfinite(px):
        # A NaN cannot be corrected later and breaks json.dumps(allow_nan=False)
        # for every future read of the whole list — one row, whole surface.
        raise ValueError(f"non-finite price: {price!r}")

    if meta is not None and not isinstance(meta, dict):
        raise ValueError(f"meta must be a dict or None, got {meta!r}")
    try:
        meta_json = json.dumps(meta, allow_nan=False) if meta else None
    except (TypeError, ValueError) as exc:
        raise ValueError(f"meta is not JSON-serializable: {meta!r}") from exc

    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        try:
            c.execute(
                "INSERT INTO signature_signals"
                " (indicator, version, sym, tf, direction, bar_time, price, first_seen_at, meta_json)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (indicator, version, sym.upper(), tf, direction, key_time,
                 px, time.time(), meta_json),
            )
            c.commit()
            return True
        except sqlite3.IntegrityError as exc:
            # ONLY the dedup collision may become False. Every other integrity
            # failure (NOT NULL, FK) is a dropped write, and reporting a drop as
            # "already recorded" is the one lie fire-once cannot survive.
            if "UNIQUE constraint failed" not in str(exc):
                raise
            return False


def get_signals(sym: str | None = None, limit: int = 200) -> list[dict]:
    """Newest-first read for future private surfaces.

    `id DESC` is a load-bearing tiebreak, not decoration: time.time() is coarse
    enough (notably on Windows) that a sweep recording several signals in one
    pass stamps them identically, and ordering on first_seen_at alone would then
    let the feed reshuffle itself between two reads of the same rows.
    """
    _ensure_init()
    q = "SELECT * FROM signature_signals"
    args: list = []
    if sym:
        q += " WHERE sym = ?"
        args.append(sym.upper())
    q += " ORDER BY first_seen_at DESC, id DESC LIMIT ?"
    args.append(int(limit))
    with contextlib.closing(_connect()) as c:
        return [dict(r) for r in c.execute(q, args).fetchall()]


# ── coverage receipts: "swept through bar X at time T under rule-version V" ──

_COVERAGE_KEY_FIELDS = ("indicator", "version", "sym", "tf")


def _coverage_key(indicator, version, sym, tf) -> tuple[str, str, str, str]:
    """Validate + canonicalize a receipt key, or raise.

    Deliberately NOT a call into `record_signal`'s validation, and deliberately
    NOT sharing its wording. Two gates that share a phrase are how a
    `pytest.raises(match=...)` keeps passing after the OTHER one is deleted —
    it happened on this branch already (Task 9's M1). Every refusal below says
    something no other refusal in this module says.
    """
    for name, val in zip(_COVERAGE_KEY_FIELDS, (indicator, version, sym, tf)):
        if not isinstance(val, str) or not val:
            raise ValueError(
                f"a coverage receipt needs a non-empty str for its {name} slot, got {val!r}")
    if tf not in _PRODUCT_TIMEFRAMES:
        hint = _BARS_STORE_TF_KEYS.get(tf)
        raise ValueError(
            f"coverage receipt refused: {tf!r} would certify a timeframe no signal "
            f"is keyed under; expected one of {sorted(_PRODUCT_TIMEFRAMES)}"
            + (f" — {tf!r} is the bars-store code for {hint!r}" if hint else ""))
    return indicator, version, sym.upper(), tf


def record_coverage(indicator: str, version: str, sym: str, tf: str,
                    first_bar_time, through_bar_time,
                    *, at: float | None = None) -> bool:
    """Certify that `(indicator, version)` EVALUATED `sym` on `tf` across the
    inclusive bar window `[first_bar_time, through_bar_time]`, at time `at`.

    True if a NEW receipt landed; False if this exact window was already
    certified (so a re-run is free, exactly like `record_signal`). Every refusal
    raises ValueError, and for a sharper reason than the signal table's: a
    reader treats a receipt as PROOF and will serve an empty answer on the
    strength of it, so a receipt this store cannot key is worse than none.

    ⛔ THE VERSION IS IN THE KEY AND IT IS THE WHOLE POINT. `VERSIONS["fcb"]` is
    "fcb-v2" today, and the signal table's UNIQUE key already carries it, so a
    retune to fcb-v3 deliberately orphans every existing signal row. A receipt
    that ignored the version would go on certifying "evaluated, nothing found"
    for a rule that never ran — coverage claimed for work never done.

    ⛔ AN INVERTED WINDOW IS REFUSED. `through < first` certifies nothing, and
    a containment test (`first_bar_time <= ? AND through_bar_time >= ?`) is
    satisfied by an inverted row for ANY probe between the two — a receipt that
    covers everything by covering nothing.
    """
    indicator, version, sym, tf = _coverage_key(indicator, version, sym, tf)
    first_key = _normalize_bar_time(first_bar_time)
    through_key = _normalize_bar_time(through_bar_time)
    if through_key < first_key:
        raise ValueError(
            f"coverage receipt refused: its window runs backwards "
            f"({first_bar_time!r} .. {through_bar_time!r})")
    stamped = time.time() if at is None else float(at)
    if not math.isfinite(stamped):
        raise ValueError(f"coverage receipt refused: unusable sweep time {at!r}")

    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        try:
            c.execute(
                "INSERT INTO signature_coverage"
                " (indicator, version, sym, tf, first_bar_time, through_bar_time, swept_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (indicator, version, sym, tf, first_key, through_key, stamped),
            )
            c.commit()
            return True
        except sqlite3.IntegrityError as exc:
            # Same rule as record_signal: ONLY the dedup collision may become
            # False. Anything else is a dropped receipt, and a dropped receipt
            # reported as "already certified" is a claim of coverage that was
            # never written.
            if "UNIQUE constraint failed" not in str(exc):
                raise
            return False


def coverage_covers(indicator: str, version: str, sym: str, tf: str,
                    *, first_bar_time, through_bar_time) -> bool:
    """Does a receipt PROVE `[first_bar_time, through_bar_time]` was evaluated?

    ⭐ THIS IS THE FUNCTION THAT TURNS AN EMPTY ANSWER INTO AN ANSWER. Without
    it, "no signal" and "never looked" are the same empty list, and serving
    that list is `lesson_market_cap_cache_poison` with a confident face on.

    Containment, not overlap: a receipt qualifies only when it starts no later
    than the probe's first bar AND runs no earlier than the probe's last. A
    sweep that ran three nights ago has a `through` older than tonight's newest
    closed bar, so it stops certifying by itself — the staleness needs no clock
    and no TTL.

    False is the answer to every doubt: never evaluated, evaluated under a
    different rule VERSION, evaluated on a different timeframe, or evaluated
    over a window that does not contain this one.
    """
    indicator, version, sym, tf = _coverage_key(indicator, version, sym, tf)
    first_key = _normalize_bar_time(first_bar_time)
    through_key = _normalize_bar_time(through_bar_time)
    if through_key < first_key:
        return False
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT 1 FROM signature_coverage"
            " WHERE indicator = ? AND version = ? AND sym = ? AND tf = ?"
            "   AND first_bar_time <= ? AND through_bar_time >= ? LIMIT 1",
            (indicator, version, sym, tf, first_key, through_key),
        ).fetchone()
    return row is not None


def latest_coverage(indicator: str, version: str, sym: str, tf: str) -> dict | None:
    """The newest receipt for this key, or **None meaning NEVER EVALUATED**.

    The diagnostic half of the pair. `coverage_covers` answers "is THIS window
    proven"; this answers "has this rule ever run here at all", which is what a
    human debugging an empty chart actually wants to know — and it is the only
    way to tell "the sweep does not walk this symbol" from "the sweep is three
    days behind".
    """
    indicator, version, sym, tf = _coverage_key(indicator, version, sym, tf)
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM signature_coverage"
            " WHERE indicator = ? AND version = ? AND sym = ? AND tf = ?"
            " ORDER BY through_bar_time DESC, id DESC LIMIT 1",
            (indicator, version, sym, tf),
        ).fetchone()
    return dict(row) if row is not None else None
