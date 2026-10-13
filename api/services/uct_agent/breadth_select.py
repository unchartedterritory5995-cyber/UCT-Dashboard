"""ONE breadth reading-selection policy for the Agent (owner 2026-10-13; D5 amended the same day).

Every breadth request resolves to sessions, each from exactly ONE source and carrying its status:

  now           a value, no date, no close   → the current reading (breadth_now.overlay: live intraday,
                                               else the newest completed session, said as not current)
  latest close  a value, basis "close"       → the newest COMPLETED session: a provisional close when one
                                               is newer than the finalized watermark, else the finalized
  a session     a value, date D              → D's finalized close when D is finalized; else D's completed
                                               provisional close; a non-trading D → the session in effect
                                               on it (labelled); a trading D not completed → refused (never
                                               another date)
  last N        mode "rows", sessions N      → the last N sessions: finalized rows, then any completed
                                               provisional sessions after them — each with its status
  compare / series                           → Market Intelligence's finalized summaries (unchanged)
  threshold searches (breadth.history)       → finalized only, a separate capability

Sources — nothing is computed here: finalized = Market Intelligence (`breadth_reads`, the D5 sealed
series); completed provisional = Breadth's `breadth_current.completed_sessions` (the rows the charts
draw, after the finalized watermark, with the shared completed-session rule: never an in-progress
reading, never for NH/NL or any finalized-only measure). A provisional close always says so; once the
session finalizes it leaves `completed_sessions` and the finalized close is used — preferred by design.
"% at or below" is the complement of the SELECTED observation (breadth_present.BELOW_WORDS).

⛔ MEMBER CHANNEL ONLY: values here go to the browser, never to a model (turn.LOCAL_ONLY_ACTIONS).
"""
from __future__ import annotations

import logging
import math
from datetime import date as _date, timedelta as _td
from typing import Any, Optional

from api.services.market_intel import breadth_answer as _ba

log = logging.getLogger(__name__)

#: "last N sessions" — at most this many rows in one answer (a chart is the way to see more)
MAX_ROWS = 250
#: said once beside every provisional close (the label itself says "Provisional close · Oct 12")
NOT_FINALIZED = "Not finalized yet — the finalized close replaces it once this session finalizes."


def when_of(req: Any) -> str:
    """now | latest_close | session | rows | compare | series | other."""
    if not isinstance(req, dict):
        return "other"
    mode = req.get("mode")
    if mode == "rows":
        return "rows"
    if mode != "value":
        return str(mode or "other")
    if req.get("date"):
        return "session"
    return "latest_close" if req.get("basis") == "close" else "now"


def _below(v: float) -> float:
    return round(100.0 - float(v), 1)


def completed(universe: str, metric: str, below: bool = False) -> list[dict]:
    """Breadth's completed provisional sessions (newest first), validated; [] when none / unavailable."""
    try:
        from api.services import breadth_current as _bc
        out = _bc.completed_sessions(universe, metric)
    except Exception:  # noqa: BLE001 -- the accessor absent / failing: finalized only, as before
        return []
    if not isinstance(out, dict) or not out.get("ok"):
        return []
    good: list[dict] = []
    for s in out.get("sessions") or []:
        if not isinstance(s, dict) or s.get("status") != "provisional":
            continue
        v, session, label = s.get("value"), s.get("session"), s.get("label")
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(float(v)):
            continue
        if not isinstance(label, str) or not label.strip() or not isinstance(session, str):
            continue
        try:
            _date.fromisoformat(session)
        except ValueError:
            continue
        good.append({"session": session, "value": _below(v) if below else float(v), "label": label.strip()})
    good.sort(key=lambda c: c["session"], reverse=True)
    return good


def _prev_trading_day(d: _date) -> Optional[_date]:
    from api.services import session_calendar as _sc
    for _ in range(12):
        d -= _td(days=1)
        if _sc.is_trading_day(d):
            return d
    return None


