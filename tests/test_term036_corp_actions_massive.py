"""TERM-036 (FB-D5-02) -- dividends and splits come off yfinance, onto Massive
reference data.

Two modules read yfinance for corporate actions on 2026-09-24's census
(`tools/corp_actions_census.py` REGISTER, both OUTSTANDING):

  * `api/services/dividends_calendar.py`  -- the Calendar's forward
    dividend + split feed (`GET /api/calendar/dividends`).
  * `api/services/earnings_estimates.py`  -- `_build_chart_markers`'s "S"/"D"
    chart markers (`GET /api/chart/markers`).

Both now read `api/services/reference_corp_actions.py`, the one owned wrapper
around Massive's `/v3/reference/{splits,dividends}`. No table is added (CARD 5:
"a table with no consumer is a second authority waiting to drift").

The vendor is mocked at the ADAPTER boundary -- `massive._get_client()` -- so
the URL the adapter builds and the parse it performs are both exercised, and no
test here touches the network.
"""
from __future__ import annotations

import ast
import io
import pathlib
import time
import tokenize
from datetime import date, timedelta
from unittest import mock

import pytest

from api.services import massive
from api.services import reference_corp_actions as rca

_REPO = pathlib.Path(__file__).resolve().parents[1]
_DIV_CAL = _REPO / "api" / "services" / "dividends_calendar.py"
_EARN_EST = _REPO / "api" / "services" / "earnings_estimates.py"


# ═════════════════════════════════════════════════════════════════════════
# The fake Massive client (the adapter boundary)
# ═════════════════════════════════════════════════════════════════════════

class _FakeMassive:
    """Answers `/v3/reference/splits` and `/v3/reference/dividends` from
    per-ticker fixtures, the way `_MassiveRestClient._get` would."""

    _api_key = "k"

    def __init__(self, splits=None, dividends=None, fail=None):
        self.splits = splits or {}
        self.dividends = dividends or {}
        self.fail = set(fail or ())
        self.urls: list[str] = []

    def _get(self, url, timeout=None):
        self.urls.append(url)
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(url).query)
        tk = (q.get("ticker") or [""])[0]
        if tk in self.fail:
            raise RuntimeError("HTTP 503 from Massive")
        if "/v3/reference/splits" in url:
            return {"status": "OK", "results": list(self.splits.get(tk, []))}
        if "/v3/reference/dividends" in url:
            return {"status": "OK", "results": list(self.dividends.get(tk, []))}
        raise AssertionError(f"unexpected Massive URL {url}")


def _future(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def _past(days: int) -> str:
    return (date.today() - timedelta(days=days)).isoformat()


# ═════════════════════════════════════════════════════════════════════════
# (a) THE IMPORT RAIL -- no yfinance on either path, comments stripped first
# ═════════════════════════════════════════════════════════════════════════

_YF_CORP_ATTRS = {"dividends", "splits", "calendar", "actions"}


def _code_tokens(source: str) -> str:
    """The source with every COMMENT and every STRING removed, so prose that
    discusses yfinance (and there is a lot of it) can never satisfy or trip the
    sweep. Tokenize, not a regex: a `#` inside a string is not a comment."""
    out = []
    for tok in tokenize.generate_tokens(io.StringIO(source).readline):
        if tok.type in (tokenize.COMMENT, tokenize.STRING):
            continue
        out.append(tok.string)
    return " ".join(out)


def _yf_corporate_action_reads(source: str, *, only_function: str | None = None) -> list[str]:
    """Every yfinance corporate-action read in `source` (optionally restricted to
    one function), found from CODE ONLY.

    A hit is any of: an `import yfinance`, a name `yf`/`_yf` bound to it being
    used, or a `.dividends`/`.splits`/`.calendar`/`.actions` attribute read in a
    scope that also calls `.Ticker(...)`."""
    tree = ast.parse(source)
    scope: ast.AST = tree
    if only_function:
        scope = next(n for n in ast.walk(tree)
                     if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                     and n.name == only_function)
    hits: list[str] = []
    calls_ticker = False
    for node in ast.walk(scope):
        if isinstance(node, ast.Import):
            hits += [f"import {a.name}" for a in node.names if a.name.split(".")[0] == "yfinance"]
        elif isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] == "yfinance":
            hits.append(f"from {node.module} import ...")
        elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
              and node.func.attr == "Ticker"):
            calls_ticker = True
        elif isinstance(node, ast.Name) and node.id.startswith("_yf_corporate"):
            hits.append(node.id)
    if calls_ticker:
        hits += [f".{n.attr}" for n in ast.walk(scope)
                 if isinstance(n, ast.Attribute) and n.attr in _YF_CORP_ATTRS]
    # belt and braces: the bare token, with comments and strings gone
    if "yfinance" in _code_tokens(ast.unparse(scope)).split():
        hits.append("yfinance token")
    return hits


