"""Volatility analytics endpoints (FT-020), the IV-rank header (FT-006) and the option monitor's
HV and events fields (FT-019).

  * iv_rank          — IV rank / percentile from OUR options log (`research/iv_history.py`), with a
                       plain label, or the sentence saying how many sessions it still needs and
                       the first session it can exist on. Never a number below 20 sessions.
  * realized         — close-to-close historical volatility (10/20/30 sessions), COMPUTED from
                       daily bars, completed sessions only.
  * term_structure   — the vendor's ATM IV by expiration (from `vol_surface`, today's chain).
  * interpolated_iv  — constant-maturity IV at N days, COMPUTED from the vendor term structure by
                       interpolating total variance (iv^2 x t) between the two expirations that
                       bracket N. Never extrapolated past the listed range.
  * vrp              — variance risk premium: 30-day interpolated IV minus 30-session HV, in vol
                       points, plus the variance form. Computed.
  * monitor          — the option monitor strip: HV20/HV30, the next earnings date (events), and
                       today's chain volume and put/call ratio for the front expiration (vendor).

⛔ Every number is labelled `vendor` or `computed`; methods are in words.
⛔ An empty bar read is UNAVAILABLE, not zero volatility (`get_agg_bars` answers [] on failure).
⛔ Blocking reads only (bars, vendor chain, our log): callers are plain `def` routes.
"""
from __future__ import annotations

import datetime as _dt
import math
from typing import Callable, Optional
from zoneinfo import ZoneInfo

from api.services.cache import TTLCache

_ET = ZoneInfo("America/New_York")
TRADING_DAYS = 252
HV_WINDOWS = (10, 20, 30)
BARS_TTL_S = 3600.0
RANK_BANDS = ((20, "Very low"), (40, "Low"), (60, "Moderate"), (80, "Elevated"))
HV_METHOD = ("Historical volatility = the standard deviation of daily log returns (close to "
             "close) over the last N completed sessions, x sqrt(252). Computed from daily bars.")

_BARS = TTLCache(max_size=512)


def clear_cache() -> None:
    _BARS.clear()


def _default_bars(sym: str) -> list:
    from api.services import massive
    t = _dt.datetime.now(_ET).date()
    return massive.get_agg_bars(sym, (t - _dt.timedelta(days=75)).isoformat(), t.isoformat())


_bars: Callable[[str], list] = _default_bars


def _bar_date(b: dict) -> Optional[str]:
    try:
        return _dt.datetime.fromtimestamp(int(b["t"]) / 1000, _dt.timezone.utc).astimezone(_ET).date().isoformat()
    except (KeyError, TypeError, ValueError, OSError):
        return None


def _completed_closes(sym: str, today: Optional[str] = None) -> Optional[list]:
    key = f"volbars::{sym}"
    bars = _BARS.get(key)
    if bars is None:
        bars = _bars(sym) or []
        if bars:
            _BARS.set(key, bars, BARS_TTL_S)
    if not bars:
        return None
    today = today or _dt.datetime.now(_ET).date().isoformat()
    return [(d, float(b["c"])) for b in bars if (d := _bar_date(b)) and d != today and b.get("c")]


def hv(closes: list, n: int) -> Optional[float]:
    """Annualized close-to-close HV over the last n returns (needs n+1 closes)."""
    if len(closes) < n + 1:
        return None
    window = closes[-(n + 1):]
    rets = [math.log(window[i] / window[i - 1]) for i in range(1, len(window)) if window[i - 1] > 0]
    if len(rets) < 2:
        return None
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var) * math.sqrt(TRADING_DAYS)


def realized(sym: str) -> dict:
    rows = _completed_closes(sym)
    base = {"symbol": sym, "label": "computed", "method": HV_METHOD}
    if rows is None:
        return {**base, "available": False, "hv": {},
                "note": f"No daily bars could be read for {sym}; volatility is unavailable, not zero."}
    closes = [c for _, c in rows]
    out = {f"hv{n}": (round(v, 4) if (v := hv(closes, n)) is not None else None) for n in HV_WINDOWS}
    return {**base, "available": True, "hv": out, "sessions": len(closes),
            "through": rows[-1][0] if rows else None}


# ── FT-006 IV rank, with words ──────────────────────────────────────────────────

