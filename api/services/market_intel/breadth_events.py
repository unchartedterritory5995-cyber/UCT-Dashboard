"""Historical breadth event queries: "when was Nasdaq % above its 50-day last below 20?", "how many
times did NYSE net new highs cross above zero since 2015?", "longest stretch above 80?".

A thin query layer over Slice 2's condition core — ONE detector for the whole of Market
Intelligence. Values come from `breadth_reads.sealed_series` (finalized daily sessions under the
universe authority's watermark, the D5 cut; provisional sessions never appear). The session
calendar, alignment and the level / crossing truth are `event_study`'s own (`_trading_days`,
`_align`, `_truth`), so a crossing here is exactly a crossing in an event study.

Request (validate() is pure and value-free; the Agent's history note is rebuilt from it):
    {universe: us|nyse|nasdaq, metric: <breadth_reads.SLICE1_METRICS>,
     op: below|at_or_below|above|at_or_above|crosses_below|crosses_above, level: number,
     find: last|first|count|episodes|longest|last_episode,
     start?: YYYY-MM-DD|null, end?: YYYY-MM-DD|null, aggregation?: "daily"}

Semantics:
  * below / above are strict; at_or_below / at_or_above include the level.
  * crosses_below: the previous VALID session was at or above the level and this one is below it
    (crosses_above mirrors it) — a missing or invalid session in between is not a crossing.
  * An EPISODE is a maximal run of consecutive qualifying sessions; a missing/invalid session or a
    non-qualifying one ends it. Episodes apply to level ops only (a crossing is one session).
  * `ongoing`: the episode reaches the last session searched (it may continue). `began_before_window`:
    it was already running on the first session searched (its true start is earlier).
  * count: level ops → {sessions, episodes}; crossings → {events}.

⛔ LOCAL ONLY. Results carry finalized breadth values; they are shown to the member and never sent
to a model. No model or network client is imported here.
"""
from __future__ import annotations

import concurrent.futures as _cf
from typing import Any, Optional

from api.services.market_intel import breadth_reads as _br
from api.services.market_intel import event_study as _es
from api.services.market_intel import series_adapters as _sa
from api.services.market_intel.breadth_answer import fmt_value

OPS = ("below", "at_or_below", "above", "at_or_above", "crosses_below", "crosses_above")
FINDS = ("last", "first", "count", "episodes", "longest", "last_episode")
AGGREGATIONS = ("daily",)
RESERVED_AGGREGATIONS = ("weekly",)
EPISODE_FINDS = ("episodes", "longest", "last_episode")
MAX_LISTED = 60
DEADLINE_S = 5.0
_KEYS = {"universe", "metric", "op", "level", "find", "start", "end", "aggregation"}

_pool = _cf.ThreadPoolExecutor(max_workers=2, thread_name_prefix="mi-breadth-events")

_OP_WORDS = {"below": "below", "at_or_below": "at or below", "above": "above", "at_or_above": "at or above",
             "crosses_below": "crossed below", "crosses_above": "crossed above"}
_FIND_WORDS = {"last": "most recent", "first": "first", "count": "how often", "episodes": "every stretch",
               "longest": "longest stretch", "last_episode": "most recent stretch"}


def _refused(reason: str, detail: str) -> dict:
    return {"status": "refused", "reason": reason, "detail": detail}


