"""edu_paths / edu_path_steps schema + service CRUD + seed migration
(Desk Courses Track 1, Task 1). Mirrors tests/test_education_taxonomy.py."""
import contextlib
import os

import pytest


@pytest.fixture()
def svc(tmp_path, monkeypatch):
    from api.services import education_service as es
    monkeypatch.setattr(es, "_DB_PATH", str(tmp_path / "education.db"))
    es._init_db()
    return es


def _path(svc, slug="foundations", **kw):
    payload = {
        "slug": slug,
        "name": kw.get("name", "Foundations"),
        "blurb": kw.get("blurb", "The basics."),
        "kind": kw.get("kind", "track"),
        "sort_order": kw.get("sort_order", 0),
    }
    if "enabled" in kw:
        payload["enabled"] = kw["enabled"]
    return svc.create_path(payload)


# ── Schema ─────────────────────────────────────────────────────────────────

def test_schema_creates_edu_paths_and_steps_tables(svc):
    with contextlib.closing(svc._connect()) as c:
        tables = {r["name"] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "edu_paths" in tables
    assert "edu_path_steps" in tables


def test_delete_path_cascades_steps(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"youtube_id": "abc12345678"}])
    with contextlib.closing(svc._connect()) as c:
        before = c.execute(
            "SELECT COUNT(*) AS n FROM edu_path_steps WHERE path_id = ?",
            (p["id"],)).fetchone()["n"]
        assert before == 1
    assert svc.delete_path(p["id"]) is True
    with contextlib.closing(svc._connect()) as c:
        after = c.execute(
            "SELECT COUNT(*) AS n FROM edu_path_steps WHERE path_id = ?",
            (p["id"],)).fetchone()["n"]
    assert after == 0


def test_delete_missing_path_returns_false(svc):
    assert svc.delete_path(99999) is False


# ── create_path validation ───────────────────────────────────────────────────

def test_create_path_requires_slug(svc):
    with pytest.raises(ValueError):
        svc.create_path({"name": "X"})


def test_create_path_requires_name(svc):
    with pytest.raises(ValueError):
        svc.create_path({"slug": "x"})


def test_create_path_rejects_non_kebab_slug(svc):
    with pytest.raises(ValueError):
        svc.create_path({"slug": "Not Kebab!", "name": "X"})


def test_create_path_rejects_slug_collision(svc):
    _path(svc, slug="risk")
    with pytest.raises(ValueError):
        _path(svc, slug="risk", name="Risk 2")


def test_create_path_rejects_bad_kind(svc):
    with pytest.raises(ValueError):
        svc.create_path({"slug": "x", "name": "X", "kind": "bogus"})


def test_create_path_defaults(svc):
    p = _path(svc, slug="x", name="X")
    assert p["kind"] == "track"
    assert p["enabled"] == 1
    assert p["sort_order"] == 0
    assert p["steps"] == []


# ── update_path ──────────────────────────────────────────────────────────────

def test_update_path_partial(svc):
    p = _path(svc)
    updated = svc.update_path(p["id"], {"name": "Renamed", "enabled": False})
    assert updated["name"] == "Renamed"
    assert updated["enabled"] == 0
    assert updated["slug"] == p["slug"]  # untouched


def test_update_path_slug_immutable(svc):
    p = _path(svc)
    updated = svc.update_path(p["id"], {"slug": "different", "name": "Still Foundations"})
    assert updated["slug"] == p["slug"]  # 'slug' silently ignored (not a patchable field)


def test_update_missing_path_returns_none(svc):
    assert svc.update_path(99999, {"name": "x"}) is None


def test_update_path_rejects_bad_kind(svc):
    p = _path(svc)
    with pytest.raises(ValueError):
        svc.update_path(p["id"], {"kind": "bogus"})


def test_update_path_rejects_blank_name(svc):
    p = _path(svc)
    with pytest.raises(ValueError):
        svc.update_path(p["id"], {"name": "   "})


