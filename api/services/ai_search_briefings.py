"""Scheduled member briefings — "brief me on CRM every morning."

A member schedules a standing question (usually born from an ask-box proposal
chip); twice a trading day a scheduler pass answers every due briefing through
the SAME grounded fast path the ask box uses (desk packs + finance-domain
Perplexity) and delivers it through the existing multi-channel alert door
(in-app bell + email + Discord, per the member's alert settings).

Member-keyed beside threads/saved/deep jobs in ai_search_member.db. Rails:
3 enabled briefings per member (env AI_SEARCH_BRIEFINGS_PERUSER_CAP), 200
briefings per scheduler pass (global), per-briefing try/except so one bad
symbol never blocks the run, and every web leg ledgers under
pplx:ai_search_brief. Answers feed the de-identified capture log
(endpoint='briefing') like any other answer — standing questions are the
strongest dossier-demand signal there is.
"""
from __future__ import annotations

import contextlib
import logging
import os
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

log = logging.getLogger("ai_search_briefings")

_LOCK = threading.Lock()
_INIT_DONE = False

_CADENCES = ("premarket", "postmarket")
_RUN_CAP = 200
_Q_CAP = 500


def _peruser_cap() -> int:
    try:
        return int(os.environ.get("AI_SEARCH_BRIEFINGS_PERUSER_CAP", "3"))
    except ValueError:
        return 3


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    from api.services import ai_search_member
    return ai_search_member._connect()


def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with _LOCK:
        if _INIT_DONE:
            return
        from api.services import ai_search_member
        ai_search_member._ensure_init()
        with contextlib.closing(_connect()) as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS ais_briefings ("
                "briefing_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, "
                "query TEXT, sym TEXT, cadence TEXT, enabled INTEGER DEFAULT 1, "
                "created_at TEXT, last_run_at TEXT, last_status TEXT)")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_aisb_user ON ais_briefings(user_id)")
            conn.commit()
        _INIT_DONE = True


def _reset_for_tests() -> None:
    global _INIT_DONE
    _INIT_DONE = False


def create(user_id, query: str, sym: str | None, cadence: str) -> dict:
    q = (query or "").strip()[:_Q_CAP]
    if not user_id or len(q) < 5:
        return {"ok": False, "reason": "Give the briefing a real question."}
    if cadence not in _CADENCES:
        return {"ok": False, "reason": "cadence must be premarket or postmarket"}
    _ensure_init()
    uid = str(user_id)
    s = (str(sym).upper().strip()[:8] if sym else None)
    with _LOCK, contextlib.closing(_connect()) as conn:
        n = conn.execute(
            "SELECT COUNT(*) FROM ais_briefings WHERE user_id=? AND enabled=1",
            (uid,)).fetchone()[0]
        if int(n or 0) >= _peruser_cap():
            return {"ok": False,
                    "reason": f"Briefings are capped at {_peruser_cap()} — pause one first."}
        dup = conn.execute(
            "SELECT 1 FROM ais_briefings WHERE user_id=? AND query=? AND cadence=? AND enabled=1",
            (uid, q, cadence)).fetchone()
        if dup:
            return {"ok": False, "reason": "That briefing already exists."}
        bid = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO ais_briefings (briefing_id, user_id, query, sym, cadence, enabled, created_at) "
            "VALUES (?,?,?,?,?,1,?)", (bid, uid, q, s, cadence, _now()))
        conn.commit()
    return {"ok": True, "briefing_id": bid}


def list_briefings(user_id) -> list[dict]:
    if not user_id:
        return []
    _ensure_init()
    with contextlib.closing(_connect()) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT briefing_id, query, sym, cadence, enabled, created_at, "
            "last_run_at, last_status FROM ais_briefings WHERE user_id=? "
            "ORDER BY created_at DESC", (str(user_id),)).fetchall()
    return [dict(r) for r in rows]


def set_enabled(user_id, briefing_id: str, enabled: bool) -> dict:
    if not user_id or not briefing_id:
        return {"ok": False}
    _ensure_init()
    with _LOCK, contextlib.closing(_connect()) as conn:
        if enabled:
            # Resume re-checks the cap create() enforces — pause→create→resume
            # was a free bypass to unlimited enabled briefings (2026-08-28).
            n = conn.execute(
                "SELECT COUNT(*) FROM ais_briefings WHERE user_id=? AND enabled=1 "
                "AND briefing_id != ?",
                (str(user_id), str(briefing_id)[:64])).fetchone()[0]
            if int(n or 0) >= _peruser_cap():
                return {"ok": False,
                        "reason": f"Briefings are capped at {_peruser_cap()} — pause one first."}
        cur = conn.execute(
            "UPDATE ais_briefings SET enabled=? WHERE briefing_id=? AND user_id=?",
            (1 if enabled else 0, str(briefing_id)[:64], str(user_id)))
        conn.commit()
        return {"ok": bool(cur.rowcount)}


def delete(user_id, briefing_id: str) -> bool:
    if not user_id or not briefing_id:
        return False
    _ensure_init()
    with contextlib.closing(_connect()) as conn:
        cur = conn.execute(
            "DELETE FROM ais_briefings WHERE briefing_id=? AND user_id=?",
            (str(briefing_id)[:64], str(user_id)))
        conn.commit()
        return bool(cur.rowcount)


