"""Shared writers for the sources package: source ids, versioning, segments, R2 raw text.

Identity (CONTRACTS.md §2.4, wisdom-db-v0.sql):
  * lineage id  = sha24(stream | external_ref)            — stable for the life of a source
  * source_id   = the lineage id for version 1, sha24(stream | external_ref | v<n>) after that
    (source_id is the PRIMARY KEY, so every version needs its own)
  * segment_id  = sha24(source_id | version | ordinal)
  * R2 raw key  = wisdom/sources/<stream>/<lineage id>/v<n>.txt.gz

A changed raw sha creates version n+1 that supersedes n; an unchanged sha is a
no-op; nothing is ever updated in place or deleted.

⛔ The gzip is written with mtime=0. gzip embeds the wall clock in its header by
default, so the same text compresses to DIFFERENT bytes on every run — and
core.r2.put_immutable would then refuse the second run's write as a conflict.
"""
from __future__ import annotations

import gzip
import sqlite3
from typing import Iterable, Optional

from api.services.wisdom.core import ids, timeutil

INGEST_VERSION = "sources-w1.0"


def now_iso() -> str:
    return timeutil.iso_et(timeutil.now_et())


def lineage_id(stream: str, external_ref: str) -> str:
    return ids.sha24(stream, external_ref)


def source_id_for(stream: str, external_ref: str, version: int) -> str:
    if int(version) <= 1:
        return lineage_id(stream, external_ref)
    return ids.sha24(stream, external_ref, f"v{int(version)}")


def segment_id_for(source_id: str, version: int, ordinal: int) -> str:
    return ids.sha24(source_id, int(version), int(ordinal))


def raw_r2_key(stream: str, external_ref: str, version: int) -> str:
    return f"wisdom/sources/{stream}/{lineage_id(stream, external_ref)}/v{int(version)}.txt.gz"


def gzip_text(text: str) -> bytes:
    """Deterministic gzip (mtime=0) so a re-run produces byte-identical objects."""
    return gzip.compress((text or "").encode("utf-8"), compresslevel=9, mtime=0)


def latest_source(conn: sqlite3.Connection, stream: str, external_ref: str) -> Optional[dict]:
    row = conn.execute(
        "SELECT * FROM wisdom_sources WHERE stream = ? AND external_ref = ? "
        "ORDER BY version DESC LIMIT 1",
        (stream, external_ref),
    ).fetchone()
    return dict(row) if row else None


def plan_version(conn: sqlite3.Connection, stream: str, external_ref: str, raw_sha256: str) -> dict:
    """What an ingest of this (stream, external_ref, sha) must do.

    action: 'new' (no source yet) | 'changed' (new version) | 'unchanged' |
            'reverted' (the sha equals an OLDER version: the contract's UNIQUE
            (stream, external_ref, raw_sha256) forbids a second row, so it is
            reported, never written)."""
    latest = latest_source(conn, stream, external_ref)
    if latest is None:
        return {"action": "new", "version": 1, "supersedes": None}
    if latest["raw_sha256"] == raw_sha256:
        return {"action": "unchanged", "version": latest["version"], "supersedes": None,
                "source_id": latest["source_id"]}
    older = conn.execute(
        "SELECT version FROM wisdom_sources WHERE stream = ? AND external_ref = ? AND raw_sha256 = ?",
        (stream, external_ref, raw_sha256),
    ).fetchone()
    if older is not None:
        return {"action": "reverted", "version": latest["version"], "supersedes": None,
                "source_id": latest["source_id"], "matches_version": older["version"]}
    return {"action": "changed", "version": int(latest["version"]) + 1,
            "supersedes": latest["source_id"]}


_SOURCE_COLUMNS = (
    "source_id", "stream", "external_ref", "version", "supersedes_source_id", "home_pointer",
    "published_at_et", "recording_started_at_et", "title", "show", "host_author_id",
    "guest_names_json", "raw_r2_key", "raw_sha256", "media_pointer", "coverage_ratio",
    "incomplete", "published_check", "speaker_resolution_json", "ingest_version", "ingested_at",
)
# ⛔ `speaker_resolution_json` was in wisdom-db-v0.sql from the §8a.2 ruling and MISSING
# from this projection, so a caller that set it wrote NOTHING and no error said so
# (reviewer R4b; lesson_a_projection_drops_what_it_does_not_name).


