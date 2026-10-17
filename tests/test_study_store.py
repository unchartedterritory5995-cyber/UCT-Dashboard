"""Study store: schema, the ONE-transaction attempt write, the due ladder,
streaks, the trust counter (spec §6.1, §7.1, §13.2 T17, §13.5 P1, §13.9 #3).

Run alone: python -m pytest tests/test_study_store.py -q
"""
from __future__ import annotations

import contextlib
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from api.services import study_store as ss


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ss, "_DB_PATH", str(tmp_path / "study.db"))
    ss.init_db()
    return ss


def _item(iid="si_000000000001", **over):
    base = {"id": iid, "type": "recall", "skill_id": "f1.basics", "module": "F1", "difficulty": 2,
            "prompt_json": {"q": "What is a bid?", "choices": ["a", "b"]},
            "answer_json": {"answer": "a"}, "reveal_json": {"why": "because"},
            "source_kind": "glossary", "source_ref": "glossary#bid", "sym": None,
            "lesson_text": "A bid is what a buyer will pay.", "lesson_origin": "session"}
    base.update(over)
    return base


def _chart_item(iid="si_000000000002", sym="NVDA", **over):
    return _item(iid, type="spot", skill_id="setup.vcp", bars_ref=f"sb_{iid}", sym=sym,
                 asof="2024-05-20", answer_json={"answer": "yes"}, **over)


def _conn(store):
    return sqlite3.connect(store._DB_PATH)


T0 = datetime(2026, 10, 12, 15, 0, tzinfo=timezone.utc)   # a Monday, 11:00 ET


# ── schema ────────────────────────────────────────────────────────────────────

def test_init_db_creates_every_table(store):
    with contextlib.closing(_conn(store)) as c:
        names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for t in ("study_items", "study_bars", "study_corrections", "study_terms", "study_attempts",
              "study_item_state", "study_skill", "study_profile", "study_sessions", "study_badges",
              "study_checkpoints", "study_weekly_xp", "study_reminder_log", "study_trust"):
        assert t in names, t


def test_items_schema_carries_the_sweep_columns(store):
    with contextlib.closing(_conn(store)) as c:
        cols = {r[1] for r in c.execute("PRAGMA table_info(study_items)")}
    for col in ("lesson_text", "lesson_origin", "review_status", "adjustment_basis", "tier_scale_id",
                "review_lane", "sym", "asof", "bars_ref"):
        assert col in cols, col
    with contextlib.closing(_conn(store)) as c:
        acols = {r[1] for r in c.execute("PRAGMA table_info(study_attempts)")}
        pcols = {r[1] for r in c.execute("PRAGMA table_info(study_profile)")}
        tcols = {r[1] for r in c.execute("PRAGMA table_info(study_trust)")}
    assert "due_at" in acols
    for col in ("xp", "level", "streak", "streak_best", "last_done_day", "freeze_used_week",
                "daily_goal", "reminder_time", "reminder_on", "leaderboard_optout",
                "journal_autopsy_optin", "placement_json"):
        assert col in pcols, col
    assert {"item_type", "clean_count", "state", "sample_rate"} <= tcols


def test_init_db_is_idempotent(store):
    store.init_db()
    store.init_db()


def test_db_path_literal_is_the_censused_form():
    import inspect
    src = inspect.getsource(ss)
    assert 'os.environ.get("STUDY_DB_PATH", "/data/study.db")' in src


# ── items ─────────────────────────────────────────────────────────────────────

def test_upsert_defaults_to_draft_and_prompt_hides_the_key(store):
    r = store.upsert_items([_chart_item()])
    assert r["inserted"] == 1
    full = store.get_item_full("si_000000000002")
    assert full["review_status"] == "draft"
    assert full["sym"] == "NVDA"
    # a draft is not served to a member at all
    assert store.get_item_prompt("si_000000000002") is None
    store.approve("si_000000000002", "owner")
    p = store.get_item_prompt("si_000000000002")
    assert p is not None
    for forbidden in ("sym", "answer_json", "reveal_json", "lesson_text", "source_ref", "bars_ref"):
        assert forbidden not in p, forbidden
    assert p["has_chart"] is True
    assert p["prompt_json"]["q"] == "What is a bid?"


def test_reimport_same_version_keeps_status_higher_version_resets_to_draft(store):
    store.upsert_items([_item()])
    store.approve("si_000000000001", "owner")
    store.upsert_items([_item(lesson_text="edited")])
    assert store.get_item_full("si_000000000001")["review_status"] == "approved"
    store.upsert_items([_item(version=2)])
    full = store.get_item_full("si_000000000001")
    assert full["review_status"] == "draft" and full["version"] == 2


