"""TERM-025 FLIP for `regime-change`: ALERT_TAXONOMY_REGIME_CHANGE_LIVE_ENABLED.

Two legacy emitters, both covered:
  A. awareness/engine.run_awareness_scan -> rules.rule_regime_flip (R4)
  B. voice_proactive_service.maybe_emit_regime_shift (session-summary path)

Flag OFF: both are unchanged and the taxonomy writes nothing. Flag ON: both
stand down at their call site, the taxonomy rule decides, records the fire in
`alert_fires` and delivers through `delivery.deliver_insight` as the SAME
Compass insight row (kind, headline, body, importance, symbol) the legacy
wrote; one insight per event; nothing a member got is lost.

The insight store is the real one (`add_insight` against the session's
sandboxed auth.db, a fresh member per case) so the legacy dedup that reads it
(`_regime_shift_already_told`) is exercised for real.
"""
from __future__ import annotations

import ast
import pathlib
import uuid
from datetime import date

import pytest

from api.services import voice_memory_service as vms
from api.services import voice_proactive_service as vps
from api.services import voice_regime_classifier as vrc
from api.services.alert_taxonomy import db as at_db
from api.services.alert_taxonomy import regime_change as rc
from api.services.alert_taxonomy import regime_change_compare as cmp_
from api.services.alert_taxonomy import regime_change_live as live
from api.services.alert_taxonomy import regime_change_projection as proj
from api.services.awareness import engine as eng

_REPO = pathlib.Path(__file__).resolve().parents[1]
OTHER_FLAGS = ("ALERT_TAXONOMY_SCAN_MEMBERSHIP_LIVE_ENABLED",
               "ALERT_TAXONOMY_CATALYST_MATCH_LIVE_ENABLED")


@pytest.fixture()
def env(tmp_path, monkeypatch):
    from api.services.auth_db import init_db
    init_db()
    monkeypatch.setattr(at_db, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    for f in (live.FLAG, *OTHER_FLAGS, "ALERT_ROUTING_RULE_ENABLED",
              "ALERT_QUEUE_CAPS_ENABLED", "ALERT_WEBHOOKS_ENABLED",
              "AWARENESS_THESIS_REVIEW_ENABLED"):
        monkeypatch.delenv(f, raising=False)
    monkeypatch.setenv("AWARENESS_ENGINE_ENABLED", "1")
    monkeypatch.setattr(eng, "_note_resurface_enabled", lambda: False)
    ledger = {"id": 100}
    monkeypatch.setattr(proj, "ledger_reading", lambda: {"ledger_id": ledger["id"]})
    away = []
    monkeypatch.setattr("api.services.watchlist_alert_service.deliver_alert_payload",
                        lambda **kw: away.append(kw))
    return {"mp": monkeypatch, "ledger": ledger, "away": away}


def _uid():
    """A fresh member (voice_proactive_insights.user_id REFERENCES users)."""
    uid = f"flip-{uuid.uuid4().hex[:10]}"
    conn = vps.get_connection()
    try:
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) "
                     "VALUES (?, ?, 'x', 'x', 'member')", (uid, f"{uid}@x.test"))
        conn.commit()
    finally:
        conn.close()
    return uid


def _insights(user_id):
    conn = vps.get_connection()
    try:
        rows = conn.execute(
            "SELECT kind, headline, body, importance, symbol FROM voice_proactive_insights "
            "WHERE user_id = ? ORDER BY id", (user_id,)).fetchall()
    finally:
        conn.close()
    return [tuple(r) for r in rows]


def _fires(user_id=None):
    import sqlite3
    c = sqlite3.connect(at_db.DB_PATH)
    try:
        q = "SELECT predicate_id, trigger_type, fire_key, entity_ref FROM alert_fires"
        rows = c.execute(q + (" WHERE user_id = ?" if user_id else ""),
                         ((user_id,) if user_id else ())).fetchall()
        return rows
    except sqlite3.OperationalError:
        return []
    finally:
        c.close()


# ─────────────────────────────────────────────────────────────────────────────
# Path A — R4 through the awareness scan
# ─────────────────────────────────────────────────────────────────────────────

