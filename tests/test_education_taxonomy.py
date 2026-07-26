"""edu_categories meta table + tags + grouped payload (Desk taxonomy redesign)."""
import importlib
import json

import pytest


@pytest.fixture()
def svc(tmp_path, monkeypatch):
    from api.services import education_service as es
    monkeypatch.setattr(es, "_DB_PATH", str(tmp_path / "education.db"))
    es._init_db()
    return es


def _add(svc, title, category, yt="", **kw):
    return svc.create_video({"youtube_id": yt or f"yt_{title[:8]}", "title": title,
                             "category": category, **kw})


def test_upsert_category_appends_at_tail_within_kind(svc):
    a = svc.upsert_category("Live Trading Sessions", kind="show")
    b = svc.upsert_category("Post-Market Recaps", kind="show")
    c = svc.upsert_category("Options & Flow", kind="library")
    assert a["sort_order"] < b["sort_order"]
    assert [m["name"] for m in svc.list_category_meta()] == [
        "Live Trading Sessions", "Post-Market Recaps", "Options & Flow"]
    assert c["kind"] == "library"


def test_upsert_category_updates_only_provided_fields(svc):
    svc.upsert_category("Interviews", kind="library", blurb="Guests")
    got = svc.upsert_category("Interviews", sort_order=5)
    assert got["blurb"] == "Guests" and got["sort_order"] == 5 and got["kind"] == "library"


def test_upsert_category_rejects_bad_kind(svc):
    with pytest.raises(ValueError):
        svc.upsert_category("X", kind="playlist")


def test_register_category_if_missing_creates_new_at_tail(svc):
    svc.upsert_category("Live Trading Sessions", kind="show")
    svc.register_category_if_missing("Post-Market Recaps", kind="show")
    meta = {m["name"]: m for m in svc.list_category_meta()}
    assert meta["Post-Market Recaps"]["kind"] == "show"
    # appended at the tail of its kind, not clobbering the existing show row
    assert meta["Post-Market Recaps"]["sort_order"] > meta["Live Trading Sessions"]["sort_order"]


def test_register_category_if_missing_never_updates_existing_row(svc):
    svc.upsert_category("Workshops & Fireside Chats", kind="library", sort_order=3, blurb="Recorded workshops")
    svc.register_category_if_missing("Workshops & Fireside Chats", kind="show")
    got = next(m for m in svc.list_category_meta() if m["name"] == "Workshops & Fireside Chats")
    assert got["kind"] == "library"          # NOT flipped to "show"
    assert got["sort_order"] == 3             # untouched
    assert got["blurb"] == "Recorded workshops"  # untouched


def test_set_video_tags_roundtrip(svc):
    v = _add(svc, "Risk 101", "Risk & Trade Management")
    svc.set_video_tags(v["id"], ["risk", "starter"])
    assert json.loads(svc.get_video(v["id"])["tags"]) == ["risk", "starter"]


def test_grouped_payload_orders_shows_first_then_library(svc):
    svc.upsert_category("Live Trading Sessions", kind="show")
    svc.upsert_category("Options & Flow", kind="library")
    _add(svc, "Session Jul 24", "Live Trading Sessions", yt="ltsA")
    _add(svc, "Flow basics", "Options & Flow", yt="oafA")
    out = svc.grouped_videos_payload()
    names = [c["name"] for c in out["categories"]]
    assert names == ["Live Trading Sessions", "Options & Flow"]
    assert out["categories"][0]["kind"] == "show"
    assert out["total"] == 2
    assert out["categories"][1]["videos"][0]["tags"] == []


def test_grouped_payload_strips_heavyweight_fields(svc):
    svc.upsert_category("Live Trading Sessions", kind="show")
    v = _add(svc, "Session Jul 24", "Live Trading Sessions", yt="ltsB")
    svc.set_video_insights(
        v["id"], transcript="x" * 10, chapters=[{"t": 0, "title": "Open"}],
        ticker_moments=[{"ticker": "NVDA", "t": 1}], headline="Recap",
        summary=["bullet"], setups=[{"setup": "VCP"}])
    out = svc.grouped_videos_payload()
    vid = out["categories"][0]["videos"][0]
    for key in ("transcript", "chapters", "ticker_moments", "summary", "setups",
                "key_levels", "meeting_uuid"):
        assert key not in vid
    # cheap/useful fields survive untouched
    assert vid["id"] == v["id"]
    assert vid["youtube_id"] == "ltsB"
    assert vid["title"] == "Session Jul 24"
    assert vid["category"] == "Live Trading Sessions"
    assert vid["tags"] == []
    assert vid["headline"] == "Recap"


