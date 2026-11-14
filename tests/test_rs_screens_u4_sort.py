"""RS screens unit U4, part C: one secondary sort key (``spec.sort.then``).

RS New Highs lists the newest RS high first; dozens of names share "today", and with one
sort key they came out in ticker order. ``sort: {key, dir, then: {key, dir}}`` orders the
ties by a second column, before the ticker tie-break that keeps paging stable.

Why each rail exists:
  * absent, the statement must be the one it is today, byte for byte (every saved screen
    and every other caller sends no ``then``);
  * the second key reaches SQL through the same door as the first, so it gets the same
    refusals: an unknown column, a column this pod's table does not hold yet;
  * a direction that is not a direction is refused, never read as "descending".
"""
from __future__ import annotations

import pytest

from api.services.screener import query, snapshot_db

#: The statements `build_scan_sql` renders TODAY for a sorted and a default scan, frozen
#: before this unit touched the function.
TODAY_SORTED = ('SELECT * FROM screener_rows WHERE "price" >= ? '
                'ORDER BY "rs_rank" DESC NULLS LAST, "ticker" ASC LIMIT ? OFFSET ?')
TODAY_DEFAULT = ('SELECT * FROM screener_rows '
                 'ORDER BY "uct_composite" DESC NULLS LAST, "ticker" ASC LIMIT ? OFFSET ?')


