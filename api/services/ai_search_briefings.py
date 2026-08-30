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

# premarket/postmarket = daily text briefs; weekly_deep = a Sunday Deep
# Research report submitted on the member's behalf (capped separately — a
# deep report costs ~50x a text brief).
_CADENCES = ("premarket", "postmarket", "weekly_deep")
_DAILY_CADENCES = ("premarket", "postmarket")


def _weekly_deep_cap() -> int:
    try:
        return int(os.environ.get("AI_SEARCH_WEEKLY_DEEP_PERUSER_CAP", "1"))
    except ValueError:
        return 1
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
        return {"ok": False,
                "reason": "cadence must be premarket, postmarket or weekly_deep"}
    _ensure_init()
    uid = str(user_id)
    s = (str(sym).upper().strip()[:8] if sym else None)
    with _LOCK, contextlib.closing(_connect()) as conn:
        if cadence == "weekly_deep":
            n = conn.execute(
                "SELECT COUNT(*) FROM ais_briefings WHERE user_id=? AND enabled=1 "
                "AND cadence='weekly_deep'", (uid,)).fetchone()[0]
            if int(n or 0) >= _weekly_deep_cap():
                return {"ok": False,
                        "reason": f"Weekly deep reports are capped at {_weekly_deep_cap()} — "
                                  "pause one first."}
        else:
            n = conn.execute(
                "SELECT COUNT(*) FROM ais_briefings WHERE user_id=? AND enabled=1 "
                "AND cadence IN ('premarket','postmarket')", (uid,)).fetchone()[0]
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
            row = conn.execute(
                "SELECT cadence FROM ais_briefings WHERE briefing_id=? AND user_id=?",
                (str(briefing_id)[:64], str(user_id))).fetchone()
            cad = (row[0] if row else None) or "premarket"
            if cad == "weekly_deep":
                n = conn.execute(
                    "SELECT COUNT(*) FROM ais_briefings WHERE user_id=? AND enabled=1 "
                    "AND cadence='weekly_deep' AND briefing_id != ?",
                    (str(user_id), str(briefing_id)[:64])).fetchone()[0]
                cap, label = _weekly_deep_cap(), "Weekly deep reports"
            else:
                n = conn.execute(
                    "SELECT COUNT(*) FROM ais_briefings WHERE user_id=? AND enabled=1 "
                    "AND cadence IN ('premarket','postmarket') AND briefing_id != ?",
                    (str(user_id), str(briefing_id)[:64])).fetchone()[0]
                cap, label = _peruser_cap(), "Briefings"
            if int(n or 0) >= cap:
                return {"ok": False,
                        "reason": f"{label} are capped at {cap} — pause one first."}
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
        # 1400, not 700 (2026-08-29): a standing brief is the ONLY thing a member
        # reads that morning — it was capped at ~500 words. Below the interactive
        # 1800 because a brief should still be a brief.
        query, max_tokens=1400, system=system, mode="fast", domain_pack="finance",
        recency="day", related=False, cache_salt=salt,
        cost_surface="ai_search_brief") or {}
    res["_meta"] = meta
    return res


def run_due(cadence: str) -> dict:
    """Answer + deliver every enabled briefing of `cadence`. Called by the
    scheduler (weekdays only via its CronTrigger). Per-briefing isolation —
    one bad name never blocks the pass."""
    if cadence not in _DAILY_CADENCES:
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


_WEEKLY_RUN_CAP = 100
_MAX_INFLIGHT_DEEP = 2
_weekly_paid_memo: dict = {}


def _weekly_pass_budget_secs() -> int:
    try:
        return int(os.environ.get("AI_SEARCH_WEEKLY_DEEP_PASS_BUDGET_SECS", "10800"))
    except ValueError:
        return 10800