def test_grouped_payload_kind_inference_still_uses_meeting_uuid_before_strip(svc):
    # A session video (has meeting_uuid) in an unregistered category should
    # still auto-register that category as kind='show' even though
    # meeting_uuid itself is stripped from the returned video dict.
    v = _add(svc, "Mystery Session", "Tonight", yt="mysC")
    svc.set_meeting_uuid(v["id"], "zoom-uuid-1")
    out = svc.grouped_videos_payload()
    meta = {m["name"]: m for m in svc.list_category_meta()}
    assert meta["Tonight"]["kind"] == "show"
    assert "meeting_uuid" not in out["categories"][0]["videos"][0]


def test_grouped_payload_auto_registers_unknown_category_at_tail(svc):
    svc.upsert_category("Options & Flow", kind="library")
    _add(svc, "Flow basics", "Options & Flow", yt="oafB")
    _add(svc, "Mystery Webinar", "Tonight", yt="mysB")  # no meta row
    out = svc.grouped_videos_payload()
    assert [c["name"] for c in out["categories"]] == ["Options & Flow", "Tonight"]
    meta = {m["name"]: m for m in svc.list_category_meta()}
    assert "Tonight" in meta  # registered so it renders ordered next time


def test_rename_category_moves_rows_and_meta(svc):
    svc.upsert_category("Live Sessions", kind="show")
    svc.upsert_category("Live Trading Sessions", kind="show")
    _add(svc, "Old stream", "Live Sessions", yt="oldC")
    moved = svc.rename_category("Live Sessions", "Live Trading Sessions")
    assert moved == 1
    assert svc.get_video_by_youtube_id("oldC")["category"] == "Live Trading Sessions"
    assert "Live Sessions" not in {m["name"] for m in svc.list_category_meta()}


def test_bulk_apply_taxonomy_transactional(svc):
    v1 = _add(svc, "A", "General", yt="bulkA")
    v2 = _add(svc, "B", "General", yt="bulkB")
    res = svc.bulk_apply_taxonomy(
        categories=[{"name": "Setups & Strategies", "kind": "library",
                     "sort_order": 0, "blurb": "The playbook"}],
        assignments=[{"id": v1["id"], "category": "Setups & Strategies", "tags": ["vcp"]},
                     {"id": v2["id"], "category": "Setups & Strategies", "tags": []},
                     {"id": 99999, "category": "Setups & Strategies", "tags": []}],
    )
    assert res["videos"] == 2 and res["missing_ids"] == [99999]
    assert svc.get_video(v1["id"])["category"] == "Setups & Strategies"
    assert json.loads(svc.get_video(v1["id"])["tags"]) == ["vcp"]


def test_bulk_apply_taxonomy_rolls_back_whole_batch_on_bad_category(svc):
    v3 = _add(svc, "C", "General", yt="bulkC")
    with pytest.raises(ValueError):
        svc.bulk_apply_taxonomy(
            categories=[{"name": "Good Cat", "kind": "show", "sort_order": 0},
                        {"name": "Bad Cat", "kind": "bogus"}],
            assignments=[{"id": v3["id"], "category": "Good Cat", "tags": ["x"]}],
        )
    # Nothing landed: neither category row was created (not even the valid one
    # that appeared first in the list) and the video's category/tags are untouched.
    assert {m["name"] for m in svc.list_category_meta()} == set()
    assert svc.get_video(v3["id"])["category"] == "General"
    assert svc.get_video(v3["id"])["tags"] is None


# ── episode_label (backfill rail, round 6) ────────────────────────────────────

def test_episode_label_column_exists_after_init(svc):
    import contextlib
    with contextlib.closing(svc._connect()) as c:
        cols = {r["name"] for r in c.execute("PRAGMA table_info(edu_videos)")}
    assert "episode_label" in cols


def test_set_video_insights_episode_label_roundtrip(svc):
    v = _add(svc, "Mental Game S12E9", "The Mental Game", yt="epi1")
    svc.set_video_insights(v["id"], episode_label="S12 · E9")
    assert svc.get_video(v["id"])["episode_label"] == "S12 · E9"


def test_set_video_insights_omitting_episode_label_never_clobbers(svc):
    v = _add(svc, "Mental Game S12E9", "The Mental Game", yt="epi2")
    svc.set_video_insights(v["id"], episode_label="S12 · E9")
    svc.set_video_insights(v["id"], headline="A recap")  # episode_label omitted
    got = svc.get_video(v["id"])
    assert got["episode_label"] == "S12 · E9"
    assert got["headline"] == "A recap"


def test_grouped_payload_carries_episode_label(svc):
    v = _add(svc, "Sharpening Trading Skills 42.4", "The Mental Game", yt="epi3")
    svc.set_video_insights(v["id"], episode_label="E42.4")
    out = svc.grouped_videos_payload()
    vid = next(x for c in out["categories"] for x in c["videos"] if x["id"] == v["id"])
    assert vid["episode_label"] == "E42.4"