def test_upsert_requires_type_skill_prompt_and_answer(store):
    with pytest.raises(ValueError):
        store.upsert_items([{"id": "x", "type": "recall"}])


def test_visible_bars_use_the_item_id_as_symbol_and_hide_forward(store):
    store.upsert_items([_chart_item()])
    store.approve("si_000000000002", "owner")
    vis = [{"t": 20240517, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100}]
    fwd = [{"t": 20240521, "o": 1.5, "h": 3, "l": 1, "c": 2.5, "v": 200}]
    store.upsert_bars("sb_si_000000000002", "D", vis, fwd)
    b = store.get_visible_bars("si_000000000002")
    assert b["symbol"] == "si_000000000002"
    assert b["bars"] == vis
    assert "forward" not in b and "forward_json" not in b and "sha256" not in b
    assert store.get_forward_bars("si_000000000002") == fwd


def test_terms_roundtrip(store):
    n = store.upsert_terms([{"id": "st_1", "term": "bid", "definition": "what a buyer pays",
                             "aliases_json": ["bid price"], "category": "order"}])
    assert n == 1
    t = store.get_term("st_1")
    assert t["aliases_json"] == ["bid price"] and t["review_status"] == "draft"


# ── record_attempt: one transaction ──────────────────────────────────────────

def test_record_attempt_writes_all_five_tables(store):
    store.upsert_items([_item()])
    store.approve("si_000000000001", "owner")
    r = store.record_attempt("u1", "si_000000000001", {"answer": "a"}, True, 1.0, time_ms=900,
                             session_id="ss_x", now=T0)
    assert r["xp_gained"] == store.XP_CORRECT * 2          # difficulty 2
    assert r["streak"] == 1 and r["level"] == 1
    with contextlib.closing(_conn(store)) as c:
        assert c.execute("SELECT COUNT(*) FROM study_attempts").fetchone()[0] == 1
        assert c.execute("SELECT COUNT(*) FROM study_item_state").fetchone()[0] == 1
        assert c.execute("SELECT reps FROM study_skill WHERE user_id='u1'").fetchone()[0] == 1
        assert c.execute("SELECT xp FROM study_profile WHERE user_id='u1'").fetchone()[0] == 20
        assert c.execute("SELECT xp FROM study_weekly_xp WHERE user_id='u1'").fetchone()[0] == 20
    assert store.attempt_exists("u1", "si_000000000001")
    assert not store.attempt_exists("u2", "si_000000000001")


def test_record_attempt_is_atomic_a_failure_midway_writes_nothing(store, monkeypatch):
    store.upsert_items([_item()])
    store.approve("si_000000000001", "owner")
    store.record_attempt("u1", "si_000000000001", "a", True, 1.0, now=T0)

    def boom(*a, **k):
        raise RuntimeError("mid-transaction failure")
    monkeypatch.setattr(store, "_mastery_from_attempts", boom)   # runs AFTER the attempt + state writes
    with pytest.raises(RuntimeError):
        store.record_attempt("u1", "si_000000000001", "a", False, 0.0, now=T0 + timedelta(hours=1))
    with contextlib.closing(_conn(store)) as c:
        assert c.execute("SELECT COUNT(*) FROM study_attempts").fetchone()[0] == 1
        assert c.execute("SELECT misses FROM study_item_state").fetchone()[0] == 0
        assert c.execute("SELECT xp FROM study_profile WHERE user_id='u1'").fetchone()[0] == 20


def test_record_attempt_unknown_item_raises(store):
    with pytest.raises(ValueError):
        store.record_attempt("u1", "nope", None, True, 1.0)


def test_record_attempt_uses_begin_immediate(store):
    import inspect
    src = inspect.getsource(store._write)
    assert "BEGIN IMMEDIATE" in src


# ── due ladder (P1) ───────────────────────────────────────────────────────────

def _due_days(r, now):
    return round((datetime.fromisoformat(r["due_at"]) - now).total_seconds() / 86400)


def test_due_ladder_three_ten_thirty_then_stays(store):
    store.upsert_items([_item()])
    store.approve("si_000000000001", "owner")
    now = T0
    got = []
    for _ in range(4):
        r = store.record_attempt("u1", "si_000000000001", "a", True, 1.0, now=now)
        got.append(_due_days(r, now))
        now += timedelta(days=1)
    assert got == [3, 10, 30, 30]


def test_wrong_answer_comes_back_tomorrow_and_resets_the_rung(store):
    store.upsert_items([_item()])
    store.approve("si_000000000001", "owner")
    now = T0
    store.record_attempt("u1", "si_000000000001", "a", True, 1.0, now=now)
    store.record_attempt("u1", "si_000000000001", "a", True, 1.0, now=now)   # rung 2 → next would be 30
    r = store.record_attempt("u1", "si_000000000001", "b", False, 0.0, now=now)
    assert _due_days(r, now) == 1
    r = store.record_attempt("u1", "si_000000000001", "a", True, 1.0, now=now)
    assert _due_days(r, now) == 3                                              # ladder restarted
    assert store.missed_item_ids("u1") == {"si_000000000001"}