def pick(m: dict, req: dict, comps: list[dict]) -> Optional[dict]:
    """The completed provisional observation the policy prefers for one MI metric result, or None
    (None = MI's finalized answer — or its refusal — stands)."""
    when = when_of(req)
    if when == "latest_close":
        fin = m.get("as_of") if m.get("status") == "ok" else None
        newest = comps[0] if comps else None
        return dict(newest) if newest and (not fin or newest["session"] > fin) else None
    if when != "session":
        return None
    if m.get("status") == "ok" or m.get("reason") != "after_latest":
        return None                     # finalized exists (preferred) — or a refusal no completed close can fix
    want = str(req.get("date") or "")
    hit = next((c for c in comps if c["session"] == want), None)
    if hit:
        return dict(hit)
    try:
        d = _date.fromisoformat(want)
        from api.services import session_calendar as _sc
        if _sc.is_trading_day(d):
            return None                 # that session is not completed yet: refused, never another date
        p = _prev_trading_day(d)
    except Exception:  # noqa: BLE001
        return None
    hit = next((c for c in comps if p and c["session"] == p.isoformat()), None)
    return {**hit, "snapped_from": want} if hit else None


def _meta(metric: str) -> dict:
    from api.services import breadth_metrics as _bm
    m = _bm.get(metric) or {}
    return {"metric": metric, "label": m.get("name") or metric, "code": m.get("code"),
            "unit": m.get("unit"), "domain": m.get("domain")}


def close_overlay(req: dict, res: dict, answer: dict, view: Optional[dict], below: bool = False) -> tuple[str, str, Optional[dict], dict]:
    """(status, text, view, kinds) for a latest-close or dated value request: MI's finalized answer, with
    each measure replaced by its completed provisional close where the policy prefers one. Nothing
    preferred → MI's answer (or refusal) exactly as it was."""
    status, text = str(answer.get("status") or res.get("status") or ""), str(answer.get("text") or "")
    when = when_of(req)
    if when not in ("latest_close", "session") or not isinstance(res, dict) or not isinstance(res.get("metrics"), list):
        return status, text, view, {}
    universe = res.get("universe") or (res.get("request") or {}).get("universe") or req.get("universe")
    uni = res.get("universe_label") or str(universe or "").upper()
    picks: dict[str, dict] = {}
    for m in res["metrics"]:
        if not isinstance(m, dict) or not m.get("metric"):
            continue
        p = pick(m, req, completed(universe, m["metric"], below=below))
        if p:
            picks[m["metric"]] = p
    kinds = {k: "provisional_close" for k in picks}
    log.info("[uct-agent] breadth close selection when=%s provisional=%d of %d", when, len(picks), len(res["metrics"]))
    if not picks:
        return status, text, view, kinds

    rows = []                           # (label, value text, note) per measure, in MI's order
    for m in res["metrics"]:
        if not isinstance(m, dict):
            continue
        label = m.get("label") or _meta(m.get("metric") or "")["label"]
        p = picks.get(m.get("metric"))
        if p:
            meta = {**_meta(m["metric"]), **{k: m[k] for k in ("unit", "domain") if m.get(k)}}
            note = p["label"] + (f" (the session in effect on {p['snapped_from']})" if p.get("snapped_from") else "")
            rows.append((label, _ba.fmt_value(meta.get("unit"), meta.get("domain"), p["value"]), note))
        elif m.get("status") == "ok":
            rows.append((label, _ba.fmt_value(m.get("unit"), m.get("domain"), m["value"]),
                         f"Finalized close · {_day(m.get('as_of'))}"))
        else:
            rows.append((label, "—", "not available"))
    lines = [f"{uni} breadth — completed session:" if uni else "Breadth — completed session:"]
    lines += [f"{lab}: {val} — {note}" for lab, val, note in rows]
    lines += [NOT_FINALIZED, "", "Latest finalized data (for history and finalized questions):", text]
    new_text = "\n".join(lines).strip()
    if len(rows) == 1:
        lab, val, note = rows[0]
        new_view = {"kind": "value", "value": val, "label": f"{uni} · {lab}", "note": f"{note}. {NOT_FINALIZED}"}
    else:
        new_view = {"kind": "metrics", "title": (view or {}).get("title") or uni,
                    "items": [{"label": lab, "value": val, "note": note} for lab, val, note in rows], "note": NOT_FINALIZED}
    any_ok = any(v != "—" for _, v, _ in rows)
    all_ok = all(v != "—" for _, v, _ in rows)
    return ("ok" if all_ok else "partial" if any_ok else status), new_text, new_view, kinds


def _day(iso: Any) -> str:
    try:
        d = _date.fromisoformat(str(iso))
        return f"{d:%b} {d.day}"
    except (TypeError, ValueError):
        return str(iso or "")


