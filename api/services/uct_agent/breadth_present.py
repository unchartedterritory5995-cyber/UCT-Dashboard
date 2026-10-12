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

from typing import Any, Optional

from api.services.market_intel import breadth_answer as _ba


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

    if mode == "value":
        if len(ok) == 1 and not missing:
            m = ok[0]
            return {"kind": "value", "value": _v(m, m["value"]), "label": f"{uni} · {m['label']}",
                    "note": f"As of {_when(m)} close"}
        dates = {m.get("as_of") for m in ok}
        return {"kind": "metrics", "title": uni,
                "items": [{"label": m["label"], "value": _v(m, m["value"]),
                           **({} if len(dates) == 1 else {"note": _when(m)})} for m in ok]
                         + [{"label": m.get("label") or m.get("metric"), "value": "—", "note": "not available"} for m in missing],
                "note": " ".join(x for x in [f"As of {next(iter(dates))} close" if len(dates) == 1 else None, gap] if x)}

    if mode == "compare":
        if len(ok) == 1 and not missing:
            m = ok[0]
            a, b = m["current"], m["other"]
            latest = (res.get("request") or {}).get("date") is None
            return {"kind": "comparison", "title": f"{uni} · {m['label']}",
                    "items": [{"label": "Latest" if latest else "Then", "value": _v(m, a["value"]), "note": _when(a)},
                              {"label": "Earlier" if latest else "Compared with", "value": _v(m, b["value"]), "note": _when(b)},
                              {"label": "Change", "value": _ba.fmt_change(m.get("unit"), m["change"])}]}
        return {"kind": "metrics", "title": f"{uni} · compared",
                "items": [{"label": m["label"], "value": f"{_v(m, m['current']['value'])} vs {_v(m, m['other']['value'])}",
                           "note": f"{_ba.fmt_change(m.get('unit'), m['change'])} · {m['current']['as_of']} vs {m['other']['as_of']}"}
                          for m in ok], **({"note": gap} if gap else {})}

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
                    "note": f"{m['sessions']} finalized sessions, {m['start']} – {m['end']}"}
        return {"kind": "metrics", "title": f"{uni} · {ok[0]['start']} – {ok[0]['end']}",
                "items": [{"label": m["label"], "value": f"{_v(m, m['first']['value'])} → {_v(m, m['last']['value'])}",
                           "note": _ba.fmt_change(m.get("unit"), m["change"])} for m in ok], **({"note": gap} if gap else {})}
    return None
