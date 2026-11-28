"""Forward estimates and revision trends for the research page.

All from yfinance analysis data (earnings_estimate / revenue_estimate /
eps_trend / eps_revisions) — free and available on yfinance 1.x. Run through
the bounded yfinance pool, cached 12h. A ticker with no estimate coverage at
all is a legitimately empty (not failed) result and still gets the full TTL.

2026-09-03 (dedicated Analyst Ratings slice, owner-authorized product-home
split): this module is narrowed to its honest scope -- EPS/revenue forward
estimates and revisions ONLY. Analyst consensus, price targets, and recent
rating-change actions (previously enriched here from FMP via
`analyst_grades.get_analyst_grades`, overriding yfinance's own thinner
`upgrades_downgrades` feed) now live in their own dedicated home:
`api/services/research/analyst_ratings.py`, rendered by
`AnalystRatingsTab.jsx`. Do not re-add analyst-grade content here -- that is
exactly the fragmentation this split exists to resolve.
"""
from __future__ import annotations

import logging
import math
import threading
import time

from api.services import boot_probe
from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services.yfinance_pool import run_in_pool
from api.services.research.entity_resolution import resolve_entity

_logger = logging.getLogger(__name__)

_CACHE_TTL = 43_200  # 12h -- only when both legs resolved
_FAIL_TTL = 300        # 5 min -- a partial/failed fetch self-heals fast

#: A build (or a follower's wait) slower than this logs one `[ee-stage]` line with the
#: duration of every stage it went through.
_SLOW_STAGE_S = 3.0

_PERIOD_LABEL = {"0q": "Current Qtr", "+1q": "Next Qtr", "0y": "Current Yr", "+1y": "Next Yr"}
_PERIOD_ORDER = ["0q", "+1q", "0y", "+1y"]


def _num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _cell(df, idx, col):
    if df is None or getattr(df, "empty", True):
        return None
    try:
        if idx in df.index and col in df.columns:
            return _num(df.loc[idx, col])
    except Exception:
        return None
    return None


def _forward(eps_df, rev_df):
    rows = []
    for p in _PERIOD_ORDER:
        eps_avg = _cell(eps_df, p, "avg")
        rev_avg = _cell(rev_df, p, "avg")
        if eps_avg is None and rev_avg is None:
            continue
        growth = _cell(eps_df, p, "growth")
        rows.append({
            "period": _PERIOD_LABEL.get(p, p),
            "eps_avg": eps_avg,
            "eps_low": _cell(eps_df, p, "low"),
            "eps_high": _cell(eps_df, p, "high"),
            "num_analysts": _cell(eps_df, p, "numberOfAnalysts"),
            "eps_growth": round(growth * 100, 1) if growth is not None else None,
            "rev_avg": rev_avg,
        })
    return rows


def _revisions(trend_df, rev_df):
    rows = []
    for p in _PERIOD_ORDER:
        cur = _cell(trend_df, p, "current")
        if cur is None:
            continue
        up = _cell(rev_df, p, "upLast30days")
        down = _cell(rev_df, p, "downLast30days")
        rows.append({
            "period": _PERIOD_LABEL.get(p, p),
            "current": cur,
            "ago30": _cell(trend_df, p, "30daysAgo"),
            "ago90": _cell(trend_df, p, "90daysAgo"),
            "up30": int(up) if up is not None else None,
            "down30": int(down) if down is not None else None,
        })
    return rows


#: Per-calling-thread timings of the most recent `_fetch` (`pool_wait`: submit -> the pool
#: worker starting; `yf_import`: the in-worker `import yfinance`). A side channel rather
#: than a parameter so `_fetch(sym)` keeps the one-argument shape tests stub it with.
_fetch_timing = threading.local()


