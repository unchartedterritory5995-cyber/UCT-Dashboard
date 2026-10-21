"""Screen feedback and the review hub (owner 2026-10-21: "show me everything here
and now so we can go through it all and continue reviewing and structuring each
section properly as well as the overall layout and visual and effects and
interactive and learning and everything").

Store: a note on a whole Study screen is a feedback row with `screen` set and an
empty item id, so it never counts against an item and never reaches review();
the one verdict it can carry is the owner's approve / fix on ONE lesson, from
the lessons reading view. Hub: every skill's counts by status, and every candle
lesson as members read it. Ingest: screen notes reach the report, a lesson
verdict becomes a source ruling, and neither is ever written as an item verdict.
Run alone: python -m pytest tests/test_study_screen_feedback.py -q
"""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.study as study_router
from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import study_store as ss
from scripts.study import ingest_feedback as ing

PARTS = {"shape": "Two bars.", "story": "Sellers then buyers.", "where": "After a fall.",
         "confirm": "A higher close.", "cancel": "A new low.", "desk": "Note it."}


def _chart(iid, sym, status_parts=PARTS, grade=None, key="bullish-engulfing", label="Bullish Engulfing"):
    rv = {"key": key, "label": label, "axis": "relation", "bars": 2, "lesson_parts": status_parts}
    if grade:
        rv["example_grade"] = grade
    return {"id": iid, "type": "recall", "skill_id": "vocab.candle", "difficulty": 2, "sym": sym,
            "asof": "2025-04-09", "prompt_json": {"q": "Which candle?", "choices": [label, "Doji"], "subject": label},
            "answer_json": {"answer": label}, "reveal_json": rv, "source_kind": "candles",
            "source_ref": f"candles#{key}#{sym}", "lesson_text": "Two bars."}


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    ss.init_db()
    ss.upsert_items([
        _chart("si_aaaaaa000001", "IWM", grade="good"),
        _chart("si_aaaaaa000002", "SPY", grade="great"),
        _chart("si_aaaaaa000003", "QQQ", status_parts={**PARTS, "shape": "OLD draft words."}),
        {**_chart("si_aaaaaa000004", None), "sym": None},                       # a text item
        _chart("si_bbbbbb000001", "AAPL", key="hammer", label="Hammer"),
        {"id": "si_cccccc000001", "type": "size", "skill_id": "size.formula", "difficulty": 1,
         "prompt_json": {"q": "How many shares?"}, "answer_json": {"answer": 100}, "source_kind": "sizing",
         "source_ref": "size#1", "lesson_text": "Risk over stop."},
    ])
    for iid in ("si_aaaaaa000001", "si_aaaaaa000002", "si_cccccc000001"):
        ss.approve(iid, "owner")
    ss.review("si_bbbbbb000001", "reject", "owner", reason="bad chart")
    return ss


ADMIN = {"id": "a1", "email": "a@t.dev", "role": "admin", "plan": "pro"}
MEMBER = {"id": "u1", "email": "m@t.dev", "role": "member", "plan": "pro"}


def _client(user, admin=False):
    app = FastAPI()
    app.include_router(study_router.router)
    app.dependency_overrides[study_router.require_paid] = lambda: user
    app.dependency_overrides[get_current_user] = lambda: user
    if admin:
        app.dependency_overrides[require_admin] = lambda: user
    return TestClient(app)


# ── store ─────────────────────────────────────────────────────────────────────

def test_a_screen_note_is_its_own_row_and_never_counts_against_an_item(store):
    item_fb = ss.add_feedback("si_aaaaaa000001", "u1", role="member", channel="site", kind="too_hard")
    res = ss.add_screen_feedback("landing", "a1", role="owner", kind="layout", text="start button below the fold",
                                 context={"study": "today"})
    fb = res["feedback"]
    assert fb["screen"] == "landing" and fb["item_id"] == "" and fb["ref"] is None
    assert fb["context"] == {"study": "today"} and res["applied"] is None
    assert item_fb["feedback"]["screen"] is None and item_fb["feedback"]["ref"] == "aaaaaa"
    counts = ss.feedback_counts()
    assert counts["open"] == {"si_aaaaaa000001": 1}                    # no '' key for the screen note
    assert counts["open_screens"] == {"landing": 1}
    assert counts["open_total"] == 2