def validate(req: Any) -> tuple[Optional[dict], Optional[dict]]:
    """(normalised request, None) or (None, refusal). PURE and VALUE-FREE: reads nothing; the output
    holds only enums, the member's own level and ISO dates, and registry labels."""
    if not isinstance(req, dict) or "op" not in req or "find" not in req:
        return None, _refused("bad_request", "The breadth history request was not understood.")
    if set(req) - _KEYS:
        return None, _refused("bad_request", "Unexpected fields in the breadth history request.")
    series, err = _sa.describe({"kind": "breadth", "universe": req.get("universe"), "metric": req.get("metric")})
    if err:
        return None, err
    op, find = req.get("op"), req.get("find")
    if op not in OPS:
        return None, _refused("bad_condition", "The condition is below, at or below, above, at or above, "
                                               "crosses below or crosses above a level.")
    if find not in FINDS:
        return None, _refused("bad_request", "Ask for the last, first, count, episodes, longest or last episode.")
    if op.startswith("crosses_") and find in EPISODE_FINDS:
        return None, _refused("bad_request", "Stretches apply to below/above conditions; a crossing is a single "
                                             "session — ask for the last, first or count of crossings.")
    agg = req.get("aggregation") or "daily"
    if agg in RESERVED_AGGREGATIONS:
        return None, _refused("not_supported", "Only daily sessions are supported for now.")
    if agg not in AGGREGATIONS:
        return None, _refused("bad_request", "aggregation is daily.")
    level = _es._finite(req.get("level")) if not isinstance(req.get("level"), bool) else None
    if level is None or not _sa.threshold_ok(series["domain"], level):
        return None, _refused("bad_threshold", "That level isn't a possible value for this measure.")
    start, end = req.get("start"), req.get("end")
    if (start is not None and not _es._parse_date(start)) or (end is not None and not _es._parse_date(end)):
        return None, _refused("bad_date", "Dates must be real calendar dates (YYYY-MM-DD).")
    if start and end and end < start:
        return None, _refused("bad_date", "The window ends before it starts.")
    return {"universe": series["universe"], "metric": series["metric"], "label": series["label"],
            "unit": series["unit"], "domain": series["domain"], "op": op, "level": level, "find": find,
            "aggregation": agg, "start": _es._parse_date(start) if start else None,
            "end": _es._parse_date(end) if end else None}, None


def request_note(raw: Any) -> str:
    """One value-free line of what the member ASKED, rebuilt only from validate() ("" if invalid)."""
    ok, _ = validate(raw)
    if not ok:
        return ""
    span = f"; {ok['start'] or 'start of history'} to {ok['end'] or 'latest finalized'}" if (ok["start"] or ok["end"]) else ""
    return (f"breadth history: {_FIND_WORDS[ok['find']]} — {ok['label']} {_OP_WORDS[ok['op']]} "
            f"{ok['level']:g} (finalized daily sessions{span})")


def _truth(op: str, level: float, cal: list, known: dict) -> dict:
    """session → True/False/None using event_study's own truth (crossings identical to Slice 2)."""
    if op in ("below", "above"):
        return _es._truth({"op": op, "threshold": level}, cal, known, None)
    if op in ("at_or_below", "at_or_above"):
        flip = _es._truth({"op": "above" if op == "at_or_below" else "below", "threshold": level}, cal, known, None)
        return {d: (None if v is None else not v) for d, v in flip.items()}
    return _es._truth({"op": "cross_below" if op == "crosses_below" else "cross_above", "threshold": level},
                      cal, known, None)


