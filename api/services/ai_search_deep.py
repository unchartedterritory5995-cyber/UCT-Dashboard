"""Deep Research — agentic multi-step research reports for AI Search.

The ask box answers in seconds; this answers in minutes. A member submits one
question ("full picture on CRM after the print — where's the trade over the
next month?") and a background pipeline:

  1. PLANS 2-5 sub-questions (Sonnet, strict JSON, falls back to the raw query)
  2. GATHERS: the desk's own grounding for the main question (the same pack
     machinery the ask box uses — quotes/catalysts/patterns/earnings intel/
     verdict/levels by intent), the house KB, and one finance-domain Perplexity
     sweep per sub-question
  3. SYNTHESIZES a sectioned, citation-numbered report on the Opus tier
     (owner standing rule: opus for synthesis)

Jobs are MEMBER-KEYED (they live beside threads/saved in ai_search_member.db —
a member sees only their own reports and can delete them) and the de-identified
capture log records the finished report like any other answer, so deep reports
feed dossier demand and the house brain.

Cost rails: per-user daily job cap (AI_SEARCH_DEEP_PERUSER_CAP, default 3),
global dollar cap via narrative_cost_guard surface 'ai_search_deep'
(AI_SEARCH_DEEP_COST_CAP_DAILY, default $10), every Anthropic call recorded
with record_from_response, every Perplexity call ledgered under
pplx:ai_search_deep by the wrapper. The router additionally bills 5 quota
units per report against the member's daily 40 (refunded if the job errors).

Redeploy honesty: jobs run on an in-process pool, so a mid-job deploy strands
'running' rows — reclaim_stale() marks anything running/queued past the wall
as an error ('interrupted by a deploy — resubmit'), and refunds. Reclaim runs
lazily on every list/get/submit.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import sqlite3
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

log = logging.getLogger("ai_search_deep")

_LOCK = threading.Lock()
_INIT_DONE = False
_DEEP_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ais-deep")

_STALE_WALL_SECS = 15 * 60
_MAX_SUBQ = 5
_REPORT_CAP = 16000
_QUOTA_UNITS = 5   # of the member's daily 40 — a report is ~5 asks of spend


def _peruser_cap() -> int:
    try:
        return int(os.environ.get("AI_SEARCH_DEEP_PERUSER_CAP", "3"))
    except ValueError:
        return 3


def _plan_model() -> str:
    return os.environ.get("AI_SEARCH_DEEP_PLAN_MODEL", "claude-sonnet-5").strip()


def _synth_model() -> str:
    # Opus for synthesis — owner standing rule (feedback_opus_for_synthesis).
    return os.environ.get("AI_SEARCH_DEEP_MODEL", "claude-opus-5").strip()


def _cost_cap() -> float:
    try:
        return float(os.environ.get("AI_SEARCH_DEEP_COST_CAP_DAILY", "10.0"))
    except ValueError:
        return 10.0


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
                "CREATE TABLE IF NOT EXISTS ais_deep_jobs ("
                "job_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, query TEXT, "
                "status TEXT, progress TEXT, report TEXT, citations TEXT, "
                "error TEXT, cost_usd REAL DEFAULT 0, "
                "created_at TEXT, finished_at TEXT)")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_aisdj_user ON ais_deep_jobs(user_id, created_at)")
            conn.commit()
        _INIT_DONE = True


def _reset_for_tests() -> None:
    global _INIT_DONE
    _INIT_DONE = False


def _utc_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _jobs_today(conn, uid: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) FROM ais_deep_jobs WHERE user_id=? "
        "AND substr(created_at,1,10)=? AND status != 'error'",
        (uid, _utc_day())).fetchone()
    return int(row[0] or 0)


def reclaim_stale() -> int:
    """Mark queued/running jobs past the wall as interrupted (redeploy killed
    the pool). Refunds the member's quota units. Returns rows reclaimed."""
    _ensure_init()
    n = 0
    try:
        with contextlib.closing(_connect()) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT job_id, user_id, created_at FROM ais_deep_jobs "
                "WHERE status IN ('queued','running')").fetchall()
            for r in rows:
                try:
                    age = (datetime.now(timezone.utc)
                           - datetime.fromisoformat(r["created_at"])).total_seconds()
                except Exception:
                    age = _STALE_WALL_SECS + 1
                if age > _STALE_WALL_SECS:
                    conn.execute(
                        "UPDATE ais_deep_jobs SET status='error', "
                        "error='interrupted by a deploy — resubmit', finished_at=? "
                        "WHERE job_id=?", (_now(), r["job_id"]))
                    n += 1
                    _refund_units(r["user_id"])
            conn.commit()
    except Exception:
        pass
    return n


def _refund_units(user_id) -> None:
    try:
        from api.routers import ai_search as _router
        _router._refund(user_id, _QUOTA_UNITS)
    except Exception:
        pass


