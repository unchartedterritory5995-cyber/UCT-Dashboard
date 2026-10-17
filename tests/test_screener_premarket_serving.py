"""Serving the pre-market columns through their own join (plan Task 3).

`premarket_price` / `premarket_chg_pct` come from a SECOND left join, `pm`, on
`screener_premarket`. They are served only while the session is pre-market, for
today's `session_ymd`, with `premarket_asof` under 180 s old, and only to users
the flag reaches. Otherwise they are NULL. The regular live overlay is untouched.

⛔ Every fixture is a tmp DB. Nothing reads C:\\data.
"""
import ast
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services.screener import live_tier, premarket, query, snapshot_db

ET = ZoneInfo("America/New_York")
TODAY = 20261016
ANCHOR = "20261015"
MEMBER = {"id": "m1", "role": "member"}
ADMIN = {"id": "a1", "role": "admin"}
PM_UP_3 = {"filters": [{"key": "premarket_chg_pct", "op": "gte", "min": 3}],
           "page_size": 500}
ALL = {"page_size": 500}


def _nightly():
    return [{"ticker": t, "price": p, "chg_pct_1d": c, "gap_pct": g,
             "bars_asof": ANCHOR, "snapshot_date": "2026-10-15", "built_at": 1,
             "uct_composite": u}
            for t, p, c, g, u in (("GAP", 100.0, 0.5, 0.1, 50),
                                  ("FLAT", 50.0, 0.2, 0.0, 40),
                                  ("NOPM", 20.0, 0.1, 0.0, 30))]


def _pm_rows(conn, rows):
    conn.execute(premarket._SCHEMA)
    conn.executemany(
        f"INSERT OR REPLACE INTO {premarket.TABLE} (ticker, session_ymd, "
        "premarket_price, premarket_chg_pct, premarket_asof) VALUES (?, ?, ?, ?, ?)",
        rows)
    conn.commit()


@pytest.fixture
def pm(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "pm.db"))
    monkeypatch.setenv("SCREENER_PREMARKET_ENABLED", "1")
    monkeypatch.delenv("SCREENER_LIVE_TIER_ENABLED", raising=False)
    state = {"session": "pre_market", "now": datetime(2026, 10, 16, 8, 42, tzinfo=ET)}
    monkeypatch.setattr(live_tier, "_session", lambda: state["session"])
    monkeypatch.setattr(live_tier, "_now_et", lambda: state["now"])
    monkeypatch.setattr(query, "_COUNT_CACHE", None)
    snapshot_db.init_db()
    snapshot_db.upsert_rows(_nightly())
    now = time.time()
    with snapshot_db.connect() as conn:
        _pm_rows(conn, [("GAP", TODAY, 105.0, 5.0, now),
                        ("FLAT", TODAY, 50.5, 1.0, now)])
    return state


def _scan(spec, user=MEMBER):
    res = query.run_scan(dict(spec), user_id=user["id"], user=user)
    return {r["ticker"]: r for r in res["rows"]}, res


def test_pre_market_a_fresh_row_is_served_and_filters(pm):
    rows, res = _scan(PM_UP_3)
    assert set(rows) == {"GAP"}
    assert rows["GAP"]["premarket_chg_pct"] == 5.0
    assert rows["GAP"]["premarket_price"] == 105.0
    every, _ = _scan(ALL)
    assert every["FLAT"]["premarket_chg_pct"] == 1.0           # control: served, not filtered
    assert every["NOPM"]["premarket_chg_pct"] is None           # no pm row: NULL


def test_at_nine_thirty_and_after_the_columns_serve_null(pm):
    """Review focus 2: the rows still sit in the table, the session moved on."""
    pm["session"] = "regular"
    pm["now"] = datetime(2026, 10, 16, 9, 31, tzinfo=ET)
    rows, _ = _scan(PM_UP_3)
    assert rows == {}
    every, _ = _scan(ALL)
    assert every["GAP"]["premarket_chg_pct"] is None
    assert every["GAP"]["premarket_price"] is None
    with snapshot_db.connect() as conn:                         # control: still stored
        assert conn.execute(f"SELECT COUNT(*) FROM {premarket.TABLE}").fetchone()[0] == 2


def test_a_dead_sweeper_serves_null_not_a_stale_value(pm):
    """Review focus 3: 181 s old is not current."""
    with snapshot_db.connect() as conn:
        _pm_rows(conn, [("GAP", TODAY, 105.0, 5.0, time.time() - 181)])
    every, _ = _scan(ALL)
    assert every["GAP"]["premarket_chg_pct"] is None
    assert every["FLAT"]["premarket_chg_pct"] == 1.0            # control: fresh row served


def test_yesterdays_session_serves_null(pm):
    with snapshot_db.connect() as conn:
        _pm_rows(conn, [("GAP", TODAY - 1, 105.0, 5.0, time.time())])
    every, _ = _scan(ALL)
    assert every["GAP"]["premarket_chg_pct"] is None
    assert every["FLAT"]["premarket_chg_pct"] == 1.0


def test_flag_admin_a_member_gets_null_and_an_admin_gets_the_value(pm, monkeypatch):
    """Review focus 4."""
    monkeypatch.setenv("SCREENER_PREMARKET_ENABLED", "admin")
    member, _ = _scan(ALL, MEMBER)
    admin, _ = _scan(ALL, ADMIN)
    assert member["GAP"]["premarket_chg_pct"] is None
    assert admin["GAP"]["premarket_chg_pct"] == 5.0
    assert _scan(PM_UP_3, MEMBER)[0] == {}
    assert set(_scan(PM_UP_3, ADMIN)[0]) == {"GAP"}


