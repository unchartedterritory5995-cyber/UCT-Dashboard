"""AI Search per-member recollection — server-side conversation threads and
saved answers, so research survives a refresh and follows the member across
devices.

⛔ THIS IS A DIFFERENT STORE FROM ai_search_log, ON PURPOSE. The capture log is
DE-IDENTIFIED BY DESIGN (day-rotating HMAC bucket, never a user id) and feeds
the house brain; re-identifying it would break that contract. This store is the
opposite: a member-keyed, member-consented convenience — the member sees their
own history page, reads only their own rows, and can delete them. Nothing here
feeds Phase-2 memory, dossiers, or any admin analytics surface, and nothing
here is ever queried without the owning user_id in the WHERE clause.

Personal-branch answers MAY land here (they are the member's own words about
their own book, shown back only to them) — they carry personal=1 so any future
surface can keep excluding them from anything shared.

⛔ NO JOIN KEYS INTO THE CAPTURE LOG (2026-08-28 review). ais_turns stores NO
answer_id, and thread_id comes from a widget id minted SEPARATELY from the
conversation_id the capture log threads on — so joining this DB to
ai_search_log cannot re-identify logged Q&A. The ONE deliberate exception:
ais_saved keys on answer_id, because explicitly saving an answer is the
member choosing to associate that specific answer with themselves (and the id
is what makes cross-device unsave + the quality-signal join work).

Idiom mirrors ai_search_log: own SQLite at /data/ai_search_member.db (env
AI_SEARCH_MEMBER_DB_PATH), WAL, idempotent _ensure_init, best-effort writes.
"""
from __future__ import annotations

import contextlib
import json
import os
import sqlite3
import threading
from datetime import datetime, timezone

_LOCK = threading.Lock()
_INIT_DONE = False

_MAX_THREADS_PER_USER = 100
_MAX_TURNS_PER_THREAD = 20
_MAX_SAVED_PER_USER = 200
_Q_CAP = 2000
_A_CAP = 16000


def _enabled() -> bool:
    return os.environ.get("AI_SEARCH_HISTORY_ENABLED", "1").strip().lower() not in ("0", "false", "no")


def _db_path() -> str:
    return os.environ.get(
        "AI_SEARCH_MEMBER_DB_PATH",
        os.path.join(os.environ.get("DATA_DIR", "/data"), "ai_search_member.db"),
    )


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    return conn


def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with _LOCK:
        if _INIT_DONE:
            return
        try:
            d = os.path.dirname(_db_path())
            if d:
                os.makedirs(d, exist_ok=True)
        except OSError:
            pass
        with contextlib.closing(_connect()) as conn:
            for stmt in (
                "CREATE TABLE IF NOT EXISTS ais_threads ("
                "thread_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, "
                "surface TEXT, turns INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)",
                "CREATE INDEX IF NOT EXISTS idx_aist_user ON ais_threads(user_id, updated_at)",
                "CREATE TABLE IF NOT EXISTS ais_turns ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, "
                "turn_index INTEGER, q TEXT, a TEXT, citations TEXT, answer_id TEXT, "
                "personal INTEGER DEFAULT 0, created_at TEXT)",
                "CREATE INDEX IF NOT EXISTS idx_aistt_thread ON ais_turns(thread_id)",
                "CREATE TABLE IF NOT EXISTS ais_saved ("
                "user_id TEXT NOT NULL, answer_id TEXT NOT NULL, q TEXT, answer TEXT, "
                "citations TEXT, personal INTEGER DEFAULT 0, created_at TEXT, "
                "PRIMARY KEY (user_id, answer_id))",
            ):
                conn.execute(stmt)
            conn.commit()
        _INIT_DONE = True


def _reset_for_tests() -> None:
    global _INIT_DONE
    _INIT_DONE = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_turns(turns) -> list[dict]:
    out: list[dict] = []
    for i, t in enumerate((turns or [])[-_MAX_TURNS_PER_THREAD:]):
        if not isinstance(t, dict):
            continue
        q = str(t.get("q") or "").strip()[:_Q_CAP]
        a = str(t.get("a") or "").strip()[:_A_CAP]
        if not q or not a:
            continue
        cites = t.get("citations") or []
        out.append({
            "turn_index": len(out),
            "q": q, "a": a,
            # per-item length cap: uncapped citation strings let one member fill
            # the shared /data volume through this store
            "citations": json.dumps([str(c)[:300] for c in cites][:10]) if isinstance(cites, list) else "[]",
            # answer_id deliberately NOT stored on turns — it is a join key into
            # the de-identified capture log (see module docstring)
            "answer_id": None,
            "personal": 1 if t.get("personal") else 0,
        })
    return out