@pytest.fixture
def table(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    snapshot_db.init_db()
    rows = [
        # ticker, age of the RS high, score: three share age 0, two share age 1
        ("ZED", 0, 1.9), ("ABC", 0, 1.2), ("MID", 0, 1.5),
        ("OLD", 1, 1.1), ("TOP", 1, 2.5),
        ("TIE1", 2, 1.0), ("TIE0", 2, 1.0),             # equal on both keys: the ticker decides
        ("NOSCORE", 0, None), ("NOAGE", None, 3.0),
    ]
    snapshot_db.upsert_rows([{"ticker": t, "price": 20.0, "rs_nh_bars_ago": a,
                              "rs_rating_score": s, "rs_rank": 50,
                              "snapshot_date": "2026-11-13", "built_at": 1}
                             for t, a, s in rows])
    monkeypatch.setattr(query, "stale_gate", lambda conn: None)
    return rows


def _sql(spec):
    return query.build_scan_sql(spec)["sql"]


def _order(spec):
    return [r["ticker"] for r in query.run_scan(spec)["rows"]]


THEN = {"key": "rs_nh_bars_ago", "dir": "asc", "then": {"key": "rs_rating_score", "dir": "desc"}}


# ───────────────────────── absent = today ─────────────────────────

def test_without_then_the_statement_is_todays_byte_for_byte(table):
    spec = {"filters": [{"key": "price", "op": "gte", "min": 10}],
            "sort": {"key": "rs_rank", "dir": "desc"}}
    assert _sql(spec) == TODAY_SORTED
    assert _sql({}) == TODAY_DEFAULT
    assert _sql({"sort": None}) == TODAY_DEFAULT
    # an explicit null is "no second key", the same statement
    assert _sql({**spec, "sort": {"key": "rs_rank", "dir": "desc", "then": None}}) == TODAY_SORTED


# ───────────────────────── the SQL and the rows ─────────────────────────

def test_the_second_key_sits_after_the_first_and_before_the_ticker(table):
    assert _sql({"sort": THEN}) == (
        'SELECT * FROM screener_rows ORDER BY "rs_nh_bars_ago" ASC NULLS LAST, '
        '"rs_rating_score" DESC NULLS LAST, "ticker" ASC LIMIT ? OFFSET ?')
    # its own direction, independent of the first key's
    flipped = {"key": "rs_nh_bars_ago", "dir": "desc", "then": {"key": "rs_rating_score", "dir": "asc"}}
    assert '"rs_nh_bars_ago" DESC NULLS LAST, "rs_rating_score" ASC NULLS LAST, "ticker" ASC' in _sql({"sort": flipped})
    # a missing direction is descending, as it is for the first key
    assert '"rs_rating_score" DESC NULLS LAST' in _sql(
        {"sort": {"key": "rs_nh_bars_ago", "dir": "asc", "then": {"key": "rs_rating_score"}}})


def test_ties_on_the_first_key_are_ordered_by_the_second_then_the_ticker(table):
    assert _order({"sort": THEN}) == [
        "ZED", "MID", "ABC", "NOSCORE",          # age 0: score 1.9, 1.5, 1.2, then no score
        "TOP", "OLD",                            # age 1: 2.5, 1.1
        "TIE0", "TIE1",                          # age 2, equal scores: ticker A first
        "NOAGE"]                                 # no age sorts last whatever its score
    # control: without the second key the ties are in ticker order
    assert _order({"sort": {"key": "rs_nh_bars_ago", "dir": "asc"}})[:4] == ["ABC", "MID", "NOSCORE", "ZED"]


def test_two_pages_cover_every_row_once(table):
    seen = []
    for page in (1, 2, 3):
        seen += _order({"sort": THEN, "page": page, "page_size": 4})
    assert seen == _order({"sort": THEN}) and len(set(seen)) == 9


def test_an_explicit_column_request_fetches_both_sort_columns(table):
    out = query.run_scan({"columns": ["price"], "sort": THEN})
    assert out["view_columns"] == ["ticker", "price", "rs_nh_bars_ago", "rs_rating_score"]
    assert out["rows"][0] == {"ticker": "ZED", "price": 20.0, "rs_nh_bars_ago": 0, "rs_rating_score": 1.9}


def test_a_second_key_equal_to_ticker_or_to_the_first_adds_no_duplicate(table):
    by_ticker = {"key": "rs_nh_bars_ago", "dir": "asc", "then": {"key": "ticker", "dir": "desc"}}
    assert _sql({"sort": by_ticker}).endswith(
        'ORDER BY "rs_nh_bars_ago" ASC NULLS LAST, "ticker" DESC NULLS LAST LIMIT ? OFFSET ?')
    assert _order({"sort": by_ticker})[:4] == ["ZED", "NOSCORE", "MID", "ABC"]
    same = {"key": "rs_nh_bars_ago", "dir": "asc", "then": {"key": "rs_nh_bars_ago", "dir": "desc"}}
    assert _sql({"sort": same}) == _sql({"sort": {"key": "rs_nh_bars_ago", "dir": "asc"}})


# ───────────────────────── the refusals ─────────────────────────

def _then(value):
    return {"sort": {"key": "rs_nh_bars_ago", "dir": "asc", "then": value}}


def test_the_second_key_is_validated_like_the_first(table, monkeypatch):
    with pytest.raises(ValueError, match="unknown sort key: not_a_column"):
        query.run_scan(_then({"key": "not_a_column", "dir": "desc"}))
    with pytest.raises(ValueError, match="unknown sort key"):
        query.run_scan(_then({"key": 'ticker"; DROP TABLE screener_rows; --'}))
    with pytest.raises(ValueError, match="unknown sort key"):
        query.run_scan(_then({"dir": "desc"}))              # a second key with no key
    # declared, but this pod's table does not hold it yet: refused by name, never a
    # silent no-op (the first key's own rule, `_readiness_refusal`)
    known = set(query._known_columns()) - {"rs_rating_score"}
    monkeypatch.setattr(query, "_known_columns", lambda conn=None: frozenset(known))
    with pytest.raises(ValueError) as e:
        query.run_scan(_then({"key": "rs_rating_score", "dir": "desc"}))
    assert "unknown sort key" not in str(e.value) and str(e.value)


@pytest.mark.parametrize("bad", ["up", "ASC", "", 1, "descending"])
def test_a_direction_that_is_not_one_is_refused(table, bad):
    with pytest.raises(ValueError, match="sort direction"):
        query.run_scan(_then({"key": "rs_rating_score", "dir": bad}))


@pytest.mark.parametrize("bad", ["rs_rating_score", ["rs_rating_score"], 7,
                                 {"key": "rs_rating_score", "then": {"key": "price"}}])
def test_then_is_one_key_in_one_object(table, bad):
    with pytest.raises(ValueError, match="second sort key"):
        query.run_scan(_then(bad))


def test_a_ranked_screen_still_orders_by_its_rank_and_still_checks_the_spec(table):
    """A rank owns the order (the Leaders screen), so `sort` is not applied; a malformed
    second key is refused all the same rather than ignored."""
    ranked = {"rank": {"criteria": [{"key": "rs_rating_score", "weight": 1}], "top_n": 3},
              "sort": THEN}
    assert "rs_nh_bars_ago" not in _sql(ranked).split("ORDER BY")[1]
    assert _order(ranked) == ["NOAGE", "TOP", "ZED"]
    with pytest.raises(ValueError, match="unknown sort key"):
        query.run_scan({**ranked, "sort": {**THEN, "then": {"key": "nope"}}})


# ───────────────────────── the route carries it ─────────────────────────

def test_the_scan_route_carries_then_through_and_answers_400_on_a_bad_one(table, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import screener as screener_mod
    paid = {"id": "u1", "role": "member", "plan": "pro"}
    app = FastAPI()
    app.include_router(screener_mod.router)
    app.dependency_overrides[get_current_user] = lambda: dict(paid)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(paid)
    client = TestClient(app)
    r = client.post("/api/screener/scan", json={"sort": THEN, "columns": ["price"]})
    assert r.status_code == 200, r.text[:300]
    assert [x["ticker"] for x in r.json()["rows"]][:3] == ["ZED", "MID", "ABC"]
    r = client.post("/api/screener/scan", json=_then({"key": "nope"}))
    assert r.status_code == 400 and "unknown sort key" in r.text