def test_dividends_calendar_has_NO_yfinance_in_its_code():
    hits = _yf_corporate_action_reads(_DIV_CAL.read_text(encoding="utf-8"))
    assert hits == [], (
        "api/services/dividends_calendar.py still reads yfinance for dividends/"
        f"splits: {hits}. TERM-036 routes it through reference_corp_actions.")


def test_chart_markers_build_has_NO_yfinance_corporate_action_read():
    """`earnings_estimates.py` keeps yfinance for OTHER things (the quarterly
    income-statement fallback), so the rail is scoped to the markers build and
    to the module-level corporate-action helper that fed it."""
    src = _EARN_EST.read_text(encoding="utf-8")
    hits = _yf_corporate_action_reads(src, only_function="_build_chart_markers")
    assert hits == [], f"_build_chart_markers still reads yfinance corporate actions: {hits}"
    tree = ast.parse(src)
    defs = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    assert "_yf_corporate_actions" not in defs, (
        "the yfinance corporate-action helper still exists in earnings_estimates.py")
    # the whole module: no `.dividends` / `.splits` read off a yfinance Ticker
    corp_attr_reads = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.Attribute) and n.attr in {"dividends", "splits"}
    ]
    assert corp_attr_reads == [], (
        "earnings_estimates.py reads a `.dividends`/`.splits` attribute -- in a module "
        "that calls yf.Ticker(...) that is a yfinance corporate-action read")


def test_both_modules_read_the_ONE_massive_reference_adapter():
    for path in (_DIV_CAL, _EARN_EST):
        code = _code_tokens(path.read_text(encoding="utf-8"))
        assert "reference_corp_actions" in code.split(), (
            f"{path.name} does not reach reference_corp_actions in CODE")


# -- the sweep's controls: it must be able to fail, and prose must not trip it

_PLANTED_REAL = '''
import yfinance as yf

def get(sym):
    # a comment
    return yf.Ticker(sym).dividends
'''

_PLANTED_PROSE_ONLY = '''
"""This module used to call yfinance: yf.Ticker(sym).dividends."""

def get(sym):
    # import yfinance as yf ; yf.Ticker(sym).splits -- retired, see TERM-036
    return "yfinance is not used here"
'''


def test_CONTROL_the_sweep_detects_a_real_yfinance_dividend_read():
    hits = _yf_corporate_action_reads(_PLANTED_REAL)
    assert "import yfinance" in hits and ".dividends" in hits, hits


def test_CONTROL_the_sweep_ignores_comments_docstrings_and_strings():
    assert _yf_corporate_action_reads(_PLANTED_PROSE_ONLY) == []


# ═════════════════════════════════════════════════════════════════════════
# The adapter -- reference_corp_actions per-ticker reads
# ═════════════════════════════════════════════════════════════════════════

def test_adapter_builds_per_ticker_urls_maps_class_shares_and_paginates(monkeypatch):
    pages = [
        {"results": [{"ticker": "BRK.B", "ex_dividend_date": _future(10), "cash_amount": 0.5}],
         "next_url": "https://api.massive.com/v3/reference/dividends?cursor=abc"},
        {"results": [{"ticker": "BRK.B", "ex_dividend_date": _future(100), "cash_amount": 0.6}]},
    ]

    class _Paged:
        _api_key = "k"
        urls: list = []

        def _get(self, url, timeout=None):
            self.urls.append(url)
            return pages.pop(0)

    client = _Paged()
    monkeypatch.setattr(massive, "_get_client", lambda: client)
    rows = rca.fetch_ticker_dividends("brk-b", gte=_future(0))
    assert [r["cash_amount"] for r in rows] == [0.5, 0.6]
    assert "/v3/reference/dividends" in client.urls[0]
    assert "ticker=BRK.B" in client.urls[0], "Massive answers n=0 for the hyphen form"
    assert f"ex_dividend_date.gte={_future(0)}" in client.urls[0]
    assert client.urls[1].startswith("https://api.massive.com/v3/reference/dividends?cursor=abc")
    assert "apiKey=k" in client.urls[1]


def test_adapter_RAISES_on_provider_failure_rather_than_answering_empty(monkeypatch):
    """An outage is not "pays no dividend". The adapter must say which it is."""
    monkeypatch.setattr(massive, "_get_client", lambda: _FakeMassive(fail={"KO"}))
    with pytest.raises(rca.CorpActionsUnavailable):
        rca.fetch_ticker_dividends("KO")
    with pytest.raises(rca.CorpActionsUnavailable):
        rca.fetch_ticker_splits("KO")


