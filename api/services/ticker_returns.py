"""Since-mention returns for a Desk video's ticker moments.

anchor_date = the session day: edu_videos.created_at (epoch) converted to an ET
calendar date — the auto-publish pipeline lands minutes after the session ends,
so created_at's ET date IS the session date. This module is the ONE authority
for anchor_date; the frontend never re-derives it (chips, anchored charts and
the follow-along pane all read it from this payload).

Basis close = last daily close ON or BEFORE the anchor (a mention on a Sunday
session anchors to Friday's close). Symbols with no basis bar (IPO'd later,
never in the universe) are omitted — the client renders those chips plain.
Symbols with no bar AFTER the anchor are also omitted (publish evening: the
session-day bar has ts == anchor, so it hasn't landed in `after` yet) rather
than reported as a fabricated since_pct of 0.0 — % tags appear from the first
trading day after the session. Daily bars ts is a YYYYMMDD int (bars_sqlite)."""
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from api.services import bars_sqlite
from api.services import education_service as edu
from api.services.canonical import address_book as _book
from api.services.canonical import dual_read as _dual

_ET = ZoneInfo("America/New_York")
_TTL_SECS = 600.0
_cache: dict[int, tuple[float, dict]] = {}


def anchor_date_et(created_at: int | float) -> str:
    return datetime.fromtimestamp(int(created_at), tz=_ET).strftime("%Y-%m-%d")


def _pct(basis: float, close: float) -> float:
    return round((close / basis - 1.0) * 100.0, 2)


#: D2 CP2 - the ONE migrated reader, DARK.
#:
#: The bare ordinal this module has used since it was written. It indexes the
#: BARS-STORE ROW PROJECTION `SELECT ts,o,h,l,c,v` declared in
#: `bars_sqlite.py`, NOT the `ohlcv` schema - in the DDL (`ticker, tf, ts, o, h,
#: l, c, v`) the close is column 6. Both numbers are true about the same column
#: and only one of them indexes the tuple in your hand.
CLOSE_METRIC = "ohlcv.c"
LEGACY_CLOSE_INDEX = 4


def _close(row) -> float:
    """The close out of one bars-store row. DARK dual-compute.

    The legacy path is the bare ordinal above. The book path resolves the same
    position from the store's own declared projection. ⛔ THE LEGACY VALUE IS
    WHAT IS SERVED - `_dual.observe` returns it on every branch, and the rail
    that proves so is `tests/test_d2_dual_read.py`.

    ⚰️ THIS REPLACES THREE HAND-TYPED `[4]`s. Nothing in the repo would have
    noticed if that projection changed: `[4]` would silently become the LOW,
    every since-mention percentage on the Desk would be wrong, and no test,
    type or assertion would fire. F-D2-3.
    """
    legacy = row[LEGACY_CLOSE_INDEX]
    if not _dual.should_compare():
        return float(legacy)
    pos = _book.row_position(CLOSE_METRIC)
    if pos is None or pos >= len(row):
        # ⛔ `book_unavailable`, NOT a disagreement. A book that could not
        # answer and a book that answered wrongly are different facts, and
        # collapsing them would make a deleted file read as a defect.
        book_value = _dual.UNAVAILABLE
    else:
        book_value = row[pos]
    return float(_dual.observe(CLOSE_METRIC, legacy, book_value))


def _returns_for(ticker: str, anchor_ymd: int) -> dict | None:
    basis_rows = bars_sqlite.get_bars_before(ticker, "D", 1, anchor_ymd)
    if not basis_rows:
        return None
    basis_c = _close(basis_rows[-1])
    if basis_c <= 0:
        return None
    after = bars_sqlite.get_bars_since(ticker, "D", anchor_ymd)
    if not after:
        # Publish evening: the session-day bar has ts == anchor, so it never
        # lands in `after` yet. Omit the symbol rather than report a
        # fabricated since_pct of 0.0 (every chip a false green "+0.0%").
        # The caller drops it from `returns`; anchor_date is unaffected.
        return None
    return {
        "since_pct": _pct(basis_c, _close(after[-1])),
        "d5_pct": _pct(basis_c, _close(after[4])) if len(after) >= 5 else None,
        "d21_pct": _pct(basis_c, _close(after[20])) if len(after) >= 21 else None,
    }


def returns_for_video(video_id: int, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    hit = _cache.get(video_id)
    if hit and hit[0] > now:
        return hit[1]
    video = edu.get_video(video_id)
    if not video or not video.get("created_at"):
        return {"anchor_date": None, "as_of": None, "returns": {}}
    anchor = anchor_date_et(video["created_at"])
    anchor_ymd = int(anchor.replace("-", ""))
    moments = (edu.get_insights(video_id) or {}).get("ticker_moments") or []
    syms = list(dict.fromkeys(
        m.get("ticker") for m in moments if m.get("ticker")))
    returns = {}
    for sym in syms:
        r = _returns_for(sym, anchor_ymd)
        if r is not None:
            returns[sym] = r
    payload = {
        "anchor_date": anchor,
        "as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "returns": returns,
    }
    _cache[video_id] = (now + _TTL_SECS, payload)
    return payload
