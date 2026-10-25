"""Task 10.11: the dedicated builders II (plan vs actual, pre-market game plan, alerts that fired).

Real auth.db schema (auth_db.init_db) in a tmp dir; trades, plan links, positions and option
strategies are seeded straight into their tables; both fire logs live in tmp files (the indicator
log beside the alerts in auth.db, as in production; the S7 log in its own alert_taxonomy.db);
`now` is injected.
"""
from __future__ import annotations

import importlib
import json
import sqlite3
import sys
import types
import uuid
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pytest

A, B = "u-comp-a", "u-comp-b"
ET = ZoneInfo("America/New_York")
STAMP = "2026-08-01T00:00:00Z"
#: Monday 2026-10-26, 08:30 ET (pre-market).
MON = datetime(2026, 10, 26, 12, 30, tzinfo=timezone.utc)


@pytest.fixture
def S(monkeypatch, tmp_path):
    db = str(tmp_path / "auth.db")
    monkeypatch.setenv("AUTH_DB_PATH", db)
    from api.services import auth_db, indicator_alert_service as ias
    from api.services.alert_taxonomy import db as atdb
    importlib.reload(auth_db)
    auth_db.init_db()
    monkeypatch.setattr(ias, "_DB_PATH", db)
    monkeypatch.setattr(atdb, "DB_PATH", str(tmp_path / "alert_taxonomy.db"))
    from api.services.journal_two import shelf_compose
    yield shelf_compose
    importlib.reload(auth_db)


def _conn():
    from api.services import auth_db
    return auth_db.get_connection()


def et_epoch(day: str, hm: str) -> float:
    h, m = (int(x) for x in hm.split(":"))
    d = date.fromisoformat(day)
    return datetime(d.year, d.month, d.day, h, m, tzinfo=ET).timestamp()


def trade(c, uid, *, side="Long", entry=100.0, exit_=110.0, stop=95.0, shares=10, r=None,
          source=None, external_id=None, symbol="NVDA"):
    tid = str(uuid.uuid4())
    c.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
        " exit_price, exit_date, original_stop, pnl_dollar, pnl_percent, hold_days, result,"
        " context_at_entry, created_at, trading_day_et, r_multiple, source, external_id)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10-20T14:00:00Z', ?, '2026-10-20T15:00:00Z', ?, 100,"
        " 0.01, 0, 'Win', '{}', ?, '2026-10-20', ?, ?, ?)",
        (tid, uid, str(uuid.uuid4()), symbol, side, shares, entry, exit_, stop, STAMP, r, source, external_id))
    return tid


def link(c, uid, tid, plan, *, note_id=None, kind="note"):
    from api.services.journal_two.trade_refs import trade_ref_for_row
    row = c.execute("SELECT * FROM j2_trades WHERE id = ?", (tid,)).fetchone()
    c.execute(
        "INSERT INTO j2_trade_plan_links (user_id, trade_ref, symbol, source_kind, match_tier,"
        " note_id, plan_json, flags_json, matched_at) VALUES (?, ?, ?, ?, 'explicit', ?, ?, '[]', ?)",
        (uid, trade_ref_for_row(row), row["symbol"], kind, note_id, json.dumps(plan), STAMP))


def position(c, uid, *, acc=None, symbol="AAPL", entry=100.0, stop=95.0, shares=50):
    c.execute(
        "INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares, original_shares,"
        " entry_price, stop_price, context_at_entry, created_at, updated_at, account_id)"
        " VALUES (?, ?, ?, 'Long', '2026-10-01T14:00:00Z', ?, ?, ?, ?, '{}', ?, ?, ?)",
        (str(uuid.uuid4()), uid, symbol, shares, shares, entry, stop, STAMP, STAMP, acc))


def open_strategy(c, uid, *, acc=None):
    c.execute(
        "INSERT INTO j2_option_strategies (id, user_id, account_id, underlying, strategy_type,"
        " direction, net_entry, entry_date, status, created_at, updated_at) VALUES"
        " (?, ?, ?, 'SPY', 'long_call', 'bullish', 100, '2026-10-01', 'open', ?, ?)",
        (str(uuid.uuid4()), uid, acc, STAMP, STAMP))


_KEY = iter(range(1, 10_000_000))


