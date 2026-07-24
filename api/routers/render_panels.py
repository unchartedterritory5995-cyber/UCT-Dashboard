"""Token-gated public data for the headless render pages (/r/catalysts, /r/calendar, …).

The Morning Wire → Substack renderer screenshots the /r/* pages in a logged-OUT
headless browser, so these endpoints are gated only by a shared render token
(CHART_RENDER_TOKEN). That token is inlined into the frontend JS bundle, so treat
these as EFFECTIVELY PUBLIC: return only fields safe to expose (no internal
signal-sourcing / scoring), and rate-limit so they can't be abused to drive
unbounded provider calls. Read-only, no side effects.
"""

from __future__ import annotations

import hmac
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException

from api.services.catalyst import store as catalyst_store

router = APIRouter(prefix="/api", tags=["render"])

# Public catalyst fields safe to expose — the panel shows only these. Internal
# columns (raw_signals, score, signals_hash, thesis_model, thesis_sources, …) are
# deliberately NOT returned so the endpoint can't leak the signal-sourcing/scoring.
_CATALYST_PUBLIC = ("ticker", "price", "gap_pct", "vol_x", "tag", "catalyst_type",
                    "thesis_text", "catalyst_at", "market_cap", "sector")

# Shared sliding-window rate limit across all /r/* endpoints — the legit caller is
# the once-a-day newsletter (~5 requests); this only bounds abuse.
_RL: list[float] = []
_RL_MAX_PER_MIN = 60


def _rate_limit() -> None:
    now = time.time()
    _RL[:] = [t for t in _RL if now - t < 60.0]
    if len(_RL) >= _RL_MAX_PER_MIN:
        raise HTTPException(status_code=429, detail="rate limited")
    _RL.append(now)


def _et_today() -> str:
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def _check_token(token: str) -> None:
    want = os.environ.get("CHART_RENDER_TOKEN", "")
    # Fail CLOSED when unset, constant-time compare when set.
    if not want or not hmac.compare_digest(str(token), want):
        raise HTTPException(status_code=403, detail="forbidden")
    _rate_limit()


@router.get("/r/catalysts")
def render_catalysts(token: str = "", n: int = 3, date: str = ""):
    """Top-N ranked Stock Catalysts for today (or `date`) — public-safe fields only."""
    _check_token(token)
    md = date or _et_today()
    rows = catalyst_store.get_for_date(md) or []
    if not rows and not date:  # weekend / pre-first-run: walk back to the last day with data
        from datetime import date as _d, timedelta
        base = _d.fromisoformat(md)
        for back in range(1, 6):
            prev = (base - timedelta(days=back)).isoformat()
            rows = catalyst_store.get_for_date(prev) or []
            if rows:
                md = prev
                break
    n = max(1, min(int(n or 3), 40))
    public = [{k: r.get(k) for k in _CATALYST_PUBLIC} for r in rows[:n]]
    return {"market_date": md, "rows": public}


def _rev_m(v):
    """Normalize revenue to $ millions. Values >= $1M-in-millions ($1T/qtr) are
    impossible, so anything that large must be raw dollars → divide."""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v / 1e6 if abs(v) >= 1e6 else v


@router.get("/r/earnings-history")
def render_earnings_history(token: str = "", syms: str = ""):
    """Per-ticker last-reported-quarter ACTUALS + upcoming-quarter estimate & projected
    YoY growth (est vs the year-ago actual) — token-gated public read over the cached
    FMP-backed earnings table. Powers the newsletter's 'set to report' blocks."""
    _check_token(token)
    from api.services import earnings_table as et
    out = {}
    for sym in [s.strip().upper() for s in (syms or "").split(",") if s.strip()][:12]:
        try:
            q = (et.get_earnings_table(sym) or {}).get("quarterly", []) or []
            reported = [r for r in q if r.get("reported")]
            forward = [r for r in q if not r.get("reported")]
            # Order-independent: labels are "YYYY QN" (lexicographic == chronological).
            last = max(reported, key=lambda r: r.get("label") or "") if reported else None
            nxt = min(forward, key=lambda r: r.get("label") or "￿") if forward else None
            out[sym] = {
                "last_q": ({"label": last.get("label"), "eps": last.get("eps_actual"),
                            "rev_m": _rev_m(last.get("rev_actual"))} if last else None),
                "upcoming": ({"label": nxt.get("label"), "eps_est": nxt.get("eps_estimate"),
                              "rev_est_m": _rev_m(nxt.get("rev_estimate")),
                              "eps_yoy": nxt.get("eps_est_chg_pct"),
                              "rev_yoy": nxt.get("rev_est_chg_pct")} if nxt else None),
            }
        except Exception:  # noqa: BLE001
            out[sym] = None
    return {"data": out}


