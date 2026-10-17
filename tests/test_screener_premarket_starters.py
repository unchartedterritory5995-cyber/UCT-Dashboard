"""Morning prep starters, the status key and the scan's pre-market block (plan Task 4).

Two starters, group "Morning prep", shown only to users the flag reaches. Both
screen on the pre-market columns, which are served 04:00-09:30 ET only.
"""
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services.screener import live_tier, premarket, query, saved_screens, snapshot_db

ET = ZoneInfo("America/New_York")
TODAY = 20261016
IDS = {"starter_premarket_gappers", "starter_premarket_setups"}
MEMBER = {"id": "m1", "role": "member"}
ADMIN = {"id": "a1", "role": "admin"}


def _row(t, *, price=50.0, dv=20_000_000, pivot=None, sec="Stock"):
    return {"ticker": t, "price": price, "dollar_vol_30d": dv, "base_pivot_px": pivot,
            "security_type": sec, "bars_asof": "20261015", "snapshot_date": "2026-10-15",
            "built_at": 1}


@pytest.fixture
def pm(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "pm.db"))
    monkeypatch.setenv("SCREENER_PREMARKET_ENABLED", "1")
    monkeypatch.delenv("SCREENER_LIVE_TIER_ENABLED", raising=False)
    state = {"session": "pre_market"}
    monkeypatch.setattr(live_tier, "_session", lambda: state["session"])
    monkeypatch.setattr(live_tier, "_now_et",
                        lambda: datetime(2026, 10, 16, 8, 42, tzinfo=ET))
    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        _row("UP4", pivot=48.0),            # +4%: both
        _row("UP4NOBASE"),                  # +4%, no pivot: gappers only
        _row("UP2BASE", pivot=40.0),        # +2.5%: setups only
        _row("UP4CHEAP", price=3.0),        # price under 5, no pivot: neither
        _row("UP4THIN", dv=1_000_000),      # thin: neither
        _row("UP4ETF", sec="ETF"),          # an ETF: never (stocks only)
        _row("FLAT", pivot=10.0),           # +0.5%: neither
    ])
    now = time.time()
    with snapshot_db.connect() as conn:
        conn.execute(premarket._SCHEMA)
        conn.executemany(
            f"INSERT INTO {premarket.TABLE} VALUES (?, ?, ?, ?, ?)",
            [(t, TODAY, 1.0, chg, now) for t, chg in (
                ("UP4", 4.0), ("UP4NOBASE", 4.5), ("UP2BASE", 2.5), ("UP4CHEAP", 4.0),
                ("UP4THIN", 4.0), ("UP4ETF", 4.0), ("FLAT", 0.5))])
        conn.commit()
    return state


def _starter(sid, user=ADMIN):
    return next(s for s in saved_screens.starters(user) if s["id"] == sid)


def _run(sid, user=ADMIN):
    spec = dict(_starter(sid, user)["spec"], page_size=500)
    return [r["ticker"] for r in query.run_scan(spec, user_id=user["id"], user=user)["rows"]]


def test_gapping_pre_market_finds_the_morning_gappers(pm):
    assert _run("starter_premarket_gappers") == ["UP4NOBASE", "UP4"]   # sorted by move


def test_setups_gapping_pre_market_needs_a_base_pivot(pm):
    assert _run("starter_premarket_setups") == ["UP4", "UP2BASE"]


def test_after_nine_thirty_both_answer_empty(pm):
    pm["session"] = "regular"
    assert _run("starter_premarket_gappers") == []
    assert _run("starter_premarket_setups") == []


def test_the_starters_are_morning_prep_and_say_there_is_no_volume():
    for sid, name in (("starter_premarket_gappers", "Gapping pre-market"),
                      ("starter_premarket_setups", "Setups gapping pre-market")):
        s = next(x for x in saved_screens.premarket_starters() if x["id"] == sid)
        assert s["name"] == name
        assert s["group"] == "Morning prep"
        assert "No pre-market volume is available." in s["description"]
        assert s["spec"]["sort"] == {"key": "premarket_chg_pct", "dir": "desc"}
        assert s["spec"]["view"] == "technical"


@pytest.mark.parametrize("raw,member,admin", [
    ("admin", False, True), ("1", True, True), (None, False, False)])
def test_the_starters_list_follows_the_flag_per_user(monkeypatch, raw, member, admin):
    """Review focus 4: at `admin` a member's list has no Morning prep starters."""
    if raw is None:
        monkeypatch.delenv("SCREENER_PREMARKET_ENABLED", raising=False)
    else:
        monkeypatch.setenv("SCREENER_PREMARKET_ENABLED", raw)
    def ids(u):
        return {s["id"] for s in saved_screens.starters(u)}
    for user, want in ((MEMBER, member), (ADMIN, admin), (None, member)):
        got = ids(user) & IDS
        assert got == (IDS if want else set()), (user, got)
    assert "starter_gap_up_volume" in ids(MEMBER)                   # control


def test_the_saved_screens_route_filters_by_the_caller(monkeypatch):
    from api.routers import screener as route
    monkeypatch.setenv("SCREENER_PREMARKET_ENABLED", "admin")
    monkeypatch.setattr(route.scr_saved, "init", lambda: None)
    monkeypatch.setattr(route.scr_saved, "list_for", lambda uid: [])
    m = {s["id"] for s in route.screener_saved_list(user=MEMBER)["starters"]}
    a = {s["id"] for s in route.screener_saved_list(user=ADMIN)["starters"]}
    assert not (IDS & m) and IDS <= a


def test_snapshot_status_carries_the_premarket_receipt(monkeypatch):
    from api.routers import screener as route
    monkeypatch.setenv("SCREENER_PREMARKET_ENABLED", "1")
    monkeypatch.setattr(route.scr_db, "status", lambda: {"rows": 1})
    monkeypatch.setattr(route.scr_query, "live_tier_state", lambda: {"state": "off"})
    monkeypatch.setattr(premarket, "_LAST", {"skipped_reason": None, "as_of": 12.5,
                                             "written": 3})
    out = route.screener_snapshot_status(user=MEMBER)
    assert out["premarket"]["as_of"] == 12.5
    monkeypatch.setenv("SCREENER_PREMARKET_ENABLED", "admin")
    assert route.screener_snapshot_status(user=MEMBER)["premarket"] is None
    assert route.screener_snapshot_status(user=ADMIN)["premarket"]["written"] == 3


def test_the_scan_says_when_the_premarket_values_are_from(pm):
    res = query.run_scan({"page_size": 5}, user_id="a1", user=ADMIN)
    block = res["snapshot"]["premarket"]
    assert block["state"] == "premarket"
    assert abs(block["as_of"] - time.time()) < 60
    pm["session"] = "regular"
    res = query.run_scan({"page_size": 5}, user_id="a1", user=ADMIN)
    assert "premarket" not in res["snapshot"]                       # absent, not null


def test_base_pivot_is_a_filter_key_so_the_presence_ruling_can_screen_on_it():
    from api.services.screener import filters
    assert filters.column_for("base_pivot_px") == "base_pivot_px"


def test_meta_marks_the_premarket_filters_from_the_sweeps_own_declaration():
    from api.services.screener import filters
    out = filters._build_shared_filters({"columns": {}})
    marked = {e["key"] for e in out if e.get("premarket_only")}
    assert marked == {"premarket_chg_pct", "premarket_price"}
    assert all(e.get("live_only") for e in out if e["key"] in marked)
    assert "rvol_live" not in marked                                # control
