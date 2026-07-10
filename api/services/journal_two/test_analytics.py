"""Analytics — aggregation correctness across the four sections."""

import json
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone

import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    import importlib
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _add_user(conn, user_id, email):
    conn.execute(
        "INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'pw')",
        (user_id, email),
    )
    conn.commit()


def _add_account(conn, user_id, *, name="Default", starting_balance=100_000):
    aid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_accounts (
            id, user_id, name, color, broker, starting_balance,
            account_size, default_stop, position_closing,
            breakeven_range, setups, share_journal_data,
            created_at, updated_at
        ) VALUES (?, ?, ?, 'blue', NULL, ?, ?,
                  '{"mode":"custom"}', 'FIFO',
                  '{"enabled":false,"unit":"$","value":0}',
                  '[]', 0, ?, ?)
        """,
        (aid, user_id, name, starting_balance, starting_balance, now, now),
    )
    conn.commit()
    return aid


def _add_trade(
    conn, user_id, *, account_id=None,
    exit_date_iso="2026-04-19T18:00:00Z", pnl=100, r=1.5, result="Win",
    side="Long", setup="VCP", symbol="NVDA",
    trading_day_et=None, hour_et=None,
):
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            account_id, created_at, trading_day_et, hour_et
        ) VALUES (?, ?, 'manual', ?, ?, 100, 500, ?, 510, ?,
                  490, ?, NULL, ?, 0.02, ?, 1, ?, '{}', ?, ?, ?, ?)
        """,
        (
            tid, user_id, symbol, side, exit_date_iso, exit_date_iso,
            setup, pnl, r, result, account_id, now,
            trading_day_et, hour_et,
        ),
    )
    conn.commit()
    return tid


# ─── Empty / no-data ──────────────────────────────────────────────────────────


def test_empty_user_returns_zero_structures(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    _add_account(db_conn, "u1")

    got = get_analytics("u1", conn=db_conn)
    assert got["tradeCount"] == 0
    assert got["equity"]["kpis"]["maxDrawdown"] == 0
    assert got["equity"]["curve"] == []
    assert got["distribution"]["longVsShort"]["long"]["winRate"] is None


# ─── Equity section ───────────────────────────────────────────────────────────


def test_equity_curve_running_balance_correct(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1", starting_balance=100_000)

    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-19T18:00:00Z", pnl=100)
    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-20T18:00:00Z", pnl=200)
    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-21T18:00:00Z", pnl=-50)

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    curve = got["equity"]["curve"]
    assert len(curve) == 3
    assert curve[0]["equity"] == 100_100
    assert curve[1]["equity"] == 100_300
    assert curve[2]["equity"] == 100_250


def test_equity_drawdown_kpis(db_conn):
    """Trades: +100, -200, +50 → peak balance 100,100; max DD = -150."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1", starting_balance=100_000)

    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-19T18:00:00Z", pnl=100)
    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-20T18:00:00Z", pnl=-200, result="Loss")
    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-21T18:00:00Z", pnl=50)

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    kpis = got["equity"]["kpis"]
    assert kpis["peakPnl"] == 100  # peak balance was 100100
    # Drawdown after the -200 day: 100100 → 99900 = -200
    assert kpis["maxDrawdown"] == -200
    # Current (last) drawdown: 99950 - 100100 = -150
    assert kpis["currentDrawdown"] == -150


# ─── Performance section ──────────────────────────────────────────────────────


def test_hourly_buckets_use_et(db_conn):
    """A 23:00 UTC trade in EDT = 19:00 ET → hour 19 bucket.

    Task 4: the hour report reads the stamped hour_et column (rows with
    NULL hour_et are excluded per spec §3), so stamp it here the same
    way every real write path does — via compute_hour_et."""
    from api.services.journal_two.analytics import get_analytics
    from api.services.journal_two.timeutil import compute_hour_et
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    iso = "2026-04-19T23:00:00Z"
    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso=iso, pnl=140, hour_et=compute_hour_et(iso))

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    hourly = {h["hour"]: h for h in got["performance"]["hourly"]}
    assert hourly[19]["pnl"] == 140
    assert hourly[19]["tradeCount"] == 1
    assert hourly[12]["tradeCount"] == 0


def test_day_of_week_breakdown(db_conn):
    """2026-04-20 is a Monday."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid,
               exit_date_iso="2026-04-20T18:00:00Z", pnl=100)

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    dow = {d["day"]: d for d in got["performance"]["dayOfWeek"]}
    assert dow["Mon"]["pnl"] == 100
    assert dow["Tue"]["pnl"] == 0


# ─── Distribution section ─────────────────────────────────────────────────────


def test_long_vs_short_split(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, side="Long",  pnl=100)
    _add_trade(db_conn, "u1", account_id=aid, side="Long",  pnl=200)
    _add_trade(db_conn, "u1", account_id=aid, side="Short", pnl=50)

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    ls = got["distribution"]["longVsShort"]
    assert ls["long"]["totalPnl"] == 300
    assert ls["long"]["tradeCount"] == 2
    assert ls["short"]["totalPnl"] == 50
    assert ls["short"]["tradeCount"] == 1


def test_r_multiple_buckets(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, r=2.5, pnl=250)   # 2R..3R
    _add_trade(db_conn, "u1", account_id=aid, r=1.5, pnl=150)   # 1R..2R
    _add_trade(db_conn, "u1", account_id=aid, r=-0.5, pnl=-50, result="Loss")  # -1R..0R

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    rm = {b["bucket"]: b["count"] for b in got["distribution"]["rMultiples"]}
    assert rm["2R..3R"] == 1
    assert rm["1R..2R"] == 1
    assert rm["-1R..0R"] == 1
    assert rm["< -2R"] == 0


def test_win_loss_streaks(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    # WWLLW
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-01T18:00:00Z", pnl=10, result="Win")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-02T18:00:00Z", pnl=20, result="Win")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-03T18:00:00Z", pnl=-10, result="Loss")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-04T18:00:00Z", pnl=-20, result="Loss")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-05T18:00:00Z", pnl=50, result="Win")

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    streaks = got["distribution"]["winLossStreaks"]
    assert len(streaks) == 3
    assert streaks[0] == {"index": 1, "type": "win", "length": 2}
    assert streaks[1] == {"index": 2, "type": "loss", "length": 2}
    assert streaks[2] == {"index": 3, "type": "win", "length": 1}


