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
    # member_interest reads <DATA_DIR>/auth.db, the same file in production.
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from api.services.journal_two import plan_grading
    monkeypatch.setenv(plan_grading.FLAG, "1")
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
    # A name reports today, so the names check (asked only for an empty answer, and reading the
    # member's names through member_interest) does not run: every read counted here is the risk's.
    _prep(monkeypatch, _wire(), _earn(bmo=["NVDA"]))
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
    assert got["rows"][1]["what"] == "RSI above its alert level (71.0)"    # composed, no threshold
    assert got["rows"][2]["what"] == "Alert fired"                         # S7, no detail: fallback
    assert any("40" in ln for ln in got["lines"])


def test_a_full_log_says_it_may_hold_more(S):
    """W10-R10: each log is read with limit=50; a full read inside the window may hold more."""
    base = et_epoch("2026-10-23", "16:05")
    for i in range(50):
        ind_fire(A, at=base + i, sym=f"I{i}")
    got = S.my_alerts_fired(A, {}, MON)
    assert got["capped"] is True
    assert got["lines"][0] == "Showing the newest 40 of at least 50 alerts since the last session."
    # CONTROL: 49 fires is a complete read.
    with _conn() as c:
        c.execute("DELETE FROM indicator_alert_fires WHERE sym = 'I0'")
    got = S.my_alerts_fired(A, {}, MON)
    assert "capped" not in got
    assert got["lines"][0] == "Showing the newest 40 of 49 alerts since the last session."


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


# ── fix round 1 ───────────────────────────────────────────────────────────────────────────────

def test_plan_grading_off_reads_not_available_right_now(S, monkeypatch):
    """W10-R38: with plan grading off, Plan vs actual reads nothing and says so."""
    from api.services.journal_two import plan_grading
    with _conn() as c:
        tid = trade(c, A, r=1.0)
        link(c, A, tid, {"entry": 100.0, "stop": 95.0, "target": 110.0})
    real_get = plan_grading.get_trade
    monkeypatch.delenv(plan_grading.FLAG, raising=False)
    monkeypatch.setattr(plan_grading, "get_trade",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("read a trade")))
    got = S.my_plan_vs_actual(A, {"tradeId": tid}, MON)
    assert got["lines"] == ["Not available right now."] and got["rows"] == []
    assert got["available"] is False
    # CONTROL: the switch on, the same trade is laid out.
    monkeypatch.setattr(plan_grading, "get_trade", real_get)
    monkeypatch.setenv(plan_grading.FLAG, "1")
    assert S.my_plan_vs_actual(A, {"tradeId": tid}, MON)["rows"]


def test_alert_rows_read_real_text(S):
    """W10-R37 (probe p15): each row in the log's own words; "Alert fired" only for a fire the
    log says nothing about."""
    from api.services import alert_fired_log as afl
    assert afl.record_fire(9_000_001, A, "NVDA", "rsi", "above", "D", "ep:p15", 71.0,
                           threshold=70.0, fired_at=et_epoch("2026-10-26", "07:00"))
    s7_fire(A, at=et_epoch("2026-10-26", "06:00"), sym="AAPL",
            detail={"ticker": "AAPL", "form": "8-K", "filed": "2026-10-26", "company": "Apple Inc."})
    s7_fire(A, at=et_epoch("2026-10-26", "05:00"), sym="MSFT", trigger="rating-change",
            detail={"ticker": "MSFT", "action": "upgrade", "company": "Goldman",
                    "from_grade": "Hold", "to_grade": "Buy", "date": "2026-10-26"})
    s7_fire(A, at=et_epoch("2026-10-26", "04:00"), sym="AMD")                    # no detail
    rows = S.my_alerts_fired(A, {}, MON)["rows"]
    assert [r["what"] for r in rows] == [
        "RSI above 70 (71.0)",
        "Apple Inc. filed a 8-K on 2026-10-26.",
        "Goldman upgraded MSFT (Hold to Buy) on 2026-10-26.",
        "Alert fired",
    ]
    assert [r["kind"] for r in rows] == ["indicator", "document-arrival", "rating-change",
                                         "document-arrival"]


def test_a_shape_that_raises_falls_back(S, monkeypatch):
    from api.services.alert_taxonomy import document_arrival
    monkeypatch.setattr(document_arrival, "alert_shape_for_fire",
                        lambda f: (_ for _ in ()).throw(KeyError("id")))
    s7_fire(A, at=et_epoch("2026-10-26", "06:00"), sym="AAPL",
            detail={"ticker": "AAPL", "form": "8-K", "title": "New 8-K — AAPL"})
    assert S.my_alerts_fired(A, {}, MON)["rows"][0]["what"] == "New 8-K — AAPL"


