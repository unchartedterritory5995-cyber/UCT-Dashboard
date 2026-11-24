"""READ ONLY: one earnings season by sector (ERNSC) as this server already holds it.

`sector_earnings.get_season()` answers from `held_build.HeldBuild.get()`, which STARTS the one background read of every
stock's held earnings copy when the held answer is due (more than 30 minutes old, or built on another day), and with
nothing held waits a few seconds on it. A reader that must never cause that work (the UCT Agent's
`earnings.seasonBySector` data kind, MD-1 §4.20) reads through `held_season()` instead: the same table the route serves
for a season (every sector's figures, the total, and for the season that holds today each sector's figures for the same
season a year earlier), shaped by the same steps over the answer the service already holds (`sector_earnings.peek()`,
which never starts a read), or nothing. It never builds, never reads the snapshot store and never writes anything.

It lives beside the service and not inside it, so the service's own calls are unchanged. A rail drives the service
itself over invented copies and checks this reader gives the route's own table, season by season, so a drift fails it.
"""
from __future__ import annotations

from typing import Optional


def held_season(season: str = "current") -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)` for one season (`current`, `previous` or `year_ago`), without starting a read.

    `how` is `held` (the route's own table for the season, with the service's `check` beside it: a look that did not go
    well since) or `not_held` (nothing is held, or the season is not one the service knows). Never builds."""
    from api.services import sector_earnings as svc
    from api.services import sector_earnings_calc as C
    if season not in C.SEASON_IDS:
        return None, "not_held"
    got = svc.peek()
    if not isinstance(got, dict) or got.get("status") != "ok" or not isinstance(got.get("slices"), dict):
        return None, "not_held"
    slices = got["slices"]
    blank = {"total": C.figures([]) | {"to_report": 0, "awaiting": 0}, "sectors": []}
    sl = slices.get(season) or blank
    ago = (slices.get("year_ago") or blank) if season == "current" else None
    ago_by = {s["name"]: s for s in ago["sectors"]} if ago else {}
    out = {k: v for k, v in got.items() if k not in ("slices", "build")}
    out["season"] = season
    out["total"] = {**C.brief(sl["total"]), "year_ago": C.brief(ago["total"]) if ago else None}
    out["sectors"] = [{**C.brief(s), "year_ago": C.brief(ago_by.get(s["name"])) if ago else None} for s in sl["sectors"]]
    out["count"] = len(out["sectors"])
    return out, "held"
