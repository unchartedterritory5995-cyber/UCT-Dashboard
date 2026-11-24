"""Volume and volatility for the Screener: six columns worked out inside the nightly build's own per-stock bars
pass, from the same stored daily bars every other bar column of the row reads. Never a vendor call, never a second
read of the universe.

Every definition is the one a Terminal panel already prints, called here, never written a second time:

  hv_20, hv_60             STAT's realized volatility (`stock_stats_calc.volatility`): `realized_vol.annualized_hv`
                           (the sample standard deviation of daily log returns, close to close, x sqrt(252)) over the
                           last 20 and 60 returns (`stock_stats_calc.RV_SESSIONS`), in percent to one decimal, the
                           figure STAT prints. None with fewer than 21 / 61 sessions or a non-positive close.
  ad_net_25                VFP's accumulation days less distribution days over the last 25 sessions
                           (`volume_footprint_calc.accumulation`, its first window): an accumulation day closes at
                           least 0.2% above the session before on more volume than the session before, a distribution
                           day at least 0.2% below it on more volume. None with fewer than 26 sessions, or when a
                           session of the 25 cannot be judged (its volume or the session before's is not held): the
                           column always means "of the 25 sessions", never of fewer.
  pocket_pivots_20         VFP's pocket pivots (`volume_footprint_calc.pocket_pivots`) among the last 20 sessions: an
                           up day whose volume exceeds the largest down-day volume of the 10 sessions before it,
                           closing above its 10-day simple average. None with fewer than 31 sessions (each of the 20
                           needs its 10 before it and their own session before), or when an up day of the 20 cannot
                           be judged (a volume not held).
  days_since_pocket_pivot  Sessions from the newest pocket pivot of the last year (VFP's year: sessions after the same
                           calendar day 12 months before the newest) to the newest session: 0 when the newest session
                           is one. None when the last year holds none, or when an up day of that year cannot be judged.
  corr_rel_last            STAT's "in every market correction" (`stock_stats_calc.in_correction`) for ONE decline: the
                           newest S&P 500 decline of 10% or more (a correction or a bear market, MKTH's one definition
                           and finder) that had regained its peak by the row's newest session. The stock's deepest
                           fall inside the index's own window (index peak to index low), from the highest close in the
                           window so far, over the index's depth: below 1 the stock held up better than the index, 0
                           it did not fall at all. None when the stock's history does not reach the index peak (no
                           close within `stock_stats_calc.MAX_GAP_DAYS` days on or before it), or when the index
                           history is not held.

WHERE THE INDEX DECLINES COME FROM: MKTH's own first stage (`market_history.build_indexes`), read ONCE per build by
`index_context`: the same stored S&P 500 closes and the same finder MKTH's panel shows, from the index store's memory
copy or its disk snapshot only. It never starts MKTH's background build and reads no stock. A completed decline is the
same whatever later closes are held (the finder closes a decline the session the peak is regained), so taking the
newest one that recovered on or before the row's newest session is free of look-ahead.

THE BARS: the build's own, as `build_row` holds them (the store through its read door, the current listing only,
the settled newest session). Each is cleaned by STAT's `clean_bars` (positive prices, the high at or above the low, a
volume that is not a number is not held, never 0). `TAIL_BARS` of them feed the first five columns, the year and the
ten sessions before it with room to spare, so each answer equals the one the whole history gives
(tests/test_screener_volume_volatility.py proves it); `corr_rel_last` reads the deep series between the index peak
and the index low only.

A SERIES THAT CONTRADICTS ITSELF (`technicals.series_contradicts_itself`, the build's seam scan): each column whose
window (`WINDOW_BARS`) reaches back to the newest seam is withheld, never computed across two price regimes, and the
build counts it. `corr_rel_last` reads the whole series and is withheld at any seam.

COST (measured 2026-11-23 on invented series, the dev PC shared with other work, not production; the snapshot builder's
receipt `stats["volume_volatility"]` carries the pod's own `ms_per_row`): about 3.8 ms of CPU per row over 300 invented
5,000-bar rows, so about 41 s over an 11,000-row build, most of it STAT's bar cleaning and VFP's year of pocket pivots;
0.1 MB of extra peak memory per row (one row's bars at a time) and 2.9 MB for the one index context (9,000 invented
index closes, 0.25 s).
"""
from __future__ import annotations

import bisect
from typing import Optional

from api.services import market_history_calc as MH
from api.services import realized_vol as RV
from api.services import stock_stats_calc as SC
from api.services import volume_footprint_calc as VF