def test_update_path_kind_none_raises(svc):
    # kind is NOT NULL — an explicit null must raise ValueError (→ 400 at the
    # router), not fall through to an uncaught sqlite3.IntegrityError.
    p = _path(svc)
    with pytest.raises(ValueError):
        svc.update_path(p["id"], {"kind": None})
    assert svc.get_path(p["id"])["kind"] == "track"  # nothing landed


def test_update_path_sort_order_none_raises(svc):
    p = _path(svc)
    with pytest.raises(ValueError):
        svc.update_path(p["id"], {"sort_order": None})
    assert svc.get_path(p["id"])["sort_order"] == 0  # nothing landed


def test_update_path_enabled_none_is_ignored_not_disabled(svc):
    p = _path(svc)
    assert p["enabled"] == 1
    updated = svc.update_path(p["id"], {"name": "Renamed", "enabled": None})
    assert updated["name"] == "Renamed"
    assert updated["enabled"] == 1  # untouched, NOT coerced to 0


def test_update_path_enabled_none_alone_is_full_noop(svc):
    p = _path(svc)
    updated = svc.update_path(p["id"], {"enabled": None})
    assert updated == svc.get_path(p["id"])
    assert updated["enabled"] == 1


# ── list_paths ordering + shape ──────────────────────────────────────────────

def test_list_paths_orders_course_first_then_sort_order_then_name(svc):
    _path(svc, slug="t2", name="Zed Track", kind="track", sort_order=0)
    _path(svc, slug="t1", name="Alpha Track", kind="track", sort_order=1)
    _path(svc, slug="c1", name="Beta Course", kind="course", sort_order=5)
    names = [p["name"] for p in svc.list_paths()]
    assert names == ["Beta Course", "Zed Track", "Alpha Track"]


def test_list_paths_excludes_disabled_by_default(svc):
    p = _path(svc, slug="off", enabled=False)
    assert p["id"] not in [x["id"] for x in svc.list_paths()]
    assert p["id"] in [x["id"] for x in svc.list_paths(include_disabled=True)]


def test_list_paths_includes_ordered_steps(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [
        {"youtube_id": "bbbbbbbbbbb", "module_label": "M2"},
        {"youtube_id": "aaaaaaaaaaa", "module_label": "M1"},
    ])
    got = next(x for x in svc.list_paths() if x["id"] == p["id"])
    assert [s["youtube_id"] for s in got["steps"]] == ["bbbbbbbbbbb", "aaaaaaaaaaa"]
    assert got["steps"][0]["module_label"] == "M2"


def test_get_path_returns_none_when_missing(svc):
    assert svc.get_path(99999) is None


# ── replace_path_steps ──────────────────────────────────────────────────────

def test_replace_path_steps_orders_from_array_order(svc):
    p = _path(svc)
    n = svc.replace_path_steps(p["id"], [
        {"youtube_id": "zzzzzzzzzzz"},
        {"youtube_id": "aaaaaaaaaaa"},
        {"youtube_id": "mmmmmmmmmmm"},
    ])
    assert n == 3
    got = svc.get_path(p["id"])
    assert [s["youtube_id"] for s in got["steps"]] == \
        ["zzzzzzzzzzz", "aaaaaaaaaaa", "mmmmmmmmmmm"]


def test_replace_path_steps_is_full_replacement(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"youtube_id": "aaaaaaaaaaa"}, {"youtube_id": "bbbbbbbbbbb"}])
    svc.replace_path_steps(p["id"], [{"youtube_id": "ccccccccccc"}])
    got = svc.get_path(p["id"])
    assert [s["youtube_id"] for s in got["steps"]] == ["ccccccccccc"]


def test_replace_path_steps_rejects_empty_youtube_id_and_leaves_existing_untouched(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"youtube_id": "aaaaaaaaaaa"}])
    with pytest.raises(ValueError):
        svc.replace_path_steps(p["id"], [{"youtube_id": "bbbbbbbbbbb"}, {"youtube_id": ""}])
    # Nothing landed: the pre-existing step is exactly as it was.
    assert [s["youtube_id"] for s in svc.get_path(p["id"])["steps"]] == ["aaaaaaaaaaa"]


