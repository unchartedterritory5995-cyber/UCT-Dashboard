"""Which stocks were in each screen at each nightly build: the record behind "New today".

A row is NEW when it is in the screen's current results and was not in the screen's
results at the PREVIOUS build. The label names the trading session that previous build
ran through (a build's `snapshot_date` is the day it ran, not the session it describes).
Spec: docs/superpowers/specs/2026-10-16-screener-focus-next-design.md section 1.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import logging
import time

from . import snapshot_db

log = logging.getLogger(__name__)

#: Dates kept per screen.
KEEP_DATES = 5
#: Above this many matches a screen stores its count only and shows no markers.
TOO_WIDE = 2000
#: Columns that are blank in every nightly build by design: a nightly comparison of a
#: screen reading one would mark every row New.
LIVE_ONLY_COLUMNS = frozenset({"rvol_live"})
#: Seconds a screen's CURRENT tickers are reused between diff requests.
CURRENT_TTL_S = 60

_CURRENT: dict = {}


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def spec_hash(spec: dict) -> str:
    """The screen's identity: its criteria only (filters, logic, rank), never sort or view."""
    spec = spec or {}
    crit = {"filters": spec.get("filters") or [], "logic": spec.get("logic"), "rank": spec.get("rank")}
    raw = json.dumps(crit, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def reads_live_only(spec: dict) -> bool:
    return any(n.get("key") in LIVE_ONLY_COLUMNS for n in _walk(spec or {}))


def has_list_filter(spec: dict) -> bool:
    return any(n.get("key") == "list" for n in _walk(spec or {}))


def _ensure(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS screen_membership (
        spec_hash TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        session_date TEXT,
        state TEXT NOT NULL,
        n INTEGER NOT NULL,
        tickers TEXT,
        recorded_at REAL NOT NULL,
        PRIMARY KEY (spec_hash, snapshot_date))""")


def _tickers_now(spec: dict, limit: int) -> tuple[list[str], int]:
    """The screen's tickers as the scan answers them right now (live overlay included)."""
    from api.routers.screen_promote import screen_tickers
    tickers, total, _snap = screen_tickers(spec, {}, limit)
    return tickers, total


def record(spec: dict, *, snapshot_date: str, session_date: str | None) -> str:
    """Store this screen's tickers for one build. A screen with a member's watchlist
    filter answers per member, so it is never recorded."""
    if has_list_filter(spec):
        return "skipped_list"
    tickers, total = _tickers_now(spec, TOO_WIDE + 1)
    state = "too_wide" if total > TOO_WIDE else "ok"
    h = spec_hash(spec)
    with snapshot_db.connect() as conn:
        _ensure(conn)
        conn.execute(
            "INSERT OR REPLACE INTO screen_membership "
            "(spec_hash, snapshot_date, session_date, state, n, tickers, recorded_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (h, snapshot_date, session_date, state, int(total),
             json.dumps(sorted(tickers)) if state == "ok" else None, time.time()))
        conn.execute(
            "DELETE FROM screen_membership WHERE spec_hash = ? AND snapshot_date NOT IN "
            "(SELECT snapshot_date FROM screen_membership WHERE spec_hash = ? "
            " ORDER BY snapshot_date DESC LIMIT ?)", (h, h, KEEP_DATES))
    return state


def _build_identity() -> tuple[str | None, str | None]:
    """(snapshot_date, settled session) of the build that just finished."""
    st = snapshot_db.status() or {}
    run = snapshot_db.last_build_run() or {}
    session = (run.get("settled_bars") or {}).get("session")
    return st.get("snapshot_date"), session


def record_all() -> dict:
    """Record every starter and every member's saved screen once, deduplicated by hash."""
    from . import saved_screens
    snapshot_date, session_date = _build_identity()
    out = {"recorded": 0, "too_wide": 0, "skipped_list": 0, "errors": 0,
           "snapshot_date": snapshot_date, "session_date": session_date}
    if not snapshot_date:
        out["errors"] = 1
        return out
    specs = [s.get("spec") or {} for s in saved_screens.starters()] + list(saved_screens.all_specs())
    seen = set()
    for spec in specs:
        h = spec_hash(spec)
        if h in seen:
            continue
        seen.add(h)
        try:
            state = record(spec, snapshot_date=snapshot_date, session_date=session_date)
        except Exception as e:                                  # noqa: BLE001
            log.warning("[screener] membership record failed for %s: %s", h[:12], e)
            out["errors"] += 1
            continue
        out["recorded" if state == "ok" else state] += 1
    return out


def _label(session_date: str | None, snapshot_date: str) -> str:
    try:
        d = datetime.date.fromisoformat(session_date)
        return f"New since {d.strftime('%b')} {d.day} close"
    except (TypeError, ValueError):
        return f"New since the {snapshot_date} build"


def diff(spec: dict) -> dict:
    """The New-today answer for one screen: who entered and who left since the
    previous recorded build. Every non-`ok` state draws no markers."""
    if reads_live_only(spec):
        return {"state": "live_screen"}
    if has_list_filter(spec):
        return {"state": "unsaved"}
    h = spec_hash(spec)
    with snapshot_db.connect() as conn:
        _ensure(conn)
        rows = conn.execute(
            "SELECT snapshot_date, session_date, state, tickers FROM screen_membership "
            "WHERE spec_hash = ? ORDER BY snapshot_date DESC LIMIT 2", (h,)).fetchall()
    if not rows:
        return {"state": "unsaved"}
    if len(rows) < 2:
        return {"state": "no_history"}
    latest, prev = rows[0], rows[1]
    if "too_wide" in (latest["state"], prev["state"]):
        return {"state": "too_wide"}
    hit = _CURRENT.get(h)
    if hit and time.time() - hit[0] < CURRENT_TTL_S:
        current = hit[1]
    else:
        current = set(_tickers_now(spec, TOO_WIDE + 1)[0])
        _CURRENT[h] = (time.time(), current)
    before = set(json.loads(prev["tickers"] or "[]"))
    return {"state": "ok", "as_of": latest["snapshot_date"], "prev_as_of": prev["snapshot_date"],
            "prev_session": prev["session_date"],
            "entered": sorted(current - before), "exited": sorted(before - current),
            "new_since_label": _label(prev["session_date"], prev["snapshot_date"])}
