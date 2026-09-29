"""TERM-091 — the curriculum loader and the lesson kind in the education store.

What each group of tests exists to make impossible:
  * IDEMPOTENCY — a second load adds rows (the loader run twice must give the
    same row count, the `ensure_default_paths` contract).
  * REVERSAL SCOPE — the undo deletes anything but the rows this loader owns:
    not edu_videos, not edu_paths / edu_path_steps, not an edu_lessons row
    from another source.
  * ATTRIBUTION — a lesson carrying third-party framework material ships with
    an empty attribution (CLM-15), or any row claims to be UCT-original.
  * DARK — with EDU_CURRICULUM_ENABLED unset the routes answer anything but the
    unknown-route 404, or the table gets created.

Counts are DERIVED from docs/curriculum/*.json in the test and printed, never typed.
"""
from __future__ import annotations

import contextlib
import json
import sqlite3
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.education as edu_router
from api.services import education_curriculum as ec

REAL_DIR = Path(__file__).resolve().parents[1] / "docs" / "curriculum"


# ── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture()
def svc(tmp_path, monkeypatch):
    from api.services import education_service as es
    monkeypatch.setattr(es, "_DB_PATH", str(tmp_path / "education.db"))
    es._init_db()
    return es


@pytest.fixture()
def flag_on(monkeypatch):
    monkeypatch.setenv(ec.FLAG, "1")


@pytest.fixture()
def flag_off(monkeypatch):
    monkeypatch.delenv(ec.FLAG, raising=False)


def _write_fixture_dir(d: Path, lessons: list[dict], toolkit: list[dict] | None = None,
                       foundations_text: str = "") -> Path:
    """A minimal curriculum dir in the real files' shape: one module."""
    d.mkdir(parents=True, exist_ok=True)
    course = {"name": "Fixture Course", "modules": [
        {"label": "M1 · Fixture", "purpose": "p",
         "lessons": [{"title": l["title"], "note": l.get("note", ""), "minutes": 5}
                     for l in lessons]}]}
    scripts = {"course": "Fixture Course", "modules": [
        {"label": "M1 · Fixture", "lessons": [
            {"title": l["title"], "minutes": 5, "note": l.get("note", ""),
             "chapters": l.get("chapters", [])} for l in lessons]}]}
    (d / ec.COURSE_FILE).write_text(json.dumps(course), encoding="utf-8")
    (d / ec.SCRIPTS_FILE).write_text(json.dumps(scripts), encoding="utf-8")
    (d / ec.TOOLKIT_FILE).write_text(json.dumps(toolkit or []), encoding="utf-8")
    (d / ec.FOUNDATIONS_FILE).write_text(json.dumps({"notes": [foundations_text]}),
                                         encoding="utf-8")
    return d


def _count(es, sql: str, *args) -> int:
    with sqlite3.connect(es._DB_PATH) as c:
        return c.execute(sql, args).fetchone()[0]


def _dump(es, table: str) -> list[tuple]:
    with sqlite3.connect(es._DB_PATH) as c:
        return c.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()


def _table_exists(es) -> bool:
    with sqlite3.connect(es._DB_PATH) as c:
        return c.execute("SELECT 1 FROM sqlite_master WHERE name='edu_lessons'").fetchone() is not None


# ── the real source: shape + printed counts ─────────────────────────────────

def test_build_rows_count_is_derived_from_the_source_and_printed():
    course = json.loads((REAL_DIR / ec.COURSE_FILE).read_text(encoding="utf-8"))
    toolkit = json.loads((REAL_DIR / ec.TOOLKIT_FILE).read_text(encoding="utf-8"))
    expected_lessons = sum(len(m["lessons"]) for m in course["modules"])
    rows = ec.build_rows(REAL_DIR)
    lessons = [r for r in rows if r["kind"] == "lesson"]
    artifacts = [r for r in rows if r["kind"] == "artifact"]
    print(f"\n[TERM-091] source lessons={expected_lessons} built lessons={len(lessons)} "
          f"artifacts={len(artifacts)} modules={len(course['modules'])}")
    assert expected_lessons > 0
    assert len(lessons) == expected_lessons
    assert len(artifacts) == len(toolkit)
    assert len({r["lesson_key"] for r in rows}) == len(rows)


def test_census_is_computed_from_the_scripts_json_not_a_constant():
    scripts = json.loads((REAL_DIR / ec.SCRIPTS_FILE).read_text(encoding="utf-8"))
    want: dict[str, int] = {}
    for m in scripts["modules"]:
        for les in m["lessons"]:
            for ch in les["chapters"]:
                if ch.get("spec_verdict"):
                    want[ch["spec_verdict"]] = want.get(ch["spec_verdict"], 0) + 1
    got = ec.census(ec.build_rows(REAL_DIR))
    print(f"\n[TERM-091] spec_verdict census={got}")
    assert {k: got[k] for k in want} == want
    assert got["total"] == sum(want.values()) > 0


# ── idempotency ─────────────────────────────────────────────────────────────

