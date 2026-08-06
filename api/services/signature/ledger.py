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
            c.executescript(_SCHEMA)
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