def test_adapter_RAISES_when_no_massive_key(monkeypatch):
    def _no_key():
        raise RuntimeError("Failed to initialize Massive client: MASSIVE_API_KEY not set")
    monkeypatch.setattr(massive, "_get_client", _no_key)
    with pytest.raises(rca.CorpActionsUnavailable):
        rca.fetch_ticker_splits("NVDA")


def test_adapter_answers_empty_only_when_the_vendor_answered_empty(monkeypatch):
    monkeypatch.setattr(massive, "_get_client", lambda: _FakeMassive())
    assert rca.fetch_ticker_dividends("NFLX") == []
    assert rca.fetch_ticker_splits("NFLX") == []


# ═════════════════════════════════════════════════════════════════════════
# dividends_calendar -- the Calendar's forward feed, shape preserved
# ═════════════════════════════════════════════════════════════════════════

@pytest.fixture
def dc(monkeypatch):
    from api.services import dividends_calendar as _dc
    monkeypatch.setattr(_dc, "resolve_entity",
                        lambda s: ({"status": "resolved", "entityId": f"em_{s}"}, s))
    return _dc


def _fresh(dc, syms):
    from api.services.cache import cache
    cache.invalidate(dc._syms_cache_key(syms))


def test_calendar_forward_dividend_and_split_come_from_massive(dc, monkeypatch):
    fake = _FakeMassive(
        dividends={"KO": [
            {"ticker": "KO", "ex_dividend_date": _past(80), "cash_amount": 0.49},
            {"ticker": "KO", "ex_dividend_date": _future(12), "cash_amount": 0.51},
            {"ticker": "KO", "ex_dividend_date": _future(100), "cash_amount": 0.51},
        ]},
        splits={"NVDA": [
            {"ticker": "NVDA", "execution_date": _past(400), "split_from": 1, "split_to": 10},
            {"ticker": "NVDA", "execution_date": _future(20), "split_from": 1, "split_to": 4},
        ], "XYZ": [
            {"ticker": "XYZ", "execution_date": _future(5), "split_from": 10, "split_to": 1},
        ]},
    )
    monkeypatch.setattr(massive, "_get_client", lambda: fake)
    _fresh(dc, ["KO", "NVDA", "XYZ"])

    out = dc.get_events(["ko", "NVDA", "XYZ"])

    div = [e for e in out if e["type"] == "dividend"]
    spl = [e for e in out if e["type"] == "split"]
    # ONE next dividend per symbol (the pre-swap semantics), with the DECLARED cash
    assert [(e["sym"], e["date"], e["amount"]) for e in div] == [("KO", _future(12), 0.51)]
    assert sorted((e["sym"], e["date"], e["ratio"]) for e in spl) == [
        ("NVDA", _future(20), "4:1"), ("XYZ", _future(5), "1:10")]
    for e in out:
        assert e["source"] == "massive"
        assert e["entity"] == {"status": "resolved", "entityId": f"em_{e['sym']}"}
    assert [e["date"] for e in out] == sorted(e["date"] for e in out)
    assert all("/v3/reference/" in u for u in fake.urls)


def test_calendar_massive_failure_is_NOT_cached_as_no_dividend(dc, monkeypatch):
    """A symbol whose Massive read failed is shed honestly: its absence is not
    served for 12h as "verified: no dividend, no split"."""
    from api.services.cache import cache
    fake = _FakeMassive(
        dividends={"KO": [{"ticker": "KO", "ex_dividend_date": _future(3), "cash_amount": 0.51}]},
        fail={"PEP"})
    monkeypatch.setattr(massive, "_get_client", lambda: fake)
    _fresh(dc, ["KO", "PEP"])

    out = dc.get_events(["KO", "PEP"])

    assert {e["sym"] for e in out} == {"KO"}
    _, expires_at = cache._store[dc._syms_cache_key(["KO", "PEP"])]
    assert expires_at - time.time() <= dc._CACHE_TTL_PARTIAL + 5


def test_calendar_all_answered_empty_still_gets_the_full_ttl(dc, monkeypatch):
    """Control: a vendor that ANSWERED with nothing is a real empty."""
    from api.services.cache import cache
    monkeypatch.setattr(massive, "_get_client", lambda: _FakeMassive())
    _fresh(dc, ["NFLX"])
    assert dc.get_events(["NFLX"]) == []
    _, expires_at = cache._store[dc._syms_cache_key(["NFLX"])]
    assert expires_at - time.time() > dc._CACHE_TTL - 5


def test_calendar_never_imports_yfinance_at_runtime(dc, monkeypatch):
    """Behavioural twin of the import rail: a yfinance that explodes on touch."""
    import sys

    class _Boom:
        def __getattr__(self, name):
            raise AssertionError(f"yfinance.{name} touched on the dividends path")

    monkeypatch.setitem(sys.modules, "yfinance", _Boom())
    monkeypatch.setattr(massive, "_get_client", lambda: _FakeMassive(
        dividends={"T": [{"ticker": "T", "ex_dividend_date": _future(1), "cash_amount": 0.2775}]}))
    _fresh(dc, ["T"])
    assert [e["sym"] for e in dc.get_events(["T"])] == ["T"]


