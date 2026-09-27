"""Notebook SLOs and their alerts (wave 10, lane 10D — clause 15c, ruling R-15).

THREE service-level objectives, read from the Notebook telemetry the client already
sends (`POST /api/j2/telemetry` -> `activity_log`, action `j2:<event>`):

  * SAVE SUCCESS  — `save_success` / (`save_success` + final `save_failed`) over a
                    rolling window. An INTEGRITY signal: a breach PAGES.
  * ASK LATENCY   — p95 of `ask_used.ms`.    A SPEED signal: never paged.
  * SEARCH LATENCY — p95 of `search_used.ms`. A SPEED signal: never paged.

⛔⛔ R-15 / D-9C3: "page only on data-integrity signals; speed is reported, never
paged." That split is not a threshold choice, it is the ROUTING, and it is railed:
a latency breach writes a row and lands in the daily digest; only a save-success
breach reaches the pager (`DISCORD_WEBHOOK_URL`, the admin channel every other
operator page in this app uses). With the webhook blank (a sandbox), the page is a
logged WARNING and the row says `delivered='log'` — never a silent success.

⭐ THE OBJECTIVES ARE THIS LANE'S CHOICE, STATED AS ONE. Neither the plan nor the
soak runbook fixes a number (the soak doc records "no save-success event exists").
They are set so a HEALTHY product reads OK and a real regression reads BREACH:
  * save success >= 99.5% of final outcomes, over >= 20 attempts in 24 h;
  * Ask p95 <= 30 s (a streamed LLM answer; perf-budgets.json gives Ask no budget);
  * search p95 <= 1,000 ms FIELD time (browser -> server -> rendered list; the
    100 ms line in perf-budgets.json is the SERVER's, at 50k, on a local box, and a
    field reading that includes the network would breach it by construction).
An owner ruling that moves one is a one-line change here; the rails read these
constants, never retype them.

⛔ WHAT COUNTS AS A FAILED SAVE. `save_failed` fires once when a save GIVES UP
(`retrying: false`) and once when a retry streak BEGINS (`retrying: true`); a streak
that recovers ends in a `save_success`. So only the give-ups are failures, and a
409 that forked (`reason: 'conflict'`) is excluded: the fork is the designed
resolution that preserves both copies, counted by `conflict_forked` on its own.

⛔ NEVER CONTENT. Only the `ms`, `retrying` and `reason` props are read — the same
closed-enum props the server's arrival schema keeps (`_NOTEBOOK_PROP_SCHEMAS`).

⛔ CHEAP, ON PURPOSE (the single web pod): two indexed COUNTs and two bounded
reads per run (`activity_log` has indexes on `action` and `created_at`), no
network unless a page is due. The scheduler registration is `api/main.py`'s
(the controller's wiring); `POST /api/admin/notebook-slo/run` forces a run.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from api.services import auth_db
from api.services.journal_two.notebook_telemetry import ms_of, percentile

logger = logging.getLogger(__name__)

WINDOW_HOURS = 24

SAVE_SUCCESS_OBJECTIVE = 0.995
SAVE_SUCCESS_MIN_ATTEMPTS = 20
ASK_P95_MS_OBJECTIVE = 30_000
ASK_MIN_SAMPLES = 5
SEARCH_P95_MS_OBJECTIVE = 1_000
SEARCH_MIN_SAMPLES = 20

#: Which SLOs may reach the pager. ⛔ ONE ENTRY, and railed: speed never pages.
PAGING_SLOS = frozenset({"save_success"})
#: While a paging SLO stays in breach, it is re-paged at most this often.
REPAGE_HOURS = 6

_MAX_MS_ROWS = 20_000

OK, BREACH, INSUFFICIENT = "ok", "breach", "insufficient"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS notebook_slo_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL,
    kind         TEXT NOT NULL,          -- 'evaluation' | 'page' | 'digest'
    slo          TEXT,                   -- save_success | ask_latency | search_latency | NULL (digest)
    state        TEXT,                   -- ok | breach | insufficient
    value        REAL,
    objective    REAL,
    n            INTEGER,
    window_hours INTEGER,
    delivered    TEXT,                   -- 'discord' | 'log' | 'none' | 'failed'
    detail       TEXT
);
CREATE INDEX IF NOT EXISTS idx_notebook_slo_events_created ON notebook_slo_events(created_at);
CREATE TABLE IF NOT EXISTS notebook_slo_state (
    slo            TEXT PRIMARY KEY,
    state          TEXT NOT NULL,
    since          TEXT NOT NULL,
    last_paged_at  TEXT
);
"""


def _ensure(conn) -> None:
    conn.executescript(_SCHEMA)


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _since(now: datetime, hours: int) -> str:
    # activity_log.created_at is SQLite's `datetime('now')` shape: UTC, no zone.
    return _iso(now - timedelta(hours=hours))


