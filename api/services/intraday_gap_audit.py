"""Interior-gap audit for the stored INTRADAY series — scan RTH holes, heal them.

A chart "missing hours or a day" is, on the server, a stored series with REGULAR-
SESSION buckets absent between its first and last row. This module answers two
bounded questions for one (ticker, tf):

  * ``scan_rth_gaps`` — which RTH buckets (09:30 → the session close; 13:00 on a
    half-day, both from ``nyse_calendar`` via ``bars_fetch._session_close_minutes``)
    of the last N sessions are NOT in the store? Pure read: one indexed range query.
    Sessions before the store's first row are depth, not holes, and are not reported;
    buckets that have not closed yet today are not expected.
  * ``heal_gaps`` — re-ask the provider for exactly the gapped sessions
    (``bars_fetch._fetch_intraday_range``, Massive, ``adjusted=true``) and INSERT
    ONLY the rows the store lacks — the same missing-only diff as the delta gap-fill
    (``_delta_keep_bar``) and the deep-fill (``_deepfill_once``). ⛔ It cannot
    fabricate: a bucket the provider also lacks (a no-trade minute on a thin name)
    stays absent and is reported again — that is a fact about the tape, not a hole.

⭐ THE 60m GRID IS NOT TYPED HERE. Expected 60m buckets are the distinct
``bars_fetch.bucket_60_et_unix_seconds`` of every RTH minute, so this audit follows
whatever session alignment that one bucketer encodes.

Bounded: ``sessions`` is capped (``_MAX_SESSIONS``), a heal issues at most
``max_fetches`` provider calls (contiguous gapped sessions share one), and nothing
runs unless called. CLI (dry run unless ``--apply``)::

    python -m api.services.intraday_gap_audit TICKER [--tf 5] [--sessions 5] [--apply]
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Callable, Optional, Sequence
from zoneinfo import ZoneInfo

_log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")
INTRADAY_TFS = ("1", "5", "15", "30", "60")
_MAX_SESSIONS = 30
_RTH_OPEN_MIN = 9 * 60 + 30


def _is_session(d: date) -> bool:
    from api.services.nyse_calendar import NYSE_HOLIDAYS_YYYYMMDD
    return d.weekday() < 5 and (d.year * 10000 + d.month * 100 + d.day) not in NYSE_HOLIDAYS_YYYYMMDD


def _close_minutes(d: date) -> int:
    from api.services.bars_fetch import _session_close_minutes
    return _session_close_minutes(d.year * 10000 + d.month * 100 + d.day)


def recent_sessions(n: int, today: date) -> list[date]:
    """The last ``n`` trading sessions up to and INCLUDING ``today`` (if it is one),
    oldest first."""
    n = max(1, min(int(n), _MAX_SESSIONS))
    out: list[date] = []
    d = today
    for _ in range(n * 3 + 14):
        if _is_session(d):
            out.append(d)
            if len(out) >= n:
                break
        d -= timedelta(days=1)
    return sorted(out)


def expected_rth_buckets(tf: str, session: date, now: Optional[float] = None) -> list[int]:
    """Bucket START instants (unix s) of ``session``'s regular hours that have CLOSED
    by ``now`` (default: all of them). Empty for a weekend / holiday."""
    if tf not in INTRADAY_TFS or not _is_session(session):
        return []
    midnight = datetime(session.year, session.month, session.day, tzinfo=_ET)
    open_ts = int(midnight.timestamp()) + _RTH_OPEN_MIN * 60
    close_ts = int(midnight.timestamp()) + _close_minutes(session) * 60
    if tf == "60":
        from api.services.bars_fetch import bucket_60_et_unix_seconds as _b60
        starts = sorted({_b60(t) for t in range(open_ts, close_ts, 60)})
        ends = starts[1:] + [close_ts]
    else:
        step = int(tf) * 60
        starts = list(range(open_ts, close_ts, step))
        ends = [min(s + step, close_ts) for s in starts]
    if now is None:
        return starts
    return [s for s, e in zip(starts, ends) if e <= now]


def scan_rth_gaps(ticker: str, tf: str, sessions: int = 5, *,
                  now: Optional[float] = None,
                  stored: Optional[Sequence[int]] = None) -> dict:
    """``{"ticker", "tf", "sessions": [iso], "gaps": {iso: [missing bucket ts]},
    "missing": int, "expected": int}`` for the last ``sessions`` sessions."""
    import time as _time
    now = float(now if now is not None else _time.time())
    today = datetime.fromtimestamp(now, _ET).date()
    sess = recent_sessions(sessions, today)
    tk = ticker.upper()
    out = {"ticker": tk, "tf": tf, "sessions": [d.isoformat() for d in sess],
           "gaps": {}, "missing": 0, "expected": 0}
    if tf not in INTRADAY_TFS or not sess:
        return out
    first_midnight = int(datetime(sess[0].year, sess[0].month, sess[0].day, tzinfo=_ET).timestamp())
    if stored is None:
        from api.services import bars_sqlite
        rows = bars_sqlite.get_bars_since(tk, tf, first_midnight - 1) or []
        stored_set = {int(r[0]) for r in rows}
        first_ts = bars_sqlite.get_first_ts(tk, tf)
    else:
        stored_set = {int(t) for t in stored}
        first_ts = min(stored_set) if stored_set else None
    if first_ts is None:
        return out                       # nothing stored: a cold series, not a hole
    for d in sess:
        exp = expected_rth_buckets(tf, d, now)
        # depth, not a hole: a session that ends before the store's first row
        exp = [t for t in exp if t >= first_ts]
        out["expected"] += len(exp)
        miss = [t for t in exp if t not in stored_set]
        if miss:
            out["gaps"][d.isoformat()] = miss
            out["missing"] += len(miss)
    return out


def _session_ranges(isos: Sequence[str]) -> list[tuple[str, str]]:
    """Group gapped session dates into contiguous [from, to] runs (by session order)."""
    ds = sorted(date.fromisoformat(s) for s in isos)
    runs: list[list[date]] = []
    for d in ds:
        if runs and all(not _is_session(x) for x in _days_between(runs[-1][-1], d)):
            runs[-1].append(d)
        else:
            runs.append([d])
    return [(r[0].isoformat(), r[-1].isoformat()) for r in runs]


def _days_between(a: date, b: date):
    d = a + timedelta(days=1)
    while d < b:
        yield d
        d += timedelta(days=1)


def _default_fetch(ticker: str, tf: str, from_iso: str, to_iso: str) -> list[dict]:
    from api.services import bars_fetch
    return bars_fetch._fetch_intraday_range(ticker, tf, from_iso, to_iso)


def heal_gaps(ticker: str, tf: str, scan: dict, *, fetch: Optional[Callable] = None,
              max_fetches: int = 4) -> dict:
    """Fill a scan's gapped sessions from the provider, MISSING ROWS ONLY."""
    from api.services import bars_sqlite
    tk = ticker.upper()
    res = {"ticker": tk, "tf": tf, "fetches": 0, "filled": 0}
    gaps = scan.get("gaps") or {}
    if not gaps:
        return res
    fetch = fetch or _default_fetch
    for lo, hi in _session_ranges(list(gaps))[:max(0, int(max_fetches))]:
        res["fetches"] += 1
        try:
            fetched = [b for b in (fetch(tk, tf, lo, hi) or [])
                       if isinstance(b.get("t"), (int, float))]
        except Exception as e:  # noqa: BLE001
            _log.warning("[gap-audit] %s tf=%s %s..%s fetch failed: %s", tk, tf, lo, hi, e)
            continue
        if not fetched:
            continue
        oldest = min(int(b["t"]) for b in fetched)
        have = {int(r[0]) for r in (bars_sqlite.get_bars_since(tk, tf, oldest - 1) or [])}
        missing = [b for b in fetched if int(b["t"]) not in have]
        if missing:
            res["filled"] += int(bars_sqlite.put_bars(tk, tf, missing, date_tf=False,
                                                      on_conflict="ignore") or 0)
    if res["filled"]:
        try:
            from api.services.cache import cache
            cache.delete_prefix(f"bars_{tk}_{tf}_")
        except Exception:  # noqa: BLE001
            pass
        _log.info("[gap-audit] %s tf=%s filled %d rows in %d fetches",
                  tk, tf, res["filled"], res["fetches"])
    return res


