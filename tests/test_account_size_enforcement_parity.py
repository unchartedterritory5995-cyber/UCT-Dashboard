"""Enforcement parity with master base e9fc60a0f2 (Round B fix 2 ruling).

For unset members and every edge case, ENFORCEMENT equals base exactly: results, ERROR/skip paths
and the size each check runs on. Every enforcement reader runs on the reviewer's edge members and
is compared with literals derived from BASE code, one comment per case. Base read the raw stored
size, `float(settings.get("accountSize") or 0)`; the placeholder is 100,000 and the default is now
100,000 too, so base's numbers are the expected ones.

Members (each: maxRiskPerTradePct 1, dailyLossLimitPct 3, one closed trade today in the Default
account: 30 shares, entry 100, stop 50, P&L -2,500):
  A  single placeholder account           base size 100,000
  B  Default set to 40,000 + a second      base size 40,000 (Default); All Accounts 140,000
     placeholder account (no limits)
  C  B's unified '_all_' coach scope       base settings None -> size 0
  D  broker net-liq 0                      base size 0
  E  broker net-liq -2,000 (margin debt)   base size -2,000
  F  set 60,000                            base size 60,000
"""

import sqlite3
import uuid
from datetime import datetime, timezone

import pytest

_PAYLOAD = {
    "defaultStop": {"mode": "custom"},
    "positionClosing": "FIFO",
    "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
    "setups": [],
    "maxRiskPerTradePct": 1,
    "dailyLossLimitPct": 3,
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


def _today_et_noon():
    """Noon ET today as a UTC ISO stamp. Pinned to the ET session day, never the wall clock: base
    pre-trade matches `substr(exit_date, 1, 10)` to the ET day, so a raw UTC "now" after 8pm ET
    lands on tomorrow and the daily-loss check reads no trade (a function of the hour)."""
    from api.services.journal_two.calendar import et_today
    return f"{et_today()}T16:00:00+00:00"


def _trade(conn, uid, aid):
    now = _today_et_noon()
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,"
        " entry_date, exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent,"
        " r_multiple, hold_days, result, context_at_entry, created_at, account_id)"
        " VALUES (?, ?, 'p', 'NVDA', 'Long', 30, 100, ?, ?, ?, 50, 'Breakout', '', -2500, 0, NULL,"
        " 0, 'Loss', '{}', ?, ?)",
        (str(uuid.uuid4()), uid, now, 100 - 2500 / 30, now, now, aid))
    conn.commit()


def _make(conn, kind):
    """(user_id, account_id the readers are called with, Default account id)."""
    from api.services.journal_two import accounts
    from api.services.journal_two.broker import balances
    uid = f"m{kind}"
    aid = accounts.get_or_migrate_default_account(uid, conn=conn)["id"]
    size = {"A": 100_000, "B": 40_000, "C": 40_000, "D": 100_000, "E": 100_000, "F": 60_000}[kind]
    if kind in ("B", "C", "F"):        # the member typed it
        accounts.upsert_account_settings(uid, aid, {**_PAYLOAD, "accountSize": 1}, conn=conn)
    accounts.upsert_account_settings(uid, aid, {**_PAYLOAD, "accountSize": size}, conn=conn)
    if kind in ("B", "C"):
        accounts.create_account(uid, {"name": "Second", "color": "teal", "startingBalance": 1}, conn=conn)
    if kind in ("D", "E"):
        balances.write_balances(uid, {"id": "ba", "j2AccountId": aid}, [], [], conn=conn,
                                broker_total={"D": 0.0, "E": -2_000.0}[kind])
    _trade(conn, uid, aid)
    return uid, ("_all_" if kind == "C" else aid), aid


PARAMS = {"symbol": "NVDA", "side": "Long", "shares": 10, "entry_price": 100, "stop_price": 50}

# pre-trade hard checks, trade risk $500. Base: size <= 0 -> ERROR account_size_unset;
# risk % = 500 / size * 100 against the 1% cap; then net -2,500 vs -3% of size.
PRE_TRADE = {
    "A": (None, None),                                   # 0.5% under cap; -2,500 > -3,000: passes
    "B": ("SKIP", "risk_cap_breach"),                    # 500/40,000 = 1.25% > 1%
    "C": ("ERROR", "account_size_unset"),                # '_all_': no settings, size 0
    "D": ("ERROR", "account_size_unset"),                # size 0
    "E": ("ERROR", "account_size_unset"),                # size -2,000 <= 0
    "F": ("SKIP", "daily_loss_limit_breach"),            # 0.83% ok; -2,500 <= -1,800
}

# discipline state. Base: pct = pnl / size * 100 only when size > 0, else 0; lock at <= -3%.
DISCIPLINE = {
    "A": (-2.5, False),
    "B": (-6.25, True),
    "D": (0.0, False),
    "E": (0.0, False),                                   # size -2,000 is not > 0: pct 0, no lock
    "F": (round(-2500 / 60000 * 100, 2), True),          # -4.17
}

# interventions daily-loss approach. Base: off unless size > 0; fires at net <= -0.75*3%*size.
TILT = {"A": True, "B": True, "D": False, "E": False, "F": True}   # -2,250 / -900 / - / - / -1,350