def _count(conn, action: str, since: str) -> int:
    return int(conn.execute(
        "SELECT COUNT(*) FROM activity_log WHERE action = ? AND created_at >= ?",
        (action, since)).fetchone()[0])


def _details(conn, action: str, since: str) -> list:
    return [r[0] for r in conn.execute(
        "SELECT details FROM activity_log WHERE action = ? AND created_at >= ?"
        " ORDER BY created_at DESC LIMIT ?", (action, since, _MAX_MS_ROWS)).fetchall()]


def _final_failures(details: list) -> int:
    n = 0
    for d in details:
        try:
            p = json.loads(d or "{}")
        except (TypeError, ValueError):
            p = {}
        if not isinstance(p, dict):
            p = {}
        # A streak that BEGAN is not a failure (it may recover into a save_success);
        # a fork (409) is the designed resolution, not a lost save. Everything else
        # that gave up — including a row whose props could not be read — counts.
        if p.get("retrying") is True or p.get("reason") == "conflict":
            continue
        n += 1
    return n


def _latency(conn, event: str, since: str, objective: float, min_n: int) -> dict[str, Any]:
    vals = sorted(v for v in (ms_of(d) for d in _details(conn, f"j2:{event}", since)) if v is not None)
    p95 = percentile(vals, 0.95)
    if len(vals) < min_n or p95 is None:
        state = INSUFFICIENT
    else:
        state = BREACH if p95 > objective else OK
    return {"state": state, "value": p95, "objective": objective, "n": len(vals),
            "p50": percentile(vals, 0.5), "min_n": min_n}


def evaluate(now: Optional[datetime] = None, conn=None, window_hours: int = WINDOW_HOURS) -> dict[str, Any]:
    """Read the three SLOs over the window. Pure apart from the reads: writes nothing."""
    now = now or datetime.now(timezone.utc)
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        since = _since(now, window_hours)
        ok_n = _count(conn, "j2:save_success", since)
        failed = _final_failures(_details(conn, "j2:save_failed", since))
        attempts = ok_n + failed
        rate = (ok_n / attempts) if attempts else None
        if attempts < SAVE_SUCCESS_MIN_ATTEMPTS or rate is None:
            save_state = INSUFFICIENT
        else:
            save_state = BREACH if rate < SAVE_SUCCESS_OBJECTIVE else OK
        return {
            "evaluated_at": _iso(now),
            "window_hours": window_hours,
            "slos": {
                "save_success": {"state": save_state, "value": rate, "objective": SAVE_SUCCESS_OBJECTIVE,
                                 "n": attempts, "succeeded": ok_n, "failed": failed,
                                 "min_n": SAVE_SUCCESS_MIN_ATTEMPTS},
                "ask_latency": _latency(conn, "ask_used", since, ASK_P95_MS_OBJECTIVE, ASK_MIN_SAMPLES),
                "search_latency": _latency(conn, "search_used", since, SEARCH_P95_MS_OBJECTIVE,
                                           SEARCH_MIN_SAMPLES),
            },
        }
    finally:
        if owned:
            conn.close()


def _post_discord(text: str) -> str:
    """'discord' when posted, 'log' when no webhook is configured, 'failed' on error."""
    webhook = (os.environ.get("DISCORD_WEBHOOK_URL") or "").strip()
    if not webhook:
        logger.warning("[notebook-slo] PAGE (no DISCORD_WEBHOOK_URL, logged only): %s", text)
        return "log"
    try:
        import httpx
        r = httpx.post(webhook, json={"content": text[:1900]}, timeout=10)
        return "discord" if r.status_code < 300 else "failed"
    except Exception as e:  # noqa: BLE001 — a pager outage must not raise into the job
        logger.warning("[notebook-slo] page delivery failed: %s: %s", type(e).__name__, e)
        return "failed"


def _page_text(slo: str, r: dict[str, Any], window_hours: int) -> str:
    return (f"🔴 **Notebook SLO breach — {slo}**: {r['value']:.4f} vs objective "
            f">= {r['objective']} over {r['n']} final save outcomes in {window_hours} h "
            f"({r.get('failed', 0)} gave up). Read /api/admin/notebook-slo.")


