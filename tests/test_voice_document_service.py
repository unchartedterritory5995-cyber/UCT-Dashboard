"""Document Q&A — ingest, chunk, embed, search."""

import uuid
import pytest

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_document_service as vds
from api.services import voice_embeddings_service as ves


def _fake_embed(text: str) -> list[float]:
    """Bag-of-words sparse embedding so shared words cluster."""
    import hashlib
    vec = [0.0] * ves.EMBEDDING_DIM
    words = [w.strip(".,;:!?()").lower() for w in (text or "").split() if w.strip()]
    for w in set(words):
        h = hashlib.sha256(w.encode("utf-8")).digest()
        for i in range(8):
            pos = int.from_bytes(h[i * 2:(i * 2) + 2], "little") % ves.EMBEDDING_DIM
            vec[pos] += 1.0
    return vec


@pytest.fixture(autouse=True)
def patch_embed(monkeypatch):
    monkeypatch.setattr(ves, "embed_text", _fake_embed)


def _user():
    init_db()
    return create_user(f"vds_{uuid.uuid4()}@x.com", "p")["id"]


# ── Chunking ───────────────────────────────────────────────────────────────

def test_chunk_text_empty():
    assert vds._chunk_text("") == []
    assert vds._chunk_text("   ") == []


def test_chunk_text_short_stays_one():
    assert vds._chunk_text("hi there") == ["hi there"]


def test_chunk_text_splits_at_paragraph_boundaries():
    p = "para one. " * 50  # ~500 chars
    text = "\n\n".join([p, p, p, p])  # 4 paragraphs, ~2000 chars
    chunks = vds._chunk_text(text, max_chars=800)
    assert len(chunks) >= 2
    assert all(len(c) <= 900 for c in chunks)


def test_chunk_text_hard_wraps_giant_paragraph():
    huge = "A" * 5000
    chunks = vds._chunk_text(huge, max_chars=1000, overlap=100)
    assert len(chunks) >= 5
    assert all(len(c) <= 1000 for c in chunks)


# ── Ingest text ────────────────────────────────────────────────────────────

def test_ingest_text_creates_doc():
    uid = _user()
    out = vds.ingest_text(uid, title="Earnings call Q4",
                          text="The company reported strong revenue growth. "
                               "Guidance was raised for the full year.")
    assert out["ok"] is True
    assert out["doc_id"] > 0
    assert out["chunks"] >= 1
    docs = vds.list_user_documents(uid)
    assert len(docs) == 1
    assert docs[0]["title"] == "Earnings call Q4"


def test_ingest_text_rejects_empty():
    uid = _user()
    assert vds.ingest_text(uid, title="", text="x")["ok"] is False
    assert vds.ingest_text(uid, title="x", text="")["ok"] is False


def test_ingest_text_enforces_cap(monkeypatch):
    """User over MAX_DOCS_PER_USER should have oldest removed."""
    uid = _user()
    monkeypatch.setattr(vds, "MAX_DOCS_PER_USER", 3)
    for i in range(5):
        vds.ingest_text(uid, title=f"doc {i}", text=f"content {i} here")
    docs = vds.list_user_documents(uid)
    assert len(docs) == 3
    # Newest 3 kept
    titles = [d["title"] for d in docs]
    assert "doc 4" in titles
    assert "doc 0" not in titles


# ── Search ─────────────────────────────────────────────────────────────────

def test_search_doc_returns_relevant_chunks():
    uid = _user()
    out = vds.ingest_text(
        uid, title="Mixed bag",
        text=("Section about earnings beat and revenue growth.\n\n"
              "Section about regulatory concerns and supply chain.\n\n"
              "Section about AI products and chip demand.")
    )
    doc_id = out["doc_id"]
    hits = vds.search_doc(uid, "AI chip demand", doc_id=doc_id, k=3)
    assert len(hits) >= 1
    # Chunk index is decoded
    for h in hits:
        assert h["doc_id"] == doc_id
        assert isinstance(h["chunk_index"], int)


def test_search_doc_isolates_per_doc():
    uid = _user()
    d1 = vds.ingest_text(uid, title="A", text="alpha alpha alpha")
    d2 = vds.ingest_text(uid, title="B", text="beta beta beta")
    hits_d1 = vds.search_doc(uid, "alpha", doc_id=d1["doc_id"])
    hits_d2 = vds.search_doc(uid, "beta", doc_id=d2["doc_id"])
    assert all(h["doc_id"] == d1["doc_id"] for h in hits_d1)
    assert all(h["doc_id"] == d2["doc_id"] for h in hits_d2)


def test_search_doc_across_all_when_no_doc_id():
    uid = _user()
    vds.ingest_text(uid, title="A", text="quarterly earnings beat")
    vds.ingest_text(uid, title="B", text="margin expansion")
    hits = vds.search_doc(uid, "earnings beat margin", doc_id=None, k=5)
    assert len(hits) >= 1


# ── Delete ─────────────────────────────────────────────────────────────────

def test_delete_document_removes_record():
    uid = _user()
    out = vds.ingest_text(uid, title="Trash", text="some content here")
    assert vds.delete_document(uid, out["doc_id"]) is True
    assert vds.get_document(uid, out["doc_id"]) is None


def test_delete_document_user_isolation():
    """A can't delete B's doc."""
    a = _user()
    b = _user()
    out = vds.ingest_text(a, title="a's doc", text="secret")
    assert vds.delete_document(b, out["doc_id"]) is False
