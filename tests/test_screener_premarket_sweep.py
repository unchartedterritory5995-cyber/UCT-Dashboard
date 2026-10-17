"""The screener's pre-market sweep (spec 2026-10-16 §2, plan Task 2).

A separate writer: it reads the same cached full-market snapshot the live tier
reads and writes its OWN table, `screener_premarket`. It never touches
`screener_live` or `screener_rows`, and it writes a row only for a symbol that
traded TODAY in pre-market (last trade at or after 04:00 ET).
"""
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

ET = ZoneInfo("America/New_York")
FLAG = "SCREENER_PREMARKET_ENABLED"


def _ns(dt) -> int:
    return int(dt.timestamp()) * 1_000_000_000


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv(FLAG, "1")
    from api.services import scan_volume
    from api.services.screener import live_tier, premarket, snapshot_db
    snapshot_db.init_db()
    snapshot_db.upsert_rows([{"ticker": t, "price": 99.0}
                             for t in ("AAA", "OLD", "MISSING", "BRK-B")])

    state = {"session": "pre_market",
             "now": datetime(2026, 10, 16, 8, 42, tzinfo=ET),
             "snap": {}}
    monkeypatch.setattr(live_tier, "_session", lambda: state["session"])
    monkeypatch.setattr(live_tier, "_now_et", lambda: state["now"])
    monkeypatch.setattr(scan_volume, "full_market_snapshot", lambda: state["snap"])
    state["snap"] = {
        "AAA": {"last_price": 105.0, "prev_close": 100.0,
                "last_trade_ns": _ns(datetime(2026, 10, 16, 8, 41, tzinfo=ET))},
        "OLD": {"last_price": 50.0, "prev_close": 50.0,
                "last_trade_ns": _ns(datetime(2026, 10, 15, 19, 59, tzinfo=ET))},
        "BRK.B": {"last_price": 420.0, "prev_close": 400.0,
                  "last_trade_ns": _ns(datetime(2026, 10, 16, 4, 0, tzinfo=ET))},
    }
    return state, premarket, snapshot_db


def _rows(snapshot_db, table="screener_premarket"):
    with snapshot_db.connect() as conn:
        return {r["ticker"]: dict(r) for r in conn.execute(f"SELECT * FROM {table}")}


def _fingerprint(snapshot_db):
    with snapshot_db.connect() as conn:
        return {t: [tuple(r) for r in conn.execute(f"SELECT * FROM {t} ORDER BY ticker")]
                for t in ("screener_live", "screener_rows")}


def test_a_ticker_that_traded_this_morning_gets_its_move(env):
    state, premarket, snapshot_db = env
    r = premarket.run_sweep()
    assert r["skipped_reason"] is None
    row = _rows(snapshot_db)["AAA"]
    assert row["premarket_chg_pct"] == 5.0
    assert row["premarket_price"] == 105.0
    assert row["session_ymd"] == 20261016
    assert row["premarket_asof"] == r["as_of"]


def test_the_cutoff_is_inclusive_at_four_and_symbol_forms_resolve(env):
    state, premarket, snapshot_db = env
    premarket.run_sweep()
    row = _rows(snapshot_db)["BRK-B"]           # app form, feed is BRK.B, traded 04:00:00
    assert row["premarket_chg_pct"] == 5.0


def test_yesterdays_last_trade_writes_no_row_never_a_zero(env):
    """Review focus 1: `last_price` is yesterday's close, so the change would read
    0.0% as if measured."""
    state, premarket, snapshot_db = env
    r = premarket.run_sweep()
    assert "OLD" not in _rows(snapshot_db)
    assert r["not_traded_today"] == 1
    assert r["no_feed"] == 1                     # MISSING
    assert r["written"] == 2
    assert r["considered"] == 4
    assert r["considered"] == (r["written"] + r["not_traded_today"]
                               + r["no_feed"] + r["no_price"])


def test_a_missing_trade_time_is_not_traded_today(env):
    state, premarket, snapshot_db = env
    state["snap"]["AAA"]["last_trade_ns"] = None
    r = premarket.run_sweep()
    assert "AAA" not in _rows(snapshot_db)
    assert r["not_traded_today"] == 2


@pytest.mark.parametrize("session", ["regular", "post_market"])
def test_outside_pre_market_it_writes_nothing(env, session):
    state, premarket, snapshot_db = env
    state["session"] = session
    r = premarket.run_sweep()
    assert r["skipped_reason"] == "not_pre_market"
    assert r["written"] == 0
    assert not _table(snapshot_db) or _rows(snapshot_db) == {}


