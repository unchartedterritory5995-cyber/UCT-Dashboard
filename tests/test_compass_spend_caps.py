"""Rails for the per-member daily ceilings on the Compass doors that spend a
model call outside the chat turn cap: the three regenerate routes (weekly
review, EOD recap, trade review) and the pre-trade verdict (route AND chat
tool, both through `pre_trade_verdict.generate_verdict`).

Each door has its own `daily_counters` scope. Past the ceiling the door
refuses (429 on a route) and makes no model call; under it the door works and
is counted; a counter store that cannot be read ADMITS (fails open).

Route handlers are called directly with a fake user dict (the same approach
as test_journal_two_compass_router.py). Every model call is faked.
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile

import pytest
from fastapi import HTTPException

USER = {"id": "u_spend"}


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    try:
        os.unlink(tmp.name)
    except OSError:
        pass


def _seed_account(user_id=USER["id"]):
    from api.services.journal_two import accounts as accounts_service
    acc = accounts_service.create_account(
        user_id, {"name": "Main", "color": "blue", "startingBalance": 100_000},
    )
    return acc["id"]


def _disable_compass(account_id):
    from api.services.auth_db import get_connection
    conn = get_connection()
    conn.execute("UPDATE j2_accounts SET compass_enabled = 0 WHERE id = ?", (account_id,))
    conn.commit()
    conn.close()


def _counted(scope, user_id=USER["id"]):
    from api.services import daily_counters
    from api.services.journal_two.calendar import et_today
    return daily_counters.value(et_today(), scope, user_id)


def _unreadable_counter(monkeypatch):
    from api.services import daily_counters

    def boom():
        raise sqlite3.OperationalError("unable to open database file")
    monkeypatch.setattr(daily_counters, "_connect", boom)


# ── fakes for the three regenerate doors ────────────────────────────────────


@pytest.fixture
def fake_coach(monkeypatch):
    from api.services.journal_two import coach as coach_service
    calls = {"generate_weekly": 0, "generate_eod": 0, "forget": 0}

    def generate_weekly_review(**kw):
        calls["generate_weekly"] += 1
        return {"id": "wr_new", "week_start": kw.get("week_start")}

    def generate_eod_recap(**kw):
        calls["generate_eod"] += 1
        return {"id": "eod_new", "day": kw.get("day")}

    def forget_review(**_kw):
        calls["forget"] += 1

    monkeypatch.setattr(coach_service, "get_weekly_review",
                        lambda **_kw: {"id": "wr1", "metadata": {"week_start": "2026-09-21"}})
    monkeypatch.setattr(coach_service, "get_eod_recap",
                        lambda *_a, **_kw: {"id": "eod1", "metadata": {"day": "2026-09-25"}})
    monkeypatch.setattr(coach_service, "generate_weekly_review", generate_weekly_review)
    monkeypatch.setattr(coach_service, "generate_eod_recap", generate_eod_recap)
    monkeypatch.setattr(coach_service, "forget_review", forget_review)
    return calls


@pytest.fixture
def fake_trade_review(monkeypatch):
    from api.services.journal_two import trade_review as tr
    calls = {"generate": 0}

    def generate_review(**kw):
        calls["generate"] += 1
        return {"id": "tr_new", "trade_id": kw.get("trade_id")}

    monkeypatch.setattr(tr, "get_review", lambda *_a, **_kw: {"id": "tr1", "trade_id": "t1"})
    monkeypatch.setattr(tr, "generate_review", generate_review)
    return calls


def _regen_weekly(acc):
    from api.routers import journal_two as r
    return r.regenerate_coach_weekly_review(acc, "wr1", user=USER)


def _regen_eod(acc):
    from api.routers import journal_two as r
    return r.regenerate_coach_eod_recap(acc, "eod1", user=USER)


def _regen_trade(acc):
    from api.routers import journal_two as r
    return r.regenerate_trade_review(acc, "tr1", user=USER)


# ── weekly review regenerate ────────────────────────────────────────────────


def test_weekly_regenerate_works_under_the_cap_and_is_counted(db_path, fake_coach, monkeypatch):
    from api.services.journal_two import compass_daily_caps as caps
    monkeypatch.setenv(caps.WEEKLY_REVIEW_REGENERATE.env, "2")
    acc = _seed_account()
    assert _regen_weekly(acc)["id"] == "wr_new"
    assert fake_coach["generate_weekly"] == 1
    assert _counted(caps.WEEKLY_REVIEW_REGENERATE.scope) == 1


def test_weekly_regenerate_past_the_cap_is_refused_with_429_and_nothing_is_forgotten(
        db_path, fake_coach, monkeypatch):
    from api.services.journal_two import compass_daily_caps as caps
    monkeypatch.setenv(caps.WEEKLY_REVIEW_REGENERATE.env, "2")
    acc = _seed_account()
    _regen_weekly(acc)
    _regen_weekly(acc)
    with pytest.raises(HTTPException) as exc:
        _regen_weekly(acc)
    assert exc.value.status_code == 429
    assert exc.value.detail == caps.WEEKLY_REVIEW_REGENERATE.sentence
    assert fake_coach["generate_weekly"] == 2       # no third model call
    assert fake_coach["forget"] == 2                # the existing review was NOT dropped
    assert _counted(caps.WEEKLY_REVIEW_REGENERATE.scope) == 2


def test_weekly_regenerate_honours_require_compass_enabled(db_path, fake_coach):
    acc = _seed_account()
    _disable_compass(acc)
    with pytest.raises(HTTPException) as exc:
        _regen_weekly(acc)
    assert exc.value.status_code == 403
    assert fake_coach["generate_weekly"] == 0
    assert fake_coach["forget"] == 0


def test_weekly_regenerate_admits_when_the_counter_cannot_be_read(db_path, fake_coach, monkeypatch):
    from api.services.journal_two import compass_daily_caps as caps
    monkeypatch.setenv(caps.WEEKLY_REVIEW_REGENERATE.env, "0")   # a CLOSED door ...
    acc = _seed_account()
    _unreadable_counter(monkeypatch)                              # ... that cannot be read
    assert _regen_weekly(acc)["id"] == "wr_new"                   # fails OPEN
    assert fake_coach["generate_weekly"] == 1


# ── EOD recap regenerate ────────────────────────────────────────────────────


def test_eod_regenerate_is_counted_and_refused_past_the_cap(db_path, fake_coach, monkeypatch):
    from api.services.journal_two import compass_daily_caps as caps
    monkeypatch.setenv(caps.EOD_RECAP_REGENERATE.env, "1")
    acc = _seed_account()
    assert _regen_eod(acc)["id"] == "eod_new"
    assert _counted(caps.EOD_RECAP_REGENERATE.scope) == 1
    with pytest.raises(HTTPException) as exc:
        _regen_eod(acc)
    assert exc.value.status_code == 429
    assert exc.value.detail == caps.EOD_RECAP_REGENERATE.sentence
    assert fake_coach["generate_eod"] == 1
    assert fake_coach["forget"] == 1


def test_eod_regenerate_admits_when_the_counter_cannot_be_read(db_path, fake_coach, monkeypatch):
    from api.services.journal_two import compass_daily_caps as caps
    monkeypatch.setenv(caps.EOD_RECAP_REGENERATE.env, "0")
    acc = _seed_account()
    _unreadable_counter(monkeypatch)
    assert _regen_eod(acc)["id"] == "eod_new"


# ── trade review regenerate ─────────────────────────────────────────────────


def test_trade_review_regenerate_is_counted_and_refused_past_the_cap(
        db_path, fake_trade_review, monkeypatch):
    from api.services.journal_two import compass_daily_caps as caps
    monkeypatch.setenv(caps.TRADE_REVIEW_REGENERATE.env, "1")
    acc = _seed_account()
    assert _regen_trade(acc)["id"] == "tr_new"
    assert _counted(caps.TRADE_REVIEW_REGENERATE.scope) == 1
    with pytest.raises(HTTPException) as exc:
        _regen_trade(acc)
    assert exc.value.status_code == 429
    assert exc.value.detail == caps.TRADE_REVIEW_REGENERATE.sentence
    assert fake_trade_review["generate"] == 1


def test_trade_review_regenerate_admits_when_the_counter_cannot_be_read(
        db_path, fake_trade_review, monkeypatch):
    from api.services.journal_two import compass_daily_caps as caps
    monkeypatch.setenv(caps.TRADE_REVIEW_REGENERATE.env, "0")
    acc = _seed_account()
    _unreadable_counter(monkeypatch)
    assert _regen_trade(acc)["id"] == "tr_new"


def test_each_door_has_its_own_counter(db_path, fake_coach, fake_trade_review, monkeypatch):
    from api.services.journal_two import compass_daily_caps as caps
    monkeypatch.setenv(caps.WEEKLY_REVIEW_REGENERATE.env, "1")
    monkeypatch.setenv(caps.EOD_RECAP_REGENERATE.env, "1")
    monkeypatch.setenv(caps.TRADE_REVIEW_REGENERATE.env, "1")
    acc = _seed_account()
    _regen_weekly(acc)
    _regen_eod(acc)       # a used-up weekly door does not close the EOD door
    _regen_trade(acc)
    assert fake_coach["generate_weekly"] == 1
    assert fake_coach["generate_eod"] == 1
    assert fake_trade_review["generate"] == 1
    scopes = {caps.WEEKLY_REVIEW_REGENERATE.scope, caps.EOD_RECAP_REGENERATE.scope,
              caps.TRADE_REVIEW_REGENERATE.scope, caps.PRE_TRADE_VERDICT.scope}
    assert len(scopes) == 4


def test_a_cap_is_read_per_call_and_bad_values_fall_back_to_the_default(monkeypatch):
    from api.services.journal_two import compass_daily_caps as caps
    door = caps.PRE_TRADE_VERDICT
    monkeypatch.setenv(door.env, "7")
    assert caps.cap(door) == 7
    monkeypatch.setenv(door.env, "11")
    assert caps.cap(door) == 11
    for bad in ("", "abc", "-3"):
        monkeypatch.setenv(door.env, bad)
        assert caps.cap(door) == door.default
    monkeypatch.delenv(door.env, raising=False)
    assert caps.cap(door) == door.default


# ── pre-trade verdict (route AND chat tool, via generate_verdict) ────────────


class FakeVerdictClient:
    def __init__(self):
        self.calls = 0

    def write_verdict(self, **_kw):
        self.calls += 1
        return {"body": json.dumps({"label": "GO", "paragraph": "Fine.", "factors": []})}


_OK_PARAMS = {"symbol": "NVDA", "side": "Long", "shares": 100,
              "entry_price": 200.0, "stop_price": 199.0, "setup": "Bull Flag"}


@pytest.fixture
def verdict_acc(db_path):
    from api.services.auth_db import get_connection
    acc = _seed_account()
    conn = get_connection()
    conn.execute("UPDATE j2_accounts SET account_size = 100000, max_risk_per_trade_pct = 1.0, "
                 "daily_loss_limit_pct = 3.0 WHERE id = ?", (acc,))
    conn.commit()
    conn.close()
    return acc


def _n_verdicts():
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        return conn.execute("SELECT COUNT(*) FROM j2_verdicts").fetchone()[0]
    finally:
        conn.close()


def test_verdict_llm_path_is_counted_and_refused_past_the_cap(verdict_acc, monkeypatch):
    from api.services.journal_two import compass_daily_caps as caps
    from api.services.journal_two import pre_trade_verdict as ptv
    monkeypatch.setenv(caps.PRE_TRADE_VERDICT.env, "2")
    fake = FakeVerdictClient()
    for _ in range(2):
        assert ptv.generate_verdict(user_id=USER["id"], account_id=verdict_acc,
                                    params=dict(_OK_PARAMS), client=fake)["label"] == "GO"
    assert _counted(caps.PRE_TRADE_VERDICT.scope) == 2
    with pytest.raises(ptv.VerdictLimitReached) as exc:
        ptv.generate_verdict(user_id=USER["id"], account_id=verdict_acc,
                             params=dict(_OK_PARAMS), client=fake)
    assert str(exc.value) == caps.PRE_TRADE_VERDICT.sentence
    assert fake.calls == 2                # no third model call
    assert _n_verdicts() == 2             # and no verdict recorded for the refusal


def test_verdict_hard_check_path_is_never_charged(verdict_acc, monkeypatch):
    """A hard-check refusal makes no model call, so it costs no allowance --
    even with the door closed."""
    from api.services.journal_two import compass_daily_caps as caps
    from api.services.journal_two import pre_trade_verdict as ptv
    monkeypatch.setenv(caps.PRE_TRADE_VERDICT.env, "0")
    fake = FakeVerdictClient()
    out = ptv.generate_verdict(user_id=USER["id"], account_id=verdict_acc,
                               params=dict(_OK_PARAMS, stop_price=180.0), client=fake)
    assert out["source"] == "hard_check"
    assert fake.calls == 0
    assert _counted(caps.PRE_TRADE_VERDICT.scope) == 0


def test_verdict_admits_when_the_counter_cannot_be_read(verdict_acc, monkeypatch):
    from api.services.journal_two import compass_daily_caps as caps
    from api.services.journal_two import pre_trade_verdict as ptv
    monkeypatch.setenv(caps.PRE_TRADE_VERDICT.env, "0")
    _unreadable_counter(monkeypatch)
    fake = FakeVerdictClient()
    out = ptv.generate_verdict(user_id=USER["id"], account_id=verdict_acc,
                               params=dict(_OK_PARAMS), client=fake)
    assert out["label"] == "GO" and fake.calls == 1


def test_verdict_route_refuses_past_the_cap_with_429(verdict_acc, monkeypatch):
    from api.routers import journal_two as r
    from api.services.journal_two import compass_daily_caps as caps
    from api.services.journal_two import pre_trade_verdict as ptv
    monkeypatch.setenv(caps.PRE_TRADE_VERDICT.env, "0")
    constructed = []
    monkeypatch.setattr(ptv, "AnthropicVerdictClient",
                        lambda *a, **k: constructed.append(1) or FakeVerdictClient())
    with pytest.raises(HTTPException) as exc:
        r.pre_trade_verdict(verdict_acc, dict(_OK_PARAMS), user=USER)
    assert exc.value.status_code == 429
    assert exc.value.detail == caps.PRE_TRADE_VERDICT.sentence
    assert constructed == []              # the model client was never even built


def test_verdict_chat_tool_is_covered_by_the_same_cap(verdict_acc, monkeypatch):
    from api.services.journal_two import coach_chat_tools as cct
    from api.services.journal_two import compass_daily_caps as caps
    from api.services.journal_two import pre_trade_verdict as ptv
    monkeypatch.setenv(caps.PRE_TRADE_VERDICT.env, "1")
    fake = FakeVerdictClient()
    monkeypatch.setattr(ptv, "AnthropicVerdictClient", lambda *a, **k: fake)
    executor = cct.TOOLS.get("pre_trade_verdict")["executor"]
    assert executor(user_id=USER["id"], account_id=verdict_acc,
                    args=dict(_OK_PARAMS))["label"] == "GO"
    with pytest.raises(ptv.VerdictLimitReached):
        executor(user_id=USER["id"], account_id=verdict_acc, args=dict(_OK_PARAMS))
    assert fake.calls == 1