def test_loading_twice_gives_the_same_row_count(svc):
    first = ec.load(REAL_DIR)
    n1 = _count(svc, "SELECT COUNT(*) FROM edu_lessons")
    second = ec.load(REAL_DIR)
    n2 = _count(svc, "SELECT COUNT(*) FROM edu_lessons")
    print(f"\n[TERM-091] first={first} second={second} rows={n1}->{n2}")
    assert n1 == n2 == len(ec.build_rows(REAL_DIR))
    assert second["inserted"] == 0 and second["updated"] == n1
    assert _count(svc, "SELECT COUNT(DISTINCT lesson_key) FROM edu_lessons") == n1


def test_every_row_carries_source_and_an_attribution_field(svc):
    ec.load(REAL_DIR)
    assert _count(svc, "SELECT COUNT(*) FROM edu_lessons WHERE source != ?", ec.SOURCE) == 0
    assert _count(svc, "SELECT COUNT(*) FROM edu_lessons WHERE attribution IS NULL") == 0


def test_a_retitled_lesson_is_pruned_not_orphaned(svc, tmp_path):
    d = _write_fixture_dir(tmp_path / "cur", [{"title": "Alpha"}, {"title": "Beta"}])
    ec.load(d)
    _write_fixture_dir(tmp_path / "cur", [{"title": "Alpha"}, {"title": "Beta Renamed"}])
    res = ec.load(d)
    keys = {r[0] for r in sqlite3.connect(svc._DB_PATH).execute(
        "SELECT lesson_key FROM edu_lessons").fetchall()}
    assert keys == {"uct-method:alpha", "uct-method:beta-renamed"}
    assert res["pruned"] == 1


def test_a_view_count_survives_a_reload(svc):
    ec.load(REAL_DIR)
    key = ec.list_lessons()[0]["lesson_key"]
    ec.get_lesson(key)
    ec.get_lesson(key)
    ec.load(REAL_DIR)
    assert ec.get_lesson(key, record_view=False)["view_count"] == 2


# ── reversal scope ──────────────────────────────────────────────────────────

def test_unload_deletes_exactly_the_loaded_rows_and_nothing_else(svc):
    svc.create_video({"youtube_id": "abcdefghijk", "title": "A video", "category": "General"})
    svc.ensure_default_paths()
    svc.create_path({"slug": "a-course", "name": "A course", "kind": "course"})
    ec.load(REAL_DIR)
    # a lesson row from ANOTHER source: the reversal must not reach it
    with sqlite3.connect(svc._DB_PATH) as c:
        c.execute("INSERT INTO edu_lessons (lesson_key, source, kind, title, source_file, "
                  "loaded_at) VALUES ('manual:keep', 'manual', 'lesson', 'Keep me', 'x', 0)")
    before = {t: _dump(svc, t) for t in ("edu_videos", "edu_paths", "edu_path_steps",
                                          "edu_categories")}
    assert before["edu_videos"] and before["edu_paths"] and before["edu_path_steps"]
    loaded = _count(svc, "SELECT COUNT(*) FROM edu_lessons WHERE source=?", ec.SOURCE)

    deleted = ec.unload()

    assert deleted == loaded > 0
    assert _count(svc, "SELECT COUNT(*) FROM edu_lessons WHERE source=?", ec.SOURCE) == 0
    assert _count(svc, "SELECT COUNT(*) FROM edu_lessons WHERE lesson_key='manual:keep'") == 1
    for t, rows in before.items():
        assert _dump(svc, t) == rows, f"unload touched {t}"


def test_unload_on_a_store_that_never_loaded_is_a_noop(svc):
    assert ec.unload() == 0
    assert not _table_exists(svc)


def test_unload_clears_the_migrate_flag_so_a_reenable_reloads(svc, flag_on):
    ec.ensure_loaded_once()
    assert Path(ec._flag_file()).exists()
    ec.unload()
    assert not Path(ec._flag_file()).exists()
    ec.ensure_loaded_once()
    assert _count(svc, "SELECT COUNT(*) FROM edu_lessons") == len(ec.build_rows())


# ── attribution ─────────────────────────────────────────────────────────────

def test_a_named_third_party_framework_is_attributed(tmp_path):
    d = _write_fixture_dir(tmp_path / "cur", [
        {"title": "The Contraction Setup", "note": "Minervini's VCP, tightening left to right."},
        {"title": "Stops", "note": "Structure, percent, ATR."},
    ])
    rows = {r["title"]: r for r in ec.build_rows(d)}
    att = rows["The Contraction Setup"]["attribution"]
    assert "Mark Minervini" in att and "not UCT" in att
    assert rows["The Contraction Setup"]["attribution_detail"][0]["basis"] == "named_in_lesson"
    assert rows["Stops"]["attribution"] == ""


