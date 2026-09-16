"""Wisdom retrieval index: SQLite FTS5 inside wisdom.db over SEGMENT and PRINCIPLE records.

WHY FTS AND NOT EMBEDDINGS (CONTRACTS §6.6). Paid session transcripts do not go
to a third-party embedding API. This module imports nothing that talks to a
network; `tests/test_wisdom_publish_adapters_retrieval.py` walks its imports.
W4 can revisit with the owner.

WHAT IS INDEXED
- A segment whose author is known (`author_id IS NOT NULL`). Attendee text is
  never indexed; guest text is indexed with `is_guest=1` and filtered out of
  every "UCT said" read unless a caller asks for it.
- A principle with an author and a live status.
- A segment of a source that a newer source version supersedes is removed.
`status` on a segment doc is `confirmed` when any record extracted from it is
confirmed, else `provisional` — the label the Ask-AI block prints.

INCREMENTAL. Each document carries a hash of everything the index stores for it;
`wisdom_retrieval_docs` remembers the hash and the FTS rowid. `refresh()` rewrites
only changed documents (by rowid, not a scan) in bounded write transactions.
"""
from __future__ import annotations

import logging
import re
import sqlite3
from typing import Iterable, Optional

from api.services.wisdom.core import flags, ids, store
from api.services.wisdom.publish.adapters import common

log = logging.getLogger(__name__)

FTS_TABLE = "wisdom_segments_fts"
INDEX_VERSION = "fts-w1.0"
_WRITE_BATCH = 400
_MAX_QUERY_TERMS = 12

_STOPWORDS = frozenset("""
a an and are as at be been but by can could did do does for from had has have how i if in into is it its
just like me my no not of on or our should so than that the their them then there these they this to up us
was we were what when where which who why will with would you your about over under any some more most
said say says tell think thoughts uct tsdr bracco manrav chartmaster
""".split())
_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


# ── build ────────────────────────────────────────────────────────────────────

def _segment_docs(conn: sqlite3.Connection) -> Iterable[dict]:
    team = set(common.team_author_ids())
    rows = conn.execute(
        """
        SELECT s.segment_id, s.source_id, s.text, s.text_sha256, s.author_id, s.t_start_s, s.path, s.ordinal,
               (SELECT group_concat(DISTINCT UPPER(r.ticker)) FROM wisdom_records r
                  WHERE r.segment_id = s.segment_id AND r.ticker IS NOT NULL
                    AND r.status IN ('provisional', 'confirmed')) AS tickers,
               (SELECT COUNT(*) FROM wisdom_records r
                  WHERE r.segment_id = s.segment_id AND r.status = 'confirmed') AS n_confirmed,
               (SELECT MIN(r.stated_at_et) FROM wisdom_records r WHERE r.segment_id = s.segment_id) AS stated_at,
               COALESCE(src.recording_started_at_et, src.published_at_et) AS source_at
        FROM wisdom_segments s
        JOIN wisdom_sources src ON src.source_id = s.source_id
        WHERE s.author_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM wisdom_sources newer WHERE newer.supersedes_source_id = src.source_id)
        """)
    for r in rows:
        status = "confirmed" if (r["n_confirmed"] or 0) > 0 else "provisional"
        loc = common.locator(r["source_id"], r["segment_id"], t_start_s=r["t_start_s"], path=r["path"],
                             ordinal=r["ordinal"])
        tickers = " ".join(sorted(t for t in (r["tickers"] or "").split(",") if t))
        stated = r["stated_at"] or r["source_at"] or ""
        is_guest = 0 if r["author_id"] in team else 1
        doc = {
            "doc_id": f"seg:{r['segment_id']}", "doc_kind": "segment", "source_id": r["source_id"],
            "segment_id": r["segment_id"], "author_id": r["author_id"], "is_guest": is_guest,
            "stated_at": stated, "status": status, "locator": loc, "tickers": tickers, "text": r["text"] or "",
        }
        doc["doc_sha256"] = ids.sha256_text("|".join(
            (INDEX_VERSION, r["text_sha256"] or ids.sha256_text(doc["text"]), status, r["author_id"] or "",
             str(is_guest), tickers, stated, loc)))
        yield doc


