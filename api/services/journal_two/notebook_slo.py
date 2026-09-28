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

⛔⛔ A STALL IS THE OUTAGE THE RATE CANNOT SEE (re-review D.1, controller ruling,
fix round 2). The autosave retries every no-status or >= 500 failure FOREVER, so
a 5xx outage confined to the save door produces streaks that begin and never
give up: no final failure, successes simply stop, and the rate reads OK (or
INSUFFICIENT) for the whole outage. `/api/health` stays 200 and the nav smoke
makes no note-API call, so nothing else sees it either. So each `retrying: true`
row is counted as one streak that BEGAN, and save success reads STALL when, in
the last STALL_WINDOW_HOURS, at least STALL_MIN_STREAKS streaks began AND they
outnumber the saves that landed. A stall outranks OK and INSUFFICIENT (never a
breach), and pages through the breach's own discipline — a stall and a breach
are ONE incident, so moving between them never pages twice. ⛔ The incident ends
only on evidence: an OK reading while the streaks that began in the hour still
outnumber the saves that landed is NOT a recovery, so a slow outage whose hourly
count dips under the threshold is held rather than re-paged every half hour.
⛔ A streak whose reason is the OFFLINE word — the browser itself reported no
connection — is the member's network, not our outage (controller ruling, fix
round 3). It never counts toward a stall; it is set aside and counted as
`offline_streaks`. The word is the one the server's arrival allow-list holds
(`journal_two.SAVE_FAILED_OFFLINE_REASON`), never retyped here. `network` — a
fetch that threw, which our server dropping connections also produces — and
every 5xx still count.

⛔ A DESIGNED REFUSAL IS NOT AN INTEGRITY FAILURE (review M-5, controller ruling
2026-09-27). The server refusing a body it will not store — 413 `too-large`, and
every 400 the note write door answers (the H14 depth cap and the rest of
`NoteValidationError`, plus the withheld-placeholder echo guard; the client sends
those as `{status: 400, reason: 'http'}`, `NoteEditorPage.jsx` `reportSaveFailed`)
— is the product working as designed, and it repeats once per autosave pause. It
is excluded from the paging rate and COUNTED SEPARATELY as `refused`, so it stays
visible in the admin readout. `REFUSAL_REASONS` / `REFUSAL_STATUSES` are the list.

⛔ NEVER CONTENT. Only the `ms`, `retrying`, `reason` and `status` props are read —
the same closed props the server's arrival schema keeps (`_NOTEBOOK_PROP_SCHEMAS`).

⛔ CHEAP, ON PURPOSE (the single web pod): two COUNTs and three bounded reads per
run over `activity_log(action, created_at)` (a composite index, `auth_db._SCHEMA`),
no network unless a page is due — and ⛔ NO auth.db TRANSACTION IS EVER OPEN
ACROSS THE NETWORK CALL (review I-2): the evaluation is committed before `post()`
runs, so a slow webhook cannot hold the one writer lock every note save needs.
⛔ Because the page is sent AFTER that commit, the committed transaction also
writes an in-flight CLAIM (`page_attempt_at`, review N-2): a second run inside
the webhook window (an admin "run now" landing on a scheduled page) finds a
claim younger than PAGE_CLAIM_SECONDS and does not page. `last_paged_at` stays
the stamp of a DELIVERED page only, so a failed delivery still re-pages (I-1).
The scheduler registration is in `api/main.py` (ids `notebook_slo_check`,
`notebook_slo_digest`, pinned by `tests/test_notebook_slo.py`);
`POST /api/admin/notebook-slo/run` forces a run.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from api.services import auth_db
from api.services.alert_destination import ops_webhook as _ops_webhook
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
#: While a paging SLO stays in breach, it is re-paged at most this often...
REPAGE_HOURS = 6
#: ...and only if a final failure landed this recently (review M-4). The rate is
#: taken over the whole window, so after a fix it stays under the objective for up
#: to a day; a re-page about an incident that has already stopped is noise. The
#: FIRST page of a breach is not subject to this.
REPAGE_RECENT_FAILURE_HOURS = 1

#: The STALL (see the module docstring): over the last STALL_WINDOW_HOURS, at
#: least STALL_MIN_STREAKS retry streaks began AND they outnumber the saves that
#: landed. A blip (two streaks beside forty saves) is not one.
STALL_WINDOW_HOURS = 1
STALL_MIN_STREAKS = 3

#: A page claimed by a run in flight holds every other run back this long (N-2).
#: The webhook times out at 10 s; a claim this old belongs to a run that died.
PAGE_CLAIM_SECONDS = 60

