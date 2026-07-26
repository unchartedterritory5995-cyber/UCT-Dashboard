"""Deep content search across the Desk video library (education.db).

Searches title, headline, chapter TITLES (from the JSON `chapters` column) and
TRANSCRIPT text of every edu_videos row via a SQLite FTS5 table

    edu_search(video_id UNINDEXED, title, headline, chapters_text, transcript)

living in the SAME education.db. The index is rebuilt idempotently by
`rebuild_index()` (drop + recreate + repopulate — ~290 rows, fast):
  (a) lazily on the first search when the table is missing/empty (and on the
      first search of every process — education_service._search_dirty starts
      True, covering writes from a prior process),
  (b) after any library write: education_service's write functions only SET
      `_search_dirty = True`; the next search() notices and rebuilds. Writes
      NEVER rebuild synchronously — rebuild_index() acquires
      education_service._WRITE_LOCK, which is NON-reentrant and already held
      inside every writer.

FTS5 is feature-detected ONCE per process (in-memory probe). When unavailable
the same table name is created as a PLAIN table and search() falls back to a
LIKE-based scan (%/_ escaped) behind the same signature. The response carries
`"mode": "fts"|"like"` so prod can verify which engine served it.

The user's query is always treated as a LITERAL: each whitespace token is
double-quoted for the MATCH expression (internal quotes doubled), so FTS5
operators like `OR`/`NOT`/`NEAR` cannot be injected.
"""
from __future__ import annotations

import contextlib
import re
import sqlite3
from typing import Optional

from api.services import education_service as es

import json as _json

# Priority order is load-bearing: best field wins per video, and result
# ordering is title matches first, then headline, chapter, transcript.
_FIELD_PRIORITY = (
    ("title", "title"),
    ("headline", "headline"),
    ("chapter", "chapters_text"),
    ("transcript", "transcript"),
)

_SNIPPET_WIDTH = 120

_MODE: Optional[str] = None  # "fts" | "like" — detected once, cached


def _detect_mode() -> str:
    """FTS5 availability, probed ONCE per process against an in-memory DB."""
    global _MODE
    if _MODE is None:
        try:
            with contextlib.closing(sqlite3.connect(":memory:")) as c:
                c.execute("CREATE VIRTUAL TABLE __fts5_probe USING fts5(x)")
            _MODE = "fts"
        except sqlite3.OperationalError:
            _MODE = "like"
    return _MODE


def _chapter_entries(raw) -> list[dict]:
    """Parsed [{t, title}] chapter list (defensive against bad JSON)."""
    try:
        arr = _json.loads(raw) if raw else []
    except Exception:
        return []
    if not isinstance(arr, list):
        return []
    return [c for c in arr if isinstance(c, dict) and c.get("title")]


def rebuild_index() -> None:
    """Drop + recreate + repopulate edu_search from edu_videos, then clear the
    dirty flag. Idempotent. Acquires education_service._WRITE_LOCK (NON-
    reentrant) — must never be called by code already holding it."""
    global _MODE
    mode = _detect_mode()
    with es._WRITE_LOCK, contextlib.closing(es._connect()) as c:
        c.execute("DROP TABLE IF EXISTS edu_search")
        if mode == "fts":
            try:
                c.execute(
                    "CREATE VIRTUAL TABLE edu_search USING fts5("
                    "video_id UNINDEXED, title, headline, chapters_text, transcript)"
                )
            except sqlite3.OperationalError:
                # Probe said yes but this build disagrees — flip to LIKE mode.
                _MODE = mode = "like"
        if mode == "like":
            c.execute(
                "CREATE TABLE edu_search ("
                "video_id INTEGER, title TEXT, headline TEXT, "
                "chapters_text TEXT, transcript TEXT)"
            )
        rows = c.execute(
            "SELECT id, title, headline, chapters, transcript FROM edu_videos"
        ).fetchall()
        for r in rows:
            chapters_text = "\n".join(
                str(ch["title"]) for ch in _chapter_entries(r["chapters"]))
            c.execute(
                "INSERT INTO edu_search (video_id, title, headline, chapters_text, transcript) "
                "VALUES (?, ?, ?, ?, ?)",
                (r["id"], r["title"] or "", r["headline"] or "",
                 chapters_text, r["transcript"] or ""),
            )
        c.commit()
    es._search_dirty = False


def _index_ready() -> bool:
    try:
        with contextlib.closing(es._connect()) as c:
            n = c.execute("SELECT count(*) FROM edu_search").fetchone()[0]
        return int(n) > 0
    except sqlite3.OperationalError:  # table missing
        return False


def _ensure_index() -> None:
    if getattr(es, "_search_dirty", True) or not _index_ready():
        rebuild_index()


# ── Query building ───────────────────────────────────────────────────────────

def _fts_expr(col: str, tokens: list[str]) -> str:
    """Literal MATCH expression: every token double-quoted (internal quotes
    doubled) so FTS5 syntax like `a" OR b` is never interpretable, scoped to
    one column via the `col : (...)` filter. Multiple tokens = implicit AND."""
    quoted = " ".join('"' + t.replace('"', '""') + '"' for t in tokens)
    return f"{col} : ({quoted})"