def run_check(now: Optional[datetime] = None, conn=None, *,
              post: Optional[Callable[[str], str]] = None) -> dict[str, Any]:
    """Evaluate, record one row per SLO, and PAGE a paging SLO's breach.

    A breach pages when it BEGINS, and again every REPAGE_HOURS while it lasts; a
    recovery clears the state so the next breach pages at once. Speed SLOs are
    recorded and never reach `post`.
    """
    now = now or datetime.now(timezone.utc)
    post = post or _post_discord
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        _ensure(conn)
        result = evaluate(now, conn)
        stamp = result["evaluated_at"]
        pages = []
        for slo, r in result["slos"].items():
            conn.execute(
                "INSERT INTO notebook_slo_events (created_at, kind, slo, state, value, objective, n,"
                " window_hours, delivered, detail) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (stamp, "evaluation", slo, r["state"], r["value"], r["objective"], r["n"],
                 result["window_hours"], "none", None))
            prev = conn.execute("SELECT state, last_paged_at FROM notebook_slo_state WHERE slo = ?",
                                (slo,)).fetchone()
            if r["state"] != BREACH:
                if r["state"] == OK:
                    conn.execute(
                        "INSERT INTO notebook_slo_state (slo, state, since, last_paged_at) VALUES (?,?,?,NULL)"
                        " ON CONFLICT(slo) DO UPDATE SET state = excluded.state, since = excluded.since,"
                        " last_paged_at = NULL WHERE notebook_slo_state.state != excluded.state",
                        (slo, OK, stamp))
                continue
            if slo not in PAGING_SLOS:
                continue   # ⛔ speed is reported, never paged (R-15 / D-9C3)
            last = prev[1] if prev else None
            due = (prev is None or prev[0] != BREACH or last is None
                   or last <= _iso(now - timedelta(hours=REPAGE_HOURS)))
            if prev is None or prev[0] != BREACH:
                conn.execute(
                    "INSERT INTO notebook_slo_state (slo, state, since, last_paged_at) VALUES (?,?,?,NULL)"
                    " ON CONFLICT(slo) DO UPDATE SET state = excluded.state, since = excluded.since",
                    (slo, BREACH, stamp))
            if not due:
                continue
            text = _page_text(slo, r, result["window_hours"])
            delivered = post(text)
            conn.execute("UPDATE notebook_slo_state SET last_paged_at = ? WHERE slo = ?", (stamp, slo))
            conn.execute(
                "INSERT INTO notebook_slo_events (created_at, kind, slo, state, value, objective, n,"
                " window_hours, delivered, detail) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (stamp, "page", slo, BREACH, r["value"], r["objective"], r["n"],
                 result["window_hours"], delivered, text))
            pages.append({"slo": slo, "delivered": delivered})
        conn.commit()
        result["pages"] = pages
        return result
    finally:
        if owned:
            conn.close()


def run_digest(now: Optional[datetime] = None, conn=None) -> dict[str, Any]:
    """The daily, NON-PAGING digest: one row naming every SLO's state, latency
    breaches included. It is read from `GET /api/admin/notebook-slo`; it never
    posts anywhere."""
    now = now or datetime.now(timezone.utc)
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        _ensure(conn)
        result = evaluate(now, conn)
        lines = []
        for slo, r in result["slos"].items():
            v = r["value"]
            shown = "n/a" if v is None else (f"{v:.4f}" if slo == "save_success" else f"{v:.0f} ms")
            lines.append(f"{slo}: {r['state'].upper()} {shown} (objective {r['objective']}, n={r['n']})")
        text = "Notebook SLO digest, last %d h — %s" % (result["window_hours"], "; ".join(lines))
        conn.execute(
            "INSERT INTO notebook_slo_events (created_at, kind, slo, state, value, objective, n,"
            " window_hours, delivered, detail) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (result["evaluated_at"], "digest", None, None, None, None, None,
             result["window_hours"], "none", text))
        conn.commit()
        logger.info("[notebook-slo] %s", text)
        result["digest"] = text
        return result
    finally:
        if owned:
            conn.close()


def recent_events(limit: int = 50, conn=None) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        _ensure(conn)
        rows = conn.execute(
            "SELECT created_at, kind, slo, state, value, objective, n, window_hours, delivered, detail"
            " FROM notebook_slo_events ORDER BY id DESC LIMIT ?", (int(limit),)).fetchall()
        keys = ("created_at", "kind", "slo", "state", "value", "objective", "n", "window_hours",
                "delivered", "detail")
        return [dict(zip(keys, tuple(r))) for r in rows]
    finally:
        if owned:
            conn.close()


def scheduled_check() -> None:
    """The scheduler's entry point (registered by api/main.py). Never raises."""
    try:
        run_check()
    except Exception as e:  # noqa: BLE001
        logger.warning("[notebook-slo] check failed: %s: %s", type(e).__name__, e)


def scheduled_digest() -> None:
    """The scheduler's daily digest entry point. Never raises."""
    try:
        run_digest()
    except Exception as e:  # noqa: BLE001
        logger.warning("[notebook-slo] digest failed: %s: %s", type(e).__name__, e)
