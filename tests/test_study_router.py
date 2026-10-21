"""Study router: auth gates, today/sessions/items/bars/attempts/step/profile/
leaderboard, admin review, import (spec §7.1 table, §13.1 B3, §13.2 T5/T11).

Fixture pattern copied from tests/test_education_paths_router.py: a standalone
FastAPI app + the router + dependency_overrides (the router defines its own
`require_paid`, so that AND the shared `get_current_user` are overridden).

Run alone: python -m pytest tests/test_study_router.py -q
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.study as study_router
from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import study_store as ss


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    ss.init_db()
    return ss


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(study_router.router)
    return app


MEMBER = {"id": "u1", "email": "m@t.dev", "role": "member", "plan": "pro"}
OTHER = {"id": "u2", "email": "o@t.dev", "role": "member", "plan": "pro"}
ADMIN = {"id": "a1", "email": "a@t.dev", "role": "admin", "plan": "pro"}


@pytest.fixture()
def client(store):
    return TestClient(_app())


def _member_client(user):
    app = _app()
    app.dependency_overrides[study_router.require_paid] = lambda: user
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture()
def paid_client(store):
    return _member_client(MEMBER)


@pytest.fixture()
def other_client(store):
    return _member_client(OTHER)


@pytest.fixture()
def admin_client(store):
    app = _app()
    app.dependency_overrides[require_admin] = lambda: ADMIN
    app.dependency_overrides[study_router.require_paid] = lambda: ADMIN
    return TestClient(app)


@pytest.fixture()
def push_client(store, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "test-secret-123")
    c = TestClient(_app())
    c.headers.update({"Authorization": "Bearer test-secret-123"})
    return c


VIS = [{"t": 20240516 + i, "o": 10 + i, "h": 11 + i, "l": 9 + i, "c": 10.5 + i, "v": 1000} for i in range(3)]
FWD = [{"t": 20240521 + i, "o": 20 + i, "h": 21 + i, "l": 19 + i, "c": 20.5 + i, "v": 2000} for i in range(30)]


def _seed(store, approve=True):
    items = [
        {"id": "si_recall1", "type": "recall", "skill_id": "f1.basics", "difficulty": 1,
         "prompt_json": {"q": "bid?", "choices": ["a", "b"]}, "answer_json": {"answer": "a"},
         "reveal_json": {"why": "x"}, "source_kind": "glossary", "source_ref": "g#bid", "lesson_text": "L1"},
        {"id": "si_size1", "type": "size", "skill_id": "m5.size", "difficulty": 2,
         "prompt_json": {"account": 100000, "risk_pct": 1, "entry": 50, "stop": 47.5},
         "answer_json": {"shares": 400, "dollars": 20000}, "source_kind": "toolkit"},
        {"id": "si_regime1", "type": "regime", "skill_id": "m2.regime", "difficulty": 2,
         "prompt_json": {"q": "band?"}, "answer_json": {"answer": "YELLOW"}, "tier_scale_id": "wire5-2026"},
        {"id": "si_spot1", "type": "spot", "skill_id": "setup.vcp", "difficulty": 3, "bars_ref": "sb_spot1",
         "sym": "NVDA", "asof": "2024-05-20", "prompt_json": {"q": "VCP?"}, "answer_json": {"answer": "yes"},
         "reveal_json": {"outcome": "target hit"}, "source_kind": "detection", "source_ref": "det:1",
         "lesson_text": "The third contraction was the tell.", "adjustment_basis": "split-adjusted"},
        {"id": "si_spot2", "type": "spot", "skill_id": "setup.vcp", "difficulty": 3, "bars_ref": "sb_spot2",
         "sym": "AAPL", "asof": "2024-05-20", "prompt_json": {"q": "VCP?"}, "answer_json": {"answer": "no"}},
    ]
    store.upsert_items(items)
    store.upsert_bars("sb_spot1", "D", VIS, FWD)
    store.upsert_bars("sb_spot2", "D", VIS, FWD)
    if approve:
        for it in items:
            store.approve(it["id"], "owner")
    return items


# ── gates ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", ["/api/study/map", "/api/study/today", "/api/study/items/x",
                                  "/api/study/items/x/bars", "/api/study/profile", "/api/study/leaderboard"])
def test_member_routes_require_a_session(client, path):
    assert client.get(path).status_code in (401, 402, 403)


def test_require_paid_has_its_own_402_sentence(store):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        study_router.require_paid({"id": "u", "role": "member", "plan": "free"})
    assert e.value.status_code == 402 and "Study" in e.value.detail


def test_admin_routes_refuse_a_paid_member(paid_client):
    assert paid_client.get("/api/study/admin/review").status_code == 403
    assert paid_client.post("/api/study/admin/review/x", json={"action": "approve"}).status_code == 403
    assert paid_client.get("/api/study/admin/corrections/export").status_code == 403
    assert paid_client.get("/api/study/admin/items/x/bars").status_code == 403


def test_admin_item_bars_serves_a_draft_with_its_forward_strip(admin_client, paid_client, store):
    """The review screen draws the stored bars, not a live fetch by ticker: a
    DRAFT's bars are readable by the admin, the forward strip rides along, the
    symbol is the item id, and the member route still refuses the same draft."""
    _seed(store, approve=False)
    r = admin_client.get("/api/study/admin/items/si_spot1/bars")
    assert r.status_code == 200
    body = r.json()
    assert body["symbol"] == "si_spot1" and body["tf"] == "D"
    assert body["bars"] == VIS and body["forward"] == FWD
    assert "sym" not in body
    assert admin_client.get("/api/study/admin/items/si_recall1/bars").status_code == 404   # no bars_ref
    assert admin_client.get("/api/study/admin/items/nope/bars").status_code == 404
    assert paid_client.get("/api/study/items/si_spot1/bars").status_code == 404           # draft, member route


def test_import_requires_the_push_secret(client, monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s")
    assert client.post("/api/study/import", json={"items": []}).status_code == 401


def test_kill_switch_hides_every_route_as_404(paid_client, admin_client, push_client, monkeypatch):
    monkeypatch.setenv("STUDY_ENABLED", "0")
    assert paid_client.get("/api/study/today").status_code == 404
    assert admin_client.get("/api/study/admin/review").status_code == 404
    assert push_client.post("/api/study/import", json={"items": []}).status_code == 404
    monkeypatch.setenv("STUDY_ENABLED", "1")
    assert paid_client.get("/api/study/profile").status_code == 200


# ── today / sessions ──────────────────────────────────────────────────────────

def test_today_is_created_lazily_with_bars_inline_and_is_stable(paid_client, store):
    _seed(store)
    r = paid_client.get("/api/study/today")
    assert r.status_code == 200
    body = r.json()
    assert body["session_id"].startswith("ss_") and body["answered_item_ids"] == []
    ids = [i["id"] for i in body["items"]]
    assert len(ids) == 5 and len(set(ids)) == 5
    chart = next(i for i in body["items"] if i["has_chart"])
    assert chart["bars"]["symbol"] == chart["id"] and chart["bars"]["bars"] == VIS
    assert body["profile"]["daily_goal"] == 50
    # a second read returns the SAME session, not a new one
    assert paid_client.get("/api/study/today").json()["session_id"] == body["session_id"]


def test_today_with_an_empty_bank_is_an_empty_set_not_an_error(paid_client):
    r = paid_client.get("/api/study/today")
    assert r.status_code == 200 and r.json()["items"] == []


def test_sessions_by_skill_and_kind_validation(paid_client, store):
    _seed(store)
    r = paid_client.post("/api/study/sessions", json={"kind": "skill", "skill_id": "setup.vcp"})
    assert r.status_code == 200
    ids = {i["id"] for i in r.json()["items"]}
    assert ids == {"si_spot1", "si_spot2"}
    assert paid_client.post("/api/study/sessions", json={"kind": "bogus"}).status_code == 400
    d = paid_client.post("/api/study/sessions", json={"kind": "daily"}).json()
    assert d["kind"] == "daily"


def test_drafts_are_never_served(paid_client, store):
    _seed(store, approve=False)
    assert paid_client.get("/api/study/today").json()["items"] == []
    assert paid_client.get("/api/study/items/si_recall1").status_code == 404
    assert paid_client.post("/api/study/attempts", json={"item_id": "si_recall1", "answer": "a"}).status_code == 404


# ── items / bars ──────────────────────────────────────────────────────────────

def test_item_prompt_and_bars(paid_client, store):
    _seed(store)
    p = paid_client.get("/api/study/items/si_spot1").json()
    assert p["id"] == "si_spot1" and p["has_chart"] is True and "sym" not in p
    b = paid_client.get("/api/study/items/si_spot1/bars").json()
    assert b == {"symbol": "si_spot1", "tf": "D", "bars": VIS}
    assert paid_client.get("/api/study/items/si_recall1/bars").status_code == 404
    assert paid_client.get("/api/study/items/nope").status_code == 404


# ── attempts / step ───────────────────────────────────────────────────────────

def test_attempt_scores_server_side_and_reveals_after(paid_client, store):
    _seed(store)
    today = paid_client.get("/api/study/today").json()
    r = paid_client.post("/api/study/attempts", json={"item_id": "si_spot1", "answer": "YES",
                                                      "session_id": today["session_id"], "time_ms": 1200})
    assert r.status_code == 200
    body = r.json()
    assert body["correct"] is True and body["score"] == 1.0
    rev = body["reveal"]
    assert rev["sym"] == "NVDA" and rev["asof"] == "2024-05-20"
    assert rev["provenance"]["source_kind"] == "detection" and rev["provenance"]["adjustment_basis"] == "split-adjusted"
    assert rev["lesson"] == "The third contraction was the tell."
    assert rev["outcome"] == "target hit" and rev["answer"] == {"answer": "yes"}
    assert rev["forward_bars"] == FWD[:study_router.REVEAL_FORWARD_BARS] and rev["forward_total"] == 30
    # one answer never credits the streak (§4.5: finishing the set does)
    assert body["progress"]["xp_gained"] == ss.XP_CORRECT * 3 and body["progress"]["streak"] == 0
    assert body["progress"]["daily_done"] is False
    assert body["skill"]["skill_id"] == "setup.vcp"
    assert paid_client.get("/api/study/today").json()["answered_item_ids"] == ["si_spot1"]
    # finish the rest of today's set → the streak is credited on the last one
    last = None
    for iid in [i["id"] for i in today["items"] if i["id"] != "si_spot1"]:
        last = paid_client.post("/api/study/attempts", json={"item_id": iid, "answer": "x",
                                                             "session_id": today["session_id"]}).json()
    assert last["progress"]["streak"] == 1 and last["progress"]["daily_done"] is True
    assert paid_client.get("/api/study/today").json()["finished_at"]


def test_wrong_attempt_and_non_chart_reveal(paid_client, store):
    _seed(store)
    r = paid_client.post("/api/study/attempts", json={"item_id": "si_size1",
                                                      "answer": {"shares": 100, "dollars": 5000}})
    body = r.json()
    assert body["correct"] is False and body["score"] == 0.0
    assert "forward_bars" not in body["reveal"]
    assert body["reveal"]["detail"]["parts"] == {"shares": False, "dollars": False}


def test_step_serves_forward_bars_only_to_the_member_who_answered(paid_client, other_client, store):
    _seed(store)
    aid = paid_client.post("/api/study/attempts", json={"item_id": "si_spot1", "answer": "yes"}).json()["attempt_id"]
    r = paid_client.post(f"/api/study/attempts/{aid}/step", json={"n": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["bars"] == FWD[20:25] and body["next_offset"] == 25 and body["done"] is False
    r = paid_client.post(f"/api/study/attempts/{aid}/step", json={"n": 10, "offset": 25})
    assert r.json()["bars"] == FWD[25:30] and r.json()["done"] is True
    assert other_client.post(f"/api/study/attempts/{aid}/step", json={"n": 5}).status_code == 404
    assert paid_client.post("/api/study/attempts/999/step", json={"n": 5}).status_code == 404


# ── profile / leaderboard ─────────────────────────────────────────────────────

def test_profile_get_and_put(paid_client):
    p = paid_client.get("/api/study/profile").json()
    assert p["profile"]["daily_goal"] == 50 and p["profile"]["reminder_on"] is False and p["badges"] == []
    r = paid_client.put("/api/study/profile", json={"daily_goal": 80, "reminder_on": True,
                                                    "reminder_time": "07:00", "leaderboard_optout": True})
    prof = r.json()["profile"]
    assert prof["daily_goal"] == 80 and prof["reminder_on"] is True and prof["reminder_time"] == "07:00"
    assert prof["leaderboard_optout"] is True


def test_leaderboard_week_and_optout(paid_client, other_client, store):
    _seed(store)
    paid_client.post("/api/study/attempts", json={"item_id": "si_recall1", "answer": "a"})
    other_client.post("/api/study/attempts", json={"item_id": "si_recall1", "answer": "a"})
    other_client.post("/api/study/attempts", json={"item_id": "si_regime1", "answer": "yellow"})
    lb = paid_client.get("/api/study/leaderboard").json()
    assert len(lb["rows"]) == 2 and lb["rows"][0]["xp"] == 30 and lb["you"]["rank"] == 2
    other_client.put("/api/study/profile", json={"leaderboard_optout": True})
    lb = paid_client.get("/api/study/leaderboard").json()
    assert len(lb["rows"]) == 1 and lb["you"]["rank"] == 1
    assert paid_client.get("/api/study/leaderboard?week=nope").status_code == 400


# ── house chart look ─────────────────────────────────────────────────────────

def test_house_chart_serves_the_owners_blob_and_fails_open(paid_client, monkeypatch):
    from api.services import house_chart
    monkeypatch.setenv("ADMIN_EMAILS", "owner@example.com, other@example.com")
    monkeypatch.setattr(house_chart, "get_user_by_email", lambda e: {"id": "u1"} if e == "owner@example.com" else None)
    monkeypatch.setattr(house_chart, "get_user_preferences",
                        lambda uid: {"chart_settings": '{"chartType": "candles", "candles": {"upColor": "#1ae51a"}}'})
    r = paid_client.get("/api/study/house-chart")
    assert r.status_code == 200
    assert r.json() == {"chart_settings": {"chartType": "candles", "candles": {"upColor": "#1ae51a"}}}
    # nothing saved -> None, never an error (the drill keeps the defaults)
    monkeypatch.setattr(house_chart, "get_user_preferences", lambda uid: {})
    assert paid_client.get("/api/study/house-chart").json() == {"chart_settings": None}
    monkeypatch.delenv("ADMIN_EMAILS")
    assert paid_client.get("/api/study/house-chart").json() == {"chart_settings": None}


# ── admin review ──────────────────────────────────────────────────────────────

def test_admin_review_lists_drafts_by_lane_and_acts(admin_client, store):
    _seed(store, approve=False)
    r = admin_client.get("/api/study/admin/review?type=spot")
    assert r.status_code == 200
    body = r.json()
    assert {d["id"] for d in body["drafts"]} == {"si_spot1", "si_spot2"}
    assert body["drafts"][0]["sym"] in ("NVDA", "AAPL")        # the review card needs the ticker
    assert body["counts"]["manual"]["spot"] == 2
    assert body["trust"]["spot"]["clean_count"] == 0
    assert sum(body["skills"].values()) == sum(n for by in body["counts"].values() for n in by.values())
    skill = body["drafts"][0]["skill_id"]
    by_skill = admin_client.get(f"/api/study/admin/review?skill={skill}").json()["drafts"]
    assert by_skill and all(d["skill_id"] == skill for d in by_skill)
    assert admin_client.get("/api/study/admin/review?skill=nope").json()["drafts"] == []
    a = admin_client.post("/api/study/admin/review/si_spot1", json={"action": "approve"}).json()
    assert a["item"]["review_status"] == "approved" and a["trust"]["clean_count"] == 1
    f = admin_client.post("/api/study/admin/review/si_spot2",
                          json={"action": "fix", "field": "lesson_text", "after": "fixed", "reason": "voice"}).json()
    assert f["item"]["lesson_text"] == "fixed" and f["trust"]["clean_count"] == 0
    # the gallery: ?status=any lists the approved item beside the drafts, and a grade sticks
    g = admin_client.post("/api/study/admin/review/si_spot1", json={"action": "grade", "after": "good"})
    assert g.status_code == 200 and g.json()["item"]["reveal_json"]["example_grade"] == "good"
    assert g.json()["item"]["review_status"] == "approved"
    assert admin_client.post("/api/study/admin/review/si_spot1", json={"action": "grade", "after": "meh"}).status_code == 400
    ids_any = {d["id"] for d in admin_client.get("/api/study/admin/review?type=spot&status=any").json()["drafts"]}
    assert {"si_spot1", "si_spot2"} <= ids_any
    assert "si_spot1" not in {d["id"] for d in admin_client.get("/api/study/admin/review?type=spot").json()["drafts"]}
    assert admin_client.post("/api/study/admin/review/si_recall1", json={"action": "bless"}).status_code == 400
    assert admin_client.post("/api/study/admin/review/nope", json={"action": "approve"}).status_code == 400
    ex = admin_client.get("/api/study/admin/corrections/export").json()
    assert [c["action"] for c in ex["corrections"]] == ["approve", "fix", "grade"] and ex["next_since_id"] == 3
    t = admin_client.post("/api/study/admin/trust/spot", json={"state": "sampled"}).json()
    assert t["state"] == "sampled"
    assert admin_client.post("/api/study/admin/trust/spot", json={"state": "auto"}).status_code == 400


# ── import (PUSH_SECRET; get_bars_before only) ────────────────────────────────

def _fake_bars_before(rows_by_sym):
    def fn(ticker, tf, max_bars, to_key):
        rows = [r for r in rows_by_sym.get(ticker.upper(), []) if r[0] <= int(to_key)]
        return rows[-max_bars:]
    return fn


def test_import_upserts_drafts_resolves_bars_and_reports_misses(push_client, store, monkeypatch):
    from api.services import bars_sqlite
    rows = [(20240501 + i, 1.0 + i, 2.0 + i, 0.5 + i, 1.5 + i, 100 + i) for i in range(30)]  # 0501..0530 keys
    monkeypatch.setattr(bars_sqlite, "get_bars_before", _fake_bars_before({"NVDA": rows}))
    body = {"items": [
        {"id": "si_i1", "type": "recall", "skill_id": "f1", "prompt_json": {"q": "x"}, "answer_json": {"answer": "a"},
         "review_status": "approved"},
        {"id": "si_i2", "type": "spot", "skill_id": "setup.vcp", "prompt_json": {"q": "x"},
         "answer_json": {"answer": "yes"}, "bars": {"sym": "nvda", "tf": "D", "asof": "2024-05-10", "window": 5,
                                                   "forward": 3}},
        {"id": "si_i3", "type": "spot", "skill_id": "setup.vcp", "prompt_json": {"q": "x"},
         "answer_json": {"answer": "yes"}, "bars": {"sym": "ZZZZ", "tf": "D", "asof": "2024-05-10", "window": 5}},
    ], "terms": [{"id": "st_1", "term": "bid", "definition": "d"}]}
    r = push_client.post("/api/study/import", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["inserted"] == 3 and out["terms"] == 1 and out["rejected"] == []
    assert out["misses"] == [{"id": "si_i3", "reason": "no_bars", "sym": "ZZZZ", "tf": "D"}]
    assert store.get_item_full("si_i1")["review_status"] == "draft"      # §8.8: never live on import
    i2 = store.get_item_full("si_i2")
    assert i2["sym"] == "NVDA" and i2["bars_ref"] == "sb_si_i2" and i2["asof"] == "2024-05-10"
    assert store.get_item_full("si_i3")["bars_ref"] == "sb_si_i3"        # stored, unresolved
    store.approve("si_i2", "owner")
    vis = store.get_visible_bars("si_i2")["bars"]
    assert [b["t"] for b in vis] == [20240506, 20240507, 20240508, 20240509, 20240510]
    assert [b["t"] for b in store.get_forward_bars("si_i2")] == [20240511, 20240512, 20240513]


def test_import_rejects_a_sha_mismatch_and_accepts_a_matching_one(push_client, store, monkeypatch):
    from api.services import bars_sqlite
    rows = [(20240501 + i, 1.0, 2.0, 0.5, 1.5, 100) for i in range(10)]
    monkeypatch.setattr(bars_sqlite, "get_bars_before", _fake_bars_before({"NVDA": rows}))
    spec = {"sym": "NVDA", "tf": "D", "asof": "2024-05-10", "window": 5, "forward": 0}
    item = {"id": "si_s", "type": "spot", "skill_id": "s", "prompt_json": {}, "answer_json": {"answer": "yes"}}
    r = push_client.post("/api/study/import", json={"items": [{**item, "bars": {**spec, "sha256": "deadbeef"}}]})
    out = r.json()
    assert out["inserted"] == 0 and out["rejected"][0]["reason"] == "sha_mismatch"
    assert store.get_item_full("si_s") is None
    good = study_router.resolve_bars(spec)["sha256"]
    r = push_client.post("/api/study/import", json={"items": [{**item, "bars": {**spec, "sha256": good}}]})
    assert r.json()["inserted"] == 1


def test_import_stores_an_owner_reviewed_item_as_approved_and_anything_else_as_draft(push_client, store):
    base = {"type": "recall", "skill_id": "vocab.method", "prompt_json": {"q": "Which term?", "choices": ["a", "b"]},
            "answer_json": {"answer": "a"}, "reveal_json": {}, "source_kind": "glossary", "source_ref": "x",
            "lesson_text": "A is the word.", "lesson_origin": "source"}
    owner_ok = {**base, "id": "si_ownerok0001", "review_status": "approved",
                "reviewed": {"by": "owner", "ts": "2026-10-17", "words": "approve"}}
    no_record = {**base, "id": "si_norecord001", "review_status": "approved"}
    wrong_by = {**base, "id": "si_wrongby0001", "review_status": "approved", "reviewed": {"by": "model"}}
    r = push_client.post("/api/study/import", json={"items": [owner_ok, no_record, wrong_by]})
    assert r.status_code == 200, r.text
    assert store.get_item_full("si_ownerok0001")["review_status"] == "approved"
    assert store.get_item_full("si_norecord001")["review_status"] == "draft"
    assert store.get_item_full("si_wrongby0001")["review_status"] == "draft"


def test_import_validation_error_is_a_400(push_client):
    r = push_client.post("/api/study/import", json={"items": [{"id": "bad", "type": "recall"}]})
    assert r.status_code == 400


def test_import_path_never_touches_bars_fetch():
    """B3: the importer resolves through bars_sqlite.get_bars_before only."""
    import inspect
    src = inspect.getsource(study_router)
    assert "bars_fetch" not in src
    assert "get_bars_before" in inspect.getsource(study_router.resolve_bars)
    assert "get_bars_since" not in src and "get_bars(" not in src


# ── walk-throughs (§13.9 #1): unit sessions and the seen attempt ─────────────

def _seed_walks(store):
    walks = [
        {"id": "si_walk_b", "type": "walkthrough", "skill_id": "setup.vcp", "difficulty": 1,
         "prompt_json": {"q": "VCP", "order": 2, "steps": ["Three pullbacks, each one smaller.", "Volume dries up on the last one."]},
         "answer_json": {"unscored": True}, "source_kind": "brief", "source_ref": "brief#1", "lesson_text": "That is the tell."},
        {"id": "si_walk_a", "type": "walkthrough", "skill_id": "setup.vcp", "difficulty": 1,
         "prompt_json": {"q": "VCP", "order": 1, "steps": ["Here is the base.", "It tightens to the right."]},
         "answer_json": {"unscored": True}, "source_kind": "brief", "source_ref": "brief#2", "lesson_text": "It tightens to the right."},
        {"id": "si_walk_c", "type": "walkthrough", "skill_id": "setup.vcp", "difficulty": 1,
         "prompt_json": {"q": "VCP", "order": 2, "steps": ["The pivot is the last high.", "Buy it there, not above."]},
         "answer_json": {"unscored": True}, "source_kind": "brief", "source_ref": "brief#3", "lesson_text": "Buy it there, not above."},
        {"id": "si_walk_d", "type": "walkthrough", "skill_id": "setup.vcp", "difficulty": 1,
         "prompt_json": {"q": "VCP", "order": 3, "steps": ["A fourth one.", "Never served: the cap is three."]},
         "answer_json": {"unscored": True}, "source_kind": "brief", "source_ref": "brief#4", "lesson_text": "A fourth one."},
    ]
    store.upsert_items(walks)
    for w in walks:
        store.approve(w["id"], "owner")
    return walks


def test_unit_session_serves_the_walkthroughs_first_in_order_then_the_scored_items(paid_client, store):
    _seed(store)
    _seed_walks(store)
    r = paid_client.post("/api/study/sessions", json={"kind": "unit", "skill_id": "setup.vcp"})
    assert r.status_code == 200, r.text
    body = r.json()
    ids = [i["id"] for i in body["items"]]
    assert ids[:3] == ["si_walk_a", "si_walk_b", "si_walk_c"]       # order 1, then order 2 by id; the 4th is capped
    assert set(ids[3:]) == {"si_spot1", "si_spot2"} and body["kind"] == "unit"
    first = body["items"][0]
    assert first["prompt_json"]["steps"] == ["Here is the base.", "It tightens to the right."]
    assert "answer_json" not in first and "lesson_text" not in first
    # GET /items/{id} serves the steps too
    assert paid_client.get("/api/study/items/si_walk_a").json()["prompt_json"]["steps"][0] == "Here is the base."
    # a unit needs a skill
    assert paid_client.post("/api/study/sessions", json={"kind": "unit"}).status_code == 400


def test_daily_skill_and_free_sets_never_carry_a_walkthrough(paid_client, store):
    _seed(store)
    _seed_walks(store)
    today = paid_client.get("/api/study/today").json()
    assert not any(i["type"] == "walkthrough" for i in today["items"]) and len(today["items"]) == 5
    for kind in ("skill", "free", "refresher"):
        s = paid_client.post("/api/study/sessions", json={"kind": kind, "skill_id": "setup.vcp"}).json()
        assert {i["id"] for i in s["items"]} == {"si_spot1", "si_spot2"}, kind


def test_walkthrough_attempt_is_seen_on_the_wire_no_xp_no_score(paid_client, store):
    _seed(store)
    _seed_walks(store)
    sess = paid_client.post("/api/study/sessions", json={"kind": "unit", "skill_id": "setup.vcp"}).json()
    r = paid_client.post("/api/study/attempts", json={"item_id": "si_walk_a", "answer": {"seen": 2},
                                                     "session_id": sess["session_id"], "time_ms": 3100})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["unscored"] is True and body["correct"] is True and body["score"] is None
    assert body["progress"]["xp_gained"] == 0 and body["progress"]["due_at"] is None
    assert body["progress"]["weekly_xp"] == 0 and body["progress"]["streak"] == 0
    assert body["reveal"]["detail"] == {"seen": 2, "unscored": True}
    assert body["reveal"]["lesson"] == "It tightens to the right." and "forward_bars" not in body["reveal"]
    assert body["skill"] == {"skill_id": "setup.vcp", "mastery": 0.0, "band": "learning", "reps": 0}
    # the board never saw it
    assert paid_client.get("/api/study/leaderboard").json()["you"] is None
    # a scored answer in the same session still pays as before
    s = paid_client.post("/api/study/attempts", json={"item_id": "si_spot1", "answer": "yes",
                                                     "session_id": sess["session_id"]}).json()
    assert s["unscored"] is False and s["progress"]["xp_gained"] == 30 and s["score"] == 1.0