def save_thread(user_id, thread_id: str, turns, surface: str = "") -> dict:
    """Upsert one conversation (the widget posts the whole thread after each
    finished turn — replace semantics keep it simple and idempotent)."""
    if not _enabled() or not user_id or not thread_id:
        return {"ok": False}
    cleaned = _clean_turns(turns)
    if not cleaned:
        return {"ok": False}
    tid = str(thread_id)[:64]
    uid = str(user_id)
    title = cleaned[0]["q"][:80]
    _ensure_init()
    now = _now()
    with contextlib.closing(_connect()) as conn:
        # ownership check: a thread id belongs to its first writer, forever
        row = conn.execute("SELECT user_id FROM ais_threads WHERE thread_id=?", (tid,)).fetchone()
        if row and row[0] != uid:
            return {"ok": False}
        conn.execute(
            "INSERT INTO ais_threads (thread_id, user_id, title, surface, turns, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?) "
            "ON CONFLICT(thread_id) DO UPDATE SET title=excluded.title, "
            "surface=excluded.surface, turns=excluded.turns, updated_at=excluded.updated_at",
            (tid, uid, title, str(surface or "")[:40], len(cleaned), now, now))
        conn.execute("DELETE FROM ais_turns WHERE thread_id=?", (tid,))
        conn.executemany(
            "INSERT INTO ais_turns (thread_id, turn_index, q, a, citations, answer_id, personal, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            [(tid, t["turn_index"], t["q"], t["a"], t["citations"], t["answer_id"],
              t["personal"], now) for t in cleaned])
        # per-user cap: prune oldest threads past the ceiling (turns cascade)
        stale = conn.execute(
            "SELECT thread_id FROM ais_threads WHERE user_id=? "
            "ORDER BY updated_at DESC LIMIT -1 OFFSET ?", (uid, _MAX_THREADS_PER_USER)).fetchall()
        for (old_tid,) in stale:
            conn.execute("DELETE FROM ais_turns WHERE thread_id=?", (old_tid,))
            conn.execute("DELETE FROM ais_threads WHERE thread_id=?", (old_tid,))
        conn.commit()
    return {"ok": True, "thread_id": tid, "turns": len(cleaned)}


def list_threads(user_id, limit: int = 30) -> list[dict]:
    if not _enabled() or not user_id:
        return []
    _ensure_init()
    limit = max(1, min(100, int(limit or 30)))
    with contextlib.closing(_connect()) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT thread_id, title, surface, turns, updated_at FROM ais_threads "
            "WHERE user_id=? ORDER BY updated_at DESC LIMIT ?", (str(user_id), limit)).fetchall()
    return [dict(r) for r in rows]


def get_thread(user_id, thread_id: str) -> dict | None:
    if not _enabled() or not user_id or not thread_id:
        return None
    _ensure_init()
    with contextlib.closing(_connect()) as conn:
        conn.row_factory = sqlite3.Row
        head = conn.execute(
            "SELECT thread_id, title, surface, turns, created_at, updated_at "
            "FROM ais_threads WHERE thread_id=? AND user_id=?",
            (str(thread_id)[:64], str(user_id))).fetchone()
        if not head:
            return None
        turns = conn.execute(
            "SELECT turn_index, q, a, citations, answer_id, personal FROM ais_turns "
            "WHERE thread_id=? ORDER BY turn_index", (head["thread_id"],)).fetchall()
    out = dict(head)
    out["turns"] = [
        {**dict(t), "citations": json.loads(t["citations"] or "[]")} for t in turns
    ]
    return out


def delete_thread(user_id, thread_id: str) -> bool:
    if not _enabled() or not user_id or not thread_id:
        return False
    _ensure_init()
    with contextlib.closing(_connect()) as conn:
        cur = conn.execute("DELETE FROM ais_threads WHERE thread_id=? AND user_id=?",
                           (str(thread_id)[:64], str(user_id)))
        if cur.rowcount:
            conn.execute("DELETE FROM ais_turns WHERE thread_id=?", (str(thread_id)[:64],))
        conn.commit()
        return bool(cur.rowcount)


def save_answer(user_id, item: dict) -> bool:
    if not _enabled() or not user_id or not isinstance(item, dict):
        return False
    aid = str(item.get("answer_id") or "").strip()[:64]
    q = str(item.get("q") or "").strip()[:_Q_CAP]
    a = str(item.get("answer") or "").strip()[:_A_CAP]
    if not aid or not a:
        return False
    cites = item.get("citations") or []
    _ensure_init()
    uid = str(user_id)
    with contextlib.closing(_connect()) as conn:
        # Same-question rows collapse: the widget's saved list is keyed by the
        # question, so two answer_ids for one q would render duplicates that
        # resurrect after a single delete (2026-08-28 review).
        conn.execute("DELETE FROM ais_saved WHERE user_id=? AND q=? AND answer_id<>?",
                     (uid, q, aid))
        conn.execute(
            "INSERT INTO ais_saved (user_id, answer_id, q, answer, citations, personal, created_at) "
            "VALUES (?,?,?,?,?,?,?) "
            "ON CONFLICT(user_id, answer_id) DO UPDATE SET q=excluded.q, "
            "answer=excluded.answer, citations=excluded.citations",
            (uid, aid, q, a,
             json.dumps([str(c)[:300] for c in cites][:10]) if isinstance(cites, list) else "[]",
             1 if item.get("personal") else 0, _now()))
        stale = conn.execute(
            "SELECT answer_id FROM ais_saved WHERE user_id=? "
            "ORDER BY created_at DESC LIMIT -1 OFFSET ?", (uid, _MAX_SAVED_PER_USER)).fetchall()
        for (old,) in stale:
            conn.execute("DELETE FROM ais_saved WHERE user_id=? AND answer_id=?", (uid, old))
        conn.commit()
    return True


def list_saved(user_id, limit: int = 100) -> list[dict]:
    if not _enabled() or not user_id:
        return []
    _ensure_init()
    limit = max(1, min(_MAX_SAVED_PER_USER, int(limit or 100)))
    with contextlib.closing(_connect()) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT answer_id, q, answer, citations, personal, created_at FROM ais_saved "
            "WHERE user_id=? ORDER BY created_at DESC LIMIT ?", (str(user_id), limit)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["citations"] = json.loads(d.get("citations") or "[]")
        except ValueError:
            d["citations"] = []
        out.append(d)
    return out


def delete_saved(user_id, answer_id: str) -> bool:
    if not _enabled() or not user_id or not answer_id:
        return False
    _ensure_init()
    with contextlib.closing(_connect()) as conn:
        cur = conn.execute("DELETE FROM ais_saved WHERE user_id=? AND answer_id=?",
                           (str(user_id), str(answer_id)[:64]))
        conn.commit()
        return bool(cur.rowcount)