def audit_ticker(ticker: str, tfs: Sequence[str] = INTRADAY_TFS, sessions: int = 5, *,
                 apply: bool = False, now: Optional[float] = None,
                 fetch: Optional[Callable] = None) -> list[dict]:
    """Scan (and with ``apply``, heal then RE-SCAN) every tf of one ticker."""
    out = []
    for tf in tfs:
        scan = scan_rth_gaps(ticker, tf, sessions, now=now)
        row = {"tf": tf, "missing_before": scan["missing"], "expected": scan["expected"],
               "gapped_sessions": sorted(scan["gaps"])}
        if apply and scan["missing"]:
            row.update(heal_gaps(ticker, tf, scan, fetch=fetch))
            row["missing_after"] = scan_rth_gaps(ticker, tf, sessions, now=now)["missing"]
        out.append(row)
    return out


def _main(argv=None) -> int:
    import argparse
    import json
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("ticker")
    ap.add_argument("--tf", action="append", choices=INTRADAY_TFS)
    ap.add_argument("--sessions", type=int, default=5)
    ap.add_argument("--apply", action="store_true", help="heal (default: report only)")
    a = ap.parse_args(argv)
    # counts / timestamps only — never prices
    print(json.dumps(audit_ticker(a.ticker, a.tf or INTRADAY_TFS, a.sessions, apply=a.apply),
                     indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
