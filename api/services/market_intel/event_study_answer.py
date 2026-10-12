"""Deterministic member-facing text + table for an `event_study.run()` result.

Every sentence is built from the result; no model writes any of it. ⛔ LOCAL ONLY — the text carries
licensed breadth and price values and is shown to the member only.
"""
from __future__ import annotations

from typing import Any

from api.services.market_intel.breadth_answer import fmt_value

_OP_TEXT = {"below": "below", "above": "above", "cross_below": "crossed below", "cross_above": "crossed above"}

_REASON_TEXT = {
    "bad_request": "I couldn't read that study request.",
    "unsupported_universe": "Breadth studies cover US, NYSE and Nasdaq only.",
    "unknown_series": "That data series isn't available for studies.",
    "unknown_indicator": "That technical indicator isn't available for studies.",
    "bad_period": "That indicator period isn't valid.",
    "not_enough_history": "There isn't enough stored history for that study.",
    "unknown_metric": "That breadth measure isn't available for studies.",
    "bad_condition": "The condition must be below, above, crossing below or crossing above a threshold.",
    "bad_threshold": "That threshold isn't a possible value for this measure.",
    "bad_symbol": "That isn't a valid ticker symbol.",
    "bad_horizons": "The forward windows weren't valid.",
    "bad_date": "Those study dates weren't usable.",
    "no_price_history": "UCT has no stored daily history for that symbol.",
    "no_overlap": "The price history and the breadth history don't overlap in that window.",
    "warming": "The history is still loading. Run the study again in a moment.",
    "failed": "The study couldn't be computed.",
}


def _fmt_threshold(unit, domain, v: float) -> str:
    if unit == "percent_change":
        return f"{v:+.1f}%"
    if unit == "index":
        return f"{v:g}"
    return fmt_value(unit, domain, v)


def _episode_text(q: dict) -> str:
    if q["condition"]["op"].startswith("cross_"):
        return "each crossing"
    return "first session of each run" if q["episodes"] == "first" else "every qualifying session"


def pct(r: float) -> str:
    return f"{r * 100:+.2f}%"


def _why(res: dict) -> str:
    base = _REASON_TEXT.get(res.get("reason"), "That study isn't available.")
    d = res.get("detail")
    return f"{base} {d}" if d and d not in base else base


def answer(res: Any) -> dict:
    """`{status, text, table}` — deterministic; never raises."""
    if not isinstance(res, dict) or res.get("status") != "ok":
        r = res if isinstance(res, dict) else {}
        return {"status": r.get("status") or "unavailable", "text": _why(r), "table": None}
    q, cov, c = res["request"], res["coverage"], res["counts"]
    thr = _fmt_threshold(res["series_unit"], res["series_domain"], q["condition"]["threshold"])
    head = (f"{res['series_label']} {_OP_TEXT[q['condition']['op']]} {thr}: "
            f"{c['events_used']} event{'s' if c['events_used'] != 1 else ''} between {cov['study_start']} and "
            f"{cov['study_end']} ({_episode_text(q)}"
            f"{', non-overlapping' if q['non_overlapping'] else ''}). Forward {q['symbol']} price returns from the "
            f"{'event-day close' if q['entry'] == 'event_close' else 'next session’s close'}:")
    lines, rows = [head], []
    base = {repr(b["horizon"]): b for b in (res.get("baseline") or [])}
    for h in res["horizons"]:
        b = base.get(repr(h["horizon"]))
        if not h.get("n"):
            lines.append(f"• {h['label']}: no completed outcomes"
                         f" ({h['incomplete']} still open, {h['missing_price']} without a stored close).")
            rows.append({"window": h["label"], "n": "0", "up": "—", "mean": "—", "median": "—",
                         "best": "—", "worst": "—", "baseline": "—"})
            continue
        bl = (f"; all sessions: up {b['positive_rate'] * 100:.0f}% of {b['n']}, median {pct(b['median'])}"
              if b and b.get("n") else "")
        lines.append(
            f"• {h['label']}: up {h['positive']} of {h['n']} ({h['positive_rate'] * 100:.0f}%), "
            f"average {pct(h['mean'])}, median {pct(h['median'])}, best {pct(h['best']['return'])} "
            f"(from {h['best']['event_date']}), worst {pct(h['worst']['return'])} (from {h['worst']['event_date']})"
            f"{bl}." + (f" {h['incomplete']} still open." if h["incomplete"] else "")
            + (f" {h['missing_price']} without a stored close." if h["missing_price"] else ""))
        rows.append({"window": h["label"], "n": str(h["n"]), "up": f"{h['positive_rate'] * 100:.0f}%",
                     "mean": pct(h["mean"]), "median": pct(h["median"]),
                     "best": f"{pct(h['best']['return'])} ({h['best']['event_date']})",
                     "worst": f"{pct(h['worst']['return'])} ({h['worst']['event_date']})",
                     "baseline": (f"{b['positive_rate'] * 100:.0f}% up, median {pct(b['median'])}"
                                  if b and b.get("n") else "—")})
    for n in res.get("notes") or []:
        lines.append(n)
    basis = f", {cov['series_basis']}" if cov.get("series_basis") else ""
    lines.append(f"Condition series: {res['series_label']} ({res['series_category']}{basis}), "
                 f"{cov['series_first']} to {cov['series_last']}. Prices: {q['symbol']} {cov['price_basis']}, stored "
                 f"{cov['price_first']} to {cov['price_last']}. Past results do not predict future returns.")
    cols = [{"key": "window", "label": "Window"}, {"key": "n", "label": "Events"}, {"key": "up", "label": "Up"},
            {"key": "mean", "label": "Average"}, {"key": "median", "label": "Median"},
            {"key": "best", "label": "Best"}, {"key": "worst", "label": "Worst"},
            {"key": "baseline", "label": "All sessions"}]
    return {"status": "ok", "text": "\n".join(lines), "table": {"columns": cols, "rows": rows}}