def ind_fire(uid, *, at, sym="NVDA"):
    from api.services import alert_fired_log as afl
    k = next(_KEY)
    assert afl.record_fire(k, uid, sym, "rsi", "above", "D", f"ep:{k}", 71.0, fired_at=at)


def s7_fire(uid, *, at, sym="AAPL", detail=None, trigger="document-arrival"):
    from api.services.alert_taxonomy import db as atdb, receipts
    k = next(_KEY)
    c = atdb.connect()
    try:
        atdb.init_db(c)
        c.execute("INSERT INTO alert_predicates (id, type_id, user_id, entity_scope, params,"
                  " created_at, updated_at, suspended_at) VALUES (?, ?, ?, ?, '{}', 0, 0, 1)",
                  (f"p{k}", trigger, uid, json.dumps({"kind": "ticker", "id": f"{sym}{k}"})))
        c.commit()
    finally:
        c.close()
    assert receipts.record_fire(f"p{k}", trigger, uid, sym, f"k{k}", detail=detail,
                                as_of=at, fired_at=at) is not None


def strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from strings(v)
    elif isinstance(x, (list, tuple)):
        for v in x:
            yield from strings(v)


FORBIDDEN = ("$0", " 0 ", "0%", "0 of", "(0)")


def no_zero_strings(payload):
    bad = [s for s in strings(payload) if any(f in s for f in FORBIDDEN)]
    assert not bad, bad


def row(payload, label):
    return next(r for r in payload["rows"] if r["label"] == label)


# ── Plan vs actual ────────────────────────────────────────────────────────────────────────────

def test_rows_from_grade_checks_side_aware_slippage(S, monkeypatch):
    from api.services.journal_two import plan_grading
    calls = []
    real = plan_grading.grade_checks

    def spy(plan, trade_, **k):
        out = real(plan, trade_, **k)
        calls.append(out)
        return out
    monkeypatch.setattr(plan_grading, "grade_checks", spy)
    with _conn() as c:
        long_id = trade(c, A, side="Long", entry=100.5, exit_=108.0, stop=95.0, r=1.5)
        link(c, A, long_id, {"entry": 100.0, "stop": 96.0, "target": 110.0, "shares": 10})
        short_id = trade(c, A, side="Short", entry=49.5, exit_=45.0, stop=52.0, symbol="TSLA")
        link(c, A, short_id, {"entry": 50.0, "stop": 52.0, "target": 44.0, "shares": 10})
    got = S.my_plan_vs_actual(A, {"tradeId": long_id}, MON)
    assert calls, "grade_checks was never asked"
    chk = calls[-1]
    e = row(got, "Entry")
    assert e["planned"] == chk["entry"]["planned"] == 100.0
    assert e["actual"] == chk["entry"]["actual"] == 100.5
    # A long filled ABOVE the plan is worse: positive slippage.
    assert e["slippage"] == pytest.approx(0.5) and e["slippagePct"] == pytest.approx(0.005)
    assert "worse" in e["text"]
    r = row(got, "R")
    assert r["planned"] == pytest.approx(10.0 / chk["r"]) and r["actual"] == 1.5
    t = row(got, "Target")
    assert t["planned"] == 110.0 and t["actual"] == chk["target"]["exit"] == 108.0
    # A short filled BELOW its plan is worse too (it sold cheaper).
    short = S.my_plan_vs_actual(A, {"tradeId": short_id}, MON)
    se = row(short, "Entry")
    assert se["slippage"] == pytest.approx(0.5) and se["slippagePct"] == pytest.approx(0.01)
    assert "worse" in se["text"]
    # And a short filled ABOVE its plan is better.
    with _conn() as c:
        better = trade(c, A, side="Short", entry=50.25, exit_=45.0, stop=52.0, symbol="AMD")
        link(c, A, better, {"entry": 50.0, "stop": 52.0, "target": 44.0, "shares": 10})
    be = row(S.my_plan_vs_actual(A, {"tradeId": better}, MON), "Entry")
    assert be["slippage"] == pytest.approx(-0.25) and "better" in be["text"]


