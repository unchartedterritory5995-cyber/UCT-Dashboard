"""RS screens unit U6 (integration), part 3: the five screens, end to end.

The server half and the client half were each tested against their own idea of the other.
This module runs the whole chain once, with nothing of the feature stubbed:

    synthetic daily bars  (tests/rs_screens_e2e_universe.py, about sixty tickers)
      -> the real nightly build        `snapshot_builder.run_build`
      -> the real rating post-pass     `rs_post_pass.run`, once per stored session
      -> the real scan route           `POST /api/screener/scan`, through the test client

and it asks the route exactly what the member's browser asks. The request bodies are NOT
written here: `tests/fixtures/rs_screens_scan_requests.json` is captured from the mounted
Focus page by `app/src/pages/screener/focus/__tests__/rsScanRequests.test.jsx` (each of
the five screens as it opens, and with each quick-control option chosen), so the columns,
the clause shapes and the sort are the client's own.

What is asserted for every one of those requests:
  * HTTP 200 (a column or a clause the server does not have is a 400);
  * every row carries every column the request named, typed as the client reads it;
  * the rows are exactly the ones an independent reading of the clauses selects from the
    table, in the declared order, second sort key included (the oracle below is written
    from the contract, not from `query.py`);
and, once: the flag-off application serves none of it.

The first rows each screen answers with are kept in `tests/fixtures/rs_screens_rows.json`
(refresh with ``UPDATE_RS_SCREENS_GOLDEN=1``), which the client's tests then read
(`rsServedRows.test.jsx`): the client's row, caption, tag and header code runs on what the
route really sent.

Only the build's outside sources are stubbed (bars, fundamentals, the hourly rank map, the
market joins): the same seams `tests/test_rs_screens_u4_build.py` uses.
"""
from __future__ import annotations

import json
import math
import os
import re
from contextlib import closing
from pathlib import Path

import pytest

from api.services.screener import filters, rs_columns, rs_post_pass, rs_setup, snapshot_db
from tests import rs_screens_e2e_universe as market

FIXTURES = Path(__file__).resolve().parent / "fixtures"
REQUESTS = FIXTURES / "rs_screens_scan_requests.json"
ROWS_GOLDEN = FIXTURES / "rs_screens_rows.json"
STARTERS_GOLDEN = FIXTURES / "rs_screens_starters.json"

FIVE = ("starter_rs_top_rating", "starter_rs_new_high", "starter_rs_nh_before_price",
        "starter_rs_leaders", "starter_rs_exit_warning_5")
LIST_SCREENS = FIVE[:4]
#: Rows of each screen's opening answer kept for the client's tests.
ROWS_KEPT = 8
#: The 23 columns that exist only for the RS screens (`filters.RS_SCREENS_KEYS`).
RS_COLUMNS = tuple(filters.RS_SCREENS_KEYS)

# ── what the client reads off a row, and how (app/src/pages/screener/focus/rsRows.js) ──
#: `=== 1` in the client: a JSON `true` would not be 1.
INT_01 = ("rs_tight", "rs_near_buy")
#: `typeof v === 'number'`, printed as whole numbers.
INTS = ("rs_rating_pos", "rs_rating_pos_n", "rs_rating_pos_prev20", "rs_rating_prev20",
        "rs_rating_chg_5", "rs_rating_chg_20", "rs_pos_1m", "rs_pos_3m", "rs_pos_6m", "rs_pos_12m",
        "rs_nh_bars_ago", "rs_nh_red_bars_ago", "rs_nhbp_age", "rs_exit_bars_ago")
FLOATS = ("price", "chg_pct_1d", "px_below_high_pct", "rs_rating_score", "pct_vs_sma200",
          "pct_vs_sma50", "dist_52w_high_pct", "adr_pct", "dollar_vol_30d", "market_cap")
ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ───────────────────────── the application, built once ─────────────────────────