#: The digest names a spike of designed refusals at this many in the window
#: (re-review D.2). ⛔ NEVER a page: a refusal is the server enforcing a limit,
#: and the one blind spot is a limit set wrong, which a person reads, not a pager.
REFUSED_SPIKE_MIN = 20

#: Designed refusals (see the module docstring): excluded from the paging rate,
#: counted as `refused`. A 413 always arrives as `too-large`; the list carries both
#: spellings so neither door can slip through the other's.
REFUSAL_REASONS = frozenset({"too-large"})
REFUSAL_STATUSES = frozenset({400, 413})

#: What `post` answers when the page reached somebody: the webhook, or — with no
#: webhook configured (a sandbox) — the logged WARNING. Anything else is a failed
#: delivery: recorded as failed, `last_paged_at` untouched, the next run pages again.
DELIVERED = frozenset({"discord", "log"})

_MAX_MS_ROWS = 20_000

#: The one COUNT the SLO runs. A constant so the index rail can EXPLAIN this exact
#: statement rather than a copy of it.
_COUNT_SQL = "SELECT COUNT(*) FROM activity_log WHERE action = ? AND created_at >= ?"

OK, BREACH, STALL, INSUFFICIENT = "ok", "breach", "stall", "insufficient"
#: The states that page (a paging SLO's). One incident may move between them.
_PAGING_STATES = frozenset({BREACH, STALL})

_SCHEMA = """
CREATE TABLE IF NOT EXISTS notebook_slo_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL,
    kind         TEXT NOT NULL,          -- 'evaluation' | 'page' | 'page_failed' | 'digest'
    slo          TEXT,                   -- save_success | ask_latency | search_latency | NULL (digest)
    state        TEXT,                   -- ok | breach | stall | insufficient
    value        REAL,
    objective    REAL,
    n            INTEGER,
    window_hours INTEGER,
    delivered    TEXT,                   -- 'discord' | 'log' | 'none' | 'failed'
    detail       TEXT
);
CREATE INDEX IF NOT EXISTS idx_notebook_slo_events_created ON notebook_slo_events(created_at);
CREATE TABLE IF NOT EXISTS notebook_slo_state (
    slo              TEXT PRIMARY KEY,
    state            TEXT NOT NULL,
    since            TEXT NOT NULL,
    last_paged_at    TEXT,                -- a DELIVERED page only (I-1)
    page_attempt_at  TEXT                 -- the in-flight claim (N-2)
);
"""


def _ensure(conn) -> None:
    conn.executescript(_SCHEMA)
    # A table made by fix round 1 has no claim column, and `CREATE ... IF NOT
    # EXISTS` never adds one: without this every run would raise inside the
    # scheduler's catch-all and the pager would be silently dead.
    cols = {r[1] for r in conn.execute("PRAGMA table_info(notebook_slo_state)").fetchall()}
    if "page_attempt_at" not in cols:
        conn.execute("ALTER TABLE notebook_slo_state ADD COLUMN page_attempt_at TEXT")
        conn.commit()


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _since(now: datetime, hours: int) -> str:
    # activity_log.created_at is SQLite's `datetime('now')` shape: UTC, no zone.
    return _iso(now - timedelta(hours=hours))


def _count(conn, action: str, since: str) -> int:
    return int(conn.execute(_COUNT_SQL, (action, since)).fetchone()[0])


def _rows(conn, action: str, since: str) -> list:
    return conn.execute(
        "SELECT created_at, details FROM activity_log WHERE action = ? AND created_at >= ?"
        " ORDER BY created_at DESC LIMIT ?", (action, since, _MAX_MS_ROWS)).fetchall()


def _details(conn, action: str, since: str) -> list:
    return [r[1] for r in _rows(conn, action, since)]


def _props(d) -> dict:
    try:
        p = json.loads(d or "{}")
    except (TypeError, ValueError):
        p = {}
    return p if isinstance(p, dict) else {}


def _is_designed_refusal(p: dict) -> bool:
    if p.get("reason") in REFUSAL_REASONS:
        return True
    try:
        status = int(float(p.get("status")))
    except (TypeError, ValueError):
        return False
    return status in REFUSAL_STATUSES


def _classify_failures(rows: list) -> tuple[int, int, Optional[str]]:
    """(final failures, designed refusals, newest final failure's created_at)."""
    failed = refused = 0
    last: Optional[str] = None
    for created_at, d in rows:
        p = _props(d)
        # A streak that BEGAN is not a failure (it may recover into a save_success);
        # a fork (409) is the designed resolution, not a lost save.
        if p.get("retrying") is True or p.get("reason") == "conflict":
            continue
        if _is_designed_refusal(p):
            refused += 1
            continue
        # Everything else that gave up — including a row whose props could not be
        # read — counts.
        failed += 1
        stamp = str(created_at) if created_at is not None else None
        if stamp and (last is None or stamp > last):
            last = stamp
    return failed, refused, last