def _query(q: dict) -> dict:
    s = _br.sealed_series(q["universe"], q["metric"])
    if s.get("status") != "ok":
        return {**s, "request": q}
    rows = s["rows"]
    if not rows:
        return {"status": "unavailable", "reason": "not_populated", "detail": "There is no finalized history yet.",
                "request": q}
    first, last = rows[0][0], rows[-1][0]
    ws, we = max(first, q["start"] or first), min(last, q["end"] or last)
    if ws > we:
        return {"status": "refused", "reason": "no_sessions",
                "detail": f"Finalized history runs {first} to {last}.", "request": q,
                "coverage": {"first": first, "last": last}}
    cal = _es._trading_days(first, last)
    known, _ = _es._align({"rows": rows, "alignment": "session"}, cal)
    truth = _truth(q["op"], q["level"], cal, known)
    win = [d for d in cal if ws <= d <= we]
    gaps = [d for d in win if known.get(d) is None]
    events = [{"date": d, "value": known[d]} for d in win if truth.get(d)]
    episodes, cur = [], None
    for d in win:
        if truth.get(d):
            if cur is None:
                cur = {"start": d, "end": d, "sessions": 0, "values": []}
            cur["end"] = d
            cur["sessions"] += 1
            cur["values"].append(known[d])
        elif cur is not None:
            episodes.append(cur)
            cur = None
    if cur is not None:
        episodes.append(cur)
    crossing = q["op"].startswith("crosses_")
    i0 = cal.index(win[0])
    before = bool(truth.get(cal[i0 - 1])) if i0 > 0 else False     # already running the session before?
    eps = []
    for e in episodes:
        vals = e.pop("values")
        eps.append({**e, "ongoing": e["end"] == win[-1],
                    "began_before_window": e["start"] == win[0] and before,
                    "min": min(vals), "max": max(vals)})
    if crossing:
        eps = []
    counts = ({"events": len(events)} if crossing else {"sessions": len(events), "episodes": len(eps)})
    find = q["find"]
    out = {"status": "ok", "request": q, "counts": counts,
           "coverage": {"first": first, "last": last, "searched_start": win[0], "searched_end": win[-1],
                        "sessions_searched": len(win), "authority": (s.get("coverage") or {}).get("authority")},
           "gaps": {"count": len(gaps), "dates": gaps[:20]}}
    if find in ("last", "first"):
        hit = (events[-1] if find == "last" else events[0]) if events else None
        out["event"] = hit
        if not crossing and hit is not None:
            out["episode"] = next(e for e in eps if e["start"] <= hit["date"] <= e["end"])
    elif find == "count":
        out["events"] = events[-MAX_LISTED:] if crossing else []
    elif find == "episodes":
        out["episodes"] = eps[-MAX_LISTED:]
        out["episodes_listed_truncated"] = len(eps) > MAX_LISTED
    elif find == "longest":
        out["episode"] = max(eps, key=lambda e: (e["sessions"], e["end"])) if eps else None
    elif find == "last_episode":
        out["episode"] = eps[-1] if eps else None
    return out


def run(request: Any, *, deadline_s: float = DEADLINE_S) -> dict:
    """Validate and answer one breadth history query. Never raises."""
    q, refusal = validate(request)
    if refusal:
        return refusal
    fut = _pool.submit(_query, q)
    try:
        return fut.result(timeout=deadline_s)
    except _cf.TimeoutError:
        return {"status": "unavailable", "reason": "warming", "request": q,
                "detail": "Breadth history is still loading. Ask again in a moment."}
    except Exception:
        return {"status": "unavailable", "reason": "failed", "request": q,
                "detail": "The breadth history couldn't be searched."}


# ── deterministic member-facing answer ────────────────────────────────────────

_REASON_TEXT = {
    "bad_request": "I couldn't read that breadth history request.",
    "bad_condition": "That condition isn't one I can search for.",
    "bad_threshold": "That level isn't a possible value for this measure.",
    "bad_date": "Those dates weren't usable.",
    "not_supported": "Only daily sessions are supported for now.",
    "unsupported_universe": "Breadth history covers US, NYSE and Nasdaq stocks only.",
    "unknown_metric": "That breadth measure isn't available here.",
    "no_sessions": "No finalized sessions fall in that window.",
}


def _why(r: dict) -> str:
    base = _REASON_TEXT.get(r.get("reason")) or _br_reason(r)
    d = r.get("detail")
    return f"{base} {d}" if d and d not in base else base


def _br_reason(r: dict) -> str:
    from api.services.market_intel import breadth_answer as _ba
    return _ba._why(r)


