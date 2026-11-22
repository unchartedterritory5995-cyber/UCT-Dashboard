"""Each formation date's RS Ratings, computed from bars in memory, and the check of
them against the stored ones.

WHY. The test needs a rating on every formation date. The stored history
(``rs_rating_history``) holds about a year, and five more years of it would be about
12 million rows on a volume with no backup. The daily bars already go back that far,
and a rating is a pure function of them.

NO SECOND RATING. A session's ratings here are the nightly job's own functions over
the same windows: ``rs_history._window_bounds`` (the newest ``READ_BARS`` valid closes
at or before the session, inside the current listing, none when the newest bar is
stale), ``rs_history.window_split_suspect`` (the one split detector, against the
declared list) and ``rs_history.compute_ratings`` (percentiles over the non-ETF names,
ETFs read off that distribution). :func:`windows` is ``rs_history._universe_windows``
with one saving that changes no answer (see it), and a test holds the two equal.

POINT IN TIME. A window is the closes at or before the session, found by bisecting the
symbol's own bar dates; nothing after the session is read. What is "as held today" is
said in the output: the bars themselves (today's adjusted series), the list of which
symbols are ETFs, and the declared split lists.

PURE: this module opens nothing. The caller hands it rows it read read-only.
"""
from __future__ import annotations

from typing import Dict, Iterable, Optional, Tuple

from api.services.screener import rs_history as rh

#: Under this share of stocks with the same rating on the newest stored session the
#: run could read, the verdict says so before PASS or FAIL.
MIN_AGREEMENT = 0.99
#: How many of the largest differences a compared session names.
EXAMPLES = 10


def _ymd(iso_date) -> Optional[int]:
    s = str(iso_date)[:10].replace("-", "")
    return int(s) if len(s) == 8 and s.isdigit() else None


def add_symbol(series: dict, ticker: str, rows: Iterable[tuple], declared) -> bool:
    """Keep one symbol's daily closes for the whole run: ``(ts, closes)`` as typed
    arrays (``rs_history._compact_series``: 12 bytes a bar), its declared split list
    (``None``: unknown) and the dates of those splits. ``rows`` are bars-store rows
    ``(ts, o, h, l, c, v)``, oldest first. False when there is no valid close."""
    compact = rh._compact_series(rows)
    if compact is None:
        return False
    days = tuple(d for d in (_ymd(s[0]) for s in (declared or ())) if d is not None)
    series[str(ticker).upper()] = (compact[0], compact[1], declared, days)
    return True


def windows(series: dict, session_ymd: int) -> Tuple[dict, set]:
    """``(closes_by_ticker, suspects)`` for one session: ``rs_history._universe_windows``.

    The one difference is a saving. The split detector looks for a declared split
    whose date falls after the first and at or before the last of the closes it
    judges (it skips any other: nothing to compare across). So it is asked only for
    a symbol that has such a split, and for every other symbol the answer is the one
    it would have given: not suspect. Most symbols have no split in a given year."""
    closes_by_ticker, suspects = {}, set()
    for t, (ts, closes, declared, days) in series.items():
        bounds = rh._window_bounds(ts, session_ymd, closes)
        if bounds is None:
            continue
        lo, hi = bounds
        if days:
            first, last = ts[max(lo, hi - rh.SCORE_BARS)], ts[hi - 1]
            if (any(first < d <= last for d in days)
                    and rh.window_split_suspect(ts[lo:hi], closes[lo:hi], declared)):
                suspects.add(t)
        closes_by_ticker[t] = closes[lo:hi]
    return closes_by_ticker, suspects


def rate(series: dict, etfs: set, session: str) -> Dict[str, tuple]:
    """``{TICKER: (rating, unrounded score)}`` for one session, as the nightly job
    would have stored it: no entry for a symbol with no fresh window or one the split
    guard marked (the writer stores no row for those).

    The harness keeps no ETF in ``series``: an ETF's rating is interpolated on the
    stocks' distribution and never moves a stock's, so every stock's rating is the
    same with the ETFs left out (a test holds that), at a third less work."""
    closes_by_ticker, suspects = windows(series, rh.session_ymd(session))
    full = rh.compute_ratings(closes_by_ticker, etfs, suspects=suspects)
    return {t: (r["ibd"], r["score"]) for t, r in full.items() if r.get("bars")}


def compare(session: str, stored: Dict[str, tuple], computed: Dict[str, tuple], etfs: set) -> dict:
    """One session's stored ratings beside the computed ones, over STOCKS (an ETF's
    rating is read off the stocks' distribution and is not what the test ranks).

    ``equal_share`` is over the stocks rated in both. A stock rated in one and not
    the other is counted apart, never as a difference of rating."""
    both, equal, only_stored, only_computed, diffs = 0, 0, 0, 0, []
    for t in sorted(set(stored) | set(computed)):
        if t in etfs:
            continue
        a = (stored.get(t) or (None,))[0]
        b = (computed.get(t) or (None,))[0]
        if a is None and b is None:
            continue
        if a is None:
            only_computed += 1
        elif b is None:
            only_stored += 1
        else:
            both += 1
            if int(a) == int(b):
                equal += 1
            else:
                diffs.append({"ticker": t, "stored": int(a), "computed": int(b)})
    diffs.sort(key=lambda d: (-abs(d["stored"] - d["computed"]), d["ticker"]))
    return {"session": session, "stocks": both, "equal": equal,
            "equal_share": (equal / both) if both else None,
            "only_stored": only_stored, "only_computed": only_computed,
            "largest": diffs[:EXAMPLES]}


def cross_check(compared: list, *, stored_sessions: int, readable: int) -> dict:
    """The block the output carries: every compared session, the newest of them (the
    one the verdict reads) and the share over all of them together."""
    out = {"stored_sessions": stored_sessions, "stored_sessions_readable": readable,
           "sessions_compared": len(compared), "min_agreement": MIN_AGREEMENT,
           "newest": None, "overall_equal_share": None, "agrees": None, "sessions": compared}
    if not compared:
        out["note"] = ("no stored rating session could be read in this run"
                       if stored_sessions else "this database holds no stored ratings")
        return out
    newest = max(compared, key=lambda c: c["session"])
    stocks = sum(c["stocks"] for c in compared)
    out["newest"] = newest
    out["overall_equal_share"] = (sum(c["equal"] for c in compared) / stocks) if stocks else None
    out["agrees"] = bool(newest["equal_share"] is not None and newest["equal_share"] >= MIN_AGREEMENT)
    return out
