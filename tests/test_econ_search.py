"""Economic rows in /api/ticker-search — dark by construction, entitled only.

The contract (api/routers/ticker_search.py, "ECONOMIC SERIES"):
  * ECON_ENABLED unset -> the econ block is NEVER ENTERED: every chip, every caller,
    including `type=all_economic`, answers exactly what the pre-econ endpoint did.
  * flag on + not entitled (anonymous / free) -> no economic row anywhere.
  * flag on + entitled -> `type=economic` answers the member catalogue's rows
    (`serving.catalog()`, the same rows /api/econ/catalog serves); "All" merges them
    ONLY on `type=all_economic` (the other 13 consumers treat rows as tickers, and the
    in-process Discord caller pins the function's signature — so no new parameter).
"""
import os
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.bars_auth as bars_auth  # noqa: E402
import api.routers.ticker_search as ts  # noqa: E402

ANON = None
FREE = {"id": "free-1", "email": "f@x.test", "role": "member", "plan": "free"}
PAID = {"id": "paid-1", "email": "p@x.test", "role": "member", "plan": "pro"}

#: The member vocabulary the brief names, and the series each must find.
QUERIES = {
    "CPI": "USCPI", "core cpi": "USCORECPI", "inflation": "USCPI",
    "unemployment rate": "USUNRATE", "nonfarm payrolls": "USNFP",
    "initial claims": "USICSA", "GDP": {"USGDP", "USRGDP"}, "real GDP": "USRGDP",
    "fed funds": "USEFFR", "10-year treasury": "UST10Y", "2-year treasury": "UST2Y",
    "M2": "USM2", "JOLTS": "USJOLTSO", "housing starts": "USHOUST",
    "industrial production": "USINDPRO",
}


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(ts.router)
    return TestClient(app)


@pytest.fixture
def as_caller(monkeypatch):
    def _set(user):
        for mod in (bars_auth, ts):
            monkeypatch.setattr(mod, "validate_session", lambda _t, _u=user: (dict(_u) if _u else None))
            monkeypatch.setattr(mod, "get_user_plan", lambda _uid, _u=user: (_u or {}).get("plan", "free"))
    return _set


@pytest.fixture
def econ_on(monkeypatch):
    monkeypatch.setenv("ECON_ENABLED", "1")
    # registry-backed catalogue (db mode never reads an artifact) -- deterministic
    monkeypatch.setenv("ECON_SERVING_SOURCE", "db")
    from api.services.econ import serving
    serving.clear_cache()
    yield
    serving.clear_cache()


def _get(client, params, user):
    return client.get("/api/ticker-search", params=params,
                      cookies={"uct_session": "t"} if user else {})


def _econ(rows):
    return [r for r in rows if r.get("type") == "economic" or str(r.get("ticker", "")).startswith("ECON:")]


# ── 1. dark ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("user", [ANON, FREE, PAID], ids=["anon", "free", "paid"])
@pytest.mark.parametrize("q", ["CPI", "fed funds", "AAPL", "M2"])
def test_DARK_the_econ_block_is_never_entered_and_the_answer_is_unchanged(client, as_caller, monkeypatch, user, q):
    monkeypatch.delenv("ECON_ENABLED", raising=False)
    as_caller(user)

    def _boom(*_a, **_k):
        raise AssertionError("econ search ran while ECON_ENABLED is unset")
    monkeypatch.setattr(ts, "_econ_rows", _boom)
    monkeypatch.setattr(ts, "_econ_catalog_rows", _boom)
    for chip in ("", "stock", "breadth"):
        base = _get(client, {"q": q, "limit": 40, "type": chip}, user)
        assert base.status_code == 200
        assert not _econ(base.json()["results"])
    # the opt-in value is, dark, just an unknown chip — exactly as before econ existed
    opt = _get(client, {"q": q, "limit": 40, "type": "all_economic"}, user)
    unknown = _get(client, {"q": q, "limit": 40, "type": "nonsense"}, user)
    assert opt.content == unknown.content, "type=all_economic changed a DARK response"
    assert not _econ(opt.json()["results"])


def test_DARK_type_economic_is_the_pre_econ_unknown_chip_answer(client, as_caller, monkeypatch):
    """Before this change `type=economic` was an unknown chip (no filter); dark, it still is."""
    monkeypatch.delenv("ECON_ENABLED", raising=False)
    as_caller(PAID)
    a = _get(client, {"q": "AAPL", "limit": 10, "type": "economic"}, PAID)
    b = _get(client, {"q": "AAPL", "limit": 10, "type": "nonsense"}, PAID)
    assert a.content == b.content
    assert not _econ(a.json()["results"])