# ─── Attribution section ──────────────────────────────────────────────────────


def test_pnl_by_setup_excludes_null(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, setup="VCP",  pnl=100)
    _add_trade(db_conn, "u1", account_id=aid, setup="EP",   pnl=50)
    _add_trade(db_conn, "u1", account_id=aid, setup=None,   pnl=999)  # excluded

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    setups = {s["setup"]: s for s in got["attribution"]["bySetup"]}
    assert "VCP" in setups
    assert "EP" in setups
    assert None not in setups
    assert setups["VCP"]["totalPnl"] == 100


def test_pnl_by_symbol(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, symbol="NVDA", pnl=200)
    _add_trade(db_conn, "u1", account_id=aid, symbol="AMD",  pnl=140)
    _add_trade(db_conn, "u1", account_id=aid, symbol="NVDA", pnl=-50, result="Loss")

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    syms = {s["symbol"]: s for s in got["attribution"]["bySymbol"]}
    assert syms["NVDA"]["totalPnl"] == 150
    assert syms["NVDA"]["tradeCount"] == 2
    assert syms["AMD"]["totalPnl"] == 140


def test_rolling_win_rate_window(db_conn):
    """Window 2 over W L W W → at index 2: 0.5; at 3: 0.5; at 4: 1.0."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-01T18:00:00Z", result="Win")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-02T18:00:00Z", pnl=-10, result="Loss")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-03T18:00:00Z", result="Win")
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-04T18:00:00Z", result="Win")

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    # Service computes for windows 10/20/50/100/200; 4 trades < 10 → all empty
    assert got["attribution"]["rollingWinRate"]["windows"]["10"] == []


# ─── Account scoping + date range ─────────────────────────────────────────────


def test_account_id_filter(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    a1 = _add_account(db_conn, "u1", name="Live")
    a2 = _add_account(db_conn, "u1", name="Paper")

    _add_trade(db_conn, "u1", account_id=a1, pnl=100)
    _add_trade(db_conn, "u1", account_id=a2, pnl=999)

    got_a1 = get_analytics("u1", account_id=a1, conn=db_conn)
    assert got_a1["tradeCount"] == 1
    assert got_a1["distribution"]["longVsShort"]["long"]["totalPnl"] == 100


def test_date_range_filter(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-01-15T18:00:00Z", pnl=100)
    _add_trade(db_conn, "u1", account_id=aid, exit_date_iso="2026-04-20T18:00:00Z", pnl=200)

    got = get_analytics("u1", account_id=aid,
                       date_from="2026-04-01", date_to="2026-04-30",
                       conn=db_conn)
    assert got["tradeCount"] == 1
    assert got["distribution"]["longVsShort"]["long"]["totalPnl"] == 200


def test_user_isolation(db_conn):
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "alice", "alice@x.com")
    _add_user(db_conn, "bob", "bob@x.com")
    a_alice = _add_account(db_conn, "alice")
    a_bob = _add_account(db_conn, "bob")

    _add_trade(db_conn, "alice", account_id=a_alice, pnl=100)
    _add_trade(db_conn, "bob", account_id=a_bob, pnl=999)

    got = get_analytics("alice", conn=db_conn)
    assert got["tradeCount"] == 1


def test_options_section_empty(db_conn):
    """No strategies → zero-state for all options aggregates."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    _add_account(db_conn, "u1")
    got = get_analytics("u1", conn=db_conn)
    assert got["strategyCount"] == 0
    assert got["options"]["headline"]["count"] == 0
    assert got["options"]["byStrategyType"] == []
    assert got["options"]["dteScatter"] == []