def _stub_sources(mp, b, universe, series, final_ratings):
    """The build's OUTSIDE sources. Everything the RS screens add runs for real."""
    from api.services.screener import context_joins as cj
    mp.setattr(b, "_load_universe", lambda: list(universe))
    mp.setattr(b, "_read_daily_bars", lambda t: list(series.get(t, [])))
    mp.setattr(b, "_read_ratings", lambda t, failures=None: {})
    mp.setattr(b, "_read_fundamentals",
               lambda t, price=None, failures=None: market.fundamentals(t, universe))
    # the hourly rank map: the same number as the nightly rating, as on a pod with
    # RS_RANK_IBD_ENABLED on (the lead number on a row is then the rating the places follow)
    mp.setattr(b, "_read_rs_map", lambda: {t: {"rs_rank": r["ibd"]} for t, r in final_ratings.items()
                                           if r["ibd"] is not None})
    mp.setattr(b, "_read_bulk_fundamentals", lambda targets, failures=None: {})
    mp.setattr(b, "_security_types", lambda: market.types(universe))
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        mp.setattr(cj, fn, lambda targets, failures=None: {})


def _build(mp, tmp_path, *, screens_on):
    """Run the nightly build and the rating job's post-pass chain into a fresh database.
    Returns the build's stats."""
    from api.services.screener import membership, rs_history
    from api.services.screener import snapshot_builder as b
    from api.services.signature import registry_defs
    mp.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    mp.setattr(registry_defs, "RS_V2_ENABLED", True)
    mp.setenv("RS_RANK_IBD_ENABLED", "1")
    if screens_on:
        mp.setenv("RS_SCREENS_ENABLED", "1")
    else:
        mp.delenv("RS_SCREENS_ENABLED", raising=False)
    series = market.series()
    universe = [t for t in series if t not in ("SPY", "RSP")]
    history = market.rating_history(series)
    _stub_sources(mp, b, universe, series, history[market.SESSION])
    snapshot_db.init_db()
    for session in market.RATED_SESSIONS:
        rs_history.store_rows(session, history[session])
    stats = b.run_build()
    assert stats["built"] == len(universe) and stats["errors"] == 0, stats
    # the 04:15 ET rating job's pass, once per stored session in order, so "a month ago"
    # reads a real earlier ranking (off, each call returns before it opens the database)
    passes = [rs_post_pass.run(session, source="rating") for session in market.RATED_SESSIONS]
    membership._CURRENT.clear()
    return {"stats": stats, "passes": passes, "universe": universe}