def _offline_reason() -> str:
    """The `save_failed` reason a row carries when the BROWSER reported no
    connection. Read from beside the server's arrival allow-list, never retyped
    here — the same lazy read `notebook_soak._enum_values` makes of that dict."""
    from api.routers.journal_two import SAVE_FAILED_OFFLINE_REASON
    return SAVE_FAILED_OFFLINE_REASON


def _streaks_begun(rows: list, since: str) -> tuple[int, Optional[str], int]:
    """(retry streaks that BEGAN at or after `since` and count toward a stall, the
    newest such one's created_at, offline streaks set aside).
    Every `save_failed` row with `retrying: true` is one streak that began — the
    client reports a streak once, when it starts, and never again while it retries.
    ⛔ An offline streak (the browser reported no connection) is the member's
    network, not our outage: set aside, never counted toward a stall. `network`
    and every 5xx still count."""
    offline_word = _offline_reason()
    n = offline = 0
    last: Optional[str] = None
    for created_at, d in rows:
        stamp = str(created_at) if created_at is not None else ""
        p = _props(d)
        if not stamp or stamp < since or p.get("retrying") is not True:
            continue
        if p.get("reason") == offline_word:
            offline += 1
            continue
        n += 1
        if last is None or stamp > last:
            last = stamp
    return n, last, offline


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
        stall_since = _since(now, STALL_WINDOW_HOURS)
        ok_n = _count(conn, "j2:save_success", since)
        fail_rows = _rows(conn, "j2:save_failed", since)
        failed, refused, last_failure_at = _classify_failures(fail_rows)
        streaks, last_streak_at, offline_streaks = _streaks_begun(fail_rows, stall_since)
        landed = _count(conn, "j2:save_success", stall_since)
        attempts = ok_n + failed
        rate = (ok_n / attempts) if attempts else None
        if attempts < SAVE_SUCCESS_MIN_ATTEMPTS or rate is None:
            save_state = INSUFFICIENT
        else:
            save_state = BREACH if rate < SAVE_SUCCESS_OBJECTIVE else OK
        # ⛔ D.1: saves are retrying, not landing. Outranks OK and INSUFFICIENT
        # (the two readings a save-door outage produces); a breach keeps its name.
        if save_state != BREACH and streaks >= STALL_MIN_STREAKS and streaks > landed:
            save_state = STALL
        return {
            "evaluated_at": _iso(now),
            "window_hours": window_hours,
            "slos": {
                "save_success": {"state": save_state, "value": rate, "objective": SAVE_SUCCESS_OBJECTIVE,
                                 "n": attempts, "succeeded": ok_n, "failed": failed,
                                 "refused": refused, "last_failure_at": last_failure_at,
                                 "min_n": SAVE_SUCCESS_MIN_ATTEMPTS,
                                 "stall": {"streaks": streaks, "succeeded": landed,
                                           "offline_streaks": offline_streaks,
                                           "window_hours": STALL_WINDOW_HOURS,
                                           "min_streaks": STALL_MIN_STREAKS,
                                           "last_streak_at": last_streak_at}},
                "ask_latency": _latency(conn, "ask_used", since, ASK_P95_MS_OBJECTIVE, ASK_MIN_SAMPLES),
                "search_latency": _latency(conn, "search_used", since, SEARCH_P95_MS_OBJECTIVE,
                                           SEARCH_MIN_SAMPLES),
            },
        }
    finally:
        if owned:
            conn.close()


def _post_discord(text: str) -> str:
    """'discord' when posted, 'log' when no webhook is configured, 'failed' on error.

    ⛔ The destination comes from `alert_destination.ops_webhook()`, the ONE reader of the
    ops channel (TERM-011), never a literal environment read: with DISCORD_OPS_WEBHOOK_URL
    unset -- production today -- it resolves to the admin channel every other operator page
    uses, and `tests/test_alert_destination.py` pins the modules still reading the literal to
    an exact roster, which a new literal reader here would break. It cannot raise."""
    webhook = (_ops_webhook() or "").strip()
    if not webhook:
        logger.warning("[notebook-slo] PAGE (no ops webhook configured, logged only): %s", text)
        return "log"
    try:
        import httpx
        r = httpx.post(webhook, json={"content": text[:1900]}, timeout=10)
        return "discord" if r.status_code < 300 else "failed"
    except Exception as e:  # noqa: BLE001 — a pager outage must not raise into the job
        logger.warning("[notebook-slo] page delivery failed: %s: %s", type(e).__name__, e)
        return "failed"


