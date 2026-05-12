"""
Voice memory service — user facts + session summaries.

Facts: explicit user-stated preferences/aliases that persist across
sessions. Created via `remember` voice tool or Settings UI.

Summaries: auto-generated post-session recaps. Created via background
task after /api/voice/session/end.

build_memory_context() composes both into a single text block injected
into the Realtime session's `instructions` at session-token mint time.
"""

import json
from datetime import datetime, timezone
from api.services.auth_db import get_connection


MAX_MEMORY_CHARS = 2000
MAX_FACTS_INJECTED = 30
MAX_SUMMARIES_INJECTED = 5

ALLOWED_CATEGORIES = {"preference", "account_alias", "style", "fact", "general"}


# Batch 7e: pairs of opposing terms that hint at a contradiction.
_OPPOSING_TERMS = [
    ("swing", "day trade"),
    ("swing", "scalp"),
    ("long-only", "short"),
    ("only long", "only short"),
    ("aggressive", "conservative"),
    ("small cap", "large cap"),
    ("small caps", "large caps"),
    ("micro cap", "large cap"),
    ("options", "no options"),
    ("crypto", "no crypto"),
    ("manual", "automated"),
    ("morning", "afternoon"),
    ("intraday", "swing"),
]


def _detect_fact_conflicts(facts: list[dict]) -> list[dict]:
    """
    Surface pairs of facts whose texts contain opposing terms — strong signal
    that the user has updated a preference but the old fact is still injected.

    Returns a list of {fact_a, fact_b} dicts, newer fact's id higher than
    older's. Empty if no conflicts.
    """
    out: list[dict] = []
    seen_pairs: set[tuple[int, int]] = set()
    for a in facts:
        text_a = (a.get("text") or "").lower()
        if not text_a:
            continue
        for b in facts:
            if a is b:
                continue
            text_b = (b.get("text") or "").lower()
            if not text_b:
                continue
            for term_x, term_y in _OPPOSING_TERMS:
                if term_x in text_a and term_y in text_b:
                    ids = tuple(sorted([a.get("id", 0), b.get("id", 0)]))
                    if ids in seen_pairs:
                        continue
                    seen_pairs.add(ids)
                    out.append({
                        "fact_a": a.get("text"),
                        "fact_b": b.get("text"),
                        "id_a": a.get("id"),
                        "id_b": b.get("id"),
                        "opposing_terms": [term_x, term_y],
                    })
                    break
    return out


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Facts ─────────────────────────────────────────────────────────────────

def add_fact(user_id: str, *, text: str, category: str = "general") -> int:
    text = (text or "").strip()
    if not text:
        raise ValueError("text is required")
    if category not in ALLOWED_CATEGORIES:
        category = "general"
    text = text[:1000]
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO user_voice_facts (user_id, category, text, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, category, text, _now(), _now()),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def list_facts(user_id: str, *, limit: int = 100) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT id, user_id, category, text, created_at, updated_at
               FROM user_voice_facts
               WHERE user_id = ?
               ORDER BY updated_at DESC
               LIMIT ?""",
            (user_id, max(1, min(limit, 500))),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def update_fact(fact_id: int, *, text: str | None = None,
                category: str | None = None) -> None:
    if text is None and category is None:
        return
    if text is not None:
        text = text.strip()[:1000]
    if category is not None and category not in ALLOWED_CATEGORIES:
        category = "general"
    sets, vals = [], []
    if text is not None:
        sets.append("text = ?")
        vals.append(text)
    if category is not None:
        sets.append("category = ?")
        vals.append(category)
    sets.append("updated_at = ?")
    vals.append(_now())
    vals.append(fact_id)
    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE user_voice_facts SET {', '.join(sets)} WHERE id = ?",
            vals,
        )
        conn.commit()
    finally:
        conn.close()


def delete_fact(fact_id: int, *, user_id: str) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "DELETE FROM user_voice_facts WHERE id = ? AND user_id = ?",
            (fact_id, user_id),
        )
        conn.commit()
    finally:
        conn.close()


def delete_facts_matching(user_id: str, query: str) -> int:
    q = (query or "").strip()
    if not q:
        return 0
    conn = get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM user_voice_facts WHERE user_id = ? AND LOWER(text) LIKE LOWER(?)",
            (user_id, f"%{q}%"),
        )
        conn.commit()
        return cur.rowcount or 0
    finally:
        conn.close()


# ── Summaries ─────────────────────────────────────────────────────────────

def add_summary(*, session_id: int, user_id: str, summary_text: str,
                key_topics: list[str] | None = None) -> int:
    summary_text = (summary_text or "").strip()[:2000]
    if not summary_text:
        raise ValueError("summary_text is required")
    topics_json = json.dumps([t for t in (key_topics or []) if t][:20])
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO voice_session_summaries
               (session_id, user_id, summary_text, key_topics_json, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (session_id, user_id, summary_text, topics_json, _now()),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def list_summaries(user_id: str, *, limit: int = 20) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT id, session_id, user_id, summary_text, key_topics_json, created_at
               FROM voice_session_summaries
               WHERE user_id = ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (user_id, max(1, min(limit, 100))),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            try:
                d["key_topics"] = json.loads(d.pop("key_topics_json") or "[]")
            except json.JSONDecodeError:
                d["key_topics"] = []
            out.append(d)
        return out
    finally:
        conn.close()


def search_summaries(user_id: str, *, query: str, limit: int = 10) -> list[dict]:
    q = (query or "").strip()
    if not q:
        return []
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT id, session_id, user_id, summary_text, key_topics_json, created_at
               FROM voice_session_summaries
               WHERE user_id = ?
                 AND (LOWER(summary_text) LIKE LOWER(?)
                      OR LOWER(key_topics_json) LIKE LOWER(?))
               ORDER BY created_at DESC
               LIMIT ?""",
            (user_id, f"%{q}%", f"%{q}%", max(1, min(limit, 50))),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            try:
                d["key_topics"] = json.loads(d.pop("key_topics_json") or "[]")
            except json.JSONDecodeError:
                d["key_topics"] = []
            out.append(d)
        return out
    finally:
        conn.close()


