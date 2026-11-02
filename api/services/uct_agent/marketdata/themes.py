"""MD-1 kind `themes` (owner: agent-md) — contract MD-1 v1.3 §4.

Theme performance: equal-weight returns of UCT's curated themes over 1d/1w/1m/3m/1y/ytd. This is the same
payload the Theme Tracker shows, read WITHOUT ever building it.

WHERE THE VALUE COMES FROM, IN ORDER — and why nothing here can cost provider calls
  1. the live overlaid result in the shared cache (`cache[theme_performance._OVERLAID_KEY]`), which every
     Theme Tracker poll keeps warm;
  2. else the member route's last COMPLETE overlay, from its serve-stale slot
     (`api.routers.theme_performance._THEME_STALE.peek(_THEME_KEY)`), within the route's own age bound;
  3. else `unavailable` — "theme data is warming" — with provider_calls 0.
A cold overlay rebuild is about 22 Massive calls (two batch-snapshot maps over ~2,050 holdings), more than
an Agent turn's whole provider budget, so this kind never triggers one. agent-lead's ruling (2026-11-01).
⚠️ COUPLING, stated: steps 1–2 read one cache-key constant from the service and the route's slot. They
are the only non-building read paths. `serve_theme_performance()` and `get_theme_performance()` both
build synchronously on a miss. If either name moves, the tests here fail by name.

TIME (MD-1 §3: the data's own time)
  * The base returns are computed from Massive daily bars of COMPLETED sessions.
  * While a US session can print (`prices_moving()`), the overlay re-prices every period from live
    snapshots and stamps only `live_as_of`: UCT's time of applying the prices, NOT a vendor
    observation time. So in that window `as_of` is null and a note gives the apply time
    (`live_applied_at`). It is never described as live.
  * Otherwise prices are not moving, and `as_of` = the close of the last completed session.
  * `stale` when the base (`generated_at`) predates the last completed session, i.e. it is a session
    behind. freshness is always `periodic`.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

SOURCE = "uct-themes"
PERIODS = ("1d", "1w", "1m", "3m", "1y", "ytd")
DEFAULT_LIMIT = 10
MAX_LIMIT = 30
THEME_FIELDS = ("name", "ticker", "sector", "return_pct", "holdings")
_ET = ZoneInfo("America/New_York")

NOTE_WARMING = "theme data is warming — no complete theme overlay is available yet"
NOTE_LIVE_APPLIED = ("returns include intraday prices applied by UCT at {at} (UCT's apply time; the vendor's "
                     "observation time is not carried) — not a live feed")
NOTE_CLOSED = "returns are as of the last completed session's close"
NOTE_BASE_BEHIND = "theme returns were computed before the last completed session ({session})"
NOTE_EQUAL_WEIGHT = "theme returns are equal-weight means of the curated holdings"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    period = params.get("period", "1d")
    if period not in PERIODS:
        return "`period` must be one of " + ", ".join(PERIODS)
    order = params.get("order", "leaders")
    if order not in ("leaders", "laggards"):
        return "`order` must be 'leaders' or 'laggards'"
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or n < 1:
        return "`limit` must be a positive whole number"
    return None


def _cached_overlay() -> Optional[dict]:
    """The overlaid payload WITHOUT building it (see the module docstring), or None."""
    from api.services import theme_performance as svc
    from api.services.cache import cache
    hit = cache.get(svc._OVERLAID_KEY)
    if isinstance(hit, dict) and hit.get("themes"):
        return hit
    from api.routers import theme_performance as route
    value, age = route._THEME_STALE.peek(route._THEME_KEY)
    bound = route.THEME_STALE_MAX_AGE if svc.prices_moving() else route.THEME_STALE_QUIET_MAX_AGE
    if value is None or age is None or age > bound:
        return None
    payload = value[0] if isinstance(value, tuple) else value
    return payload if isinstance(payload, dict) and payload.get("themes") else None


def _parse(ts: Any) -> Optional[datetime]:
    try:
        d = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=_ET)


def _session_close_utc(ymd: int) -> str:
    from api.services import bars_fetch
    s = str(ymd)
    close = datetime(int(s[:4]), int(s[4:6]), int(s[6:]), tzinfo=_ET) + timedelta(
        minutes=bars_fetch._session_close_minutes(ymd))
    return env.utc_iso(close)


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def read_themes(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    kind = "themes"
    why = validate(params)
    if why:
        return env.unavailable(kind, params, SOURCE, why)
    period = params.get("period", "1d")
    order = params.get("order", "leaders")
    limit = min(params.get("limit", DEFAULT_LIMIT), MAX_LIMIT)

    payload = _cached_overlay()
    if payload is None:
        return env.unavailable(kind, params, SOURCE, NOTE_WARMING)

    from api.services import bars_fetch
    from api.services import theme_performance as svc
    rows, not_computable = [], 0
    themes = [t for t in payload.get("themes") or [] if isinstance(t, dict)]
    for t in themes:
        gr = t.get("group_return") if isinstance(t.get("group_return"), dict) else {}
        v = _num(gr.get(period))
        if v is None:
            not_computable += 1
            continue
        rows.append({"name": t.get("name") or t.get("ticker") or "", "ticker": t.get("ticker") or "",
                     "sector": t.get("sector") or None, "return_pct": v,
                     "holdings": len(t.get("holdings") or [])})
    if not rows:
        return env.unavailable(kind, params, SOURCE, f"no theme has a {period} return yet")
    rows.sort(key=lambda r: r["return_pct"], reverse=(order == "leaders"))

    from api.services.uct_agent.marketdata.sessions import last_completed_session
    latest = last_completed_session()          # half days count from their own close (agent-qa F-23)
    generated = _parse(payload.get("generated_at"))
    stale = False
    notes = [NOTE_EQUAL_WEIGHT]
    if generated is not None:
        gen_session = last_completed_session(now=generated.astimezone(_ET))
        if gen_session < latest:
            stale = True
            s = str(latest)
            notes.append(NOTE_BASE_BEHIND.format(session=f"{s[:4]}-{s[4:6]}-{s[6:]}"))
    else:
        stale = True
        notes.append("the theme base carries no generation time")

    applied = _parse(payload.get("live_as_of"))
    live_applied_at = env.utc_iso(applied) if applied else None
    if svc.prices_moving() and live_applied_at:
        as_of = None
        notes.append(NOTE_LIVE_APPLIED.format(at=live_applied_at))
    else:
        as_of = _session_close_utc(latest)
        notes.append(NOTE_CLOSED)

    data = {"period": period, "order": order, "themes": rows[:limit], "live_applied_at": live_applied_at}
    coverage = {"evaluated": len(themes), "answered": len(rows), "dropped": 0, "not_computable": not_computable}
    return env.make_envelope(kind, params, status="partial" if not_computable else "ok", freshness="periodic",
                             as_of=as_of, source=SOURCE, data=data, stale=stale, coverage=coverage, notes=notes,
                             provider_calls=0)