def _table(snapshot_db):
    with snapshot_db.connect() as conn:
        return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' "
                            "AND name='screener_premarket'").fetchone() is not None


def test_flag_unset_is_disabled_and_writes_nothing(env, monkeypatch):
    state, premarket, snapshot_db = env
    monkeypatch.delenv(FLAG, raising=False)
    calls = []
    from api.services import scan_volume
    monkeypatch.setattr(scan_volume, "full_market_snapshot",
                        lambda: calls.append(1) or state["snap"])
    r = premarket.run_sweep()
    assert r["skipped_reason"] == "disabled"
    assert r["written"] == 0
    assert calls == []                           # no market read when off
    assert not _table(snapshot_db) or _rows(snapshot_db) == {}


def test_outside_pre_market_there_is_no_market_read(env, monkeypatch):
    state, premarket, snapshot_db = env
    state["session"] = "regular"
    calls = []
    from api.services import scan_volume
    monkeypatch.setattr(scan_volume, "full_market_snapshot",
                        lambda: calls.append(1) or state["snap"])
    premarket.run_sweep()
    assert calls == []


def test_the_sweep_never_touches_the_live_overlay_or_the_nightly_rows(env):
    """Global constraint: the regular live overlay is unchanged. A writing sweep
    leaves `screener_live` and `screener_rows` byte-for-byte as they were."""
    state, premarket, snapshot_db = env
    snapshot_db.upsert_live_rows([{"ticker": "AAA", "live_session_ymd": 20261015,
                                   "live_asof": 1.0, "price": 101.0,
                                   "src_price": 101.0, "anchor_price": 99.0,
                                   "live_cols": 1}])
    before = _fingerprint(snapshot_db)
    assert before["screener_live"] and before["screener_rows"]    # non-vacuous
    r = premarket.run_sweep()
    assert r["written"] == 2
    assert _fingerprint(snapshot_db) == before


def test_a_previous_sessions_rows_are_deleted_by_todays_first_sweep(env):
    state, premarket, snapshot_db = env
    state["now"] = datetime(2026, 10, 15, 8, 42, tzinfo=ET)
    state["snap"]["OLD"]["last_trade_ns"] = _ns(datetime(2026, 10, 15, 8, 30, tzinfo=ET))
    premarket.run_sweep()
    assert _rows(snapshot_db)["OLD"]["session_ymd"] == 20261015
    state["now"] = datetime(2026, 10, 16, 8, 42, tzinfo=ET)
    state["snap"]["OLD"]["last_trade_ns"] = _ns(datetime(2026, 10, 15, 19, 59, tzinfo=ET))
    premarket.run_sweep()
    rows = _rows(snapshot_db)
    assert "OLD" not in rows
    assert {r["session_ymd"] for r in rows.values()} == {20261016}


def test_the_receipt_is_remembered(env):
    state, premarket, snapshot_db = env
    r = premarket.run_sweep()
    assert premarket.last_receipt() == r


@pytest.mark.parametrize("raw,admin,member", [
    ("admin", True, False), ("1", True, True), (None, False, False), ("0", False, False)])
def test_served_to_follows_the_three_value_flag(monkeypatch, raw, admin, member):
    from api.services.screener import premarket
    if raw is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, raw)
    assert premarket.served_to({"role": "admin"}) is admin
    assert premarket.served_to({"role": "member"}) is member
    assert premarket.served_to(None) is member


@pytest.mark.parametrize("raw,on", [("admin", True), ("1", True), (None, False), ("0", False)])
def test_the_sweep_runs_whenever_the_scope_is_not_off(monkeypatch, raw, on):
    from api.services.screener import premarket
    if raw is None:
        monkeypatch.delenv(FLAG, raising=False)
    else:
        monkeypatch.setenv(FLAG, raw)
    assert premarket.sweep_enabled() is on


def test_the_flag_is_declared_dark_in_the_screener_family():
    from api.routers import auth
    assert auth.SCREENER_FLAGS[FLAG] is False


def test_the_job_is_registered_beside_the_live_tier():
    import ast
    import pathlib
    src = pathlib.Path("api/main.py").read_text(encoding="utf-8")
    ids = {kw.value.value for node in ast.walk(ast.parse(src))
           if isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "add_job"
           for kw in node.keywords
           if kw.arg == "id" and isinstance(kw.value, ast.Constant)}
    assert "screener_live_tier" in ids              # non-vacuity control
    assert "screener_premarket_sweep" in ids