def test_context_is_kept_small_and_flat(store):
    ctx = {"item_id": "si_x", "n": 3, "ok": True, "nested": {"a": 1}, "list": [1, 2], "long": "x" * 500}
    ctx.update({f"k{i}": i for i in range(20)})
    got = ss.add_screen_feedback("question", "a1", role="owner", kind="visuals", context=ctx)["feedback"]["context"]
    assert "nested" not in got and "list" not in got
    assert len(got["long"]) == ss._CONTEXT_VALUE_MAX
    assert len(got) == ss._CONTEXT_MAX_KEYS
    assert ss.add_screen_feedback("end", "a1", role="owner", kind="great", context="not a dict")["feedback"]["context"] is None


def test_a_lesson_verdict_needs_the_lessons_screen_an_owner_and_a_lesson_key(store):
    ok = ss.add_screen_feedback("lessons", "a1", role="owner", kind="great", verdict="approve",
                                context={"lesson_key": "hammer"})["feedback"]
    assert ok["verdict"] == "approve"
    assert ss.get_item_full("si_bbbbbb000001")["review_status"] == "rejected"   # nothing applied to items
    member = ss.add_screen_feedback("lessons", "u1", role="member", kind="great", verdict="approve",
                                    context={"lesson_key": "hammer"})["feedback"]
    assert member["verdict"] is None
    other_screen = ss.add_screen_feedback("reveal", "a1", role="owner", kind="layout", verdict="approve")["feedback"]
    assert other_screen["verdict"] is None
    with pytest.raises(ValueError):
        ss.add_screen_feedback("lessons", "a1", role="owner", kind="learning", verdict="fix")      # no lesson named
    with pytest.raises(ValueError):
        ss.add_screen_feedback("lessons", "a1", role="owner", kind="learning", verdict="reject",
                               context={"lesson_key": "hammer"})


@pytest.mark.parametrize("screen,kind", [("nowhere", "layout"), ("landing", "wrong_answer"), ("landing", "")])
def test_bad_screens_and_kinds_are_refused(store, screen, kind):
    with pytest.raises(ValueError):
        ss.add_screen_feedback(screen, "a1", role="owner", kind=kind)


def test_list_feedback_narrows_to_screens(store):
    ss.add_feedback("si_aaaaaa000001", "u1", role="member", channel="site", kind="too_hard")
    ss.add_screen_feedback("landing", "a1", role="owner", kind="layout")
    ss.add_screen_feedback("trail", "a1", role="owner", kind="effects")
    assert [r["screen"] for r in ss.list_feedback(screen="any")] == ["trail", "landing"]
    assert [r["screen"] for r in ss.list_feedback(screen="trail")] == ["trail"]
    assert [r["item_id"] for r in ss.list_feedback(screen="none")] == ["si_aaaaaa000001"]
    assert len(ss.list_feedback()) == 3


def test_review_sections_count_every_skill_by_status(store):
    rows = {r["skill_id"]: r for r in ss.review_sections()}
    assert rows["vocab.candle"] == {"skill_id": "vocab.candle", "approved": 2, "draft": 2, "rejected": 1,
                                    "retired": 0, "total": 5}
    assert rows["size.formula"]["approved"] == 1 and rows["size.formula"]["total"] == 1


def test_lesson_overview_reads_the_live_lesson_and_the_owners_verdict(store):
    ss.add_screen_feedback("lessons", "a1", role="owner", kind="learning", verdict="fix",
                           text="where needs the trend", context={"lesson_key": "bullish-engulfing"})
    ss.add_screen_feedback("lessons", "a1", role="owner", kind="great", verdict="approve",
                           context={"lesson_key": "bullish-engulfing"})
    rows = {r["key"]: r for r in ss.lesson_overview()}
    be = rows["bullish-engulfing"]
    assert be["label"] == "Bullish Engulfing" and be["bars"] == 2
    assert be["parts"]["shape"] == "Two bars." and be["parts_from"] == "approved"   # never the old draft words
    assert be["charts"] == {"approved": 2, "draft": 1} and be["text"] == {"draft": 1}
    assert be["example_id"] == "si_aaaaaa000002"                                    # the great one
    assert be["verdict"]["verdict"] == "approve" and be["notes_open"] == 2           # latest verdict wins
    hm = rows["hammer"]
    assert hm["charts"] == {"rejected": 1} and hm["example_id"] is None and hm["verdict"] is None


# ── router ────────────────────────────────────────────────────────────────────