#: snapshot columns, in the order the view shows them
COLUMNS = ("hv_20", "hv_60", "ad_net_25", "pocket_pivots_20", "days_since_pocket_pivot", "corr_rel_last")
#: the whole-number columns (the other three are REAL)
INT_COLUMNS = ("ad_net_25", "pocket_pivots_20", "days_since_pocket_pivot")

#: realized volatility column -> returns, STAT's two windows in STAT's order
HV_SESSIONS = dict(zip(("hv_20", "hv_60"), SC.RV_SESSIONS))
#: the accumulation / distribution window, VFP's first
AD_SESSIONS = VF.AD_WINDOWS[0]
#: "the last 20 sessions" for the pocket pivot count (the builder's default)
PIVOT_SESSIONS = 20
#: bars one pocket pivot judgement reads: the day, the 10 before it, and the session before the first of those
_PIVOT_REACH = VF.PIVOT_LOOKBACK + 1
#: bars the first five columns are worked out from: a year of sessions (at most 253), the 11 before the first of them,
#: and room to spare, so every answer equals the whole history's
TAIL_BARS = 280
#: bars before the index peak kept in the correction slice, so the "a close within MAX_GAP_DAYS on or before the peak"
#: rule reads what the whole history would give it
SLICE_PAD = SC.MAX_GAP_DAYS

#: column -> how many trailing bars its value reads (the seam rule above). A year of pocket pivots reads a year of
#: sessions and the 11 before the first; the correction ratio reads the whole series.
WINDOW_BARS = {
    "hv_20": HV_SESSIONS["hv_20"] + 1,
    "hv_60": HV_SESSIONS["hv_60"] + 1,
    "ad_net_25": AD_SESSIONS + 1,
    "pocket_pivots_20": PIVOT_SESSIONS + _PIVOT_REACH,
    "days_since_pocket_pivot": SC.YEAR_SESSIONS + 1 + _PIVOT_REACH,
    "corr_rel_last": 10 ** 9,
}


# ── the shapes ───────────────────────────────────────────────────────────────────────────────

def _ymd(t) -> Optional[int]:
    """A bar's `t` (YYYYMMDD, int or text) as an int, or None."""
    if type(t) is int:                                              # the store's own shape: no text round trip
        return t if 10_000_000 <= t <= 99_999_999 else None
    s = str(t if t is not None else "")
    return int(s) if len(s) == 8 and s.isdigit() else None


def _iso(t) -> Optional[str]:
    n = _ymd(t)
    return None if n is None else f"{n // 10000:04d}-{n // 100 % 100:02d}-{n % 100:02d}"


def stat_bars(bars) -> list[tuple]:
    """The build's bar dicts as STAT and VFP read them: `clean_bars` over `(YYYY-MM-DD, o, h, l, c, v)`."""
    return SC.clean_bars([(_iso(b.get("t")), b.get("o"), b.get("h"), b.get("l"), b.get("c"), b.get("v"))
                          for b in bars or ()])


def _no_earnings(_i: int) -> None:
    return None


# ── the five bar columns ─────────────────────────────────────────────────────────────────────

def realized_vol_pct(closes: list, sessions: int) -> Optional[float]:
    """STAT's realized volatility over the last `sessions` returns, percent to one decimal, or None."""
    if len(closes) < sessions + 1:
        return None
    return SC.pct(RV.annualized_hv(closes[-(sessions + 1):]), 1)


def ad_net(tup: list) -> Optional[int]:
    """VFP's accumulation less distribution days over `AD_SESSIONS`, or None (short, or a session not judged)."""
    if len(tup) < AD_SESSIONS + 1:
        return None
    windows = VF.accumulation(tup[-(AD_SESSIONS + 1):])["windows"]
    w = next((w for w in windows if w.get("sessions") == AD_SESSIONS), None)
    if not w or w.get("state") != "ok" or w.get("not_judged"):
        return None
    return w["net"]


