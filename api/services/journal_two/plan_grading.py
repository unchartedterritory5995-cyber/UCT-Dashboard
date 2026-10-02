"""Wave 13 lane 13A -- plan vs execution grading.

Every closed equity trade gets four checks against the plan the member wrote BEFORE it:
Entry, Stop, Size, Target. A trade with no prior plan is labelled Unplanned -- flagged, never
hidden. A discipline record covers the last 20 and 60 trades.

WHERE THE PLAN COMES FROM. `plan_extract.py` is the one reader of plan levels. This file only
decides WHICH source is the plan for a trade, freezes it, and grades.

MATCHING (same member, same symbol). Candidates, in order -- the first tier that has one wins:
  1. ``explicit`` -- a note the member linked to this trade (`note_trade_links.notes_linked_to_
     trade`, including a thesis note linked to the position that closed into it);
  2. ``verdict``  -- a Compass pre-trade verdict: the one the trade was entered against
     (`context_at_entry.compass_verdict_id`), else the latest verdict for the symbol within
     `MATCH_WINDOW_DAYS` before entry;
  3. ``window``   -- a note on the ticker whose content at entry was written within
     `MATCH_WINDOW_DAYS` before entry and names an entry or a stop.
Two candidates in the winning tier is a TIE: the member picks (status ``needs_pick``). None is
``unplanned``. A date-only entry (no time of day) is judged by its ET day and labelled so.

FREEZE (ruling R4). At the first match the numbers, the source, the note version read and the
time are stored in `j2_trade_plan_links` with INSERT OR IGNORE, so a second matcher can never
overwrite the first. A note is read AS IT STOOD AT ENTRY: its current row when it has not
changed since, else its latest version (`j2_note_versions`) from before entry. A plan whose only
readable version post-dates entry is graded and labelled "plan edited after entry". Only a Re-link
by the member replaces a frozen plan, and the replaced row is kept (R-11). Editing the note later
changes nothing.

KEYS. `trade_ref` (ext:<external_id> / id:<row id>, `trade_refs.py`), never `j2_trades.id`: a
broker purge reissues ids and a grade keyed on the id would silently fall off its trade.

MIRROR. Nothing here writes, filters or alters a trade. Every trade the broker sent is listed and
counted; an unplanned one is labelled. The one trade write in this feature is the member's own
setup-chip click, through the existing `PATCH /api/j2/trades/{id}`.

DETERMINISTIC. Every number below is arithmetic on stored values: no model call, no clock in a
grade (the clock is read only to stamp `matched_at`).
"""
from __future__ import annotations

import json
import math
import sqlite3
from datetime import date, datetime, time, timedelta, timezone
from types import MappingProxyType
from typing import Any
from zoneinfo import ZoneInfo

from api.services.journal_two import plan_extract
from api.services.journal_two.trade_refs import trade_ref_for_row
from api.services.notebook_flags import flag_on

FLAG = "NOTEBOOK_PLAN_GRADING_ENABLED"

# ── THE CONSTANTS (rulings R3, R4, P4). ONE block; tests pin every value. ────────────────────
CONSTANTS = MappingProxyType({
    # R4: entry kept when |fill - planned entry| <= max(ENTRY_TOL_R x R, ENTRY_TOL_PCT x entry).
    "ENTRY_TOL_R": 0.25,
    "ENTRY_TOL_PCT": 0.005,
    # R4: stop honoured when the exit is at or better than the stop plus STOP_SLIP_R x R.
    "STOP_SLIP_R": 0.25,
    # R4: size kept within +/- SIZE_TOL_PCT of the planned shares.
    "SIZE_TOL_PCT": 0.10,
    # P4 (planner's value; R4 did not set it): the target counts as hit within this much of it.
    "TARGET_SHORTFALL_R": 0.25,
    # Matching: a verdict or an unlinked plan note counts only from this far before entry.
    "MATCH_WINDOW_DAYS": 30,
    # R3: n < 10 "too few to judge"; 10-24 "thin sample" with a range; 25+ normal.
    "SAMPLE_TOO_FEW_BELOW": 10,
    "SAMPLE_NORMAL_FROM": 25,
    # The discipline record's two windows (last N closed trades).
    "DISCIPLINE_WINDOWS": (20, 60),
    # The Wilson interval's z for the thin-sample range (95%).
    "RANGE_Z": 1.96,
})

#: Comparisons are made on values rounded to this many decimals, so a boundary that is exactly
#: on the line reads as ON it (a float's 1e-15 noise must never flip a check).
_DP = 6

#: How many ids one status request may name (a Trade Journal page is far below this).
MAX_STATUS_IDS = 200

ET = ZoneInfo("America/New_York")

STATUS_PLANNED = "planned"
STATUS_UNPLANNED = "unplanned"
STATUS_NEEDS_PICK = "needs_pick"
STATUS_MEMBER_NONE = "member_none"   # the member said "this trade had no plan"

