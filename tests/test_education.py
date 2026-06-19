import os
import tempfile

import pytest

from api.services import education_service as svc
from api.routers.education import extract_youtube_id


@pytest.fixture
def s(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(svc, "_DB_PATH", os.path.join(d, "education.db"))
        svc._init_db()
        yield svc


def _video(**kw):
    return {
        "youtube_id": kw.get("youtube_id", "dQw4w9WgXcQ"),
        "title": kw.get("title", "Intro to the System"),
        "description": kw.get("description", "Start here"),
        "category": kw.get("category", "Getting Started"),
        "duration": kw.get("duration", "12:34"),
        "sort_order": kw.get("sort_order", 0),
    }


# ── Service CRUD ────────────────────────────────────────────────────────────────

def test_create_and_get_video(s):
    created = s.create_video(_video())
    assert created["id"]
    assert created["youtube_id"] == "dQw4w9WgXcQ"
    assert created["category"] == "Getting Started"

    got = s.get_video(created["id"])
    assert got["title"] == "Intro to the System"


def test_list_videos_grouped_order(s):
    s.create_video(_video(category="Charting", title="B", sort_order=1))
    s.create_video(_video(category="Charting", title="A", sort_order=0))
    s.create_video(_video(category="Getting Started", title="C", sort_order=0))
    vids = s.list_videos()
    # category asc, then sort_order asc
    assert [v["title"] for v in vids] == ["A", "B", "C"]


def test_list_categories(s):
    s.create_video(_video(category="Charting"))
    s.create_video(_video(category="Psychology"))
    s.create_video(_video(category="Charting"))
    assert s.list_categories() == ["Charting", "Psychology"]


def test_blank_category_defaults_to_general(s):
    created = s.create_video(_video(category="   "))
    assert created["category"] == "General"


def test_update_video(s):
    created = s.create_video(_video())
    updated = s.update_video(created["id"], {"title": "Renamed", "category": "Advanced"})
    assert updated["title"] == "Renamed"
    assert updated["category"] == "Advanced"


def test_update_missing_returns_none(s):
    assert s.update_video(99999, {"title": "x"}) is None


def test_delete_video(s):
    created = s.create_video(_video())
    assert s.delete_video(created["id"]) is True
    assert s.get_video(created["id"]) is None
    assert s.delete_video(created["id"]) is False


def test_reorder_category(s):
    a = s.create_video(_video(category="Charting", title="A"))
    b = s.create_video(_video(category="Charting", title="B"))
    c = s.create_video(_video(category="Charting", title="C"))
    s.reorder_category("Charting", [c["id"], a["id"], b["id"]])
    vids = [v for v in s.list_videos() if v["category"] == "Charting"]
    assert [v["title"] for v in vids] == ["C", "A", "B"]


# ── YouTube id extraction ───────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
])
def test_extract_youtube_id_valid(raw, expected):
    assert extract_youtube_id(raw) == expected


@pytest.mark.parametrize("raw", ["", "   ", "not a link", "https://example.com/video"])
def test_extract_youtube_id_invalid(raw):
    assert extract_youtube_id(raw) is None