def test_replace_path_steps_missing_path_raises(svc):
    with pytest.raises(ValueError):
        svc.replace_path_steps(99999, [{"youtube_id": "aaaaaaaaaaa"}])


def test_replace_path_steps_can_clear_to_empty(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"youtube_id": "aaaaaaaaaaa"}])
    n = svc.replace_path_steps(p["id"], [])
    assert n == 0
    assert svc.get_path(p["id"])["steps"] == []


# ── start_seconds / end_seconds (lesson clip window) ─────────────────────────

def _step_cols(svc):
    with contextlib.closing(svc._connect()) as c:
        return {r["name"] for r in c.execute("PRAGMA table_info(edu_path_steps)")}


def test_path_steps_schema_has_start_end_seconds_columns(svc):
    cols = _step_cols(svc)
    assert "start_seconds" in cols
    assert "end_seconds" in cols


def test_init_db_alters_start_end_onto_a_pre_existing_table(tmp_path, monkeypatch):
    """An existing DB created before the columns landed gets them ALTER-added
    on the next _init_db() boot (the edu_videos _EXTRA_COLUMNS idiom)."""
    import sqlite3
    from api.services import education_service as es
    db = str(tmp_path / "old.db")
    with contextlib.closing(sqlite3.connect(db)) as c:
        c.execute("""CREATE TABLE edu_path_steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path_id INTEGER NOT NULL,
            youtube_id TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            module_label TEXT,
            note TEXT)""")
        c.execute("""INSERT INTO edu_path_steps (path_id, youtube_id, sort_order)
                     VALUES (1, 'aaaaaaaaaaa', 0)""")
        c.commit()
    monkeypatch.setattr(es, "_DB_PATH", db)
    es._init_db()
    with contextlib.closing(es._connect()) as c:
        cols = {r["name"] for r in c.execute("PRAGMA table_info(edu_path_steps)")}
        assert {"start_seconds", "end_seconds"} <= cols
        row = c.execute("SELECT start_seconds, end_seconds FROM edu_path_steps").fetchone()
    assert row["start_seconds"] is None and row["end_seconds"] is None  # old rows untouched


def test_replace_path_steps_round_trips_start_end_seconds(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [
        {"youtube_id": "aaaaaaaaaaa", "start_seconds": 1340, "end_seconds": 2465},
        {"youtube_id": "bbbbbbbbbbb"},  # omitted → NULL, not 0
        {"youtube_id": "ccccccccccc", "start_seconds": 0},  # 0 is a valid start
    ])
    steps = svc.get_path(p["id"])["steps"]
    assert steps[0]["start_seconds"] == 1340 and steps[0]["end_seconds"] == 2465
    assert steps[1]["start_seconds"] is None and steps[1]["end_seconds"] is None
    assert steps[2]["start_seconds"] == 0 and steps[2]["end_seconds"] is None


def test_list_paths_steps_carry_start_end_seconds(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"youtube_id": "aaaaaaaaaaa", "start_seconds": 90}])
    got = next(x for x in svc.list_paths() if x["id"] == p["id"])
    assert got["steps"][0]["start_seconds"] == 90
    assert got["steps"][0]["end_seconds"] is None


@pytest.mark.parametrize("bad", [
    {"start_seconds": -1},
    {"end_seconds": -5},
    {"start_seconds": 12.5},
    {"start_seconds": "1340"},
    {"start_seconds": True},
    {"start_seconds": 100, "end_seconds": 100},  # end must be strictly greater
    {"start_seconds": 100, "end_seconds": 40},
])
def test_replace_path_steps_rejects_bad_seconds_and_leaves_existing_untouched(svc, bad):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"youtube_id": "aaaaaaaaaaa", "start_seconds": 5}])
    with pytest.raises(ValueError):
        svc.replace_path_steps(p["id"], [dict({"youtube_id": "bbbbbbbbbbb"}, **bad)])
    # validate-before-write: the pre-existing step is exactly as it was
    steps = svc.get_path(p["id"])["steps"]
    assert [s["youtube_id"] for s in steps] == ["aaaaaaaaaaa"]
    assert steps[0]["start_seconds"] == 5


