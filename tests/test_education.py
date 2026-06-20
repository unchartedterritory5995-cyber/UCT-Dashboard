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
    # /live/ and bare /watch/ forms — used across the firm's workshop sheet
    ("https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtube.com/live/dQw4w9WgXcQ?feature=share", "dQw4w9WgXcQ"),
    ("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
])
def test_extract_youtube_id_valid(raw, expected):
    assert extract_youtube_id(raw) == expected


@pytest.mark.parametrize("raw", [
    "", "   ", "not a link", "https://example.com/video",
    "https://x.com/i/spaces/1OdKrXenggpJX",          # X Space — not embeddable
    "https://drive.google.com/file/d/1uKkWclcj3QVrf0ZTm",  # Google Drive
])
def test_extract_youtube_id_invalid(raw):
    assert extract_youtube_id(raw) is None


# ── Seed library (ensure_default_videos) ────────────────────────────────────────

# Categories from the workshop sheet (education_seed.py).
SHEET_CATEGORIES = {
    "Mindset & Psychology",
    "Market Analysis & Breadth",
    "Setups & Strategies",
    "Technical Analysis & Relative Strength",
    "Risk & Trade Management",
    "Scanning, Watchlists & Stock Selection",
    "Options & Flow",
    "Workshops & Fireside Chats",
    "Interviews",
}
# Extra categories introduced by the channel uploads (education_channel_seed.py).
CHANNEL_EXTRA_CATEGORIES = {"Post-Market Recaps", "Live Sessions"}
# Categories from the workbook's other two tabs (education_extra_seed.py):
# "Interviews" already lives in SHEET_CATEGORIES; "The Mental Game" is new.
EXTRA_TAB_CATEGORIES = {"Interviews", "The Mental Game"}
EXPECTED_CATEGORIES = SHEET_CATEGORIES | CHANNEL_EXTRA_CATEGORIES | EXTRA_TAB_CATEGORIES


def test_seed_module_is_well_formed():
    from api.services.education_seed import SEED_VIDEOS
    assert len(SEED_VIDEOS) >= 130
    seen = set()
    for v in SEED_VIDEOS:
        assert len(v["youtube_id"]) == 11
        assert v["title"].strip()
        assert v["category"] in SHEET_CATEGORIES
        assert v["youtube_id"] not in seen, f"duplicate {v['youtube_id']}"
        seen.add(v["youtube_id"])


def test_channel_seed_module_is_well_formed():
    from api.services.education_channel_seed import SEED_VIDEOS_CHANNEL
    assert len(SEED_VIDEOS_CHANNEL) >= 50
    seen = set()
    for v in SEED_VIDEOS_CHANNEL:
        assert len(v["youtube_id"]) == 11
        assert v["title"].strip()
        assert v["category"] in EXPECTED_CATEGORIES
        assert v["youtube_id"] not in seen, f"duplicate {v['youtube_id']}"
        seen.add(v["youtube_id"])


def test_extra_seed_module_is_well_formed():
    from api.services.education_extra_seed import SEED_VIDEOS_EXTRA
    assert len(SEED_VIDEOS_EXTRA) >= 50
    cats = set()
    seen = set()
    for v in SEED_VIDEOS_EXTRA:
        assert len(v["youtube_id"]) == 11
        assert v["title"].strip()
        assert v["category"] in EXTRA_TAB_CATEGORIES
        assert v["youtube_id"] not in seen, f"duplicate {v['youtube_id']}"
        seen.add(v["youtube_id"])
        cats.add(v["category"])
    # both tabs represented
    assert cats == EXTRA_TAB_CATEGORIES


def test_ensure_default_videos_seeds_and_is_idempotent(s):
    from api.services.education_seed import SEED_VIDEOS
    from api.services.education_channel_seed import SEED_VIDEOS_CHANNEL
    from api.services.education_extra_seed import SEED_VIDEOS_EXTRA
    total = len({v["youtube_id"] for v in (*SEED_VIDEOS, *SEED_VIDEOS_CHANNEL, *SEED_VIDEOS_EXTRA)})
    s.ensure_default_videos()
    first = s.list_videos()
    assert len(first) == total
    assert set(s.list_categories()) == EXPECTED_CATEGORIES

    # Re-run on the next "boot" — never duplicates.
    s.ensure_default_videos()
    assert len(s.list_videos()) == total


def test_ensure_default_videos_never_clobbers_admin_edits(s):
    s.ensure_default_videos()
    v = s.list_videos()[0]
    s.update_video(v["id"], {"category": "My Custom Shelf", "title": "Admin Retitled"})

    # A later boot must leave the admin's edit intact (matched by youtube_id).
    s.ensure_default_videos()
    again = s.get_video(v["id"])
    assert again["category"] == "My Custom Shelf"
    assert again["title"] == "Admin Retitled"
    # And it didn't re-insert a duplicate of that youtube_id.
    same_yt = [x for x in s.list_videos() if x["youtube_id"] == v["youtube_id"]]
    assert len(same_yt) == 1


def test_migrate_seed_categories_renames_old_name(s):
    from api.services.education_seed import SEED_VIDEOS
    seed_yt = SEED_VIDEOS[0]["youtube_id"]
    # Simulate a prod row seeded under the OLD category name + an unrelated
    # admin video that happens to share the old name (must NOT be touched).
    s.create_video(_video(youtube_id=seed_yt, category="Guest Sessions & Interviews"))
    s.create_video(_video(youtube_id="zzzZZZ12345", category="Guest Sessions & Interviews"))

    s._migrate_seed_categories_once()

    seed_row = [x for x in s.list_videos() if x["youtube_id"] == seed_yt][0]
    admin_row = [x for x in s.list_videos() if x["youtube_id"] == "zzzZZZ12345"][0]
    assert seed_row["category"] == "Interviews"            # seed video renamed
    assert admin_row["category"] == "Guest Sessions & Interviews"  # non-seed untouched


# ── Watch progress (cross-device) ────────────────────────────────────────────

def test_progress_upsert_and_get(s):
    s.upsert_progress("u1", "vid1111aaaa", 30, duration=120)
    rows = s.get_user_progress("u1")
    assert len(rows) == 1
    assert rows[0]["youtube_id"] == "vid1111aaaa"
    assert rows[0]["position"] == 30
    assert rows[0]["duration"] == 120
    assert rows[0]["done"] == 0


def test_progress_done_is_sticky_and_duration_monotonic(s):
    s.upsert_progress("u1", "vidX", 110, duration=120, done=True)
    s.upsert_progress("u1", "vidX", 5, duration=0, done=False)  # rewatch start, stale dur
    row = s.get_user_progress("u1")[0]
    assert row["position"] == 5          # latest position wins
    assert row["duration"] == 120        # duration never shrinks
    assert row["done"] == 1              # done stays sticky


def test_progress_is_per_user(s):
    s.upsert_progress("u1", "vidA", 10, duration=100)
    s.upsert_progress("u2", "vidA", 50, duration=100)
    assert s.get_user_progress("u1")[0]["position"] == 10
    assert s.get_user_progress("u2")[0]["position"] == 50
