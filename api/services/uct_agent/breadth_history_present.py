"""The member-facing VIEW of a historical breadth search (breadth.history; present.js contract).

Built from Market Intelligence's `breadth_events` result (structured keys) and `answer()` (lead,
caveats, table). Every value is formatted by MI's own `breadth_answer.fmt_value` with the measure's
unit, so a history card reads exactly like a breadth.show card; nothing is recomputed here. MI's lead
sentence (which already states the date, value, condition and coverage) is kept as the details text.
⛔ MEMBER CHANNEL ONLY: this view goes to the browser and the member's saved transcript, never a model.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.market_intel import breadth_answer as _ba

_OP_WORDS = {"below": "below", "at_or_below": "at or below", "above": "above", "at_or_above": "at or above",
             "crosses_below": "crossed below", "crosses_above": "crossed above"}


def _fmt(req: dict, v) -> str:
    try:
        return _ba.fmt_value(req.get("unit"), req.get("domain"), float(v))
    except (TypeError, ValueError):
        return "—"


def _condition(req: dict) -> str:
    return f"{_OP_WORDS.get(req.get('op'), req.get('op'))} {_fmt(req, req.get('level'))}"


def _coverage_line(res: dict, answer: dict) -> str:
    """One short provenance line (cards show ≤ 160 characters); MI's full caveats stay in the details text."""
    cov = res.get("coverage") or {}
    n = cov.get("sessions_searched")
    gaps = int((res.get("gaps") or {}).get("count") or 0)
    line = (f"Finalized daily closes, {cov.get('searched_start')} – {cov.get('searched_end')}"
            + (f", {n:,} sessions" if isinstance(n, int) else "") + ".")
    if gaps:
        line += f" {gaps} missing session{'s' if gaps != 1 else ''} break{'' if gaps != 1 else 's'} stretches."
    return line


def _episode_items(req: dict, ep: dict, cov: dict) -> list[dict]:
    still = ep.get("ongoing") and cov.get("searched_end") == cov.get("last")
    lo, hi = ep.get("min"), ep.get("max")
    to_note = ("still running at the latest finalized session" if still
               else "runs to the end of the searched window" if ep.get("ongoing") else None)
    return [{"label": "From", "value": str(ep.get("start") or "—"),
             **({"note": "began before the searched window"} if ep.get("began_before_window") else {})},
            {"label": "To", "value": str(ep.get("end") or "—"), **({"note": to_note} if to_note else {})},
            {"label": "Sessions", "value": f"{int(ep.get('sessions') or 0):,}"},
            {"label": "Range", "value": f"{_fmt(req, lo)} – {_fmt(req, hi)}" if lo is not None and hi is not None else "—"}]


def view_of(result: Any, answer: dict) -> Optional[dict]:
    """A concise view of one search answer, or None (the browser then derives one from text + table)."""
    if not isinstance(answer, dict):
        return None
    res = result if isinstance(result, dict) else {}
    lead = str(answer.get("lead") or "").strip()
    if res.get("status") != "ok":
        return {"kind": "error", "text": lead or str(answer.get("text") or "That breadth search isn't available.")}
    req = res.get("request") or {}
    # MI's label already names the universe ("US · % of Stocks Above 200-Day MA"); never doubled
    uni = (req.get("universe") or "").upper()
    label = str(req.get("label") or req.get("metric") or "")
    title = label if label.upper().startswith(f"{uni} ") else f"{uni} · {label}"
    cond = _condition(req)
    source = _coverage_line(res, answer)
    find = req.get("find")
    cov = res.get("coverage") or {}
    counts = res.get("counts") or {}
    never = {"kind": "text", "text": lead or f"Never {cond} in the searched history.", "source": source}

    if find in ("last", "first"):
        ev = res.get("event")
        if not ev:
            return never
        ep = res.get("episode")
        note = f"Reading {_fmt(req, ev.get('value'))} that session."
        if ep:
            n = int(ep.get("sessions") or 0)
            note += f" {cond[0].upper() + cond[1:]} for {n:,} session{'s' if n != 1 else ''} ({ep.get('start')} – {ep.get('end')})."
        word = "Last" if find == "last" else "First"
        return {"kind": "value", "value": str(ev.get("date")), "label": f"{title} · {word} {cond}",
                "note": note, "source": source}

    if find == "count":
        if "events" in counts:
            items = [{"label": f"Times it {cond}", "value": f"{int(counts.get('events') or 0):,}"}]
        else:
            items = [{"label": f"Sessions {cond}", "value": f"{int(counts.get('sessions') or 0):,}"},
                     {"label": "Separate stretches", "value": f"{int(counts.get('episodes') or 0):,}"}]
        return {"kind": "metrics", "title": title, "items": items, "note": source}

    if find in ("longest", "last_episode"):
        ep = res.get("episode")
        if not ep:
            return never
        word = "Longest" if find == "longest" else "Most recent"
        return {"kind": "metrics", "title": f"{title} · {word} stretch {cond}",
                "items": _episode_items(req, ep, cov), "note": source}

    if find == "episodes":
        t = answer.get("table")
        if isinstance(t, dict) and t.get("columns") and t.get("rows"):
            return {"kind": "table", "table": t, **({"text": lead} if lead else {}), "source": source}
        return never
    return None