def test_indicator_text_words_every_condition(S):
    from api.services import alert_fired_log as afl
    for cond in afl.CONDITION_KIND:                        # derived, never retyped
        txt = S._indicator_text({"indicator": "rsi", "condition": cond, "value": 12.5,
                                 "threshold": 0.0})
        assert txt.startswith("RSI ") and "_" not in txt, txt
        assert not any(f in txt for f in FORBIDDEN), txt
    assert S._indicator_text({"indicator": "macd", "condition": "cross_zero", "value": 0.4,
                              "threshold": 0.0}) == "MACD crossed zero (0.4)"
    assert S._indicator_text({"indicator": "macd", "condition": "above", "value": 1.2,
                              "threshold": 0.0}) == "MACD above zero (1.2)"
    assert S._indicator_text({"indicator": "bb", "condition": "touch_upper", "value": 184.234,
                              "threshold": 180.0}) == "BB touched the upper band (184.23)"
    assert S._indicator_text({"indicator": "", "condition": "above"}) == "Alert fired"


def test_alerts_capped_count_says_at_least(S):
    base = et_epoch("2026-10-23", "16:05")
    for i in range(50):
        ind_fire(A, at=base + i, sym=f"I{i}")
        s7_fire(A, at=base + 100 + i, sym=f"S{i}")
    got = S.my_alerts_fired(A, {}, MON)
    assert got["lines"][0] == "Showing the newest 40 of at least 100 alerts since the last session."


# -- one authority for open risk (I-3) --------------------------------------------------------

def _book(c, shape):
    from tests.test_shelf_discipline import account
    if shape == "p7":
        account(c, A, "lim", pct=5.0, size=10000.0, name="Limited")
        account(c, A, "nolim", pct=None, size=10000.0, name="NoLimit")
        account(c, A, "nosize", pct=5.0, size=0.0, marked=0, name="NoSize")
        position(c, A, acc="lim", symbol="AAPL", entry=100, stop=95, shares=10)
        position(c, A, acc="nolim", symbol="MSFT", entry=100, stop=90, shares=10)
        position(c, A, acc="nosize", symbol="AMD", entry=50, stop=48, shares=100)
        position(c, A, acc=None, symbol="TSLA", entry=200, stop=190, shares=5)
        position(c, A, acc="gone", symbol="META", entry=300, stop=290, shares=3)
        position(c, A, acc="lim", symbol="NVDA", entry=100, stop=100, shares=10)
        open_strategy(c, A, acc="lim")
    elif shape == "p8":
        position(c, A, symbol="AAPL", entry=100, stop=100, shares=10)
        position(c, A, symbol="MSFT", entry=100, stop=100, shares=10)
    elif shape == "p9":
        position(c, A, symbol="AAPL", entry=100, stop=95, shares=10)
        position(c, A, symbol="", entry=100, stop=90, shares=100)
    elif shape == "p10":
        position(c, A, symbol="AAPL", entry=100, stop=95, shares=10)
    elif shape == "p11":
        position(c, A, symbol="AAPL", entry=1.00, stop=0.99, shares=40)


@pytest.mark.parametrize("shape,expect", [("p7", 430.0), ("p8", None), ("p9", 50.0),
                                          ("p10", None), ("p11", 0.4)])