def _like_escape(tok: str) -> str:
    return (tok.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_"))


def _match_ids(c: sqlite3.Connection, col: str, tokens: list[str], mode: str) -> list[int]:
    """video_ids whose `col` contains ALL tokens, in a stable order."""
    if mode == "fts":
        try:
            rows = c.execute(
                "SELECT video_id FROM edu_search WHERE edu_search MATCH ? ORDER BY rank",
                (_fts_expr(col, tokens),),
            ).fetchall()
        except sqlite3.OperationalError:
            # e.g. a token with no indexable characters ("--") — treat as no match
            return []
    else:
        conds = " AND ".join([f"lower({col}) LIKE ? ESCAPE '\\'"] * len(tokens))
        params = ["%" + _like_escape(t.lower()) + "%" for t in tokens]
        rows = c.execute(
            f"SELECT video_id FROM edu_search WHERE {conds} ORDER BY video_id",
            params,
        ).fetchall()
    return [int(r["video_id"]) for r in rows]


# ── Snippets + timestamps ────────────────────────────────────────────────────

def _snippet(text: str, qs: str, tokens: list[str]) -> str:
    """~120-char context window around the first match, matched term(s)
    wrapped in <b>…</b> (the frontend renders this safely)."""
    t = " ".join((text or "").split())
    low = t.casefold()
    idx = low.find(qs.casefold())
    if idx < 0:
        idx = -1
        for tok in tokens:
            i = low.find(tok.casefold())
            if i >= 0 and (idx < 0 or i < idx):
                idx = i
        if idx < 0:
            idx = 0
    start = max(0, idx - 40)
    end = min(len(t), start + _SNIPPET_WIDTH)
    if end - start < _SNIPPET_WIDTH:
        start = max(0, end - _SNIPPET_WIDTH)
    frag = t[start:end]
    pats = sorted({qs, *tokens}, key=len, reverse=True)
    rx = re.compile("|".join(re.escape(p) for p in pats if p), re.IGNORECASE)
    frag = rx.sub(lambda m: f"<b>{m.group(0)}</b>", frag)
    return ("…" if start > 0 else "") + frag + ("…" if end < len(t) else "")


def _first_containing(items: list[dict], key: str, qs: str, tokens: list[str]) -> Optional[dict]:
    """First item whose `key` text contains the query — ladder: whole query →
    all tokens → any token (FTS tokenization can match where a plain substring
    of the full phrase doesn't)."""
    ql = qs.casefold()
    toks = [t.casefold() for t in tokens]
    all_hit = None
    any_hit = None
    for it in items:
        txt = str(it.get(key) or "").casefold()
        if ql in txt:
            return it
        if all_hit is None and toks and all(tk in txt for tk in toks):
            all_hit = it
        if any_hit is None and any(tk in txt for tk in toks):
            any_hit = it
    return all_hit or any_hit


def _transcript_cues(raw: str) -> list[dict]:
    # Imported lazily — desk_session_insights imports education_service (avoid
    # the known circular-import trap; mirrors education_service.get_transcript_cues).
    from api.services.desk_session_insights import _parse_timestamped_block
    return _parse_timestamped_block(raw or "")


def _result_snippet_t(row: sqlite3.Row, field: str, qs: str, tokens: list[str]):
    """(snippet, t) for a matched video. t = integer seconds for chapter /
    transcript matches, None for title/headline."""
    if field == "title":
        return _snippet(row["title"] or "", qs, tokens), None
    if field == "headline":
        return _snippet(row["headline"] or "", qs, tokens), None
    if field == "chapter":
        chapters = _chapter_entries(row["chapters"])
        hit = _first_containing(chapters, "title", qs, tokens)
        if hit is not None:
            try:
                t = int(hit.get("t") or 0)
            except Exception:
                t = None
            return _snippet(str(hit["title"]), qs, tokens), t
        return _snippet("\n".join(str(ch["title"]) for ch in chapters), qs, tokens), None
    # transcript
    cues = _transcript_cues(row["transcript"])
    hit = _first_containing(cues, "text", qs, tokens)
    if hit is not None:
        try:
            t = int(hit.get("t") or 0)
        except Exception:
            t = None
        return _snippet(str(hit["text"]), qs, tokens), t
    plain = " ".join(c["text"] for c in cues) if cues else (row["transcript"] or "")
    return _snippet(plain, qs, tokens), None


# ── Public API ───────────────────────────────────────────────────────────────

def search(q: str, limit: int = 30) -> dict:
    """Deep search. One result per video (best field wins: title > headline >
    chapter > transcript), ordered title matches first, then headline, chapter,
    transcript. `limit` default 30, capped at 50. Queries under 2 chars return
    empty. Never called while holding _WRITE_LOCK (rebuild re-acquires it)."""
    mode = _detect_mode()
    qs = (q or "").strip()
    try:
        lim = int(limit)
    except (TypeError, ValueError):
        lim = 30
    lim = max(1, min(lim, 50))
    if len(qs) < 2:
        return {"results": [], "total": 0, "mode": mode}
    _ensure_index()
    mode = _detect_mode()  # rebuild may have flipped fts→like
    tokens = qs.split()

    matched: dict[int, str] = {}   # video_id → match_field (best/first wins)
    order: list[int] = []
    with contextlib.closing(es._connect()) as c:
        for field, col in _FIELD_PRIORITY:
            if len(order) >= lim:
                break
            for vid in _match_ids(c, col, tokens, mode):
                if vid in matched:
                    continue
                matched[vid] = field
                order.append(vid)
                if len(order) >= lim:
                    break
        if not order:
            return {"results": [], "total": 0, "mode": mode}
        ph = ",".join("?" for _ in order)
        rows = {r["id"]: r for r in c.execute(
            f"SELECT id, youtube_id, title, category, headline, chapters, transcript "
            f"FROM edu_videos WHERE id IN ({ph})", order).fetchall()}

    results = []
    for vid in order:
        row = rows.get(vid)
        if row is None:  # deleted between index build and read — skip
            continue
        snippet, t = _result_snippet_t(row, matched[vid], qs, tokens)
        results.append({
            "id": row["id"],
            "youtube_id": row["youtube_id"],
            "title": row["title"],
            "category": row["category"],
            "match_field": matched[vid],
            "snippet": snippet,
            "t": t,
        })
    return {"results": results, "total": len(results), "mode": mode}