def rows(req: Any, below: bool = False) -> dict:
    """The last N sessions of ONE measure: finalized rows (Market Intelligence's sealed series), then any
    completed provisional sessions after them (Breadth), newest first — each with its status. Never
    computes a value; "% at or below" complements each row's own value."""
    from api.services.market_intel import breadth_reads as _br
    bad = lambda why: {"status": "refused", "text": why, "table": None, "present": {"kind": "error", "text": why}}  # noqa: E731
    if not isinstance(req, dict):
        return bad("The breadth request was not understood.")
    mets = req.get("metrics")
    if not isinstance(mets, list) or len(mets) != 1 or not isinstance(mets[0], str):
        return bad("Ask for the recent sessions of one breadth measure at a time.")
    n = req.get("sessions")
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return bad(f"Ask for between 1 and {MAX_ROWS} recent sessions.")
    universe, metric = str(req.get("universe") or "").strip().lower(), mets[0]
    r = _br.sealed_series(universe, metric)
    if not isinstance(r, dict) or r.get("status") != "ok":
        why = str((r or {}).get("detail") or "That breadth series isn't available right now.")
        return {"status": (r or {}).get("status") or "unavailable", "text": why, "table": None, "present": {"kind": "error", "text": why}}
    meta = _meta(metric)
    fin = [(d, (_below(v) if below else float(v)), "Finalized") for d, v in r.get("rows") or []]
    last_fin = fin[-1][0] if fin else ""
    prov = [(c["session"], c["value"], "Provisional close") for c in reversed(completed(universe, metric, below=below))
            if c["session"] > last_fin]
    series = (fin + prov)[-n:]
    if not series:
        why = "No sessions are available for that measure."
        return {"status": "unavailable", "text": why, "table": None, "present": {"kind": "error", "text": why}}
    uni = _universe_label(universe)
    label = meta["label"].replace("Above", "At or Below") if below else meta["label"]
    fmt = lambda v: _ba.fmt_value(meta["unit"], meta["domain"], v)  # noqa: E731
    newest_first = list(reversed(series))
    table = {"columns": [{"key": "session", "label": "Session"}, {"key": "value", "label": "Value"},
                         {"key": "status", "label": "Status"}],
             "rows": [{"session": d, "value": fmt(v), "status": s} for d, v, s in newest_first]}
    k = len(series)
    head = f"{uni} · {label} — last {k} session{'s' if k != 1 else ''} ({series[0][0]} – {series[-1][0]})"
    notes = []
    if k < n:
        notes.append(f"Only {k} session{'s are' if k != 1 else ' is'} available.")
    if prov and any(s == "Provisional close" for _, _, s in series):
        notes.append("Provisional closes are completed sessions that are not finalized yet.")
    text = "\n".join([head, *[f"{d}: {fmt(v)} ({s.lower()})" for d, v, s in newest_first], *notes])
    log.info("[uct-agent] breadth rows sessions=%d provisional=%d", k, sum(1 for _, _, s in series if s != "Finalized"))
    present = {"kind": "table", "text": " ".join([head, *notes]), "table": table}
    return {"status": "ok", "text": text, "table": table, "present": present}


def _universe_label(universe: str) -> str:
    try:
        from api.services import breadth_universes as _bu
        return _bu.label(universe)
    except Exception:  # noqa: BLE001
        return universe.upper()


#: (2026-10-13 audit) a breadth.history condition that holds on (virtually) every session is not a
#: search — "history above 0%" was what a model invented for "show me the last 30 days".
def trivial_condition(req: Any) -> Optional[str]:
    """A refusal sentence for an always-true percent condition, or None."""
    if not isinstance(req, dict):
        return None
    try:
        from api.services import breadth_metrics as _bm
        dom = (_bm.get(req.get("metric")) or {}).get("domain")
        pct = dom == _bm.DOMAIN_PCT
    except Exception:  # noqa: BLE001
        return None
    op, level = req.get("op"), req.get("level")
    if not pct or not isinstance(level, (int, float)) or isinstance(level, bool):
        return None
    # (a level outside 0–100 keeps Market Intelligence's own, more specific "not a possible value" refusal)
    if (op in ("above", "at_or_above") and level == 0) or (op in ("below", "at_or_below") and level == 100):
        return ("That condition holds on virtually every session, so it isn't a meaningful search. "
                "To see the readings themselves, ask for the last N sessions (for example, the last 30).")
    return None
