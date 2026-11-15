"""RS screens unit U8, item D3: one stock's screener row, by ticker.

"Why isn't a stock here?" in the Focus screener names a ticker; the page asks
``GET /api/screener/row/{ticker}?columns=...`` for that one row and checks the open
screen's rules against it. The scan route's own ticker scope (``{key: "tickers"}``,
FT-029 v2) is dark behind its own flag, so it cannot serve this.

Why each rail exists:
  * the route answers one stock's stored numbers, so it is PAID like the scan it sits
    beside, and it does not exist at all while ``RS_SCREENS_ENABLED`` is off;
  * ``columns`` is the only free text that reaches the statement: every name is checked
    against the schema before any SQL exists, and a ticker is only ever a bound parameter;
  * a row whose own bars stopped is left out of every scan (the stale-row gate). Served
    bare, the page would say "passes every rule" of a stock that can never be on the list;
  * a ticker the Screener does not hold is a 404 with the member-facing sentence.

Hermetic: a ``screener.db`` in ``tmp_path``.
"""
from __future__ import annotations

import inspect

import pytest

from api.services.screener import query, snapshot_db

NO_SUCH = "No such stock in the Screener."


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    monkeypatch.setenv("RS_SCREENS_ENABLED", "1")
    snapshot_db.init_db()
    query._STALE_GATE_MEMO = None
    yield
    query._STALE_GATE_MEMO = None


def _row(ticker, **kw):
    return {"ticker": ticker, "price": 50.0, "rs_rank": 80, "security_type": "Stock",
            "snapshot_date": "2026-11-13", "built_at": 1, "bars_asof": "20261113", **kw}


def _table(*rows):
    snapshot_db.upsert_rows(list(rows))


# ───────────────────────── the tickers a request names ─────────────────────────

def test_tickers_are_upper_cased_deduped_and_kept_in_order():
    assert query.row_tickers("nvda") == ["NVDA"]
    assert query.row_tickers(" nvda, AMD,nvda ,brk.b,BF-B,3M ") == ["NVDA", "AMD", "BRK.B", "BF-B", "3M"]


@pytest.mark.parametrize("raw", ["", "   ", ",,", None, "NV DA", "NVDA;DROP TABLE x", "../etc", ".B", "-B",
                                 "ABCDEFGHIJKLM", "<script>", "NVDA'--", "NVDA\"", "%"])
def test_a_name_that_cannot_be_a_ticker_names_no_row(raw):
    assert query.row_tickers(raw) == []


# ───────────────────────── the reader ─────────────────────────

def test_one_row_with_the_columns_asked_for_and_the_ticker_first():
    _table(_row("NVDA", price=140.5, rs_rank=97, rs_setup="at_pivot"), _row("AMD", rs_rank=74))
    got = query.rows_for(["NVDA"], ["rs_rank", "price", "rs_setup", "rs_flag"])
    assert got == {"NVDA": {"row": {"ticker": "NVDA", "rs_rank": 97, "price": 140.5,
                                    "rs_setup": "at_pivot", "rs_flag": None}, "stale": False}}
    assert list(got["NVDA"]["row"]) == ["ticker", "rs_rank", "price", "rs_setup", "rs_flag"]


def test_a_ticker_with_no_row_is_absent_never_an_empty_row():
    _table(_row("NVDA"))
    assert query.rows_for(["ZZZZ"], ["price"]) == {}
    assert set(query.rows_for(["NVDA", "ZZZZ"], ["price"])) == {"NVDA"}
    assert query.rows_for([], ["price"]) == {}


def test_a_lower_case_stored_ticker_and_a_repeated_column_are_read_once():
    _table(_row("NVDA"))
    got = query.rows_for(["nvda", "NVDA"], ["price", "price", "ticker"])
    assert list(got) == ["NVDA"] and list(got["NVDA"]["row"]) == ["ticker", "price"]


def test_a_column_the_schema_does_not_declare_is_refused_by_name_before_any_row_is_read():
    _table(_row("NVDA"))
    for bad in ("password", "price; DROP TABLE screener_rows", "price, ticker", '"price"', "users.email", "*"):
        with pytest.raises(ValueError, match="unknown columns"):
            query.rows_for(["NVDA"], ["price", bad])
    # the same refusal for a ticker that has no row: the columns are checked first
    with pytest.raises(ValueError, match="unknown columns: nope"):
        query.rows_for(["ZZZZ"], ["nope"])
    with pytest.raises(ValueError, match="unknown columns: nope"):
        query.rows_for([], ["nope"])
    assert query.rows_for(["NVDA"], ["price"])["NVDA"]["row"]["price"] == 50.0, "the table is untouched"


def test_a_declared_column_this_pod_does_not_carry_yet_is_the_readiness_refusal(monkeypatch):
    _table(_row("NVDA"))
    monkeypatch.setattr(query, "_known_columns", lambda conn=None: frozenset({"ticker", "price"}))
    with pytest.raises(ValueError) as e:
        query.rows_for(["NVDA"], ["rs_rank"])
    assert "unknown columns" not in str(e.value)
    assert str(e.value) == str(query._readiness_refusal(query._member_label("rs_rank")))


def test_at_most_twenty_five_tickers_in_one_request():
    assert query.MAX_ROW_TICKERS == 25
    _table(*[_row(f"T{i}") for i in range(30)])
    assert len(query.rows_for([f"T{i}" for i in range(25)], ["price"])) == 25
    with pytest.raises(ValueError, match="at most 25 tickers"):
        query.rows_for([f"T{i}" for i in range(26)], ["price"])


