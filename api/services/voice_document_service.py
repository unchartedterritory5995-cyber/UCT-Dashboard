"""
Document Q&A — upload a PDF/text, chunk it, embed each chunk as
kind='doc' under the user's namespace, ask questions.

Public API:
  - ingest_text(user_id, title, text, source_type='text') → {doc_id, chunks}
  - ingest_pdf_bytes(user_id, title, pdf_bytes) → same shape
  - list_user_documents(user_id) → recent docs
  - search_doc(user_id, query, doc_id?, k=5) → top-K matching chunks
  - delete_document(user_id, doc_id) → removes doc + embeddings

Each chunk gets indexed via voice_embeddings_service with kind='doc'
and source_id encoded as (doc_id * 1000 + chunk_index) so we can
both filter by doc and retrieve a specific chunk.
"""

import logging
from typing import Any

from api.services.auth_db import get_connection

_log = logging.getLogger(__name__)

CHUNK_CHARS = 1500
CHUNK_OVERLAP = 200
MAX_DOCS_PER_USER = 50
MAX_CHUNKS_PER_DOC = 200  # caps a long PDF at ~300k chars


# ── PDF extraction ─────────────────────────────────────────────────────────

def _extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Best-effort text extraction from a PDF blob. Returns empty string
    on failure (caller can prompt user to paste text directly)."""
    try:
        # Try pypdf first (most permissive)
        from io import BytesIO
        try:
            from pypdf import PdfReader  # type: ignore
        except ImportError:
            from PyPDF2 import PdfReader  # type: ignore
        reader = PdfReader(BytesIO(pdf_bytes))
        parts = []
        for page in reader.pages:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                continue
        return "\n\n".join(p for p in parts if p)
    except Exception as e:  # noqa: BLE001
        _log.warning("[doc] PDF extract failed: %s", e)
        return ""


# ── Chunking ───────────────────────────────────────────────────────────────

def _chunk_text(text: str, *, max_chars: int = CHUNK_CHARS,
                overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Sliding-window character chunks with overlap. Splits on paragraph
    boundaries when possible to keep chunks coherent."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    # Try paragraph-aware splitting first
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current = ""
    for p in paragraphs:
        if len(current) + len(p) + 2 <= max_chars:
            current = (current + "\n\n" + p) if current else p
        else:
            if current:
                chunks.append(current)
            if len(p) > max_chars:
                # Hard-wrap a giant paragraph
                for i in range(0, len(p), max_chars - overlap):
                    chunks.append(p[i:i + max_chars])
                current = ""
            else:
                current = p
    if current:
        chunks.append(current)
    return chunks[:MAX_CHUNKS_PER_DOC]


# ── Ingest ─────────────────────────────────────────────────────────────────

def _enforce_user_doc_cap(user_id: str) -> None:
    """If user is over MAX_DOCS_PER_USER, remove the oldest."""
    conn = get_connection()
    try:
        # ORDER BY id DESC for stable ordering even when multiple inserts
        # land in the same second (created_at is second-resolution).
        rows = conn.execute(
            "SELECT id FROM voice_documents WHERE user_id = ? ORDER BY id DESC",
            (user_id,),
        ).fetchall()
        cap = vds_MAX_DOCS_PER_USER()
        excess = rows[cap:]
        for r in excess:
            try:
                delete_document(user_id, r["id"])
            except Exception:
                pass
    finally:
        conn.close()


def vds_MAX_DOCS_PER_USER() -> int:
    """Read the cap by reference so monkeypatch in tests is honored."""
    import sys
    mod = sys.modules[__name__]
    return getattr(mod, "MAX_DOCS_PER_USER", 50)


def ingest_text(
    user_id: str,
    *,
    title: str,
    text: str,
    source_type: str = "text",
) -> dict[str, Any]:
    """Chunk + embed a text doc. Returns {doc_id, chunks, char_count}."""
    if not (title and text and text.strip()):
        return {"ok": False, "error": "title and text required"}

    chunks = _chunk_text(text)
    if not chunks:
        return {"ok": False, "error": "text was empty after chunking"}

    char_count = sum(len(c) for c in chunks)
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO voice_documents
                 (user_id, title, source_type, char_count, chunk_count)
                 VALUES (?, ?, ?, ?, ?)""",
            (user_id, title[:300], source_type, char_count, len(chunks)),
        )
        doc_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    # Embed each chunk under kind='doc', source_id = doc_id * 1000 + idx
    try:
        from api.services.voice_embeddings_service import index_text
        for i, chunk in enumerate(chunks):
            try:
                index_text(
                    user_id, kind="doc",
                    source_id=doc_id * 1000 + i,
                    text=chunk,
                )
            except Exception as e:
                _log.warning("[doc] chunk embed failed: doc=%s idx=%s: %s",
                             doc_id, i, e)
    except Exception as e:
        _log.warning("[doc] embeddings service missing: %s", e)

    _enforce_user_doc_cap(user_id)

    return {
        "ok": True, "doc_id": doc_id, "title": title,
        "chunks": len(chunks), "char_count": char_count,
    }


def ingest_pdf_bytes(
    user_id: str,
    *,
    title: str,
    pdf_bytes: bytes,
) -> dict[str, Any]:
    text = _extract_text_from_pdf(pdf_bytes)
    if not text.strip():
        return {"ok": False, "error": "could not extract text from PDF"}
    return ingest_text(user_id, title=title, text=text, source_type="pdf")


# ── Listing + search ───────────────────────────────────────────────────────

def list_user_documents(user_id: str, *, limit: int = 50) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT id, title, source_type, char_count, chunk_count, created_at
                 FROM voice_documents
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT ?""",
            (user_id, max(1, min(100, int(limit)))),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_document(user_id: str, doc_id: int) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM voice_documents WHERE id = ? AND user_id = ?",
            (doc_id, user_id),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def search_doc(
    user_id: str,
    query: str,
    *,
    doc_id: int | None = None,
    k: int = 5,
) -> list[dict]:
    """Semantic search across the user's doc chunks. If doc_id is given,
    restrict to that doc."""
    from api.services.voice_embeddings_service import search
    hits = search(user_id, query, k=max(1, min(20, int(k))), kind="doc")
    if doc_id is not None:
        lo, hi = doc_id * 1000, doc_id * 1000 + 1000
        hits = [h for h in hits if lo <= (h.get("source_id") or 0) < hi]
    # Decorate with chunk index + parent doc
    for h in hits:
        sid = h.get("source_id") or 0
        h["doc_id"] = sid // 1000
        h["chunk_index"] = sid % 1000
    return hits


def delete_document(user_id: str, doc_id: int) -> bool:
    """Remove doc record + all its chunk embeddings."""
    from api.services.voice_embeddings_service import delete_source
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT chunk_count FROM voice_documents WHERE id = ? AND user_id = ?",
            (doc_id, user_id),
        ).fetchone()
        if not row:
            return False
        chunk_count = row["chunk_count"] or 0
        conn.execute(
            "DELETE FROM voice_documents WHERE id = ? AND user_id = ?",
            (doc_id, user_id),
        )
        conn.commit()
    finally:
        conn.close()

    # Drop embeddings for every chunk
    for i in range(chunk_count + 5):  # +5 slack just in case
        try:
            delete_source(kind="doc", source_id=doc_id * 1000 + i)
        except Exception:
            pass
    return True
