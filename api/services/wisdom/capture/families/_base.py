"""Reader plumbing shared by every D12 capture family (docs/wisdom/CONTRACTS.md §6.1).

THE READER CONTRACT
  Every reader is ``read(*, as_of=None, now_et, state) -> dict`` and returns

      {"family", "as_of", "captured_at", "source", "rows", "payload", "gaps", "meta"}

  and NEVER raises. ``gaps`` is ``{name: reason}``: a thing the reader could not
  get, named, so "we could not read it" is never confused with "there was
  nothing". ``payload is None`` means the SOURCE was unreadable (the runner
  records status ``unreachable``, health ``missing``); an empty list or dict means
  the source was read and held nothing (health ``zero``). ``meta`` carries the
  small deterministic facts the runner needs (watermark window, stale session).

  ``payload`` may be a :class:`RowStream` instead of a list, for the two sources
  too large to hold in memory on the web pod (screener_rows, pattern_detections).
  The runner iterates it exactly once, in ``fetchmany`` batches.

READ-ONLY
  Every product SQLite store is opened through :func:`ro_connect`
  (``file:…?mode=ro``) — never through the product module's own connect(), which
  for several stores creates the file, runs DDL or ATTACHes another database.
  Paths are resolved through the product module's own path function so this
  package never restates a data-root literal.
"""
from __future__ import annotations

import datetime as dt
import functools
import logging
import os
import pathlib
import sqlite3
from typing import Any, Callable, Iterator, Optional

from api.services.wisdom.core import timeutil

log = logging.getLogger(__name__)

RESULT_KEYS = ("family", "as_of", "captured_at", "source", "rows", "payload", "gaps")


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def to_date(value: Any) -> Optional[dt.date]:
    """A date from a date, datetime, 'YYYY-MM-DD…' string or YYYYMMDD int/str; else None."""
    if value is None or value == "":
        return None
    if isinstance(value, dt.datetime):
        return timeutil.to_et(value).date()
    if isinstance(value, dt.date):
        return value
    text = str(value).strip()
    try:
        if len(text) == 8 and text.isdigit():
            return dt.date(int(text[:4]), int(text[4:6]), int(text[6:8]))
        return dt.date.fromisoformat(text[:10])
    except ValueError:
        return None


def iso(value: Any) -> Optional[str]:
    d = to_date(value)
    return d.isoformat() if d else None


def result(family: str, *, as_of: Any, source: str, rows: Optional[int], payload: Any,
           gaps: Optional[dict] = None, meta: Optional[dict] = None) -> dict:
    return {
        "family": family,
        "as_of": iso(as_of),
        "captured_at": utc_now_iso(),
        "source": source,
        "rows": rows,
        "payload": payload,
        "gaps": dict(gaps or {}),
        "meta": dict(meta or {}),
    }


def unavailable(family: str, *, as_of: Any, source: str, gap: str, reason: str,
                gaps: Optional[dict] = None, meta: Optional[dict] = None) -> dict:
    merged = dict(gaps or {})
    merged[gap] = reason
    return result(family, as_of=as_of, source=source, rows=None, payload=None, gaps=merged, meta=meta)


def safe_reader(family: str, source: str) -> Callable:
    """The reader can never raise into the runner, and never returns a wrong shape."""

    def decorate(fn: Callable[..., dict]) -> Callable[..., dict]:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs) -> dict:
            as_of = kwargs.get("as_of")
            try:
                out = fn(*args, **kwargs)
            except Exception as exc:  # noqa: BLE001 — the contract is "never raises"
                log.exception("[wisdom capture] reader %s raised", family)
                return unavailable(family, as_of=as_of, source=source, gap="reader_exception",
                                   reason=f"{type(exc).__name__}: {exc}"[:500])
            if not isinstance(out, dict) or any(k not in out for k in RESULT_KEYS):
                return unavailable(family, as_of=as_of, source=source, gap="reader_shape",
                                   reason=f"reader returned {type(out).__name__} without the contract keys")
            out.setdefault("meta", {})
            return out

        wrapper.family = family
        wrapper.source = source
        return wrapper

    return decorate


def ro_connect(path: str) -> sqlite3.Connection:
    """Open an EXISTING SQLite file read-only. Raises FileNotFoundError when absent
    (sqlite3.connect would silently create an empty database there)."""
    if not path or not os.path.exists(path):
        raise FileNotFoundError(path)
    uri = pathlib.Path(path).resolve().as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def table_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]


class RowStream:
    """A bounded-memory, single-pass row source over a read-only SQLite query.

    The query runs when iteration starts and the connection closes when it ends,
    so a reader can hand one back without holding anything open."""

    def __init__(self, path: str, sql: str, params: tuple = (), *, batch: int = 500,
                 transform: Optional[Callable[[dict], dict]] = None):
        self.path = path
        self.sql = sql
        self.params = tuple(params)
        self.batch = batch
        self.transform = transform

    def __iter__(self) -> Iterator[dict]:
        conn = ro_connect(self.path)
        try:
            cur = conn.execute(self.sql, self.params)
            while True:
                chunk = cur.fetchmany(self.batch)
                if not chunk:
                    break
                for row in chunk:
                    item = dict(row)
                    yield self.transform(item) if self.transform else item
        finally:
            conn.close()


# ── Eastern-time windows ────────────────────────────────────────────────────

def et_day_start_epoch(d: dt.date) -> int:
    return int(dt.datetime.combine(d, dt.time(0, 0), tzinfo=timeutil.ET).timestamp())


def slot_epoch(d: dt.date, hour: int, minute: int) -> int:
    return int(dt.datetime.combine(d, dt.time(hour, minute), tzinfo=timeutil.ET).timestamp())


def session_of(now_et: dt.datetime) -> dt.date:
    """The session a capture at ``now_et`` describes (pre-open and non-trading days → prior session)."""
    return timeutil.session_for(now_et)


def watermark_window(state: Optional[dict], as_of: dt.date, hi: int, *, first_window_s: int) -> tuple[int, int, dict]:
    """``(lo, hi, gaps)`` for a delta read keyed on ``as_of``.

    A re-run of the as_of the registry last completed REUSES that window's lower
    bound, so it re-reads the same rows rather than an empty delta. A first run
    (no watermark) reads ``first_window_s`` back from ``hi`` and names the gap."""
    state = state or {}
    gaps: dict = {}
    if state.get("window_as_of") == as_of.isoformat() and state.get("window_lo") is not None:
        lo = int(state["window_lo"])
    elif state.get("watermark") is not None:
        lo = int(state["watermark"])
    else:
        lo = hi - first_window_s
        gaps["first_window"] = (f"no watermark yet; captured the {first_window_s // 3600} h before the slot only. "
                                "Older rows: tools/wisdom/capture_backfill.py")
    if lo >= hi:
        gaps["window_empty"] = (f"as_of {as_of.isoformat()} ends at or before the current watermark; "
                                "use tools/wisdom/capture_backfill.py for past windows")
    return lo, hi, gaps
