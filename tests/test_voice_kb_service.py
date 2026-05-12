"""Trading Knowledge Base — load corpus, index, lookup."""

import uuid
import pytest

from api.services.auth_db import init_db, get_connection
from api.services import voice_kb_service as kb
from api.services import voice_embeddings_service as ves


def _fake_embed(text: str) -> list[float]:
    """Bag-of-words fake embedding for deterministic semantic-ish search."""
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


@pytest.fixture(autouse=True)
def fresh_kb_rows():
    """Clear any existing kb_chunk rows before each test for determinism."""
    init_db()
    conn = get_connection()
    try:
        conn.execute("DELETE FROM voice_embeddings WHERE user_id = ?", (kb.KB_USER_ID,))
        conn.commit()
    finally:
        conn.close()
    yield


def test_load_corpus_returns_entries():
    entries = kb.load_corpus()
    assert isinstance(entries, list)
    assert len(entries) > 0
    # Schema check on first entry
    first = entries[0]
    assert "id" in first and "category" in first and "title" in first and "text" in first


def test_entry_source_id_is_deterministic():
    a1 = kb._entry_source_id("ps-001")
    a2 = kb._entry_source_id("ps-001")
    b = kb._entry_source_id("ps-002")
    assert a1 == a2
    assert a1 != b
    assert isinstance(a1, int) and a1 > 0


def test_format_entry_includes_title_category_body():
    entry = {"id": "x", "title": "Test", "category": "behavioral_bias", "text": "Body"}
    s = kb._format_entry_for_embedding(entry)
    assert "Test" in s
    assert "behavioral bias" in s  # underscore stripped
    assert "Body" in s


def test_index_corpus_inserts_rows():
    counts = kb.index_corpus()
    assert counts["indexed"] > 0
    assert counts["errors"] == 0
    # Verify rows landed
    conn = get_connection()
    try:
        n = conn.execute(
            "SELECT COUNT(*) FROM voice_embeddings WHERE user_id = ? AND kind = 'kb_chunk'",
            (kb.KB_USER_ID,),
        ).fetchone()[0]
    finally:
        conn.close()
    assert n == counts["indexed"]


def test_index_corpus_is_idempotent():
    first = kb.index_corpus()
    second = kb.index_corpus()
    assert first["indexed"] > 0
    assert second["indexed"] == 0
    assert second["skipped"] == first["indexed"]


def test_index_corpus_force_reindexes_all():
    first = kb.index_corpus()
    second = kb.index_corpus(force=True)
    assert second["indexed"] == first["indexed"]


def test_lookup_returns_relevant_entries():
    kb.index_corpus()
    hits = kb.lookup("position sizing fixed fractional account risk", k=3)
    assert len(hits) > 0
    # Top result should be a position-sizing entry
    assert "position" in (hits[0]["category"] + " " + (hits[0]["text"] or "")).lower()


def test_lookup_empty_query_returns_empty():
    kb.index_corpus()
    assert kb.lookup("", k=3) == []


def test_lookup_no_corpus_returns_empty():
    # corpus wiped by fresh_kb_rows fixture; don't reindex
    assert kb.lookup("flag breakouts", k=3) == []


def test_seed_on_startup_runs_without_error():
    # Should be a clean no-throw whether or not corpus is present
    kb.seed_on_startup()
