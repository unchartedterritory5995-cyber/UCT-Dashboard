"""Canonical HISTORICAL price source for the corrected breadth reconstruction.

⭐⭐ WHY THIS MODULE EXISTS. `bars.db` is the product's *warmed* bar store: it carries
the active, searchable universe and was never populated with the full historical tape.
Using it as the historical levels source made a security's eligibility for a breadth
metric depend on how warm the product's cache happened to be in that era, which is a
data-availability artifact wearing the costume of a market fact. Measured on the
advance/decline cohort, as a share of the point-in-time path population:

    bars.db   NYSE   48.4% (2011) -> 96.6% (2026)    spread 48.2 points
              Nasdaq 47.0%        -> 91.5%           spread 44.5 points
    grouped   NYSE   97.1%        -> 98.9%           spread  1.8 points
              Nasdaq 96.9%        -> 99.6%           spread  2.7 points

A ~48-point secular ramp becomes a ~2-point band, so an A/D count from 2011 and one
from 2026 become comparable quantities instead of a measurement of cache warmth.

⛔⛔ THIS MODULE NEVER DECIDES MEMBERSHIP. `breadth_pit_frame` remains the sole
authority on who is in a universe on a given date; the grouped tape supplies prices
only. Nothing here projects today's listings backwards, and a delisted name is present
for exactly the sessions it traded and absent afterwards.

⛔ AND IT NEVER FALLS BACK TO `bars.db`. If a grouped level a metric needs is
unavailable, that security is ineligible for THAT metric for that session — which is
exactly what `build_levels`' own completeness masks already express. Substituting a
semantically different source invisibly is the defect this module was written to end.

⚠️ VOLUME IS NOT AVAILABLE HERE. `massive.get_grouped_daily_closes` extracts only the
close, so `vol_max52`/`vol_avg20` come back NaN and the volume-derived metrics
(`hvc_52w`, `up_on_volume`, `down_on_volume`) are not computable. The corrected pass
stores none of them, so nothing regresses; the provider does return volume and this is
a one-field extension if that ever changes.
"""
from __future__ import annotations

import bisect
import datetime as _dt
import hashlib
import json
import os
import sys
import threading
from typing import Optional

import numpy as np

from api.services import massive

#: Sessions of history handed to `build_levels`. MUST equal `breadth_live._FRAME_SESSIONS`
#: — the level windows (52-week = 251 completed sessions, `sma200_back21` = closes
#: [-220:-20]) are cut from the TAIL of this frame, so a different width silently moves
#: every level. Asserted by `assert_frame_width()`, which the pass calls at startup.
FRAME_SESSIONS = 380
MIN_FRAME = 221                      # `_levels_for_day`'s own guard, reproduced exactly

_LOCK = threading.Lock()
_CALENDAR: Optional[list] = None
#: master ticker index; APPEND-ONLY so cached per-session index arrays stay valid
_MASTER: list = []
_MASTER_IX: dict = {}
#: iso -> (int32 master-index array, float64 close array)
_SESSION: dict = {}
_ORDER: list = []
_CACHE_MAX = 512                     # > FRAME_SESSIONS so a sequential pass stays warm
_STATS = {"parsed": 0, "hit": 0, "miss": 0}


def _path(iso: str, adjusted: bool = True) -> str:
    return os.path.join(massive._GROUPED_DIR, "%s_%d.json" % (iso, 1 if adjusted else 0))


def session_calendar() -> list:
    """Every settled trading session the durable grouped cache holds, ASC.

    ⭐ THE CALENDAR IS THE CACHE. `get_grouped_daily_closes` refuses to cache an empty
    response ("never cache an empty/error (would pin a non-trading-day miss)"), so a
    cached adjusted file exists if and only if the provider returned results for that
    date — i.e. it traded. Deriving the session list from the files therefore removes
    the last historical dependency on `bars.db`'s SPY rows, and it is deterministic:
    the same cache yields the same calendar on every run.
    """
    global _CALENDAR
    with _LOCK:
        if _CALENDAR is None:
            out = []
            try:
                for fn in os.listdir(massive._GROUPED_DIR):
                    if fn.endswith("_1.json"):
                        out.append(fn[:-7])
            except OSError:
                out = []
            _CALENDAR = sorted(out)
        return _CALENDAR


