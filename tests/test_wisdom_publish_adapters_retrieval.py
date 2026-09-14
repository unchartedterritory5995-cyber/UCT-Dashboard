"""Wisdom retrieval index (FTS5 inside wisdom.db) — publish/retrieval.py.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. an index that refreshes while its switch is off, or writes on a dry run.
2. a refresh that rewrites unchanged documents (not incremental) or misses a change.
3. attendee text indexed, or guest text returned as "UCT said".
4. a superseded source version still answering.
5. a ticker question answered from segments about another ticker.
6. a network or embedding client imported (paid transcripts never leave the box).
"""
from __future__ import annotations

import ast
import pathlib

from api.services.wisdom.core import ids, store
from api.services.wisdom.publish import retrieval
from tests.test_wisdom_publish_adapters_store import add_segment, add_source, seeded, adapters_db  # noqa: F401

REPO = pathlib.Path(__file__).resolve().parents[1]


def _docs():
    with store.read() as conn:
        return {r["doc_id"]: dict(r) for r in conn.execute(
            "SELECT d.doc_id, d.doc_sha256, d.fts_rowid, f.author_id, f.is_guest, f.status, f.tickers "
            "FROM wisdom_retrieval_docs d JOIN wisdom_segments_fts f ON f.rowid = d.fts_rowid")}


def test_refresh_does_nothing_while_its_switch_is_off(seeded, monkeypatch):
    monkeypatch.delenv("WISDOM_RETRIEVAL_INDEX_ENABLED", raising=False)
    out = retrieval.refresh()
    assert "skipped" in out
    assert _docs() == {}
    # control: the same call with the switch on does index
    monkeypatch.setenv("WISDOM_RETRIEVAL_INDEX_ENABLED", "1")
    assert retrieval.refresh()["changed"] > 0 and _docs()


def test_a_dry_run_counts_and_writes_nothing(seeded):
    class Ctx:
        dry_run = True

    out = retrieval.refresh(Ctx(), force=True)
    assert out["dry_run"] is True and out["changed"] == out["docs"] > 0
    assert _docs() == {}


def test_refresh_is_incremental_and_catches_a_changed_text(seeded):
    first = retrieval.refresh(force=True)
    docs = _docs()
    # attendee cue (author NULL) is never indexed; guest is indexed but flagged
    assert "seg:segLIVE2" not in docs
    assert docs["seg:segWORK1"]["is_guest"] == 1 and docs["seg:segLIVE1"]["is_guest"] == 0
    assert "pr:never_add_to_loser" in docs and "pr:guest_bursts" in docs
    # recREJECT (AMD, rejected) must not tag the segment; recCALL_OPEN (NVDA) does
    assert docs["seg:segLIVE1"]["tickers"] == "NVDA"
    assert retrieval.refresh(force=True)["changed"] == 0
    with store.write() as conn:
        text = "Synthetic cue: flat base resolved, now extended."
        conn.execute("UPDATE wisdom_segments SET text = ?, text_sha256 = ? WHERE segment_id = 'segLIVE1'",
                     (text, ids.sha256_text(text)))
    again = retrieval.refresh(force=True)
    assert again["changed"] == 1 and again["removed"] == 0
    assert first["docs"] == again["docs"]
    hits = retrieval.search("extended", for_request=False)
    assert [h["segment_id"] for h in hits] == ["segLIVE1"]


def test_a_superseded_source_version_is_removed(seeded):
    retrieval.refresh(force=True)
    with store.write() as conn:
        add_source(conn, "srcLIVE_v2", "zoom_live", "edu_videos:42", version=2, supersedes_source_id="srcLIVE",
                   media_pointer="ytLIVE42", raw_sha256="v2sha")
        add_segment(conn, "segLIVE1_v2", "srcLIVE_v2", 1, "Synthetic cue v2 about the pivot.", "tsdr",
                    t_start_s=121.0)
    out = retrieval.refresh(force=True)
    assert out["removed"] == 1 and out["changed"] == 1
    assert "seg:segLIVE1" not in _docs() and "seg:segLIVE1_v2" in _docs()


def test_search_filters_guests_ticker_and_status(seeded):
    retrieval.refresh(force=True)
    guest_q = retrieval.search("momentum bursts clusters", for_request=False)
    assert all(h["is_guest"] == 0 for h in guest_q)
    assert any(h["is_guest"] == 1 for h in retrieval.search("momentum bursts", include_guests=True,
                                                             for_request=False))
    nvda = retrieval.search("what did they say", tickers=["nvda"], for_request=False)
    assert nvda and all("NVDA" in h["tickers"].split() for h in nvda)
    # control: a word query for the Discord pass finds the Bracco message
    assert "segDISC1" in {h["segment_id"] for h in retrieval.search("passing relative strength",
                                                                    for_request=False)}
    # the rejected-only record does not make segLIVE1 about AMD
    assert "segLIVE1" not in {h["segment_id"] for h in retrieval.search("", tickers=["AMD"], for_request=False)}


def test_search_never_raises_on_a_missing_index(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "empty.db"))
    store.init_db()  # base only: no adapter migrations, no FTS table
    assert retrieval.search("anything", for_request=False) == []
    assert retrieval.build_match("the and of", ()) == ""


def test_locators_follow_the_interim_s8_grammar(seeded):
    retrieval.refresh(force=True)
    from api.services.wisdom.publish.adapters import common

    hits = retrieval.search("flat base pivot volume", for_request=False)
    assert hits and all(common.LOCATOR_RE.match(h["locator"]) for h in hits)
    assert "@120s" in next(h["locator"] for h in hits if h["segment_id"] == "segLIVE1")


def test_no_network_or_embedding_client_is_imported():
    banned = {"openai", "anthropic", "httpx", "requests", "urllib", "aiohttp", "socket",
              "api.services.brain_kb_service", "api.services.voice_embeddings_service"}
    for rel in ("api/services/wisdom/publish/retrieval.py", "api/services/wisdom/publish/adapters/askai.py",
                "api/services/wisdom/publish/adapters/common.py"):
        path = REPO / rel
        if not path.exists():
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        names = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                names.add(node.module)
                names.update(f"{node.module}.{a.name}" for a in node.names)
        assert not {n for n in names if any(n == b or n.startswith(b + ".") for b in banned)}, rel
        # non-vacuity: the walk sees this module's real imports
        assert any(n.startswith("api.services.wisdom") for n in names), rel
