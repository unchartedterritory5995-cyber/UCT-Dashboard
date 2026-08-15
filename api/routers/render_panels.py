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

from fastapi import APIRouter, HTTPException, Response

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


# Thesis phrasings the synthesizer uses when it found NOTHING — a non-catalyst
# must never occupy one of the newsletter's few catalyst slots (quality=1).
_NO_CATALYST_PHRASES = ("no clear catalyst", "no company-specific catalyst",
                        "no company-specific news", "no fresh company-specific",
                        "no identifiable catalyst", "catalyst identifiable in the signal")


def _first_sentences(text: str, k: int = 2) -> str:
    import re as _re
    parts = _re.split(r"(?<=[.!?])\s+", str(text or "").strip())
    return " ".join(parts[:k]).strip()


@router.get("/r/catalysts")
def render_catalysts(token: str = "", n: int = 3, date: str = "",
                     quality: int = 0, compact: int = 0):
    """Top-N ranked Stock Catalysts for today (or `date`) — public-safe fields only.

    quality=1 drops rows whose thesis says no real catalyst was found (the
    newsletter wants stories, not confessions); compact=1 clamps each thesis to
    its first two sentences (email-density mode).
    """
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
    if int(quality or 0):
        rows = [r for r in rows
                if not any(p in str(r.get("thesis_text") or "").lower()
                           for p in _NO_CATALYST_PHRASES)]
    n = max(1, min(int(n or 3), 40))
    public = [{k: r.get(k) for k in _CATALYST_PUBLIC} for r in rows[:n]]
    if int(compact or 0):
        for r in public:
            r["thesis_text"] = _first_sentences(r.get("thesis_text"))
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
    rows = rows[:n]
    # Same-underlying rows adjacent (first-appearance order preserved): the MU put
    # beside the MU call reads as one straddle story, not two orphans.
    first: dict = {}
    for i, r in enumerate(rows):
        first.setdefault(str(r.get("sym", "")), i)
    rows = sorted(enumerate(rows), key=lambda t: (first[str(t[1].get("sym", ""))], t[0]))
    public = [{k: r.get(k) for k in _FLOW_PUBLIC} for _, r in rows]
    return {"session": flow.get("session"), "orders": public}


_PRICE_TXT_RE = None  # built lazily in _levels_for_book