def test_the_admin_routes_record_a_note_and_serve_the_hub(store):
    owner = _client(ADMIN, admin=True)
    r = owner.post("/api/study/admin/screen-feedback",
                   json={"screen": "reveal", "kind": "layout", "text": "door under Continue",
                         "context": {"item_id": "si_aaaaaa000001"}})
    assert r.status_code == 200 and r.json()["screen"] == "reveal"
    assert owner.post("/api/study/admin/screen-feedback", json={"screen": "x", "kind": "layout"}).status_code == 400
    lst = owner.get("/api/study/admin/feedback?screen=any").json()
    assert [f["text"] for f in lst["feedback"]] == ["door under Continue"]
    assert lst["counts"]["open_screens"] == {"reveal": 1}
    hub = owner.get("/api/study/admin/hub").json()
    assert {s["skill_id"] for s in hub["sections"]} == {"vocab.candle", "size.formula"}
    assert {l["key"] for l in hub["lessons"]} == {"bullish-engulfing", "hammer"}
    assert hub["feedback"]["open_total"] == 1
    # the counts lie on the skill map; a skill on no unit is still listed
    placed = {sid for cur in hub["tree"] for tr in cur["tracks"] for un in tr["units"] for sid in un["skills"]}
    assert {s["skill_id"] for s in hub["unplaced"]} == {s["skill_id"] for s in hub["sections"]} - placed
    assert any(cur["id"] == "method" for cur in hub["tree"])
    for cur in hub["tree"]:
        assert cur["counts"]["total"] == sum(t["counts"]["total"] for t in cur["tracks"])


def test_the_hub_tree_sums_units_into_tracks_and_curricula(monkeypatch):
    monkeypatch.setattr(study_router, "_skill_map", lambda: {"curricula": [{"id": "c", "title": "C", "tracks": [
        {"id": "T", "title": "T", "units": [{"id": "U1", "title": "U1", "skills": ["a", "b"]},
                                            {"id": "U2", "title": "U2", "skills": ["missing"]}]}]}]})
    sections = [{"skill_id": "a", "approved": 2, "draft": 1, "rejected": 0, "retired": 0, "total": 3},
                {"skill_id": "b", "approved": 0, "draft": 4, "rejected": 1, "retired": 0, "total": 5},
                {"skill_id": "z", "approved": 1, "draft": 0, "rejected": 0, "retired": 0, "total": 1}]
    tree, unplaced = study_router._hub_tree(sections)
    unit = tree[0]["tracks"][0]["units"][0]
    assert unit["counts"] == {"approved": 2, "draft": 5, "rejected": 1, "retired": 0, "total": 8}
    assert tree[0]["tracks"][0]["units"][1]["counts"]["total"] == 0          # a unit with nothing yet
    assert tree[0]["counts"]["total"] == 8
    assert [s["skill_id"] for s in unplaced] == ["z"]


def test_members_cannot_reach_the_screen_door_or_the_hub(store):
    member = _client(MEMBER)
    assert member.get("/api/study/admin/hub").status_code in (401, 403)
    assert member.post("/api/study/admin/screen-feedback",
                       json={"screen": "landing", "kind": "layout"}).status_code in (401, 403)


# ── ingest ────────────────────────────────────────────────────────────────────

def _rows(store):
    ss.add_feedback("si_aaaaaa000001", "a1", role="owner", channel="site", kind="bad_chart", verdict="reject")
    ss.add_screen_feedback("landing", "a1", role="owner", kind="layout", text="start button below the fold")
    ss.add_screen_feedback("lessons", "a1", role="owner", kind="great", verdict="approve", text="good",
                           context={"lesson_key": "hammer", "label": "Hammer"})
    return ss.export_feedback()


def test_ingest_writes_item_verdicts_and_lesson_rulings_never_a_screen_as_an_item(store, tmp_path):
    rows = _rows(store)
    path = tmp_path / "feedback.jsonl"
    assert ing.append_verdicts(rows, path=path, segments={"si_aaaaaa000001": "candles.chart"}) == 2
    recs = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    item = [r for r in recs if r.get("item_id")]
    ruling = [r for r in recs if r["verdict"] == "source_ruling"]
    assert len(item) == 1 and item[0]["verdict"] == "reject"
    assert len(ruling) == 1 and ruling[0]["about"] == "lesson" and ruling[0]["lesson_key"] == "hammer"
    assert ruling[0]["segment"] == "candles.chart" and "item_id" not in ruling[0]
    assert ing.append_verdicts(rows, path=path, segments={}) == 0                   # idempotent by feedback id


def test_the_report_has_a_screens_section(store):
    text = ing.render_report(_rows(store))
    assert "## Screens" in text and "start button below the fold" in text
    assert "landing" in text and "· `` (" not in text                               # no empty item heading
