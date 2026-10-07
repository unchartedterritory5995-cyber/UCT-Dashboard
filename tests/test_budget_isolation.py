"""BUDGET ISOLATION (owner decision 2026-10-07) -- the $15/day AI ceiling split by
KIND of lane: a $4 interactive reservation (/propose, /converse, indicator-vision)
and an $11 background maximum (catalyst synthesis, curator, hunter, rule learner,
call recaps, sector reads), plus a PERSISTENT per-member $0.75 allowance read from
the cost ledger and one interactive AI call in flight per member.

⚠️ THE REAL `cost_guard` AND THE REAL LEDGER RUN. Only the SQLite path moves to a
tmp file; every cap assertion below is a statement about the shipped gate.
"""
from __future__ import annotations

import importlib
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

import pytest

from tests.test_p2_truth_server import (  # noqa: F401 -- fixtures by name
    RSI_GT_70, _B, conv, emits, env, model, out, view,
)

ROOT = Path(__file__).resolve().parents[1]
D1, D2 = "2026-10-07", "2026-10-08"


@pytest.fixture
def ledger(monkeypatch, tmp_path):
    monkeypatch.setenv("CATALYST_DB_PATH", str(tmp_path / "catalysts.db"))
    for k in ("CATALYST_COST_HARD_CAP", "INTERACTIVE_AI_RESERVE_USD",
              "CONCIERGE_USER_CAP_DAILY", "CONVERSE_USER_CAP_DAILY"):
        monkeypatch.delenv(k, raising=False)
    from api.services.catalyst import store as _store
    importlib.reload(_store)
    _store._init_db()
    from api.services.catalyst import cost_guard
    from api.services import definition_concierge as dc
    cost_guard._HARD_CAP_TRIPPED = False
    cost_guard._SOFT_CAP_LOGGED_FOR_DATE = None
    cost_guard._BACKGROUND_LIMIT_LOGGED_FOR_DATE = None
    dc.reset_spend()
    dc._INFLIGHT.clear()
    yield _store
    dc.reset_spend()
    dc._INFLIGHT.clear()
    monkeypatch.delenv("CATALYST_DB_PATH", raising=False)
    importlib.reload(_store)


def put(store, md, ticker, usd):
    store.log_cost(market_date=md, ticker=ticker, model="claude-opus-5",
                   input_tokens=0, output_tokens=0, cost_usd=usd, was_cached=False)


def cg():
    from api.services.catalyst import cost_guard
    return cost_guard


def dc():
    from api.services import definition_concierge
    return definition_concierge


GOOD = [{"op": "set_slot", "slot": "value#1", "value": 80}]


def rsi_view():
    return view(1, [out("value", RSI_GT_70)])


# ═══ A. BACKGROUND PROTECTION ═════════════════════════════════════════════

def test_A1_background_below_its_limit_is_allowed(ledger):
    put(ledger, D1, "AAPL", 10.99)
    assert cg().may_synthesize(D1) is True


def test_A2_background_at_its_limit_is_refused_and_the_reservation_is_untouched(ledger):
    put(ledger, D1, "AAPL", 11.00)
    assert cg().may_synthesize(D1) is False
    assert cg().may_member_spend(D1) is True
    s = cg().budget_state(D1)
    assert s["interactive_remaining"] == 4.0 and s["background_remaining"] == 0.0


def test_A3_every_background_label_counts_toward_the_same_11(ledger):
    for t, usd in (("_CURATOR", 4.0), ("__hunter__", 3.0), ("_RULE_LEARNER", 1.0),
                   ("sector:Technology", 1.0), ("NVDA", 2.0)):
        put(ledger, D1, t, usd)
    assert cg().may_synthesize(D1) is False


def test_A4_scheduled_work_cannot_take_14_and_leave_members_1(ledger):
    """A background day spending in $0.40 calls stops within ONE call of $11 --
    never the old shape where background could run to $15."""
    calls = 0
    while cg().may_synthesize(D1) and calls < 100:
        calls += 1
        put(ledger, D1, f"T{calls}", 0.40)
    s = cg().budget_state(D1)
    assert calls < 100
    assert 11.0 <= s["background_spend"] < 11.0 + 0.40 + 1e-9
    assert s["interactive_remaining"] == 4.0
    assert cg().may_member_spend(D1) is True


