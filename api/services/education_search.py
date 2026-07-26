"""Deep content search across the Desk video library (education.db).

Searches title, headline, chapter TITLES (from the JSON `chapters` column) and
TRANSCRIPT text of every edu_videos row via a SQLite FTS5 table

    edu_search(video_id UNINDEXED, title, headline, chapters_text, transcript)

living in the SAME education.db. The index is rebuilt idempotently by
`rebuild_index()` (drop + recreate + repopulate — ~290 rows, fast):
  (a) lazily on the first search of every process (`_index_built` readiness
      cache starts False and education_service._search_dirty starts True —
      the latter also covers writes from a prior process),
  (b) after any library write: education_service's write functions only SET
      `_search_dirty = True`; the next search() notices and rebuilds. Writes
      NEVER rebuild synchronously — rebuild_index() acquires
      education_service._WRITE_LOCK, which is NON-reentrant and already held
      inside every writer. The flags are double-checked AFTER acquiring the
      lock, so concurrent post-write searches trigger ONE rebuild, not N.

FTS5 is feature-detected ONCE per process (in-memory probe). When unavailable
the same table name is created as a PLAIN table and search() falls back to a
LIKE-based scan (%/_ escaped) behind the same signature. The response carries
`"mode": "fts"|"like"` so prod can verify which engine served it.

The user's query is always treated as a LITERAL: each whitespace token is
double-quoted for the MATCH expression (internal quotes doubled), so FTS5
operators like `OR`/`NOT`/`NEAR` cannot be injected.

SNIPPET CONTRACT (frontend already implements this — change both sides or
neither): `snippet` is PLAIN TEXT carrying literal `<b>`…`</b>` MATCH MARKERS.
It is NOT HTML. The consumer parses the marker pairs into styled nodes and
renders every remaining character as a TEXT node (never innerHTML /
dangerouslySetInnerHTML). To keep marker parsing unambiguous, pre-existing
literal `<b>`/`</b>` sequences in source text are removed before highlighting
(see _snippet); all other characters — `&`, `<script>`, quotes — pass through
byte-for-byte as plain text.
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

# Literal <b>/</b> sequences in SOURCE text (a transcript could contain them)
# would corrupt the frontend's marker parsing — removed before highlighting.
_B_MARKER = re.compile(r"</?b>", re.IGNORECASE)

_MODE: Optional[str] = None  # "fts" | "like" — detected once, cached

# Per-process readiness cache: True once rebuild_index() has built edu_search
# for this process. Checked alongside es._search_dirty so the steady-state
# search path opens exactly ONE connection (no per-search COUNT probe).
_index_built = False


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


def rebuild_index(force: bool = False) -> None:
    """Drop + recreate + repopulate edu_search from edu_videos, then clear the
    dirty flag + mark the per-process readiness cache. Idempotent. Acquires
    education_service._WRITE_LOCK (NON-reentrant) — must never be called by
    code already holding it.

    Double-checked locking: N concurrent post-write searches all race here,
    but only the FIRST rebuilds — the dirty/readiness flags are re-checked
    AFTER acquiring the lock, so the rest no-op instead of each running a
    full drop+repopulate serially on the same lock that gates every education
    write. `force=True` bypasses the check (ops/manual rebuild)."""
    global _MODE, _index_built
    mode = _detect_mode()
    with es._WRITE_LOCK:
        # Re-check under the lock: another thread may have rebuilt while we
        # waited. Flags are only cleared/set here, inside the lock.
        if not force and not getattr(es, "_search_dirty", True) and _index_built:
            return
        with contextlib.closing(es._connect()) as c:
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
        _index_built = True
        es._search_dirty = False


def _ensure_index() -> None:
    """Rebuild iff a write flagged the index stale OR this process has never
    built it (covers boot + a monkeypatched/changed DB path in tests). Pure
    flag checks — no DB connection on the steady-state path."""
    if getattr(es, "_search_dirty", True) or not _index_built:
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
    """~120-char PLAIN-TEXT context window around the first match, matched
    term(s) wrapped in literal <b>…</b> MARKERS.

    Contract (frontend already implements this — never change one side alone):
    the snippet is NOT HTML. Consumers MUST parse the <b>/</b> marker pairs
    into styled nodes and render every remaining character as a TEXT node
    (never innerHTML / dangerouslySetInnerHTML). So that marker parsing stays
    unambiguous, literal <b>/</b> sequences already present in the SOURCE text
    are removed before highlighting; everything else — &, <script>, quotes —
    is preserved byte-for-byte as plain text."""
    t = " ".join((text or "").split())
    t = _B_MARKER.sub("", t)
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
    empty. Never called while holding _WRITE_LOCK (rebuild re-acquires it).

    Each result's `snippet` is plain text with <b>…</b> match markers — see
    _snippet for the parse-into-nodes consumer contract (it is NOT HTML)."""
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
