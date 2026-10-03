"""Standing alerts on a FILTER-LIST screen (FT-027), via a membership snapshot.

`screen_alerts` already tells a member when a name enters or leaves a
DEFINITION scan, because the 05:00 sweep stores each definition's nightly hit
set in `scan_hits`. A filter-list screen (a spec: filters + logic + scopes) has
no such store -- it is evaluated on request and forgotten. This module gives
each subscribed spec its own nightly membership snapshot and diffs it.

THE RULES (each one is a test in tests/test_screener_spec_alerts.py):
  * ⛔ ONE EVALUATOR. A snapshot is `screen_promote.screen_tickers(spec, ...)`
    -- the function /api/screener/to-watchlist runs, which is `query.run_scan`
    with the SUBSCRIBER's id -- so an alert can never mean a different set of
    names than the screen itself shows that member.
  * ⛔ A SESSION IS THE SCREENER SNAPSHOT'S DATE, not the wall clock. A second
    run against the same 03:00 build stores nothing new and diffs nothing, so a
    restart or a retry can never alert twice for one session.
  * ⛔ A FIRST SNAPSHOT IS NOT A HUNDRED ENTRIES. With no previous session there
    is nothing to diff and this says nothing (`screen_alerts`' own rule).
  * ⛔ A TRUNCATED SET IS NEVER DIFFED. A screen wider than `MAX_MEMBERS` is
    stored with `truncated=1` and reported as `too_wide`: diffing the first 500
    of two orderings would invent entries and exits that did not happen.
  * ⛔ NEVER A DELETE OF MEMBER DATA. Unsubscribe stamps `suspended_at`; the
    subscription, its snapshots and its fires stay. Only DERIVED snapshots
    beyond the newest `KEEP_SNAPSHOTS` per subscription are pruned.
  * The member's routing rule (FT-036) applies: suspended -> the fire is
    recorded with `routing = suspended` and nothing is sent.

DARK: `SCREENER_SPEC_ALERTS_ENABLED` (default off, read per call). Off: the
routes 404 and `run_nightly` does nothing. The scheduler job is registered
unconditionally and asks this flag each run.
"""
from __future__ import annotations

import json
import logging
import os
import time

from . import snapshot_db

log = logging.getLogger(__name__)

FLAG = "SCREENER_SPEC_ALERTS_ENABLED"
MODES = ("entry", "exit", "both")
#: The widest screen a snapshot will hold -- the promote route's own ceiling.
MAX_MEMBERS = 500
#: Standing alerts one member may hold at once.
MAX_SUBS_PER_USER = 10
#: Alerts one member is sent per nightly run (screen_alerts.MAX_PER_USER).
MAX_PER_USER = 6
MAX_NAMED = 12
KEEP_SNAPSHOTS = 30

_SCHEMA = """
CREATE TABLE IF NOT EXISTS spec_alert_subs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  spec_json      TEXT    NOT NULL,
  mode           TEXT    NOT NULL,
  saved_screen_id INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  suspended_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_spec_alert_subs_user ON spec_alert_subs(user_id);
CREATE TABLE IF NOT EXISTS spec_alert_snapshots (
  sub_id     INTEGER NOT NULL,
  as_of      TEXT    NOT NULL,
  symbols    TEXT    NOT NULL,
  total      INTEGER NOT NULL,
  truncated  INTEGER NOT NULL,
  taken_at   INTEGER NOT NULL,
  PRIMARY KEY (sub_id, as_of)
);
CREATE TABLE IF NOT EXISTS spec_alerts_fired (
  sub_id    INTEGER NOT NULL,
  as_of     TEXT    NOT NULL,
  fired_at  INTEGER NOT NULL,
  entered   INTEGER NOT NULL,
  exited    INTEGER NOT NULL,
  routing   TEXT,
  PRIMARY KEY (sub_id, as_of)
);
"""

_done: set = set()


class SpecAlertError(ValueError):
    """A sentence the member can act on."""


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def _ensure() -> None:
    path = snapshot_db.get_db_path()
    if path in _done:
        return
    with snapshot_db.connect() as conn:
        conn.executescript(_SCHEMA)
    _done.add(path)


def _clean_spec(spec) -> dict:
    if not isinstance(spec, dict):
        raise SpecAlertError("a standing alert needs a screen")
    out = {k: v for k, v in spec.items() if k in ("filters", "logic", "sort", "rank")}
    if not out.get("filters") and not out.get("logic"):
        raise SpecAlertError(
            "a standing alert needs at least one criterion; an alert on the "
            "whole market would fire on every listing change")
    return out


def _row(r) -> dict:
    return {"id": r[0], "name": r[1], "spec": json.loads(r[2]), "mode": r[3],
            "saved_screen_id": r[4], "created_at": r[5], "suspended": r[6] is not None}