def pocket_pivot_fields(tup: list) -> dict:
    """`{pocket_pivots_20, days_since_pocket_pivot}` from VFP's pocket pivots (each None when it cannot be said)."""
    out = {"pocket_pivots_20": None, "days_since_pocket_pivot": None}
    need = PIVOT_SESSIONS + _PIVOT_REACH
    year = VF.pocket_pivots(tup, _no_earnings) if tup else {}
    clean_year = year.get("state") == "ok" and not year.get("not_judged")
    if len(tup) >= need:
        if clean_year:
            # every up day of the year was judged, so the last 20 sessions' pivots are the year's own rows there
            first = tup[-PIVOT_SESSIONS][0]
            out["pocket_pivots_20"] = sum(1 for r in year["rows"] if r["date"] >= first)
        else:
            recent = VF.pocket_pivots(tup[-need:], _no_earnings)
            if recent.get("state") == "ok" and not recent.get("not_judged"):
                out["pocket_pivots_20"] = recent["count"]
    if clean_year and year.get("rows"):
        dates = [b[0] for b in tup]
        out["days_since_pocket_pivot"] = len(tup) - 1 - bisect.bisect_left(dates, year["rows"][0]["date"])
    return out


# ── the correction column ────────────────────────────────────────────────────────────────────

def index_context(now=None) -> dict:
    """ONCE per build: MKTH's completed S&P 500 declines, newest first, from MKTH's own first stage.

    `{state: 'ok', index, first, last, completed: [(recovered, peak, trough as YYYYMMDD ints, episode)], rows, ms,
    seam_withheld}` or `{state: 'not_held'}` (plus the same counters). The counters are the build step's receipt."""
    from api.services import market_history as MKT                 # noqa: PLC0415 -- lazy: the build's only caller
    from api.services import stock_stats as STAT                   # noqa: PLC0415
    base = {"index": STAT.INDEX_KEY, "rows": 0, "ms": 0.0, "seam_withheld": 0}
    blocks, _closes = MKT.build_indexes(now or MKT.now_et())
    block = blocks.get(STAT.INDEX_KEY) or {}
    if block.get("state") != "ok":
        return {**base, "state": "not_held"}
    completed = []
    for ep in block.get("episodes") or ():                          # newest first (describe_episodes)
        if ep.get("ongoing") or not ep.get("recovered"):
            continue
        rec, peak, trough = (_ymd(str(x).replace("-", "")) for x in
                             (ep["recovered"], ep["peak"]["date"], ep["trough"]["date"]))
        if None not in (rec, peak, trough):
            completed.append((rec, peak, trough, ep))
    return {**base, "state": "ok", "first": block.get("first"), "last": block.get("last"),
            "completed": completed, "newest": completed[0][3]["id"] if completed else None}


def corr_rel(bars_full, ctx: Optional[dict]) -> Optional[float]:
    """The stock's drawdown over the index's in the newest decline that had recovered by the row's newest session
    (STAT's `in_correction`), or None."""
    if not ctx or ctx.get("state") != "ok" or not bars_full:
        return None
    last = _ymd(bars_full[-1].get("t"))
    if last is None:
        return None
    hit = next((e for e in ctx["completed"] if e[0] <= last), None)
    if hit is None:
        return None
    _rec, peak, trough, episode = hit
    day = lambda b: _ymd(b.get("t")) or 0                           # noqa: E731
    at_peak = bisect.bisect_right(bars_full, peak, key=day)
    if at_peak == 0:
        return None                                                 # the history starts after the index peak
    end = bisect.bisect_right(bars_full, trough, key=day)
    closes = MH.clean_closes((_iso(b.get("t")), b.get("c"))
                             for b in bars_full[max(0, at_peak - 1 - SLICE_PAD):end])
    got = SC.in_correction(closes, episode) if closes else None
    ratio = None if got is None else got.get("vs_index_ratio")
    # a stock that did not fall is 0.0 over a negative depth: -0.0, stored and printed as a plain 0
    return None if ratio is None else ratio + 0.0


# ── one row ──────────────────────────────────────────────────────────────────────────────────

def row_fields(bars, bars_full, ctx: Optional[dict] = None, seam_since: Optional[int] = None) -> dict:
    """The six columns for one row (every key present, None where it cannot be said).

    `bars` is the build's sanitized 400-bar window, `bars_full` its deep series, `ctx` the build's `index_context`
    (None: `corr_rel_last` is None), `seam_since` the bars since the newest seam of a series that contradicts itself
    (None for an ordinary series)."""
    out = {c: None for c in COLUMNS}
    tup = stat_bars((bars or [])[-TAIL_BARS:])
    if tup:
        closes = [b[4] for b in tup]
        for col, k in HV_SESSIONS.items():
            out[col] = realized_vol_pct(closes, k)
        out["ad_net_25"] = ad_net(tup)
        out.update(pocket_pivot_fields(tup))
    out["corr_rel_last"] = corr_rel(bars_full, ctx)
    if seam_since is not None:
        for col, reach in WINDOW_BARS.items():
            if reach > seam_since:
                out[col] = None
    return out