def insert_source(conn: sqlite3.Connection, row: dict) -> bool:
    """INSERT OR IGNORE one wisdom_sources row. Returns True when a row was written."""
    data = {c: row.get(c) for c in _SOURCE_COLUMNS}
    data.setdefault("guest_names_json", "[]")
    if data["guest_names_json"] is None:
        data["guest_names_json"] = "[]"
    if data["incomplete"] is None:
        data["incomplete"] = 0
    if data["ingest_version"] is None:
        data["ingest_version"] = INGEST_VERSION
    if data["ingested_at"] is None:
        data["ingested_at"] = now_iso()
    cols = ", ".join(_SOURCE_COLUMNS)
    marks = ", ".join(f":{c}" for c in _SOURCE_COLUMNS)
    before = conn.total_changes
    conn.execute(f"INSERT OR IGNORE INTO wisdom_sources ({cols}) VALUES ({marks})", data)
    return conn.total_changes > before


_SEGMENT_COLUMNS = (
    "segment_id", "source_id", "source_version", "ordinal", "kind", "path", "t_start_s", "t_end_s",
    "char_start", "char_end", "speaker_label", "author_id", "speaker_confidence", "text",
    "text_sha256", "normalizer_version",
)


def insert_segments(conn: sqlite3.Connection, source_id: str, version: int,
                    segments: Iterable[dict], normalizer_version: str) -> int:
    """INSERT OR IGNORE segments for one source version. Ordinals are assigned in
    the given order when a segment carries none. Returns rows written."""
    cols = ", ".join(_SEGMENT_COLUMNS)
    marks = ", ".join(f":{c}" for c in _SEGMENT_COLUMNS)
    written = 0
    for i, seg in enumerate(segments):
        ordinal = int(seg.get("ordinal", i))
        text = seg.get("text") or ""
        data = {c: seg.get(c) for c in _SEGMENT_COLUMNS}
        data.update({
            "segment_id": segment_id_for(source_id, version, ordinal),
            "source_id": source_id,
            "source_version": int(version),
            "ordinal": ordinal,
            "text": text,
            "text_sha256": ids.sha256_text(text),
            "normalizer_version": normalizer_version,
        })
        before = conn.total_changes
        conn.execute(f"INSERT OR IGNORE INTO wisdom_segments ({cols}) VALUES ({marks})", data)
        written += conn.total_changes - before
    return written


def put_raw_text(stream: str, external_ref: str, version: int, text: str, *, r2_module=None) -> dict:
    """Write the (already privacy-normalised) text to its immutable R2 key.

    Raises on failure (core.r2 contract) so the caller leaves the source unwritten
    and the next run retries."""
    if r2_module is None:
        from api.services.wisdom.core import r2 as r2_module
    # ⛔ CONTRACTS §8c.1.3's empty-payload refusal CANNOT FIRE THROUGH THIS FUNCTION
    # (reviewer R7, 2026-09-13). `core.r2.put_verified` refuses `if not data` — but every
    # caller here gzips first, and gzip("") is 20 non-empty bytes, so an empty source
    # would sail past the very guard the S-A ruling added and burn a canonical key that
    # this module, by design, can never delete or rewrite. The check belongs on the TEXT,
    # before compression. Reachable today: a Sunday Scans body that is all markup and no
    # text parses to "" and would be written as the issue's canonical raw object.
    if not (text or "").strip():
        raise ValueError(
            f"refusing to write an EMPTY raw object for {stream}:{external_ref} v{version}; "
            f"wisdom R2 has no delete path, so an empty canonical key would be permanent")
    key = raw_r2_key(stream, external_ref, version)
    return r2_module.put_immutable(key, gzip_text(text), "application/gzip")


def hhmmss(sec: float) -> str:
    """Display stamp for the normalised text (NOT a parser; transcripts are only
    ever parsed through education_service.get_transcript_cues)."""
    sec = max(0, int(sec))
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