def test_the_flag_is_the_routers_own_value_1_nothing_else(monkeypatch):
    for v in ("0", "true", "yes", "", "1 "):
        monkeypatch.setenv("ECON_ENABLED", v)
        assert ts._econ_enabled() is False
    monkeypatch.setenv("ECON_ENABLED", "1")
    assert ts._econ_enabled() is True


# ── 2. entitlement ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("user", [ANON, FREE], ids=["anon", "free"])
def test_UNENTITLED_callers_see_no_economic_row(client, as_caller, econ_on, user):
    as_caller(user)
    r = _get(client, {"q": "CPI", "limit": 40, "type": "economic"}, user)
    assert r.status_code == 200 and r.json() == {"results": []}
    r = _get(client, {"q": "CPI", "limit": 40, "type": "all_economic"}, user)
    assert r.status_code == 200 and not _econ(r.json()["results"])


def test_ENTITLED_caller_gets_the_catalogue_rows(client, as_caller, econ_on):
    as_caller(PAID)
    rows = _get(client, {"q": "CPI", "limit": 40, "type": "economic"}, PAID).json()["results"]
    assert rows and rows[0]["ticker"] == "ECON:USCPI"
    assert all(r["type"] == "economic" and r["ticker"].startswith("ECON:") for r in rows)
    # the same authority as /api/econ/catalog: every row is a servable member series
    from api.services.econ import serving
    _s, body, _e = serving.catalog()
    catalog = {r["symbol"] for r in body["series"]}
    assert {r["symbol"] for r in rows} <= catalog
    # clean name first, display symbol second, never a raw provider id as the name
    top = rows[0]
    assert top["symbol"] == "USCPI" and top["name"] and "CUSR0000SA0" not in top["name"].upper()
    assert top["agency"] and top["frequency"] and top["units"]
    # deduped
    assert len({r["ticker"] for r in rows}) == len(rows)


@pytest.mark.parametrize("q,want", list(QUERIES.items()))
def test_member_vocabulary_finds_the_series(client, as_caller, econ_on, q, want):
    as_caller(PAID)
    rows = _get(client, {"q": q, "limit": 20, "type": "economic"}, PAID).json()["results"]
    syms = [r["symbol"] for r in rows[:3]]
    wants = want if isinstance(want, set) else {want}
    assert wants & set(syms), f"{q!r} -> {syms}"


def test_ALL_merges_only_on_opt_in(client, as_caller, econ_on):
    as_caller(PAID)
    plain = _get(client, {"q": "CPI", "limit": 40}, PAID).json()["results"]
    assert not _econ(plain), "econ rows leaked into a consumer that did not ask (CommandPalette, journal…)"
    opt = _get(client, {"q": "CPI", "limit": 40, "type": "all_economic"}, PAID).json()["results"]
    assert _econ(opt) and opt[0]["ticker"] == "ECON:USCPI", "an exact synonym hit leads All"
    # every non-econ row is still there, in its old order
    assert [r for r in opt if r not in _econ(opt)] == plain[: len(opt) - len(_econ(opt))]


def test_other_chips_never_carry_econ_rows(client, as_caller, econ_on):
    as_caller(PAID)
    for chip in ("stock", "etf", "index", "breadth"):
        r = _get(client, {"q": "CPI", "limit": 40, "type": chip}, PAID)
        assert not _econ(r.json()["results"]), chip


def test_an_econ_fault_never_breaks_search(client, as_caller, econ_on, monkeypatch):
    as_caller(PAID)
    monkeypatch.setattr(ts, "_econ_catalog_rows", lambda: (_ for _ in ()).throw(RuntimeError("r2 down")))
    base = _get(client, {"q": "AAPL", "limit": 10}, PAID)
    r = _get(client, {"q": "AAPL", "limit": 10, "type": "all_economic"}, PAID)
    assert r.status_code == 200 and r.content == base.content
    r = _get(client, {"q": "CPI", "limit": 10, "type": "economic"}, PAID)
    assert r.status_code == 200 and r.json() == {"results": []}


def test_the_signature_gained_no_parameter():
    """The Discord autocomplete's double pins this signature (tests/test_discord_chart.py)."""
    import inspect
    assert set(inspect.signature(ts.ticker_search).parameters) == {"q", "limit", "type", "uct_session"}


def test_in_process_caller_with_Query_defaults_is_unaffected(econ_on):
    """The Discord autocomplete calls `ticker_search` in-process with FastAPI defaults
    left as `Query()` objects -- the econ additions must not raise or add rows."""
    out = ts.ticker_search(q="AAPL", limit=5, type="")
    assert not _econ(out["results"])
