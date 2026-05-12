"""Voice embeddings service — index, search, reindex.

Embedding API is patched out so tests don't hit OpenAI.
"""

import uuid
import pytest

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_embeddings_service as ves


def _user():
    init_db()
    return create_user(f"ves_{uuid.uuid4()}@example.com", "p")["id"]


def _fake_embed(text: str) -> list[float]:
    """Bag-of-words sparse embedding so shared words produce semantic-like
    similarity. Each unique word hashes to 8 positions; values are 1.0."""
    import hashlib
    vec = [0.0] * ves.EMBEDDING_DIM
    words = [w.strip(".,;:!?").lower() for w in (text or "").split() if w.strip()]
    for w in set(words):
        h = hashlib.sha256(w.encode("utf-8")).digest()
        for i in range(8):
            pos = int.from_bytes(h[i * 2:(i * 2) + 2], "little") % ves.EMBEDDING_DIM
            vec[pos] += 1.0
    return vec


@pytest.fixture(autouse=True)
def patch_embed(monkeypatch):
    monkeypatch.setattr(ves, "embed_text", _fake_embed)


# ── Encode/decode roundtrip ─────────────────────────────────────────────────

def test_encode_decode_roundtrip():
    v = [0.1, -0.2, 3.14, -0.0001]
    blob = ves._encode_vector(v)
    assert ves._decode_vector(blob) == pytest.approx(v, rel=1e-6)


def test_cosine_self_is_one():
    v = [1.0, 2.0, 3.0]
    assert ves._cosine(v, v) == pytest.approx(1.0, rel=1e-6)


def test_cosine_zero_for_orthogonal():
    a = [1.0, 0.0]
    b = [0.0, 1.0]
    assert ves._cosine(a, b) == pytest.approx(0.0, abs=1e-6)


def test_cosine_handles_zero_vectors():
    assert ves._cosine([0.0, 0.0], [1.0, 1.0]) == 0.0


# ── index_text ──────────────────────────────────────────────────────────────

def test_index_text_stores_row():
    uid = _user()
    rid = ves.index_text(uid, kind="fact", source_id=1, text="I trade swing setups")
    assert rid is not None


def test_index_text_rejects_unknown_kind():
    uid = _user()
    with pytest.raises(ValueError):
        ves.index_text(uid, kind="bogus", source_id=1, text="x")


def test_index_text_skips_empty():
    uid = _user()
    rid = ves.index_text(uid, kind="fact", source_id=1, text="")
    assert rid is None


def test_index_text_handles_embed_failure(monkeypatch):
    uid = _user()
    def bad_embed(t):
        raise RuntimeError("API down")
    monkeypatch.setattr(ves, "embed_text", bad_embed)
    rid = ves.index_text(uid, kind="fact", source_id=1, text="something")
    assert rid is None  # Survives gracefully


# ── delete_source ──────────────────────────────────────────────────────────

def test_delete_source_removes_row():
    uid = _user()
    ves.index_text(uid, kind="fact", source_id=42, text="hello world")
    removed = ves.delete_source(kind="fact", source_id=42)
    assert removed == 1
    hits = ves.search(uid, "hello", k=5)
    assert all(h["source_id"] != 42 for h in hits)


# ── search ─────────────────────────────────────────────────────────────────

def test_search_returns_sorted_results():
    uid = _user()
    ves.index_text(uid, kind="fact", source_id=1, text="swing trade flag breakouts")
    ves.index_text(uid, kind="fact", source_id=2, text="I prefer the morning session")
    ves.index_text(uid, kind="fact", source_id=3, text="my main account is alpha")
    hits = ves.search(uid, "flag breakouts", k=3)
    assert len(hits) >= 1
    # Scores should be sorted descending
    scores = [h["score"] for h in hits]
    assert scores == sorted(scores, reverse=True)
    # The flag-breakout fact should score highest
    assert hits[0]["source_id"] == 1


def test_search_filters_by_kind():
    uid = _user()
    ves.index_text(uid, kind="fact", source_id=1, text="alpha")
    ves.index_text(uid, kind="summary", source_id=2, text="alpha")
    hits = ves.search(uid, "alpha", k=10, kind="summary")
    assert all(h["kind"] == "summary" for h in hits)


def test_search_empty_query_returns_empty():
    uid = _user()
    assert ves.search(uid, "", k=5) == []


def test_search_no_data_returns_empty():
    uid = _user()
    assert ves.search(uid, "anything", k=5) == []


def test_search_respects_user_isolation():
    a = _user()
    b = _user()
    ves.index_text(a, kind="fact", source_id=1, text="i trade swing")
    hits = ves.search(b, "swing", k=5)
    assert hits == []


# ── reindex_user ───────────────────────────────────────────────────────────

def test_reindex_user_picks_up_facts():
    from api.services import voice_memory_service as vms
    # vms.add_fact would auto-index; we bypass by writing the fact directly
    from api.services.auth_db import get_connection
    uid = _user()
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO user_voice_facts (user_id, category, text)
               VALUES (?, ?, ?)""",
            (uid, "preference", "I trade flag breakouts"),
        )
        conn.commit()
    finally:
        conn.close()
    counts = ves.reindex_user(uid)
    assert counts["indexed"] >= 1
    hits = ves.search(uid, "flag breakouts", k=3)
    assert len(hits) >= 1


def test_reindex_user_skips_already_indexed():
    uid = _user()
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO user_voice_facts (user_id, category, text)
               VALUES (?, ?, ?)""",
            (uid, "preference", "I trade swing setups"),
        )
        conn.commit()
    finally:
        conn.close()
    ves.reindex_user(uid)
    # Second pass should be a no-op
    counts = ves.reindex_user(uid)
    assert counts["indexed"] == 0