def test_flag_off_serves_null_for_everyone(pm, monkeypatch):
    monkeypatch.delenv("SCREENER_PREMARKET_ENABLED", raising=False)
    assert _scan(ALL, ADMIN)[0]["GAP"]["premarket_chg_pct"] is None


def test_the_column_can_be_requested_and_sorted(pm):
    res = query.run_scan({"columns": ["premarket_chg_pct", "premarket_price"],
                          "sort": {"key": "premarket_chg_pct", "dir": "desc"},
                          "page_size": 500}, user_id="m1", user=MEMBER)
    order = [r["ticker"] for r in res["rows"]]
    assert order[:2] == ["GAP", "FLAT"]
    assert res["rows"][0]["premarket_chg_pct"] == 5.0
    assert "NULL" not in res["rows"][0]                         # aliased, never a raw key


@pytest.mark.parametrize("user", [MEMBER, ADMIN])
def test_the_count_matches_the_scan(pm, monkeypatch, user):
    monkeypatch.setenv("SCREENER_PREMARKET_ENABLED", "admin")
    _, res = _scan(PM_UP_3, user)
    count = query.preview_count(dict(PM_UP_3), user_id=user["id"], user=user)["count"]
    assert count == res["total"]
    batch = query.preview_count_batch([dict(PM_UP_3)], user_id=user["id"], user=user)
    assert batch[0]["count"] == res["total"]
    assert res["total"] == (1 if user is ADMIN else 0)


def test_the_count_cache_moves_with_the_session(pm):
    first = query.preview_count_batch([dict(PM_UP_3)], user_id="m1", user=MEMBER)
    assert first[0]["count"] == 1
    pm["session"] = "regular"
    again = query.preview_count_batch([dict(PM_UP_3)], user_id="m1", user=MEMBER)
    assert again[0]["count"] == 0


# ── the regular live overlay is unchanged (review focus 5) ──────────────────

def _live_row(ticker, **values):
    row = {c: None for c in live_tier.LIVE_COLUMNS}
    row.update(values)
    row.update({"ticker": ticker, "live_session_ymd": TODAY,
                "live_asof": time.time(), "anchor_bars_asof": ANCHOR,
                "src_price": float(values.get("price") or 1.0),
                "anchor_price": 1.0, "live_cols": len(values)})
    return row


@pytest.fixture
def both(pm, monkeypatch):
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "1")
    snapshot_db.upsert_live_rows([_live_row("GAP", price=104.0, gap_pct=4.2,
                                            chg_pct_1d=4.0)])
    return pm


@pytest.mark.parametrize("session", ["regular", "pre_market"])
def test_pm_rows_never_change_any_live_column(both, session):
    both["session"] = session
    with_pm, _ = _scan(ALL, ADMIN)
    assert with_pm["GAP"]["price"] == 104.0                     # the live value, served
    assert with_pm["GAP"]["gap_pct"] == 4.2
    with snapshot_db.connect() as conn:
        conn.execute(f"DELETE FROM {premarket.TABLE}")
        conn.commit()
    without, _ = _scan(ALL, ADMIN)
    for t in with_pm:
        for c in live_tier.LIVE_COLUMNS:
            assert with_pm[t].get(c) == without[t].get(c), (t, c)
        assert with_pm[t].get("live_row") == without[t].get("live_row")


def test_pre_market_both_joins_together_serve_both(both):
    rows, _ = _scan(ALL, ADMIN)
    assert rows["GAP"]["price"] == 104.0
    assert rows["GAP"]["premarket_chg_pct"] == 5.0


def test_params_bind_in_from_clause_order_when_both_joins_carry_one(both, monkeypatch):
    """The live join's freshness cutoff comes first in the FROM clause, then pm's
    session and age. Forced here (live has no cutoff outside RTH) so an ordering
    swap is visible: swapped, pm's `session_ymd = ?` would bind a timestamp."""
    monkeypatch.setattr(live_tier, "min_serve_asof", lambda now=None: time.time() - 60)
    with snapshot_db.connect() as conn:
        ov = query._overlay(conn, user=ADMIN)
    assert ov.on and ov.pm_on
    assert len(ov.live_params) == 1 and len(ov.pm_params) == 2
    assert ov.join_params == [*ov.live_params, *ov.pm_params]
    rows, _ = _scan(ALL, ADMIN)
    assert rows["GAP"]["price"] == 104.0
    assert rows["GAP"]["premarket_chg_pct"] == 5.0


def test_the_count_stamp_reads_the_LIVE_cutoff_never_a_pm_param(both):
    """In pre-market the live overlay has no cutoff, so `join_params[0]` would be
    pm's session date. The stamp's live bucket must stay None."""
    with snapshot_db.connect() as conn:
        ov = query._overlay(conn, user=ADMIN)
        assert ov.on and ov.pm_on and ov.live_params == []
        parts = ast.literal_eval(query._snapshot_stamp(conn, ov))
    live = [p for p in parts if isinstance(p, tuple) and p and p[0] == "overlay-on"]
    assert live and live[0][2] is None
    assert any(isinstance(p, tuple) and p and p[0] == "pm-on" for p in parts)


def test_with_pm_off_the_live_statement_is_unchanged(both, monkeypatch):
    monkeypatch.delenv("SCREENER_PREMARKET_ENABLED", raising=False)
    with snapshot_db.connect() as conn:
        ov = query._overlay(conn, user=ADMIN)
        plan = query.build_scan_sql(dict(ALL), ov, conn=conn)
    assert premarket.TABLE not in plan["sql"]
    assert ov.join_params == ov.live_params
