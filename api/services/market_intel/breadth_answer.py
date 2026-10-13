"""Deterministic answers for UCT Agent breadth questions (Breadth Slice 1).

Turns a `breadth_reads.read()` result into `{status, text, table, provenance}` — the shape the Agent
panel already renders for a query (`text` bubble + `ResultTable` {columns, rows}). Every sentence is
built from the read result; no model writes any of it, so no number can be invented.

⛔ LOCAL ONLY (LOCAL-RESULT-BOUNDARY-CONTRACT.md). The text and table carry Massive-derived values and
are shown to the member only. The Agent's history replay must replace them with a placeholder before
anything reaches a model — that is the Agent side's job; this module just never calls one.

Every answer states: the universe, the ACTUAL session date(s) used (and when a requested date was
snapped to an earlier session), the units, that the data is finalized end-of-day, the history it
covers, and the source. Refusals and missing data are said plainly — never a guessed number.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services import breadth_metrics as _bm


def fmt_value(unit: Optional[str], domain: Optional[str], v: float) -> str:
    """Units are carried, never re-derived: % 0–100 to one decimal, counts as integers, ratios to 2dp."""
    if unit == _bm.UNIT_PERCENT:
        return f"{v:.1f}%"
    if unit == _bm.UNIT_COUNT:
        n = int(round(v))
        return f"{n:+,}" if domain == _bm.DOMAIN_SIGNED else f"{n:,}"
    if unit == _bm.UNIT_RATIO:
        return f"{v:.2f}"
    return f"{v:,.2f}"


def fmt_change(unit: Optional[str], d: float) -> str:
    if unit == _bm.UNIT_PERCENT:
        return f"{d:+.1f} pts"
    if unit == _bm.UNIT_COUNT:
        return f"{int(round(d)):+,}"
    return f"{d:+.2f}"


_REASON_TEXT = {
    "bad_request": "I couldn't read that breadth request.",
    "unsupported_universe": "Breadth answers here cover US, NYSE and Nasdaq stocks only.",
    "too_many_metrics": "Ask for up to four breadth measures at once.",
    "unknown_metric": "That breadth measure isn't available here.",
    "bad_date": "That isn't a usable date.",
    "universe_not_enabled": "That breadth universe isn't available right now.",
    "not_finalized": "I can't confirm which sessions are finalized right now, so I won't show a value that might be provisional.",
    "not_populated": "There is no finalized history for that universe yet.",
    "not_published": "That breadth measure isn't published for this universe.",
    "read_failed": "The breadth data couldn't be read right now.",
    "warming": "Breadth history is still loading. Ask again in a moment.",
    "before_history": "That date is before this breadth history begins.",
    "after_latest": "That date is after the latest finalized session.",
    "no_sessions": "No finalized sessions fall in that range.",
    "range_too_long": "That range is too long to summarise at once.",
}


def _why(r: dict) -> str:
    base = _REASON_TEXT.get(r.get("reason"), "That breadth answer isn't available.")
    detail = r.get("detail")
    return f"{base} {detail}" if detail and detail not in base else base


def _footer(res: dict) -> str:
    cov = res.get("coverage") or {}
    desc = res.get("universe_description") or ""
    return (f"Source: UCT Breadth — {res.get('universe_label')}. {desc} "
            f"Finalized end-of-day data, {cov.get('first')} through {cov.get('last')}.").strip()


def _snap_note(p: dict) -> str:
    if p.get("snapped"):
        return f" (you asked for {p['requested_date']}; that was not a finalized session, so this is the nearest earlier one)"
    return ""


def _value_lines(res: dict) -> tuple[list[str], list[dict]]:
    lines, rows = [], []
    for m in res["metrics"]:
        name = f"{res['universe_label']} · {m['label']}"
        if m.get("status") != "ok":
            lines.append(f"{name}: not available. {_why(m)}")
            rows.append({"metric": m["label"], "session": "—", "value": "—", "prior": "—"})
            continue
        val = fmt_value(m["unit"], m["domain"], m["value"])
        prior = ""
        if m.get("prior_session") is not None:
            prior = (f" Prior session {m['prior_session']}: "
                     f"{fmt_value(m['unit'], m['domain'], m['prior_value'])}.")
        lines.append(f"{name}: {val} on {m['as_of']}{_snap_note(m)}.{prior}")
        rows.append({"metric": m["label"], "session": m["as_of"], "value": val,
                     "prior": (f"{fmt_value(m['unit'], m['domain'], m['prior_value'])} ({m['prior_session']})"
                               if m.get("prior_session") else "—")})
    cols = [{"key": "metric", "label": "Measure"}, {"key": "session", "label": "Session"},
            {"key": "value", "label": "Value"}, {"key": "prior", "label": "Prior session"}]
    return lines, [{"columns": cols, "rows": rows}]


def _compare_lines(res: dict) -> tuple[list[str], list[dict]]:
    lines, rows = [], []
    for m in res["metrics"]:
        name = f"{res['universe_label']} · {m['label']}"
        if m.get("status") != "ok":
            lines.append(f"{name}: not available. {_why(m)}")
            rows.append({"metric": m["label"], "a": "—", "b": "—", "change": "—"})
            continue
        a, b = m["current"], m["other"]
        va, vb = fmt_value(m["unit"], m["domain"], a["value"]), fmt_value(m["unit"], m["domain"], b["value"])
        lines.append(f"{name}: {va} on {a['as_of']}{_snap_note(a)} versus {vb} on {b['as_of']}{_snap_note(b)}; "
                     f"change {fmt_change(m['unit'], m['change'])}.")
        rows.append({"metric": m["label"], "a": f"{va} ({a['as_of']})", "b": f"{vb} ({b['as_of']})",
                     "change": fmt_change(m["unit"], m["change"])})
    cols = [{"key": "metric", "label": "Measure"}, {"key": "a", "label": "Session A"},
            {"key": "b", "label": "Session B"}, {"key": "change", "label": "Change (A − B)"}]
    return lines, [{"columns": cols, "rows": rows}]


def _series_lines(res: dict) -> tuple[list[str], list[dict]]:
    lines, rows = [], []
    for m in res["metrics"]:
        name = f"{res['universe_label']} · {m['label']}"
        if m.get("status") != "ok":
            lines.append(f"{name}: not available. {_why(m)}")
            rows.append({"metric": m["label"], "range": "—", "first": "—", "last": "—", "low": "—", "high": "—"})
            continue
        f = lambda v: fmt_value(m["unit"], m["domain"], v)  # noqa: E731
        clip = ""
        if m.get("clipped_start") or m.get("clipped_end"):
            clip = f" (finalized sessions in your range run {m['start']} to {m['end']})"
        lines.append(
            f"{name}, {m['start']} to {m['end']} ({m['sessions']} sessions){clip}: "
            f"from {f(m['first']['value'])} to {f(m['last']['value'])} (change {fmt_change(m['unit'], m['change'])}); "
            f"low {f(m['min']['value'])} on {m['min']['date']}, high {f(m['max']['value'])} on {m['max']['date']}; "
            f"average {f(m['mean'])}.")
        rows.append({"metric": m["label"], "range": f"{m['start']} – {m['end']}",
                     "first": f(m["first"]["value"]), "last": f(m["last"]["value"]),
                     "low": f"{f(m['min']['value'])} ({m['min']['date']})",
                     "high": f"{f(m['max']['value'])} ({m['max']['date']})"})
    cols = [{"key": "metric", "label": "Measure"}, {"key": "range", "label": "Sessions"},
            {"key": "first", "label": "First"}, {"key": "last", "label": "Last"},
            {"key": "low", "label": "Low"}, {"key": "high", "label": "High"}]
    return lines, [{"columns": cols, "rows": rows}]


def answer(res: Any) -> dict:
    """`{status, text, table, provenance}` for one read result. Deterministic; never raises."""
    if not isinstance(res, dict) or res.get("status") not in ("ok", "partial") or not res.get("metrics"):
        r = res if isinstance(res, dict) else {}
        text = _why(r)
        if not r.get("reason") and r.get("metrics"):
            # every metric refused individually: say each metric's own reason (e.g. "after the latest
            # finalized session … is 2026-10-09"), never the generic line (Agent review 2026-10-12)
            label = r.get("universe_label") or ""
            text = "\n".join(dict.fromkeys(f"{label} · {m.get('label')}: {_why(m)}".lstrip(" ·")
                                           for m in r["metrics"] if isinstance(m, dict)))
        return {"status": r.get("status") or "unavailable", "text": text, "table": None, "provenance": None}
    mode = (res.get("request") or {}).get("mode")
    builder = {"value": _value_lines, "compare": _compare_lines, "series": _series_lines}.get(mode, _value_lines)
    lines, tables = builder(res)
    if res["status"] == "partial":
        lines.append("Some of what you asked for isn't available; those measures are marked above.")
    lines.append(_footer(res))
    return {"status": res["status"], "text": "\n".join(lines), "table": tables[0],
            "provenance": {**(res.get("provenance") or {}), "coverage": res.get("coverage"),
                           "basis": res.get("basis")}}
