"""D2 CP2 — ⭐ THE FIRST PRODUCT READER OF THE CANONICAL ADDRESS BOOK.

⚰️ CP1's rail required that this file not exist. Its retired sentence, verbatim:

    "⛔⛔ NOTHING IN `api/**` READS WHAT THIS WRITES, AND THAT IS ENFORCED.
     `tests/test_canonical_address_book.py::test_no_product_path_reads_the_address_book`
     walks every module under `api/` with prose stripped and fails if one does.
     CP1 is the form written down; CP2 is the first reader, and it needs a new
     line."

That line was granted (GATE-D2, line 2, NARROWED). The rail was not deleted — it
was rewritten to name the ONE module allowed to read the book, so a second
reader still fails by name.

⛔⛔ THIS MODULE ANSWERS OR SAYS IT CANNOT. It never defaults.

An address book exists to turn a name into a location. The failure that matters
is not "the book is missing" — that is loud. It is **a lookup that misses and
returns something plausible anyway**: `row_position()` returning `0` for an
unknown metric would resolve every bad address to the OPEN price and every
consumer would keep working, wrongly, forever. Every accessor here returns
`None` on any doubt, and `None` is the caller's problem to report — which is the
`CoverageLine` distinction between *"we could not compute it"* and *"it is
zero"*, one layer down.

⛔ NOT A RESOLVER. The five-status `resolve(address) -> Resolution` in
SPEC-D2 §3 is CP3 and needs its own line. This reads the manifest; it fetches
nothing, opens no store, and knows no entity.
"""
from __future__ import annotations

import json
import logging
import pathlib
import threading

_logger = logging.getLogger(__name__)

_ROOT = pathlib.Path(__file__).resolve().parents[3]
BOOK_PATH = _ROOT / "api" / "data" / "canonical_address_book.json"

_lock = threading.Lock()
_cache: dict | None = None
_cache_key: tuple | None = None


def _stat_key() -> tuple | None:
    """(mtime_ns, size) — cheap, and it lets a rebuilt book be picked up without
    a process restart. ⛔ Not a TTL: a TTL would make the book's freshness a
    function of the clock rather than of the file, and this file only changes
    when somebody re-derives it."""
    try:
        st = BOOK_PATH.stat()
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size)


def book() -> dict:
    """The derived address book, or `{}` if it cannot be read.

    ⛔ `{}` is a real answer here and it is safe, because every accessor below
    turns an empty book into `None` rather than into a plausible default. A
    raise would be worse: this sits on a member-serving read path, and D2 must
    never be able to take a page down over a manifest it only ADVISES on.
    """
    global _cache, _cache_key
    key = _stat_key()
    if key is None:
        return {}
    with _lock:
        if _cache is not None and _cache_key == key:
            return _cache
        try:
            data = json.loads(BOOK_PATH.read_text(encoding="utf-8"))
        except Exception as exc:                       # noqa: BLE001 — see above
            _logger.warning("[d2] address book unreadable (%s): %s", BOOK_PATH, exc)
            return {}
        if not isinstance(data, dict) or not data.get("metrics"):
            # ⛔ AN EMPTY BOOK IS A FAILED READ UNTIL PROVEN OTHERWISE. A file
            # that parses to `{"metrics": {}}` and a file that is not there are
            # the same fact to a caller, and neither is "this metric does not
            # exist".
            _logger.warning("[d2] address book has no metrics: %s", BOOK_PATH)
            return {}
        _cache, _cache_key = data, key
        return data


def metric(name: str) -> dict | None:
    """The declaration for one metric name, or None."""
    return (book().get("metrics") or {}).get(name)


def store(store_id: str) -> dict | None:
    """The record for one store, or None."""
    return (book().get("stores") or {}).get(store_id)


def row_position(metric_name: str) -> int | None:
    """The metric's ordinal in its store's DECLARED row projection, or None.

    ⛔⛔ THE ORDINAL IS NOT THE SCHEMA POSITION, AND CONFLATING THEM IS THE
    DEFECT THIS FUNCTION EXISTS TO END. `ohlcv`'s DDL is
    `ticker, tf, ts, o, h, l, c, v`, so `c` is column **6**; the row projection
    the store's readers actually hand back is `SELECT ts,o,h,l,c,v`, so `c` is
    position **4**. Both numbers are true about the same column and only one of
    them indexes the tuple in your hand.

    Returns None — never 0, never -1 — when the metric is unknown, its store is
    unknown, the store declares no projection, or the column is not in it.
    """
    m = metric(metric_name)
    if not m:
        return None
    s = store(m.get("store"))
    if not s:
        return None
    projection = s.get("row_projection")
    if not isinstance(projection, list):
        return None
    column = m.get("column")
    if column not in projection:
        return None
    return projection.index(column)