# ── Memory composition ────────────────────────────────────────────────────

def build_memory_context(user_id: str) -> str:
    """
    Build a single text block to inject into Realtime session instructions.
    Combines user facts + the latest N session summaries. Capped at MAX_MEMORY_CHARS.
    """
    facts = list_facts(user_id, limit=MAX_FACTS_INJECTED)
    summaries = list_summaries(user_id, limit=MAX_SUMMARIES_INJECTED)
    try:
        from api.services.voice_feedback_service import (
            list_corrections, detect_failure_patterns,
        )
        corrections = list_corrections(user_id)
        failure_patterns = detect_failure_patterns(user_id)
    except Exception:  # noqa: BLE001
        corrections = []
        failure_patterns = []

    # Detect facts that may contradict each other so the model can ask
    # the user which is current instead of silently believing both.
    conflicts = _detect_fact_conflicts(facts)

    if not facts and not summaries and not corrections and not failure_patterns:
        return ""

    parts: list[str] = []
    if facts:
        parts.append("What you know about this user:")
        for f in facts:
            cat = f.get("category") or "general"
            txt = f.get("text") or ""
            parts.append(f"  - [{cat}] {txt}")

    if summaries:
        if parts:
            parts.append("")
        parts.append("Recent conversations with this user:")
        for s in summaries:
            topics = s.get("key_topics") or []
            topic_str = f" (topics: {', '.join(topics[:5])})" if topics else ""
            txt = s.get("summary_text") or ""
            parts.append(f"  - {txt}{topic_str}")

    # Append durable corrections (Batch 5 — feedback loop). Reuses the list
    # fetched at the top so we don't double-query.
    if corrections:
        if parts:
            parts.append("")
        parts.append("Corrections the user has previously given you (apply these going forward):")
        for c in corrections:
            txt = c.get("correction_text")
            if txt:
                parts.append(f"  - {txt}")

    # Append failure patterns (Batch 7a). Tells the model which tools have
    # been unreliable lately so it can pick alternates or ask up front.
    if failure_patterns:
        if parts:
            parts.append("")
        parts.append("Tools that have been failing for this user lately — prefer alternates or ask a clarifying question before calling:")
        for p in failure_patterns[:5]:
            pct = int(round(p["failure_rate"] * 100))
            parts.append(
                f"  - {p['tool_name']}: {pct}% failure rate "
                f"({p['failures_in_window']}/{p['total_in_window']} recent calls)"
            )

    # Append conflict warnings (Batch 7e). When two saved facts look like
    # they contradict, the model should ask which is current rather than
    # silently believing both.
    if conflicts:
        if parts:
            parts.append("")
        parts.append("Possible contradictions in remembered facts — ASK the user which is current before relying on any of these:")
        for c in conflicts[:5]:
            parts.append(f"  - {c['fact_a']!r}  vs  {c['fact_b']!r}")

    out = "\n".join(parts)
    if len(out) > MAX_MEMORY_CHARS:
        out = out[:MAX_MEMORY_CHARS].rsplit("\n", 1)[0]
    return out