def cache_identity() -> dict:
    """Durable provenance for the grouped cache — recorded in `pass_meta`."""
    cal = session_calendar()
    h = hashlib.sha256(("\n".join(cal)).encode()).hexdigest()
    total = 0
    try:
        for fn in os.listdir(massive._GROUPED_DIR):
            total += os.path.getsize(os.path.join(massive._GROUPED_DIR, fn))
    except OSError:
        pass
    return {"dir": massive._GROUPED_DIR, "sessions": len(cal),
            "first": cal[0] if cal else None, "last": cal[-1] if cal else None,
            "calendar_sha256": h, "bytes": total}


def _load(iso: str):
    """Parse ONE settled session into (master-index array, close array). Cached.

    ⭐ THE COMPACT FORM IS THE WHOLE OPTIMISATION. A sequential pass asks for 380
    sessions per date and 379 of them are the same 379 it asked for yesterday, so the
    parse must happen once per session for the whole run, not once per date. Storing a
    plain `{ticker: close}` dict would cost ~1 MB per session (~400 MB warm); storing
    an int32 index into an append-only master ticker list plus a float64 array costs
    ~96 KB, and it turns the frame build into a vectorised scatter instead of three
    million dict lookups. The NUMBERS ARE IDENTICAL either way — this is a
    representation change, and `test_grouped_frame_matches_naive_reference` pins that.
    """
    with _LOCK:
        e = _SESSION.get(iso)
        if e is not None:
            _STATS["hit"] += 1
            return e
        _STATS["miss"] += 1
    p = _path(iso, True)
    try:
        with open(p) as fh:
            raw = json.load(fh)
    except (OSError, ValueError):
        return None
    if not raw:
        return None
    idx = np.empty(len(raw), dtype=np.int32)
    val = np.empty(len(raw), dtype=np.float64)
    n = 0
    with _LOCK:
        for k, v in raw.items():
            if not isinstance(v, (int, float)) or not v > 0:
                continue
            t = sys.intern(k.replace(".", "-"))
            i = _MASTER_IX.get(t)
            if i is None:
                i = len(_MASTER)
                _MASTER.append(t)
                _MASTER_IX[t] = i
            idx[n] = i
            val[n] = float(v)
            n += 1
        ent = (idx[:n].copy(), val[:n].copy())
        _SESSION[iso] = ent
        _ORDER.append(iso)
        _STATS["parsed"] += 1
        while len(_ORDER) > _CACHE_MAX:
            _SESSION.pop(_ORDER.pop(0), None)
        return ent


def closes_for(iso: str) -> dict:
    """{ticker: official adjusted close} for ONE settled session, or {}."""
    e = _load(iso)
    if e is None:
        return {}
    idx, val = e
    return {_MASTER[int(i)]: float(v) for i, v in zip(idx, val)}


def official_closes(iso: str, members) -> dict:
    """⭐ CANDIDATE B. The official end-of-session close for exactly `members`.

    The body of a breadth candle is the metric evaluated at the session's official
    close over the SAME population whose intraday path produced the open, high and low.
    `bars.db` could only answer for the names it had warmed — 47-67% of the tape before
    2020 — so the close silently described a smaller market than the path did, and
    `universe_count` closed at the session LOW in 99.7% of US/exchange sessions. That is
    a population collapse wearing a market move's clothes.
    """
    e = _load(iso)
    if e is None:
        return {}
    idx, val = e
    want = members if isinstance(members, (set, frozenset)) else set(members)
    out = {}
    for i, v in zip(idx, val):
        t = _MASTER[int(i)]
        if t in want:
            out[t] = float(v)
    return out


def frame_dates(day_iso: str, n: int = FRAME_SESSIONS) -> list:
    """The `n` settled sessions strictly BEFORE `day_iso`, ASC — the level window."""
    cal = session_calendar()
    hi = bisect.bisect_left(cal, day_iso)
    return cal[max(0, hi - n):hi]