def test_A5_interactive_spend_never_reduces_the_background_budget(ledger):
    put(ledger, D1, "concierge:u1", 3.99)
    put(ledger, D1, "indicator-vision:u2", 0.01)
    assert cg().may_synthesize(D1) is True
    assert cg().budget_state(D1)["background_remaining"] == 11.0


# ═══ B. INTERACTIVE ═══════════════════════════════════════════════════════

def test_B1_interactive_below_the_reservation_is_allowed_whatever_background_spent(ledger):
    put(ledger, D1, "AAPL", 11.0)                    # a full background day first
    put(ledger, D1, "concierge:u1", 3.99)
    assert cg().may_member_spend(D1) is True


def test_B2_interactive_at_the_reservation_is_refused_across_both_interactive_lanes(ledger):
    put(ledger, D1, "concierge:u1", 3.0)
    put(ledger, D1, "indicator-vision:u2", 1.0)
    assert cg().may_member_spend(D1) is False
    assert cg().may_synthesize(D1) is True           # background unaffected


def test_B3_admin_calls_count_against_the_same_reservation(ledger, conv, model):
    model([emits(env(1, GOOD))])
    put(ledger, D1, "concierge:admin1", 3.999)       # an admin's testing
    put(ledger, D1, "concierge:admin1", 0.001)
    monkey_day(conv, D1)
    r = conv.converse("make it 80", user_id="m1", view=rsi_view())
    assert r["gate"] == "cost:global"                # a member is refused by admin spend


def test_B4_fifteen_is_an_absolute_ceiling_for_both_gates(ledger):
    """Each side may overshoot its own limit by the one call it admitted; the
    total check still closes both gates at $15."""
    put(ledger, D1, "AAPL", 11.6)                    # background overshot by one call
    put(ledger, D1, "concierge:u1", 3.5)             # interactive still under $4
    assert cg().budget_state(D1)["total_spend"] >= 15.0
    assert cg().may_member_spend(D1) is False
    assert cg().may_synthesize(D1) is False


def test_B5_the_limits_are_the_owner_numbers_and_sum_to_the_ceiling(ledger):
    assert cg().hard_cap_usd() == 15.0
    assert cg().interactive_limit_usd() == 4.0
    assert cg().background_limit_usd() == 11.0


def test_B6_a_reservation_above_the_ceiling_cannot_raise_total_spend(ledger, monkeypatch):
    monkeypatch.setenv("INTERACTIVE_AI_RESERVE_USD", "40")
    assert cg().interactive_limit_usd() == 15.0 and cg().background_limit_usd() == 0.0


def monkey_day(conv_mod, day):
    """Pin the conversation's ET market date (it reads `dc._market_date`)."""
    import api.services.definition_concierge as _dc
    _dc._market_date = lambda: day                   # restored by `_restore_market_date`


@pytest.fixture(autouse=True)
def _restore_market_date():
    import api.services.definition_concierge as _dc
    original = _dc._market_date
    yield
    _dc._market_date = original


def test_B7_member_below_the_allowance_is_allowed(ledger, conv, model):
    model([emits(env(1, GOOD))])
    monkey_day(conv, D1)
    put(ledger, D1, "concierge:m1", 0.70)
    assert conv.converse("make it 80", user_id="m1", view=rsi_view())["ok"] is True


def test_B8_member_at_the_allowance_is_refused_before_any_model_call(ledger, conv, model):
    client = model([])                               # an unarmed call would fail loudly
    monkey_day(conv, D1)
    put(ledger, D1, "concierge:m1", 0.75)
    r = conv.converse("make it 80", user_id="m1", view=rsi_view())
    assert r["gate"] == "cost:user" and client.calls == []


# ═══ C. PERSISTENCE ═══════════════════════════════════════════════════════