# coach _discipline_events lockouts. Base: off unless size > 0; threshold -3% of size.
LOCKOUTS = {"A": 0, "B": 1, "C": 1, "D": 0, "E": 0, "F": 1}
# A -3,000 (net -2,500 above it) · B -1,200 · C sums the per-account parts (Default 1, Second
# has no limit) · D/E off · F -1,800

# coach sizing curve. Base: size <= 0 -> {"buckets": [], "note": "account size not configured"}.
CURVE_SIZE = {"A": 100_000.0, "B": 40_000.0, "C": None, "D": None, "E": None, "F": 60_000.0}

# calendar day %, one account (base raw size; 0 when size is not > 0). B is also checked on All
# Accounts: base SUM(account_size) = 40,000 + 100,000.
CAL_PCT = {"A": -2500 / 100_000, "B": -2500 / 40_000, "D": 0.0, "E": 0.0, "F": -2500 / 60_000}

# scenario simulator size. Base: float(raw or 0) (it never ran on base -- a broken import -- so this
# is base's arithmetic, not a base result).
SIM_SIZE = {"A": 100_000.0, "B": 40_000.0, "D": 0.0, "E": -2_000.0, "F": 60_000.0}

# chart plan /size input. Base: _finite_positive(raw) -> None unless > 0.
PLAN_SIZE = {"A": 100_000.0, "B": 40_000.0, "D": None, "E": None, "F": 60_000.0}


@pytest.mark.parametrize("kind", list(PRE_TRADE))
def test_pre_trade_hard_checks(conn, kind):
    from api.services.journal_two import pre_trade_verdict as ptv
    uid, acct, _ = _make(conn, kind)
    got = ptv._hard_checks(user_id=uid, account_id=acct, params=PARAMS, conn=conn)
    label, failed = PRE_TRADE[kind]
    assert (got or {}).get("label") == label and (got or {}).get("hard_check_failed") == failed


@pytest.mark.parametrize("kind", list(DISCIPLINE))
def test_discipline_lock(conn, kind):
    from api.services.journal_two import discipline
    uid, acct, _ = _make(conn, kind)
    st = discipline.compute_discipline_state(uid, acct, conn=conn)
    assert (st["todaysPnlPct"], st["locked"]) == DISCIPLINE[kind]


@pytest.mark.parametrize("kind", list(TILT))
def test_tilt_daily_loss(conn, kind):
    from api.services.journal_two import interventions as iv
    uid, acct, _ = _make(conn, kind)
    assert (iv._check_daily_loss_approach(conn, user_id=uid, account_id=acct) is not None) is TILT[kind]


def test_tilt_portfolio_daily_loss_unified(conn):
    """B on '_all_': base sums each limited account's threshold (Default only: -900); net -2,500."""
    from api.services.journal_two import interventions as iv
    uid, _acct, _ = _make(conn, "B")
    assert iv._check_portfolio_daily_loss(conn, user_id=uid, account_id="_all_") is not None


@pytest.mark.parametrize("kind", list(LOCKOUTS))
def test_coach_lockouts(conn, kind):
    from api.services.journal_two import coach_data_assembler as cda
    uid, acct, _ = _make(conn, kind)
    start, end = datetime(2000, 1, 1, tzinfo=timezone.utc), datetime(2100, 1, 1, tzinfo=timezone.utc)
    assert cda._discipline_events(conn, uid, acct, start, end)["daily_loss_lockouts"] == LOCKOUTS[kind]


@pytest.mark.parametrize("kind", list(CURVE_SIZE))
def test_coach_sizing_curve(conn, kind):
    from api.services.journal_two import coach_chat_tools as cct
    uid, acct, _ = _make(conn, kind)
    out = cct._exec_analyze_sizing_curve(user_id=uid, account_id=acct, args={}, conn=conn)
    if CURVE_SIZE[kind] is None:
        assert out == {"buckets": [], "note": "account size not configured"}
    else:
        assert out["account_size"] == CURVE_SIZE[kind]


@pytest.mark.parametrize("kind", list(CAL_PCT))
def test_calendar_pct(conn, kind):
    from api.services.journal_two import calendar as cal
    uid, acct, _ = _make(conn, kind)
    day = datetime.fromisoformat(_today_et_noon())
    out = cal.get_calendar(uid, view="month", year=day.year, month=day.month, account_id=acct, conn=conn)
    assert out["days"][-1]["pnlPercent"] == pytest.approx(CAL_PCT[kind])


def test_calendar_all_accounts_pct(conn):
    from api.services.journal_two import calendar as cal
    uid, _acct, _ = _make(conn, "B")
    day = datetime.fromisoformat(_today_et_noon())
    out = cal.get_calendar(uid, view="month", year=day.year, month=day.month, account_id=None, conn=conn)
    assert out["days"][-1]["pnlPercent"] == pytest.approx(-2500 / 140_000)


@pytest.mark.parametrize("kind", list(SIM_SIZE))
def test_scenario_simulator_size(conn, kind):
    from api.services import scenario_simulator as sim
    uid, acct, _ = _make(conn, kind)
    assert sim.simulate(user_id=uid, rule="multiplier", rule_value=1.0, account_id=acct)["account_size"] \
        == SIM_SIZE[kind]


@pytest.mark.parametrize("kind", list(PLAN_SIZE))
def test_chart_plan_size(conn, kind):
    from api.services.journal_two import chart_plan
    uid, acct, _ = _make(conn, kind)
    assert chart_plan.account_inputs(uid, acct)["accountSize"] == PLAN_SIZE[kind]