def _row_map(rows: list, size: int) -> np.ndarray:
    """master-index -> row index, -1 where the name is not in this universe."""
    m2r = np.full(max(size, 1), -1, dtype=np.int32)
    for i, t in enumerate(rows):
        mi = _MASTER_IX.get(t)
        if mi is not None:
            m2r[mi] = i
    return m2r


def levels_for_day(tickers: list, day_iso: str, n: int = FRAME_SESSIONS):
    """Canonical levels for `day_iso`, built from grouped history. None if too short.

    ⛔⛔ IT CALLS THE CANONICAL BUILDER. `breadth_live.build_levels` is the one
    definition of every window in the system (prev_close, the SMA sums and their
    completeness masks, the EMA20 seed, `back[b]`, the 251-session 52-week extremes,
    `sma200_back21`). Reimplementing any of them here to "match" would create a second
    definition that drifts. This module changes only where the CLOSES come from.
    """
    from api.services import breadth_live as bl
    dates = frame_dates(day_iso, n)
    if len(dates) < MIN_FRAME:
        return None
    rows = list(tickers)
    closes = np.full((len(rows), len(dates)), np.nan, dtype=np.float64)
    vols = np.full((len(rows), len(dates)), np.nan, dtype=np.float64)
    # Load every session FIRST so the master index has stopped growing, then build the
    # map once. Rebuilding it mid-loop would be correct but quadratic.
    ents = [_load(iso) for iso in dates]
    if sum(1 for e in ents if e is not None) < MIN_FRAME:
        return None
    with _LOCK:
        m2r = _row_map(rows, len(_MASTER))
    for j, e in enumerate(ents):
        if e is None:
            continue
        idx, val = e
        sel = m2r[idx]
        keep = sel >= 0
        closes[sel[keep], j] = val[keep]
    prior_ts = bl._ts_int(_dt.date.fromisoformat(dates[-1]))
    lv = bl.build_levels(rows, closes, vols, prior_ts)
    lv["_source"] = "grouped_adjusted_daily"
    lv["_frame_first"], lv["_frame_last"] = dates[0], dates[-1]
    lv["_frame_sessions"] = len(dates)
    return lv


def naive_levels_for_day(tickers: list, day_iso: str, n: int = FRAME_SESSIONS):
    """Reference implementation: plain dict lookups, no cache, no index arrays.

    Exists ONLY so the optimised path above can be proved equivalent against it. Slow
    on purpose — do not call it from the pass.
    """
    from api.services import breadth_live as bl
    dates = frame_dates(day_iso, n)
    if len(dates) < MIN_FRAME:
        return None
    rows = list(tickers)
    ix = {t: i for i, t in enumerate(rows)}
    closes = np.full((len(rows), len(dates)), np.nan, dtype=np.float64)
    vols = np.full((len(rows), len(dates)), np.nan, dtype=np.float64)
    seen = 0
    for j, iso in enumerate(dates):
        try:
            with open(_path(iso, True)) as fh:
                raw = json.load(fh)
        except (OSError, ValueError):
            continue
        if not raw:
            continue
        seen += 1
        for k, v in raw.items():
            if not isinstance(v, (int, float)) or not v > 0:
                continue
            i = ix.get(k.replace(".", "-"))
            if i is not None:
                closes[i, j] = float(v)
    if seen < MIN_FRAME:
        return None
    prior_ts = bl._ts_int(_dt.date.fromisoformat(dates[-1]))
    return bl.build_levels(rows, closes, vols, prior_ts)


def stats() -> dict:
    with _LOCK:
        return {"cached_sessions": len(_SESSION), "master_tickers": len(_MASTER),
                **_STATS}


def assert_frame_width() -> None:
    """Fail closed if the canonical frame width ever moves out from under us."""
    from api.services import breadth_live as bl
    if bl._FRAME_SESSIONS != FRAME_SESSIONS:
        raise RuntimeError(
            "FRAME_SESSIONS (%d) must equal breadth_live._FRAME_SESSIONS (%d): the level "
            "windows are cut from the tail of this frame, so a mismatch silently moves "
            "every 52-week extreme and every moving average."
            % (FRAME_SESSIONS, bl._FRAME_SESSIONS))