def test_replace_path_steps_end_seconds_alone_is_valid(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"youtube_id": "aaaaaaaaaaa", "end_seconds": 300}])
    steps = svc.get_path(p["id"])["steps"]
    assert steps[0]["start_seconds"] is None and steps[0]["end_seconds"] == 300


# ── bulk_apply_paths ─────────────────────────────────────────────────────────

def test_bulk_apply_paths_upserts_by_slug_and_replaces_steps(svc):
    res = svc.bulk_apply_paths([
        {"slug": "foundations", "name": "Foundations", "blurb": "b1", "kind": "track",
         "sort_order": 0, "enabled": True,
         "steps": [{"youtube_id": "aaaaaaaaaaa"}, {"youtube_id": "bbbbbbbbbbb"}]},
    ])
    assert res == {"paths": 1, "steps": 2}
    p = next(x for x in svc.list_paths() if x["slug"] == "foundations")
    assert [s["youtube_id"] for s in p["steps"]] == ["aaaaaaaaaaa", "bbbbbbbbbbb"]

    # Re-apply with a different name/steps — upserts (same row id), replaces steps.
    res2 = svc.bulk_apply_paths([
        {"slug": "foundations", "name": "Foundations Renamed", "kind": "track",
         "steps": [{"youtube_id": "ccccccccccc"}]},
    ])
    assert res2 == {"paths": 1, "steps": 1}
    p2 = next(x for x in svc.list_paths() if x["slug"] == "foundations")
    assert p2["id"] == p["id"]
    assert p2["name"] == "Foundations Renamed"
    assert [s["youtube_id"] for s in p2["steps"]] == ["ccccccccccc"]


def test_bulk_apply_paths_rolls_back_whole_batch_on_bad_slug(svc):
    _path(svc, slug="existing", name="Existing")
    with pytest.raises(ValueError):
        svc.bulk_apply_paths([
            {"slug": "good-one", "name": "Good", "kind": "track",
             "steps": [{"youtube_id": "aaaaaaaaaaa"}]},
            {"slug": "bad one!", "name": "Bad slug", "kind": "track", "steps": []},
        ])
    # Nothing landed: the valid entry earlier in the list didn't get created
    # either, and the pre-existing path is completely untouched.
    paths = svc.list_paths(include_disabled=True)
    slugs = {p["slug"] for p in paths}
    assert "good-one" not in slugs
    assert slugs == {"existing"}
    existing = next(p for p in paths if p["slug"] == "existing")
    assert existing["name"] == "Existing"
    assert existing["steps"] == []


def test_bulk_apply_paths_rolls_back_whole_batch_on_bad_step(svc):
    with pytest.raises(ValueError):
        svc.bulk_apply_paths([
            {"slug": "x", "name": "X", "kind": "track",
             "steps": [{"youtube_id": ""}]},
        ])
    assert svc.list_paths(include_disabled=True) == []


def test_bulk_apply_paths_empty_list_is_noop(svc):
    assert svc.bulk_apply_paths([]) == {"paths": 0, "steps": 0}


def test_bulk_apply_paths_carries_start_end_seconds(svc):
    svc.bulk_apply_paths([
        {"slug": "clips", "name": "Clips", "kind": "track",
         "steps": [{"youtube_id": "aaaaaaaaaaa", "start_seconds": 1340, "end_seconds": 2465},
                   {"youtube_id": "bbbbbbbbbbb"}]},
    ])
    p = next(x for x in svc.list_paths() if x["slug"] == "clips")
    assert p["steps"][0]["start_seconds"] == 1340
    assert p["steps"][0]["end_seconds"] == 2465
    assert p["steps"][1]["start_seconds"] is None


def test_bulk_apply_paths_rolls_back_whole_batch_on_bad_seconds(svc):
    with pytest.raises(ValueError):
        svc.bulk_apply_paths([
            {"slug": "good", "name": "Good", "kind": "track",
             "steps": [{"youtube_id": "aaaaaaaaaaa", "start_seconds": 10}]},
            {"slug": "bad", "name": "Bad", "kind": "track",
             "steps": [{"youtube_id": "bbbbbbbbbbb", "start_seconds": 50, "end_seconds": 20}]},
        ])
    assert svc.list_paths(include_disabled=True) == []