def test_C1_a_restart_does_not_hand_a_member_a_fresh_allowance(ledger, conv, model):
    """The member spends through the REAL door; the process state is then wiped,
    as a deploy wipes it; the ledger still answers."""
    model([emits(env(1, GOOD))])
    monkey_day(conv, D1)
    r = conv.converse("make it 80", user_id="m1", view=rsi_view())
    spent = r["cost_usd"]
    assert spent > 0
    put(ledger, D1, "concierge:m1", 0.75)            # and the rest of their day
    dc()._USER_SPEND.clear()                         # ⛔ the redeploy
    dc()._INFLIGHT.clear()
    assert dc().spend_for("m1", D1) == pytest.approx(spent + 0.75)
    client = model([])
    r2 = conv.converse("make it 90", user_id="m1", view=rsi_view())
    assert r2["gate"] == "cost:user" and client.calls == []


def test_C3_propose_and_converse_share_one_allowance(ledger):
    put(ledger, D1, "concierge:m1", 0.50)            # /propose rows
    put(ledger, D1, "concierge:m1", 0.30)            # /converse rows -- same ticker
    assert dc().spend_for("m1", D1) == pytest.approx(0.80)
    assert dc().spend_for("m1", D1) >= dc()._user_cap_usd()


def test_C4_the_process_floor_never_lets_a_failed_read_under_count(ledger, monkeypatch):
    dc()._record_spend("m1", D1, 0.60)
    monkeypatch.setattr(ledger, "spend_for_ticker",
                        lambda *_a: (_ for _ in ()).throw(RuntimeError("disk")))
    assert dc().spend_for("m1", D1) == pytest.approx(0.60)


def test_C5_vision_keeps_its_own_policy_and_is_not_charged_to_the_member_allowance(ledger):
    """Indicator-vision had no per-member allowance before this change; it still
    has none (it counts against the $4 interactive reservation only)."""
    put(ledger, D1, "indicator-vision:m1", 0.90)
    assert dc().spend_for("m1", D1) == 0.0
    assert cg().budget_state(D1)["interactive_spend"] == pytest.approx(0.90)


# ═══ D. DATE ══════════════════════════════════════════════════════════════

def test_D1_the_next_ET_day_starts_fresh_for_the_member_and_the_pool(ledger):
    put(ledger, D1, "concierge:m1", 0.80)
    put(ledger, D1, "concierge:m2", 3.50)
    put(ledger, D1, "AAPL", 11.0)
    assert dc().spend_for("m1", D2) == 0.0
    assert cg().may_member_spend(D2) is True and cg().may_synthesize(D2) is True


@pytest.mark.parametrize("utc,expected", [
    (datetime(2026, 10, 8, 3, 59, tzinfo=timezone.utc), "2026-10-07"),   # 23:59 ET
    (datetime(2026, 10, 8, 4, 1, tzinfo=timezone.utc), "2026-10-08"),    # 00:01 ET
])
def test_D2_the_eastern_time_calendar_date_is_authoritative(monkeypatch, utc, expected):
    import api.services.definition_concierge as _dc

    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return utc.astimezone(tz) if tz else utc

    monkeypatch.setattr(_dc, "datetime", Frozen)
    assert _dc._market_date() == expected


def test_D3_there_is_no_rolling_window(ledger):
    """Spend one minute before ET midnight does not follow the member past it."""
    put(ledger, "2026-10-07", "concierge:m1", 0.75)
    assert dc().spend_for("m1", "2026-10-07") >= dc()._user_cap_usd()
    assert dc().spend_for("m1", "2026-10-08") == 0.0


# ═══ E. COST ══════════════════════════════════════════════════════════════

def test_E1_a_failed_call_without_usage_charges_nothing(ledger, conv, monkeypatch):
    monkey_day(conv, D1)
    monkeypatch.setattr(conv, "_call_model", lambda _m: (_ for _ in ()).throw(RuntimeError("down")))
    r = conv.converse("make it 80", user_id="m1", view=rsi_view())
    assert r["gate"] == "model:transport"
    assert dc().spend_for("m1", D1) == 0.0 and cg().budget_state(D1)["total_spend"] == 0.0


def test_E2_usage_then_validation_failure_is_charged_including_the_repair(ledger, conv, model):
    monkey_day(conv, D1)
    bad = env(1, [{"op": "set_slot", "slot": "value#1"}])
    model([emits(bad), emits(bad)])
    r = conv.converse("make it 80", user_id="m1", view=rsi_view())
    assert r["ok"] is False and r["attempts"] == 2
    one = cg().estimate_cost(dc().MODEL, 300, 120)
    assert dc().spend_for("m1", D1) == pytest.approx(2 * one)
    assert cg().budget_state(D1)["lanes"]["concierge"] == pytest.approx(2 * one)


