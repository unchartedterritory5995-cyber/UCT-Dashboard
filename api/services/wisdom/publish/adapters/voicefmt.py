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

import importlib.util
import pathlib
import re
import sqlite3
from typing import Optional

#: The marker module, loaded BY PATH so this file keeps its standard-library-only promise
#: for the PC-side tool that loads THIS file by path. Bound to the name the §8c.3 check reads.
_spec = importlib.util.spec_from_file_location(
    "wisdom_provenance_for_voicefmt", pathlib.Path(__file__).resolve().parent / "provenance.py")
provenance = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(provenance)

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
    """The archive text, PREFACED by the provenance marker (§8c.3).

    The marker is one line ABOVE the first `=== [KIND] title ===` header, so morning-wire's
    block-scanning `_POST_RE` never sees it and no document's body carries it — a marker
    inside a voice corpus would end up teaching the profile its own bookkeeping. It is still
    in the file, which is what the audit reads."""
    blocks = []
    for d in docs:
        title = _HEADER_UNSAFE.sub(" ", d.get("title") or "").strip() or "untitled"
        blocks.append(f"=== [{d['kind']}] {title} ===\nDate: {d.get('date') or ''}\n" + "\n".join(d["lines"]))
    if not blocks:
        return ""
    mark = provenance.marker_text(consumer="voice", subject_ref=f"wisdom_segments:{OWNER_AUTHOR}",
                                  locator=f"documents={len(docs)}", flag_env="WISDOM_VOICE_PROFILE_ENABLED")
    return f"{mark}\n" + "\n\n".join(blocks) + "\n"