# ── ensure_default_paths (flag-file one-shot migration) ──────────────────────

def test_ensure_default_paths_seeds_exactly_six_once(svc):
    from api.services.education_paths_seed import SEED_PATHS
    assert len(SEED_PATHS) == 6
    svc.ensure_default_paths()
    paths = svc.list_paths(include_disabled=True)
    assert len(paths) == 6
    assert all(p["kind"] == "track" for p in paths)
    assert all(p["enabled"] == 1 for p in paths)
    got_slugs_by_sort = [p["slug"] for p in sorted(paths, key=lambda x: x["sort_order"])]
    assert got_slugs_by_sort == [p["slug"] for p in SEED_PATHS]

    # Re-run on the next "boot" — flag file blocks a re-check entirely, no dup.
    svc.ensure_default_paths()
    assert len(svc.list_paths(include_disabled=True)) == 6


def test_ensure_default_paths_seeds_steps_in_file_order(svc):
    from api.services.education_paths_seed import SEED_PATHS
    svc.ensure_default_paths()
    expected = next(x for x in SEED_PATHS if x["slug"] == "foundations")
    p = next(x for x in svc.list_paths(include_disabled=True) if x["slug"] == "foundations")
    assert [s["youtube_id"] for s in p["steps"]] == expected["steps"]


def test_ensure_default_paths_respects_existing_flag_file(svc):
    flag = os.path.join(os.path.dirname(svc._DB_PATH), ".edu_paths_migrate_v1")
    with open(flag, "w") as f:
        f.write("v1")
    svc.ensure_default_paths()
    assert svc.list_paths(include_disabled=True) == []


def test_ensure_default_paths_respects_nonempty_table_no_dup(svc):
    _path(svc, slug="custom", name="Admin's own path")
    svc.ensure_default_paths()
    paths = svc.list_paths(include_disabled=True)
    # Table was non-empty (an admin/prior boot already added a path) → seed
    # skipped entirely — but the flag is still written so future boots never
    # re-check (and never fight the admin's edits).
    assert [p["slug"] for p in paths] == ["custom"]
    flag = os.path.join(os.path.dirname(svc._DB_PATH), ".edu_paths_migrate_v1")
    assert os.path.exists(flag)


# ── Planned lessons ("to be recorded" slots — 2026-07-27) ─────────────────────

def test_planned_step_stores_gap_sentinel_and_round_trips(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [
        {"youtube_id": "real1234567", "note": "watch this"},
        {"planned_title": "Reading the Regime Dial", "note": "to record",
         "module_label": "M3"},
    ])
    steps = svc.list_paths(include_disabled=True)[0]["steps"]
    assert steps[0]["planned_title"] is None
    assert steps[1] == {"youtube_id": "gap:1", "module_label": "M3",
                        "note": "to record", "start_seconds": None,
                        "end_seconds": None, "script": None,
                        "planned_title": "Reading the Regime Dial"}


def test_planned_step_with_real_youtube_id_is_ambiguous_and_rejected(svc):
    p = _path(svc)
    with pytest.raises(ValueError, match="both youtube_id and planned_title"):
        svc.replace_path_steps(p["id"], [
            {"youtube_id": "realvid12345", "planned_title": "Planned"},
        ])


def test_planned_step_gap_echo_renormalizes_to_position(svc):
    # A GET echo sends the stored gap:<pos> back — legitimate, and the
    # sentinel re-derives from the CURRENT position after any reorder.
    p = _path(svc)
    svc.replace_path_steps(p["id"], [
        {"youtube_id": "gap:5", "planned_title": "Planned"},
    ])
    step = svc.list_paths(include_disabled=True)[0]["steps"][0]
    assert step["youtube_id"] == "gap:0"


def test_planned_step_clears_clip_window(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [
        {"planned_title": "Planned", "start_seconds": 90, "end_seconds": 300},
    ])
    step = svc.list_paths(include_disabled=True)[0]["steps"][0]
    assert step["start_seconds"] is None and step["end_seconds"] is None


