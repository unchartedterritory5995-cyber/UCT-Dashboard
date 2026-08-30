"""One aggregate behind Zone D's eight signpost cards.

⛔ Reads ONLY already-cached services — no new network calls, no new SQLite
queries on the request path. Zone D exists to replace ~4,000px of preview
tiles with ~90px of links-with-numbers; if it costs eight fetches (or even
one slow one) it has not replaced anything.

Each card block below is independently best-effort: an exception (or a genuine
absence of cached data) in one block never takes the other seven down, and
never blocks the response. A card whose value is `None` renders as a plain
link with no number — a valid state, not an error.

Several of the eight doors are deliberately left `None` rather than wired to
a "cheap-looking" read that is not actually safe on this request path:

  * `desk`     — no existing service wraps the video listing in a TTLCache;
                 reading it here would be new uncached work.
  * `journal`  — per-user data. This endpoint's payload is cached under ONE
                 global key (`dashboard_signposts`) shared by every logged-in
                 user, so writing one member's open-trade count into it would
                 leak that count to the next 60 seconds' worth of everyone
                 else's requests.
  * `community`— same per-user/single-global-cache-key problem as `journal`.

See `app/src/pages/dashboard/doors.js` for the manifest these 8 keys are
derived from — it is the single authority for what the doors are.
"""
from fastapi import APIRouter, Depends

from api.middleware.auth_middleware import get_current_user
from api.services import engine
from api.services.cache import cache

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

_TTL = 60


def _card(label: str, value, tone: str = "neutral") -> dict:
    return {"label": label, "value": value, "tone": tone}


@router.get("/signposts")
def signposts(user: dict = Depends(get_current_user)) -> dict:
    cached = cache.get("dashboard_signposts")
    if cached is not None:
        return cached

    out: dict[str, dict] = {}

    # breadth — Exposure score. engine.get_breadth() never does network I/O on
    # Railway: its only live-fetch fallback imports a local-dev-only package
    # that isn't deployed, so a cache miss falls through to a disk read (or
    # empty) instead of a live Finviz call.
    try:
        b = engine.get_breadth() or {}
        out["breadth"] = _card("Exposure", (b.get("exposure") or {}).get("score"))
    except Exception:
        out["breadth"] = _card("Exposure", None)

    # options_flow — count of live Top Flow picks. top_flow_tracker.get_all()
    # reads an in-process dict loaded once at startup — zero I/O per call.
    try:
        from api.top_flow_tracker import get_all as _get_top_flow_picks
        picks = _get_top_flow_picks() or {}
        active = picks.get("active")
        out["options_flow"] = _card("Today", len(active) if active is not None else None)
    except Exception:
        out["options_flow"] = _card("Today", None)

    # uct20 — count of open positions entered on the most recent entry date
    # (mirrors the "NEW badge" idiom on /uct-20). Peeks the SAME cache key
    # engine.get_uct20_portfolio_data() writes to, WITHOUT calling that
    # function: on a cache miss it can fall through to a direct
    # uct_intelligence.api call that fetches bars for every ever-held symbol
    # (real network work) — exactly what this endpoint must never do. A cold
    # key here just means the card stays null until something else warms it.
    try:
        portfolio = cache.get("uct20_portfolio") or {}
        positions = portfolio.get("open_positions") or []
        entry_dates = [p.get("entry_date") for p in positions if p.get("entry_date")]
        latest = max(entry_dates) if entry_dates else None
        new_count = (
            sum(1 for p in positions if p.get("entry_date") == latest)
            if latest else None
        )
        out["uct20"] = _card("This week", new_count)
    except Exception:
        out["uct20"] = _card("This week", None)

    # calendar — tonight's AMC reporter count ("on deck" = up next). Peeks the
    # "earnings" cache key directly rather than calling engine.get_earnings():
    # that function does a LIVE EarningsWhispers/Finnhub/FMP fetch on a cache
    # miss, which is exactly the network call this endpoint must never make.
    try:
        earnings = cache.get("earnings") or {}
        amc_tonight = earnings.get("amc_tonight")
        out["calendar"] = _card(
            "On deck", len(amc_tonight) if amc_tonight is not None else None
        )
    except Exception:
        out["calendar"] = _card("On deck", None)

    # screener — total scanner candidates. get_candidates() never does network
    # I/O even on a cache miss (cache → wire_data → local file → empty dict).
    try:
        candidates = engine.get_candidates() or {}
        out["screener"] = _card("Matches", (candidates.get("counts") or {}).get("total"))
    except Exception:
        out["screener"] = _card("Matches", None)

    # desk, journal, community — see module docstring for why these stay null.
    for key, label in (
        ("desk", "New"), ("journal", "Open"), ("community", "Unread"),
    ):
        out[key] = _card(label, None)

    cache.set("dashboard_signposts", out, ttl=_TTL)
    return out
