# tests/api/test_community_seed.py
import json

import pytest


@pytest.fixture
def store(monkeypatch, tmp_path):
    monkeypatch.setenv("COMMUNITY_DB_PATH", str(tmp_path / "community.db"))
    from api.services import community_store
    community_store._init_db()
    return community_store


VIDEO = {"id": 42, "youtube_id": "abcdefghijk", "title": "Live Trading — Jul 9, 2026",
         "category": "Live Trading Sessions"}
INSIGHTS = {"headline": "NVDA breakout walkthrough",
            "summary": ["Opened with breadth read", "NVDA entry at prev-day high"],
            "chapters": [], "ticker_moments": [], "has_transcript": True,
            "has_poster": True}


@pytest.fixture
def seed(monkeypatch, store):
    from api.services import community_seed, education_service
    monkeypatch.setattr(education_service, "get_video", lambda vid: dict(VIDEO))
    monkeypatch.setattr(education_service, "get_video_by_youtube_id",
                        lambda yt: dict(VIDEO) if yt == VIDEO["youtube_id"] else None)
    monkeypatch.setattr(education_service, "get_insights", lambda vid: dict(INSIGHTS))
    return community_seed


def test_seed_creates_mentor_desk_thread(seed, store):
    tid = seed.upsert_desk_thread(42)
    t = store.get_thread(tid)
    assert t["space"] == "mentor-desk"
    assert t["author_id"] is None                 # renders as "UCT Mentor"
    assert t["desk_content_id"] == 42
    assert t["title"] == "Live Trading — Jul 9, 2026"
    body = json.loads(t["body"])
    text = json.dumps(body)
    assert "NVDA breakout walkthrough" in text
    assert "Opened with breadth read" in text


def test_seed_is_idempotent_and_updates(seed, store, monkeypatch):
    t1 = seed.upsert_desk_thread(42)
    from api.services import education_service
    updated = dict(INSIGHTS, headline="REPOLISHED headline")
    monkeypatch.setattr(education_service, "get_insights", lambda vid: updated)
    t2 = seed.upsert_desk_thread(42)
    assert t1 == t2                               # same thread, no duplicate
    assert len(store.list_threads("mentor-desk")) == 1
    assert "REPOLISHED headline" in store.get_thread(t1)["body"]


def test_seed_never_raises(seed, monkeypatch):
    from api.services import education_service
    monkeypatch.setattr(education_service, "get_video",
                        lambda vid: (_ for _ in ()).throw(RuntimeError("boom")))
    assert seed.upsert_desk_thread(42) is None


def test_seed_for_youtube_id(seed, store):
    assert seed.seed_for_youtube_id("abcdefghijk") is not None
    assert seed.seed_for_youtube_id("nope-nope-np") is None
