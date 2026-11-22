"""A filter sent without its operand is a 400 with a sentence, never a 500.

`query.build_where` read `f["min"]` / `f["max"]` / `f["value"]` straight off the
request, and the routes catch only `ValueError`, so
`{"key": "rs_rank", "op": "gte", "value": 90}` (the wrong operand name) raised a
`KeyError` and answered "Internal Server Error". `filters.OP_OPERANDS` already
said what each op reads; nothing checked it.

Every case here goes through the real routes (`/api/screener/scan`, `/count`,
`/count/batch`) with the real query module and a real snapshot table. The gate's
dependencies are overridden, never the gate, the way
tests/test_screener_count_batch.py does it.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.routers import screener as screener_mod
from api.services.screener import filters as scr_filters
from api.services.screener import query as scr_query

PAID = {"id": "u1", "role": "member", "plan": "pro"}

#: One live filter per control type, so each op is exercised on a key that accepts it.
KEY_BY_TYPE = {"range": "rs_rank", "enum": "sector", "bool": "optionable"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.setattr(scr_query, "_COUNT_CACHE", None)
    import api.services.screener.snapshot_db as db
    db.init_db()
    db.upsert_rows([
        {"ticker": "AAA", "rs_rank": 95, "price": 10.0, "sector": "Tech",
         "security_type": "Stock", "optionable": 1, "gross_margin": 60.0,
         "op_margin": 20.0, "snapshot_date": "2026-11-13", "built_at": 1},
        {"ticker": "BBB", "rs_rank": 40, "price": 20.0, "sector": "Energy",
         "security_type": "ETF", "optionable": 0, "gross_margin": 10.0,
         "op_margin": 30.0, "snapshot_date": "2026-11-13", "built_at": 1},
    ])
    app = FastAPI()
    app.include_router(screener_mod.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
    # A raised KeyError must show up as the 500 a member would get, not as a
    # Python traceback in the test: the assertion below is about the status.
    return TestClient(app, raise_server_exceptions=False)


def _refused(client, flt, sentence):
    for url in ("/api/screener/scan", "/api/screener/count"):
        r = client.post(url, json={"filters": [flt]})
        assert r.status_code == 400, (url, flt, r.status_code, r.text[:200])
        assert r.json()["detail"] == sentence, (url, flt, r.json())
    r = client.post("/api/screener/count/batch", json={"specs": [{"filters": [flt]}]})
    assert r.status_code == 200, r.text[:200]
    assert r.json()["counts"] == [{"error": sentence}], (flt, r.json())


# (filter as sent, the sentence the member reads)
CASES = [
    # the report that started this: the right op, the wrong operand name
    ({"key": "rs_rank", "op": "gte", "value": 90}, 'RS Rank: "at least" needs a number.'),
    ({"key": "rs_rank", "op": "gte"}, 'RS Rank: "at least" needs a number.'),
    ({"key": "rs_rank", "op": "gte", "min": None}, 'RS Rank: "at least" needs a number.'),
    ({"key": "rs_rank", "op": "gt", "max": 90}, 'RS Rank: "above" needs a number.'),
    ({"key": "rs_rank", "op": "lte", "min": 90}, 'RS Rank: "at most" needs a number.'),
    ({"key": "rs_rank", "op": "lt", "max": None}, 'RS Rank: "below" needs a number.'),
    ({"key": "rs_rank", "op": "eq"}, 'RS Rank: "equals" needs a number.'),
    # the between pair: either half missing or null
    ({"key": "rs_rank", "op": "between", "min": 10},
     'RS Rank: "between" needs a low and a high number.'),
    ({"key": "rs_rank", "op": "between", "max": 10},
     'RS Rank: "between" needs a low and a high number.'),
    ({"key": "rs_rank", "op": "between", "min": 10, "max": None},
     'RS Rank: "between" needs a low and a high number.'),
    ({"key": "rs_rank", "op": "between"},
     'RS Rank: "between" needs a low and a high number.'),
    # enum and bool equality, and contains
    ({"key": "sector", "op": "eq"}, 'Sector: "equals" needs a value.'),
    ({"key": "sector", "op": "eq", "value": None}, 'Sector: "equals" needs a value.'),
    ({"key": "optionable", "op": "eq", "min": 1}, 'Optionable: "equals" needs a value.'),
    ({"key": "sector", "op": "contains"}, 'Sector: "contains" needs some text.'),
    ({"key": "sector", "op": "contains", "value": None}, 'Sector: "contains" needs some text.'),
    # in / not_in: anything that is not a list
    ({"key": "sector", "op": "in"}, 'Sector: "is one of" needs a list of values.'),
    ({"key": "sector", "op": "in", "values": None}, 'Sector: "is one of" needs a list of values.'),
    ({"key": "sector", "op": "in", "values": "Tech"}, 'Sector: "is one of" needs a list of values.'),
    ({"key": "sector", "op": "in", "values": 5}, 'Sector: "is one of" needs a list of values.'),
    ({"key": "sector", "op": "in", "value": ["Tech"]}, 'Sector: "is one of" needs a list of values.'),
    ({"key": "sector", "op": "not_in", "values": {"a": 1}},
     'Sector: "is none of" needs a list of values.'),
    ({"key": "sector", "op": "not_in"}, 'Sector: "is none of" needs a list of values.'),
    # field-to-field: the right-hand side
    ({"key": "gross_margin", "op": "gt_col"},
     'Gross Margin: "above" needs a second field to compare with.'),
    ({"key": "gross_margin", "op": "gte_col", "other": None},
     'Gross Margin: "at least" needs a second field to compare with.'),
    ({"key": "gross_margin", "op": "lt_col", "value": "op_margin"},
     'Gross Margin: "below" needs a second field to compare with.'),
    ({"key": "gross_margin", "op": "lte_col", "other": ""},
     'Gross Margin: "at most" needs a second field to compare with.'),
]


@pytest.mark.parametrize("flt,sentence", CASES, ids=[str(c[0]) for c in CASES])
def test_a_filter_without_its_operand_is_refused_with_a_sentence(client, flt, sentence):
    assert scr_filters.FILTERS[flt["key"]]["label"] == sentence.split(":")[0]
    _refused(client, flt, sentence)


def test_every_legal_op_refuses_a_bare_filter_on_every_type_that_accepts_it(client):
    """Derived from `_VALID_OPS` itself, so an op added tomorrow is covered the day
    it lands: a filter carrying only its key and op is a 400 that opens with the
    filter's label and quotes the op's plain words, on both routes."""
    seen = set()
    for kind, ops in scr_filters._VALID_OPS.items():
        key = KEY_BY_TYPE[kind]
        label = scr_filters.FILTERS[key]["label"]
        for op in sorted(ops):
            words = scr_filters.OP_WORDS[op]
            for url in ("/api/screener/scan", "/api/screener/count"):
                r = client.post(url, json={"filters": [{"key": key, "op": op}]})
                assert r.status_code == 400, (url, key, op, r.status_code, r.text[:200])
                detail = r.json()["detail"]
                assert detail.startswith(f'{label}: "{words}" needs '), (key, op, detail)
                assert detail.endswith("."), detail
            seen.add(op)
    assert seen == set(scr_filters.OP_OPERANDS), sorted(set(scr_filters.OP_OPERANDS) - seen)


def test_every_op_has_plain_words():
    """`OP_WORDS` sits beside `OP_OPERANDS` and names the same ops, both ways."""
    assert set(scr_filters.OP_WORDS) == set(scr_filters.OP_OPERANDS)
    assert all(isinstance(w, str) and w.strip() for w in scr_filters.OP_WORDS.values())


def test_filters_that_carry_their_operands_still_run(client):
    """The control: the check refuses a missing operand and nothing else. Zero and
    False are real operands, and an EMPTY `values` list stays the documented
    no-op (`OP_OPERANDS`: "an empty one contributes no clause")."""
    def tickers(flt):
        r = client.post("/api/screener/scan", json={"filters": [flt]})
        assert r.status_code == 200, (flt, r.status_code, r.text[:200])
        c = client.post("/api/screener/count", json={"filters": [flt]})
        assert c.status_code == 200, (flt, c.text[:200])
        got = sorted(row["ticker"] for row in r.json()["rows"])
        assert c.json()["count"] == len(got), (flt, c.json())
        return got

    assert tickers({"key": "rs_rank", "op": "gte", "min": 90}) == ["AAA"]
    assert tickers({"key": "rs_rank", "op": "gte", "min": 0}) == ["AAA", "BBB"]
    assert tickers({"key": "rs_rank", "op": "lt", "max": 50}) == ["BBB"]
    assert tickers({"key": "rs_rank", "op": "between", "min": 0, "max": 50}) == ["BBB"]
    assert tickers({"key": "optionable", "op": "eq", "value": 0}) == ["BBB"]
    assert tickers({"key": "optionable", "op": "eq", "value": False}) == ["BBB"]
    assert tickers({"key": "sector", "op": "eq", "value": "Tech"}) == ["AAA"]
    assert tickers({"key": "sector", "op": "contains", "value": "ner"}) == ["BBB"]
    assert tickers({"key": "sector", "op": "in", "values": ["Tech"]}) == ["AAA"]
    assert tickers({"key": "sector", "op": "not_in", "values": ["Tech"]}) == ["BBB"]
    assert tickers({"key": "sector", "op": "in", "values": []}) == ["AAA", "BBB"]
    assert tickers({"key": "gross_margin", "op": "gt_col", "other": "op_margin"}) == ["AAA"]


def test_a_named_but_unknown_comparison_field_keeps_its_own_refusal(client):
    """A right-hand side that IS sent but is not a comparable filter key is a
    different mistake from a missing one, and keeps the refusal it already had."""
    r = client.post("/api/screener/scan", json={"filters": [
        {"key": "gross_margin", "op": "gt_col", "other": "sector"}]})
    assert r.status_code == 400
    assert "bad comparison field" in r.json()["detail"]