def _scan(env, user_id, *, label, prev, confidence=0.7, positions=False, watch=False):
    ctx = {user_id: {"positions": ([{"symbol": "NVDA", "side": "Long", "stop_price": None,
                                     "entry_price": None, "source": None}]
                                   if positions else []),
                     "watch_syms": {"AAPL"} if watch else set(),
                     "mentioned_symbols": set()}}
    env["mp"].setattr(eng, "_bulk_load_user_contexts", lambda: ctx)
    env["mp"].setattr(eng, "_build_market_scan_ctx", lambda u: {
        "live_prices": {}, "regime": {"label": label, "prev_label": prev,
                                      "confidence": confidence, "degraded": False},
        "earnings_by_symbol": {}, "earnings_window_days": 3, "today": date(2026, 10, 12)})
    return eng.run_awareness_scan()


#: Every case R4 / the compare harness distinguishes for path A.
A_CASES = {
    "flip_with_position": dict(label="bear_trend", prev="bull_trend", positions=True),
    "flip_with_watch_only": dict(label="chop", prev="bull_trend", watch=True),
    "flip_with_both": dict(label="distribution", prev="chop", positions=True, watch=True),
    "flip_with_no_stake": dict(label="bear_trend", prev="bull_trend"),
    "no_flip": dict(label="chop", prev="chop", positions=True),
    "first_ever_cycle": dict(label="chop", prev=None, positions=True),
    "degraded_reading": dict(label=None, prev="chop", positions=True),
    "zero_confidence_flip": dict(label="bear_trend", prev="chop", positions=True,
                                 confidence=0.0),
    "missing_confidence_flip": dict(label="bear_trend", prev="chop", watch=True,
                                    confidence=None),
}


@pytest.mark.parametrize("name", sorted(A_CASES))
def test_path_A_flag_on_queues_EXACTLY_the_insight_R4_queued(env, name):
    case = A_CASES[name]
    a, b = _uid(), _uid()
    r_legacy = _scan(env, a, **case)
    legacy = _insights(a)
    assert _fires() == []
    env["mp"].setenv(live.FLAG, "1")
    r_live = _scan(env, b, **case)
    taxonomy = _insights(b)
    assert taxonomy == legacy, (name, legacy, taxonomy)
    assert r_live["fired"] == r_legacy["fired"]
    assert len(_fires(b)) == len(taxonomy)
    for pid, ttype, key, entity in _fires(b):
        assert ttype == rc.TYPE_ID and pid == live.live_predicate_id(b, rc.LEDGER)
        assert key == "ledger:100" and entity is None
    assert env["away"] == [], "a regime flip reached email/Discord"


def test_path_A_one_insight_per_ledger_move(env):
    """The ledger is the dedup: the same flip re-observed in the same cycle
    (same ledger row) never queues twice."""
    env["mp"].setenv(live.FLAG, "1")
    u = _uid()
    _scan(env, u, label="bear_trend", prev="bull_trend", positions=True)
    _scan(env, u, label="bear_trend", prev="bull_trend", positions=True)
    assert len(_insights(u)) == 1
    env["ledger"]["id"] = 101       # the next cycle appended a row; prev == label
    _scan(env, u, label="bear_trend", prev="bear_trend", positions=True)
    assert len(_insights(u)) == 1
    env["ledger"]["id"] = 102       # A -> B -> A: a genuine new flip fires again
    _scan(env, u, label="bull_trend", prev="bear_trend", positions=True)
    assert len(_insights(u)) == 2


def test_path_A_keeps_R4s_PLACE_against_the_shared_daily_cap(env):
    """R4's slot is kept between earnings and thesis-review, so the shared
    8/day insight cap meets the regime fire in the legacy's order."""
    seen = []
    real = eng._fire_candidate
    env["mp"].setattr(eng, "_fire_candidate",
                      lambda uid, c: seen.append(c.kind) or real(uid, c))
    real_live = live.fire_ledger
    env["mp"].setattr(live, "fire_ledger",
                      lambda *a, **k: seen.append("TAXONOMY") or real_live(*a, **k))
    env["mp"].setattr(eng.rules, "rule_stop_watch",
                      lambda s, u: [eng.InsightCandidate(kind="stop_hit", symbol="NVDA",
                                                         headline="h", body="b",
                                                         base_signal=1.0,
                                                         personal_multiplier=1.0,
                                                         urgency=1.0, dedup_key="k")])
    env["mp"].setenv(live.FLAG, "1")
    _scan(env, _uid(), label="bear_trend", prev="bull_trend", positions=True)
    assert seen == ["stop_hit", "TAXONOMY"]