def test_a_row_whose_bars_stopped_is_marked_stale_and_its_neighbours_are_not():
    """The scan leaves such a row out (`stale_gate`); the page must be able to say so."""
    _table(_row("NVDA"), _row("AMD"), _row("OLD", bars_asof="20260801"), _row("BLANK", bars_asof=None))
    assert query.stale_gate(snapshot_db.connect()) is not None, "the gate bites on this table"
    got = query.rows_for(["NVDA", "OLD", "BLANK"], ["price"])
    assert {t: v["stale"] for t, v in got.items()} == {"NVDA": False, "OLD": True, "BLANK": False}
    # and it is the scan's own verdict: OLD is in no scan, the others are
    scanned = {r["ticker"] for r in query.run_scan({"filters": [], "columns": ["price"], "page_size": 50})["rows"]}
    assert scanned == {"NVDA", "AMD", "BLANK"}


def test_no_row_is_stale_when_none_is_behind():
    _table(_row("NVDA"), _row("AMD"))
    assert query.stale_gate(snapshot_db.connect()) is None
    assert query.rows_for(["NVDA"], ["price"])["NVDA"]["stale"] is False


def test_the_reader_takes_no_spec_so_nothing_can_widen_it():
    params = list(inspect.signature(query.rows_for).parameters)
    assert params == ["tickers", "columns", "user"]
    src = inspect.getsource(query.rows_for)
    assert "build_where" not in src and "spec" not in src.replace("specific", "")


# ───────────────────────── the route ─────────────────────────

def _client(user="paid"):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import screener as screener_mod
    app = FastAPI()
    app.include_router(screener_mod.router)
    if user == "paid":
        who = {"id": "u1", "role": "member", "plan": "pro"}
        app.dependency_overrides[get_current_user] = lambda: dict(who)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    elif user == "free":
        who = {"id": "u2", "role": "member", "plan": "free"}
        app.dependency_overrides[get_current_user] = lambda: dict(who)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(who)
    return TestClient(app)


def test_the_route_serves_one_row_to_a_paid_member():
    _table(_row("NVDA", price=140.5, rs_rank=97), _row("OLD", bars_asof="20260801"))
    r = _client().get("/api/screener/row/nvda", params={"columns": "rs_rank,price"})
    assert r.status_code == 200, r.text[:200]
    assert r.json() == {"ticker": "NVDA", "row": {"ticker": "NVDA", "rs_rank": 97, "price": 140.5}, "stale": False}
    assert _client().get("/api/screener/row/OLD", params={"columns": "price"}).json()["stale"] is True
    # no columns asked: the ticker alone (the stock exists)
    assert _client().get("/api/screener/row/NVDA").json()["row"] == {"ticker": "NVDA"}


def test_the_route_carries_the_paid_gate():
    from api.routers import screener as r
    sig = inspect.signature(r.screener_row)
    assert sig.parameters["user"].default.dependency is r.require_paid
    _table(_row("NVDA"))
    assert _client(user="free").get("/api/screener/row/NVDA").status_code in (402, 403)
    assert _client(user=None).get("/api/screener/row/NVDA").status_code in (401, 403)


def test_a_ticker_the_screener_does_not_hold_is_a_404_with_the_member_s_sentence():
    _table(_row("NVDA"))
    for name in ("ZZZZ", "NV DA", "NVDA;DROP", ".B", "ABCDEFGHIJKLM"):
        r = _client().get(f"/api/screener/row/{name}", params={"columns": "price"})
        assert r.status_code == 404 and r.json()["detail"] == NO_SUCH, name


def test_a_column_outside_the_registry_is_a_400_that_names_it():
    _table(_row("NVDA"))
    r = _client().get("/api/screener/row/NVDA", params={"columns": "price,password"})
    assert r.status_code == 400 and r.json()["detail"] == "unknown columns: password"
    r = _client().get("/api/screener/row/NVDA", params={"columns": "price; DROP TABLE screener_rows"})
    assert r.status_code == 400 and "unknown columns" in r.json()["detail"]
    # the columns are judged before the ticker: a bad column is a 400 even for an unknown stock
    assert _client().get("/api/screener/row/ZZZZ", params={"columns": "nope"}).status_code == 400
    assert _client().get("/api/screener/row/NVDA", params={"columns": "price"}).status_code == 200


def test_a_value_json_cannot_carry_is_a_blank_never_a_500():
    import sqlite3
    _table(_row("NVDA"))
    with sqlite3.connect(snapshot_db.get_db_path()) as conn:
        conn.execute("UPDATE screener_rows SET price = ? WHERE ticker = 'NVDA'", (float("inf"),))
    r = _client().get("/api/screener/row/NVDA", params={"columns": "price"})
    assert r.status_code == 200 and r.json()["row"]["price"] is None


def test_the_route_does_not_exist_while_the_screens_are_off(monkeypatch):
    _table(_row("NVDA"))
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    called = []
    monkeypatch.setattr(query, "rows_for", lambda *a, **k: called.append(a) or {})
    r = _client().get("/api/screener/row/NVDA", params={"columns": "price"})
    assert r.status_code == 404 and r.json()["detail"] == "Not Found"
    assert called == [], "a dark route read the table"
