"""Study's scheduler jobs (spec §7.1, §6.2b, §13.2 T8/T9): the registrations
in api/main.py pinned by AST, the reminder claim row (once per member per
day), the weekly close with its boot catch-up, and the detections generator
reading patterns.db by indexed columns only with confidence filtered in
Python.

Run alone: python -m pytest tests/test_study_jobs.py -q
"""
from __future__ import annotations

import ast
import contextlib
import json
import pathlib
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from api.services import study_jobs as sj
from api.services import study_store as ss
from api.services.pattern_engine import pattern_db

REPO = pathlib.Path(__file__).resolve().parent.parent
MAIN = REPO / "api/main.py"


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    monkeypatch.delenv("STUDY_ENABLED", raising=False)
    ss.init_db()
    return ss


# ── registrations (AST over api/main.py, with a non-vacuity control) ─────────

def _add_jobs(tree) -> dict:
    """{id: {kw: value}} for every add_job(...) with a literal id."""
    out = {}
    for n in ast.walk(tree):
        if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "add_job"):
            continue
        kws = {kw.arg: kw.value for kw in n.keywords}
        jid = kws.get("id")
        if isinstance(jid, ast.Constant):
            out[jid.value] = kws
    return out


def test_the_three_jobs_are_registered_and_no_fan_out_is():
    jobs = _add_jobs(ast.parse(MAIN.read_text(encoding="utf-8")))
    # ⛔ NON-VACUITY: the probe must see a sibling it is not looking for.
    assert "desk_session_insights" in jobs, "the add_job AST scan found no sibling job; the probe is broken"
    for jid in ("study_reminders", "study_weekly_close", "study_gen_detections"):
        assert jid in jobs, f"{jid} is defined and scheduled nowhere"
        mi = jobs[jid].get("max_instances")
        assert isinstance(mi, ast.Constant) and mi.value == 1, f"{jid} must be max_instances=1"
    assert "study_daily_sessions" not in jobs, "T9: there is no 06:30 fan-out job"


def test_the_detections_job_runs_after_two_am_on_weekdays():
    """T8: patterns.db is web-owned (universe scan 01:00 ET, prune 00:40 ET);
    the generator must run after 02:00 ET."""
    tree = ast.parse(MAIN.read_text(encoding="utf-8"))
    trig = _add_jobs(tree)["study_gen_detections"]["trigger"]
    kws = {kw.arg: kw.value.value for kw in trig.keywords if isinstance(kw.value, ast.Constant)}
    assert kws.get("hour") == 2 and kws.get("minute") == 30 and kws.get("day_of_week") == "mon-fri"
    trig = _add_jobs(tree)["study_weekly_close"]["trigger"]
    kws = {kw.arg: kw.value.value for kw in trig.keywords if isinstance(kw.value, ast.Constant)}
    assert kws.get("day_of_week") == "sun" and kws.get("hour") == 23 and kws.get("minute") == 59


def test_the_boot_catch_up_is_wired_in_main():
    src = MAIN.read_text(encoding="utf-8")
    assert "job_weekly_close_catchup" in src


# ── the kill switch is read per call ─────────────────────────────────────────

@pytest.mark.parametrize("job", ["job_reminders", "job_weekly_close", "job_weekly_close_catchup",
                                 "job_gen_detections"])
def test_every_job_is_inert_when_study_is_off(monkeypatch, job):
    calls = []
    for name in ("run_reminders", "run_weekly_close", "weekly_close_catchup", "run_gen_detections"):
        monkeypatch.setattr(sj, name, lambda *a, **k: calls.append(name) or {})
    monkeypatch.setenv("STUDY_ENABLED", "0")
    assert getattr(sj, job)() is None and calls == []
    monkeypatch.setenv("STUDY_ENABLED", "1")
    getattr(sj, job)()
    assert len(calls) == 1


def test_a_job_never_raises_into_the_scheduler(monkeypatch):
    monkeypatch.delenv("STUDY_ENABLED", raising=False)

    def boom(*a, **k):
        raise RuntimeError("db gone")
    monkeypatch.setattr(sj, "run_reminders", boom)
    assert sj.job_reminders() is None


# ── reminders: claim row, once per member per day ────────────────────────────

T_ET_10 = datetime(2026, 10, 14, 14, 0, tzinfo=timezone.utc)      # Wed 10:00 ET (EDT)


def _reminder_member(store, uid, time_s="09:00", tz=None):
    store.update_profile(uid, {"reminder_on": True, "reminder_time": time_s, "reminder_tz": tz})