def test_E3_cache_tokens_are_charged_at_their_ledger_price(ledger, conv, model):
    monkey_day(conv, D1)
    answer = emits(env(1, GOOD))
    answer.usage = _B(input_tokens=300, output_tokens=120,
                      cache_read_input_tokens=10_000, cache_creation_input_tokens=2_000)
    model([answer])
    conv.converse("make it 80", user_id="m1", view=rsi_view())
    expected = cg().estimate_cost(dc().MODEL, 300, 120, 10_000, 2_000)
    assert dc().spend_for("m1", D1) == pytest.approx(expected)
    assert expected > cg().estimate_cost(dc().MODEL, 300, 120)


def test_E4_a_busy_refusal_makes_no_model_call_and_charges_nothing(ledger, conv, model):
    client = model([])
    monkey_day(conv, D1)
    with dc().interactive_slot("m1") as free:
        assert free
        r = conv.converse("make it 80", user_id="m1", view=rsi_view())
    assert r["gate"] == "rate:busy" and client.calls == []
    assert cg().budget_state(D1)["total_spend"] == 0.0


# ═══ F. CONCURRENCY ═══════════════════════════════════════════════════════

class _BlockingClient:
    """The first model call waits on `release`; any other call answers at once."""

    def __init__(self, answer):
        self.answer, self.entered, self.release = answer, threading.Event(), threading.Event()
        self.calls = 0
        self.messages = self

    def with_options(self, **_):
        return self

    def create(self, **_kw):
        self.calls += 1
        self.entered.set()
        assert self.release.wait(10)
        return self.answer


def test_F1_a_concurrent_turn_from_the_same_member_is_refused_not_billed(ledger, conv, monkeypatch):
    monkey_day(conv, D1)
    client = _BlockingClient(emits(env(1, GOOD)))
    monkeypatch.setattr("api.services.engine._get_anthropic_client", lambda: client)
    first = {}
    t = threading.Thread(target=lambda: first.update(
        conv.converse("make it 80", user_id="m1", view=rsi_view())))
    t.start()
    assert client.entered.wait(10)                   # turn 1 is mid-call
    second = conv.converse("make it 90", user_id="m1", view=rsi_view())
    third = dc().propose("RSI 14 above 70", user_id="m1")
    with dc().interactive_slot("m2") as other:       # another member is NOT blocked
        pass
    client.release.set()
    t.join(10)
    assert second["gate"] == "rate:busy" and third["gate"] == "rate:busy"
    assert other is True
    assert first["ok"] is True and client.calls == 1
    assert dc().spend_for("m1", D1) == pytest.approx(first["cost_usd"])
    with dc().interactive_slot("m1") as free:        # and the slot is free again
        assert free


def test_F2_the_slot_is_released_when_the_turn_raises(ledger):
    with pytest.raises(RuntimeError):
        with dc().interactive_slot("m1") as free:
            assert free
            raise RuntimeError("boom")
    with dc().interactive_slot("m1") as free:
        assert free


def test_F3_a_busy_turn_is_classed_rate_limited_and_worded_for_members(conv):
    assert conv.failure_class({"ok": False, "gate": "rate:busy"}) == "rate_limited"
    words = (ROOT / "app/src/components/chart/builder/authoring/memberWords.js").read_text("utf-8")
    assert "'rate:busy':" in words


# ═══ G. LANE CLASSIFICATION ═══════════════════════════════════════════════

@pytest.mark.parametrize("ticker,kind", [
    ("concierge:u1", "interactive"), ("indicator-vision:u1", "interactive"),
    ("AAPL", "background"), ("_CURATOR", "background"), ("__hunter__", "background"),
    ("_RULE_LEARNER", "background"), ("sector:Technology", "background"),
    # ⛔ unknown / near-miss lanes FAIL SAFE: background, capped at $11
    ("new-member-door:u1", "background"), ("concierge", "background"),
    ("Concierge:u1", "background"), ("", "background"), (None, "background"),
])
def test_G1_lane_kind(ticker, kind):
    assert cg().lane_kind(ticker) == kind


