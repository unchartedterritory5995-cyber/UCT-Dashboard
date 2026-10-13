"""PRESENT-TENSE breadth for the UCT Agent: the latest eligible INTRADAY / provisional reading
(owner decision 2026-10-12), chosen by the Breadth team's contract — never a second data source.

    "What's breadth right now?" / "What % of stocks are above their 50-day?" / "How's breadth today?"
        → breadth_current.reading(universe, metric) per measure (docs/breadth/current-reading-contract.md)
    a date, an explicit close ("at Friday's close"), a comparison or a range
        → Market Intelligence's FINALIZED read, unchanged (D5)

Rules (from the contract; this module only APPLIES them):
  · a reading is shown as current only when `current` is True — its `label` ("Intraday · 11:52 AM ET",
    "Provisional close · Oct 9") is the disclosure, per measure;
  · `finalized_only` measures (the new-high / new-low family) always show their FINALIZED close, labelled
    as such — an overview never implies every measure shares one time or status;
  · `approximate` counts say so;
  · not current (stale / unavailable / feed off): the finalized close is shown as clearly dated context,
    and the member is told a live reading isn't available — `stale_reason` is for logs only;
  · values are formatted by MI's `fmt_value` with the measure's own unit — never recomputed.

⛔ ISOLATION: the same as every breadth answer — this runs only inside the browser-only, admin-only
/api/agent/breadth route; its result goes to the member's transcript as a LOCAL row (turn.LOCAL_ONLY_ACTIONS),
never into a model request, plan, replayed history or chat naming. Nothing here is logged but statuses.

⛔ DEFAULT OFF (owner 2026-10-12): only an explicit, approved enablement turns this on —
AGENT_BREADTH_CURRENT=1 (also true / on / yes, any case). Missing, empty or anything else = OFF, and
present-tense answers are the finalized close exactly as before this feature. When ON but the Breadth
dependency or its feed is unavailable, the member is told there is no current reading; a finalized
close is shown only as dated historical context.
"""
from __future__ import annotations

import logging
import os
from datetime import date as _date
from typing import Any, Callable, Optional

from api.services.market_intel import breadth_answer as _ba

log = logging.getLogger(__name__)

LIVE_STATUSES = ("intraday", "provisional")
UNAVAILABLE = "No current breadth reading is available right now — this is the latest finalized close, shown as historical context."


ON_VALUES = ("1", "true", "on", "yes")


def enabled() -> bool:
    """Explicit opt-in only: AGENT_BREADTH_CURRENT ∈ ON_VALUES (case-insensitive). Default OFF."""
    return os.environ.get("AGENT_BREADTH_CURRENT", "").strip().lower() in ON_VALUES


def wants_current(req: Any) -> bool:
    """A present-tense VALUE request: no date named and not an explicit closing question."""
    return (isinstance(req, dict) and req.get("mode") == "value" and not req.get("date")
            and req.get("basis") != "close")


def _reader() -> Optional[Callable[[str, str], dict]]:
    try:
        from api.services import breadth_current
        return breadth_current.reading
    except Exception:  # noqa: BLE001 -- the dependency absent: finalized answers, said honestly
        log.warning("[uct-agent] breadth_current unavailable; present-tense breadth falls back to finalized")
        return None


def _day(iso: Optional[str]) -> str:
    try:
        d = _date.fromisoformat(str(iso))
        return f"{d:%b} {d.day}"
    except (TypeError, ValueError):
        return str(iso or "")


def _choice(m: dict, r: Any) -> dict:
    """One measure: {value, note, live, kind} — `kind` is live / finalized_only / fallback."""
    fin = {"value": _ba.fmt_value(m.get("unit"), m.get("domain"), m["value"]),
           "note": f"Finalized close · {_day(m.get('as_of'))}", "live": False}
    r = r if isinstance(r, dict) else {}
    tier = r.get("accuracy_tier")
    if tier == "finalized_only":
        # Two different truths (2026-10-12 owner review): a measure with NO live reading at all, and one
        # whose live/provisional reading exists (the chart may draw it) but is NOT YET VALIDATED for the
        # Agent (the NH/NL family until Breadth's grade passes). Never "finalized only" for the second.
        unvalidated = _unvalidated(m.get("metric"))
        return {**fin, "kind": "finalized_only", "unvalidated": unvalidated,
                "note": f"{fin['note']} ({'today’s reading not yet validated' if unvalidated else 'finalized only'})"}
    v = r.get("value")
    if (r.get("ok") and r.get("current") is True and r.get("status") in LIVE_STATUSES
            and isinstance(v, (int, float)) and r.get("label")
            and str(r.get("session") or "") >= str(m.get("as_of") or "")):
        note = str(r["label"]) + (" · approximate count" if tier == "approximate" else "")
        return {"value": _ba.fmt_value(m.get("unit"), m.get("domain"), float(v)), "note": note,
                "live": True, "kind": "live", "status": r["status"]}
    # current but FINALIZED (e.g. the expected session already finalized): the same canonical close
    if r.get("ok") and r.get("current") is True and r.get("status") == "finalized" and r.get("session") == m.get("as_of"):
        return {**fin, "kind": "current_finalized"}
    return {**fin, "kind": "fallback"}