def rank_label(rank: Optional[float]) -> Optional[str]:
    if rank is None:
        return None
    return next((w for cut, w in RANK_BANDS if rank < cut), "High")


def _nth_session_after(start: _dt.date, n: int) -> Optional[str]:
    from api.services import session_calendar
    d, k = start, 0
    try:
        while k < n:
            d += _dt.timedelta(days=1)
            if session_calendar.is_trading_day(d):
                k += 1
    except Exception:  # noqa: BLE001 -- past the calendar's horizon: no date, never a guess
        return None
    return d.isoformat()


def iv_rank(sym: str, *, now: Optional[_dt.datetime] = None) -> dict:
    from api.services.research import iv_history as ivh
    h = ivh.iv_history(sym, now=now)
    current_rule = [p for p in h.get("points") or [] if p.get("atm_iv") is not None and p.get("rule") == ivh.CURRENT_RULE]
    n = len(current_rule)
    need = ivh.RANK_MIN_SESSIONS
    out = {"symbol": sym, "label": "computed", "source": h.get("source"),
           "method": ("IV rank = where today's ATM IV sits between its low and high over the "
                      "logged window (0-100); IV percentile = the share of logged sessions below "
                      "today's. From our own options log only."),
           "n": n, "rank_min_sessions": need, "logging_began": h.get("logging_began"),
           "iv_rank": None, "iv_percentile": None, "rank_word": None, "current_atm_iv": None,
           "meaningful_from": None, "sentence": None}
    if current_rule:
        out["current_atm_iv"] = current_rule[-1]["atm_iv"]
    rank = h.get("rank")
    if rank:
        out.update(iv_rank=rank.get("iv_rank"), iv_percentile=rank.get("iv_percentile"),
                   window_sessions=rank.get("window_sessions"))
        out["rank_word"] = rank_label(rank.get("iv_rank"))
        out["sentence"] = (f"IV rank {rank['iv_rank']:.0f} {out['rank_word']}"
                           if rank.get("iv_rank") is not None else
                           "IV has not moved across the logged window; rank is undefined.")
        return out
    remaining = max(0, need - n)
    last = current_rule[-1]["date"] if current_rule else None
    start = _dt.date.fromisoformat(last) if last else (now or _dt.datetime.now(_ET)).date()
    out["meaningful_from"] = _nth_session_after(start, remaining) if remaining else None
    when = f" (first possible {out['meaningful_from']})" if out["meaningful_from"] else ""
    out["sentence"] = (f"IV rank: {n} session{'s' if n != 1 else ''} logged, needs {need}{when}."
                       if h.get("status") != "no_log" else "IV rank: the options log holds no sessions yet.")
    return out


# ── FT-020 term structure, constant-maturity IV, VRP ────────────────────────────

def term_structure(sym: str) -> dict:
    from api.services import vol_surface
    s = vol_surface.get_surface(sym)
    if s.get("error"):
        raise RuntimeError(s["error"])
    pts = [p for p in (s.get("term") or {}).get("points") or []]
    return {"symbol": sym, "label": "vendor", "iv_source_text": s.get("iv_source_text"),
            "basis": s.get("basis"), "spot": s.get("spot"),
            "points": [{"expiration": p["expiration"], "dte": p["dte"], "atm_iv": p["atm_iv"],
                        "atm_strike": p.get("atm_strike"), "t": p.get("t"), "reason": p.get("reason")}
                       for p in pts],
            "missing": s.get("missing") or []}


def interpolate_iv(points: list, days: int) -> dict:
    """Total-variance interpolation between the two expirations bracketing `days`. Outside the
    listed range there is no answer (never extrapolated)."""
    pts = sorted(((p["dte"], p["atm_iv"]) for p in points
                  if p.get("atm_iv") is not None and p.get("dte") and p["dte"] > 0), key=lambda x: x[0])
    if len(pts) < 2:
        return {"iv": None, "reason": f"{len(pts)} expiration(s) with an ATM IV; interpolation needs 2."}
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t0 == days:
            return {"iv": round(v0, 4), "from": [t0], "reason": None}
        if t0 < days <= t1:
            w0, w1 = v0 * v0 * t0, v1 * v1 * t1
            w = w0 + (w1 - w0) * (days - t0) / (t1 - t0)
            return {"iv": round(math.sqrt(w / days), 4), "from": [t0, t1], "reason": None}
    return {"iv": None, "reason": (f"{days} days is outside the listed range "
                                   f"({pts[0][0]}-{pts[-1][0]} days); not extrapolated.")}