def submit(user_id, query: str) -> dict:
    """Queue one report. Caps: per-user/day count + the global dollar guard.
    Returns {ok, job_id} or {ok: False, reason}."""
    q = (query or "").strip()
    if not user_id or len(q) < 8:
        return {"ok": False, "reason": "Give the researcher a real question."}
    _ensure_init()
    reclaim_stale()
    try:
        from api.services import narrative_cost_guard as guard
        if guard.spend_today_usd("ai_search_deep") >= _cost_cap():
            return {"ok": False,
                    "reason": "Deep research is cooling down for the day — try again tomorrow."}
    except Exception:
        pass
    uid = str(user_id)
    job_id = uuid.uuid4().hex
    with contextlib.closing(_connect()) as conn:
        if _jobs_today(conn, uid) >= _peruser_cap():
            return {"ok": False,
                    "reason": f"Deep research is capped at {_peruser_cap()} reports a day — "
                              "it resets at midnight UTC."}
        conn.execute(
            "INSERT INTO ais_deep_jobs (job_id, user_id, query, status, progress, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (job_id, uid, q[:2000], "queued", "queued", _now()))
        conn.commit()
    try:
        _DEEP_POOL.submit(_run_job, job_id)
    except Exception:
        _set_error(job_id, "could not start the researcher — resubmit")
        _refund_units(uid)
        return {"ok": False, "reason": "could not start the researcher — resubmit"}
    return {"ok": True, "job_id": job_id}


def list_jobs(user_id, limit: int = 20) -> list[dict]:
    if not user_id:
        return []
    _ensure_init()
    reclaim_stale()
    limit = max(1, min(50, int(limit or 20)))
    with contextlib.closing(_connect()) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT job_id, query, status, progress, error, created_at, finished_at "
            "FROM ais_deep_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
            (str(user_id), limit)).fetchall()
    return [dict(r) for r in rows]


def get_job(user_id, job_id: str) -> dict | None:
    if not user_id or not job_id:
        return None
    _ensure_init()
    with contextlib.closing(_connect()) as conn:
        conn.row_factory = sqlite3.Row
        r = conn.execute(
            "SELECT * FROM ais_deep_jobs WHERE job_id=? AND user_id=?",
            (str(job_id)[:64], str(user_id))).fetchone()
    if not r:
        return None
    out = dict(r)
    try:
        out["citations"] = json.loads(out.get("citations") or "[]")
    except ValueError:
        out["citations"] = []
    return out


def delete_job(user_id, job_id: str) -> bool:
    if not user_id or not job_id:
        return False
    _ensure_init()
    with contextlib.closing(_connect()) as conn:
        cur = conn.execute("DELETE FROM ais_deep_jobs WHERE job_id=? AND user_id=?",
                           (str(job_id)[:64], str(user_id)))
        conn.commit()
        return bool(cur.rowcount)


# ── pipeline internals (module-level so tests can monkeypatch each stage) ────

def _set_progress(job_id: str, status: str, progress: str) -> None:
    try:
        with contextlib.closing(_connect()) as conn:
            conn.execute("UPDATE ais_deep_jobs SET status=?, progress=? WHERE job_id=?",
                         (status, progress, job_id))
            conn.commit()
    except Exception:
        pass


def _set_error(job_id: str, msg: str) -> None:
    try:
        with contextlib.closing(_connect()) as conn:
            conn.execute(
                "UPDATE ais_deep_jobs SET status='error', error=?, finished_at=? WHERE job_id=?",
                (str(msg)[:300], _now(), job_id))
            conn.commit()
    except Exception:
        pass


def _anthropic_text(model: str, system: str, prompt: str, max_tokens: int,
                    timeout: float) -> str:
    from api.services.engine import _get_anthropic_client
    from api.services import narrative_cost_guard as guard
    client = _get_anthropic_client()
    if client is None:
        raise RuntimeError("anthropic client unavailable")
    resp = client.with_options(timeout=timeout).messages.create(
        model=model, max_tokens=max_tokens, system=system,
        messages=[{"role": "user", "content": prompt}])
    try:
        guard.record_from_response("ai_search_deep", model, resp)
    except Exception:
        pass
    return "".join(
        b.text for b in (resp.content or []) if getattr(b, "type", "") == "text"
    ).strip()


_PLAN_SYSTEM = (
    "You decompose a trader's research question into the sub-questions a web "
    "research sweep should answer. Reply with ONLY a JSON object: "
    '{"subquestions": ["...", ...]} — 2 to 5 sub-questions, each standalone '
    "(name the company/ticker explicitly; a sweep can't resolve pronouns), "
    "each answerable from current financial journalism. No other text."
)


def _plan(query: str) -> list[str]:
    try:
        raw = _anthropic_text(_plan_model(), _PLAN_SYSTEM, query, 500, 25)
        m = re.search(r"\{.*\}", raw, re.S)
        subs = json.loads(m.group(0))["subquestions"] if m else []
        subs = [str(s).strip() for s in subs if str(s).strip()][:_MAX_SUBQ]
        return subs or [query]
    except Exception:
        return [query]