def _fetch(sym):
    """Returns {} ONLY on a genuine pool-call exception -- callers use that as
    the "did this leg actually fail" signal (`bool(raw)` is False only on a real
    provider exception; a successful call always returns a dict, even one whose
    values are individually None/empty)."""
    stages: dict = {}
    _fetch_timing.stages = stages
    t_submit = time.monotonic()

    def _do():
        t_run = time.monotonic()
        stages["pool_wait"] = t_run - t_submit
        import yfinance as yf
        stages["yf_import"] = time.monotonic() - t_run
        t = yf.Ticker(sym)
        return {
            "eps_est": getattr(t, "earnings_estimate", None),
            "rev_est": getattr(t, "revenue_estimate", None),
            "eps_trend": getattr(t, "eps_trend", None),
            "eps_rev": getattr(t, "eps_revisions", None),
        }
    try:
        return run_in_pool(_do, timeout=15)
    except Exception as exc:
        _logger.warning("yf estimates fetch failed for %s: %s", sym, exc)
        return {}


def get_estimates(sym):
    """S6 (terminal backend fixes, 2026-10-05): a cold symbol is composed ONCE however
    many members open it at the same moment. The cache answers first; on a miss the
    first caller builds and the rest wait for its result (`single_flight`), so N cold
    opens cost one vendor walk instead of N on the shared threadpool. A follower that
    waits past the single-flight bound raises, and the route answers that as a failed
    read rather than an empty record."""
    s = (sym or "").upper().strip()
    if not s:
        return {}
    cached = cache.get(f"research_est::{s}")
    if cached is not None:
        return cached
    from api.services import single_flight
    t0 = time.monotonic()
    role = {}
    try:
        return single_flight.run(f"research_est::{s}", lambda: _build_estimates(s),
                                 on_role=lambda r: role.__setitem__("r", r))
    finally:
        waited = time.monotonic() - t0
        if role.get("r") == "follower" and waited >= _SLOW_STAGE_S:
            _logger.warning("[ee-stage] %s follower waited %.1fs on the in-flight build",
                            s, waited)


def _build_estimates(sym):
    sym = (sym or "").upper().strip()
    if not sym:
        return {}

    # Stage timings (2026-10-06 boot stall: a leader's Yahoo leg took 147.7 s while its only
    # vendor call is bounded at 15 s and logged nothing -- so the time went to a stage no
    # instrument named). Each stage is timed; a slow build logs one `[ee-stage]` line.
    stages: dict = {}
    t0 = t = time.monotonic()
    ck = f"research_est::{sym}"
    boot_probe.note("est-cache")
    cached = cache.get(ck)
    stages["cache"] = time.monotonic() - t
    if cached is not None:
        return cached

    # No vendor= -- nothing here is FMP-routed since the 2026-09-03 narrowing
    # (analyst-grade content, the one FMP-backed leg this module used to
    # carry, now lives in analyst_ratings.py).
    boot_probe.note("est-entity")
    t = time.monotonic()
    entity, _ = resolve_entity(sym)
    stages["entity"] = time.monotonic() - t

    boot_probe.note("est-fetch")
    t = time.monotonic()
    _fetch_timing.stages = None
    raw = _fetch(sym)
    stages["fetch"] = time.monotonic() - t
    stages.update(dict(getattr(_fetch_timing, "stages", None) or {}))
    boot_probe.note("est-shape")
    fetch_ok = bool(raw)   # {} means _fetch's exception path fired
    raw = raw or {}
    out = {
        "sym": sym,
        "entity": entity,
        "forward": _forward(raw.get("eps_est"), raw.get("rev_est")),
        "revisions": _revisions(raw.get("eps_trend"), raw.get("eps_rev")),
    }

    t = time.monotonic()
    set_by_completeness(ck, out, complete=fetch_ok, ttl_ok=_CACHE_TTL, ttl_partial=_FAIL_TTL)
    stages["set"] = time.monotonic() - t
    total = time.monotonic() - t0
    if total >= _SLOW_STAGE_S:
        _logger.warning("[ee-stage] %s build %.1fs: %s ok=%s boot+%.0fs", sym, total,
                        " ".join(f"{k}={v:.2f}" for k, v in stages.items()), fetch_ok,
                        boot_probe.boot_age())
    return out