def test_gap_sentinel_without_planned_title_rejected(svc):
    p = _path(svc)
    with pytest.raises(ValueError, match="planned_title"):
        svc.replace_path_steps(p["id"], [{"youtube_id": "gap:0"}])


def test_empty_step_still_rejected(svc):
    p = _path(svc)
    with pytest.raises(ValueError, match="youtube_id"):
        svc.replace_path_steps(p["id"], [{"planned_title": "   "}])


def test_attach_video_converts_planned_row(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"planned_title": "Planned"}])
    svc.replace_path_steps(p["id"], [
        {"youtube_id": "recorded1234", "note": "now real", "planned_title": None},
    ])
    step = svc.list_paths(include_disabled=True)[0]["steps"][0]
    assert step["youtube_id"] == "recorded1234" and step["planned_title"] is None


def test_bulk_apply_paths_carries_planned_steps(svc):
    svc.bulk_apply_paths([
        {"slug": "draft-course", "name": "Draft", "kind": "course", "enabled": False,
         "steps": [
             {"youtube_id": "real1234567", "module_label": "M1"},
             {"planned_title": "Gap Lesson", "module_label": "M1", "note": "brief"},
         ]},
    ])
    p = svc.list_paths(include_disabled=True)[0]
    assert p["enabled"] == 0
    assert p["steps"][1]["planned_title"] == "Gap Lesson"
    assert p["steps"][1]["youtube_id"] == "gap:1"


def test_bulk_apply_paths_planned_validation_is_all_or_nothing(svc):
    svc.bulk_apply_paths([
        {"slug": "keep", "name": "Keep", "kind": "track",
         "steps": [{"youtube_id": "ok123456789"}]},
    ])
    with pytest.raises(ValueError):
        svc.bulk_apply_paths([
            {"slug": "keep", "name": "Clobbered", "kind": "track",
             "steps": [{"planned_title": "fine"}]},
            {"slug": "bad", "name": "Bad", "kind": "track",
             "steps": [{"youtube_id": "gap:9"}]},
        ])
    p = svc.list_paths(include_disabled=True)[0]
    assert p["name"] == "Keep" and p["steps"][0]["youtube_id"] == "ok123456789"


def test_init_db_alters_planned_title_onto_a_pre_existing_table(tmp_path, monkeypatch):
    import sqlite3
    from api.services import education_service as es
    db = str(tmp_path / "edu-old.db")
    with contextlib.closing(sqlite3.connect(db)) as c:
        c.executescript("""
            CREATE TABLE edu_paths (id INTEGER PRIMARY KEY, slug TEXT UNIQUE,
                name TEXT NOT NULL, blurb TEXT, kind TEXT NOT NULL DEFAULT 'track',
                sort_order INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL, updated_at INTEGER);
            CREATE TABLE edu_path_steps (id INTEGER PRIMARY KEY,
                path_id INTEGER NOT NULL REFERENCES edu_paths(id) ON DELETE CASCADE,
                youtube_id TEXT NOT NULL, sort_order INTEGER NOT NULL,
                module_label TEXT, note TEXT);
        """)
        c.commit()
    monkeypatch.setattr(es, "_DB_PATH", db)
    es._init_db()
    with contextlib.closing(es._connect()) as c:
        cols = {r["name"] for r in c.execute("PRAGMA table_info(edu_path_steps)")}
    assert "planned_title" in cols and "start_seconds" in cols


# ── bulk_apply enabled tri-state (draft-safety, 2026-07-27 review fix) ───────

def test_bulk_apply_omitted_enabled_preserves_draft_state(svc):
    svc.bulk_apply_paths([
        {"slug": "draft", "name": "Draft", "kind": "course", "enabled": False,
         "steps": [{"youtube_id": "ok123456789"}]},
    ])
    # A steps-only re-apply (no enabled key) must NOT publish the draft.
    svc.bulk_apply_paths([
        {"slug": "draft", "name": "Draft v2", "kind": "course",
         "steps": [{"youtube_id": "ok123456789"}, {"youtube_id": "ok223456789"}]},
    ])
    p = svc.list_paths(include_disabled=True)[0]
    assert p["enabled"] == 0 and p["name"] == "Draft v2" and len(p["steps"]) == 2
    assert svc.list_paths() == []