def test_reminder_fires_once_per_member_per_day_via_the_claim_row(store):
    _reminder_member(store, "u_due")                       # 09:00 ET, now 10:00 ET → due
    _reminder_member(store, "u_later", "11:30")            # not yet
    _reminder_member(store, "u_west", "09:00", "America/Los_Angeles")   # 07:00 PT → not yet
    _reminder_member(store, "u_done")                      # due, but finished today's set
    store.update_profile("u_off", {"reminder_on": False, "reminder_time": "09:00"})
    store.upsert_items([{"id": "si_1", "type": "recall", "skill_id": "f1", "prompt_json": {"q": "x"},
                         "answer_json": {"answer": "a"}}])
    store.approve("si_1", "owner")
    day = store.et_day_of(T_ET_10)
    s = store.create_session("u_done", "daily", ["si_1"], day_et=day, now=T_ET_10)
    store.record_attempt("u_done", "si_1", "a", True, 1.0, session_id=s["id"], now=T_ET_10)

    pushes, bells = [], []
    out = sj.run_reminders(T_ET_10, dispatch=lambda *a: pushes.append(a), add_alert=lambda *a, **k: bells.append((a, k)))
    assert out == {"checked": 4, "sent": 1, "not_due": 2, "finished": 1, "already": 0}
    assert pushes == [("u_due", sj.REMINDER_TITLE, sj.REMINDER_BODY, sj.REMINDER_URL, sj.REMINDER_TAG)]
    assert bells[0][1]["user_id"] == "u_due" and bells[0][0][0] == sj.REMINDER_ALERT_TYPE
    # the next tick, same day: the claim row holds
    out = sj.run_reminders(T_ET_10 + timedelta(minutes=15), dispatch=lambda *a: pushes.append(a),
                           add_alert=lambda *a, **k: bells.append((a, k)))
    assert out["sent"] == 0 and out["already"] == 1 and len(pushes) == 1
    # 13:00 ET: the 11:30 member and the west-coast member (10:00 PT) come due, once each
    out = sj.run_reminders(T_ET_10 + timedelta(hours=3), dispatch=lambda *a: pushes.append(a),
                           add_alert=lambda *a, **k: bells.append((a, k)))
    assert out["sent"] == 2 and {p[0] for p in pushes[-2:]} == {"u_west", "u_later"}
    assert out["already"] == 1 and len(pushes) == 3
    # tomorrow is a new claim for everyone
    out = sj.run_reminders(T_ET_10 + timedelta(days=1), dispatch=lambda *a: pushes.append(a),
                           add_alert=lambda *a, **k: bells.append((a, k)))
    assert out["sent"] == 2 and {p[0] for p in pushes[-2:]} == {"u_due", "u_done"}


def test_reminder_push_failure_does_not_stop_the_bell_or_the_pass(store):
    _reminder_member(store, "u1")
    _reminder_member(store, "u2")
    bells = []

    def bad_push(*a):
        raise RuntimeError("push down")
    out = sj.run_reminders(T_ET_10, dispatch=bad_push, add_alert=lambda *a, **k: bells.append(k["user_id"]))
    assert out["sent"] == 2 and sorted(bells) == ["u1", "u2"]


def test_reminder_uses_web_push_dispatch_and_alerts_add_alert_by_default():
    import inspect
    src = inspect.getsource(sj.run_reminders)
    assert "web_push" in src and "dispatch = web_push.dispatch" in src
    assert "alerts.add_alert" in src


# ── weekly close + catch-up ───────────────────────────────────────────────────

def _xp(store, uid, when):
    store.upsert_items([{"id": "si_w", "type": "recall", "skill_id": "f1", "prompt_json": {"q": "x"},
                         "answer_json": {"answer": "a"}}])
    store.approve("si_w", "owner")
    store.record_attempt(uid, "si_w", "a", True, 1.0, now=when)


def test_weekly_close_catchup_closes_only_unclosed_past_weeks(store):
    now = datetime(2026, 10, 14, 15, 0, tzinfo=timezone.utc)          # Wed of week 2026-10-12
    _xp(store, "u1", now - timedelta(days=14))                          # week 2026-09-28
    _xp(store, "u1", now - timedelta(days=7))                           # week 2026-10-05
    _xp(store, "u1", now)                                               # this week
    assert sj.weekly_close_catchup(now) == ["2026-09-28", "2026-10-05"]
    assert sj.weekly_close_catchup(now) == []                           # idempotent
    assert store.closed_weeks() == {"2026-09-28", "2026-10-05"}         # never the open week
    # the Sunday job closes the open week; the next boot has nothing left
    sunday = datetime(2026, 10, 19, 3, 59, tzinfo=timezone.utc)         # Sun 23:59 ET
    out = sj.run_weekly_close(sunday)
    assert out["week_et"] == "2026-10-12" and out["rows"][0]["xp"] == 10
    assert sj.run_weekly_close(sunday) is None
    assert sj.weekly_close_catchup(sunday + timedelta(hours=2)) == []


# ── detections generator ──────────────────────────────────────────────────────

