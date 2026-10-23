"""Every account-size reader asks the ONE authority (Round B task 2).

Before this, an unset member's trade got three sizes: 25,000 (heat, sizing, the widget, AI
Search), the migrated 100,000 placeholder read raw (Compass pre-trade, coach, interventions,
discipline, calendar, intelligence, chart plan, the simulator), and grade_ticker's own 50,000.
Each reader here is driven twice: on the migrated placeholder (unset: UNSET_ACCOUNT_SIZE,
flagged default) and on a member who typed exactly 100,000 (set: their 100,000). Since fix 1 the
unset default IS 100,000 (owner ruling: enforcement for unset members does not move), so the two
runs agree on every number and differ only in the default flag and sentence, which is the point:
the member's own 100,000 is never labelled default, and the default is never unlabelled."""

import sqlite3
import uuid
from datetime import datetime, timezone

import pytest

UNSET = 100_000.0
_PAYLOAD = {
    "defaultStop": {"mode": "custom"},
    "positionClosing": "FIFO",
    "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
    "setups": [],
}


@pytest.fixture
def conn(tmp_path, monkeypatch):
    path = str(tmp_path / "auth.db")
    monkeypatch.setenv("AUTH_DB_PATH", path)
    import importlib
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    yield c
    c.close()


def _member(conn, uid, *, typed=None, **guards):
    """A member's Default account. `typed` = the size they typed (None = never touched it, the
    migrated placeholder). `guards` = settings like maxRiskPerTradePct."""
    from api.services.journal_two import accounts
    acc = accounts.get_or_migrate_default_account(uid, conn=conn)
    if typed is not None:
        accounts.upsert_account_settings(uid, acc["id"], {**_PAYLOAD, **guards, "accountSize": 1},
                                         conn=conn)
    accounts.upsert_account_settings(
        uid, acc["id"], {**_PAYLOAD, **guards, "accountSize": typed if typed is not None else 100_000},
        conn=conn)
    return acc["id"]


def _trade(conn, uid, aid, *, pnl, shares=10.0, entry=100.0, stop=50.0, exit_iso=None):
    now = exit_iso or datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,"
        " entry_date, exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent,"
        " r_multiple, hold_days, result, context_at_entry, created_at, account_id)"
        " VALUES (?, ?, 'p', 'NVDA', 'Long', ?, ?, ?, ?, ?, ?, 'Breakout', '', ?, 0, NULL, 0, ?,"
        " '{}', ?, ?)",
        (str(uuid.uuid4()), uid, shares, entry, now, entry + pnl / shares, now, stop, pnl,
         "Win" if pnl > 0 else "Loss", now, aid))
    conn.commit()


def _sentence():
    from api.services.voice_position_sizing import default_size_sentence
    return default_size_sentence()


# ── Compass pre-trade ────────────────────────────────────────────────────────────────────────

