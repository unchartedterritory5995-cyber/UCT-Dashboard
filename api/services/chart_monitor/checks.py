"""Pure check functions for the chart-data synthetic monitor. No I/O, no clock reads.

Every function takes ``now`` (unix seconds) explicitly so DST, half-days and session edges are
testable. ⛔ ONE OWNER PER CONCERN:
  * the bucket grid is ``bar_rollup.tv_bucket_bounds`` (what the stream and the REST 60m
    resample/delta/heal already use), never a re-typed grid;
  * the trading calendar (holidays, half-days, session minutes) is ``session_calendar``
    (``market_calendar.json``, shared with the browser).
A disagreement between this monitor and the server is therefore a SERVING defect, never two
definitions of "the 10:30 bar" drifting apart.

⛔ PRIVACY: details carry counts, booleans, ET timestamps and relative diffs — never a price.
"""
from __future__ import annotations

import bisect
import math
from collections import deque
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import Iterable, Optional, Sequence

from api.services import session_calendar as _sc
from api.services.bar_rollup import tv_bucket_bounds

ET = _sc.ET

PASS, WARN, FAIL, SKIP = "PASS", "WARN", "FAIL", "SKIP"
RANK = {PASS: 0, SKIP: 0, WARN: 1, FAIL: 2}

INTRADAY_TFS = ("1", "5", "15", "30", "60")
STEP_S = {"1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600}

#: Server-Timing ``bars;desc=`` labels that mean "the member got a degraded first answer".
#: The serve-label budget is the share of these over a rolling window.
DEGRADED_LABELS = frozenset({"stale-swr", "delta-deadline", "sd-deadline", "sd-partial"})


@dataclass(frozen=True)
class Verdict:
    status: str
    detail: str = ""

    def __iter__(self):            # (status, detail) unpacking convenience
        return iter((self.status, self.detail))


def worst(statuses: Iterable[str]) -> str:
    out = PASS
    for s in statuses:
        if RANK.get(s, 0) > RANK.get(out, 0):
            out = s
    return out


# ───────────────────────────────────────────────────────────── calendar + grid

def et_dt(ts: int) -> datetime:
    return datetime.fromtimestamp(int(ts), ET)


def et_str(ts: Optional[int]) -> Optional[str]:
    return None if ts is None else et_dt(ts).strftime("%Y-%m-%d %H:%M")


def et_epoch(d: date, minute_of_day: int) -> int:
    """Unix seconds of ET wall-clock ``minute_of_day`` on ``d`` (DST-aware via zoneinfo)."""
    base = datetime(d.year, d.month, d.day, tzinfo=ET)
    # minute_of_day may be 1440 (= next midnight): build from the wall clock, not by adding
    # seconds across a possible DST switch (the switch is at 02:00, outside 04:00-20:00).
    if minute_of_day >= 1440:
        nxt = d + timedelta(days=1)
        return int(datetime(nxt.year, nxt.month, nxt.day, tzinfo=ET).timestamp())
    return int(base.replace(hour=minute_of_day // 60, minute=minute_of_day % 60).timestamp())


def is_trading_day(d: date) -> bool:
    return _sc.is_trading_day(d)


def prev_trading_day(d: date) -> date:
    d -= timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def session_minutes(d: date) -> tuple[int, int, int, int]:
    """(pre_start, open, close, post_end) minutes-of-day ET for trading day ``d``
    (close is 13:00 on a half-day; post still ends 20:00 — session_calendar's convention)."""
    cal = _sc.calendar()
    close = cal.early_closes.get(d, cal.close_min)
    return cal.pre_start_min, cal.open_min, close, cal.post_end_min


def phase_at(now: int) -> str:
    """'pre' | 'rth' | 'post' | 'closed' — session_calendar's answer."""
    return _sc.session_at(et_dt(now))


def session_day_for(now: int) -> date:
    """The trading day whose session grid ``now`` belongs to (or the last one before it)."""
    n = et_dt(now)
    d = n.date()
    if is_trading_day(d) and n.hour * 60 + n.minute >= session_minutes(d)[0]:
        return d
    return prev_trading_day(d)


@lru_cache(maxsize=512)
def day_buckets(d: date, tf: str, session: str = "eth") -> tuple[tuple[int, int], ...]:
    """Every (start, end) bucket of trading day ``d`` for ``tf`` on the server's grid, in order.

    Derived by walking each minute of [pre_start, post_end) through ``tv_bucket_bounds`` — the
    serving grid's single owner — so 60m rth (04:00…09:00, 09:00-09:30 stub, 09:30…15:30 with
    the close-truncated last bar, then clock hours) and 60m eth (clock hours) both fall out of
    the one helper, half-days and DST included. Ends are clipped to the post close."""
    pre, _op, _cl, post = session_minutes(d)
    lo, hi = et_epoch(d, pre), et_epoch(d, post)
    out: list[tuple[int, int]] = []
    t = lo
    while t < hi:
        s_ms, e_ms = tv_bucket_bounds(t * 1000, str(tf), session)
        s, e = max(s_ms // 1000, lo), min(e_ms // 1000, hi)
        if not out or out[-1][0] != s:
            out.append((s, e))
        t = max(e, t + 60)
    return tuple(out)


def rth_buckets(d: date, tf: str, session: str = "eth") -> tuple[tuple[int, int], ...]:
    _pre, op, cl, _post = session_minutes(d)
    lo, hi = et_epoch(d, op), et_epoch(d, cl)
    return tuple((s, e) for s, e in day_buckets(d, tf, session) if s >= lo and e <= hi)


def on_grid(t: int, tf: str, session: str = "eth") -> bool:
    """True when ``t`` is a bucket start for ``tf`` on the serving grid."""
    return tv_bucket_bounds(int(t) * 1000, str(tf), session)[0] // 1000 == int(t)


@dataclass(frozen=True)
class Frontier:
    session_day: date
    #: start of the newest bucket that must already be served (bucket containing now-grace,
    #: or the day's last bucket once the session is over)
    expected_start: int
    #: start of the bucket containing ``now`` (None outside the session window)
    developing_start: Optional[int]
    #: ordered bucket starts of the previous and current session days (for lag counting)
    starts: tuple[int, ...]


def frontier(now: int, tf: str, session: str = "eth", grace: int = 90) -> Frontier:
    """Where an intraday series' tail must be at ``now`` (session-aware, half-day, DST)."""
    ref = int(now) - int(grace)
    sday = session_day_for(ref)
    grid = day_buckets(sday, tf, session)
    prev = day_buckets(prev_trading_day(sday), tf, session)
    starts = tuple(s for s, _ in prev) + tuple(s for s, _ in grid)
    expected = None
    for s, e in grid:
        if s <= ref:
            expected = s
        else:
            break
    if expected is None:                      # before the first bucket: yesterday's last one
        expected = prev[-1][0]
    developing = next((s for s, e in grid if s <= now < e), None)
    return Frontier(sday, expected, developing, starts)


def bucket_lag(fr: Frontier, last_t: int) -> int:
    """How many grid buckets the tail ``last_t`` is behind ``fr.expected_start`` (0 = at or past).
    A tail older than the previous session counts every bucket of both days plus one."""
    if last_t >= fr.expected_start:
        return 0
    i_exp = bisect.bisect_right(fr.starts, fr.expected_start) - 1
    i_last = bisect.bisect_right(fr.starts, last_t) - 1
    if i_last < 0:
        return i_exp + 2
    return max(1, i_exp - i_last)


# ───────────────────────────────────────────────────────────── per-response checks

def _num(x) -> float:
    v = float(x)
    if math.isnan(v) or math.isinf(v):
        raise ValueError("non-finite")
    return v


def check_ohlc(bars: Sequence[dict]) -> Verdict:
    """Every bar: finite numbers, l <= min(o, c) <= max(o, c) <= h, v >= 0 when present."""
    bad = nonnum = 0
    for b in bars:
        try:
            o, h, l, c = (_num(b[k]) for k in ("o", "h", "l", "c"))
            v = b.get("v")
            if v is not None and _num(v) < 0:
                bad += 1
                continue
        except Exception:
            nonnum += 1
            continue
        eps = 1e-9 * max(abs(h), 1.0)
        if not (l <= o + eps and l <= c + eps and o <= h + eps and c <= h + eps and l <= h + eps):
            bad += 1
    return Verdict(FAIL if (bad or nonnum) else PASS, f"bad={bad} nonnum={nonnum}")


def bar_times(bars: Sequence[dict]) -> list:
    out = []
    for b in bars:
        t = b.get("t")
        if isinstance(t, str):
            out.append(t)
        else:
            try:
                out.append(int(t))
            except (TypeError, ValueError):
                continue
    return out


def check_dup_sorted(ts: Sequence) -> Verdict:
    dups = len(ts) - len(set(ts))
    unsorted = sum(1 for a, b in zip(ts, ts[1:]) if b < a)
    return Verdict(FAIL if (dups or unsorted) else PASS, f"dups={dups} unsorted={unsorted}")


def check_grid(ts: Sequence[int], tf: str, session: str = "eth") -> Verdict:
    """Every intraday bar starts on its tf grid (the serving grid for ``session``)."""
    off = [t for t in ts if not on_grid(t, tf, session)]
    eg = ", ".join(et_dt(t).strftime("%m-%d %H:%M:%S") for t in off[:3])
    return Verdict(FAIL if off else PASS, f"off_grid={len(off)}" + (f" e.g. {eg} ET" if off else ""))


def check_daily_grid(dates: Sequence[str], recent: int = 30) -> Verdict:
    """The last ``recent`` daily bars sit on NYSE trading days (inside calendar coverage)."""
    cal = _sc.calendar()
    off = []
    for s in list(dates)[-recent:]:
        try:
            d = date.fromisoformat(str(s)[:10])
        except ValueError:
            off.append(s)
            continue
        if cal.coverage_start <= d <= cal.horizon and not is_trading_day(d):
            off.append(s)
    return Verdict(FAIL if off else PASS, f"off_calendar={len(off)}")


def check_tail(now: int, tf: str, last_t: int, *, session: str = "eth", thin: bool = False,
               grace: int = 90) -> Verdict:
    """The tail is within ONE bucket of the expected frontier.

    Tolerances (WARN, never an alert) are the legitimate quiet cases: a thin name; an
    extended-hours minute on 1/5m with nothing printed (<= 3 buckets); the thin post tail
    after the close (<= 30 min on 1/5m)."""
    fr = frontier(now, tf, session, grace)
    upper = fr.developing_start if fr.developing_start is not None else fr.expected_start
    if last_t > max(upper, fr.expected_start):
        return Verdict(FAIL, f"future bar last={et_str(last_t)} > {et_str(upper)}")
    lag = bucket_lag(fr, last_t)
    if lag <= 1:
        return Verdict(PASS, f"lag={lag}bkt")
    lag_min = (fr.expected_start - last_t) // 60
    detail = f"lag={lag}bkt/{lag_min}min last={et_str(last_t)} expected>={et_str(fr.expected_start)}"
    ph = phase_at(now)
    if thin:
        return Verdict(WARN, detail)
    if ph in ("pre", "post") and tf in ("1", "5") and lag <= 3:
        return Verdict(WARN, detail)
    if ph == "closed" and tf in ("1", "5") and lag_min <= 30:
        return Verdict(WARN, detail)
    return Verdict(FAIL, detail)


def expected_daily_date(now: int, grace: int = 90) -> date:
    """The newest daily bar a chart must show: today once RTH opened (the server includes
    today's developing daily bar), else the previous trading day."""
    n = et_dt(int(now) - int(grace))
    d = n.date()
    if is_trading_day(d) and n.hour * 60 + n.minute >= session_minutes(d)[1]:
        return d
    return prev_trading_day(d)


def check_daily_tail(now: int, last_date: str, *, thin: bool = False, grace: int = 90) -> Verdict:
    try:
        last = date.fromisoformat(str(last_date)[:10])
    except ValueError:
        return Verdict(FAIL, "unparseable daily t")
    exp = expected_daily_date(now, grace)
    today = et_dt(now).date()
    if last > today:
        return Verdict(FAIL, f"future daily bar {last}")
    if last >= exp:
        return Verdict(PASS, f"last={last}")
    behind, d = 0, exp
    while d > last and behind < 30:
        if is_trading_day(d):
            behind += 1
        d -= timedelta(days=1)
    return Verdict(WARN if thin else FAIL, f"last={last} expected>={exp} behind={behind}d")


def check_forming(now: int, tf: str, last_t: int, forming, *, session: str = "eth",
                  grace: int = 90) -> Verdict:
    """RTH only: ``newest_bar_is_forming`` agrees with whether the tail is the developing bucket."""
    if phase_at(now) != "rth":
        return Verdict(SKIP, "outside RTH")
    fr = frontier(now, tf, session, grace)
    dev = fr.developing_start
    if dev is None:
        return Verdict(SKIP, "no developing bucket")
    if last_t == dev and forming is False:
        return Verdict(WARN, "tail is the developing bucket but newest_bar_is_forming=false")
    if last_t < dev and forming is True:
        return Verdict(WARN, "forming=true but the developing bucket is absent")
    return Verdict(PASS, f"forming={forming}")


def gap_runs(expected_starts: Sequence[int], have: set, tf: str) -> tuple[int, int]:
    """(missing count, longest consecutive missing run) of ``expected_starts`` not in ``have``."""
    step = STEP_S.get(str(tf), 60)
    missing = [t for t in expected_starts if t not in have]
    runs, cur, prev = [], 0, None
    for t in missing:
        if prev is not None and t - prev <= step + 1 and cur:
            cur += 1
        else:
            if cur:
                runs.append(cur)
            cur = 1
        prev = t
    if cur:
        runs.append(cur)
    return len(missing), (max(runs) if runs else 0)


def check_rth_gaps(now: int, tf: str, ts: Sequence[int], d: date, *, session: str = "eth",
                   thin: bool = False, grace: int = 90) -> Verdict:
    """Completed RTH buckets of day ``d`` (end + grace <= now) that the series is missing."""
    if not ts:
        return Verdict(SKIP, "no bars")
    if et_epoch(d, session_minutes(d)[1]) < min(ts):
        return Verdict(SKIP, "outside returned window")
    exp = [s for s, e in rth_buckets(d, tf, session) if e + grace <= now]
    if not exp:
        return Verdict(SKIP, "no completed RTH buckets yet")
    n, run = gap_runs(exp, set(ts), tf)
    detail = f"missing={n}/{len(exp)} max_run={run}bkt"
    if n == 0:
        return Verdict(PASS, detail)
    if thin:
        return Verdict(WARN if run * int(STEP_S[str(tf)] / 60) > 30 else PASS, detail)
    if str(tf) == "1" and n <= 2 and run == 1:
        return Verdict(WARN, detail)
    return Verdict(FAIL, detail)


def check_missing_days(now: int, ts: Sequence[int], *, thin: bool = False, grace: int = 90) -> Verdict:
    """Whole trading days absent inside the returned window."""
    if not ts:
        return Verdict(SKIP, "no bars")
    lo = min(ts)
    sday = session_day_for(now)
    have = {et_dt(t).date() for t in ts}
    missing, d = [], et_dt(lo).date()
    while d <= sday:
        if is_trading_day(d) and d not in have and et_epoch(d, session_minutes(d)[1]) >= lo:
            # today before its open (+grace) is the tail check's business, not a missing day
            if not (d == sday and now < et_epoch(d, session_minutes(d)[1]) + grace):
                missing.append(d.isoformat())
        d += timedelta(days=1)
    return Verdict((WARN if thin else FAIL) if missing else PASS,
                   f"missing_days={len(missing)}" + (f" e.g. {missing[:3]}" if missing else ""))


def check_tail_status(first: Optional[str], retry: Optional[str]) -> Verdict:
    """``unverified`` is honest only if it heals on the Retry-After retry."""
    if first == "unverified":
        if retry in ("current", "verified"):
            return Verdict(PASS, f"unverified->{retry} (healed on retry)")
        return Verdict(FAIL, f"unverified->{retry} (did not heal)")
    if first in ("current", "verified", None):
        return Verdict(PASS, str(first))
    return Verdict(WARN, str(first))


# ───────────────────────────────────────────────────────────── aggregate checks

def percentile(vals: Sequence[float], p: float) -> Optional[float]:
    if not vals:
        return None
    s = sorted(vals)
    i = min(len(s) - 1, max(0, int(math.ceil(p / 100.0 * len(s))) - 1))
    return s[i]


def check_latency(samples_ms: Sequence[float], budget_ms: float, min_samples: int = 5) -> Verdict:
    if len(samples_ms) < min_samples:
        return Verdict(SKIP, f"n={len(samples_ms)}")
    p90 = percentile(samples_ms, 90)
    return Verdict(FAIL if p90 > budget_ms else PASS,
                   f"p90={int(p90)}ms budget={int(budget_ms)}ms n={len(samples_ms)}")


@dataclass
class LabelWindow:
    """Rolling window of Server-Timing serve labels (one per probe answer)."""
    window_s: int = 1800
    items: deque = field(default_factory=deque)

    def add(self, ts: float, label: Optional[str]) -> None:
        self.items.append((float(ts), (label or "none").lower()))

    def prune(self, now: float) -> None:
        while self.items and self.items[0][0] < now - self.window_s:
            self.items.popleft()

    def counts(self, now: float) -> dict:
        self.prune(now)
        out: dict = {}
        for _, lab in self.items:
            out[lab] = out.get(lab, 0) + 1
        return out


def check_label_budget(counts: dict, budget_share: float, min_samples: int = 40) -> Verdict:
    """Share of degraded first answers (stale-swr / delta-deadline / sd-deadline / sd-partial)."""
    total = sum(counts.values())
    if total < min_samples:
        return Verdict(SKIP, f"n={total}")
    bad = {k: v for k, v in counts.items() if k in DEGRADED_LABELS}
    share = sum(bad.values()) / total
    detail = f"degraded={sum(bad.values())}/{total} ({share:.0%}) budget={budget_share:.0%} " + \
             " ".join(f"{k}={v}" for k, v in sorted(bad.items()))
    return Verdict(FAIL if share > budget_share else PASS, detail.strip())


def server_timing_desc(header: Optional[str]) -> Optional[str]:
    """The ``bars;desc="..."`` label of a Server-Timing header."""
    if not header:
        return None
    for part in header.split(","):
        segs = [s.strip() for s in part.strip().split(";")]
        if segs and segs[0] == "bars":
            for seg in segs[1:]:
                if seg.startswith("desc="):
                    return seg[5:].strip('"')
    return None


PRICE_TOL = 1e-4   # 0.01 % relative
VOL_TOL = 0.02     # 2 % relative


def _rel(a: float, b: float) -> float:
    if b:
        return abs(a - b) / abs(b)
    return 0.0 if a == b else 1.0


def compare_stream_rest(stream_bar: dict, rest_row: Optional[dict],
                        price_tol: float = PRICE_TOL, vol_tol: float = VOL_TOL) -> dict:
    """A closed bucket's final stream bar vs the REST row for the same ``t``. Relative diffs only."""
    if rest_row is None:
        return {"row_missing": True, "fields": [], "price_mismatch": False, "vol_mismatch": False}
    rel = {f: _rel(float(stream_bar[f]), float(rest_row[f])) for f in ("o", "h", "l", "c")}
    vrel = _rel(float(stream_bar.get("v") or 0), float(rest_row.get("v") or 0))
    fields = [f for f, x in rel.items() if x > price_tol] + (["v"] if vrel > vol_tol else [])
    return {"row_missing": False, "fields": fields,
            "price_mismatch": any(x > price_tol for x in rel.values()),
            "vol_mismatch": vrel > vol_tol,
            "max_price_rel_pct": round(max(rel.values()) * 100, 4),
            "vol_rel_pct": round(vrel * 100, 2)}


def check_stream_vs_rest(comparisons: Sequence[dict]) -> Verdict:
    """FAIL on a price mismatch or a REST row missing after settle; WARN on volume only."""
    if not comparisons:
        return Verdict(SKIP, "no closed buckets compared")
    missing = sum(1 for c in comparisons if c.get("row_missing"))
    px = sum(1 for c in comparisons if c.get("price_mismatch"))
    vol = sum(1 for c in comparisons if c.get("vol_mismatch"))
    detail = f"compared={len(comparisons)} px_mismatch={px} vol_mismatch={vol} row_missing={missing}"
    if px or missing:
        return Verdict(FAIL, detail)
    return Verdict(WARN if vol else PASS, detail)