def _page_text(slo: str, r: dict[str, Any], window_hours: int) -> str:
    if r["state"] == STALL:
        st = r["stall"]
        rate = "n/a" if r["value"] is None else f"{r['value']:.4f}"
        return (f"🔴 **Notebook save STALL — {slo}**: {st['streaks']} save retry streaks began in "
                f"the last {st['window_hours']} h and {st['succeeded']} saves landed. Members' "
                f"saves are retrying, not landing (a stall is >= {st['min_streaks']} streaks that "
                f"outnumber the saves). The {window_hours} h rate reads {rate} because a retry is "
                f"not a give-up. Read /api/admin/notebook-slo.")
    return (f"🔴 **Notebook SLO breach — {slo}**: {r['value']:.4f} vs objective "
            f">= {r['objective']} over {r['n']} final save outcomes in {window_hours} h "
            f"({r.get('failed', 0)} gave up). Read /api/admin/notebook-slo.")


def _failed_recently(r: dict[str, Any], now: datetime) -> bool:
    """M-4's recency, per state: a breach is still live if a save GAVE UP in the
    last hour; a stall if a retry streak BEGAN in it."""
    last = (r.get("stall") or {}).get("last_streak_at") if r["state"] == STALL else r.get("last_failure_at")
    return bool(last) and str(last) >= _iso(now - timedelta(hours=REPAGE_RECENT_FAILURE_HOURS))


def _recovered(r: dict[str, Any]) -> bool:
    """Is an OK reading EVIDENCE that the incident ended? For save success, only
    when the saves that landed in the stall window have caught up with the retry
    streaks that began in it; an hour where streaks still outnumber them is saves
    that have not landed, however the rate reads. Other SLOs: any OK is recovery.

    ⛔ THE HOLD HAS ONE VISIBLE SIDE EFFECT, RATIFIED (controller, fix round 3): while
    it holds, the run's EVALUATION row reads `ok` (the reading) and the STATE row
    still reads `stall` (the incident). The two answer different questions — what
    this hour measured, and whether the outage has been shown to be over — so a
    reader who sees them disagree is looking at a held incident, not a defect."""
    st = r.get("stall")
    return st is None or st["succeeded"] >= st["streaks"]


def _record_evaluation(conn, result: dict[str, Any], now: datetime) -> list:
    """Write one evaluation row per SLO, move the incident state, and CLAIM each
    page that is due. Returns the paging SLOs whose page this run sends. Opens a
    transaction; the CALLER commits it — before any network call (I-2) — which is
    also what makes the claim visible to a second run while this one posts (N-2)."""
    stamp = result["evaluated_at"]
    claim_floor = _iso(now - timedelta(seconds=PAGE_CLAIM_SECONDS))
    due = []
    for slo, r in result["slos"].items():
        conn.execute(
            "INSERT INTO notebook_slo_events (created_at, kind, slo, state, value, objective, n,"
            " window_hours, delivered, detail) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (stamp, "evaluation", slo, r["state"], r["value"], r["objective"], r["n"],
             result["window_hours"], "none", None))
        prev = conn.execute("SELECT state, last_paged_at, page_attempt_at FROM notebook_slo_state"
                            " WHERE slo = ?", (slo,)).fetchone()
        if r["state"] not in _PAGING_STATES:
            # Only an OK that is EVIDENCE of recovery ends an incident (see
            # `_recovered`); INSUFFICIENT is no verdict and moves nothing. While the
            # hold lasts, the evaluation row above says `ok` and the state row still
            # says `stall` — the ratified side effect `_recovered` names.
            if r["state"] == OK and _recovered(r):
                conn.execute(
                    "INSERT INTO notebook_slo_state (slo, state, since, last_paged_at) VALUES (?,?,?,NULL)"
                    " ON CONFLICT(slo) DO UPDATE SET state = excluded.state, since = excluded.since,"
                    " last_paged_at = NULL, page_attempt_at = NULL"
                    " WHERE notebook_slo_state.state != excluded.state",
                    (slo, OK, stamp))
            continue
        if slo not in PAGING_SLOS:
            continue   # ⛔ speed is reported, never paged (R-15 / D-9C3)
        # A breach and a stall are one incident: moving between them never pages twice.
        began = prev is None or prev[0] not in _PAGING_STATES
        if began:
            conn.execute(
                "INSERT INTO notebook_slo_state (slo, state, since, last_paged_at) VALUES (?,?,?,NULL)"
                " ON CONFLICT(slo) DO UPDATE SET state = excluded.state, since = excluded.since,"
                " last_paged_at = NULL",
                (slo, r["state"], stamp))
        elif prev[0] != r["state"]:
            conn.execute("UPDATE notebook_slo_state SET state = ? WHERE slo = ?", (r["state"], slo))
        last = None if began else prev[1]
        if last is None:
            pass   # the incident's first page — or a first page whose delivery failed (I-1)
        elif last <= _iso(now - timedelta(hours=REPAGE_HOURS)) and _failed_recently(r, now):
            pass   # a re-page: the interval has passed AND saves are still failing (M-4)
        else:
            continue
        claim = prev[2] if prev is not None else None
        if claim and str(claim) > claim_floor:
            # ⛔ N-2: another run claimed this page under PAGE_CLAIM_SECONDS ago and
            # may be on the network with it right now. Its outcome decides; if it
            # failed, the claim ages out and a later run pages (I-1).
            continue
        conn.execute("UPDATE notebook_slo_state SET page_attempt_at = ? WHERE slo = ?", (stamp, slo))
        due.append((slo, r))
    return due