# ═════════════════════════════════════════════════════════════════════════
# earnings_estimates chart markers -- same output shape, Massive source
# ═════════════════════════════════════════════════════════════════════════

def test_chart_markers_splits_and_dividends_come_from_massive(monkeypatch):
    from api.services import earnings_estimates as ee
    fake = _FakeMassive(
        splits={"NVDA": [
            {"ticker": "NVDA", "execution_date": "2024-06-10", "split_from": 1, "split_to": 10},
            {"ticker": "NVDA", "execution_date": "2021-07-20", "split_from": 1, "split_to": 4},
            {"ticker": "NVDA", "execution_date": "2000-06-27", "split_from": 1, "split_to": 2},
            {"ticker": "NVDA", "execution_date": "2001-09-17", "split_from": 2, "split_to": 3},
            {"ticker": "NVDA", "execution_date": "2011-01-01", "split_from": 8, "split_to": 1},
        ]},
        dividends={"NVDA": [
            {"ticker": "NVDA", "ex_dividend_date": _past(30), "cash_amount": 0.01},
            {"ticker": "NVDA", "ex_dividend_date": _past(365 * 7), "cash_amount": 0.04},
            {"ticker": "NVDA", "ex_dividend_date": _past(120), "cash_amount": "junk"},
        ]},
    )
    monkeypatch.setattr(massive, "_get_client", lambda: fake)
    monkeypatch.setattr(ee, "_fmp_rows", lambda *a, **k: None)
    monkeypatch.setattr(ee, "_fh_get", lambda *a, **k: None)

    out = ee._build_chart_markers("NVDA")

    by_date = {s["date"]: s for s in out["splits"]}
    assert by_date["2024-06-10"] == {"date": "2024-06-10", "ratio": "10:1",
                                     "from_factor": 1, "to_factor": 10.0, "source": "massive"}
    assert by_date["2021-07-20"]["ratio"] == "4:1"
    assert by_date["2001-09-17"]["ratio"] == "1.5:1"
    assert by_date["2011-01-01"]["ratio"] == "1:8"          # reverse split
    assert by_date["2011-01-01"]["to_factor"] == pytest.approx(0.125)
    # 5-year dividend lookback; unparseable amounts skipped
    assert out["dividends"] == [{"date": _past(30), "amount": 0.01, "source": "massive"}]
    assert any("/v3/reference/splits" in u for u in fake.urls)
    assert any("/v3/reference/dividends" in u for u in fake.urls)


def test_chart_markers_massive_failure_leaves_the_sections_empty_and_logs(monkeypatch, caplog):
    from api.services import earnings_estimates as ee
    monkeypatch.setattr(massive, "_get_client", lambda: _FakeMassive(fail={"KO"}))
    monkeypatch.setattr(ee, "_fmp_rows", lambda *a, **k: None)
    monkeypatch.setattr(ee, "_fh_get", lambda *a, **k: None)
    with caplog.at_level("WARNING"):
        out = ee._build_chart_markers("KO")
    assert out["splits"] == [] and out["dividends"] == []
    assert any("massive" in r.getMessage().lower() for r in caplog.records), (
        "a Massive outage on the markers path must be logged, not swallowed")


# ═════════════════════════════════════════════════════════════════════════
# (b) the parity instrument -- it must be ALLOWED TO DISAGREE (INST-7)
# ═════════════════════════════════════════════════════════════════════════

def test_parity_diff_names_disagreements_by_ticker_and_date():
    import sys
    sys.path.insert(0, str(_REPO))
    from tools import term036_corp_actions_parity as par

    incumbent = {"splits": [("2024-06-10", 10.0)], "dividends": [("2026-06-12", 0.01)]}
    massive_ = {"splits": [("2024-06-10", 10.0)], "dividends": [("2026-06-11", 0.01)]}
    rows = par.diff("NVDA", incumbent, massive_)
    assert ("NVDA", "dividends", "2026-06-12", 0.01, None) in rows
    assert ("NVDA", "dividends", "2026-06-11", None, 0.01) in rows
    assert all(r[1] != "splits" for r in rows), "an agreeing split is not a disagreement"
    # value mismatch on the same date is also named
    rows2 = par.diff("KO", {"splits": [], "dividends": [("2026-09-15", 0.51)]},
                     {"splits": [], "dividends": [("2026-09-15", 0.49)]})
    assert rows2 == [("KO", "dividends", "2026-09-15", 0.51, 0.49)]
