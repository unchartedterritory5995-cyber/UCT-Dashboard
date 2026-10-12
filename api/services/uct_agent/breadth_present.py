"""The member-facing VIEW of a breadth answer (Agent response presentation, 2026-10-12).

`view_of(res, answer)` turns Market Intelligence's structured read result (breadth_reads.read) into the
Agent's presentation contract (app/src/agent/present.js): the smallest view that carries it — a single
figure, two dates compared, a period summarised, or a few labelled figures — with MI's full answer
text and table kept as collapsed details by the browser.

⛔ VALUES ARE MI's, UNCHANGED: every number is formatted by breadth_answer.fmt_value / fmt_change
from the read result; nothing is recomputed, rounded differently or substituted.
⛔ MEMBER CHANNEL ONLY: this view goes to the browser and the member's saved transcript. The breadth
row is local-only — the server's history door (turn.outcome_for_model) replays a fixed note instead.
"""
from __future__ import annotations

from datetime import date as _date, timedelta as _td
from typing import Any, Optional

from api.services.market_intel import breadth_answer as _ba

#: The documented GENERAL breadth overview ("what's breadth today?"): four representative measures —
#: participation (short and long trend), leadership and breadth of the day's moves. Within MI's
#: four-measure limit; the browser sends these when the member names no measure.
OVERVIEW_METRICS = ("pct_above_50sma", "pct_above_200sma", "net_new_high_low", "adv_decline")


def _today_et() -> Optional[str]:
    try:
        from api.services import breadth_symbols as _bs
        return _bs._et_today()
    except Exception:  # noqa: BLE001
        return None


def freshness_note(last: Optional[str], today: Optional[str] = None) -> Optional[str]:
    """DATES ONLY (MI D5): when the latest FINALIZED session lags the last completed trading session,
    say which session(s) are not finalized yet — never a value, never a provisional reading."""
    today = today or _today_et()
    if not last or not today:
        return None
    try:
        from api.services import session_calendar as _sc
        d, end = _date.fromisoformat(last) + _td(days=1), _date.fromisoformat(today)
        missing = []
        while d < end and len(missing) < 6:
            if _sc.is_trading_day(d):
                missing.append(d.isoformat())
            d += _td(days=1)
    except Exception:  # noqa: BLE001
        return None
    if not missing:
        return None
    gap = missing[0] if len(missing) == 1 else f"{missing[0]} – {missing[-1]}"
    verb = "isn't" if len(missing) == 1 else "aren't"
    # the card already names its session ("As of <last> close", the Latest tile's date)
    return f"{gap} {verb} finalized in UCT's breadth data yet."


def _join(*parts: Optional[str]) -> str:
    """Note parts as sentences; a lone first part keeps its original (period-less) wording."""
    xs = [x for x in parts if x]
    return xs[0] if len(xs) == 1 else " ".join(x if x.endswith(".") else f"{x}." for x in xs)


def _change(m: dict, delta: float) -> tuple[str, str]:
    """(value, word) for a change LATER − EARLIER: a true minus sign, and Up / Down / Unchanged."""
    txt = _ba.fmt_change(m.get("unit"), delta)
    if delta == 0 or txt.lstrip("+-").startswith(("0.0 ", "0 ")) or txt in ("+0", "-0", "+0.00", "-0.00"):
        return txt.lstrip("+-"), "Unchanged"
    return (f"\u2212{txt[1:]}" if txt.startswith("-") else txt), ("Down" if delta < 0 else "Up")


def _v(m: dict, x: float) -> str:
    return _ba.fmt_value(m.get("unit"), m.get("domain"), x)


def _when(p: dict) -> str:
    """The session used, and — only when it differs from what was asked — what was asked."""
    if p.get("snapped") and p.get("requested_date"):
        return f"{p['as_of']} (nearest finalized session to {p['requested_date']})"
    return str(p.get("as_of") or "")