def _levels_for_book(r: dict) -> dict:
    """entry/stop/t1/t2 for a leadership row, comma-safe and sanity-checked.

    Mirrors the newsletter's compute_levels contract: prefer the engine-baked
    *_px fields, but re-parse the prose when they're insane (the "$1,020"→1.0
    comma bug class) so the book image can never show placeholder levels.
    """
    import re as _re
    global _PRICE_TXT_RE
    if _PRICE_TXT_RE is None:
        _PRICE_TXT_RE = _re.compile(
            r"\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)")

    def _f(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    def _parse(text):
        m = _PRICE_TXT_RE.search(str(text or ""))
        return float(m.group(1).replace(",", "")) if m else 0.0

    price = _f(r.get("price"))
    e, s = _f(r.get("entry_px")), _f(r.get("stop_px"))
    t1, t2 = _f(r.get("t1_px")), _f(r.get("t2_px"))
    sane = (e > 0 and s > 0 and s < e and t1 >= e * 0.98
            and (not price or abs(e - price) / price <= 0.35))
    if not sane:
        e, s = _parse(r.get("entry")), _parse(r.get("stop"))
        t1, t2 = _parse(r.get("target_1")), _parse(r.get("target_2"))
    return {"entry": e or None, "stop": s or None, "t1": t1 or None, "t2": t2 or None}


@router.get("/r/book")
def render_book(token: str = "", part: int = 0):
    """The Full Book — the 20 leadership names for the newsletter's rendered
    board image. part=1 → ranks 1-10, part=2 → 11-20, 0 → all. Fields shown are
    exactly what the letter already publishes daily (no internal scoring leaks
    beyond the public UCT score)."""
    _check_token(token)
    try:
        from api.services import engine as _eng
        wire = _eng._load_wire_data() or {}
    except Exception:  # noqa: BLE001
        wire = {}
    rows = sorted((wire.get("leadership") or []) if isinstance(wire, dict) else [],
                  key=lambda r: r.get("score", 0) or 0, reverse=True)
    out = []
    for i, r in enumerate(rows[:20], start=1):
        lv = _levels_for_book(r)
        out.append({
            "rank": i,
            "sym": (r.get("sym") or "").upper(),
            "theme": r.get("theme") or r.get("sector") or "",
            "score": r.get("score"),
            "setup": r.get("setup_type") or "",
            **lv,
        })
    if part in (1, 2):
        out = out[:10] if part == 1 else out[10:20]
    return {"date": wire.get("date"), "part": part, "rows": out}


@router.get("/r/econ")
def render_econ(token: str = ""):
    """Today's calendar (econ prints + Fed speakers + tonight's AMC reporters)
    for the newsletter's rendered panel — token-gated public read over the
    engine's pushed wire["risk_calendar"]. Rows come back CHRONOLOGICAL."""
    _check_token(token)
    try:
        from api.services import engine as _eng
        wire = _eng._load_wire_data() or {}
    except Exception:  # noqa: BLE001
        wire = {}
    rc = (wire.get("risk_calendar") or {}) if isinstance(wire, dict) else {}

    def _tkey(t):
        try:
            hh, mm = str(t or "").strip().split(":")[:2]
            return (int(hh), int(mm[:2]))
        except (ValueError, AttributeError):
            return (99, 99)

    rows = []
    for e in rc.get("econ") or []:
        rows.append({"time": e.get("time") or "", "kind": "econ",
                     "event": e.get("event") or "", "estimate": e.get("estimate") or "",
                     "is_key": bool(e.get("is_key"))})
    for f in rc.get("fed") or []:
        rows.append({"time": f.get("time") or "", "kind": "fed",
                     "event": f.get("event") or "", "note": f.get("note") or "",
                     "is_key": True})
    rows.sort(key=lambda r: _tkey(r["time"]))
    amc = [s for s in (rc.get("amc") or []) if s]
    return {"date": wire.get("date"), "rows": rows,
            "amc": amc, "amc_count": rc.get("amc_count", len(amc))}


@router.get("/r/themes")
def render_themes(token: str = "", period: str = "1W", n: int = 6, holds: int = 6):
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
    hn = max(1, min(int(holds or 6), 10))
    rows = []
    for k, v in themes.items():
        if not isinstance(v, dict):
            continue
        ret = v.get(period)
        if not isinstance(ret, (int, float)):
            continue
        holds_list = [h.get("sym") for h in (v.get("holdings") or [])
                      if isinstance(h, dict) and h.get("sym")][:hn]
        rows.append({"name": v.get("name") or k, "ret": round(float(ret), 1), "holdings": holds_list})
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

    # Near-duplicate collapse: wire services repeat one story minutes apart
    # ("QCOM tells customers prices going up" ×2). Key = tickers + the first 40
    # normalized chars; the NEWEST occurrence (rows are newest-first) survives.
    import re as _re
    seen_keys = set()
    deduped = []
    for t in (with_tickers or rows):
        norm = _re.sub(r"https?://\S+", "", str(t.get("text") or "").lower())
        norm = _re.sub(r"[^a-z0-9 ]", "", norm)
        norm = _re.sub(r"\s+", " ", norm).strip()
        key = (tuple(sorted(t.get("tickers") or [])), norm[:40])
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(t)

    picked = deduped[: max(1, min(int(n or 5), 10))]
    out = [{
        "text": t.get("text"),
        "tickers": t.get("tickers", []),
        "created_at": t.get("created_at"),
    } for t in picked]
    return {"tweets": out}


# ── chart settings for the headless chart export ─────────────────────────────
# /r/chart runs logged OUT, so it never had access to the owner's saved
# `chart_settings` and silently rendered the schema DEFAULTS - a dark theme with
# default overlays, while he runs a light one. Every chart in the Sunday Scans
# issue therefore looked like a different product from the ones he exports out of
# the app himself, which is exactly the difference he asked to close.
#
# (Same root cause as the extendedHoursShading bug on this route: a headless page
# inherits `?? default` for every setting nobody thought to pass it.)
#
# Returns the OWNER's blob, not the caller's - there is no caller identity here.
# The owner is the first address in ADMIN_EMAILS, matching how every other
# owner-facing feature on this box resolves "him" (desk_daily_session,
# compass_health). Absent/unset -> {} and the page keeps today's defaults, so a
# misconfigured env degrades to the old behaviour instead of failing the render.

@router.get("/r/chart-settings")
def chart_settings_for_render(token: str = ""):
    """The owner's saved chart_settings blob, for the headless chart page.

    Read-only. Exposes only the `chart_settings` key - preferences hold other
    per-user state (layouts, calendar view, watchlist columns) and this route is
    effectively public, so it returns ONE key rather than the whole dict.
    """
    _check_token(token)

    emails = [e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()]
    if not emails:
        return {"chart_settings": None, "reason": "ADMIN_EMAILS unset"}

    try:
        from api.services.auth_service import get_user_by_email, get_user_preferences
        user = get_user_by_email(emails[0])
        if not user:
            return {"chart_settings": None, "reason": "owner not found"}
        raw = (get_user_preferences(user["id"]) or {}).get("chart_settings")
        if not raw:
            return {"chart_settings": None, "reason": "no saved chart_settings"}
        # Stored as a JSON STRING in pref_value; hand back parsed so the page can
        # spread it straight into the StockChart override without re-parsing.
        import json as _json
        return {"chart_settings": _json.loads(raw) if isinstance(raw, str) else raw}
    except Exception as e:  # noqa: BLE001 -- a broken lookup must not fail the render
        return {"chart_settings": None, "reason": f"{type(e).__name__}"}


# ── breadth reads for /r/breadth + /r/internals ──────────────────────────────
#
# 🔑 WHY THESE EXIST AS SEPARATE DOORS. `9ff74f69` (2026-08-09, the exposed-routes
# audit) put `GET /api/breadth-monitor` and `GET /api/breadth` behind `require_paid`
# — correctly: 3 MB of the tape was answering anonymous callers. But `/r/breadth`
# and `/r/internals` render in a logged-OUT headless browser and fetch exactly those
# two endpoints, so both pages went blank in production and nothing noticed. That
# commit kept `/api/calendar` open precisely because `/r/calendar` needs it; the same
# reasoning simply was not applied here.
#
# ⛔ THE FIX IS A NEW TOKEN-GATED DOOR, NOT A HOLE IN THE PAID ONE. Threading a
# render-token bypass through `require_paid` would put a second authority on "may
# this caller read the tape" inside the gate itself, and `tests/test_exposed_routes_
# gated.py` measures that gate by calling it — a bypass is exactly what it exists to
# refuse. The paid routes stay byte-identical; these serve the render pages only, at
# the same effectively-public standard as every other `/r/*` read above (shared rate
# limit, fail-CLOSED token check).
#
# ⚠️ Anything added here is EFFECTIVELY PUBLIC — the token ships inside the frontend
# bundle. Both payloads below are the same aggregate breadth readings the newsletter
# publishes weekly, which is why they are safe to hand back; do NOT extend these to
# per-symbol constituent lists (the `*_list` drill fields) without re-deciding that.

@router.get("/r/breadth-monitor")
def render_breadth_monitor(token: str = "", days: int = 10):
    """The rolling Breadth Monitor history behind `/r/breadth` (both halves) and
    `/r/internals`. Mirrors `GET /api/breadth-monitor`'s shape exactly — same
    service call, same `{rows, days}` envelope — so the render pages and the
    Sunday-Scan generator can read it without reshaping anything."""
    _check_token(token)
    days = max(1, min(int(days or 10), 3650))
    try:
        from api.services import breadth_monitor as svc
        return {"rows": svc.get_history(days), "days": days}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/r/breadth")
def render_breadth(token: str = ""):
    """The engine's pushed breadth summary (UCT Exposure Rating + MA percentages)
    behind `/r/internals`. Mirrors `GET /api/breadth`."""
    _check_token(token)
    try:
        from api.services.engine import get_breadth
        return get_breadth()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


# ── the week-ahead calendar cards, as PNG bytes ──────────────────────────────

@router.get("/r/calendar-week.png")
def render_calendar_week(token: str = "", kind: str = "earnings", monday: str = ""):
    """The two week-ahead cards the Discord poster already publishes, served as
    PNG bytes so any caller can embed the SAME image.

    🔑 `monday` IS REQUIRED IN PRACTICE — PASS IT, DO NOT LEAN ON THE DEFAULT.
    The card's whole claim is "the week ahead", and which week that is depends on
    the ISSUE being built, not on the server's clock. The Sunday Scan is
    assembled Friday evening for the week that starts the following Monday; a
    server-derived "next Monday" would agree by luck on Friday and be wrong on
    any rebuild (a Saturday `--force`, a Monday re-run of an earlier week). The
    caller already knows its session date, so it owns the answer and passes it —
    one authority, not two (`lesson_a_derived_value_must_not_depend_on_the_request`).
    The default exists only so a human poking the URL gets something sane.

    ⛔ SELECTION IS NOT REIMPLEMENTED HERE. `calendar_week_poster.build_payloads`
    already owns which names appear, how they rank, and where `+N more` truncates,
    and `week_label` owns the caption. This endpoint calls both, so the PNG in the
    newsletter is byte-identical to the one in #event-calendar. A second copy of
    the ranking would drift and the two surfaces would quietly disagree.
    """
    _check_token(token)

    from datetime import date, timedelta

    if kind not in ("earnings", "econ"):
        raise HTTPException(status_code=422, detail="kind must be earnings|econ")

    if monday:
        try:
            m = date.fromisoformat(monday)
        except ValueError:
            raise HTTPException(status_code=422, detail="monday must be YYYY-MM-DD")
        # ⛔ REJECT A NON-MONDAY; DO NOT SNAP TO THE CONTAINING WEEK.
        # An earlier cut snapped backward (`m -= m.weekday()`) to be forgiving.
        # It is the opposite: a caller that passes its SESSION date — the natural
        # mistake, and the one made while building this — gets the week that just
        # ENDED, captioned "THE WEEK AHEAD", looking entirely plausible. Every
        # caller here is code with a date in hand, so the parameter means exactly
        # what it says and a wrong one fails loudly with the answer in the message.
        if m.weekday() != 0:
            raise HTTPException(
                status_code=422,
                detail=(f"monday={m} is a {m.strftime('%A')}; pass that week's "
                        f"Monday. For the week AFTER {m}, pass "
                        f"{m + timedelta(days=7 - m.weekday())}."))
    else:
        # The upcoming Monday, for every weekday — deliberately NOT
        # `_week_dates()[0] + 7`. That helper already rolls to next Monday on a
        # weekend (its own comment says so), so adding a week on top would skip
        # one and silently render the WRONG week every Saturday and Sunday.
        today = date.today()
        m = today + timedelta(days=7 - today.weekday())

    try:
        from api.services.calendar_week_poster import build_payloads, week_label
        from api.services.calendar_week_png import (
            render_earnings_week_png, render_econ_week_png,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"renderer unavailable: {e}")

    try:
        earn_days, econ_days = build_payloads(m)
        label = week_label(m)
        png = (render_earnings_week_png(label, earn_days) if kind == "earnings"
               else render_econ_week_png(label, econ_days))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(e))

    # No caching: the week's roster moves as companies confirm dates, and a
    # newsletter built from a cached card would ship a roster the site disagrees with.
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "no-store"})