def test_options_section_with_closed_strategies(db_conn):
    """Closed strategies feed byAssetType / byStrategyType / creditVsDebit."""
    from datetime import date, timedelta
    from api.services.journal_two.analytics import get_analytics
    from api.services.journal_two.options import create_strategy, close_strategy
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")

    exp = (date.today() + timedelta(days=30)).isoformat()

    # One winning long call: debit $500 → $800, +$300 / +0.6R (max risk = debit)
    s1 = create_strategy("u1", {
        "underlying": "NVDA", "strategy_type": "long_call", "direction": "bullish",
        "entry_date": date.today().isoformat(), "accountId": aid,
        "legs": [{"side": "buy", "contract_type": "call", "strike": 200,
                  "expiration": exp, "qty": 1, "entry_price": 5}],
    }, conn=db_conn)
    close_strategy("u1", s1["id"], {
        "exitPrices": {"0": 8}, "exitDate": date.today().isoformat(),
    }, conn=db_conn)

    # One losing credit spread: $-180 credit, close at +$220 debit → -$400
    s2 = create_strategy("u1", {
        "underlying": "SPY", "strategy_type": "vertical_credit_call",
        "direction": "bearish",
        "entry_date": date.today().isoformat(), "accountId": aid,
        "legs": [
            {"side": "sell", "contract_type": "call", "strike": 420,
             "expiration": exp, "qty": 1, "entry_price": 3.0},
            {"side": "buy",  "contract_type": "call", "strike": 425,
             "expiration": exp, "qty": 1, "entry_price": 1.2},
        ],
    }, conn=db_conn)
    close_strategy("u1", s2["id"], {
        "exitPrices": {"0": 4.5, "1": 2.3}, "exitDate": date.today().isoformat(),
    }, conn=db_conn)

    got = get_analytics("u1", account_id=aid, conn=db_conn)
    opts = got["options"]
    assert got["strategyCount"] == 2
    assert opts["headline"]["count"] == 2

    # byStrategyType
    types = {e["strategyType"]: e for e in opts["byStrategyType"]}
    assert "long_call" in types
    assert "vertical_credit_call" in types
    assert types["long_call"]["totalPnl"] == 300.0
    assert types["vertical_credit_call"]["totalPnl"] < 0

    # creditVsDebit
    assert opts["creditVsDebit"]["credit"]["count"] == 1  # credit spread
    assert opts["creditVsDebit"]["debit"]["count"] == 1   # long call

    # byAssetType
    assert opts["byAssetType"]["options"]["count"] == 2
    assert opts["byAssetType"]["equity"]["count"] == 0

    # dteScatter: only strategies with r_multiple have points
    # long_call has max_risk, credit_spread has max_risk → both have R → 2 points
    assert len(opts["dteScatter"]) == 2