def _principle_docs(conn: sqlite3.Connection) -> Iterable[dict]:
    team = set(common.team_author_ids())
    rows = conn.execute(
        """
        SELECT p.principle_key, p.statement, p.author_id, p.is_guest, p.status, p.first_seen_at,
               (SELECT r.segment_id FROM wisdom_principle_support ps
                  JOIN wisdom_records r ON r.record_id = ps.record_id
                 WHERE ps.principle_key = p.principle_key AND ps.relation IN ('states', 'reinforces')
                 ORDER BY r.stated_at_et ASC LIMIT 1) AS first_segment_id
        FROM wisdom_principles p
        WHERE p.status IN ('provisional', 'confirmed') AND p.author_id IS NOT NULL
        """)
    for r in rows:
        seg = None
        if r["first_segment_id"]:
            seg = conn.execute(
                "SELECT segment_id, source_id, t_start_s, path, ordinal FROM wisdom_segments WHERE segment_id = ?",
                (r["first_segment_id"],)).fetchone()
        loc = (common.locator(seg["source_id"], seg["segment_id"], t_start_s=seg["t_start_s"], path=seg["path"],
                              ordinal=seg["ordinal"])
               if seg else f"wisdom:principle#{r['principle_key']}@statement")
        is_guest = 1 if (r["is_guest"] or r["author_id"] not in team) else 0
        doc = {
            "doc_id": f"pr:{r['principle_key']}", "doc_kind": "principle",
            "source_id": seg["source_id"] if seg else "", "segment_id": seg["segment_id"] if seg else "",
            "author_id": r["author_id"], "is_guest": is_guest, "stated_at": r["first_seen_at"] or "",
            "status": common.status_label(r["status"]), "locator": loc, "tickers": "",
            "text": r["statement"] or "",
        }
        doc["doc_sha256"] = ids.sha256_text("|".join(
            (INDEX_VERSION, ids.sha256_text(doc["text"]), doc["status"], r["author_id"] or "", str(is_guest),
             doc["stated_at"], loc)))
        yield doc


def refresh(ctx=None, *, force: bool = False) -> dict:
    """Bring the FTS index in line with wisdom.db. Idempotent; a second run writes nothing."""
    dry = bool(getattr(ctx, "dry_run", False))
    if not force and not flags.retrieval_index_enabled():
        return {"skipped": "WISDOM_RETRIEVAL_INDEX_ENABLED is off"}
    with store.read() as conn:
        if not common.table_exists(conn, FTS_TABLE):
            return {"skipped": "publish_adapters_002_segments_fts is not applied"}
        docs = {d["doc_id"]: d for d in (*_segment_docs(conn), *_principle_docs(conn))}
        known = {r["doc_id"]: (r["doc_sha256"], r["fts_rowid"])
                 for r in conn.execute("SELECT doc_id, doc_sha256, fts_rowid FROM wisdom_retrieval_docs")}
    changed = [d for doc_id, d in docs.items() if known.get(doc_id, (None,))[0] != d["doc_sha256"]]
    removed = [doc_id for doc_id in known if doc_id not in docs]
    out = {"docs": len(docs), "changed": len(changed), "removed": len(removed), "dry_run": dry}
    if dry or (not changed and not removed):
        return out
    at = common.now_iso()
    for i in range(0, len(removed), _WRITE_BATCH):
        with store.write() as conn:
            for doc_id in removed[i:i + _WRITE_BATCH]:
                _drop(conn, known[doc_id][1])
                conn.execute("DELETE FROM wisdom_retrieval_docs WHERE doc_id = ?", (doc_id,))
    for i in range(0, len(changed), _WRITE_BATCH):
        with store.write() as conn:
            for d in changed[i:i + _WRITE_BATCH]:
                if d["doc_id"] in known:
                    _drop(conn, known[d["doc_id"]][1])
                cur = conn.execute(
                    f"INSERT INTO {FTS_TABLE}(doc_id, doc_kind, source_id, segment_id, author_id, is_guest, "
                    "stated_at, status, locator, tickers, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (d["doc_id"], d["doc_kind"], d["source_id"], d["segment_id"], d["author_id"], d["is_guest"],
                     d["stated_at"], d["status"], d["locator"], d["tickers"], d["text"]))
                conn.execute(
                    "INSERT INTO wisdom_retrieval_docs(doc_id, doc_sha256, fts_rowid, indexed_at) VALUES (?, ?, ?, ?) "
                    "ON CONFLICT(doc_id) DO UPDATE SET doc_sha256 = excluded.doc_sha256, "
                    "fts_rowid = excluded.fts_rowid, indexed_at = excluded.indexed_at",
                    (d["doc_id"], d["doc_sha256"], cur.lastrowid, at))
    return out


def _drop(conn: sqlite3.Connection, rowid: Optional[int]) -> None:
    if rowid is not None:
        conn.execute(f"DELETE FROM {FTS_TABLE} WHERE rowid = ?", (int(rowid),))