def _pattern_conn(tmp_path):
    conn = sqlite3.connect(str(tmp_path / "patterns.db"))
    conn.executescript(pattern_db._SCHEMA)
    return conn


def _det(conn, did, *, pid="vcp", conf=85.0, status="completed", detected_at, sym="NVDA",
         direction="bullish", outcome=True, bars_to_resolve=12):
    conn.execute(
        "INSERT INTO pattern_detections (id, sym, tf, pattern_id, category, direction, start_t, end_t, confidence, "
        "quality_json, geometry_json, levels_json, context_json, narrative_json, status, detected_at, last_seen_at, "
        "hash_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (did, sym, "D", pid, "uct", direction, 1700000000, 1716163200, conf, "{}",
         json.dumps({"contractions": 3, "base_depth_pct": 12.4, "atr14": 1.2}),
         json.dumps({"entry": 51.25, "stop": 48.1, "target_primary": 60.0}),
         json.dumps({"regime_bucket": "bull"}), "{}", status, detected_at, detected_at, f"hk_{did}"))
    if outcome:
        conn.execute(
            "INSERT INTO pattern_outcomes (detection_id, entry_hit, stop_hit, target_hit, mfe_pct, mae_pct, "
            "bars_to_resolve, resolved_at) VALUES (?,?,?,?,?,?,?,?)",
            (did, 1, int(status == "failed"), int(status == "completed"), 11.2, 2.0, bars_to_resolve, detected_at))
    conn.commit()


def _fake_resolve(spec):
    if spec["sym"] == "ZZZZ":
        return {"ok": False, "reason": "no_bars", "sym": "ZZZZ", "tf": "D"}
    vis = [{"t": 20240501 + i, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100} for i in range(5)]
    return {"ok": True, "tf": "D", "visible": vis, "forward": vis[:2], "sha256": "x"}


def test_detections_query_uses_only_indexed_columns_and_filters_confidence_in_python(store, tmp_path):
    conn = _pattern_conn(tmp_path)
    now = datetime(2026, 10, 15, 7, 0, tzinfo=timezone.utc)
    t = int(now.timestamp()) - 3600
    _det(conn, "d_ok", detected_at=t)                                   # eligible
    _det(conn, "d_low", conf=55.0, detected_at=t)                       # confidence < 70 → Python filter
    _det(conn, "d_internal", pid="uct_pullback_ma_v5", detected_at=t)   # internal but allowlisted
    _det(conn, "d_private", pid="secret_pattern", detected_at=t)        # not public → skipped
    _det(conn, "d_expired", status="expired", detected_at=t)            # status filter in SQL
    _det(conn, "d_old", detected_at=t - 400 * 86400)                    # outside the window
    _det(conn, "d_miss", sym="ZZZZ", detected_at=t)                     # bars miss → reported
    _det(conn, "d_noout", detected_at=t, outcome=False)                 # no outcome row → not joined
    sql_seen = []
    conn.set_trace_callback(sql_seen.append)
    public = {"vcp", "uct_pullback_ma_v5"}
    out = sj.run_gen_detections(now, conn=conn, resolve_bars=_fake_resolve, public_ids=public,
                                names={"vcp": "VCP"})
    q = [s for s in sql_seen if "pattern_detections" in s][0]
    where = q.split("WHERE", 1)[1]
    assert "confidence" not in where and "LIMIT" in q
    assert "detected_at" in where and "status" in where
    assert out["candidates"] == 5                     # d_ok, d_low, d_internal, d_private, d_miss
    assert out["eligible"] == 3                       # d_ok, d_internal, d_miss
    assert {s["id"] for s in out["skipped"]} == {"d_low", "d_private"}
    assert out["misses"] == [{"id": "d_miss", "reason": "no_bars", "sym": "ZZZZ", "tf": "D"}]
    assert out["items"] == 8                          # 4 types × 2 resolved detections
    drafts = store.list_drafts(limit=100)
    assert len(drafts) == 8 and all(d["review_status"] == "draft" for d in drafts)
    assert all(d["lesson_origin"] == "template" and d["lesson_text"] for d in drafts)
    assert all(d["bars_ref"] == f"sb_det_{d['source_ref'][4:]}" for d in drafts)
    assert all(d["sym"] == "NVDA" and d["asof"] == "2024-05-20" for d in drafts)
    assert {d["type"] for d in drafts} == {"spot", "levels", "next", "family"}
    assert {d["review_lane"] for d in drafts} == {"fast"}
    # the ticker never rides the prompt
    for d in drafts:
        assert "NVDA" not in json.dumps(d["prompt_json"])


