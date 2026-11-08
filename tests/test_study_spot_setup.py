"""SPOT THE SETUP (owner, 2026-11-08: "SPOT THE KICKER SHOULD be SPOT THE SETUP"): the look-alike candles a chart offers
are found with the setup's own rules (study_hard.SETUP_RULES), never invented. A fake setup stands in for the detectors
here so every branch is reachable on a small chart."""
from __future__ import annotations

import pytest

from api.services import study_hard as H
from api.services import study_spot_setup as SP


def _bars(n=60):
    out, c = [], 100.0
    for i in range(n):
        up = i % 3 != 0
        o = c * (1.002 if up else 0.998)
        cl = o * (1.012 if up else 0.988)
        out.append({"t": f"2024-01-{i:02d}", "o": o, "h": max(o, cl) * 1.004, "l": min(o, cl) * 0.996, "c": cl, "v": 1000 + i})
        c = cl
    # the last candle: a big green gap
    p = out[-2]["c"]
    out[-1] = {"t": "2024-03-01", "o": p * 1.05, "h": p * 1.10, "l": p * 1.045, "c": p * 1.095, "v": 5000}
    return out


@pytest.fixture()
def fake_rules(monkeypatch):
    fires_at = {"last"}
    raises_at = set()

    def rule(bars, S, i):
        if i in raises_at:
            raise RuntimeError("boom")
        return (i == len(bars) - 1 and "last" in fires_at) or i in fires_at

    monkeypatch.setattr(H, "SETUP_RULES", {"setup.fake": (rule,)})
    monkeypatch.setattr(SP.U, "series", lambda bars: {})
    return fires_at, raises_at


def test_two_lookalikes_of_the_same_colour_never_where_the_setup_fires(fake_rules):
    fires_at, _ = fake_rules
    bars = _bars()
    fires_at.add(50)                      # the setup also fires earlier on: that candle is never offered as a fake
    out = SP.lookalikes(bars, "setup.fake")
    assert out and out["real"] == len(bars) - 1
    ids = [x["i"] for x in out["lookalikes"]]
    assert len(ids) == 2 and 50 not in ids
    assert all(bars[i]["c"] >= bars[i]["o"] for i in ids)                 # green, like the real one
    assert all(i <= len(bars) - 1 - SP.MIN_FROM_LAST for i in ids)
    assert abs(ids[0] - ids[1]) >= SP.MIN_SPACING
    f = out["lookalikes"][0]["features"]
    assert set(f) >= {"gap_pct", "chg_pct", "close_pos", "rvol"} and out["real_features"]["gap_pct"] > 4


def test_no_game_when_the_setup_does_not_fire_on_the_last_candle(fake_rules):
    fires_at, _ = fake_rules
    fires_at.discard("last")
    assert SP.lookalikes(_bars(), "setup.fake") is None


def test_no_game_when_another_setup_fires_there_too(fake_rules, monkeypatch):
    rules = dict(H.SETUP_RULES)
    rules["setup.other"] = (lambda bars, S, i: i == len(bars) - 1,)
    monkeypatch.setattr(H, "SETUP_RULES", rules)
    assert SP.lookalikes(_bars(), "setup.fake") is None


def test_a_candle_whose_rule_raised_is_never_offered(fake_rules):
    _, raises_at = fake_rules
    bars = _bars()
    first = SP.lookalikes(bars, "setup.fake")
    raises_at.update(x["i"] for x in first["lookalikes"])
    second = SP.lookalikes(bars, "setup.fake")
    assert second and not ({x["i"] for x in second["lookalikes"]} & raises_at)


def test_an_unknown_setup_never_plays():
    assert SP.lookalikes(_bars(), "setup.nope") is None


def test_the_hard_pool_is_warmed_once_in_the_background(monkeypatch):
    """After a deploy the first member used to wait 80-100 s for the pool sweep; job_warm_hard_pool runs it after boot."""
    from api.services import study_jobs, study_store
    rows = [{"id": "a", "type": "spot", "skill_id": "setup.family3.kicker", "has_chart": 1},
            {"id": "b", "type": "spot", "skill_id": "setup.family3.kicker", "has_chart": 0},
            {"id": "c", "type": "recall", "skill_id": "vocab.candle", "has_chart": 1},
            {"id": "d", "type": "spot", "skill_id": "setup.family4.oops", "has_chart": 1}]
    seen = []
    monkeypatch.setattr(study_store, "list_bank", lambda: rows)
    monkeypatch.setattr(H, "item_eligible", lambda iid: seen.append(iid) or iid == "a")
    out = study_jobs.job_warm_hard_pool(delay_s=0, pause_s=0)
    assert seen == ["a", "d"] and out["swept"] == 2 and out["eligible"] == 1


def test_the_warm_stands_down_when_study_is_off(monkeypatch):
    from api.services import study_jobs
    monkeypatch.setenv("STUDY_ENABLED", "0")
    assert study_jobs.job_warm_hard_pool(delay_s=0, pause_s=0) is None


# ── POST /api/study/spot-setup: the game in one request ─────────────────────────────────────────────────────────────
def test_the_game_comes_in_one_request_yes_charts_only_mixed_across_setups(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import study as R
    from api.services import study_store as ss
    from api.services import study_spot_setup
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    ss.init_db()
    member = {"id": "u1", "email": "m@t.dev", "role": "member", "plan": "pro"}
    items = []
    for k, (skill, ans) in enumerate([("setup.family3.kicker", "yes"), ("setup.family3.kicker", "yes"), ("setup.family4.oops", "yes"),
                                      ("setup.family4.oops", "no"), ("setup.family3.hve", "yes")]):
        iid = f"si_{k}"
        items.append({"id": iid, "type": "spot", "skill_id": skill, "difficulty": 3, "bars_ref": f"sb_{iid}", "sym": "X", "asof": "2024-01-02",
                      "prompt_json": {"q": "fires?", "choices": ["Yes", "No"]}, "answer_json": {"answer": ans}, "reveal_json": {},
                      "source_kind": "detection", "source_ref": f"d:{iid}", "lesson_text": "L"})
    ss.upsert_items(items)
    for it in items:
        ss.upsert_bars(it["bars_ref"], "D", [{"t": 20240101 + d, "o": 1, "h": 1.1, "l": 0.9, "c": 1.0, "v": 10} for d in range(30)], [])
        ss.approve(it["id"], "owner")
    calls = []
    monkeypatch.setattr(study_spot_setup, "lookalikes", lambda bars, skill, view=90: calls.append(skill) or {"real": 29, "real_features": {}, "lookalikes": [{"i": 10, "features": {}}]})
    app = FastAPI()
    app.include_router(R.router)
    app.dependency_overrides[R.require_paid] = lambda: member
    client = TestClient(app)
    r = client.post("/api/study/spot-setup", json={"rounds": 3})
    assert r.status_code == 200
    body = r.json()
    ids = [i["id"] for i in body["items"]]
    assert len(ids) == 3 and "si_3" not in ids                                    # a No chart never plays
    assert {i["skill_id"] for i in body["items"]} == {"setup.family3.kicker", "setup.family4.oops", "setup.family3.hve"}
    assert all(i["look"]["real"] == 29 for i in body["items"]) and body["session_id"]
    assert all("answer_json" not in i for i in body["items"])                     # the key stays on the server
