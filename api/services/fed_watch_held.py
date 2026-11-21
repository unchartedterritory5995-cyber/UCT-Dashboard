"""READ ONLY: the Fed watch answer from what this server already holds, its rates block included.

`fed_watch.held_answer()` never starts a build, but its rates block asks the economics store
(`econ.serving.series`) for three series, and on a cold serving cache that store reads its published files from the
data bucket (`data_sync.get_bytes`, a request off the server). A reader that must never cause a request (the UCT
Agent's `fed.watch` data kind, MD-1 §4.18) reads through `held_answer()` here instead: every block exactly as the
service builds it (the service's own block functions, under the service's own lock), except the rates block, which is
read only from what the economics store's serving cache already holds (`held_rates`). Nothing held there is
`not_held`, said; it never reads the bucket, never asks the Board, the New York Fed or the calendar's providers, and
never writes to the shared cache.

It lives beside the service and not inside it, so the service's own calls are unchanged. Two rails hold it to the
service: with the economics feature off (where the service causes no request either) its answer equals
`fed_watch.held_answer()` block for block, and with it on, the rates the service reads through `serving.series` are
the rates this reader finds in the serving cache afterwards (so a cache key that drifted fails it).
"""
from __future__ import annotations

import os
from typing import Any, Optional

#: (the block's name, the economics store's series) as `fed_watch.rates_block` reads them (a rail pins each name in it)
RATE_SERIES = (("effective", "USEFFR"), ("upper", "USFEDFUNDSU"), ("lower", "USFEDFUNDSL"))


def latest_point(body: Any) -> dict:
    """The newest point of one series body, as `fed_watch._latest_point` takes it from `serving.series`: the value of
    the point with the newest (release day, sequence), dated by its release day (or its period). None, never 0."""
    best = None
    for p in (body.get("points") if isinstance(body, dict) else None) or []:
        if not isinstance(p, (list, tuple)) or len(p) < 4:
            continue
        v = p[1]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        key = (str(p[3] or ""), p[0] or 0)
        if best is None or key > best[0]:
            best = (key, float(v), str(p[3] or p[2] or "")[:10] or None)
    if best is None:
        return {"value": None, "date": None, "reason": "no_data"}
    return {"value": best[1], "date": best[2], "reason": None}


def held_point(symbol: str) -> dict:
    """READ ONLY: the newest point of one economics series from what the serving cache holds, or `not_held`. It never
    loads the series (no bucket read, no database open)."""
    from api.services.econ import publish as P
    from api.services.econ import serving
    entry = P.resolve(symbol)
    if entry is None:
        return {"value": None, "date": None, "reason": "no_data"}
    with serving._lock:
        hit = serving._cache.get(f"series:{entry['symbol']}:None:None:None")
    if hit is None:
        return {"value": None, "date": None, "reason": "not_held"}
    return latest_point(hit[1])                             # the cache's own miss marker is not a dict: no data


def held_rates() -> dict:
    """READ ONLY: the rates block as `fed_watch.rates_block` builds it, from the serving cache only. state: 'off'
    (the economics feature is switched off: the service's own words), 'ok' (at least one figure), 'not_held' (no
    figure, and at least one series is not in the serving cache) or 'no_data'."""
    from api.services import fed_watch as fw
    out: dict[str, Any] = {"source": fw.SOURCE_NYFED, "notice": fw.NYFED_RATE_NOTICE}
    if os.environ.get("ECON_ENABLED", "0") != "1":
        off = {"value": None, "date": None, "reason": "econ_off"}
        return {**out, "state": "off", "effective": dict(off), "upper": dict(off), "lower": dict(off)}
    points = {name: held_point(symbol) for name, symbol in RATE_SERIES}
    if any(p["value"] is not None for p in points.values()):
        state = "ok"
    elif any(p["reason"] == "not_held" for p in points.values()):
        state = "not_held"
    else:
        state = "no_data"
    return {**out, "state": state, **points}


def held_answer() -> tuple[dict, str]:
    """READ ONLY: `(answer, how)` from what the service and the economics store's serving cache already hold, as
    `fed_watch.held_answer()` builds it but with `held_rates()` as its rates block. how: 'held' | 'not_held' (the
    Board's feeds have never been read on this server). Never starts a build and never causes a request."""
    from api.services import fed_watch as fw
    fw._ensure_loaded()
    today = fw.now_et().date()
    with fw._lock:
        statement = fw.statement_block(False)
        speeches = fw.speeches_block(False)
        projections = fw.projections_block(False)
        survey = fw.survey_block(False, today.isoformat())
        held_survey = sorted(fw._state["surveys"].values(), key=lambda s: (s.get("year") or 0, s.get("month") or 0),
                             reverse=True)
        extract: Optional[dict] = held_survey[0].get("extract") if held_survey else None
    answer = {
        "status": "ok",
        "statement": statement,
        "speeches": speeches,
        "headlines": fw.headlines_block(),
        "calendar": fw.calendar_block(today, extract),
        "rates": held_rates(),
        "projections": projections,
        "survey": survey,
        "board_cite": fw.BOARD_CITE,
        "built_at": fw._now_iso(),
    }
    return answer, ("held" if fw._board_held() else "not_held")