def test_path_A_flag_off_never_calls_the_live_module(env):
    def _boom(*a, **k):
        raise AssertionError("the live module ran with the flag OFF")
    env["mp"].setattr(live, "fire_ledger", _boom)
    env["mp"].setattr(live, "ledger_cycle_key", _boom)
    u = _uid()
    assert _scan(env, u, label="bear_trend", prev="bull_trend", positions=True)["fired"] == 1
    assert [r[0] for r in _insights(u)] == ["regime_flip"]
    assert _fires() == []


# ─────────────────────────────────────────────────────────────────────────────
# Path B — the session summary
# ─────────────────────────────────────────────────────────────────────────────

def _drive_b(env, user_id, *, label, text, narration="Breadth narrowed."):
    env["mp"].setattr(vrc, "get_current_regime",
                      lambda *a, **k: {"regime": label, "narration": narration,
                                       "confidence": 0.6})
    env["mp"].setattr(vms, "list_summaries",
                      lambda uid, **k: [] if text is None else [{"summary_text": text}])
    return vps.maybe_emit_regime_shift(user_id)


B_CASES = {
    "summary_names_another_label": dict(label="bear_trend", text="we were in chop all week"),
    "substring_choppy_F_S7_RC_2": dict(label="bear_trend", text="the tape was choppy"),
    "summary_names_only_current": dict(label="chop", text="we were in chop all week"),
    "summary_names_no_label": dict(label="bear_trend", text="nothing about regimes"),
    "no_summary_at_all": dict(label="bear_trend", text=None),
    "no_current_label": dict(label="", text="we were in chop all week"),
    "first_label_in_scan_order_wins": dict(label="chop",
                                           text="from bull_trend to distribution"),
}


@pytest.mark.parametrize("name", sorted(B_CASES))
def test_path_B_flag_on_queues_EXACTLY_the_insight_the_legacy_queued(env, name):
    case = B_CASES[name]
    a, b = _uid(), _uid()
    n_legacy = _drive_b(env, a, **case)
    legacy = _insights(a)
    env["mp"].setenv(live.FLAG, "1")
    n_live = _drive_b(env, b, **case)
    taxonomy = _insights(b)
    assert taxonomy == legacy, (name, legacy, taxonomy)
    assert n_live == n_legacy
    assert len(_fires(b)) == len(taxonomy)


def test_path_B_a_repeat_scan_is_told_once_then_a_flap_back_is_told_again(env):
    """F-S7-RC-3's dedup (`_regime_shift_already_told`) is kept, and a later
    shift to the same label is a NEW event with a NEW key."""
    env["mp"].setenv(live.FLAG, "1")
    u = _uid()
    for _ in range(4):
        _drive_b(env, u, label="bear_trend", text="we were in chop all week")
    assert len(_insights(u)) == 1
    _drive_b(env, u, label="bull_trend", text="we were in chop all week")
    _drive_b(env, u, label="bear_trend", text="we were in chop all week")
    assert [r[1] for r in _insights(u)] == ["Regime shifted to bear trend",
                                            "Regime shifted to bull trend",
                                            "Regime shifted to bear trend"]
    assert len({k for _p, _t, k, _e in _fires(u)}) == 3


def test_path_B_matches_the_legacy_across_the_same_sequence(env):
    seq = [("bear_trend", "chop week"), ("bear_trend", "chop week"),
           ("bull_trend", "chop week"), ("bear_trend", "chop week"),
           ("bear_trend", "bear_trend only")]
    a, b = _uid(), _uid()
    for label, text in seq:
        _drive_b(env, a, label=label, text=text)
    env["mp"].setenv(live.FLAG, "1")
    for label, text in seq:
        _drive_b(env, b, label=label, text=text)
    assert _insights(a) == _insights(b)


def test_path_B_a_toggle_mid_sequence_never_tells_twice(env):
    u = _uid()
    _drive_b(env, u, label="bear_trend", text="chop week")
    env["mp"].setenv(live.FLAG, "1")
    _drive_b(env, u, label="bear_trend", text="chop week")
    env["mp"].delenv(live.FLAG)
    _drive_b(env, u, label="bear_trend", text="chop week")
    assert len(_insights(u)) == 1