def test_game_plan_risk_reconciles_with_risk_left_today(S, monkeypatch, shape, expect):
    from api.services import portfolio_heat
    from api.services.journal_two import shelf_discipline as D
    with _conn() as c:
        _book(c, shape)
    if shape == "p10":
        monkeypatch.setattr(portfolio_heat, "portfolio_heat", lambda *a, **k: {"ok": False})
    _prep(monkeypatch, _wire(), _earn(bmo=["NVDA"]))
    g = S.my_game_plan(A, {}, MON)["risk"]
    d = D.my_risk_left_today(A, {}, MON)
    if expect is None:
        assert g["openRisk"] is None and d["openRisk"] is None
    else:
        assert g["openRisk"] == pytest.approx(expect) and d["openRisk"] == pytest.approx(expect)
    if shape == "p7":       # every account block speaks through the same authority
        from api.services.journal_two import positions as j2_positions
        held = j2_positions.list_open_positions(A)
        for b in d["accounts"]:
            if b["accountId"] in ("lim", "nolim", "nosize"):
                mine = [p for p in held if p.get("accountId") == b["accountId"]]
                own = D.open_risk(A, mine, open_options=b["openOptions"], anything_open=True)
                assert own["risk"] == b["openRisk"], b["accountId"]
                assert all(ln in b["lines"] for ln in own["lines"]), (b["accountId"], b["lines"])
    if shape != "p7":       # one group: the unlinked block IS the same positions, the same words
        block = next(b for b in d["accounts"] if b["accountId"] is None)
        assert g["riskLines"] == block["lines"]
        assert [ln for ln in g["lines"] if ln in g["riskLines"]] == g["riskLines"]
    if shape == "p9":
        assert any("couldn't be read" in ln for ln in g["lines"])
        assert any("couldn't be read" in ln for ln in d["lines"])
    if shape == "p10":
        assert S.S_RISK_UNREAD in g["lines"] and S.S_RISK_UNREAD in d["lines"]
    if shape == "p11":
        assert "Open risk to stops: under $1." in g["lines"]
        assert "Open risk to stops: under $1." in block["lines"]


def test_positions_overflow_is_said_in_both(S, monkeypatch):
    """M8: the open positions read keeps READ_LIMIT - 1 and an overflow is said in both widgets."""
    from api.services.journal_two import shelf_discipline as D
    monkeypatch.setattr(D, "READ_LIMIT", 3)
    with _conn() as c:
        for sym in ("AAPL", "AMD", "MSFT"):
            position(c, A, symbol=sym, entry=100, stop=99, shares=10)
    _prep(monkeypatch, _wire(), _earn(bmo=["NVDA"]))
    g = S.my_game_plan(A, {}, MON)["risk"]
    d = D.my_risk_left_today(A, {}, MON)
    line = D.positions_capped_line()
    assert g["capped"] is True and g["openPositions"] == 2 and line in g["lines"]
    assert d["positionsCapped"] is True and line in d["lines"]
    # CONTROL: under the cap nothing is said.
    monkeypatch.setattr(D, "READ_LIMIT", 4)
    assert "capped" not in S.my_game_plan(A, {}, MON)["risk"]
    assert "positionsCapped" not in D.my_risk_left_today(A, {}, MON)


def test_risk_left_total_says_and_1_other(S):
    """M9 (10.10's total line): one block past the named few is "and 1 other"."""
    from api.services.journal_two import shelf_discipline as D
    from tests.test_shelf_discipline import account
    with _conn() as c:
        for i, stop in enumerate((90, 91, 92, 93)):
            account(c, A, f"a{i}", pct=None, size=10000.0, name=f"Acct{i}")
            position(c, A, acc=f"a{i}", symbol=f"S{i}", entry=100, stop=stop, shares=10)
    total = D.my_risk_left_today(A, {}, MON)["lines"][-1]
    assert total.endswith(", and 1 other).") and "others" not in total, total


# -- reporting (M3, M7) -----------------------------------------------------------------------

def test_names_unread_never_reads_none_of_your_names(S, monkeypatch, tmp_path):
    """M3: names that could not be read are said so, never "None of your names report today"."""
    from api.services.journal_two import positions
    _prep(monkeypatch, _wire(), _earn(missing="no_names"))
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "no-such-dir"))           # every source fails
    got = S.my_game_plan(A, {}, MON)["reporting"]
    assert got["lines"] == ["Your names couldn't be read right now."] and got["names"] is None
    # Partial: the watchlist reads, positions do not.
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    _prep(monkeypatch, _wire(), _earn())
    with _conn() as c:
        c.execute("INSERT INTO users (id, email, password_hash, display_name, role)"
                  " VALUES (?, 'a@example.test', 'x', 'x', 'member')", (A,))
        c.execute("INSERT INTO watchlists (id, user_id, name) VALUES ('w1', ?, 'Mine')", (A,))
        c.execute("INSERT INTO watchlist_items (id, watchlist_id, sym) VALUES ('i1', 'w1', 'AMD')")
    monkeypatch.setattr(positions, "list_open_positions",
                        lambda *a, **k: (_ for _ in ()).throw(sqlite3.OperationalError("x")))
    got = S.my_game_plan(A, {}, MON)["reporting"]
    assert got["lines"] == ["Some of your names couldn't be read right now. None of the others "
                            "report today."]