def view_of(res: Any, answer: dict) -> Optional[dict]:
    """The view for one breadth answer, or None (the browser then derives one from text + table)."""
    if not isinstance(res, dict):
        return None
    status = res.get("status")
    if status not in ("ok", "partial"):
        # every measure refused: the SPECIFIC reason lives on the measures (MI's own wording), not on
        # the top-level result — say it, never a generic "not available"
        why = [_ba._why(m) for m in res.get("metrics") or [] if isinstance(m, dict) and m.get("reason")]
        text = " ".join(dict.fromkeys(why)) or str(answer.get("text") or "That breadth answer isn't available.")
        return {"kind": "error", "text": text}
    mode = (res.get("request") or {}).get("mode")
    uni = res.get("universe_label") or ""
    mets = [m for m in res.get("metrics") or [] if isinstance(m, dict)]
    ok = [m for m in mets if m.get("status") == "ok"]
    if not ok:
        return {"kind": "error", "text": str(answer.get("text") or "That breadth answer isn't available.")}
    missing = [m for m in mets if m.get("status") != "ok"]
    gap = (f"Not available: {', '.join(str(m.get('label') or m.get('metric')) for m in missing)}." if missing else None)

    req = res.get("request") or {}
    asked_latest = (mode == "value" and not req.get("date")) or (mode == "compare" and not (req.get("date") and req.get("compare_date"))) \
        or (mode == "series" and not req.get("end"))
    fresh = freshness_note((res.get("coverage") or {}).get("last")) if asked_latest else None
    overview = mode == "value" and set(req.get("metrics") or []) == set(OVERVIEW_METRICS)

    if mode == "value":
        if len(ok) == 1 and not missing:
            m = ok[0]
            return {"kind": "value", "value": _v(m, m["value"]), "label": f"{uni} · {m['label']}",
                    "note": _join(f"As of {_when(m)} close", fresh)}
        dates = {m.get("as_of") for m in ok}
        return {"kind": "metrics", "title": f"{uni} breadth overview" if overview else uni,
                "items": [{"label": m["label"], "value": _v(m, m["value"]),
                           **({} if len(dates) == 1 else {"note": _when(m)})} for m in ok]
                         + [{"label": m.get("label") or m.get("metric"), "value": "—", "note": "not available"} for m in missing],
                "note": _join(f"As of {next(iter(dates))} close" if len(dates) == 1 else None, gap, fresh)}

    if mode == "compare":
        last_fin = (res.get("coverage") or {}).get("last")
        if len(ok) == 1 and not missing:
            m = ok[0]
            early, late, delta = _chrono(m)
            ch, word = _change(m, delta)
            return {"kind": "comparison", "title": f"{uni} · {m['label']}",
                    "items": [{"label": "Earlier", "value": _v(m, early["value"]), "note": _when(early)},
                              {"label": "Latest" if late.get("as_of") == last_fin else "Later", "value": _v(m, late["value"]), "note": _when(late)},
                              {"label": "Change", "value": ch, "note": word, "tone": {"Down": "down", "Up": "up"}.get(word, "")}],
                    **({"note": fresh} if fresh else {})}
        rows = []
        for m in ok:
            early, late, delta = _chrono(m)
            ch, word = _change(m, delta)
            rows.append({"label": m["label"], "value": f"{_v(m, early['value'])} → {_v(m, late['value'])}",
                         "note": f"{word} {ch.lstrip(chr(0x2212)).lstrip('+')} · {early['as_of']} → {late['as_of']}" if word != "Unchanged" else f"Unchanged · {early['as_of']} → {late['as_of']}"})
        return {"kind": "metrics", "title": f"{uni} · compared", "items": rows,
                **({"note": _join(gap, fresh)} if (gap or fresh) else {})}

    if mode == "series":
        if len(ok) == 1 and not missing:
            m = ok[0]
            return {"kind": "range", "title": f"{uni} · {m['label']}",
                    "items": [{"label": "First", "value": _v(m, m["first"]["value"]), "note": m["first"]["date"]},
                              {"label": "Last", "value": _v(m, m["last"]["value"]), "note": m["last"]["date"]},
                              {"label": "Change", "value": _ba.fmt_change(m.get("unit"), m["change"])},
                              {"label": "Low", "value": _v(m, m["min"]["value"]), "note": m["min"]["date"]},
                              {"label": "High", "value": _v(m, m["max"]["value"]), "note": m["max"]["date"]},
                              {"label": "Average", "value": _v(m, m["mean"])}],
                    "note": _join(f"{m['sessions']} finalized sessions, {m['start']} – {m['end']}", fresh)}
        return {"kind": "metrics", "title": f"{uni} · {ok[0]['start']} – {ok[0]['end']}",
                "items": [{"label": m["label"], "value": f"{_v(m, m['first']['value'])} → {_v(m, m['last']['value'])}",
                           "note": _ba.fmt_change(m.get("unit"), m["change"])} for m in ok], **({"note": gap} if gap else {})}
    return None


def _chrono(m: dict) -> tuple[dict, dict, float]:
    """(earlier, later, later − earlier) for a compared measure, whatever order the request named them.
    MI's `change` is current − other; when `current` is the EARLIER session it is negated — the same
    number, oriented by time, never recomputed."""
    a, b = m["current"], m["other"]
    if str(a.get("as_of") or "") >= str(b.get("as_of") or ""):
        return b, a, m["change"]
    return a, b, -m["change"]