# Public-safe flow fields — the structured conviction board the engine already
# emits into wire["options_flow"]. Same board the FREE OptionsFlow page shows; the
# rows are display-shaped (no raw signal-sourcing), so we pass them through capped.
_FLOW_PUBLIC = ("sym", "cp", "call_put", "strike_label", "exp_label", "prem_spoken",
                "vol_oi_tag", "er", "sentiment", "urgency", "urgency_cls", "bought", "size_pct")


@router.get("/r/flow")
def render_flow(token: str = "", n: int = 10):
    """Notable options flow (prior session) — token-gated public read over the engine's
    pushed wire["options_flow"]: the biggest single-contract orders, strike-led."""
    _check_token(token)
    try:
        from api.services import engine as _eng
        wire = _eng._load_wire_data() or {}
    except Exception:  # noqa: BLE001
        wire = {}
    flow = (wire.get("options_flow") or {}) if isinstance(wire, dict) else {}
    rows = flow.get("orders") or []
    n = max(1, min(int(n or 10), 16))
    public = [{k: r.get(k) for k in _FLOW_PUBLIC} for r in rows[:n]]
    return {"session": flow.get("session"), "orders": public}


@router.get("/r/themes")
def render_themes(token: str = "", period: str = "1W", n: int = 6):
    """Theme leaders & laggards for the newsletter — each with its top holdings.
    Token-gated public read over the engine's pushed wire["themes"]."""
    _check_token(token)
    try:
        from api.services import engine as _eng
        wire = _eng._load_wire_data() or {}
    except Exception:  # noqa: BLE001
        wire = {}
    themes = (wire.get("themes") or {}) if isinstance(wire, dict) else {}
    period = period if period in ("1D", "1W", "1M", "3M", "1Y", "YTD") else "1W"
    rows = []
    for k, v in themes.items():
        if not isinstance(v, dict):
            continue
        ret = v.get(period)
        if not isinstance(ret, (int, float)):
            continue
        holds = [h.get("sym") for h in (v.get("holdings") or [])
                 if isinstance(h, dict) and h.get("sym")][:3]
        rows.append({"name": v.get("name") or k, "ret": round(float(ret), 1), "holdings": holds})
    rows.sort(key=lambda r: r["ret"], reverse=True)
    n = max(3, min(int(n or 6), 10))
    leaders = rows[:n]
    lead_names = {r["name"] for r in leaders}
    laggards = [r for r in rows[-n:][::-1] if r["name"] not in lead_names] if len(rows) > n else []
    mx = max([abs(r["ret"]) for r in (leaders + laggards)] or [1.0])
    return {"period": period, "leaders": leaders, "laggards": laggards, "max_abs": mx}


@router.get("/r/tweets")
def render_tweets(token: str = "", n: int = 5, hours: int = 18):
    """Top-N recent notable tweets that mention tickers — token-gated public read.

    Prefers tweets carrying cashtags (ticker links), newest first; the newsletter
    screenshots /r/tweets into a 'Top Tweets' panel.
    """
    _check_token(token)
    hours = max(1, min(int(hours or 18), 48))
    try:
        from api.services import tweet_store
        rows = tweet_store.feed(hours=hours, limit=60) or []
    except Exception:  # noqa: BLE001
        rows = []
    with_tickers = [t for t in rows if t.get("tickers")]
    picked = (with_tickers or rows)[: max(1, min(int(n or 5), 10))]
    out = [{
        "text": t.get("text"),
        "tickers": t.get("tickers", []),
        "created_at": t.get("created_at"),
    } for t in picked]
    return {"tweets": out}