def test_path_B_a_failed_write_is_retried_like_the_legacy(env):
    env["mp"].setenv(live.FLAG, "1")
    u = _uid()
    real = vps.add_insight
    calls = {"n": 0}

    def _flaky(uid, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("db locked")
        return real(uid, **kw)
    env["mp"].setattr(vps, "add_insight", _flaky)
    assert _drive_b(env, u, label="bear_trend", text="chop week") == 0
    assert _drive_b(env, u, label="bear_trend", text="chop week") == 1
    assert len(_insights(u)) == 1 and len(_fires(u)) == 1


def test_the_session_summary_insight_matches_the_REAL_legacy_call(env):
    """The words the flip writes are railed against the real function."""
    captured = []
    env["mp"].setattr(vps, "add_insight", lambda uid, **kw: captured.append(kw) or 1)
    _drive_b(env, _uid(), label="bear_trend", text="we were in chop all week",
             narration="N.")
    assert captured == [live.session_summary_insight("bear_trend", "chop", "N.")]


def test_path_B_flag_off_never_calls_the_live_module(env):
    env["mp"].setattr(live, "fire_session_summary",
                      lambda *a, **k: (_ for _ in ()).throw(AssertionError("ran")))
    u = _uid()
    assert _drive_b(env, u, label="bear_trend", text="chop week") == 1
    assert _fires() == []


# ─────────────────────────────────────────────────────────────────────────────
# Shared
# ─────────────────────────────────────────────────────────────────────────────

def test_the_compare_module_reads_ZERO_disagreement_on_both_paths(env, tmp_path):
    dbp = str(tmp_path / "cmp.db")
    at_db.init_db(db_path=dbp)
    for c in A_CASES.values():
        t = cmp_.observe(f"a:{c}", proj._params(rc.LEDGER), "2026-10-12",
                         current_label=c["label"], confidence=c.get("confidence", 0.7),
                         ledger_label=c["prev"], has_positions=c.get("positions", False),
                         has_watch=c.get("watch", False), db_path=dbp)
        assert t[cmp_.NEW_ONLY] == 0 and t[cmp_.LEGACY_ONLY] == 0
    for c in B_CASES.values():
        t = cmp_.observe(f"b:{c}", proj._params(rc.SESSION_SUMMARY), "2026-10-12",
                         current_label=c["label"] or None, last_summary_text=c["text"],
                         db_path=dbp)
        assert t[cmp_.NEW_ONLY] == 0 and t[cmp_.LEGACY_ONLY] == 0


def test_delivery_is_in_app_only_never_the_multichannel_path(env):
    """CHANNELS_FIXED: the flip never reaches deliver_alert_payload."""
    env["mp"].setenv(live.FLAG, "1")
    _scan(env, _uid(), label="bear_trend", prev="bull_trend", positions=True)
    _drive_b(env, _uid(), label="bear_trend", text="chop week")
    assert env["away"] == []
    src = (_REPO / "api/services/alert_taxonomy/regime_change_live.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):              # code only: prose may name the hazard
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    code = ast.unparse(tree)
    assert "deliver_alert_payload" in src    # control: the prose does name it
    assert "deliver_insight" in code and "deliver_alert_payload" not in code
    assert "_delivery.deliver(" not in code


def test_the_market_phase_broadcast_is_NOT_affected(env):
    """F-S7-RC-4: alerts.alert_regime_change is excluded by name."""
    code = ast.unparse(ast.parse((_REPO / "api/services/alerts.py").read_text(encoding="utf-8")))
    assert "regime_change_live" not in code


def test_the_flags_are_INDEPENDENT(env):
    for f in OTHER_FLAGS:
        env["mp"].setenv(f, "1")
    assert live.is_enabled() is False
    u = _uid()
    _scan(env, u, label="bear_trend", prev="bull_trend", positions=True)
    assert len(_insights(u)) == 1 and _fires() == []


def test_the_flag_is_read_per_call_and_defaults_off(env):
    assert live.is_enabled() is False
    env["mp"].setenv(live.FLAG, "1")
    assert live.is_enabled() is True
    env["mp"].setenv(live.FLAG, "0")
    assert live.is_enabled() is False


def test_the_named_call_sites_exist(env):
    e = ast.unparse(ast.parse((_REPO / "api/services/awareness/engine.py").read_text(encoding="utf-8")))
    assert "regime_live.fire_ledger(" in e and "regime_live.ledger_cycle_key(scan_ctx)" in e
    v = ast.unparse(ast.parse((_REPO / "api/services/voice_proactive_service.py").read_text(encoding="utf-8")))
    assert "live.fire_session_summary(" in v