# ─── trading_day_et spine (Task 4) ────────────────────────────────────────────


def test_spine_column_wins_over_utc_refilter(db_conn):
    """Row whose UTC date and spine day differ: spine must decide membership.

    exit 2026-04-19T00:00:00Z is 2026-04-18 20:00 ET, so the legacy
    to_et_date re-filter put it on the 18th (excluded from a 19th-only
    range). With trading_day_et='2026-04-19' stamped, the spine wins."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T00:00:00Z", pnl=100)
    db_conn.execute(
        "UPDATE j2_trades SET trading_day_et='2026-04-19', hour_et=NULL")
    db_conn.commit()

    out = get_analytics("u1", date_from="2026-04-19", date_to="2026-04-19",
                        conn=db_conn)
    # Trade included on the 19th (old code put it on the 18th → dropped)
    assert out["tradeCount"] == 1
    assert out["performance"]["byDay"] == [{"date": "2026-04-19", "pnl": 100.0}]


def test_hour_report_excludes_null_hours(db_conn):
    """Date-only trades (hour_et NULL) must vanish from the hour histogram
    instead of clustering at a fake midnight/8PM ET hour (spec §3)."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    _add_account(db_conn, "u1")

    _add_trade(db_conn, "u1", exit_date_iso="2026-04-19T14:30:00Z", pnl=100)
    _add_trade(db_conn, "u1", exit_date_iso="2026-04-20T00:00:00Z", pnl=50)  # date-only
    db_conn.execute(
        "UPDATE j2_trades SET trading_day_et = substr(exit_date, 1, 10)")
    db_conn.execute(
        "UPDATE j2_trades SET hour_et = 10 WHERE exit_date LIKE '%14:30%'")
    db_conn.commit()

    out = get_analytics("u1", conn=db_conn)
    hours = out["performance"]["hourly"]
    # Only the real-timestamp trade appears in an hour bucket
    assert sum(1 for h in hours if h["tradeCount"]) == 1
    by_hour = {h["hour"]: h for h in hours}
    assert by_hour[10]["tradeCount"] == 1
    assert by_hour[10]["pnl"] == 100.0


# ─── Exit Quality section (Task 7) ────────────────────────────────────────────


def _seed_excursion(
    conn, user_id, tid, *, efficiency, missed_r=None, mfe_r=None,
    data_quality="daily", symbol="NVDA",
):
    """Persist one excursion keyed to a manual trade (trade_ref = id:<tid>)."""
    from api.services.journal_two import excursions_store
    excursions_store.upsert_excursion(
        user_id, f"id:{tid}",
        {
            "symbol": symbol,
            "mfe_price": 110.0, "mae_price": 95.0,
            "mfe_r": mfe_r, "mae_r": None,
            "mfe_ts": 1000, "mae_ts": 1000,
            "exit_efficiency": efficiency,
            "missed_r": missed_r,
            "bar_resolution": "D",
            "data_quality": data_quality,
        },
        conn,
    )


def test_exit_quality_empty_no_crash(db_conn):
    """No rows / no excursions → zero coverage, not ready, metrics None."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    _add_account(db_conn, "u1")

    eq = get_analytics("u1", conn=db_conn)["exitQuality"]
    assert eq["coverage"] == {"eligible": 0, "computed": 0}
    assert eq["coverageReady"] is False
    assert eq["avgExitEfficiency"] is None
    assert eq["efficiencyBuckets"] == []


def test_exit_quality_coverage_gate_suppresses_below_90pct(db_conn):
    """10 of 12 rows computed (0.83 < 0.9) → aggregates suppressed even though
    computed >= 10; coverage counts still populated."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")
    tids = [
        _add_trade(db_conn, "u1", account_id=aid,
                   exit_date_iso=f"2026-04-{d:02d}T18:00:00Z", pnl=10)
        for d in range(1, 13)
    ]
    for tid in tids[:10]:
        _seed_excursion(db_conn, "u1", tid, efficiency=0.8, missed_r=1.0, mfe_r=2.0)
    for tid in tids[10:]:  # 2 insufficient → don't count as computed
        _seed_excursion(db_conn, "u1", tid, efficiency=None,
                        data_quality="insufficient")

    eq = get_analytics("u1", account_id=aid, conn=db_conn)["exitQuality"]
    assert eq["coverage"] == {"eligible": 12, "computed": 10}
    assert eq["coverageReady"] is False
    assert eq["avgExitEfficiency"] is None
    assert eq["missedRTotal"] is None
    assert eq["efficiencyBuckets"] == []