def answer(res: Any) -> dict:
    """{status, text, table, lead, caveats} — every sentence built from the result; never raises."""
    if not isinstance(res, dict) or res.get("status") != "ok":
        r = res if isinstance(res, dict) else {}
        t = _why(r)
        return {"status": r.get("status") or "unavailable", "text": t, "table": None, "lead": t, "caveats": []}
    q, c, cov = res["request"], res["counts"], res["coverage"]
    v = lambda x: fmt_value(q["unit"], q["domain"], x)  # noqa: E731
    cond = f"{q['label']} {_OP_WORDS[q['op']]} {v(q['level'])}"
    span = f"{cov['searched_start']} to {cov['searched_end']}"
    crossing = q["op"].startswith("crosses_")
    find, rows, cols = q["find"], [], None
    ep_cols = [{"key": "start", "label": "From"}, {"key": "end", "label": "To"},
               {"key": "sessions", "label": "Sessions"}, {"key": "range", "label": "Range"}]

    def ep_row(e):
        return {"start": e["start"] + (" (or earlier)" if e["began_before_window"] else ""),
                "end": e["end"] + (" (ongoing)" if e["ongoing"] else ""), "sessions": str(e["sessions"]),
                "range": f"{v(e['min'])} – {v(e['max'])}"}

    if find in ("last", "first"):
        e = res.get("event")
        if e is None:
            lead = f"{cond}: never, in finalized sessions {span}."
        else:
            lead = f"{cond}: {'most recently' if find == 'last' else 'first'} on {e['date']} ({v(e['value'])})."
            ep = res.get("episode")
            if ep and ep["sessions"] > 1:
                lead += f" That stretch ran {ep['start']} to {ep['end']}, {ep['sessions']} sessions."
    elif find == "count":
        if crossing:
            lead = f"{cond}: {c['events']} time{'s' if c['events'] != 1 else ''} in finalized sessions {span}."
            cols = [{"key": "date", "label": "Session"}, {"key": "value", "label": "Value"}]
            rows = [{"date": e["date"], "value": v(e["value"])} for e in res.get("events") or []]
        else:
            lead = (f"{cond}: {c['sessions']} session{'s' if c['sessions'] != 1 else ''} in "
                    f"{c['episodes']} separate stretch{'es' if c['episodes'] != 1 else ''}, finalized sessions {span}.")
    elif find == "episodes":
        eps = res.get("episodes") or []
        lead = f"{cond}: {c['episodes']} stretch{'es' if c['episodes'] != 1 else ''} in finalized sessions {span}."
        cols, rows = ep_cols, [ep_row(e) for e in eps]
    else:
        e = res.get("episode")
        what = "Longest stretch" if find == "longest" else "Most recent stretch"
        if e is None:
            lead = f"{cond}: never, in finalized sessions {span}."
        else:
            lead = (f"{what} with {cond}: {e['start']}{' (or earlier)' if e['began_before_window'] else ''} to "
                    f"{e['end']}, {e['sessions']} session{'s' if e['sessions'] != 1 else ''} "
                    f"(range {v(e['min'])} – {v(e['max'])}){' — still running at the latest finalized session' if e['ongoing'] and e['end'] == cov['last'] else ''}.")
    caveats = []
    if res["gaps"]["count"]:
        caveats.append(f"{res['gaps']['count']} session(s) in the window have no finalized value; they never "
                       f"qualify and they break a stretch.")
    if res.get("episodes_listed_truncated"):
        caveats.append(f"Only the latest {MAX_LISTED} stretches are listed; the count covers all of them.")
    if find == "count" and crossing and c["events"] > MAX_LISTED:
        caveats.append(f"Only the latest {MAX_LISTED} crossings are listed; the count covers all of them.")
    foot = (f"Source: UCT Breadth, finalized end-of-day sessions only (history {cov['first']} to {cov['last']}; "
            f"searched {span}).")
    text = "\n".join([lead, *caveats, foot])
    return {"status": "ok", "text": text, "table": {"columns": cols, "rows": rows} if cols and rows else None,
            "lead": lead, "caveats": caveats}
