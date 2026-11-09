"""Study games' server doors (docs/study/GAMES.md §2, owner 2026-11-08): capped XP for a computed game's run, and the
pools the quick games draw from (true/false prompts without their keys; word + meaning pairs)."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.study as study_router
from api.middleware.auth_middleware import get_current_user
from api.services import study_store as ss

MEMBER = {"id": "u1", "email": "m@t.dev", "role": "member", "plan": "pro"}
NOON = datetime(2026, 11, 9, 17, 0, tzinfo=timezone.utc)


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    ss.init_db()
    return ss


@pytest.fixture()
def client(store):
    app = FastAPI()
    app.include_router(study_router.router)
    app.dependency_overrides[study_router.require_paid] = lambda: MEMBER
    app.dependency_overrides[get_current_user] = lambda: MEMBER
    return TestClient(app)


def test_a_run_grants_two_xp_per_right_answer_once(store):
    r = ss.record_game_run("u1", "size", "run-1", 7, 10, now=NOON)
    assert r["xp_gained"] == 14 and r["xp"] == 14 and not r["duplicate"]
    again = ss.record_game_run("u1", "size", "run-1", 7, 10, now=NOON)
    assert again["xp_gained"] == 0 and again["duplicate"] and again["xp"] == 14


def test_a_run_is_capped_and_so_is_the_day(store):
    r = ss.record_game_run("u1", "size", "big", 40, 40, now=NOON)
    assert r["xp_gained"] == ss.GAME_XP_PER_RUN and r["capped"]
    total = r["xp_gained"]
    for i in range(10):
        total += ss.record_game_run("u1", "size", f"r{i}", 40, 40, now=NOON)["xp_gained"]
    assert total == ss.GAME_XP_PER_KIND_DAY
    # another game kind has its own daily room
    assert ss.record_game_run("u1", "payoff", "p1", 5, 6, now=NOON)["xp_gained"] == 10


def test_bad_runs_are_refused(store):
    for kind, right, total in (("nope", 1, 1), ("size", 5, 4), ("size", -1, 3), ("size", 1, ss.GAME_MAX_TOTAL + 1)):
        with pytest.raises(ValueError):
            ss.record_game_run("u1", kind, "x", right, total, now=NOON)
    with pytest.raises(ValueError):
        ss.record_game_run("u1", "size", "", 1, 1, now=NOON)


def test_game_xp_reaches_the_weekly_board_and_the_level_trophies(store):
    for i in range(170):   # 170 runs over many days reach level 5 (2,000 XP at 500 a level)
        day = datetime(2026, 1, 1, 17, 0, tzinfo=timezone.utc).replace(day=1 + i % 28, month=1 + (i // 28) % 12)
        ss.record_game_run("u1", "size", f"r{i}", 15, 15, now=day)
    prof = ss.get_profile("u1")
    assert prof["xp"] >= 2000 and prof["level"] >= 5
    with ss._connect() as c:
        badges = {r["badge_id"] for r in c.execute("SELECT badge_id FROM study_badges WHERE user_id='u1'")}
    assert "level_5" in badges


def test_game_runs_route(client):
    r = client.post("/api/study/game-runs", json={"kind": "ticket", "run_id": "t-1", "right": 6, "total": 8})
    assert r.status_code == 200
    body = r.json()
    assert body["xp_gained"] == 12 and body["progress"]["xp"] == 12 and body["duplicate"] is False
    assert client.post("/api/study/game-runs", json={"kind": "ticket", "run_id": "t-1", "right": 6, "total": 8}).json()["xp_gained"] == 0
    assert client.post("/api/study/game-runs", json={"kind": "ticket", "run_id": "t-2", "right": 9, "total": 8}).status_code == 400


def _insert(store, iid, *, skill, prompt, answer, status="approved", typ="recall"):
    with store._write() as c:
        c.execute("INSERT INTO study_items (id, version, type, skill_id, difficulty, prompt_json, answer_json, "
                  "reveal_json, source_kind, source_ref, review_status, review_lane, created_at) "
                  "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (iid, 1, typ, skill, 1, json.dumps(prompt), json.dumps(answer), "{}", "course", "x", status,
                   "manual", "2026-11-08T00:00:00Z"))


def test_tf_pool_sends_prompts_without_keys_and_only_approved(store, client):
    _insert(store, "si_000000000001", skill="basics.spread", prompt={"q": "The bid is the buyer's price.", "kind": "tf",
                                                                      "subject": "F1.03#q02"}, answer={"answer": "True"})
    _insert(store, "si_000000000002", skill="basics.spread", prompt={"q": "Draft.", "kind": "tf"},
            answer={"answer": "False"}, status="draft")
    _insert(store, "si_000000000003", skill="basics.spread", prompt={"q": "Pick one", "kind": "mcq",
                                                                      "choices": ["a", "b", "c"]}, answer={"answer": "a"})
    r = client.post("/api/study/game-pool", json={"kind": "tf", "size": 10})
    assert r.status_code == 200
    items = r.json()["items"]
    assert [i["id"] for i in items] == ["si_000000000001"]
    blob = json.dumps(items)
    assert "answer" not in blob and "subject" not in blob and "True" not in blob


def test_match_pool_pairs_words_with_meanings(store, client):
    _insert(store, "si_00000000000a", skill="vocab.chart", prompt={"q": 'What does "Gap" mean?', "subject": "Gap",
                                                                    "choices": ["x"]}, answer={"answer": "A jump between two bars"})
    _insert(store, "si_00000000000b", skill="vocab.chart", prompt={"q": "Which word?", "subject": "Gap"},
            answer={"answer": "Gap"})      # the reverse direction: not a pair
    _insert(store, "si_00000000000c", skill="vocab.chart", prompt={"q": 'What does "gap" mean?', "subject": "gap"},
            answer={"answer": "Same word twice"})   # a second card for one word: the word appears once
    _insert(store, "si_00000000000d", skill="basics.spread", prompt={"q": "Not vocab", "subject": "Spread"},
            answer={"answer": "Ask minus bid"})
    items = client.post("/api/study/game-pool", json={"kind": "match"}).json()["items"]
    assert len(items) == 1 and items[0]["term"].casefold() == "gap"
    assert client.post("/api/study/game-pool", json={"kind": "nope"}).status_code == 400