# ── the scheduled pass ───────────────────────────────────────────────────────

class _Skip(Exception):
    """Control-flow sentinel: skip this briefing, stamp its status honestly."""


def _member_is_paid(uid: str) -> bool:
    """Server-resolved plan for the runner's lapse gate — module-level so
    tests can patch it (mirrors the router's _is_paid_server)."""
    try:
        from api.middleware.auth_middleware import is_paid_user
        from api.services.auth_service import get_user_plan
        return bool(is_paid_user({"user_id": uid, "id": uid, "plan": get_user_plan(uid)}))
    except Exception:
        return False


_LINK_RE = re.compile(r"\[([^\]]+)\]\(\$[A-Za-z][A-Za-z.\-]{0,6}\)")


def _plain(text: str) -> str:
    return _LINK_RE.sub(r"\1", str(text or "")).replace("**", "").strip()


def _answer_briefing(query: str) -> dict:
    """The ask box's grounded fast path, reused verbatim (lazy router import —
    the accepted cross-module pattern here)."""
    from api.routers import ai_search as _router
    from api.services import perplexity_search
    system, salt, meta = _router._grounded_system(query)
    res = perplexity_search.web_search(
        query, max_tokens=700, system=system, mode="fast", domain_pack="finance",
        recency="day", related=False, cache_salt=salt,
        cost_surface="ai_search_brief") or {}
    res["_meta"] = meta
    return res


def run_due(cadence: str) -> dict:
    """Answer + deliver every enabled briefing of `cadence`. Called by the
    scheduler (weekdays only via its CronTrigger). Per-briefing isolation —
    one bad name never blocks the pass."""
    if cadence not in _CADENCES:
        return {"ok": False, "reason": "bad cadence"}
    _ensure_init()
    # Dollar rail: the pass burns real Perplexity money — over the daily cap it
    # stops delivering rather than silently spending (2026-08-28 review).
    def _over_budget() -> bool:
        try:
            from api.services import narrative_cost_guard as guard
            cap = float(os.environ.get("AI_SEARCH_BRIEF_COST_CAP_DAILY", "5.0"))
            return guard.spend_today_usd("pplx:ai_search_brief") >= cap
        except Exception:
            return False
    if _over_budget():
        log.warning("briefings %s: over the daily dollar cap — pass skipped", cadence)
        return {"ok": False, "reason": "over budget"}
    with contextlib.closing(_connect()) as conn:
        conn.row_factory = sqlite3.Row
        # least-recently-run first (NULLs = never-run lead) so a full pass cap
        # ROTATES instead of permanently starving the newest members' briefings
        rows = conn.execute(
            "SELECT * FROM ais_briefings WHERE cadence=? AND enabled=1 "
            "ORDER BY last_run_at IS NOT NULL, last_run_at ASC LIMIT ?",
            (cadence, _RUN_CAP)).fetchall()
    ran = delivered = 0
    paid_memo: dict[str, bool] = {}
    for r in rows:
        ran += 1
        status = "error"
        try:
            # A lapsed member's standing briefing must not keep billing the
            # firm's key forever — the endpoints are paid-gated, so this is
            # the only place that can notice the lapse.
            uid = r["user_id"]
            if uid not in paid_memo:
                paid_memo[uid] = _member_is_paid(uid)
            if not paid_memo[uid]:
                status = "skipped: unpaid"
                raise _Skip()
            if ran % 25 == 0 and _over_budget():
                status = "skipped: over budget"
                raise _Skip()
            res = _answer_briefing(r["query"])
            answer = (res.get("answer") or "").strip()
            if answer and not res.get("error"):
                label = r["sym"] or (res.get("_meta", {}).get("query_tickers") or ["your markets"])[0]
                title = ("Morning brief" if cadence == "premarket" else "Closing brief")
                body = _plain(answer)[:1500]
                from api.services.watchlist_alert_service import deliver_alert_payload
                deliver_alert_payload(
                    r["user_id"], (r["sym"] or "AI"), f"{title}: {label}", body,
                    source="ai_briefing",
                    extra_data={"briefing_id": r["briefing_id"], "query": r["query"]},
                    severity="info")   # info = bell+email only, never the admin Discord
                delivered += 1
                status = "delivered"
                try:
                    from api.services import ai_search_log
                    ai_search_log.log(
                        user_id=r["user_id"], endpoint="briefing", query=r["query"],
                        answer=answer, answer_kind="ok", mode="fast",
                        model=res.get("model"), citations=res.get("citations"),
                        recency="day", units=1)
                except Exception:
                    pass
            elif res.get("error"):
                status = f"error: {str(res.get('error'))[:60]}"
            else:
                status = "empty"
        except _Skip:
            pass
        except Exception as e:
            log.warning("briefing %s failed: %s", r["briefing_id"], e)
            status = "error"
        try:
            with contextlib.closing(_connect()) as conn:
                conn.execute(
                    "UPDATE ais_briefings SET last_run_at=?, last_status=? WHERE briefing_id=?",
                    (_now(), status[:80], r["briefing_id"]))
                conn.commit()
        except Exception:
            pass
    log.info("briefings %s: ran=%d delivered=%d", cadence, ran, delivered)
    return {"ok": True, "ran": ran, "delivered": delivered}
