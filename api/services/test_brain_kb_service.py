import hashlib
import os
import sqlite3
import struct

import pytest

from api.services import brain_kb_service as bks


def _fake_embed(texts):
    """Deterministic pseudo-embeddings: seeded by md5, 1536-dim, unit-ish."""
    out = []
    for t in texts:
        h = hashlib.md5(t.encode()).digest()
        vec = [((h[i % 16] + i) % 100) / 100.0 for i in range(1536)]
        # bias vectors that mention 'VCP' toward a common direction
        if "VCP" in t:
            vec[0] = 50.0
        out.append(vec)
    return out


@pytest.fixture()
def kb_env(tmp_path, monkeypatch):
    brain = tmp_path / "brain"
    (brain / "data").mkdir(parents=True)
    conn = sqlite3.connect(str(brain / "data" / "uct_intelligence.db"))
    conn.execute("CREATE TABLE knowledge_base (id INTEGER PRIMARY KEY, category TEXT,"
                 " title TEXT, content TEXT, tags TEXT, active INTEGER, source TEXT,"
                 " trader TEXT, regime_context TEXT, priority INTEGER)")
    rows = [
        (1, "SETUP", "VCP definition", "A VCP is a Minervini base with progressive contractions"
         " into a tight pivot. Buy the pivot break on volume. VCP VCP.", "", 1, "kb", "Minervini", "", 1),
        (2, "PSYCHOLOGY", "Tilt control", "After two rapid losses, step away from the screen.",
         "", 1, "kb", "Steenbarger", "", 2),
        (3, "SETUP", "Inactive row", "should never be indexed", "", 0, "kb", "", "", 3),
    ]
    conn.executemany("INSERT INTO knowledge_base VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
    conn.commit()
    conn.close()
    monkeypatch.setenv("BRAIN_DIR", str(brain))
    monkeypatch.setenv("BRAIN_INDEX_DB", str(tmp_path / "brain_index.db"))
    bks._reset_for_tests()
    yield
    bks._reset_for_tests()


def test_reindex_indexes_active_rows_only(kb_env):
    stats = bks.reindex(embed_fn=_fake_embed)
    assert stats["indexed"] == 2 and stats["total"] == 2


def test_reindex_is_incremental(kb_env):
    bks.reindex(embed_fn=_fake_embed)
    stats2 = bks.reindex(embed_fn=_fake_embed)
    assert stats2["indexed"] == 0 and stats2["skipped"] == 2


def test_search_ranks_relevant_chunk_first(kb_env):
    bks.reindex(embed_fn=_fake_embed)
    hits = bks.search("what is a VCP", k=2, embed_fn=_fake_embed)
    assert hits and hits[0]["title"] == "VCP definition"
    assert hits[0]["trader"] == "Minervini"
    assert 0.0 <= hits[0]["score"] <= 1.0001


def test_ask_the_brain_shapes_passages(kb_env):
    bks.reindex(embed_fn=_fake_embed)
    out = bks.ask_the_brain("teach me the VCP", k=2, embed_fn=_fake_embed)
    assert out["ok"] is True
    assert out["passages"][0]["source"].startswith("setup") or out["passages"][0]["title"]
    assert "cite" in out["note"]


def test_ask_the_brain_empty_index(kb_env):
    out = bks.ask_the_brain("anything")
    assert out["ok"] is False and "reindex" in out["reason"]
