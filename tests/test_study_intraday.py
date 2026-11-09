"""The replay within the day (2026-11-08; the owner: "tick by tick so each day has multiuple ticks like using each 30 min
or hourly close"): the day check (api/services/study_intraday.py), the store, the member-only read, and the fill script.

Run alone: python -m pytest tests/test_study_intraday.py -q
"""
from __future__ import annotations

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.study as study_router
from api.middleware.auth_middleware import get_current_user
from api.services import study_intraday as si
from api.services import study_store as ss

ET = ZoneInfo("America/New_York")
DAYS = [20240603, 20240604, 20240605, 20240606, 20240607]
VIS = [{"t": 20240528 + i, "o": 10.0, "h": 11.0, "l": 9.0, "c": 10.5, "v": 1000} for i in range(4)]
FWD = [{"t": d, "o": 20.0 + i, "h": 22.0 + i, "l": 19.0 + i, "c": 21.0 + i, "v": 13000} for i, d in enumerate(DAYS)]


def _sessions(day: dict, tf: int = 30, extra: bool = True) -> list[dict]:
    """A day's bars that add up to its daily candle: the open first, the high and the low inside, the close last; plus a
    bar before the open and one after the close, which the session filter must drop."""
    s = str(day["t"])
    start = datetime(int(s[:4]), int(s[4:6]), int(s[6:8]), 9, 30, tzinfo=ET)
    n = 390 // tf
    out = []
    for k in range(n):
        t = int(start.timestamp()) + k * tf * 60
        o = day["o"] if k == 0 else day["o"] + 0.5
        c = day["c"] if k == n - 1 else day["o"] + 0.5
        h = day["h"] if k == n // 2 else max(o, c) + 0.1
        l = day["l"] if k == 1 else min(o, c) - 0.1
        out.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": 1000})
    if extra:
        out.insert(0, {"t": int(start.timestamp()) - 90 * 60, "o": 99.0, "h": 99.0, "l": 99.0, "c": 99.0, "v": 5})
        out.append({"t": int(start.timestamp()) + 7 * 3600, "o": 99.0, "h": 99.0, "l": 99.0, "c": 99.0, "v": 5})
    return out


# ── the day check ─────────────────────────────────────────────────────────────

def test_day_key_reads_every_form():
    assert si.day_key(20240603) == 20240603 and si.day_key("2024-06-03") == 20240603
    t = int(datetime(2024, 6, 3, 15, 30, tzinfo=ET).timestamp())
    assert si.day_key(t) == 20240603 and si.day_key("nope") is None


def test_session_days_keeps_the_regular_session_only():
    bars = _sessions(FWD[0])
    days = si.session_days(bars, 30)
    assert list(days) == [20240603] and len(days[20240603]) == 13
    assert all(b["o"] != 99.0 for b in days[20240603])


def test_a_day_that_adds_up_passes_and_each_way_it_does_not_is_named():
    day = FWD[0]
    ticks = si.session_days(_sessions(day), 30)[20240603]
    assert si.check_day(day, ticks, 30) is None
    assert si.check_day({**day, "c": day["c"] * 1.05}, ticks, 30) == "close"
    assert si.check_day({**day, "h": day["h"] * 0.9}, ticks, 30) == "range"
    assert si.check_day({**day, "o": day["o"] * 1.1}, ticks, 30) == "open"
    assert si.check_day(day, ticks[:2], 30) == "thin"
    # a split adjusted since the chart was stored: every price off by the ratio, so nothing passes
    assert si.check_day({k: (v * 2 if k in "ohlc" else v) for k, v in day.items()}, ticks, 30) is not None


def test_build_keeps_only_the_days_that_add_up():
    bars = _sessions(FWD[0]) + _sessions(FWD[1]) + _sessions({**FWD[2], "c": 99.0})   # day 3 closes elsewhere
    out = si.build(FWD, bars, 30)
    assert sorted(out["days"]) == ["20240603", "20240604"]
    assert out["passed"] == 2 and out["failed"] == 3 and out["why"] == {"close": 1, "missing": 2}
    first = out["days"]["20240603"][0]
    assert len(first) == 6 and first[1] == FWD[0]["o"]


# ── the store and the read ────────────────────────────────────────────────────