def test_list_due_returns_only_due_approved_items_vocab_first(store):
    store.upsert_items([_item("si_a", skill_id="f2.trend"), _item("si_v", skill_id="vocab.chart"),
                        _item("si_later", skill_id="f2.trend")])
    for i in ("si_a", "si_v", "si_later"):
        store.approve(i, "owner")
    store.record_attempt("u1", "si_a", "a", True, 1.0, now=T0 - timedelta(days=5))     # due 2 days ago
    store.record_attempt("u1", "si_v", "a", True, 1.0, now=T0 - timedelta(days=4))     # due 1 day ago
    store.record_attempt("u1", "si_later", "a", True, 1.0, now=T0)                     # due in 3 days
    due = store.list_due("u1", 3, now=T0)
    assert [d["id"] for d in due] == ["si_v", "si_a"]
    assert all(d["why"] == "due" for d in due)


def test_list_due_adds_a_stale_skill_item_when_slots_remain(store):
    store.upsert_items([_item("si_a", skill_id="f2.trend"), _item("si_b", skill_id="f2.trend")])
    store.approve("si_a", "owner")
    store.approve("si_b", "owner")
    store.record_attempt("u1", "si_a", "a", True, 1.0, now=T0 - timedelta(days=40))
    assert store.refresh_freshness("u1", now=T0) == 1
    due = store.list_due("u1", 3, now=T0)
    ids = [d["id"] for d in due]
    assert "si_a" in ids                                    # overdue by 37 days
    stale = [d for d in due if d["why"] == "stale"]
    assert stale and stale[0]["skill_id"] == "f2.trend"


# ── streak + weekly xp ────────────────────────────────────────────────────────

def test_streak_counts_days_with_one_free_day_a_week(store):
    store.upsert_items([_item()])
    store.approve("si_000000000001", "owner")
    day = T0
    r = store.record_attempt("u1", "si_000000000001", "a", True, 1.0, now=day)
    assert r["streak"] == 1
    r = store.record_attempt("u1", "si_000000000001", "a", True, 1.0, now=day)        # same day
    assert r["streak"] == 1
    r = store.record_attempt("u1", "si_000000000001", "a", True, 1.0, now=day + timedelta(days=1))
    assert r["streak"] == 2
    r = store.record_attempt("u1", "si_000000000001", "a", True, 1.0, now=day + timedelta(days=3))
    assert r["streak"] == 3                                   # Thu: Wed forgiven (the week's free day)
    r = store.record_attempt("u1", "si_000000000001", "a", True, 1.0, now=day + timedelta(days=5))
    assert r["streak"] == 1 and r["streak_best"] == 3         # Sat: a second miss in the SAME week resets
    r = store.record_attempt("u1", "si_000000000001", "a", True, 1.0, now=day + timedelta(days=7))
    assert r["streak"] == 2                                   # Mon next week: Sun forgiven (new week)


def test_weekly_xp_is_keyed_on_the_monday(store):
    store.upsert_items([_item()])
    store.approve("si_000000000001", "owner")
    r = store.record_attempt("u1", "si_000000000001", "a", True, 1.0, now=T0)
    assert r["week_et"] == "2026-10-12"
    assert store.week_of("2026-10-18") == "2026-10-12"        # Sunday belongs to the Monday's week


def test_leaderboard_excludes_optouts_and_ranks_you(store):
    store.upsert_items([_item()])
    store.approve("si_000000000001", "owner")
    for u, n in (("a", 3), ("b", 2), ("c", 1)):
        for _ in range(n):
            store.record_attempt(u, "si_000000000001", "a", True, 1.0, now=T0)
    store.update_profile("a", {"leaderboard_optout": True, "display_name": "Ace"})
    store.update_profile("b", {"display_name": "Bee"})
    lb = store.leaderboard("2026-10-12", user_id="c")
    assert [r["display_name"] for r in lb["rows"]] == ["Bee", "Member"]
    assert lb["rows"][1]["you"] is True
    assert lb["you"] == {"rank": 2, "xp": 20}
    assert "user_id" not in lb["rows"][0]


# ── profile ───────────────────────────────────────────────────────────────────