def test_bulk_apply_none_enabled_preserves_live_state(svc):
    svc.bulk_apply_paths([
        {"slug": "live", "name": "Live", "kind": "track", "enabled": True,
         "steps": [{"youtube_id": "ok123456789"}]},
    ])
    # Explicit None (a JSON null) is "not specified", NEVER "disable".
    svc.bulk_apply_paths([
        {"slug": "live", "name": "Live", "kind": "track", "enabled": None,
         "steps": [{"youtube_id": "ok123456789"}]},
    ])
    assert svc.list_paths()[0]["enabled"] == 1


def test_bulk_apply_explicit_enabled_still_sets_both_ways(svc):
    svc.bulk_apply_paths([
        {"slug": "p", "name": "P", "kind": "track", "enabled": False,
         "steps": [{"youtube_id": "ok123456789"}]},
    ])
    svc.bulk_apply_paths([
        {"slug": "p", "name": "P", "kind": "track", "enabled": True,
         "steps": [{"youtube_id": "ok123456789"}]},
    ])
    assert svc.list_paths()[0]["enabled"] == 1
    svc.bulk_apply_paths([
        {"slug": "p", "name": "P", "kind": "track", "enabled": False,
         "steps": [{"youtube_id": "ok123456789"}]},
    ])
    assert svc.list_paths() == []


def test_bulk_apply_new_path_without_enabled_defaults_live(svc):
    svc.bulk_apply_paths([
        {"slug": "fresh", "name": "Fresh", "kind": "track",
         "steps": [{"youtube_id": "ok123456789"}]},
    ])
    assert svc.list_paths()[0]["enabled"] == 1


# ── Production script + course dossier (2026-07-27) ─────────────────────────

def test_step_script_round_trips(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [
        {"planned_title": "Lesson A", "script": '{"chapters":[{"marker":"Hook"}]}'},
        {"youtube_id": "real1234567"},
    ])
    steps = svc.get_path(p["id"])["steps"]
    assert steps[0]["script"] == '{"chapters":[{"marker":"Hook"}]}'
    assert steps[1]["script"] is None


def test_bulk_apply_carries_step_script_and_dossier(svc):
    svc.bulk_apply_paths([
        {"slug": "prog", "name": "Program", "kind": "course", "enabled": False,
         "dossier": '{"brief":"read me"}',
         "steps": [{"planned_title": "L1", "script": '{"chapters":[1,2,3,4,5]}'}]},
    ])
    p = svc.list_paths(include_disabled=True)[0]
    assert p["dossier"] == '{"brief":"read me"}'
    assert p["steps"][0]["script"] == '{"chapters":[1,2,3,4,5]}'


def test_bulk_apply_omitted_dossier_preserves_stored_one(svc):
    svc.bulk_apply_paths([
        {"slug": "prog", "name": "Program", "kind": "course", "enabled": False,
         "dossier": '{"brief":"keep me"}', "steps": [{"planned_title": "L1"}]},
    ])
    # A steps-only re-apply must not wipe the dossier (same tri-state rule as enabled).
    svc.bulk_apply_paths([
        {"slug": "prog", "name": "Program v2", "kind": "course",
         "steps": [{"planned_title": "L1"}, {"planned_title": "L2"}]},
    ])
    p = svc.list_paths(include_disabled=True)[0]
    assert p["dossier"] == '{"brief":"keep me"}'
    assert p["name"] == "Program v2" and p["enabled"] == 0


def test_new_path_without_dossier_is_null(svc):
    svc.bulk_apply_paths([
        {"slug": "plain", "name": "Plain", "kind": "track",
         "steps": [{"youtube_id": "ok123456789"}]},
    ])
    assert svc.list_paths()[0]["dossier"] is None