_COLS = "id, name, spec_json, mode, saved_screen_id, created_at, suspended_at"


def subscribe(user, name, spec, mode="both", saved_screen_id=None, *, validate=None) -> dict:
    """Create a standing alert. The spec is VALIDATED by counting it for the
    caller -- a criterion the screener would refuse is refused here, now, not
    at 06:30 tomorrow when nobody is watching."""
    if mode not in MODES:
        raise SpecAlertError(f"mode must be one of {', '.join(MODES)}")
    user_id = str((user or {}).get("id") or "").strip()
    if not user_id:
        raise SpecAlertError("a standing alert needs a member")
    clean = _clean_spec(spec)
    if validate is None:
        from . import query
        validate = lambda s: query.preview_count(s, user_id=user_id)  # noqa: E731
    validate(clean)
    _ensure()
    now = int(time.time())
    with snapshot_db.connect() as conn:
        n = conn.execute("SELECT COUNT(*) FROM spec_alert_subs WHERE user_id=? "
                         "AND suspended_at IS NULL", (user_id,)).fetchone()[0]
        if n >= MAX_SUBS_PER_USER:
            raise SpecAlertError(
                f"you can hold {MAX_SUBS_PER_USER} standing screen alerts; turn one "
                "off first")
        cur = conn.execute(
            "INSERT INTO spec_alert_subs (user_id, name, spec_json, mode, "
            "saved_screen_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (user_id, (str(name or "").strip() or "Untitled screen")[:80],
             json.dumps(clean, sort_keys=True), mode,
             int(saved_screen_id) if saved_screen_id else None, now, now))
        sid = cur.lastrowid
        r = conn.execute(f"SELECT {_COLS} FROM spec_alert_subs WHERE id=?",
                         (sid,)).fetchone()
    return _row(r)


def list_subs(user_id) -> list[dict]:
    _ensure()
    with snapshot_db.connect() as conn:
        rows = conn.execute(f"SELECT {_COLS} FROM spec_alert_subs WHERE user_id=? "
                            "ORDER BY created_at", (str(user_id),)).fetchall()
    return [_row(r) for r in rows]


def set_suspended(user_id, sub_id, suspended: bool) -> bool:
    """Turn a standing alert off or back on. ⛔ Never a DELETE: its spec, its
    snapshots and its fire history all stay, and resume is one write."""
    _ensure()
    now = int(time.time())
    with snapshot_db.connect() as conn:
        cur = conn.execute(
            "UPDATE spec_alert_subs SET suspended_at=?, updated_at=? "
            "WHERE id=? AND user_id=?",
            (now if suspended else None, now, int(sub_id), str(user_id)))
        return cur.rowcount > 0


# ── the snapshot and the diff ───────────────────────────────────────────────

def _default_snapshotter(spec: dict, user_id: str):
    """(tickers, total, as_of) through the promote route's own function."""
    from api.routers.screen_promote import screen_tickers
    return screen_tickers(spec, {"id": user_id}, MAX_MEMBERS + 1)


def take_snapshot(sub_id: int, user_id: str, spec: dict, *, snapshotter=None) -> dict:
    """Store this session's membership. Returns {as_of, new, truncated}.
    A run against a session already stored stores nothing (`new: False`)."""
    snapshotter = snapshotter or _default_snapshotter
    tickers, total, as_of = snapshotter(spec, user_id)
    if not as_of:
        raise SpecAlertError("the screener snapshot has no date; nothing to compare")
    truncated = int(total or len(tickers)) > MAX_MEMBERS or len(tickers) > MAX_MEMBERS
    tickers = sorted(set(tickers[:MAX_MEMBERS]))
    _ensure()
    with snapshot_db.connect() as conn:
        cur = conn.execute(
            "INSERT OR IGNORE INTO spec_alert_snapshots (sub_id, as_of, symbols, "
            "total, truncated, taken_at) VALUES (?,?,?,?,?,?)",
            (int(sub_id), str(as_of), json.dumps(tickers), int(total or 0),
             1 if truncated else 0, int(time.time())))
        new = cur.rowcount > 0
        if new:
            conn.execute(
                "DELETE FROM spec_alert_snapshots WHERE sub_id=? AND as_of NOT IN "
                "(SELECT as_of FROM spec_alert_snapshots WHERE sub_id=? "
                " ORDER BY as_of DESC LIMIT ?)", (int(sub_id), int(sub_id), KEEP_SNAPSHOTS))
    return {"as_of": str(as_of), "new": new, "truncated": truncated}