def _client(mp):
    """The screener router behind the test client, signed in as a paid member the way
    `tests/test_rs_screens_u4_starters.py` does."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import screener as screener_mod
    from api.services.screener import distribution
    mp.setattr(screener_mod.scr_saved, "list_for", lambda uid: [])
    mp.setattr(filters, "_rs_history_on", lambda: True)
    distribution.invalidate()
    paid = {"id": "u1", "role": "member", "plan": "pro"}
    app = FastAPI()
    app.include_router(screener_mod.router)
    app.dependency_overrides[get_current_user] = lambda: dict(paid)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(paid)
    return TestClient(app)


@pytest.fixture(scope="module")
def on(tmp_path_factory):
    """The application with the screens on: built once for the module."""
    mp = pytest.MonkeyPatch()
    try:
        built = _build(mp, tmp_path_factory.mktemp("rs_e2e_on"), screens_on=True)
        with closing(snapshot_db.connect()) as conn:
            table = [dict(r) for r in conn.execute("SELECT * FROM screener_rows ORDER BY ticker")]
        yield {**built, "client": _client(mp), "table": {r["ticker"]: r for r in table}}
    finally:
        mp.undo()


def _requests():
    doc = json.loads(REQUESTS.read_text(encoding="utf-8"))
    return doc["requests"]


def _starters():
    return {s["id"]: s for s in json.loads(STARTERS_GOLDEN.read_text(encoding="utf-8"))}


def _place_column(req):
    """The column the client numbers this request's rows by: the chosen option's own
    (`place`) when it names one, else the screen's (`row.place`); None for a screen with
    no place column or one numbered by position."""
    st = _starters()[req["starter"]]
    for cid, oid in req["choices"].items():
        control = next(c for c in st["controls"] if c["id"] == cid)
        option = next(o for o in control["options"] if o["id"] == oid)
        if option.get("place"):
            return option["place"]
    own = st["row"]["place"]
    return None if own in (None, "index") else own


def _req_id(r):
    choice = "+".join(f"{c}={o}" for c, o in r["choices"].items()) or "as it opens"
    return f"{r['starter'].replace('starter_rs_', '')}: {choice}"


# ───────────────────────── the oracle (written from the contract) ─────────────────────────

def _passes(row, clause) -> bool:
    """One clause, as CONTRACT-SCREENS.md states the operators. A blank value fails every
    comparison and PASSES an exclude list (the stocks-only and no-buyout clauses)."""
    v, op = row.get(clause["key"]), clause["op"]
    if op == "not_in":
        return v is None or v not in clause["values"]
    if v is None:
        return False
    if op == "gte":
        return v >= clause["min"]
    if op == "gt":
        return v > clause["min"]
    if op == "lte":
        return v <= clause["max"]
    if op == "lt":
        return v < clause["max"]
    if op == "between":
        return clause["min"] <= v <= clause["max"]
    if op == "eq":
        return v == clause["value"]
    if op == "in":
        return v in clause["values"]
    raise AssertionError(f"the oracle does not know {op}")


def _expected(table, body) -> list:
    """The tickers a request should answer with, in order: the rows that pass every clause,
    by the rank when there is one (highest score first, the top N), else by the sort key,
    then the second key, blanks last, then the ticker."""
    rows = [r for r in table.values() if all(_passes(r, f) for f in body["filters"])]
    rank = body.get("rank")
    if rank:
        (crit,) = rank["criteria"]
        rows = [r for r in rows if r.get(crit["key"]) is not None]
        rows.sort(key=lambda r: (-r[crit["key"]], r["ticker"]))
        return [r["ticker"] for r in rows[:rank["top_n"]]]
    sort = body["sort"]
    keys = [(sort["key"], sort["dir"])] + ([(sort["then"]["key"], sort["then"]["dir"])]
                                           if sort.get("then") else [])

    def order(r):
        parts = []
        for key, direction in keys:
            v = r.get(key)
            parts.append((1, 0) if v is None else (0, v if direction == "asc" else -v))
        return (*parts, r["ticker"])
    return [r["ticker"] for r in sorted(rows, key=order)]


def _scan(on, body):
    return on["client"].post("/api/screener/scan", json=body)


# ───────────────────────── the build really wrote the feature ─────────────────────────

def test_the_build_and_the_pass_filled_the_columns_the_screens_read(on):
    last = on["passes"][-1]
    assert last["ok"] and last["rewritten"] and last["rating_session"] == market.SESSION, last
    assert last["prev20_session"] == market.RATED_SESSIONS[0], "a month ago is the first stored session"
    table = on["table"]
    assert len(table) == len(on["universe"]) >= 55
    filled = {c: sum(1 for r in table.values() if r[c] is not None) for c in RS_COLUMNS}
    assert not [c for c, n in filled.items() if n == 0], f"never written: {filled}"
    # the places are 1..n with no gap and no tie, and every placed row says the same n
    placed = sorted(r["rs_rating_pos"] for r in table.values() if r["rs_rating_pos"] is not None)
    assert placed == list(range(1, len(placed) + 1)) and len(placed) >= 40
    assert {r["rs_rating_pos_n"] for r in table.values() if r["rs_rating_pos"] is not None} == {len(placed)}
    assert {r["rs_rating_session"] for r in table.values()} - {None} == {market.SESSION}
    # every setup and every flag the client has words for is in the table at least once
    assert {r["rs_setup"] for r in table.values()} - {None} == set(rs_setup.SETUPS)
    assert {r["rs_flag"] for r in table.values()} - {None} == set(rs_setup.FLAGS)
    assert {r["rs_tight"] for r in table.values()} >= {0, 1}
    assert {r["rs_exit_last"] for r in table.values()} - {None} == set(rs_columns.EXIT_NAMES)
    # the rows a screen must leave out are really there to be left out
    assert table["DEAL"]["rs_flag"] == "buyout_pending" and table["DEAL"]["rs_rating_pos"] is not None
    assert table["FUND"]["security_type"] == "ETF" and table["FUND"]["rs_rating_pos"] is None
    assert table["THIN"]["dollar_vol_30d"] < 20_000_000 and table["PENNY"]["price"] < 10
    # under a year of bars: rated, no overall place, a place on the 1- and 3-month boards
    newi = table["NEWI"]
    assert newi["rs_rating_pos"] is None and newi["rs_pos_1m"] and newi["rs_pos_3m"]
    assert newi["rs_flag"] == "new_issue" and type(newi["rs_rank"]) is int
    # forty bars: on the 1-month board BEFORE it has any rating (the 63-day term is required)
    baby = table["BABY"]
    assert baby["rs_pos_1m"] and baby["rs_rank"] is None and baby["rs_rating_ibd"] is None
    assert baby["rs_pos_3m"] is None and baby["rs_rating_pos"] is None


def test_the_measures_agree_with_each_other_the_way_the_client_assumes(on):
    """Three readings the client makes of two columns at once (`rsRows.js` TAGS):
    "Before price" trusts that a before-price age is the age of the newest RS high;
    "Market down day" compares the down-day age with the newest age for equality."""
    seen = {"nhbp": 0, "down": 0, "not_down": 0}
    for t, r in on["table"].items():
        if r["rs_nhbp_age"] is not None:
            assert r["rs_nhbp_age"] == r["rs_nh_bars_ago"], t
            assert r["px_below_high_pct"] is not None and r["px_below_high_pct"] < 0, t
            seen["nhbp"] += 1
        if r["rs_nh_red_bars_ago"] is not None:
            assert r["rs_nh_bars_ago"] is not None and r["rs_nh_red_bars_ago"] >= r["rs_nh_bars_ago"], t
            seen["down" if r["rs_nh_red_bars_ago"] == r["rs_nh_bars_ago"] else "not_down"] += 1
        if r["px_below_high_pct"] is not None:
            assert r["px_below_high_pct"] <= 0 and math.copysign(1, r["px_below_high_pct"] or 0.0) in (1, -1)
            assert str(r["px_below_high_pct"]) != "-0.0", t
        if r["rs_near_buy"] == 1:
            assert r["rs_setup"] not in rs_setup.NOT_BUY_POINT_SETUPS, t
    assert min(seen.values()) >= 1, seen


# ───────────────────────── every request the client makes ─────────────────────────

def test_the_captured_requests_cover_every_screen_and_every_option():
    """The capture is the client's; this says it is complete against the SERVER's payload,
    so an option added on the server without a captured request fails here."""
    served = json.loads(STARTERS_GOLDEN.read_text(encoding="utf-8"))
    want = {(s["id"], ()) for s in served}
    want |= {(s["id"], ((c["id"], o["id"]),)) for s in served for c in s["controls"]
             for o in c["options"] if not o.get("default")}
    have = {(r["starter"], tuple(sorted(r["choices"].items()))) for r in _requests()}
    assert want - have == set(), sorted(want - have)
    assert have - want == set(), sorted(have - want)


@pytest.mark.parametrize("req", _requests(), ids=_req_id)
def test_each_request_the_client_makes_is_answered_and_ordered_as_declared(on, req):
    body = req["body"]
    r = _scan(on, body)
    assert r.status_code == 200, r.text[:300]
    out = r.json()
    rows = out["rows"]
    # 1. every column the client asked for is on every row
    for row in rows:
        missing = [c for c in body["columns"] if c not in row]
        assert not missing, (row["ticker"], missing)
    # 2. typed as the client reads them
    for row in rows:
        for c in INT_01:
            if c in row:
                assert row[c] is None or (type(row[c]) is int and row[c] in (0, 1)), (row["ticker"], c, row[c])
        for c in INTS:
            if c in row:
                assert row[c] is None or type(row[c]) is int, (row["ticker"], c, row[c])
        for c in FLOATS:
            if c in row:
                assert row[c] is None or (type(row[c]) in (int, float) and math.isfinite(row[c])), (row["ticker"], c)
        # the lead number: a whole number, or blank for a listing too young to be rated
        # (the client then prints no lead number: rsRows.leadOf)
        assert row["rs_rank"] is None or type(row["rs_rank"]) is int, row["ticker"]
        if row["rs_rank"] is None:
            assert row["ticker"] in UNRATED, row["ticker"]
        assert row.get("rs_rating_session") is None or ISO_DAY.match(row["rs_rating_session"]), row["ticker"]
        assert row.get("rs_setup") in (None, *rs_setup.SETUPS), row["ticker"]
        if "rs_flag" in row:
            assert row["rs_flag"] in (None, *rs_setup.FLAGS), row["ticker"]
    # 3. exactly the rows the clauses select, in the declared order
    want = _expected(on["table"], body)
    assert [row["ticker"] for row in rows] == want
    assert out["page"] == 1 and len(rows) <= body["page_size"]
    if not body.get("rank"):
        assert out["total"] == len(want)
        # the sort columns ride on the row, so the client can show why the order is what it is
        sort = body["sort"]
        for row in rows:
            assert sort["key"] in row and (not sort.get("then") or sort["then"]["key"] in row)
    # 4. the place numeral the client prints: on a list ordered by a place, the numbers
    #    climb down the list (a gap is a name the screen left out, never a step back)
    col = _place_column(req)
    if col is not None:
        assert col in body["columns"], f"the client did not ask for {col}"
        if body["sort"]["key"] == col:
            places = [row[col] for row in rows]
            assert all(type(v) is int and v >= 1 for v in places), places
            assert places == sorted(set(places)), f"{col} does not climb down the list"
    # 5. the four lists never show a fund, a thin or cheap stock, or a buyout name
    tickers = {row["ticker"] for row in rows}
    assert not (tickers & {"FUND", "THIN", "PENNY", "TINY"}), tickers
    if req["starter"] in LIST_SCREENS:
        assert "DEAL" not in tickers
    assert out["view"] == body["view"]


def test_no_screen_opens_empty_and_few_options_do(on):
    """The test above would pass on a table nothing matched. This says the market reaches
    every screen as it opens, and names the options that are honestly empty on it."""
    empty = []
    for req in _requests():
        n = len(_scan(on, req["body"]).json()["rows"])
        if not req["choices"]:
            assert n >= 3, (req["starter"], n)
        elif n == 0:
            empty.append(_req_id(req))
    assert empty == EMPTY_OPTIONS, empty


#: Options that select nothing on this market, each for a stated reason.
EMPTY_OPTIONS: list = []
#: Rows a screen may list with NO RS number: listed under 64 sessions ago, so the rating
#: job has no 63-day term to score them on. Only the 1-month board can reach one.
UNRATED = {"BABY"}


def test_a_second_sort_key_really_orders_the_ties(on):
    """RS New Highs is "newest RS high first, then strongest rating". Many names share an
    age here, so the second key decides most of the order; with it removed the same rows
    come back in another order."""
    body = next(r["body"] for r in _requests() if r["starter"] == "starter_rs_new_high" and not r["choices"])
    assert body["sort"] == {"key": "rs_nh_bars_ago", "dir": "asc",
                            "then": {"key": "rs_rating_score", "dir": "desc"}}
    rows = _scan(on, body).json()["rows"]
    ages = [r["rs_nh_bars_ago"] for r in rows]
    assert ages == sorted(ages) and len(set(ages)) < len(ages), "no two rows share an age"
    for age in set(ages):
        scores = [r["rs_rating_score"] for r in rows if r["rs_nh_bars_ago"] == age]
        known = [s for s in scores if s is not None]
        assert known == sorted(known, reverse=True), age
        assert scores[:len(known)] == known, "a blank score sorts last inside its age"
    bare = {**body, "sort": {"key": "rs_nh_bars_ago", "dir": "asc"}}
    other = [r["ticker"] for r in _scan(on, bare).json()["rows"]]
    assert sorted(other) == sorted(r["ticker"] for r in rows) and other != [r["ticker"] for r in rows]


def test_a_malformed_second_key_is_refused_through_the_route(on):
    body = next(r["body"] for r in _requests() if r["starter"] == "starter_rs_new_high" and not r["choices"])
    for then in ({"key": "not_a_column", "dir": "asc"}, {"key": "rs_rating_score", "dir": "sideways"}):
        r = _scan(on, {**body, "sort": {**body["sort"], "then": then}})
        assert r.status_code == 400, (then, r.status_code)


# ───────────────────────── the rows the client's tests read ─────────────────────────

def _close(a, b) -> bool:
    if isinstance(a, float) or isinstance(b, float):
        return (a is not None and b is not None and type(a) in (int, float) and type(b) in (int, float)
                and math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-6))
    return a == b


def test_the_rows_each_screen_opens_on_match_the_golden(on):
    """The first rows of each screen's opening answer, exactly as the route sent them,
    kept for the client (`rsServedRows.test.jsx` runs the row, caption, tag and header
    code on them). Whole numbers and words must match exactly; a float is compared to
    nine places, so a platform's last bit cannot red this."""
    served = {"about": ("Captured by tests/test_rs_screens_u6_e2e.py (UPDATE_RS_SCREENS_GOLDEN=1 "
                        "rewrites): POST /api/screener/scan answered the client's own requests "
                        "(rs_screens_scan_requests.json) over the synthetic market of "
                        "tests/rs_screens_e2e_universe.py. Read by rsServedRows.test.jsx."),
              "session": market.SESSION, "screens": {}}
    for req in _requests():
        if req["choices"]:
            continue
        out = _scan(on, req["body"]).json()
        served["screens"][req["starter"]] = {"total": out["total"], "view": out["view"],
                                             "rows": out["rows"][:ROWS_KEPT]}
    assert list(served["screens"]) == list(FIVE)
    # Top RS Rating on its 1-month board: the rows are numbered by another column there,
    # and one of them (BABY, listed forty sessions ago) has no RS number at all
    m1 = _scan(on, next(r["body"] for r in _requests() if r["choices"] == {"rank_by": "m1"})).json()
    unrated = [r for r in m1["rows"] if r["rs_rank"] is None]
    kept = m1["rows"][:ROWS_KEPT] + [r for r in unrated if r not in m1["rows"][:ROWS_KEPT]]
    served["top_rating_one_month"] = {"total": m1["total"], "view": m1["view"], "rows": kept}
    assert [r["ticker"] for r in unrated] == sorted(UNRATED)
    if os.environ.get("UPDATE_RS_SCREENS_GOLDEN") == "1":
        ROWS_GOLDEN.write_text(json.dumps(served, indent=1) + "\n", encoding="utf-8", newline="\n")
    golden = json.loads(ROWS_GOLDEN.read_text(encoding="utf-8"))
    assert golden["session"] == served["session"] and list(golden["screens"]) == list(FIVE)
    pairs = [(sid, golden["screens"][sid], served["screens"][sid]) for sid in FIVE]
    pairs.append(("top_rating_one_month", golden["top_rating_one_month"], served["top_rating_one_month"]))
    for sid, want, got in pairs:
        assert (want["total"], want["view"]) == (got["total"], got["view"]), sid
        assert [r["ticker"] for r in want["rows"]] == [r["ticker"] for r in got["rows"]], sid
        for a, b in zip(want["rows"], got["rows"]):
            assert list(a) == list(b), (sid, a["ticker"])
            diff = [k for k in a if not _close(a[k], b[k])]
            assert not diff, (sid, a["ticker"], {k: (a[k], b[k]) for k in diff})