@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    ss.init_db()
    ss.upsert_items([{"id": "si_k1", "type": "spot", "skill_id": "setup.vcp", "difficulty": 3, "bars_ref": "sb_k1",
                      "sym": "NVDA", "asof": "2024-05-31", "prompt_json": {"q": "VCP?"}, "answer_json": {"answer": "yes"},
                      "source_kind": "detection", "source_ref": "det:k1"}])
    ss.upsert_bars("sb_k1", "D", VIS, FWD)
    ss.approve("si_k1", "owner")
    return ss


def _member(user):
    app = FastAPI()
    app.include_router(study_router.router)
    app.dependency_overrides[study_router.require_paid] = lambda: user
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_the_store_round_trip(store):
    assert store.get_intraday("si_k1") is None and store.intraday_filled() == set()
    store.upsert_intraday("sb_k1", "30", si.build(FWD, _sessions(FWD[0]), 30), source="test")
    got = store.get_intraday("si_k1")
    assert got["tf"] == "30" and list(got["days"]) == ["20240603"]
    assert store.intraday_filled() == {"sb_k1"} and store.intraday_filled(with_days_only=True) == {"sb_k1"}
    store.upsert_intraday("sb_k1", "30", {"days": {}, "passed": 0, "failed": 5, "why": {"missing": 5}})
    assert store.get_intraday("si_k1") is None and store.intraday_filled(with_days_only=True) == set()


def test_the_ticks_reach_only_the_member_who_answered(store):
    store.upsert_intraday("sb_k1", "30", si.build(FWD, _sessions(FWD[0]) + _sessions(FWD[1]), 30), source="test")
    me = _member({"id": "u1", "email": "m@t.dev", "role": "member", "plan": "pro"})
    other = _member({"id": "u2", "email": "o@t.dev", "role": "member", "plan": "pro"})
    aid = me.post("/api/study/attempts", json={"item_id": "si_k1", "answer": "yes"}).json()["attempt_id"]
    r = me.get(f"/api/study/attempts/{aid}/intraday")
    assert r.status_code == 200
    body = r.json()
    assert body["tf"] == "30" and sorted(body["days"]) == ["20240603", "20240604"] and len(body["days"]["20240603"]) == 13
    assert "NVDA" not in json.dumps(body)
    assert other.get(f"/api/study/attempts/{aid}/intraday").status_code == 404
    assert me.get("/api/study/attempts/999/intraday").status_code == 404


def test_a_chart_with_nothing_stored_answers_empty_days(store):
    me = _member({"id": "u1", "email": "m@t.dev", "role": "member", "plan": "pro"})
    aid = me.post("/api/study/attempts", json={"item_id": "si_k1", "answer": "yes"}).json()["attempt_id"]
    assert me.get(f"/api/study/attempts/{aid}/intraday").json() == {"item_id": "si_k1", "tf": None, "days": {}}


# ── the fill ──────────────────────────────────────────────────────────────────

def test_the_fill_stores_what_adds_up_and_skips_it_next_time(store, tmp_path, monkeypatch, capsys):
    from scripts.study import fill_replay_intraday as fill
    monkeypatch.setenv("STUDY_DB_PATH", ss._DB_PATH)
    src = tmp_path / "bars.json"
    rows = [[b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]] for d in FWD[:3] for b in _sessions(d)]
    src.write_text(json.dumps({"NVDA": rows}), encoding="utf-8")
    assert fill.main(["--from-file", str(src), "--dry-run"]) == 0
    dry = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert dry["charts"] == 1 and dry["days_passed"] == 3 and store.get_intraday("si_k1") is None
    assert fill.main(["--from-file", str(src)]) == 0
    capsys.readouterr()
    assert sorted(store.get_intraday("si_k1")["days"]) == ["20240603", "20240604", "20240605"]
    assert fill.main(["--from-file", str(src)]) == 0
    again = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert again["already_filled"] == 1 and again.get("charts", 0) == 0


def test_the_fill_never_creates_a_database(tmp_path, monkeypatch, capsys):
    from scripts.study import fill_replay_intraday as fill
    missing = tmp_path / "nowhere" / "study.db"
    monkeypatch.setattr(ss, "_DB_PATH", str(missing))
    monkeypatch.setenv("STUDY_DB_PATH", str(missing))
    assert fill.main(["--dry-run"]) == 2
    assert "refused" in capsys.readouterr().out and not missing.exists() and not missing.parent.exists()