def _desk_block(query: str) -> str:
    """The same grounding the ask box builds — packs by intent + house KB —
    lazily imported from the router (the accepted cross-module pattern here)."""
    parts: list[str] = []
    try:
        from api.routers import ai_search as _router
        ctx, _salt, meta = _router._uct_context(query)
        if ctx:
            parts.append("UCT DESK DATA (authoritative for price/regime):\n" + ctx)
        try:
            from api.services import ai_search_log
            qtype = ai_search_log.classify_question_type(query)
        except Exception:
            qtype = None
        kb = _router._brain_context(query, qtype, bool(_router._VERDICT_RE.search(query)))
        if kb:
            parts.append(kb.strip())
    except Exception:
        pass
    return "\n\n".join(parts)


def _web(subq: str) -> dict:
    from api.services import perplexity_search
    return perplexity_search.web_search(
        subq, max_tokens=600, mode="fast", domain_pack="finance",
        related=False, cost_surface="ai_search_deep") or {}


_SYNTH_SYSTEM = (
    "You are the UCT Intelligence research desk writing a DEEP RESEARCH REPORT "
    "for a serious swing trader. Write 600-1100 words in markdown: a bolded "
    "one-paragraph executive read, then '## ' sections (the setup, the "
    "fundamentals/catalysts, the risks, the trade view with concrete levels "
    "where the desk data provides them). Decisive, specific, numbers and dates "
    "throughout. Cite web-sourced claims inline as [n] using ONLY the numbered "
    "SOURCE list provided — never invent a source or a number. Desk data needs "
    "no citation; attribute it to 'UCT desk data'. Wrap every stock mention as "
    "[Name]($TICKER). If sources disagree, say so. This is research, not "
    "advice — one closing line says so plainly."
)


def _synthesize(query: str, desk: str, findings: list[dict]) -> tuple[str, list[str]]:
    citations: list[str] = []
    chunks: list[str] = []
    for f in findings:
        body = (f.get("answer") or "").strip()
        if not body:
            continue
        mapped: list[int] = []
        for c in (f.get("citations") or [])[:8]:
            url = str(c)
            if url not in citations:
                citations.append(url)
            mapped.append(citations.index(url) + 1)
        # renumber this finding's local [n] markers to the merged list
        local = f.get("citations") or []
        def _remap(m):
            i = int(m.group(1))
            if 1 <= i <= len(local):
                url = str(local[i - 1])
                if url in citations:
                    return f"[{citations.index(url) + 1}]"
            return ""
        body = re.sub(r"\[(\d{1,2})\]", _remap, body)
        chunks.append(f"SUB-QUESTION: {f.get('q')}\nFINDINGS: {body}\n"
                      f"(sources used: {mapped})")
    src_list = "\n".join(f"[{i + 1}] {u}" for i, u in enumerate(citations))
    prompt = (
        f"QUESTION:\n{query}\n\n"
        + (f"DESK CONTEXT:\n{desk}\n\n" if desk else "")
        + "WEB FINDINGS:\n" + ("\n\n".join(chunks) or "(the web sweep returned nothing usable)")
        + ("\n\nSOURCES:\n" + src_list if src_list else "")
    )
    report = _anthropic_text(_synth_model(), _SYNTH_SYSTEM, prompt[:60000], 2500, 120)
    return report[:_REPORT_CAP], citations[:20]


def _run_job(job_id: str) -> None:
    _ensure_init()
    with contextlib.closing(_connect()) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM ais_deep_jobs WHERE job_id=?", (job_id,)).fetchone()
    if not row or row["status"] not in ("queued", "running"):
        return
    query, uid = row["query"], row["user_id"]
    try:
        _set_progress(job_id, "running", "planning the research")
        subs = _plan(query)
        desk = _desk_block(query)
        findings: list[dict] = []
        for i, sq in enumerate(subs):
            _set_progress(job_id, "running", f"researching {i + 1}/{len(subs)}")
            res = _web(sq)
            findings.append({"q": sq, "answer": res.get("answer") or "",
                             "citations": res.get("citations") or []})
        _set_progress(job_id, "running", "writing the report")
        report, citations = _synthesize(query, desk, findings)
        if not report:
            raise RuntimeError("synthesis returned nothing")
        with contextlib.closing(_connect()) as conn:
            conn.execute(
                "UPDATE ais_deep_jobs SET status='done', progress='done', report=?, "
                "citations=?, finished_at=? WHERE job_id=?",
                (report, json.dumps(citations), _now(), job_id))
            conn.commit()
        # de-identified capture (same contract as every answer) — deep reports
        # are exactly the durable, demand-signaling knowledge dossiers feed on
        try:
            from api.services import ai_search_log
            ai_search_log.log(
                user_id=uid, answer_id=job_id, endpoint="deep", query=query,
                answer=report, answer_kind="ok", mode="deep", model=_synth_model(),
                citations=citations, units=_QUOTA_UNITS)
        except Exception:
            pass
    except Exception as e:
        log.warning("deep job %s failed: %s", job_id, e)
        _set_error(job_id, "the researcher hit an error — resubmit")
        _refund_units(uid)