# ── read ─────────────────────────────────────────────────────────────────────

def _quote(term: str) -> str:
    return '"' + term.replace('"', '""') + '"'


def build_match(query: Optional[str], tickers: Iterable[str] = ()) -> str:
    """An FTS5 MATCH expression, or "" when nothing searchable remains.

    Ticker questions match the ticker column only (a segment is about NVDA when a
    record extracted from it is), newest first. Anything else ORs the content
    words and ranks by bm25."""
    ticks = [t for t in dict.fromkeys(common.normalize_ticker(t) for t in (tickers or ())) if t]
    if ticks:
        return " OR ".join(f"tickers:{_quote(t)}" for t in ticks)
    words = [w.lower() for w in _TOKEN_RE.findall(query or "")]
    terms = [w for w in dict.fromkeys(words) if len(w) >= 2 and w not in _STOPWORDS][:_MAX_QUERY_TERMS]
    return " OR ".join(_quote(t) for t in terms)


def search(query: Optional[str], *, tickers: Iterable[str] = (), limit: int = 3, include_guests: bool = False,
           for_request: bool = True, include_unstable: bool = False) -> list[dict]:
    """Hits for a question. Never raises: an unreadable or absent index is no hits.

    ⛔ **`include_unstable=False` is the Wave 1.5 item-3 floor on the Ask-AI lane**, which reaches
    PRINCIPLE through this index and NOT through `select_records`. Applied here rather than in
    `_principle_docs` on purpose: the same index is read by `brainkb.voice_principle_candidates`,
    an owner-sourcing lane that must keep seeing below-floor principles, and filtering at index
    BUILD would take them away from it too.

    ⛔ **`wisdom_segments_fts` is an FTS5 virtual table and FTS5 does not support
    `ALTER TABLE … ADD COLUMN`**, so stability cannot live on the index. The principle docs carry
    a `pr:<principle_key>` doc_id (`:107`), so the floor is applied by joining `wisdom_principles`
    on that prefix after the MATCH.

    ⚠️ **This filters principle DOCS, not segment docs**, and that gap is real: `_segment_docs`
    (`:49-81`) indexes the full text of every authored segment, so the sentence a below-floor
    principle was extracted from is still retrievable as a `segment` doc, attributed and dated.
    Closing that is claim-level scope, which the owner ruled OUT of this build (R13: RECORD).
    """
    try:
        ticks = [t for t in (tickers or ()) if t]
        match = build_match(query, ticks)
        if not match:
            return []
        guest_clause = "" if include_guests else " AND is_guest = 0"
        order = "stated_at DESC" if ticks else "score ASC"
        with store.read(for_request=for_request) as conn:
            if not common.table_exists(conn, FTS_TABLE):
                return []
            rows = conn.execute(
                f"SELECT doc_id, doc_kind, source_id, segment_id, author_id, is_guest, stated_at, status, locator, "
                f"tickers, text, bm25({FTS_TABLE}) AS score FROM {FTS_TABLE} "
                f"WHERE {FTS_TABLE} MATCH ? AND status IN ('provisional', 'confirmed'){guest_clause} "
                f"ORDER BY {order} LIMIT ?", (match, max(1, int(limit)))).fetchall()
            hits = [dict(r) for r in rows]
            if not include_unstable:
                from api.services.wisdom.publish import floor

                keys = [h["doc_id"][3:] for h in hits if str(h.get("doc_id", "")).startswith("pr:")]
                if keys:
                    clause, params = floor.principles_clause("p")
                    blocked = {r[0] for r in conn.execute(
                        f"SELECT principle_key FROM wisdom_principles p "
                        f"WHERE principle_key IN ({','.join('?' * len(keys))}) AND NOT {clause}",
                        [*keys, *params])}
                    # ⛔ A principle doc whose key is not in wisdom_principles at all is BLOCKED,
                    # not passed: an unresolvable key is an unknown score, and unknown fails
                    # closed. Passing it would make a stale index a publication channel.
                    known = {r[0] for r in conn.execute(
                        f"SELECT principle_key FROM wisdom_principles "
                        f"WHERE principle_key IN ({','.join('?' * len(keys))})", keys)}
                    hits = [h for h in hits
                            if not str(h.get("doc_id", "")).startswith("pr:")
                            or (h["doc_id"][3:] in known and h["doc_id"][3:] not in blocked)]
        return hits
    except sqlite3.Error:
        log.exception("[wisdom] retrieval search failed")
        return []