def overlay(res: dict, answer: dict, view: Optional[dict], reading: Optional[Callable] = None) -> tuple[str, Optional[dict], dict]:
    """(text, view, statuses) for a present-tense value request. `res` / `answer` are MI's FINALIZED
    read (kept as dated context under Details); each measure is replaced by its current reading when the
    contract says it is current. `statuses` = {metric: kind} for logs (no values)."""
    reading = reading or _reader()
    mets = [m for m in res.get("metrics") or [] if isinstance(m, dict)]
    ok = [m for m in mets if m.get("status") == "ok"]
    if not ok:
        return answer.get("text") or "", view, {}
    if not reading:
        reading = _no_reading                    # the dependency is absent: every measure is "no current reading"
    uni_key = res.get("universe") or (res.get("request") or {}).get("universe")
    uni = res.get("universe_label") or ""
    picks = {}
    for m in ok:
        try:
            r = reading(uni_key, m["metric"])
        except Exception:  # noqa: BLE001 -- the contract says never raises; a fault is "unavailable"
            r = None
        picks[m["metric"]] = _choice(m, r)
    statuses = {k: (p["kind"], p.get("status")) for k, p in picks.items()}
    log.info("[uct-agent] breadth present-tense kinds=%s", sorted({p["kind"] for p in picks.values()}))
    if all(p["kind"] == "fallback" for p in picks.values()):
        # nothing current: the finalized answer as before (dated), with the reason said once
        if view and view.get("kind") in ("value", "metrics"):
            from api.services.uct_agent.breadth_present import _join
            view = {**view, "note": _join(view.get("note"), UNAVAILABLE)}
        return answer.get("text") or "", view, statuses

    missing = [m for m in mets if m.get("status") != "ok"]
    fallback = any(p["kind"] == "fallback" for p in picks.values())
    lines = [f"{uni} breadth now:" if uni else "Breadth now:"]
    lines += [f"{m['label']}: {picks[m['metric']]['value']} — {picks[m['metric']]['note']}" for m in ok]
    if fallback:
        lines.append("Measures marked “Finalized close” have no current live reading right now.")
    lines += ["", "Latest finalized close (for history and closing questions):", str(answer.get("text") or "")]
    text = "\n".join(lines).strip()

    if len(ok) == 1 and not missing:
        m, p = ok[0], picks[ok[0]["metric"]]
        new = {"kind": "value", "value": p["value"], "label": f"{uni} · {m['label']}", "note": p["note"]}
        if p["kind"] == "finalized_only":
            new["note"] = (f"{fin_note(p)}. Today’s reading of this measure isn’t validated for UCT Agent yet, so this is the latest finalized close."
                           if p.get("unvalidated") else f"{fin_note(p)}. This measure has no live reading; this is the latest finalized close.")
        return text, new, statuses
    notes = {p["note"] for p in picks.values()}
    new = {"kind": "metrics", "title": (view or {}).get("title") or uni,
           "items": [{"label": m["label"], "value": picks[m["metric"]]["value"], "note": picks[m["metric"]]["note"]} for m in ok]
                    + [{"label": m.get("label") or m.get("metric"), "value": "—", "note": "not available"} for m in missing]}
    parts = []
    if len(notes) > 1:
        parts.append("Each measure shows its own time and status.")
    if fallback:
        parts.append("A live reading isn't available right now for the measures marked “Finalized close”.")
    if parts:
        new["note"] = " ".join(parts)
    return text, new, statuses


def _unvalidated(metric) -> bool:
    """Is this a measure whose current reading exists but is not yet validated for the Agent?"""
    try:
        from api.services import breadth_current
        return metric in breadth_current.UNVALIDATED_LIVE
    except Exception:  # noqa: BLE001
        return False


def fin_note(p: dict) -> str:
    """The card's dated finalized label without its parenthetical ("Finalized close · Oct 9")."""
    return str(p.get("note") or "").split(" (", 1)[0]


def _no_reading(_universe: str, _metric: str) -> dict:
    return {"ok": False, "current": False, "stale_reason": "breadth_current unavailable"}