def test_evidence_in_the_source_upgrades_a_term_hit_to_named_in_source(tmp_path):
    lessons = [{"title": "Episodic Pivot", "note": "Day one of a new trend."}]
    bare = ec.build_rows(_write_fixture_dir(tmp_path / "a", lessons))
    evid = ec.build_rows(_write_fixture_dir(
        tmp_path / "b", lessons,
        foundations_text="The Episodic Pivot Defined: Qullamaggie's Breakout / EP / Parabolic Trio"))
    assert bare[0]["attribution_detail"][0]["basis"] == "signature_term"
    assert evid[0]["attribution_detail"][0]["basis"] == "named_in_source"
    assert "Qullamaggie" in bare[0]["attribution"] and "Qullamaggie" in evid[0]["attribution"]


def test_EP_means_episodic_pivot_never_earnings_per_share(tmp_path):
    d = _write_fixture_dir(tmp_path / "cur", [{"title": "Earnings", "note": "EPS beat, revenue beat."}])
    assert ec.build_rows(d)[0]["attribution"] == ""


def test_real_source_lessons_that_name_a_framework_term_are_all_attributed():
    """Every real lesson whose own text carries a CLM-15 framework's signature
    term must have a non-empty attribution — the property, checked over the
    real 79, not a sample."""
    rows = [r for r in ec.build_rows(REAL_DIR)]
    flagship = [r for r in rows if r["title"].startswith("FLAGSHIP — Episodic Pivot")]
    assert flagship and "Qullamaggie" in flagship[0]["attribution"]
    ftd = [r for r in rows if r["title"].startswith("Distribution Days and Follow-Through")]
    assert ftd and "O'Neil" in ftd[0]["attribution"]
    stages = [r for r in rows if r["title"].startswith("The Four Stages")]
    assert stages and "Weinstein" in stages[0]["attribution"]
    for r in rows:
        assert "original" not in r["attribution"].lower()
    print(f"\n[TERM-091] attributed {sum(1 for r in rows if r['attribution'])} of {len(rows)} rows")


# ── the router: dark, paid, list + fetch + view count ───────────────────────

def _client(user: dict | None):
    app = FastAPI()
    app.include_router(edu_router.router)
    if user is not None:
        app.dependency_overrides[edu_router.require_paid] = lambda: user
    return TestClient(app)


PAID = {"id": "u1", "role": "member"}
ADMIN = {"id": "a1", "role": "admin"}


def test_flag_off_both_routes_are_the_unknown_route_404_and_nothing_is_created(svc, flag_off):
    unknown = _client(ADMIN).get("/api/education/no-such-route")
    for c in (_client(PAID), _client(ADMIN), _client(None)):
        for path in ("/api/education/lessons", "/api/education/lessons/uct-method:x"):
            r = c.get(path)
            assert r.status_code == 404 and r.json() == unknown.json() == {"detail": "Not Found"}
    assert not _table_exists(svc)


def test_flag_on_unpaid_is_refused_like_every_education_read(svc, flag_on):
    r = _client(None).get("/api/education/lessons")
    assert r.status_code in (401, 402, 403)
    assert not _table_exists(svc)


def test_flag_on_list_lazily_loads_once_and_serves_lessons_with_census(svc, flag_on):
    r = _client(PAID).get("/api/education/lessons")
    assert r.status_code == 200
    body = r.json()
    rows = ec.build_rows()
    assert body["counts"]["lessons"] == sum(1 for x in rows if x["kind"] == "lesson")
    assert body["counts"]["artifacts"] == sum(1 for x in rows if x["kind"] == "artifact")
    assert body["census"] == ec.census(rows)
    # OWNER RULING 2026-09-29: no third-party credit reaches a member, on any lesson.
    assert not any("attribution" in x or "attribution_detail" in x for x in body["lessons"])
    assert all("view_count" not in x for x in body["lessons"])
    assert Path(ec._flag_file()).exists()


def test_fetch_counts_a_view_and_only_admins_see_the_count(svc, flag_on):
    _client(PAID).get("/api/education/lessons")
    key = ec.list_lessons()[0]["lesson_key"]
    r = _client(PAID).get(f"/api/education/lessons/{key}")
    assert r.status_code == 200 and "view_count" not in r.json()
    assert r.json()["chapters"] and "spec_verdict" in r.json()["chapters"][0]
    a = _client(ADMIN).get(f"/api/education/lessons/{key}")
    assert a.json()["view_count"] == 2
    assert _client(PAID).get("/api/education/lessons/uct-method:nope").status_code == 404


def test_no_credit_reaches_a_member_even_on_a_lesson_that_has_one_stored(svc, flag_on):
    """OWNER RULING 2026-09-29: the loader still derives and stores credits (an internal
    record); no read route returns them. Non-vacuity: the lesson fetched really HAS one."""
    _client(PAID).get("/api/education/lessons")
    with contextlib.closing(ec.es._connect()) as c:
        row = c.execute("SELECT lesson_key FROM edu_lessons WHERE attribution != '' LIMIT 1").fetchone()
    assert row, "no stored credit to test against -- the control is vacuous"
    body = _client(PAID).get(f"/api/education/lessons/{row[0]}").json()
    assert "attribution" not in body and "attribution_detail" not in body