def run_check(now: Optional[datetime] = None, conn=None, *,
              post: Optional[Callable[[str], str]] = None) -> dict[str, Any]:
    """Evaluate, record one row per SLO, and PAGE a paging SLO's breach or stall.

    An incident (breach or stall — one incident, whichever it reads) pages when it
    BEGINS, and again every REPAGE_HOURS while it lasts AND it is still live within
    REPAGE_RECENT_FAILURE_HOURS (a give-up for a breach, a streak begun for a
    stall); a recovery clears the state so the next incident pages at once. Speed
    SLOs are recorded and never reach `post`.

    ⛔ I-2: the evaluation and state rows are COMMITTED before `post()` runs, and the
    page outcome is written in its own short transaction after it — no auth.db
    transaction is ever open across the network call.
    ⛔ I-1: only a delivered page (`DELIVERED`) is a `page` row and stamps
    `last_paged_at`. A failed delivery is a `page_failed` row with
    `delivered='failed'`, `last_paged_at` stays as it was, and a later run pages.
    ⛔ N-2: the committed transaction claims the page (`page_attempt_at`); a run
    that finds a claim younger than PAGE_CLAIM_SECONDS does not page.
    """
    now = now or datetime.now(timezone.utc)
    post = post or _post_discord
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        _ensure(conn)
        result = evaluate(now, conn)
        stamp = result["evaluated_at"]
        due = _record_evaluation(conn, result, now)
        conn.commit()   # ⛔ I-2: on disk, lock released, BEFORE the network
        pages = []
        for slo, r in due:
            text = _page_text(slo, r, result["window_hours"])
            try:
                delivered = post(text)
            except Exception as e:  # noqa: BLE001 — a pager fault is a failed delivery, never a crash
                logger.warning("[notebook-slo] page delivery raised: %s: %s", type(e).__name__, e)
                delivered = "failed"
            ok = delivered in DELIVERED
            conn.execute(
                "INSERT INTO notebook_slo_events (created_at, kind, slo, state, value, objective, n,"
                " window_hours, delivered, detail) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (stamp, "page" if ok else "page_failed", slo, r["state"], r["value"], r["objective"],
                 r["n"], result["window_hours"], delivered if ok else "failed", text))
            if ok:
                conn.execute("UPDATE notebook_slo_state SET last_paged_at = ?, page_attempt_at = NULL"
                             " WHERE slo = ?", (stamp, slo))
            # A failed delivery leaves its claim to age out (PAGE_CLAIM_SECONDS).
            conn.commit()
            pages.append({"slo": slo, "delivered": delivered if ok else "failed"})
        result["pages"] = pages
        return result
    finally:
        if owned:
            conn.close()


def run_digest(now: Optional[datetime] = None, conn=None) -> dict[str, Any]:
    """The daily, NON-PAGING digest: one row naming every SLO's state, latency
    breaches included, and a named `refused spike` line when designed refusals
    reach REFUSED_SPIKE_MIN in the window (re-review D.2). It is read from
    `GET /api/admin/notebook-slo`; it never posts anywhere."""
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
            extra = f", refused={r['refused']}" if "refused" in r else ""
            lines.append(f"{slo}: {r['state'].upper()} {shown} (objective {r['objective']}, n={r['n']}{extra})")
        refused = result["slos"]["save_success"].get("refused", 0)
        if refused >= REFUSED_SPIKE_MIN:
            lines.append(f"refused spike: {refused} saves refused — check the server limits")
        text ="Notebook SLO digest, last %d h — %s" % (result["window_hours"], "; ".join(lines))
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