def test_placeholder_stop_reads_no_stop_set(S):
    with _conn() as c:
        tid = trade(c, A, entry=100.0, stop=100.0, source="broker", external_id="X1")
        link(c, A, tid, {"entry": 100.0, "stop": 96.0, "target": 110.0, "shares": 10})
    got = S.my_plan_vs_actual(A, {"tradeId": tid}, MON)
    s = row(got, "Stop")
    assert s["planned"] == 96.0
    assert s["actual"] is None and "No stop set" in s["text"]
    assert "$100" not in s["text"]
    # CONTROL: a real stop is shown as the stop.
    with _conn() as c:
        real = trade(c, A, entry=100.0, stop=95.0)
        link(c, A, real, {"entry": 100.0, "stop": 96.0, "target": 110.0, "shares": 10})
    assert row(S.my_plan_vs_actual(A, {"tradeId": real}, MON), "Stop")["actual"] == 95.0


def test_unlinked_trade_sentence(S):
    with _conn() as c:
        tid = trade(c, A)
    got = S.my_plan_vs_actual(A, {"tradeId": tid}, MON)
    assert got["lines"] == [S.S_PVA_UNLINKED]
    assert S.S_PVA_UNLINKED == "This trade isn't linked to a plan. Link one from the trade's page."
    assert got["rows"] == []
    no_zero_strings(got)
    # The member's own "this trade had no plan" is a link with no plan: the same sentence.
    with _conn() as c:
        none = trade(c, A, symbol="AMD")
        link(c, A, none, {"entry": None, "stop": None, "target": None}, kind="none")
    assert S.my_plan_vs_actual(A, {"tradeId": none}, MON)["lines"] == [S.S_PVA_UNLINKED]


def test_unlinked_sample_note_link_is_not_a_plan(S):
    """A link to a sample note is never the member's plan: it reads as unlinked."""
    with _conn() as c:
        tid = trade(c, A)
        c.execute("INSERT INTO j2_notes (id, user_id, title, created_at, updated_at, import_source)"
                  " VALUES ('n-sample', ?, 'x', ?, ?, 'sample')", (A, STAMP, STAMP))
        link(c, A, tid, {"entry": 100.0, "stop": 96.0, "target": 110.0}, note_id="n-sample")
        own = trade(c, A, symbol="AMD")
        c.execute("INSERT INTO j2_notes (id, user_id, title, created_at, updated_at)"
                  " VALUES ('n-own', ?, 'x', ?, ?)", (A, STAMP, STAMP))
        link(c, A, own, {"entry": 100.0, "stop": 96.0, "target": 110.0}, note_id="n-own")
    assert S.my_plan_vs_actual(A, {"tradeId": tid}, MON)["lines"] == [S.S_PVA_UNLINKED]
    assert S.my_plan_vs_actual(A, {"tradeId": own}, MON)["rows"]           # CONTROL


def test_foreign_trade_not_available(S):
    with _conn() as c:
        theirs = trade(c, B)
        link(c, B, theirs, {"entry": 100.0, "stop": 96.0, "target": 110.0, "shares": 10})
    for params in ({"tradeId": theirs}, {"tradeId": "no-such-trade"}, {}, {"tradeId": 7},
                   {"tradeId": "opt:abc"}):
        got = S.my_plan_vs_actual(A, params, MON)
        assert got["lines"] == ["Not available."], params
        assert got["rows"] == [] and got["available"] is False
    # CONTROL: the owner sees it.
    assert S.my_plan_vs_actual(B, {"tradeId": theirs}, MON)["rows"]


def test_missing_target_not_in_the_plan(S):
    with _conn() as c:
        tid = trade(c, A, r=None)
        link(c, A, tid, {"entry": 100.0, "stop": 96.0, "target": None, "shares": 10})
        no_stop = trade(c, A, symbol="AMD")
        link(c, A, no_stop, {"entry": 100.0, "stop": None, "target": 110.0, "shares": 10})
    got = S.my_plan_vs_actual(A, {"tradeId": tid}, MON)
    t = row(got, "Target")
    assert t["planned"] is None and "Not in the plan" in t["text"]
    assert t["actual"] == 110.0                                    # the exit still shows
    r = row(got, "R")
    assert r["planned"] is None and "Not in the plan" in r["text"]
    assert r["actual"] is None and "0" not in r["text"]
    s = row(S.my_plan_vs_actual(A, {"tradeId": no_stop}, MON), "Stop")
    assert s["planned"] is None and "Not in the plan" in s["text"]