_RECORD_RE = re.compile(r"\brecord\(\s*(?:market_date\s*=\s*)?[\w.]+\s*,\s*(?:ticker\s*=\s*)?([^,\n]+),")


def _ledger_tickers(rel):
    return [m.strip() for m in _RECORD_RE.findall((ROOT / rel).read_text("utf-8"))]


def test_G2_every_ledger_writer_is_classified_as_audited():
    """⛔ THE AUDIT AS A RAIL: every module that writes this ledger, and the lane
    its rows land in. A new writer must be added here, deliberately."""
    interactive = {
        "api/services/definition_concierge.py": 'f"concierge:{user_id}"',
        "api/services/definition_conversation.py": 'f"concierge:{user_id}"',
        "api/services/indicator_from_image.py": 'f"indicator-vision:{user_id}"',
    }
    background = ("api/services/catalyst/synthesize.py", "api/services/catalyst/hunter.py",
                  "api/services/catalyst/curator.py", "api/services/catalyst/rule_learner.py",
                  "api/services/call_recap.py", "api/services/calendar_sector_read.py")
    for rel, ticker in interactive.items():
        assert ticker in _ledger_tickers(rel), rel
    for rel in background:
        tickers = _ledger_tickers(rel)
        assert tickers, f"{rel}: no ledger write found -- the audit is stale"
        assert not any("concierge:" in t or "indicator-vision:" in t for t in tickers), rel
    writers = {str(p.relative_to(ROOT)).replace("\\", "/")
               for p in (ROOT / "api").rglob("*.py")
               if re.search(r"(?<![\w])(cost_guard|guard)\.record\(",
                            p.read_text("utf-8", errors="ignore"))}
    assert writers <= set(interactive) | set(background), sorted(writers - set(interactive) - set(background))


# ═══ H. REPORT ════════════════════════════════════════════════════════════

@pytest.fixture
def auth_store(tmp_path, monkeypatch):
    from api.services import auth_db
    path = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(path))
    monkeypatch.setattr(auth_db, "_DB_PATH", str(path))
    auth_db.init_db()


def test_H1_the_report_reconciles_and_names_no_one(ledger, auth_store):
    from api.services import indicator_telemetry as tel
    day = dc()._market_date()
    rows = (("concierge:secretuser-123", 1.0), ("indicator-vision:other-456", 0.5),
            ("AAPL", 6.0), ("_CURATOR", 0.4), ("__hunter__", 0.3), ("sector:Technology", 0.2))
    for t, usd in rows:
        put(ledger, day, t, usd)
    p = tel.rollout_report(1)["shared_pool_today"]
    assert p["total_limit"] == 15.0 and p["interactive_limit"] == 4.0 and p["background_limit"] == 11.0
    assert p["total_spend"] == pytest.approx(8.4)
    assert p["interactive_spend"] == pytest.approx(1.5) and p["background_spend"] == pytest.approx(6.9)
    assert p["interactive_spend"] + p["background_spend"] == pytest.approx(p["total_spend"])
    assert sum(p["lanes"].values()) == pytest.approx(p["total_spend"])
    assert p["lanes"] == pytest.approx({"concierge": 1.0, "vision": 0.5, "synthesis": 6.0,
                                        "scheduled_support": 0.7, "other_background": 0.2})
    assert p["interactive_remaining"] == pytest.approx(2.5)
    assert p["background_remaining"] == pytest.approx(4.1)
    assert p["total_remaining"] == pytest.approx(6.6)
    dump = json.dumps(p)
    for leak in ("secretuser", "other-456", "AAPL", "Technology", "concierge:", "vision:"):
        assert leak not in dump


def test_H2_the_report_is_still_admin_only():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import indicator_telemetry as router_mod
    app = FastAPI()
    app.include_router(router_mod.router)
    member = {"id": "m1", "role": "member", "plan": "pro"}
    app.dependency_overrides[get_current_user] = lambda: member
    app.dependency_overrides[get_current_user_with_plan] = lambda: member
    c = TestClient(app, raise_server_exceptions=False)
    assert c.get("/api/indicator-telemetry/rollout-report").status_code == 403