def test_profile_defaults_and_editable_fields(store):
    p = store.get_profile("u9")
    assert p["daily_goal"] == 50 and p["streak"] == 0 and p["xp"] == 0
    p = store.update_profile("u9", {"daily_goal": 5, "reminder_on": True, "xp": 9999,
                                    "placement_json": {"start": "F2"}})
    assert p["daily_goal"] == 10                             # floored
    assert p["reminder_on"] == 1 and p["xp"] == 0            # xp is not member-editable
    assert p["placement_json"] == {"start": "F2"}


# ── review loop + graduated trust (§13.9 #3) ─────────────────────────────────

def test_approve_counts_clean_fix_and_reject_reset(store):
    items = [_item(f"si_{i:012d}") for i in range(5)]
    store.upsert_items(items)
    for it in items[:3]:
        store.approve(it["id"], "owner", reason="clean")
    assert store.trust_state("recall")["clean_count"] == 3
    out = store.fix(items[3]["id"], "owner", "lesson_text", "better", reason="voice")
    assert out["trust"]["clean_count"] == 0
    fixed = store.get_item_full(items[3]["id"])
    assert fixed["lesson_text"] == "better" and fixed["review_status"] == "draft" and fixed["version"] == 2
    store.approve(items[4]["id"], "owner")
    store.reject(items[0]["id"], "owner", reason="duplicate")
    assert store.trust_state("recall")["clean_count"] == 0
    assert store.get_item_full(items[0]["id"])["review_status"] == "rejected"
    corr = store.export_corrections()
    assert [c["action"] for c in corr] == ["approve", "approve", "approve", "fix", "approve", "reject"]
    assert corr[3]["field"] == "lesson_text" and corr[3]["after_json"] == "better"
    assert corr[5]["reason"] == "duplicate"


def test_trust_asks_to_switch_at_twenty_clean_and_owner_flips_it(store):
    items = [_item(f"si_{i:012d}", type="size") for i in range(store.TRUST_ASK_AT)]
    store.upsert_items(items)
    for it in items:
        store.approve(it["id"], "owner")
    t = store.trust_state("size")
    assert t["clean_count"] == store.TRUST_ASK_AT and t["ask_to_switch"] is True and t["state"] == "manual"
    t = store.set_trust_state("size", "sampled")
    assert t["state"] == "sampled" and t["ask_to_switch"] is False and t["sample_rate"] == store.TRUST_SAMPLE_RATE
    with pytest.raises(ValueError):
        store.set_trust_state("size", "auto")
    store.reset_trust("size")
    assert store.trust_state("size") == {**store.trust_state("size"), "clean_count": 0, "state": "manual"}


def test_review_rejects_unknown_action_and_bad_fix_field(store):
    store.upsert_items([_item()])
    with pytest.raises(ValueError):
        store.review("si_000000000001", "bless", "owner")
    with pytest.raises(ValueError):
        store.fix("si_000000000001", "owner", "sym", "SPY")


def test_drafts_listing_by_lane_and_counts(store):
    store.upsert_items([_item("si_1", review_lane="deterministic", type="size"),
                        _item("si_2"), _item("si_3")])
    store.approve("si_3", "owner")
    assert [d["id"] for d in store.list_drafts(lane="deterministic")] == ["si_1"]
    assert store.draft_counts() == {"deterministic": {"size": 1}, "manual": {"recall": 1}}


# ── sessions / reminders ──────────────────────────────────────────────────────

def test_sessions_and_answered_ids(store):
    store.upsert_items([_item("si_1"), _item("si_2")])
    store.approve("si_1", "owner")
    s = store.create_session("u1", "daily", ["si_1", "si_2"], day_et="2026-10-14")
    assert store.get_daily_session("u1", "2026-10-14")["id"] == s["id"]
    assert store.get_daily_session("u1", "2026-10-15") is None
    store.record_attempt("u1", "si_1", "a", True, 1.0, session_id=s["id"], now=T0)
    assert store.answered_item_ids("u1", s["id"]) == ["si_1"]
    store.finish_session(s["id"], {"score": 1})
    assert store.get_session(s["id"])["result"] == {"score": 1}


def test_reminder_claim_row_fires_once_per_day(store):
    assert store.claim_reminder("u1", "2026-10-14") is True
    assert store.claim_reminder("u1", "2026-10-14") is False
    assert store.claim_reminder("u1", "2026-10-15") is True


def test_badges_and_checkpoints(store):
    assert store.award_badge("u1", "m1") is True
    assert store.award_badge("u1", "m1") is False
    assert [b["badge_id"] for b in store.list_badges("u1")] == ["m1"]
    store.record_checkpoint("u1", "M5", False, 0.7, ["size"])
    cid = store.record_checkpoint("u1", "M5", True, 1.0)
    with contextlib.closing(_conn(store)) as c:
        assert c.execute("SELECT attempt_no FROM study_checkpoints WHERE id=?", (cid,)).fetchone()[0] == 2