def test_names_read_and_none_report_is_the_plain_sentence(S, monkeypatch):
    _prep(monkeypatch, _wire(), _earn(missing="no_names"))
    got = S.my_game_plan(A, {}, MON)["reporting"]
    assert got["lines"] == ["None of your names report today."]


def test_member_interest_says_which_sources_failed(S, monkeypatch):
    from api.services import member_interest
    from api.services.journal_two import positions
    assert member_interest.interest_for(A)["failed"] == []                  # CONTROL
    monkeypatch.setattr(positions, "list_open_positions",
                        lambda *a, **k: (_ for _ in ()).throw(sqlite3.OperationalError("x")))
    got = member_interest.interest_for(A)
    assert got["failed"] == ["positions"] and got["by_source"]["positions"] == set()


def test_last_night_reporters_listed_apart(S, monkeypatch):
    """W10-R39: last night's after-close reporters, at most 10, apart from today's."""
    snap = _earn(bmo=["NVDA"])
    snap["amc"] = [f"L{i}" for i in range(12)]
    _prep(monkeypatch, _wire(), snap)
    got = S.my_game_plan(A, {}, MON)["reporting"]
    assert [n["symbol"] for n in got["names"]] == ["NVDA"]
    assert got["lastNight"] == [f"L{i}" for i in range(10)] and got["lastNightTruncated"] == 2
    assert got["lines"] == ["NVDA reports before the open.",
                            "Reported last night: " + ", ".join(f"L{i}" for i in range(10))
                            + ", and 2 others."]
    # Only last night: today's sentence comes first, then last night's.
    _prep(monkeypatch, _wire(), dict(_earn(), amc=["AMD"]))
    got = S.my_game_plan(A, {}, MON)["reporting"]
    assert got["lines"] == ["None of your names report today.", "Reported last night: AMD."]


# -- Plan vs actual (M4, M5, M6) --------------------------------------------------------------

def _excursion(c, uid, tid, *, mfe=None, true_r=None):
    from api.services.journal_two.trade_refs import trade_ref_for_row
    r = c.execute("SELECT * FROM j2_trades WHERE id = ?", (tid,)).fetchone()
    c.execute("INSERT INTO j2_trade_excursions (user_id, trade_ref, symbol, mfe_price, computed_at,"
              " true_r) VALUES (?, ?, ?, ?, ?, ?)",
              (uid, trade_ref_for_row(r), r["symbol"], mfe, STAMP, true_r))


def test_target_state_from_mfe_and_never_unknown(S):
    with _conn() as c:
        reached = trade(c, A, entry=100.0, exit_=104.0, stop=96.0, r=1.0)
        link(c, A, reached, {"entry": 100.0, "stop": 96.0, "target": 110.0})
        _excursion(c, A, reached, mfe=111.0)
        none = trade(c, A, entry=100.0, exit_=104.0, stop=96.0, r=1.0, symbol="AMD")
        link(c, A, none, {"entry": 100.0, "stop": 96.0, "target": 110.0})
    assert row(S.my_plan_vs_actual(A, {"tradeId": reached}, MON), "Target")["state"] == \
        "reached_not_taken"
    assert row(S.my_plan_vs_actual(A, {"tradeId": none}, MON), "Target")["state"] is None


def test_true_r_is_labelled(S):
    with _conn() as c:
        tid = trade(c, A, r=None)
        link(c, A, tid, {"entry": 100.0, "stop": 96.0, "target": 110.0})
        _excursion(c, A, tid, true_r=1.4)
        own = trade(c, A, r=1.4, symbol="AMD")
        link(c, A, own, {"entry": 100.0, "stop": 96.0, "target": 110.0})
    r = row(S.my_plan_vs_actual(A, {"tradeId": tid}, MON), "R")
    assert r["actual"] == 1.4 and "realized 1.4R (true R)" in r["text"]
    r2 = row(S.my_plan_vs_actual(A, {"tradeId": own}, MON), "R")       # CONTROL: stop R, no label
    assert "realized 1.4R." in r2["text"] and "true R" not in r2["text"]


def test_every_row_line_is_labelled(S):
    with _conn() as c:
        tid = trade(c, A, r=1.0)
        link(c, A, tid, {"entry": 100.0, "stop": 96.0, "target": 110.0})
    got = S.my_plan_vs_actual(A, {"tradeId": tid}, MON)
    assert [ln.split(":")[0] for ln in got["lines"]] == ["Entry", "Stop", "Target", "R"]