SOURCE_LABELS = {
    "chart": "Chart plan", "canvas": "Trade-plan canvas", "properties": "Plan properties",
    "text": "Plan note", "verdict": "Compass verdict",
}

SAMPLE_WORDING = {"too_few": "too few to judge", "thin": "thin sample", "normal": None}


def enabled() -> bool:
    """The gate, read per call through the one parser (unset = OFF)."""
    return flag_on(FLAG, False)


# ── time ─────────────────────────────────────────────────────────────────────────────────────

def _parse_ts(v: Any) -> datetime | None:
    """An aware UTC datetime from an ISO string (Z, offset, naive = UTC) or a bare date."""
    if not isinstance(v, str) or not v.strip():
        return None
    s = v.strip()
    try:
        if "T" not in s and " " not in s:
            d = date.fromisoformat(s[:10])
            return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def entry_moment(entry_date: Any) -> dict[str, Any] | None:
    """When the trade was entered, as the matcher needs it.

    A DATE-ONLY entry (a bare date, or the journal's date-only convention of UTC midnight,
    `trades._combine_manual_datetime`) has no time of day: it is judged by its ET day -- the
    cut-off is the END of that day -- and labelled so. A timed entry cuts off at the instant."""
    s = entry_date if isinstance(entry_date, str) else ""
    dt = _parse_ts(s)
    if dt is None:
        return None
    date_only = ("T" not in s and " " not in s) or (dt.time() == time(0, 0) and dt.utcoffset() == timedelta(0))
    if date_only:
        day = date.fromisoformat(s.strip()[:10])
        cutoff = datetime.combine(day + timedelta(days=1), time(0, 0), tzinfo=ET).astimezone(timezone.utc)
        start = datetime.combine(day - timedelta(days=CONSTANTS["MATCH_WINDOW_DAYS"]), time(0, 0),
                                 tzinfo=ET).astimezone(timezone.utc)
    else:
        day = dt.astimezone(ET).date()
        cutoff = dt
        start = dt - timedelta(days=CONSTANTS["MATCH_WINDOW_DAYS"])
    return {"cutoff": cutoff, "start": start, "day": day.isoformat(), "dateOnly": date_only}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── reading candidates ──────────────────────────────────────────────────────────────────────

def _prop_defs(conn: sqlite3.Connection, user_id: str) -> list[dict[str, Any]]:
    try:
        from api.services.journal_two.note_properties import list_property_defs
        return list_property_defs(user_id, conn=conn)
    except Exception:  # noqa: BLE001 -- no properties reads as "no property levels", never a 500
        return []


def _note_state_at(conn: sqlite3.Connection, user_id: str, note: sqlite3.Row,
                   cutoff: datetime) -> dict[str, Any]:
    """The note's content as it stood at `cutoff`: the current row if it has not changed since,
    else the latest version captured at or before it, else the current row marked post-entry."""
    current = {"body": note["body_json"], "props": note["properties_json"],
               "version_id": f"current@{note['updated_at']}", "as_of": note["updated_at"],
               "post_entry": False}
    upd = _parse_ts(note["updated_at"])
    if upd is not None and upd <= cutoff:
        return current
    best: tuple[datetime, str, str] | None = None
    for v in conn.execute("SELECT id, created_at FROM j2_note_versions WHERE user_id = ? AND note_id = ?",
                          (user_id, note["id"])).fetchall():
        ts = _parse_ts(v["created_at"])
        if ts is not None and ts <= cutoff and (best is None or ts > best[0]):
            best = (ts, v["id"], v["created_at"])
    if best is not None:
        row = conn.execute("SELECT body_json, properties_json FROM j2_note_versions WHERE id = ? AND user_id = ?",
                           (best[1], user_id)).fetchone()
        if row is not None:
            return {"body": row["body_json"], "props": row["properties_json"], "version_id": best[1],
                    "as_of": best[2], "post_entry": False}
    return {**current, "post_entry": True}


def _note_candidate(conn: sqlite3.Connection, user_id: str, note: sqlite3.Row, symbol: str,
                    moment: dict[str, Any], defs: list[dict[str, Any]], tier: str) -> dict[str, Any] | None:
    """One note as a plan candidate, read as it stood at entry -- or, when that state names no
    plan and the current one does, the current one labelled "plan edited after entry"."""
    need = (lambda r: r.names_any_level) if tier in ("explicit", "member") else (lambda r: r.is_plan)
    state = _note_state_at(conn, user_id, note, moment["cutoff"])
    reading = plan_extract.read_note_plan(state["body"], state["props"], defs, symbol)
    if not need(reading) and not state["post_entry"]:
        cur_reading = plan_extract.read_note_plan(note["body_json"], note["properties_json"], defs, symbol)
        if need(cur_reading):
            state = {"body": note["body_json"], "props": note["properties_json"],
                     "version_id": f"current@{note['updated_at']}", "as_of": note["updated_at"],
                     "post_entry": True}
            reading = cur_reading
    if not need(reading):
        return None
    return {"kind": "note", "id": note["id"], "title": note["title"] or "", "tier": tier,
            "reading": reading, "version_id": state["version_id"], "plan_as_of": state["as_of"],
            "edited_after_entry": bool(state["post_entry"])}