# ── Pre-market game plan ──────────────────────────────────────────────────────────────────────

def _wire(today="2026-10-26", **kw):
    snap = {"part": "wire", "capturedAt": "x", "missing": None, "detail": None,
            "headline": "Tech leads into earnings week.", "wireDate": today, "regime": "uptrend",
            "exposure": 80.0, "exposureAsOf": today}
    snap.update(kw)
    return snap


def _earn(bmo=(), amc_tonight=(), missing=None, as_of="2026-10-26"):
    return {"part": "earnings", "capturedAt": "x", "missing": missing, "detail": None,
            "asOf": as_of, "bmo": list(bmo), "amc": [], "amcTonight": list(amc_tonight)}


def _prep(monkeypatch, wire=None, earnings=None, raise_on=()):
    from api.services.journal_two import trader_blocks
    seen = []

    def fake(user_id, part, *, now=None, memo=None, on_spent="gap"):
        seen.append((user_id, part))
        if part in raise_on:
            raise RuntimeError(part)
        return wire if part == "wire" else earnings
    monkeypatch.setattr(trader_blocks, "prep_part", fake)
    return seen


def test_three_parts_fail_alone(S, monkeypatch):
    from api.services.journal_two import positions
    with _conn() as c:
        position(c, A, acc=None)
    _prep(monkeypatch, _wire(), _earn(bmo=["NVDA"]))
    whole = S.my_game_plan(A, {}, MON)
    assert whole["wire"]["headline"] and whole["reporting"]["names"] and whole["risk"]["openRisk"]
    for part in ("wire", "earnings"):
        _prep(monkeypatch, _wire(), _earn(bmo=["NVDA"]), raise_on=(part,))
        got = S.my_game_plan(A, {}, MON)
        key = "reporting" if part == "earnings" else "wire"
        assert got[key]["lines"] == [S.S_WIRE_UNREAD if part == "wire" else S.S_EARNINGS_UNREAD]
        others = [k for k in ("wire", "reporting", "risk") if k != key]
        for k in others:
            assert got[k] == whole[k], (part, k)
    _prep(monkeypatch, _wire(), _earn(bmo=["NVDA"]))
    monkeypatch.setattr(positions, "list_open_positions",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    got = S.my_game_plan(A, {}, MON)
    assert got["risk"]["lines"] == [S.S_RISK_UNREAD] and got["risk"]["openRisk"] is None
    assert got["wire"] == whole["wire"] and got["reporting"] == whole["reporting"]


def test_no_vendor_fetch(S, monkeypatch):
    from api.routers import live_prices
    from api.services import engine
    from api.services.cache import TTLCache, cache
    from api.services.journal_two import trader_blocks as tb
    calls: list[str] = []

    def door(name):
        def reached(*a, **k):
            calls.append(name)
            raise AssertionError(name)
        return reached
    monkeypatch.setattr(engine, "cache", TTLCache())
    monkeypatch.setattr(engine, "_load_state", lambda: {})
    monkeypatch.setattr(engine, "_load_wire_data", lambda: None)
    monkeypatch.setattr(engine, "get_earnings", door("engine.get_earnings"))
    fake = types.ModuleType("morning_wire_engine")
    fake.fetch_breadth = door("morning_wire_engine.fetch_breadth")
    monkeypatch.setitem(sys.modules, "morning_wire_engine", fake)
    for name in ("get_live_prices", "_fetch_snapshots", "_get_client", "_session_closes"):
        monkeypatch.setattr(live_prices, name, door(f"live_prices.{name}"))
    monkeypatch.setattr(cache, "get", lambda key, *a, **k: None)
    monkeypatch.setattr(tb, "_my_names", lambda uid: ["NVDA"])
    got = S.my_game_plan(A, {}, MON)
    assert calls == [], calls
    assert got["wire"]["lines"] == [S.S_WIRE_NOT_YET]
    assert got["reporting"]["lines"] == [S.S_EARNINGS_UNREAD]
    # CONTROL: the spy sees a vendor read when one is made.
    import morning_wire_engine
    with pytest.raises(AssertionError):
        morning_wire_engine.fetch_breadth()
    assert calls == ["morning_wire_engine.fetch_breadth"]


def test_reporting_empty_vs_unread_sentences(S, monkeypatch):
    _prep(monkeypatch, _wire(), _earn())
    got = S.my_game_plan(A, {}, MON)["reporting"]
    assert got["lines"] == ["None of your names report today."] and got["names"] == []
    _prep(monkeypatch, _wire(), _earn(missing="no_names"))
    assert S.my_game_plan(A, {}, MON)["reporting"]["lines"] == ["None of your names report today."]
    for miss in ("no_earnings_yet", "source_error"):
        _prep(monkeypatch, _wire(), _earn(missing=miss))
        got = S.my_game_plan(A, {}, MON)["reporting"]
        assert got["lines"] == ["Earnings dates couldn't be read right now."], miss
        assert got["names"] is None
    # A held read from another day is not today's answer.
    _prep(monkeypatch, _wire(), _earn(bmo=["NVDA"], as_of="2026-10-23"))
    assert S.my_game_plan(A, {}, MON)["reporting"]["lines"] == [S.S_EARNINGS_UNREAD]
    # Answered with names: at most 10, today's open first, then tonight's close.
    bmo = [f"B{i}" for i in range(8)]
    _prep(monkeypatch, _wire(), _earn(bmo=bmo, amc_tonight=["T1", "T2", "T3"]))
    got = S.my_game_plan(A, {}, MON)["reporting"]
    assert [n["symbol"] for n in got["names"]] == bmo + ["T1", "T2"]
    assert got["names"][0]["when"] == "before the open" and got["names"][-1]["when"] == "after the close"
    assert got["truncated"] == 1


def test_wire_not_published_today(S, monkeypatch):
    _prep(monkeypatch, _wire(today="2026-10-23"), _earn())
    got = S.my_game_plan(A, {}, MON)["wire"]
    assert got["lines"] == ["The morning wire has not published yet today."]
    assert got["headline"] is None and got["regime"] is None and got["exposure"] is None
    _prep(monkeypatch, _wire(missing="no_wire", headline=None, regime=None, exposure=None,
                             wireDate=None), _earn())
    assert S.my_game_plan(A, {}, MON)["wire"]["lines"] == [S.S_WIRE_NOT_YET]
    _prep(monkeypatch, _wire(), _earn())                                   # CONTROL
    got = S.my_game_plan(A, {}, MON)["wire"]
    assert got["headline"] == "Tech leads into earnings week." and got["exposure"] == 80.0


def test_no_open_positions_sentence(S, monkeypatch):
    _prep(monkeypatch, _wire(), _earn())
    got = S.my_game_plan(A, {}, MON)["risk"]
    assert got["lines"] == ["No open positions."]
    assert got["openPositions"] is None and got["openRisk"] is None and got["noStop"] is None
    # An open options trade alone is something open: never "No open positions."
    with _conn() as c:
        open_strategy(c, A, acc=None)
    got = S.my_game_plan(A, {}, MON)["risk"]
    assert "No open positions." not in got["lines"]
    assert any("open options trade" in ln for ln in got["lines"])


def test_open_risk_counts_unlinked_and_never_counts_a_placeholder(S, monkeypatch):
    """W10-R34: a position on no account is in the total; a placeholder stop is `noStop`, never
    zero risk. Positions are read ONCE for every account."""
    from api.services.journal_two import positions
    with _conn() as c:
        c.execute("INSERT INTO j2_accounts (id, user_id, name, color, starting_balance,"
                  " account_size, created_at, updated_at) VALUES ('acc1', ?, 'Main', '#fff',"
                  " 10000, 10000, ?, ?)", (A, STAMP, STAMP))
        position(c, A, acc="acc1", symbol="AAPL", entry=100.0, stop=98.0, shares=50)   # $100
        position(c, A, acc=None, symbol="TSLA", entry=200.0, stop=196.0, shares=100)   # $400
        position(c, A, acc="gone", symbol="MSFT", entry=50.0, stop=49.0, shares=10)    # $10
        position(c, A, acc="acc1", symbol="AMD", entry=80.0, stop=80.0, shares=10)     # none
    reads = []
    real = positions.list_open_positions

    def counted(*a, **k):
        reads.append((a, k))
        return real(*a, **k)
    monkeypatch.setattr(positions, "list_open_positions", counted)
    _prep(monkeypatch, _wire(), _earn())
    got = S.my_game_plan(A, {}, MON)["risk"]
    assert len(reads) == 1 and not reads[0][1].get("account_id")
    assert got["openPositions"] == 4
    assert got["openRisk"] == pytest.approx(510.0)
    assert got["noStop"] == 1 and got["unlinked"] == 2
    assert any("no stop set" in ln for ln in got["lines"])
    assert any("$510" in ln for ln in got["lines"])


def test_no_real_stop_is_not_zero_risk(S, monkeypatch):
    with _conn() as c:
        position(c, A, symbol="AMD", entry=80.0, stop=80.0)
    _prep(monkeypatch, _wire(), _earn())
    got = S.my_game_plan(A, {}, MON)["risk"]
    assert got["openRisk"] is None and got["noStop"] == 1
    no_zero_strings(got)


# ── Alerts that fired ─────────────────────────────────────────────────────────────────────────

#: Monday 2027-03-29 (after Good Friday 2027-03-26), 09:00 ET.
EASTER_MON = datetime(2027, 3, 29, 13, 0, tzinfo=timezone.utc)


def test_since_previous_session_close_after_good_friday(S):
    ind_fire(A, at=et_epoch("2027-03-25", "15:59"), sym="OLD")             # before Thursday's close
    ind_fire(A, at=et_epoch("2027-03-25", "16:00"), sym="EDGE")            # at the close: kept
    s7_fire(A, at=et_epoch("2027-03-26", "11:00"), sym="FRI")              # Good Friday: kept
    got = S.my_alerts_fired(A, {}, EASTER_MON)
    assert got["since"] == datetime(2027, 3, 25, 20, 0, tzinfo=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ")
    assert [r["symbol"] for r in got["rows"]] == ["FRI", "EDGE"]


def test_merges_both_logs_newest_first_cap_40(S):
    base = et_epoch("2026-10-23", "16:05")
    for i in range(30):
        ind_fire(A, at=base + i * 60, sym=f"I{i}")
    for i in range(30):
        s7_fire(A, at=base + i * 60 + 30, sym=f"S{i}",
                detail={"title": f"New 8-K — S{i}"} if i % 2 else None)
    got = S.my_alerts_fired(A, {}, MON)
    ats = [r["at"] for r in got["rows"]]
    assert len(got["rows"]) == 40 and ats == sorted(ats, reverse=True)
    assert got["rows"][0]["symbol"] == "S29" and got["rows"][1]["symbol"] == "I29"
    assert got["truncated"] == 20
    kinds = {r["kind"] for r in got["rows"]}
    assert kinds == {"indicator", "document-arrival"}
    assert got["rows"][0]["what"] == "New 8-K — S29"                       # the log's own text
    assert got["rows"][1]["what"] == "Alert fired"                         # none: the fallback
    assert any("40" in ln for ln in got["lines"])


def test_a_full_log_says_it_may_hold_more(S):
    """W10-R10: each log is read with limit=50; a full read inside the window may hold more."""
    base = et_epoch("2026-10-23", "16:05")
    for i in range(50):
        ind_fire(A, at=base + i, sym=f"I{i}")
    got = S.my_alerts_fired(A, {}, MON)
    assert got["capped"] is True and S.S_ALERTS_MORE in got["lines"]
    # CONTROL: 49 fires is a complete read.
    with _conn() as c:
        c.execute("DELETE FROM indicator_alert_fires WHERE sym = 'I0'")
    got = S.my_alerts_fired(A, {}, MON)
    assert "capped" not in got and S.S_ALERTS_MORE not in got["lines"]


def test_never_reads_user_alerts(S, monkeypatch):
    from api.services import auth_db
    ind_fire(A, at=et_epoch("2026-10-23", "16:30"))
    s7_fire(A, at=et_epoch("2026-10-23", "16:40"))
    with _conn() as c:
        c.execute("CREATE TABLE IF NOT EXISTS user_alerts (id INTEGER PRIMARY KEY, user_id TEXT)")
        c.execute("INSERT INTO user_alerts (user_id) VALUES (?)", (A,))
    seen: list[str] = []
    real = sqlite3.connect

    def traced(*a, **k):
        conn = real(*a, **k)
        conn.set_trace_callback(seen.append)
        return conn
    monkeypatch.setattr(sqlite3, "connect", traced)
    got = S.my_alerts_fired(A, {}, MON)
    assert len(got["rows"]) == 2
    assert any("indicator_alert_fires" in s for s in seen)                # the trace saw the reads
    assert any("alert_fires" in s and "alert_predicates" in s for s in seen)
    assert not [s for s in seen if "user_alerts" in s]
    # CONTROL: the trace does see a user_alerts statement when one is made.
    c = sqlite3.connect(auth_db._DB_PATH)
    try:
        c.execute("SELECT COUNT(*) FROM user_alerts").fetchone()
    finally:
        c.close()
    assert [s for s in seen if "user_alerts" in s]


def test_one_log_unreadable_shows_the_other(S, monkeypatch):
    from api.services import alert_fired_log as afl
    from api.services.alert_taxonomy import receipts
    ind_fire(A, at=et_epoch("2026-10-23", "16:30"), sym="IND")
    s7_fire(A, at=et_epoch("2026-10-23", "16:40"), sym="SEV")
    boom = lambda *a, **k: (_ for _ in ()).throw(sqlite3.OperationalError("locked"))  # noqa: E731
    real_list = afl.list_fires
    monkeypatch.setattr(afl, "list_fires", boom)
    got = S.my_alerts_fired(A, {}, MON)
    assert [r["symbol"] for r in got["rows"]] == ["SEV"]
    assert "Some alerts couldn't be read right now." in got["lines"]
    monkeypatch.setattr(afl, "list_fires", real_list)
    monkeypatch.setattr(receipts, "list_fires_for_feed", boom)
    got = S.my_alerts_fired(A, {}, MON)
    assert [r["symbol"] for r in got["rows"]] == ["IND"]
    assert "Some alerts couldn't be read right now." in got["lines"]
    # Both unreadable: never "No alerts fired".
    monkeypatch.setattr(afl, "list_fires", boom)
    got = S.my_alerts_fired(A, {}, MON)
    assert got["rows"] == [] and got["lines"] == ["Some alerts couldn't be read right now."]


def test_empty_sentence(S):
    ind_fire(A, at=et_epoch("2026-10-23", "10:00"))                        # before the window
    got = S.my_alerts_fired(A, {}, MON)
    assert got["rows"] == [] and got["lines"] == ["No alerts fired since the last session."]
    no_zero_strings(got)


# ── every builder ─────────────────────────────────────────────────────────────────────────────

def test_brand_new_member_no_zero_strings(S, monkeypatch):
    _prep(monkeypatch, _wire(missing="no_wire", headline=None, regime=None, exposure=None,
                             wireDate=None), _earn(missing="no_names"))
    for kind, fn in S.BUILDERS.items():
        params = {"tradeId": "t-none"} if kind == S.KIND_PLAN_VS_ACTUAL else {}
        got = fn("u-brand-new", params, MON)
        assert got["lines"], kind
        assert got["asOf"] and got["source"] in ("broker", "manual", "mixed")
        no_zero_strings(got)


def test_params_shape(S):
    from api.services.journal_two import shelf_discipline
    assert S.ParamError is shelf_discipline.ParamError                     # one class
    assert S.PARAMS == {S.KIND_PLAN_VS_ACTUAL: ("tradeId",), S.KIND_GAME_PLAN: (),
                        S.KIND_ALERTS_FIRED: ()}
    assert S.clean_params(S.KIND_PLAN_VS_ACTUAL, {"tradeId": "t1", "x": 1}) == {"tradeId": "t1"}
    assert S.clean_params(S.KIND_PLAN_VS_ACTUAL, {"tradeId": 5}) == {}
    assert S.clean_params(S.KIND_GAME_PLAN, {"anything": 1}) == {}
    assert S.clean_params(S.KIND_ALERTS_FIRED, None) == {}
    with pytest.raises(S.ParamError):
        S.clean_params("nope", {})
    assert S.TITLES == {S.KIND_PLAN_VS_ACTUAL: "Plan vs actual",
                        S.KIND_GAME_PLAN: "Pre-market game plan",
                        S.KIND_ALERTS_FIRED: "Alerts that fired"}
    assert (S.KIND_PLAN_VS_ACTUAL, S.KIND_GAME_PLAN, S.KIND_ALERTS_FIRED) == (
        "myPlanVsActual", "myGamePlan", "myAlertsFired")