def run_weekly_deep() -> dict:
    """Sunday pass: submit one Deep Research job per enabled weekly_deep
    briefing (source='scheduled' — no router units, no interactive-slot
    consumption; delivery happens on completion from the deep job runner).
    PACED: at most _MAX_INFLIGHT_DEEP scheduled jobs queued/running at once,
    so a batch never breaches the deep pool's queued wall and reclaims its own
    tail; the deep lane's own dollar cap re-checks inside every submit()."""
    import time as _time
    _ensure_init()
    from api.services import ai_search_deep
    ai_search_deep._ensure_init()   # pacing query reads ais_deep_jobs pre-submit
    # sweep corpses first — a crashed pod's stuck queued/running scheduled rows
    # would otherwise count as "in flight" and wedge the pacing loop all pass
    try:
        ai_search_deep.reclaim_stale()
    except Exception:
        pass
    with contextlib.closing(_connect()) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM ais_briefings WHERE cadence='weekly_deep' AND enabled=1 "
            "ORDER BY last_run_at IS NOT NULL, last_run_at ASC LIMIT ?",
            (_WEEKLY_RUN_CAP,)).fetchall()
    ran = submitted = 0
    deadline = _time.monotonic() + _weekly_pass_budget_secs()
    for r in rows:
        if _time.monotonic() > deadline:
            # whole-pass time budget: unprocessed rows keep their last_run_at,
            # so next Sunday's LRU sort puts them FIRST
            log.warning("weekly deep: pass budget spent after %d rows", ran)
            break
        ran += 1
        status = "error"
        try:
            uid = r["user_id"]
            if uid not in _weekly_paid_memo:
                _weekly_paid_memo[uid] = _member_is_paid(uid)
            if not _weekly_paid_memo[uid]:
                status = "skipped: unpaid"
                raise _Skip()
            for _ in range(60):   # pacing: ~10 min of 10s waits per slot max
                with contextlib.closing(_connect()) as conn:
                    inflight = conn.execute(
                        "SELECT COUNT(*) FROM ais_deep_jobs "
                        "WHERE COALESCE(source,'interactive')='scheduled' "
                        "AND status IN ('queued','running')").fetchone()[0]
                if int(inflight or 0) < _MAX_INFLIGHT_DEEP:
                    break
                _sleep(10)
            q = r["query"]
            # weekend honesty — desk quotes/regime are Friday's close (R13)
            q += ("\n(Note: markets are closed; desk quotes and regime are as "
                  "of Friday's close — date figures accordingly.)")
            out = ai_search_deep.submit(uid, q, source="scheduled")
            if out.get("ok"):
                submitted += 1
                status = "submitted"
            else:
                status = f"skipped: {str(out.get('reason'))[:50]}"
        except _Skip:
            pass
        except Exception as e:
            log.warning("weekly deep %s failed: %s", r["briefing_id"], e)
            status = "error"
        # A resource-denial skip (dollar cap / scheduled budget / pool wall)
        # must NOT advance last_run_at: the LRU sort is the anti-starvation
        # rail, and stamping a cap-skip replays the identical order — and the
        # identical skipped tail — every Sunday (2026-08-28 review). Row-level
        # outcomes (submitted / error / unpaid) do stamp so cheap skips don't
        # crowd the head of the rotation.
        advance = status in ("submitted", "error", "skipped: unpaid")
        try:
            with contextlib.closing(_connect()) as conn:
                if advance:
                    conn.execute(
                        "UPDATE ais_briefings SET last_run_at=?, last_status=? WHERE briefing_id=?",
                        (_now(), status[:80], r["briefing_id"]))
                else:
                    conn.execute(
                        "UPDATE ais_briefings SET last_status=? WHERE briefing_id=?",
                        (status[:80], r["briefing_id"]))
                conn.commit()
        except Exception:
            pass
    _weekly_paid_memo.clear()
    log.info("weekly deep: ran=%d submitted=%d", ran, submitted)
    return {"ok": True, "ran": ran, "submitted": submitted}


def _sleep(secs: float) -> None:
    import time
    time.sleep(secs)