# ───────────────────────── around the scan: what else the page asks ─────────────────────────

def test_the_page_s_other_reads_serve_the_five(on):
    client = on["client"]
    starters = client.get("/api/screener/saved-screens").json()["starters"]
    by = {s["id"]: s for s in starters}
    assert [by[i] for i in FIVE] == json.loads(STARTERS_GOLDEN.read_text(encoding="utf-8"))
    meta = client.get("/api/screener/meta").json()
    keys = {f["key"] for f in meta["filters"]}
    assert set(RS_COLUMNS) <= keys
    views = {v["key"]: v["columns"] for v in meta["views"]}
    assert set(filters.RS_SCREENS_VIEWS) <= set(views)
    doc = client.get("/api/screener/methodology").json()
    assert [s["id"] for s in doc["rs_screens"]["screens"]] == list(FIVE)
    # each screen counts what it lists (the menu's numbers and the Filters drawer's button)
    for req in _requests():
        if req["choices"]:
            continue
        body = req["body"]
        spec = {k: body[k] for k in ("filters", "sort", "view", "rank") if k in body}
        r = client.post("/api/screener/count", json=spec)
        assert r.status_code == 200, r.text[:200]
        listed = len(_scan(on, body).json()["rows"])
        count = r.json()["count"]
        assert (min(count, body["rank"]["top_n"]) if body.get("rank") else count) == listed, req["starter"]