_NOTE_COLS = "id, title, ticker, tags, body_json, properties_json, created_at, updated_at, deleted_at"

#: A note carrying this tag is a REVIEW of a graded trade (lib/planReview.js). Its grade table
#: names an Entry and a Stop, so without this it would read as the plan for the NEXT trade on
#: the same ticker. Skipped by the unlinked-note tier only: a member may still link one.
REVIEW_TAG = "plan-review"


def _tagged_review(note: sqlite3.Row) -> bool:
    try:
        tags = json.loads(note["tags"] or "[]")
    except (ValueError, TypeError):
        return False
    return isinstance(tags, list) and REVIEW_TAG in tags


def _explicit_notes(conn: sqlite3.Connection, user_id: str, trade: sqlite3.Row) -> list[sqlite3.Row]:
    from api.services.journal_two.note_trade_links import notes_linked_to_trade
    try:
        ids = notes_linked_to_trade(conn, user_id, trade["id"], "equity_trade")
    except Exception:  # noqa: BLE001
        ids = []
    rows = []
    for nid in sorted(set(ids)):
        r = conn.execute(f"SELECT {_NOTE_COLS} FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                         (nid, user_id)).fetchone()
        if r is not None:
            rows.append(r)
    return rows


def _window_notes(conn: sqlite3.Connection, user_id: str, symbol: str,
                  moment: dict[str, Any]) -> list[sqlite3.Row]:
    rows = conn.execute(
        f"SELECT {_NOTE_COLS} FROM j2_notes WHERE user_id = ? AND ticker IN (?, ?) AND deleted_at IS NULL",
        (user_id, symbol, symbol.lower()),
    ).fetchall()
    out = []
    for r in rows:
        created = _parse_ts(r["created_at"])
        if created is None or created > moment["cutoff"]:
            continue   # written after the trade: never an unlinked plan for it
        if _tagged_review(r):
            continue
        out.append(r)
    return out


def _verdict_candidates(conn: sqlite3.Connection, user_id: str, trade: sqlite3.Row, symbol: str,
                        moment: dict[str, Any]) -> list[dict[str, Any]]:
    """The verdict the trade was entered against, else the latest one in the window."""
    side = trade["side"]
    linked_id = None
    try:
        ctx = json.loads(trade["context_at_entry"] or "{}")
        if isinstance(ctx, dict) and isinstance(ctx.get("compass_verdict_id"), str):
            linked_id = ctx["compass_verdict_id"].strip() or None
    except (ValueError, TypeError):
        linked_id = None
    rows = []
    if linked_id:
        r = conn.execute("SELECT * FROM j2_verdicts WHERE id = ? AND user_id = ?", (linked_id, user_id)).fetchone()
        if r is not None:
            rows = [r]
    if not rows:
        best = None
        for r in conn.execute("SELECT * FROM j2_verdicts WHERE user_id = ? AND symbol IN (?, ?) AND label != 'ERROR'",
                              (user_id, symbol, symbol.lower())).fetchall():
            ts = _parse_ts(r["created_at"])
            if ts is None or ts > moment["cutoff"] or ts < moment["start"]:
                continue
            if best is None or ts > best[0]:
                best = (ts, r)
        rows = [best[1]] if best else []
    out = []
    for r in rows:
        reading = plan_extract.read_verdict_plan(r)
        if not reading.is_plan:
            continue
        if reading.side and side and reading.side != side:
            continue
        out.append({"kind": "verdict", "id": r["id"], "title": f"Compass verdict ({r['label']})",
                    "tier": "verdict", "reading": reading, "version_id": r["id"],
                    "plan_as_of": r["created_at"], "edited_after_entry": False})
    return out


def find_candidates(conn: sqlite3.Connection, user_id: str, trade: sqlite3.Row,
                    defs: list[dict[str, Any]] | None = None) -> tuple[str | None, list[dict[str, Any]]]:
    """(winning tier, its candidates) -- the first tier with any candidate; (None, []) when the
    trade has no plan anywhere."""
    moment = entry_moment(trade["entry_date"])
    if moment is None:
        return None, []
    symbol = (trade["symbol"] or "").strip().upper()
    defs = _prop_defs(conn, user_id) if defs is None else defs
    explicit = [c for c in (_note_candidate(conn, user_id, n, symbol, moment, defs, "explicit")
                            for n in _explicit_notes(conn, user_id, trade)) if c]
    if explicit:
        return "explicit", explicit
    verdicts = _verdict_candidates(conn, user_id, trade, symbol, moment)
    if verdicts:
        return "verdict", verdicts
    window = []
    for n in _window_notes(conn, user_id, symbol, moment):
        c = _note_candidate(conn, user_id, n, symbol, moment, defs, "window")
        if c is None:
            continue
        as_of = _parse_ts(c["plan_as_of"])
        if not c["edited_after_entry"] and as_of is not None and as_of < moment["start"]:
            continue   # the plan as it stood at entry is older than the window
        window.append(c)
    if window:
        return "window", window
    return None, []


# ── the frozen link ─────────────────────────────────────────────────────────────────────────

def _row_to_link(r: sqlite3.Row | None) -> dict[str, Any] | None:
    if r is None:
        return None
    return {
        "tradeRef": r["trade_ref"], "symbol": r["symbol"], "sourceKind": r["source_kind"],
        "matchTier": r["match_tier"], "noteId": r["note_id"], "verdictId": r["verdict_id"],
        "versionId": r["version_id"], "planAsOf": r["plan_as_of"],
        "plan": json.loads(r["plan_json"] or "{}"), "flags": json.loads(r["flags_json"] or "[]"),
        "matchedAt": r["matched_at"], "relinkedAt": r["relinked_at"], "relinkCount": r["relink_count"],
    }


def get_link(conn: sqlite3.Connection, user_id: str, trade_ref: str) -> dict[str, Any] | None:
    return _row_to_link(conn.execute(
        "SELECT * FROM j2_trade_plan_links WHERE user_id = ? AND trade_ref = ?", (user_id, trade_ref)).fetchone())


def _candidate_row(user_id: str, trade_ref: str, symbol: str, cand: dict[str, Any] | None,
                   tier: str, moment: dict[str, Any] | None) -> tuple:
    flags = []
    if moment and moment["dateOnly"]:
        flags.append("date_only")
    if cand is None:   # the member said "no plan"
        return (user_id, trade_ref, symbol, "none", tier, None, None, None, None,
                json.dumps(plan_extract.PlanReading().as_dict()), json.dumps(flags), _now_iso())
    if cand["edited_after_entry"]:
        flags.append("edited_after_entry")
    return (user_id, trade_ref, symbol, cand["kind"], tier,
            cand["id"] if cand["kind"] == "note" else None,
            cand["id"] if cand["kind"] == "verdict" else None,
            cand["version_id"], cand["plan_as_of"],
            json.dumps(cand["reading"].as_dict()), json.dumps(flags), _now_iso())


_INSERT_COLS = ("user_id, trade_ref, symbol, source_kind, match_tier, note_id, verdict_id, version_id, "
                "plan_as_of, plan_json, flags_json, matched_at")


def freeze(conn: sqlite3.Connection, user_id: str, trade_ref: str, symbol: str,
           cand: dict[str, Any], tier: str, moment: dict[str, Any] | None) -> bool:
    """Store the FIRST match. ⛔ INSERT OR IGNORE, never REPLACE: a second matcher (another tab,
    a later request after the note changed) can never overwrite the plan that was frozen.
    True when this call is the one that froze it."""
    cur = conn.execute(
        f"INSERT OR IGNORE INTO j2_trade_plan_links ({_INSERT_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        _candidate_row(user_id, trade_ref, symbol, cand, tier, moment),
    )
    conn.commit()
    return cur.rowcount == 1


def match_trade(conn: sqlite3.Connection, user_id: str, trade: sqlite3.Row,
                defs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The plan for one trade: the frozen link if there is one; else match now (freezing a
    unique winner); else the tie or the absence. Never writes j2_trades."""
    ref = trade_ref_for_row(trade)
    link = get_link(conn, user_id, ref)
    if link is not None:
        return {"status": STATUS_MEMBER_NONE if link["sourceKind"] == "none" else STATUS_PLANNED,
                "link": link, "candidates": None}
    tier, cands = find_candidates(conn, user_id, trade, defs)
    if tier is None:
        return {"status": STATUS_UNPLANNED, "link": None, "candidates": []}
    if len(cands) > 1:
        return {"status": STATUS_NEEDS_PICK, "link": None, "candidates": cands, "tier": tier}
    moment = entry_moment(trade["entry_date"])
    freeze(conn, user_id, ref, (trade["symbol"] or "").upper(), cands[0], tier, moment)
    return {"status": STATUS_PLANNED, "link": get_link(conn, user_id, ref), "candidates": None}


class RelinkError(ValueError):
    """A re-link the server refuses (unknown note, a note that names no plan)."""


def relink(conn: sqlite3.Connection, user_id: str, trade: sqlite3.Row, *,
           note_id: str | None = None, verdict_id: str | None = None, none: bool = False) -> dict[str, Any]:
    """The member's Re-link: the ONE way a frozen plan changes (R4). The replaced row is kept in
    `previous_json` (R-11). `none=True` records "this trade had no plan"."""
    ref = trade_ref_for_row(trade)
    symbol = (trade["symbol"] or "").upper()
    moment = entry_moment(trade["entry_date"])
    if moment is None:
        raise RelinkError("This trade has no entry date to read a plan against")
    cand = None
    if not none:
        defs = _prop_defs(conn, user_id)
        if note_id:
            n = conn.execute(f"SELECT {_NOTE_COLS} FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                             (note_id, user_id)).fetchone()
            if n is None:
                raise RelinkError("Note not found")
            cand = _note_candidate(conn, user_id, n, symbol, moment, defs, "member")
            if cand is None:
                raise RelinkError("That note names no entry, stop, target or shares")
        elif verdict_id:
            v = conn.execute("SELECT * FROM j2_verdicts WHERE id = ? AND user_id = ?", (verdict_id, user_id)).fetchone()
            if v is None:
                raise RelinkError("Verdict not found")
            reading = plan_extract.read_verdict_plan(v)
            if not reading.names_any_level:
                raise RelinkError("That verdict names no levels")
            cand = {"kind": "verdict", "id": v["id"], "title": "", "tier": "member", "reading": reading,
                    "version_id": v["id"], "plan_as_of": v["created_at"], "edited_after_entry": False}
        else:
            raise RelinkError("Choose a note, a verdict, or no plan")
    previous = conn.execute("SELECT * FROM j2_trade_plan_links WHERE user_id = ? AND trade_ref = ?",
                            (user_id, ref)).fetchone()
    history = []
    count = 0
    if previous is not None:
        count = int(previous["relink_count"] or 0) + 1
        try:
            history = json.loads(previous["previous_json"] or "[]")
        except ValueError:
            history = []
        prev = dict(previous)
        prev.pop("previous_json", None)
        history = (history if isinstance(history, list) else []) + [prev]
    row = _candidate_row(user_id, ref, symbol, cand, "member", moment)
    conn.execute("DELETE FROM j2_trade_plan_links WHERE user_id = ? AND trade_ref = ?", (user_id, ref))
    conn.execute(
        f"INSERT INTO j2_trade_plan_links ({_INSERT_COLS}, relinked_at, relink_count, previous_json)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (*row, _now_iso(), count, json.dumps(history[-20:]) if history else None),
    )
    conn.commit()
    return get_link(conn, user_id, ref)


# ── grading (pure) ──────────────────────────────────────────────────────────────────────────

def _r(v: float) -> float:
    return round(v, _DP)


def _role_state(plan: dict[str, Any], role: str) -> str:
    roles = plan.get("roles") if isinstance(plan.get("roles"), dict) else {}
    r = roles.get(role) if isinstance(roles.get(role), dict) else {}
    return r.get("state") or plan_extract.STATE_ABSENT


def _missing(plan: dict[str, Any], *roles: str) -> dict[str, Any] | None:
    """The check's state when an input is missing: unreadable beats absent."""
    states = [_role_state(plan, r) for r in roles]
    if plan_extract.STATE_UNREADABLE in states:
        return {"state": "unreadable"}
    if any(plan.get(r) is None for r in roles):
        return {"state": "none"}
    return None


def grade_checks(plan: dict[str, Any], trade: dict[str, Any], *, mfe_price: float | None = None,
                 entered_shares: float | None = None) -> dict[str, Any]:
    """The four checks for one trade against its frozen plan. Pure arithmetic, never raises on
    a missing input -- it reads ``none`` (the UI's "—") or ``unreadable``.

    `trade`: {side 'Long'|'Short', entryPrice, exitPrice, shares}. The R unit is the PLAN's
    |entry - stop|, so a broker trade with a placeholder stop is graded on the plan's stop."""
    side = trade.get("side")
    sign = 1.0 if side == "Long" else -1.0
    pe, ps, pt, pn = plan.get("entry"), plan.get("stop"), plan.get("target"), plan.get("shares")
    fill_entry, fill_exit = trade.get("entryPrice"), trade.get("exitPrice")
    r_unit = abs(pe - ps) if isinstance(pe, (int, float)) and isinstance(ps, (int, float)) and pe != ps else None
    side_mismatch = False
    if r_unit is not None and side in ("Long", "Short"):
        plan_side = "Long" if ps < pe else "Short"
        side_mismatch = plan_side != side
    out: dict[str, Any] = {"r": _r(r_unit) if r_unit else None, "sideMismatch": side_mismatch}

    # Entry
    miss = _missing(plan, "entry", "stop")
    if miss is not None or r_unit is None:
        out["entry"] = miss or {"state": "none"}
    else:
        tol = max(CONSTANTS["ENTRY_TOL_R"] * r_unit, CONSTANTS["ENTRY_TOL_PCT"] * pe)
        d = float(fill_entry) - pe
        kept = _r(abs(d)) <= _r(tol)
        out["entry"] = {"state": "kept" if kept else "missed", "planned": pe, "actual": float(fill_entry),
                        "tolerance": _r(tol), "chaseR": _r(sign * d / r_unit),
                        "deltaPct": _r(d / pe)}

    # Stop
    miss = _missing(plan, "entry", "stop")
    if miss is not None or r_unit is None:
        out["stop"] = miss or {"state": "none"}
    elif side_mismatch:
        out["stop"] = {"state": "none", "reason": "side_mismatch"}
    else:
        limit = ps - sign * CONSTANTS["STOP_SLIP_R"] * r_unit
        honoured = _r(sign * (float(fill_exit) - limit)) >= 0
        out["stop"] = {"state": "kept" if honoured else "missed", "planned": ps, "limit": _r(limit),
                       "exit": float(fill_exit), "exitVsStopR": _r(sign * (float(fill_exit) - ps) / r_unit)}

    # Size
    miss = _missing(plan, "shares")
    actual_shares = entered_shares if entered_shares is not None else trade.get("shares")
    if miss is not None or actual_shares is None:
        out["size"] = miss or {"state": "none"}
    else:
        d = float(actual_shares) - pn
        kept = _r(abs(d)) <= _r(CONSTANTS["SIZE_TOL_PCT"] * pn)
        out["size"] = {"state": "kept" if kept else "missed", "planned": pn, "actual": float(actual_shares),
                       "deltaPct": _r(d / pn)}

    # Target
    miss = _missing(plan, "entry", "stop", "target")
    if miss is not None or r_unit is None:
        out["target"] = miss or {"state": "none"}
    elif side_mismatch:
        out["target"] = {"state": "none", "reason": "side_mismatch"}
    else:
        hit_line = pt - sign * CONSTANTS["TARGET_SHORTFALL_R"] * r_unit
        if _r(sign * (float(fill_exit) - hit_line)) >= 0:
            state = "hit"
        elif mfe_price is None:
            state = "unknown"
        elif _r(sign * (float(mfe_price) - pt)) >= 0:
            state = "reached_not_taken"
        else:
            state = "not_reached"
        out["target"] = {"state": state, "planned": pt, "hitLine": _r(hit_line), "exit": float(fill_exit),
                         "mfePrice": mfe_price}

    graded = [out[k]["state"] for k in ("entry", "stop", "size") if out[k]["state"] in ("kept", "missed")]
    out["followedPlan"] = (all(s == "kept" for s in graded) if graded else None)
    return out


# ── sample-size wording (R3) ────────────────────────────────────────────────────────────────

def sample_band(n: int) -> str:
    if n < CONSTANTS["SAMPLE_TOO_FEW_BELOW"]:
        return "too_few"
    if n < CONSTANTS["SAMPLE_NORMAL_FROM"]:
        return "thin"
    return "normal"


def wilson(k: int, n: int, z: float | None = None) -> tuple[float, float] | None:
    if n <= 0:
        return None
    z = CONSTANTS["RANGE_Z"] if z is None else z
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (round(max(0.0, center - half), 3), round(min(1.0, center + half), 3))


def rate_stat(k: int, n: int) -> dict[str, Any]:
    """A rate with its R3 wording: under 10 "too few to judge" (the rate rides along for a
    reveal), 10-24 "thin sample" with a range, 25+ normal."""
    band = sample_band(n)
    return {"k": k, "n": n, "rate": round(k / n, 4) if n else None, "band": band,
            "wording": SAMPLE_WORDING[band], "range": list(wilson(k, n)) if band == "thin" else None}


# ── per-trade payloads ──────────────────────────────────────────────────────────────────────

def _trade_dict(t: sqlite3.Row) -> dict[str, Any]:
    return {"id": t["id"], "symbol": t["symbol"], "side": t["side"], "shares": float(t["shares"]),
            "entryPrice": float(t["entry_price"]), "exitPrice": float(t["exit_price"]),
            "entryDate": t["entry_date"], "exitDate": t["exit_date"], "setup": t["setup"],
            "source": t["source"] if "source" in t.keys() else None,
            "originalStop": float(t["original_stop"]) if t["original_stop"] is not None else None}


def _entered_shares(conn: sqlite3.Connection, user_id: str, t: sqlite3.Row) -> tuple[float, int]:
    """Shares ENTERED: a position closed in pieces is several trade rows that share the same
    entry (symbol, side, entry date, entry price); the plan's size is the whole entry."""
    row = conn.execute(
        "SELECT COALESCE(SUM(shares), 0) AS s, COUNT(*) AS n FROM j2_trades WHERE user_id = ? AND symbol = ?"
        " AND side = ? AND entry_date = ? AND ABS(entry_price - ?) < 0.000001",
        (user_id, t["symbol"], t["side"], t["entry_date"], float(t["entry_price"])),
    ).fetchone()
    n = int(row["n"] or 0)
    return (float(row["s"]) if n else float(t["shares"])), max(n, 1)


def _mfe(conn: sqlite3.Connection, user_id: str, ref: str) -> float | None:
    try:
        r = conn.execute("SELECT mfe_price FROM j2_trade_excursions WHERE user_id = ? AND trade_ref = ?",
                         (user_id, ref)).fetchone()
    except sqlite3.OperationalError:
        return None
    if r is None or r["mfe_price"] is None:
        return None
    v = float(r["mfe_price"])
    return v if math.isfinite(v) else None


def _candidate_public(c: dict[str, Any]) -> dict[str, Any]:
    reading: plan_extract.PlanReading = c["reading"]
    return {"kind": c["kind"], "id": c["id"], "title": c["title"], "tier": c["tier"],
            "plan": reading.as_dict(), "planAsOf": c["plan_as_of"],
            "editedAfterEntry": c["edited_after_entry"]}


def _note_title(conn: sqlite3.Connection, user_id: str, note_id: str | None) -> str | None:
    if not note_id:
        return None
    r = conn.execute("SELECT title, deleted_at FROM j2_notes WHERE id = ? AND user_id = ?", (note_id, user_id)).fetchone()
    if r is None:
        return None
    return r["title"] or ""


def grade_payload(conn: sqlite3.Connection, user_id: str, t: sqlite3.Row,
                  defs: list[dict[str, Any]] | None = None, *, with_candidates: bool = True) -> dict[str, Any]:
    """Everything the trade page shows for one trade."""
    m = match_trade(conn, user_id, t, defs)
    ref = trade_ref_for_row(t)
    trade = _trade_dict(t)
    moment = entry_moment(t["entry_date"])
    out: dict[str, Any] = {"tradeId": t["id"], "tradeRef": ref, "symbol": t["symbol"], "side": t["side"],
                           "status": m["status"], "dateOnly": bool(moment and moment["dateOnly"]),
                           "entryDay": moment["day"] if moment else None,
                           "plan": None, "checks": None, "labels": [], "setupChip": None,
                           "candidates": [_candidate_public(c) for c in (m.get("candidates") or [])]}
    link = m["link"]
    if link is not None and link["sourceKind"] != "none":
        plan = link["plan"]
        entered, closes = _entered_shares(conn, user_id, t)
        checks = grade_checks(plan, trade, mfe_price=_mfe(conn, user_id, ref), entered_shares=entered)
        labels = list(link["flags"])
        if closes > 1:
            labels.append("size_from_closes")
        try:
            from api.services.placeholder_stop import is_placeholder_stop
            if trade["source"] == "broker" and is_placeholder_stop(trade["originalStop"], trade["entryPrice"]):
                labels.append("stop_from_plan")
        except Exception:  # noqa: BLE001
            pass
        if checks.get("sideMismatch"):
            labels.append("side_mismatch")
        source = "verdict" if link["sourceKind"] == "verdict" else (plan.get("primaryShape") or "text")
        out.update({
            "plan": {**plan, "source": source, "sourceLabel": SOURCE_LABELS.get(source, "Plan"),
                     "sourceKind": link["sourceKind"], "matchTier": link["matchTier"],
                     "noteId": link["noteId"], "noteTitle": _note_title(conn, user_id, link["noteId"]),
                     "verdictId": link["verdictId"], "versionId": link["versionId"],
                     "planAsOf": link["planAsOf"], "matchedAt": link["matchedAt"],
                     "relinkedAt": link["relinkedAt"], "relinkCount": link["relinkCount"]},
            "checks": checks, "labels": labels, "enteredShares": entered, "closes": closes,
        })
        if trade["source"] == "broker" and not (trade["setup"] or "").strip() and plan.get("setup"):
            out["setupChip"] = {"setup": plan["setup"]}
    elif link is not None:
        out["plan"] = {"sourceKind": "none", "matchedAt": link["matchedAt"], "relinkedAt": link["relinkedAt"]}
    if with_candidates and m["status"] != STATUS_NEEDS_PICK:
        # The Re-link picker's choices: every candidate in every tier, so a member can move a
        # frozen plan to the note they meant.
        out["candidates"] = _all_candidates(conn, user_id, t, defs)
    return out


def _all_candidates(conn: sqlite3.Connection, user_id: str, t: sqlite3.Row,
                    defs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    moment = entry_moment(t["entry_date"])
    if moment is None:
        return []
    symbol = (t["symbol"] or "").strip().upper()
    defs = _prop_defs(conn, user_id) if defs is None else defs
    seen: set[tuple[str, str]] = set()
    out: list[dict[str, Any]] = []
    groups = [[_note_candidate(conn, user_id, n, symbol, moment, defs, "explicit") for n in _explicit_notes(conn, user_id, t)],
              _verdict_candidates(conn, user_id, t, symbol, moment),
              [_note_candidate(conn, user_id, n, symbol, moment, defs, "window") for n in _window_notes(conn, user_id, symbol, moment)]]
    for group in groups:
        for c in group:
            if c and (c["kind"], c["id"]) not in seen:
                seen.add((c["kind"], c["id"]))
                out.append(_candidate_public(c))
    return out[:20]


def get_trade(conn: sqlite3.Connection, user_id: str, trade_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM j2_trades WHERE user_id = ? AND id = ?", (user_id, trade_id)).fetchone()


def statuses(conn: sqlite3.Connection, user_id: str, trade_ids: list[str]) -> dict[str, dict[str, Any]]:
    """{tradeId: {tradeRef, status}} for the Trade Journal's Unplanned chip. Every id the member
    owns is answered -- an unplanned trade is labelled, never left out."""
    ids = [i for i in dict.fromkeys(trade_ids) if isinstance(i, str) and i][:MAX_STATUS_IDS]
    if not ids:
        return {}
    defs = _prop_defs(conn, user_id)
    out: dict[str, dict[str, Any]] = {}
    marks = ",".join("?" for _ in ids)
    for t in conn.execute(f"SELECT * FROM j2_trades WHERE user_id = ? AND id IN ({marks})", (user_id, *ids)).fetchall():
        m = match_trade(conn, user_id, t, defs)
        out[t["id"]] = {"tradeRef": trade_ref_for_row(t), "status": m["status"]}
    return out


# ── the discipline record ───────────────────────────────────────────────────────────────────

def _closed_items(conn: sqlite3.Connection, user_id: str, account_id: str | None) -> list[tuple[datetime, str, Any]]:
    """Every closed trade, equity AND options, newest exit first. ⛔ No filter on source,
    exclusion flag or anything else: the record counts what the broker sent."""
    where, params = "user_id = ?", [user_id]
    if account_id:
        where += " AND account_id = ?"
        params.append(account_id)
    items: list[tuple[datetime, str, Any]] = []
    for t in conn.execute(f"SELECT * FROM j2_trades WHERE {where}", params).fetchall():
        items.append((_parse_ts(t["exit_date"]) or datetime.min.replace(tzinfo=timezone.utc), "equity", t))
    for s in conn.execute(f"SELECT id, closed_at, created_at FROM j2_option_strategies WHERE {where} AND status != 'open'",
                          params).fetchall():
        when = _parse_ts(s["closed_at"]) or _parse_ts(s["created_at"]) or datetime.min.replace(tzinfo=timezone.utc)
        items.append((when, "option", s))
    items.sort(key=lambda x: (x[0], x[2]["id"]), reverse=True)
    return items


def discipline_record(conn: sqlite3.Connection, user_id: str, account_id: str | None = None) -> dict[str, Any]:
    items = _closed_items(conn, user_id, account_id)
    defs = _prop_defs(conn, user_id)
    biggest = max(CONSTANTS["DISCIPLINE_WINDOWS"])
    graded: list[dict[str, Any]] = []
    for _, kind, row in items[:biggest]:
        if kind == "option":
            graded.append({"kind": "option", "id": row["id"]})
            continue
        p = grade_payload(conn, user_id, row, defs, with_candidates=False)
        graded.append({"kind": "equity", "id": row["id"], "status": p["status"], "checks": p["checks"],
                       "labels": p["labels"]})
    windows = []
    for size in CONSTANTS["DISCIPLINE_WINDOWS"]:
        rows = graded[:size]
        equity = [r for r in rows if r["kind"] == "equity"]
        planned = [r for r in equity if r["status"] == STATUS_PLANNED and r["checks"]]
        unplanned = [r for r in equity if r["status"] in (STATUS_UNPLANNED, STATUS_MEMBER_NONE)]
        needs_pick = [r for r in equity if r["status"] == STATUS_NEEDS_PICK]

        def kept(check: str) -> dict[str, Any]:
            states = [r["checks"][check]["state"] for r in planned]
            k = sum(1 for s in states if s == "kept")
            return rate_stat(k, k + sum(1 for s in states if s == "missed"))

        tstates = [r["checks"]["target"]["state"] for r in planned]
        decided = [s for s in tstates if s in ("hit", "reached_not_taken", "not_reached")]
        followed = [r["checks"]["followedPlan"] for r in planned if r["checks"]["followedPlan"] is not None]
        windows.append({
            "size": size, "trades": len(rows), "equity": len(equity),
            "options": sum(1 for r in rows if r["kind"] == "option"),
            "planned": len(planned), "unplanned": len(unplanned), "needsPick": len(needs_pick),
            "planRate": rate_stat(len(planned), len(planned) + len(unplanned)),
            "editedAfterEntry": sum(1 for r in planned if "edited_after_entry" in r["labels"]),
            "entry": kept("entry"), "stop": kept("stop"), "size_": kept("size"),
            "target": {"hit": tstates.count("hit"), "reachedNotTaken": tstates.count("reached_not_taken"),
                       "notReached": tstates.count("not_reached"), "unknown": tstates.count("unknown"),
                       "hitRate": rate_stat(tstates.count("hit"), len(decided))},
            "followedPlan": rate_stat(sum(1 for f in followed if f), len(followed)),
        })
    return {"windows": windows, "constants": dict(CONSTANTS), "totalClosed": len(items)}