def interpolated_iv(sym: str, days: int = 30) -> dict:
    ts = term_structure(sym)
    got = interpolate_iv(ts["points"], days)
    return {"symbol": sym, "days": days, "label": "computed",
            "inputs": "vendor ATM IV by expiration (today's chain)",
            "method": ("Constant-maturity IV: total variance (IV^2 x days) interpolated linearly "
                       "between the two listed expirations that bracket the target, then "
                       "converted back to IV."), **got}


def vrp(sym: str) -> dict:
    iv = interpolated_iv(sym, 30)
    rv = realized(sym)
    hv30 = (rv.get("hv") or {}).get("hv30")
    out = {"symbol": sym, "label": "computed", "iv30": iv.get("iv"), "hv30": hv30,
           "method": ("Variance risk premium = 30-day constant-maturity implied volatility minus "
                      "30-session historical volatility (vol points), and the same in variance "
                      "(IV^2 - HV^2)."),
           "vrp_points": None, "vrp_variance": None, "note": None}
    if iv.get("iv") is None:
        out["note"] = iv.get("reason")
    elif hv30 is None:
        out["note"] = rv.get("note") or "Not enough completed sessions for a 30-session HV."
    else:
        out["vrp_points"] = round(iv["iv"] - hv30, 4)
        out["vrp_variance"] = round(iv["iv"] ** 2 - hv30 ** 2, 5)
    return out


# ── FT-019 option monitor ───────────────────────────────────────────────────────

def _default_next_earnings(sym: str) -> Optional[str]:
    from api.services.research.snapshot import get_snapshot
    return (get_snapshot(sym) or {}).get("next_earnings")


_next_earnings: Callable[[str], Optional[str]] = _default_next_earnings


def _default_front_chain(sym: str) -> dict:
    from api.services import polygon_options
    return polygon_options.get_chain(sym, strikes_around_spot=20)


_front_chain: Callable[[str], dict] = _default_front_chain


def monitor(sym: str, *, today: Optional[_dt.date] = None) -> dict:
    rv = realized(sym)
    today = today or _dt.datetime.now(_ET).date()
    try:
        ne = _next_earnings(sym)
    except Exception:  # noqa: BLE001 -- named below, never a fabricated date
        ne = "error"
    events = {"next_earnings": None, "days_to_earnings": None, "note": None}
    if ne == "error":
        events["note"] = "The earnings date could not be read."
    elif ne:
        events["next_earnings"] = ne[:10]
        try:
            events["days_to_earnings"] = (_dt.date.fromisoformat(ne[:10]) - today).days
        except ValueError:
            events["note"] = "The earnings date could not be parsed."
    else:
        events["note"] = "No scheduled earnings date on file."
    c = _front_chain(sym) or {}
    vol = {"expiration": None, "call_volume": None, "put_volume": None, "put_call_ratio": None,
           "label": "vendor", "note": None}
    if c.get("error"):
        vol["note"] = f"The chain is unavailable: {c['error']}"
    else:
        cv = [r.get("day_volume") for r in c.get("calls") or []]
        pv = [r.get("day_volume") for r in c.get("puts") or []]
        known_c = [v for v in cv if v is not None]
        known_p = [v for v in pv if v is not None]
        vol["expiration"] = c.get("expiration")
        vol["call_volume"] = sum(known_c) if known_c else None
        vol["put_volume"] = sum(known_p) if known_p else None
        if vol["call_volume"] and vol["put_volume"] is not None:
            vol["put_call_ratio"] = round(vol["put_volume"] / vol["call_volume"], 2)
        vol["note"] = ("Front expiration, the 40 strikes nearest spot; contracts the vendor sent "
                       "no volume for are not counted.")
    return {"symbol": sym, "hv": rv.get("hv") or {}, "hv_label": "computed", "hv_method": HV_METHOD,
            "hv_note": rv.get("note"), "events": events, "volume": vol}