# ───────────────────────── flag off: none of it ─────────────────────────

def test_the_flag_off_application_serves_none_of_it(tmp_path):
    """The same market, the same build, RS_SCREENS_ENABLED unset (production today). The
    starters are today's, no key, view or method page of the feature is served, the build
    wrote none of the 23 columns and the pass left no table behind."""
    mp = pytest.MonkeyPatch()
    try:
        built = _build(mp, tmp_path, screens_on=False)
        assert all(p["enabled"] is False and p["reason"] == "disabled" for p in built["passes"])
        assert "rs_post_pass" not in built["stats"]
        with closing(snapshot_db.connect()) as conn:
            rows = [dict(r) for r in conn.execute(f"SELECT ticker, {', '.join(RS_COLUMNS)} FROM screener_rows")]
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            ten = conn.execute(f"SELECT COUNT({rs_columns.COLUMNS[0]}) FROM screener_rows").fetchone()[0]
        assert len(rows) == len(built["universe"])
        assert not [(r["ticker"], c) for r in rows for c in RS_COLUMNS if r[c] is not None]
        assert not ({rs_post_pass.POS_TABLE, rs_post_pass.RUNS_TABLE} & tables)
        assert ten > 0, "control: the RS_V2 columns were written, so the build itself ran"

        client = _client(mp)
        starters = client.get("/api/screener/saved-screens").json()["starters"]
        ids = [s["id"] for s in starters]
        assert "starter_rs_top_rating" not in ids and "starter_rs_leaders" not in ids
        for s in starters:
            assert not ({"controls", "row", "empty", "hidden"} & set(s)), s["id"]
            assert "then" not in (s["spec"].get("sort") or {}), s["id"]
            assert not [f for f in s["spec"]["filters"] if f["key"] in RS_COLUMNS], s["id"]
        by = {s["id"]: s for s in starters}
        assert by["starter_rs_new_high"]["name"] == "RS new highs (52-week)"
        meta = client.get("/api/screener/meta").json()
        assert not ({f["key"] for f in meta["filters"]} & set(RS_COLUMNS))
        assert not ({v["key"] for v in meta["views"]} & set(filters.RS_SCREENS_VIEWS))
        assert not [c for v in meta["views"] for c in v["columns"] if c in RS_COLUMNS]
        assert "rs_screens" not in client.get("/api/screener/methodology").json()
        # a screen the on-flag client would open finds nothing to list: the place is blank
        top = next(r["body"] for r in _requests() if r["starter"] == "starter_rs_top_rating" and not r["choices"])
        out = client.post("/api/screener/scan", json=top)
        assert out.status_code == 200 and out.json()["rows"] == [] and out.json()["total"] == 0
    finally:
        mp.undo()


def test_a_listing_too_young_to_be_rated_is_on_the_one_month_board_with_no_rs_number(on):
    """Found by this test: the 1-month board needs only a 21-bar return, and the RS Rating
    needs 63 bars. So "Rank by: 1M" can list a stock whose `rs_rank` is blank, and the
    row's lead number ("RS 97") has nothing to print. The client leaves it blank; this
    keeps the case on the market so both halves keep meeting it."""
    req = next(r for r in _requests() if r["choices"] == {"rank_by": "m1"})
    rows = _scan(on, req["body"]).json()["rows"]
    baby = next(r for r in rows if r["ticker"] == "BABY")
    assert baby["rs_rank"] is None and type(baby["rs_pos_1m"]) is int
    assert baby["rs_rating_pos"] is None and baby["rs_rating_session"] == market.SESSION
    # and no other board lists it
    for r in _requests():
        if r["choices"] != {"rank_by": "m1"}:
            assert "BABY" not in {x["ticker"] for x in _scan(on, r["body"]).json()["rows"]}, _req_id(r)