def diff_for(sub_id: int):
    """(as_of, entered, exited, reason). `reason` is None when comparable."""
    _ensure()
    with snapshot_db.connect() as conn:
        rows = conn.execute(
            "SELECT as_of, symbols, truncated FROM spec_alert_snapshots WHERE "
            "sub_id=? ORDER BY as_of DESC LIMIT 2", (int(sub_id),)).fetchall()
    if len(rows) < 2:
        return (rows[0][0] if rows else None), [], [], "no_previous"
    (now_as_of, now_syms, now_tr), (_, prev_syms, prev_tr) = rows
    if now_tr or prev_tr:
        return now_as_of, [], [], "too_wide"
    now, prev = set(json.loads(now_syms)), set(json.loads(prev_syms))
    return now_as_of, sorted(now - prev), sorted(prev - now), None


def _phrase(names, verb, screen):
    shown = names[:MAX_NAMED]
    more = len(names) - len(shown)
    return f"{', '.join(shown)}{f' +{more} more' if more > 0 else ''} {verb} {screen}"


def run_nightly(*, deliver=None, snapshotter=None, routing=None) -> dict:
    """Snapshot every active subscription, diff it, deliver. Returns a receipt.

    ⛔ EVERY SUBSCRIPTION IS ISOLATED: one bad spec or one dead mailbox never
    costs another member their alert."""
    receipt = {"enabled": is_enabled(), "subscriptions": 0, "snapshots": 0,
               "same_session": 0, "no_previous": 0, "too_wide": 0, "quiet": 0,
               "sent": 0, "suspended_routing": 0, "skipped_dedup": 0,
               "skipped_quota": 0, "errors": 0}
    if not receipt["enabled"]:
        return receipt
    _ensure()
    if deliver is None:
        from api.services.watchlist_alert_service import deliver_alert_payload
        deliver = deliver_alert_payload
    if routing is None:
        from api.services.alert_taxonomy import routing_rule
        routing = routing_rule.effective
    with snapshot_db.connect() as conn:
        subs = conn.execute(
            "SELECT id, user_id, name, spec_json, mode FROM spec_alert_subs "
            "WHERE suspended_at IS NULL ORDER BY id").fetchall()
    receipt["subscriptions"] = len(subs)
    per_user: dict = {}
    for sub_id, user_id, name, spec_json, mode in subs:
        try:
            snap = take_snapshot(sub_id, user_id, json.loads(spec_json),
                                 snapshotter=snapshotter)
            receipt["snapshots"] += 1
            if not snap["new"]:
                receipt["same_session"] += 1
                continue
            as_of, entered, exited, reason = diff_for(sub_id)
            if reason:
                receipt[reason] += 1
                continue
            want_in = entered if mode in ("entry", "both") else []
            want_out = exited if mode in ("exit", "both") else []
            if not want_in and not want_out:
                receipt["quiet"] += 1
                continue
            with snapshot_db.connect() as conn:
                if conn.execute("SELECT 1 FROM spec_alerts_fired WHERE sub_id=? "
                                "AND as_of=?", (sub_id, as_of)).fetchone():
                    receipt["skipped_dedup"] += 1
                    continue
            if per_user.get(user_id, 0) >= MAX_PER_USER:
                receipt["skipped_quota"] += 1
                continue
            rule = routing(user_id)
            outcome = None
            if rule is not None and getattr(rule, "suspended", False):
                outcome = "suspended"
                receipt["suspended_routing"] += 1
            else:
                parts = []
                if want_in:
                    parts.append(_phrase(want_in, "entered", name))
                if want_out:
                    parts.append(_phrase(want_out, "left", name))
                deliver(
                    user_id=str(user_id), sym=(want_in or want_out)[0],
                    title=f"{name}: {len(want_in)} in, {len(want_out)} out",
                    # ⚠️ "Overnight": the snapshot is the 03:00 build.
                    message="Overnight change in your screen -- " + "; ".join(parts) + ".",
                    source="spec_screen_alert",
                    extra_data={"spec_alert_id": sub_id, "as_of": as_of,
                                "entered": want_in, "exited": want_out},
                    **({"channels_allowed": rule.channels_allowed()} if rule is not None else {}),
                )
                receipt["sent"] += 1
                per_user[user_id] = per_user.get(user_id, 0) + 1
            with snapshot_db.connect() as conn:
                conn.execute(
                    "INSERT OR IGNORE INTO spec_alerts_fired (sub_id, as_of, fired_at, "
                    "entered, exited, routing) VALUES (?,?,?,?,?,?)",
                    (sub_id, as_of, int(time.time()), len(want_in), len(want_out), outcome))
        except Exception:  # noqa: BLE001 -- one subscription never stops the run
            receipt["errors"] += 1
            log.warning("[spec-alerts] subscription %s failed", sub_id, exc_info=True)
    log.info("[spec-alerts] %s", receipt)
    return receipt