def test_init_db_alters_script_and_dossier_onto_pre_existing_tables(tmp_path, monkeypatch):
    import sqlite3
    from api.services import education_service as es
    db = str(tmp_path / "edu-old2.db")
    with contextlib.closing(sqlite3.connect(db)) as c:
        c.executescript("""
            CREATE TABLE edu_paths (id INTEGER PRIMARY KEY, slug TEXT UNIQUE,
                name TEXT NOT NULL, blurb TEXT, kind TEXT NOT NULL DEFAULT 'track',
                sort_order INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL, updated_at INTEGER);
            CREATE TABLE edu_path_steps (id INTEGER PRIMARY KEY,
                path_id INTEGER NOT NULL REFERENCES edu_paths(id) ON DELETE CASCADE,
                youtube_id TEXT NOT NULL, sort_order INTEGER NOT NULL,
                module_label TEXT, note TEXT);
        """)
        c.commit()
    monkeypatch.setattr(es, "_DB_PATH", db)
    es._init_db()
    with contextlib.closing(es._connect()) as c:
        step_cols = {r["name"] for r in c.execute("PRAGMA table_info(edu_path_steps)")}
        path_cols = {r["name"] for r in c.execute("PRAGMA table_info(edu_paths)")}
    assert "script" in step_cols and "planned_title" in step_cols
    assert "dossier" in path_cols


# ── script preserve-on-omit (closeout review, CRITICAL) ─────────────────────

def test_apply_without_script_preserves_stored_scripts(svc):
    """The catastrophic case: any apply that doesn't mention scripts (e.g. the
    curriculum converter, which emits none) must NOT wipe them."""
    svc.bulk_apply_paths([
        {"slug": "prog", "name": "Program", "kind": "course", "enabled": False, "steps": [
            {"planned_title": "L1", "script": '{"chapters":[1]}'},
            {"planned_title": "L2", "script": '{"chapters":[2]}'},
            {"youtube_id": "vid11111111", "script": '{"chapters":[3]}'},
        ]},
    ])
    # Re-apply the SAME structure with no script key anywhere.
    svc.bulk_apply_paths([
        {"slug": "prog", "name": "Program", "kind": "course", "steps": [
            {"planned_title": "L1"},
            {"planned_title": "L2"},
            {"youtube_id": "vid11111111"},
        ]},
    ])
    steps = svc.list_paths(include_disabled=True)[0]["steps"]
    assert [s["script"] for s in steps] == [
        '{"chapters":[1]}', '{"chapters":[2]}', '{"chapters":[3]}']


def test_scripts_survive_reorder_and_follow_their_lesson(svc):
    svc.bulk_apply_paths([
        {"slug": "prog", "name": "P", "kind": "course", "steps": [
            {"planned_title": "A", "script": "SA"},
            {"planned_title": "B", "script": "SB"},
        ]},
    ])
    svc.bulk_apply_paths([
        {"slug": "prog", "name": "P", "kind": "course", "steps": [
            {"planned_title": "B"}, {"planned_title": "A"},
        ]},
    ])
    steps = svc.list_paths(include_disabled=True)[0]["steps"]
    assert [(s["planned_title"], s["script"]) for s in steps] == [("B", "SB"), ("A", "SA")]


def test_empty_string_script_explicitly_clears(svc):
    svc.bulk_apply_paths([
        {"slug": "p", "name": "P", "kind": "course",
         "steps": [{"planned_title": "L1", "script": "SOMETHING"}]},
    ])
    svc.bulk_apply_paths([
        {"slug": "p", "name": "P", "kind": "course",
         "steps": [{"planned_title": "L1", "script": ""}]},
    ])
    assert svc.list_paths(include_disabled=True)[0]["steps"][0]["script"] is None


def test_replace_path_steps_also_preserves_scripts(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"planned_title": "L1", "script": "S1"}])
    svc.replace_path_steps(p["id"], [{"planned_title": "L1"}])  # editor-style save
    assert svc.get_path(p["id"])["steps"][0]["script"] == "S1"


def test_a_brand_new_step_without_script_is_null_not_a_sentinel(svc):
    p = _path(svc)
    svc.replace_path_steps(p["id"], [{"youtube_id": "brandnew123"}])
    assert svc.get_path(p["id"])["steps"][0]["script"] is None
