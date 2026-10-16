"""Desk session ticker moments linked to the team's archive calls (ADMIN ONLY).

For one Desk session: each stored ticker moment ({t, ticker}) beside the trader
archive calls on that ticker posted the session day or the day before, with the
call's measured outcome. Lets the owner see which moments of a live session
were also written-up calls, and how they resolved.

⛔⛔ PRIVATE BY CONSTRUCTION. This is computed on READ for the admin route only
(`GET /api/admin/wisdom/archive/desk/{video_id}`, require_admin). Nothing here
writes to edu_videos or touches desk_session_insights' stored ticker_moments,
so no archive data can ride into the public outputs that read those moments
(YouTube titles/descriptions, clips captions, the public Discord recap, the
community thread). §0.4g.

⛔ No prices: entry/stop/target are not returned (archive price-privacy rule);
the outcome is returns only.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from typing import Optional

_MONTHS = {m: i for i, m in enumerate(
    ("January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"), 1)}
_TITLE_DATE = re.compile(r"(January|February|March|April|May|June|July|August|September|October"
                         r"|November|December)\s+(\d{1,2}),\s+(\d{4})")
LOOKBACK_DAYS = 1           # a call written up the evening before the session it is discussed in
MAX_CALLS_PER_MOMENT = 5


def session_date(video: dict) -> tuple[Optional[dt.date], str]:
    """(date, source): the title's recording date, else the upload day (UTC), else None."""
    m = _TITLE_DATE.search(video.get("title") or "")
    if m:
        try:
            return dt.date(int(m.group(3)), _MONTHS[m.group(1)], int(m.group(2))), "title"
        except ValueError:
            pass
    created = video.get("created_at")
    if isinstance(created, (int, float)) and created > 0:
        return dt.datetime.fromtimestamp(created, dt.timezone.utc).date(), "created_at"
    return None, "unknown"


def _moments(raw) -> list[dict]:
    try:
        rows = json.loads(raw) if isinstance(raw, str) else (raw or [])
    except ValueError:
        return []
    out = []
    for r in rows if isinstance(rows, list) else []:
        if isinstance(r, dict) and r.get("ticker"):
            out.append({"t": r.get("t"), "ticker": str(r["ticker"]).upper()})
    return out


def _outcome(raw) -> dict:
    try:
        o = json.loads(raw or "{}")
    except ValueError:
        o = {}
    return {k: o.get(k) for k in ("r5", "r20", "r60", "sim_R", "status") if k in o}


def links(conn, video: dict) -> dict:
    """The admin payload for one Desk video. `conn` is a wisdom.db read connection."""
    from api.services.wisdom.archive.askai import _speaker

    day, source = session_date(video)
    moments = _moments(video.get("ticker_moments"))
    out = {"video_id": video.get("id"), "title": video.get("title") or "",
           "session_date": day.isoformat() if day else None, "date_source": source,
           "moments": [], "n_linked": 0}
    if day is None:
        out["moments"] = [{**m, "calls": []} for m in moments]
        return out
    lo = (day - dt.timedelta(days=LOOKBACK_DAYS)).isoformat()
    hi = day.isoformat() + "T99"
    for m in moments:
        rows = conn.execute(
            "SELECT call_id, record_id, author_id, setup, direction, action, posted, outcome_json "
            "FROM wisdom_archive_calls WHERE ticker = ? AND posted >= ? AND posted <= ? "
            "ORDER BY posted ASC, call_id ASC LIMIT ?",
            (m["ticker"], lo, hi, MAX_CALLS_PER_MOMENT)).fetchall()
        calls = [{"call_id": r[0], "record_id": r[1], "trader": _speaker(r[2]), "setup": r[3],
                  "direction": r[4], "action": r[5], "posted": r[6], "outcome": _outcome(r[7])}
                 for r in rows]
        out["moments"].append({**m, "calls": calls})
        out["n_linked"] += bool(calls)
    return out