def test_detection_items_are_deterministic_and_a_rerun_keeps_the_owners_approval(store, tmp_path):
    conn = _pattern_conn(tmp_path)
    now = datetime(2026, 10, 15, 7, 0, tzinfo=timezone.utc)
    _det(conn, "d1", detected_at=int(now.timestamp()) - 60)
    sj.run_gen_detections(now, conn=conn, resolve_bars=_fake_resolve, public_ids={"vcp"}, names={})
    spot_id = sj.item_id_for("d1", "spot")
    assert spot_id == sj.item_id_for("d1", "spot") and spot_id.startswith("si_") and len(spot_id) == 15
    store.approve(spot_id, "owner")
    out = sj.run_gen_detections(now, conn=conn, resolve_bars=_fake_resolve, public_ids={"vcp"}, names={})
    assert out["items"] == 4 and len(store.list_bank(status="approved")) == 1
    assert store.get_item_full(spot_id)["review_status"] == "approved"


def test_items_for_detection_shapes_keys_and_the_one_next_window():
    row = {"id": "d9", "sym": "nvda", "tf": "D", "pattern_id": "vcp", "direction": "bullish",
           "confidence": 91.2, "status": "completed", "end_t": 1716163200,
           "geometry_json": json.dumps({"contractions": 3, "atr14": 1.5}),
           "levels_json": json.dumps({"entry": 51.25, "stop": 48.1, "target_primary": 60}),
           "context_json": "{}", "target_hit": 1, "stop_hit": 0, "mfe_pct": 10, "mae_pct": 1,
           "bars_to_resolve": 25}                      # resolved AFTER the 20-session window
    setups = [{"canonical": "VCP", "family": "Bases & Breakouts", "skill_id": "setup.family1.vcp",
               "aliases": {"detector": "vcp"}},
              {"canonical": "Bull Flag", "family": "Bases & Breakouts", "skill_id": "x", "aliases": {}},
              {"canonical": "Kicker Candle", "family": "Gaps & Catalysts", "skill_id": "y", "aliases": {}}]
    items = {i["type"]: i for i in sj.items_for_detection(row, setups=setups, names={})}
    assert set(items) == {"spot", "levels", "next", "family"}
    spot = items["spot"]
    assert spot["answer_json"] == {"answer": "VCP"} and spot["skill_id"] == "setup.family1.vcp"
    assert spot["prompt_json"]["choices"][0] == "VCP" and spot["prompt_json"]["choices"][-1] == "None of these"
    assert "Bull Flag" in spot["prompt_json"]["choices"] and "Kicker Candle" in spot["prompt_json"]["choices"]
    assert items["levels"]["answer_json"] == {"entry": 51.25, "stop": 48.1, "target": 60.0, "atr14": 1.5}
    assert items["next"]["answer_json"] == {"outcome": "undecided", "window": 20}
    assert items["next"]["review_lane"] == "second_look"        # C14: unresolved inside the window
    assert items["family"]["answer_json"] == {"answer": "Bases & Breakouts"}
    for it in items.values():
        assert it["sym"] == "NVDA" and it["asof"] == "2024-05-20" and it["source_ref"] == "det:d9"
        assert it["lesson_origin"] == "template" and it["adjustment_basis"] == "split-adjusted"
        assert it["bars"] == {"sym": "NVDA", "tf": "D", "asof": "2024-05-20", "window": 120, "forward": 20}
        assert it["reveal_json"]["facts"]["name"] == "VCP"
    row["bars_to_resolve"] = 8
    assert {i["type"]: i for i in sj.items_for_detection(row, setups=setups, names={})}["next"]["answer_json"]["outcome"] == "up"
    row["direction"] = "bearish"
    assert {i["type"]: i for i in sj.items_for_detection(row, setups=setups, names={})}["next"]["answer_json"]["outcome"] == "down"


def test_public_ids_are_metadata_minus_internal_plus_the_seven_uct_ids():
    from api.routers.patterns import _PATTERN_METADATA
    from api.services.pattern_engine.detectors.registry import INTERNAL_PATTERN_IDS
    ids = sj.public_pattern_ids()
    assert len(sj.STUDY_INTERNAL_ALLOWLIST) == 7 and sj.STUDY_INTERNAL_ALLOWLIST <= set(INTERNAL_PATTERN_IDS)
    assert sj.STUDY_INTERNAL_ALLOWLIST <= ids and "vcp" in ids
    assert ids - set(_PATTERN_METADATA) == sj.STUDY_INTERNAL_ALLOWLIST
    assert sj.setup_for_detector("uct_kicker")["name"] == "Kicker Candle"
    assert sj.setup_for_detector("uct_pullback_ma_v5")["name"] == "20 EMA Pullback"
    assert sj.setup_for_detector("nothing") is None


def test_jobs_module_never_touches_bars_fetch():
    import inspect
    src = inspect.getsource(sj)
    assert "bars_fetch" not in src and "get_bars_since" not in src