def test_pre_trade_hard_check_sizes_an_unset_member_at_the_default_and_says_so(conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    aid = _member(conn, "pt1", maxRiskPerTradePct=1)
    params = {"symbol": "NVDA", "side": "Long", "shares": 30, "entry_price": 100, "stop_price": 50}
    out = ptv.generate_verdict(user_id="pt1", account_id=aid, params=params, conn=conn)
    assert out["label"] == "SKIP" and out["hard_check_failed"] == "risk_cap_breach"
    assert out["risk_pct"] == pytest.approx(1500 / UNSET * 100)       # 1.5%, as production had it
    assert out["account_size_is_default"] is True
    assert out["account_size_note"] == _sentence() and _sentence() in out["factors"]


def test_pre_trade_hard_check_reads_a_member_who_typed_100000_as_theirs(conn):
    from api.services.journal_two import pre_trade_verdict as ptv
    aid = _member(conn, "pt2", typed=100_000, maxRiskPerTradePct=1)
    params = {"symbol": "NVDA", "side": "Long", "shares": 30, "entry_price": 100, "stop_price": 50}
    out = ptv.generate_verdict(user_id="pt2", account_id=aid, params=params, conn=conn)
    assert out["label"] == "SKIP" and out["risk_pct"] == pytest.approx(1.5)
    assert out["account_size_is_default"] is False and out["account_size_note"] is None
    assert _sentence() not in out["factors"]


# ── Coach ────────────────────────────────────────────────────────────────────────────────────

def test_coach_sizing_curve_uses_the_authority(conn):
    from api.services.journal_two import coach_chat_tools as cct
    unset = _member(conn, "cc1")
    out = cct._exec_analyze_sizing_curve(user_id="cc1", account_id=unset, args={}, conn=conn)
    assert out["account_size"] == UNSET and out["account_size_is_default"] is True
    assert out["account_size_note"] == _sentence()
    mine = _member(conn, "cc2", typed=100_000)
    out = cct._exec_analyze_sizing_curve(user_id="cc2", account_id=mine, args={}, conn=conn)
    assert out["account_size"] == 100_000.0 and out["account_size_is_default"] is False


def test_coach_daily_loss_lockouts_rest_on_the_authority(conn):
    from api.services.journal_two import coach_data_assembler as cda
    start = datetime(2000, 1, 1, tzinfo=timezone.utc)
    end = datetime(2100, 1, 1, tzinfo=timezone.utc)
    unset = _member(conn, "cd1", dailyLossLimitPct=3)
    _trade(conn, "cd1", unset, pnl=-4000)                         # -4% of 100,000, past 3%
    ev = cda._discipline_events(conn, "cd1", unset, start, end)
    assert ev["daily_loss_lockouts"] == 1 and ev["account_size_is_default"] is True
    mine = _member(conn, "cd2", typed=100_000, dailyLossLimitPct=3)
    _trade(conn, "cd2", mine, pnl=-4000)
    ev = cda._discipline_events(conn, "cd2", mine, start, end)
    assert ev["daily_loss_lockouts"] == 1 and ev["account_size_is_default"] is False
    small = _member(conn, "cd3", dailyLossLimitPct=3)
    _trade(conn, "cd3", small, pnl=-1000)                         # -1%: no lockout (unchanged)
    assert cda._discipline_events(conn, "cd3", small, start, end)["daily_loss_lockouts"] == 0


def test_intervention_daily_loss_threshold_rests_on_the_authority(conn):
    from api.services.journal_two import interventions as iv
    unset = _member(conn, "iv1", dailyLossLimitPct=3)
    _trade(conn, "iv1", unset, pnl=-2500)                         # past 75% of 3% of 100,000
    hit = iv._check_daily_loss_approach(conn, user_id="iv1", account_id=unset)
    assert hit is not None and _sentence() in hit["factors"]
    mine = _member(conn, "iv2", typed=100_000, dailyLossLimitPct=3)
    _trade(conn, "iv2", mine, pnl=-2500)
    hit = iv._check_daily_loss_approach(conn, user_id="iv2", account_id=mine)
    assert hit is not None and _sentence() not in hit["factors"]
    quiet = _member(conn, "iv3", dailyLossLimitPct=3)
    _trade(conn, "iv3", quiet, pnl=-600)                          # not past it (unchanged)
    assert iv._check_daily_loss_approach(conn, user_id="iv3", account_id=quiet) is None


def test_discipline_state_rests_on_the_authority(conn):
    from api.services.journal_two import discipline
    unset = _member(conn, "ds1", dailyLossLimitPct=3)
    _trade(conn, "ds1", unset, pnl=-1000)
    st = discipline.compute_discipline_state("ds1", unset, conn=conn)
    assert st["todaysPnlPct"] == -1.0 and st["locked"] is False      # as production had it
    assert st["accountSizeIsDefault"] is True and st["accountSizeNote"] == _sentence()
    _trade(conn, "ds1", unset, pnl=-3000)
    st = discipline.compute_discipline_state("ds1", unset, conn=conn)
    assert st["todaysPnlPct"] == -4.0 and st["locked"] is True
    assert st["reasons"][0]["accountSizeNote"] == _sentence()
    mine = _member(conn, "ds2", typed=100_000, dailyLossLimitPct=3)
    _trade(conn, "ds2", mine, pnl=-1000)
    st = discipline.compute_discipline_state("ds2", mine, conn=conn)
    assert st["todaysPnlPct"] == -1.0 and st["locked"] is False and st["accountSizeIsDefault"] is False
    assert st["accountSizeNote"] is None


# ── Calendar P&L % ───────────────────────────────────────────────────────────────────────────

def test_calendar_pnl_pct_rests_on_the_authority(conn):
    from api.services.journal_two import calendar as cal
    now = datetime.now(timezone.utc)
    unset = _member(conn, "ca1")
    _trade(conn, "ca1", unset, pnl=500)
    out = cal.get_calendar("ca1", view="month", year=now.year, month=now.month,
                           account_id=unset, conn=conn)
    assert out["accountSizeIsDefault"] is True
    assert out["days"][-1]["pnlPercent"] == pytest.approx(500 / UNSET)
    mine = _member(conn, "ca2", typed=100_000)
    _trade(conn, "ca2", mine, pnl=500)
    out = cal.get_calendar("ca2", view="month", year=now.year, month=now.month,
                           account_id=mine, conn=conn)
    assert out["accountSizeIsDefault"] is False
    assert out["days"][-1]["pnlPercent"] == pytest.approx(500 / 100_000)


def test_calendar_all_accounts_matches_base_arithmetic(conn):
    """Fix round 2 ruling: the All Accounts denominator is base's SUM(account_size) over every
    account, placeholder included (an unset account adds the 100,000 default, equal to the base
    placeholder). Flagged default when any term was the default."""
    from api.services.journal_two import accounts, calendar as cal
    from api.services.journal_two.broker import balances
    # two unset accounts: base SUM = 100,000 + 100,000
    _member(conn, "ca3")
    accounts.create_account("ca3", {"name": "Second", "color": "teal", "startingBalance": 1}, conn=conn)
    assert cal._account_size_basis("ca3", conn) == (200_000.0, True)
    # unused placeholder Default + a $20,000 broker account: base SUM = 100,000 + 20,000
    _member(conn, "ca4")
    b = accounts.create_account("ca4", {"name": "Broker", "color": "teal", "startingBalance": 1}, conn=conn)
    balances.write_balances("ca4", {"id": "ba", "j2AccountId": b["id"]}, [], [], conn=conn,
                            broker_total=20_000.0)
    assert cal._account_size_basis("ca4", conn) == (120_000.0, True)
    # set 40,000 + a placeholder second account: base SUM = 140,000
    _member(conn, "ca5", typed=40_000)
    accounts.create_account("ca5", {"name": "Second", "color": "teal", "startingBalance": 1}, conn=conn)
    assert cal._account_size_basis("ca5", conn) == (140_000.0, True)
    # every account set: not default
    _member(conn, "ca6", typed=40_000)
    assert cal._account_size_basis("ca6", conn) == (40_000.0, False)
    # no account and no legacy row: base fallback 100,000
    assert cal._account_size_basis("nobody", conn) == (UNSET, True)


# ── Intelligence, chart plan, simulator, grade ───────────────────────────────────────────────

def test_risk_summary_carries_the_default_flag(conn, monkeypatch):
    from api.routers import intelligence
    monkeypatch.setattr(intelligence, "_get_api", lambda: None)
    _member(conn, "in1")
    out = intelligence.get_risk_summary(user={"id": "in1"})
    assert out["account_size_is_default"] is True and out["account_size_note"] == _sentence()
    _member(conn, "in2", typed=100_000)
    assert intelligence.get_risk_summary(user={"id": "in2"})["account_size_is_default"] is False


def test_chart_plan_inputs_never_size_on_the_placeholder(conn):
    from api.services.journal_two import chart_plan
    unset = _member(conn, "cp1", maxRiskPerTradePct=1)
    assert chart_plan.account_inputs("cp1", unset)["accountSize"] is None
    mine = _member(conn, "cp2", typed=100_000, maxRiskPerTradePct=1)
    assert chart_plan.account_inputs("cp2", mine)["accountSize"] == 100_000.0


def test_scenario_simulator_runs_and_sizes_on_the_authority(conn):
    from api.services import scenario_simulator as sim
    unset = _member(conn, "sm1")
    _trade(conn, "sm1", unset, pnl=500)
    out = sim.simulate(user_id="sm1", rule="flat_pct", rule_value=1.0, account_id=unset)
    assert "error" not in out, out
    assert out["account_size"] == UNSET and out["account_size_is_default"] is True
    assert out["account_size_note"] == _sentence()
    mine = _member(conn, "sm2", typed=100_000)
    _trade(conn, "sm2", mine, pnl=500)
    out = sim.simulate(user_id="sm2", rule="flat_pct", rule_value=1.0, account_id=mine)
    assert out["account_size"] == 100_000.0 and out["account_size_is_default"] is False


def test_grade_ticker_default_is_the_one_unset_constant():
    from api.services import grade_ticker as gt
    from api.services.voice_position_sizing import UNSET_ACCOUNT_SIZE
    assert gt._DEFAULT_ACCOUNT == UNSET_ACCOUNT_SIZE
    seen = []

    def size_fn(entry, stop, account, band, grade, risk):
        seen.append(account)
        return {"ok": True, "max_position_pct": 10.0, "account_risk": 1.0, "shares": 5}

    kw = dict(regime_fn=lambda: {"regime": "GREEN"}, quote_fn=lambda s: {"last": 100.0},
              patterns_fn=lambda s: [{"pattern_name": "Breakout", "confidence": 0.9,
                                      "levels": {"entry": 100.0, "stop": 95.0}}],
              playbook_fn=lambda *a, **k: {}, size_fn=size_fn, archive_fn=lambda *a: None)
    out = gt.grade_ticker("NVDA", **kw)
    assert seen[-1] == UNSET_ACCOUNT_SIZE
    assert out["account_size_is_default"] is True and out["account_size_note"] == _sentence()
    out = gt.grade_ticker("NVDA", account_size=80_000, **kw)
    assert seen[-1] == 80_000 and out["account_size_is_default"] is False


# ── The five readers that already asked the predicate now read the marker too ─────────────────

def test_sizing_and_the_widget_read_a_member_who_typed_100000_as_theirs(conn):
    from api.services import voice_position_sizing as vps
    from api.services.journal_two import notebook_widgets as nw
    _member(conn, "vw1", typed=100_000)
    s = vps._get_account_settings("vw1", None)
    assert s["account_size"] == 100_000.0 and s["account_size_is_default"] is False
    assert nw._account_size("vw1") == 100_000.0
    _member(conn, "vw2")
    assert vps._get_account_settings("vw2", None)["account_size_is_default"] is True
    assert nw._account_size("vw2") is None


def test_the_one_unset_default_is_100000_and_is_still_labelled():
    """Fix 1 ruling: an unset member's enforcement stays where production had it (100,000, the
    size the Settings modal shows), so the ONE unset default is 100,000. It is still a default,
    flagged and said with the shared sentence, never presented as the member's own."""
    from api.services import voice_position_sizing as vps
    assert vps.UNSET_ACCOUNT_SIZE == 100_000.0
    assert "($100,000)" in vps.default_size_sentence()


def test_scenario_simulator_is_bounded(conn, monkeypatch):
    """Revived on the request path (the voice simulate_sizing_change tool): it reads at most
    MAX_TRADES of the newest trades in at most 730 days, and says when it capped."""
    from api.services import scenario_simulator as sim
    monkeypatch.setattr(sim, "MAX_TRADES", 3)
    aid = _member(conn, "sm9")
    for i in range(5):
        _trade(conn, "sm9", aid, pnl=100 + i,
               exit_iso=datetime(2026, 1, 1 + i, tzinfo=timezone.utc).isoformat())
    out = sim.simulate(user_id="sm9", rule="multiplier", rule_value=1.0, account_id=aid, days=100_000)
    assert out["trade_count"] == 3 and out["trades_capped"] is True
    assert out["actual_pnl"] == 102 + 103 + 104                     # the newest three
    assert out["days"] == 730                                       # the window is clamped too