# ── licensed-first pass 2 (2026-11-28): revisions from our own FMP snapshots ──
#
# The revisions card used to read ONLY Yahoo (`eps_trend` / `eps_revisions`, register T-73, class X):
# FMP publishes no revision history on this plan. But since 2026-10-04 `estimate_history` has
# snapshotted FMP's quarterly consensus every weekday evening (S&P 500 plus every symbol viewed),
# so for those symbols the 30-day-ago (and, once 90 days are held, the 90-day-ago) consensus is a
# number WE recorded from a licensed source. That comes first; Yahoo stays the fallback, labelled.
#
# What it cannot say: how many analysts revised up or down (Yahoo's "Up (30d)" / "Down (30d)"):
# a consensus snapshot holds the average, not each analyst. Those two stay None, and the card
# leaves the columns out. Annual periods are not snapshotted, so the rows are fiscal quarters.

LICENSED_REVISIONS_SOURCE = "FMP consensus, snapshotted daily by UCT"
#: A "N days ago" point is the newest snapshot taken on or before the day N days back, and no more
#: than this many days before it (a weekend or holiday leaves a gap of a few days, never a month).
_AGO_SLACK_DAYS = 7
#: The newest snapshot must be this recent for "current" to stand; otherwise the store is stale.
_CURRENT_MAX_AGE_DAYS = 7
_MAX_REVISION_ROWS = 4


def _point_on_or_before(points, day_iso: str, slack_floor_iso: str):
    best = None
    for sd, eps in points:
        if slack_floor_iso <= sd <= day_iso and eps is not None:
            best = eps
    return best


def licensed_revisions(sym, *, today=None) -> dict | None:
    """The revisions card's licensed read, or None when it does not apply (the seam is off, the
    estimate history is dark, or FMP holds no forward quarter for the symbol).

    -> {"state": "ok", "revisions": [...], "covers_from", "last_snapshot"} when at least one
       forward quarter has a 30-day-ago point;
       {"state": "building", "covers_from", "tracked"} otherwise: the history for this symbol
       does not reach back 30 days yet (or has not started), said as such.
    Each row: {period, period_end, current, ago30, ago90, up30: None, down30: None}. Reads the
    consensus cache the card beside it already filled and the local snapshot store; registers
    the symbol for the daily snapshot (a local write), so viewing the card starts its history."""
    from datetime import date, timedelta
    from api.services import licensed_reference as lr
    s = (sym or "").upper().strip()
    if not s or not lr.first():
        return None
    from api.services import estimate_history as eh
    if not eh.is_enabled():
        return None
    from api.services.research.estimates_consensus import get_consensus, today_et
    cons = get_consensus(s) or {}
    quarters = [q for q in (cons.get("quarterly") or []) if isinstance(q, dict) and q.get("period_end")]
    if cons.get("state") != "ok" or not quarters:
        return None
    quarters = quarters[:_MAX_REVISION_ROWS]
    try:
        tracked = eh.track(s, "viewed")
        pts = eh.eps_points(s, [q["period_end"] for q in quarters])
        covers_from = eh.first_snapshot(s)
    except Exception as exc:                                        # noqa: BLE001
        _logger.warning("estimate history read failed for %s: %s", s, exc)
        return None
    day = today if isinstance(today, date) else today_et()
    iso = lambda d: d.isoformat()                                  # noqa: E731
    rows, last_snap = [], None
    for q in quarters:
        p = pts.get(q["period_end"]) or []
        if not p:
            continue
        latest_sd, latest_eps = p[-1]
        last_snap = max(last_snap or latest_sd, latest_sd)
        if latest_sd < iso(day - timedelta(days=_CURRENT_MAX_AGE_DAYS)) or latest_eps is None:
            continue
        d30, d90 = day - timedelta(days=30), day - timedelta(days=90)
        rows.append({
            "period": q.get("label") or q["period_end"],
            "period_end": q["period_end"],
            "current": latest_eps,
            "ago30": _point_on_or_before(p, iso(d30), iso(d30 - timedelta(days=_AGO_SLACK_DAYS))),
            "ago90": _point_on_or_before(p, iso(d90), iso(d90 - timedelta(days=_AGO_SLACK_DAYS))),
            "up30": None,
            "down30": None,
        })
    if not any(r["ago30"] is not None for r in rows):
        return {"state": "building", "covers_from": covers_from, "tracked": bool(tracked)}
    return {"state": "ok", "revisions": rows, "covers_from": covers_from, "last_snapshot": last_snap}