def test_exit_quality_ready_computes_aggregates(db_conn):
    """>=90% coverage + computed >= 10 → real avg efficiency + buckets; a
    null-efficiency (no-favorable) row is excluded from the mean but counts."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")
    effs = [0.10, 0.20, 0.30, 0.40, 0.55, 0.70, 0.80, 0.90, 0.95, 1.00]
    for i, e in enumerate(effs):
        tid = _add_trade(db_conn, "u1", account_id=aid,
                         exit_date_iso=f"2026-03-{i+1:02d}T18:00:00Z", pnl=10)
        _seed_excursion(db_conn, "u1", tid, efficiency=e, missed_r=1.0, mfe_r=2.0)
    # extra computed row with NO favorable move → exitEfficiency None
    tnull = _add_trade(db_conn, "u1", account_id=aid,
                       exit_date_iso="2026-03-20T18:00:00Z", pnl=-5, result="Loss")
    _seed_excursion(db_conn, "u1", tnull, efficiency=None, missed_r=None,
                    mfe_r=None, data_quality="daily")

    eq = get_analytics("u1", account_id=aid, conn=db_conn)["exitQuality"]
    assert eq["coverage"] == {"eligible": 11, "computed": 11}
    assert eq["coverageReady"] is True
    # mean over the 10 non-null efficiencies = 5.90 / 10 = 0.59 (null excluded)
    assert eq["avgExitEfficiency"] == 0.59
    assert eq["efficiencyExcludedNoFavorable"] == 1
    counts = [b["count"] for b in eq["efficiencyBuckets"]]
    assert counts == [2, 2, 2, 4]
    # R is the honest unit; a dollar figure is deliberately NOT fabricated
    assert eq["missedRTotal"] == 10.0
    assert eq["avgMissedR"] == 1.0
    assert "missedDollars" not in eq


def test_exit_quality_below_10_computed_suppresses(db_conn):
    """9 computed (100% coverage) but < 10 → None metrics + counts (n<10 gate)."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")
    for i in range(9):
        tid = _add_trade(db_conn, "u1", account_id=aid,
                         exit_date_iso=f"2026-02-{i+1:02d}T18:00:00Z", pnl=10)
        _seed_excursion(db_conn, "u1", tid, efficiency=0.7, missed_r=1.0, mfe_r=2.0)

    eq = get_analytics("u1", account_id=aid, conn=db_conn)["exitQuality"]
    assert eq["coverage"] == {"eligible": 9, "computed": 9}
    assert eq["coverageReady"] is True
    assert eq["avgExitEfficiency"] is None
    assert eq["efficiencyBuckets"] == []


def test_exit_quality_underlying_excluded(db_conn):
    """An 'underlying'-tier excursion (options) is excluded from computed count
    and the $ aggregates — equity only."""
    from api.services.journal_two.analytics import get_analytics
    _add_user(db_conn, "u1", "u1@x.com")
    aid = _add_account(db_conn, "u1")
    for i in range(10):
        tid = _add_trade(db_conn, "u1", account_id=aid,
                         exit_date_iso=f"2026-01-{i+1:02d}T18:00:00Z", pnl=10)
        _seed_excursion(db_conn, "u1", tid, efficiency=0.5, missed_r=1.0, mfe_r=2.0)
    tund = _add_trade(db_conn, "u1", account_id=aid,
                      exit_date_iso="2026-01-20T18:00:00Z", pnl=10)
    _seed_excursion(db_conn, "u1", tund, efficiency=None, missed_r=None,
                    mfe_r=None, data_quality="underlying")

    eq = get_analytics("u1", account_id=aid, conn=db_conn)["exitQuality"]
    # underlying row is eligible (an equity j2_trades row) but NOT computed
    assert eq["coverage"] == {"eligible": 11, "computed": 10}
    # 10/11 = 0.909 >= 0.9 → ready, computed 10 → real metrics
    assert eq["coverageReady"] is True
    assert eq["avgExitEfficiency"] == 0.5
