"""TSDR voice corpus: the query and the archive format (D18/D19; W1 Part 5 "Morning Wire voice profile").

Standard library only. `tools/wisdom/publish_voice_corpus.py` loads this file BY PATH, so the
PC-side export never imports the `api` package; `adapters/voice.py` imports it normally. One
definition, two callers.

FORMAT — the existing Substack archive format morning-wire's `scripts/build_voice_profile.py`
parses (its `_POST_RE`): one post per block,
    === [SUNDAY SCAN] <title> ===
    Date: <YYYY-MM-DD>
    <lines>
with a blank line between posts. That parser recognises only `[SUNDAY SCAN]` and
`[ARTICLE]`, so every document is one of the two.

WHOSE TEXT — `wisdom_segments.author_id = 'tsdr'` only, segment by segment. A mixed source
(a Sunday Scans issue with Bracco's signed section, a session with guests) contributes only
TSDR's segments; nothing is attributed by voice or style (D3). Written streams by default
(Sunday Scans, Discord, X): the profile is a WRITING voice. `include_spoken` adds session
transcripts as [ARTICLE] documents. A superseded source version is never exported.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Optional

OWNER_AUTHOR = "tsdr"
WRITTEN_STREAMS = ("sunday_scans", "discord", "x")
SPOKEN_STREAMS = ("zoom_live", "workshop", "interview", "education")
_HEADER_UNSAFE = re.compile(r"[=\r\n]+")


def corpus_documents(conn: sqlite3.Connection, *, include_spoken: bool = False, since: Optional[str] = None,
                     author: str = OWNER_AUTHOR) -> list[dict]:
    streams = WRITTEN_STREAMS + (SPOKEN_STREAMS if include_spoken else ())
    sql = (
        "SELECT src.source_id, src.stream, src.title, "
        "COALESCE(src.published_at_et, src.recording_started_at_et) AS at, s.ordinal, s.text "
        "FROM wisdom_segments s JOIN wisdom_sources src ON src.source_id = s.source_id "
        f"WHERE s.author_id = ? AND src.stream IN ({','.join('?' * len(streams))}) "
        "AND NOT EXISTS (SELECT 1 FROM wisdom_sources newer WHERE newer.supersedes_source_id = src.source_id)")
    params: list = [author, *streams]
    if since:
        sql += " AND COALESCE(src.published_at_et, src.recording_started_at_et) >= ?"
        params.append(since)
    sql += " ORDER BY at ASC, src.source_id ASC, s.ordinal ASC"
    docs: dict = {}
    for source_id, stream, title, at, _ordinal, text in conn.execute(sql, params):
        date = (at or "")[:10]
        doc = docs.setdefault(source_id, {
            "source_id": source_id, "stream": stream, "date": date,
            "kind": "SUNDAY SCAN" if stream == "sunday_scans" else "ARTICLE",
            "title": title or f"{stream} {date}".strip(), "lines": [],
        })
        doc["lines"].extend(line.rstrip() for line in (text or "").splitlines() if line.strip())
    return [d for d in docs.values() if d["lines"]]


def format_archive(docs: list[dict]) -> str:
    blocks = []
    for d in docs:
        title = _HEADER_UNSAFE.sub(" ", d.get("title") or "").strip() or "untitled"
        blocks.append(f"=== [{d['kind']}] {title} ===\nDate: {d.get('date') or ''}\n" + "\n".join(d["lines"]))
    return ("\n\n".join(blocks) + "\n") if blocks else ""
