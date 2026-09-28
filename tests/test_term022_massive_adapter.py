"""TERM-022 (FB-D1-01) -- the Massive adapter: one boundary, one error model,
provenance and a licensing class on every result, no silent fallback.

The vendor is mocked at the TRANSPORT (`massive._get_client()._typed_get`, or
`massive._http.get` for the end-to-end cases). No test here touches the network.
"""
from __future__ import annotations

import ast
import pathlib
import time
from unittest.mock import MagicMock

import pytest

from api.services import massive
from api.services import massive_adapter as ad
from api.services import provider_errors as pe
from api.services import provider_licensing_class as plc
from api.services.cache import cache

_REPO = pathlib.Path(__file__).resolve().parents[1]
_KEY = "SEKRET" + "-KEY-" + "9f3a"
_BASE = "https://api." + "massive" + ".com"


class _Transport:
    """Stands where `_MassiveRestClient` stands; answers `_typed_get` from a
    script: each entry is a dict (returned) or an exception (raised)."""

    def __init__(self, *script):
        self._api_key = _KEY
        self.script = list(script)
        self.paths: list[str] = []

    def _typed_get(self, path, *, timeout=None):
        self.paths.append(path)
        nxt = self.script.pop(0)
        if isinstance(nxt, BaseException):
            raise nxt
        return nxt


@pytest.fixture(autouse=True)
def _fresh_stats():
    ad.reset_stats()
    yield
    ad.reset_stats()


def _use(monkeypatch, transport):
    monkeypatch.setattr(massive, "_get_client", lambda: transport)
    return transport


# ═════════════════════════════════════════════════════════════════════════
# (b) every response carries a vendor and a licensing class
# ═════════════════════════════════════════════════════════════════════════

def test_get_stamps_vendor_activity_and_licensing_class(monkeypatch):
    t = _use(monkeypatch, _Transport({"status": "OK", "results": {"ticker": "AAPL"}}))
    r = ad.get("/v3/reference/tickers/AAPL", data_class="reference", activity="test.details")
    assert isinstance(r, pe.ProviderResult)
    assert r.value == {"status": "OK", "results": {"ticker": "AAPL"}}
    assert r.provenance.vendor == "massive"
    assert r.provenance.source_activity == "test.details"
    assert r.licensing_class == plc.licensing_class_for("massive", "reference") == "R"
    assert r.freshness is None, "freshness is never fabricated -- None means not established"
    assert t.paths == [f"/v3/reference/tickers/AAPL?apiKey={_KEY}"]


def test_every_registered_massive_data_class_stamps_its_own_class(monkeypatch):
    classes = sorted(dc for (v, dc) in plc.all_entries() if v == "massive")
    assert classes, "the licensing table has no Massive rows -- the stamp would be vacuous"
    for dc in classes:
        _use(monkeypatch, _Transport({"results": []}))
        r = ad.get_pages("/v3/x", data_class=dc, activity="t", max_pages=1)
        assert r.licensing_class == plc.licensing_class_for("massive", dc), dc
        assert r.value == []


def test_an_unregistered_data_class_is_stamped_U_never_a_permissive_default(monkeypatch):
    _use(monkeypatch, _Transport({"results": []}))
    r = ad.get_pages("/v3/x", data_class="not_yet_researched", activity="t", max_pages=1)
    assert r.licensing_class == "U"


def test_data_class_and_activity_are_required():
    with pytest.raises(ValueError):
        ad.get("/v3/x", data_class="", activity="t")
    with pytest.raises(ValueError):
        ad.get("/v3/x", data_class="reference", activity="")


# ═════════════════════════════════════════════════════════════════════════
# the adapter owns the credential and the host
# ═════════════════════════════════════════════════════════════════════════

def test_params_are_encoded_and_the_key_is_appended_exactly_once(monkeypatch):
    t = _use(monkeypatch, _Transport({"results": []}))
    ad.get_pages("/v3/reference/splits", data_class="reference", activity="t", max_pages=1,
                 params={"ticker": "BRK.B", "execution_date.gte": "2026-01-01",
                         "active": True, "skip": None, "order": "asc"})
    assert t.paths == [
        "/v3/reference/splits?ticker=BRK.B&execution_date.gte=2026-01-01"
        f"&active=true&order=asc&apiKey={_KEY}"]


@pytest.mark.parametrize("bad", [
    "v3/no-leading-slash", "/v3/x?already=query", _BASE + "/v3/x", "//evil.example/x",
])
def test_a_path_that_is_not_a_bare_massive_path_is_refused(monkeypatch, bad):
    t = _use(monkeypatch, _Transport())
    with pytest.raises(ValueError):
        ad.get(bad, data_class="reference", activity="t")
    assert t.paths == []


def test_a_caller_supplied_api_key_is_refused(monkeypatch):
    t = _use(monkeypatch, _Transport())
    with pytest.raises(ValueError):
        ad.get("/v3/x", data_class="reference", activity="t", params={"apiKey": "other"})
    assert t.paths == []


def test_no_client_raises_not_configured(monkeypatch):
    def _boom():
        raise RuntimeError("Failed to initialize Massive client: MASSIVE_API_KEY not set")
    monkeypatch.setattr(massive, "_get_client", _boom)
    with pytest.raises(massive.MassiveNotConfigured):
        ad.get("/v3/x", data_class="reference", activity="t")


# ═════════════════════════════════════════════════════════════════════════
# NO SILENT FALLBACK -- a vendor failure is raised, never answered as empty
# ═════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("exc", [
    massive._ERR.transient("Massive server error (503)", status=503),
    massive._ERR.rate_limited("Massive rate-limited (/v3/x)", status=429),
    massive._ERR.not_found("Massive: not found (HTTP 404) for /v3/x"),
    massive._ERR.auth_error("Massive rejected (401)", status=401),
])
def test_a_vendor_error_propagates_typed_it_is_never_an_empty_answer(monkeypatch, exc):
    _use(monkeypatch, _Transport(exc))
    with pytest.raises(type(exc)):
        ad.get_pages("/v3/x", data_class="reference", activity="t", max_pages=3)
    _use(monkeypatch, _Transport(exc))
    with pytest.raises(type(exc)):
        ad.get("/v3/x", data_class="reference", activity="t")


def test_a_failure_on_page_two_discards_page_one_rather_than_answering_partial(monkeypatch):
    _use(monkeypatch, _Transport(
        {"results": [{"a": 1}], "next_url": _BASE + "/v3/x?cursor=c2"},
        massive._ERR.transient("Massive server error (502)", status=502),
    ))
    with pytest.raises(massive.MassiveTransient):
        ad.get_pages("/v3/x", data_class="reference", activity="t", max_pages=5)


def test_cached_forbidden_is_raised_not_returned_as_a_value(monkeypatch):
    _use(monkeypatch, _Transport({"__degraded__": "cached_forbidden", "__degraded_since__": 123.0}))
    with pytest.raises(massive.MassiveAuthError) as ei:
        ad.get("/v3/x", data_class="reference", activity="t")
    assert ei.value.code == "cached_forbidden"


def test_pagination_past_max_pages_raises_rather_than_truncating(monkeypatch):
    page = {"results": [{"a": 1}], "next_url": _BASE + "/v3/x?cursor=more"}
    _use(monkeypatch, _Transport(dict(page), dict(page)))
    with pytest.raises(massive.MassiveTransient) as ei:
        ad.get_pages("/v3/x", data_class="reference", activity="t", max_pages=2)
    assert ei.value.code == "truncated"


def test_a_results_field_that_is_not_a_list_raises(monkeypatch):
    _use(monkeypatch, _Transport({"results": {"not": "a list"}}))
    with pytest.raises(massive.MassiveTransient):
        ad.get_pages("/v3/x", data_class="reference", activity="t", max_pages=1)


def test_an_answer_that_is_not_an_object_raises(monkeypatch):
    _use(monkeypatch, _Transport(["not", "an", "object"]))
    with pytest.raises(massive.MassiveTransient):
        ad.get("/v3/x", data_class="reference", activity="t")


def test_an_empty_answer_is_a_real_empty_answer(monkeypatch):
    _use(monkeypatch, _Transport({"status": "OK"}))
    r = ad.get_pages("/v3/x", data_class="reference", activity="t", max_pages=1)
    assert r.value == []


# ═════════════════════════════════════════════════════════════════════════
# pagination: follow the vendor's cursor verbatim, never to another host
# ═════════════════════════════════════════════════════════════════════════

def test_next_url_is_followed_verbatim_with_the_key_appended(monkeypatch):
    t = _use(monkeypatch, _Transport(
        {"results": [{"a": 1}], "next_url": _BASE + "/v3/reference/splits?cursor=YWJj%3D%3D+x&limit=1000"},
        {"results": [{"a": 2}], "next_url": _BASE + "/v3/reference/splits/next"},
        {"results": [{"a": 3}]},
    ))
    r = ad.get_pages("/v3/reference/splits", data_class="reference", activity="t", max_pages=5)
    assert r.value == [{"a": 1}, {"a": 2}, {"a": 3}]
    assert t.paths[1] == f"/v3/reference/splits?cursor=YWJj%3D%3D+x&limit=1000&apiKey={_KEY}"
    assert t.paths[2] == f"/v3/reference/splits/next?apiKey={_KEY}"


@pytest.mark.parametrize("foreign", [
    "https://evil.example/v3/x?cursor=1",
    _BASE + ".evil.example/v3/x?cursor=1",
    "http://api." + "massive" + ".com/v3/x?cursor=1",
    _BASE + "@evil.example/v3/x",
    "/v3/x?cursor=1",
])
def test_a_next_url_not_on_the_massive_https_host_is_refused_and_the_key_never_sent(monkeypatch, foreign):
    t = _use(monkeypatch, _Transport({"results": [{"a": 1}], "next_url": foreign}))
    with pytest.raises(massive.MassiveTransient) as ei:
        ad.get_pages("/v3/x", data_class="reference", activity="t", max_pages=5)
    assert len(t.paths) == 1
    assert _KEY not in str(ei.value)


def test_a_next_url_that_already_carries_a_key_gets_ours_once_never_two(monkeypatch):
    t = _use(monkeypatch, _Transport(
        {"results": [], "next_url": _BASE + "/v3/x?cursor=1&apiKey=zzz&limit=5"},
        {"results": []},
    ))
    ad.get_pages("/v3/x", data_class="reference", activity="t", max_pages=5)
    assert t.paths[1] == f"/v3/x?cursor=1&limit=5&apiKey={_KEY}"


# ═════════════════════════════════════════════════════════════════════════
# the key never appears in an error -- end to end through the real transport
# ═════════════════════════════════════════════════════════════════════════

@pytest.fixture
def real_client(monkeypatch):
    monkeypatch.setenv("MASSIVE_API_KEY", _KEY)
    monkeypatch.setattr(massive, "_client", None)
    massive._bucket_tokens = massive._MASSIVE_RATE_LIMIT_PER_MIN
    massive._bucket_updated = time.monotonic()
    cache.delete_prefix("massive_forbidden_")
    yield
    cache.delete_prefix("massive_forbidden_")
    monkeypatch.setattr(massive, "_client", None)


def _resp(status, body=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body if body is not None else {}
    r.raise_for_status.return_value = None
    return r


def test_end_to_end_through_the_real_client_and_token_bucket(monkeypatch, real_client):
    seen = []
    monkeypatch.setattr(massive._http, "get",
                        lambda url, timeout=None: seen.append(url) or _resp(200, {"results": [{"x": 1}]}))
    before = massive.budget()["served_total"]
    r = ad.get_pages("/v3/reference/dividends", params={"ticker": "KO"},
                     data_class="reference", activity="t", max_pages=2)
    assert r.value == [{"x": 1}] and r.licensing_class == "R"
    assert seen == [f"{_BASE}/v3/reference/dividends?ticker=KO&apiKey={_KEY}"]
    assert massive.budget()["served_total"] == before + 1


def test_a_403_is_cached_and_the_next_call_raises_without_a_request(monkeypatch, real_client):
    calls = []
    monkeypatch.setattr(massive._http, "get", lambda url, timeout=None: calls.append(url) or _resp(403))
    with pytest.raises(massive.MassiveAuthError):
        ad.get("/v3/reference/forbidden-thing", data_class="reference", activity="t")
    with pytest.raises(massive.MassiveAuthError) as ei:
        ad.get("/v3/reference/forbidden-thing", data_class="reference", activity="t")
    assert ei.value.code == "cached_forbidden"
    assert len(calls) == 1


def test_a_network_exception_carrying_the_url_never_puts_the_key_in_the_error(monkeypatch, real_client):
    def _boom(url, timeout=None):
        raise RuntimeError(f"connect failed for {url}")
    monkeypatch.setattr(massive._http, "get", _boom)
    with pytest.raises(massive.MassiveTransient) as ei:
        ad.get("/v3/reference/tickers", data_class="reference", activity="t", params={"search": "x"})
    assert _KEY not in str(ei.value)
    assert _KEY not in repr(ei.value.args)


def test_every_adapter_error_message_is_key_free(monkeypatch):
    cases = [
        _Transport({"__degraded__": "cached_forbidden", "__degraded_since__": 1.0}),
        _Transport(["x"]),
        _Transport({"results": 5}),
        _Transport({"results": [], "next_url": "https://evil.example/?apiKey=" + _KEY}),
        _Transport({"results": [], "next_url": _BASE + "/v3/x?c=1"}, {"results": [], "next_url": _BASE + "/v3/x?c=2"}),
    ]
    for t in cases:
        _use(monkeypatch, t)
        with pytest.raises(pe.ProviderError) as ei:
            ad.get_pages("/v3/x", data_class="reference", activity="t", max_pages=2)
        assert _KEY not in str(ei.value), str(ei.value)


# ═════════════════════════════════════════════════════════════════════════
# observability: per-class call counts and budget denials
# ═════════════════════════════════════════════════════════════════════════

def test_stats_count_calls_errors_and_budget_denials_per_class(monkeypatch):
    _use(monkeypatch, _Transport({"results": []}))
    ad.get_pages("/v3/x", data_class="reference", activity="t", max_pages=1)
    _use(monkeypatch, _Transport(massive._ERR.rate_limited("local Massive budget exhausted for /v3/x")))
    with pytest.raises(massive.MassiveRateLimited):
        ad.get("/v3/x", data_class="reference", activity="t")
    _use(monkeypatch, _Transport(massive._ERR.rate_limited("Massive rate-limited (/v3/x)", status=429)))
    with pytest.raises(massive.MassiveRateLimited):
        ad.get("/v3/y", data_class="news", activity="t")
    s = ad.stats()["by_data_class"]
    assert s["reference"] == {"calls": 2, "errors": 1, "budget_denied": 1}
    assert s["news"] == {"calls": 1, "errors": 1, "budget_denied": 0}
    assert "budget" in ad.stats()


def test_the_status_route_reports_the_adapter_per_class():
    from api.routers import massive_adapter_status as route
    body = route.massive_adapter_status()
    assert "adapter" in body and "by_data_class" in body["adapter"]
    assert "massive_adapter.get_pages" in body["typed_functions"]


# ═════════════════════════════════════════════════════════════════════════
# the migrated sites reach Massive ONLY through the adapter
# ═════════════════════════════════════════════════════════════════════════

def test_parity_diff_names_rows_on_one_side_only_and_is_multiplicity_aware():
    import sys
    sys.path.insert(0, str(_REPO))
    from tools import term022_adapter_parity as par

    a = [{"ticker": "NVDA", "execution_date": "2024-06-10", "split_from": 1, "split_to": 10}]
    assert par.diff("ticker_splits", "NVDA", a, list(a)) == []
    b = [{"ticker": "NVDA", "execution_date": "2024-06-11", "split_from": 1, "split_to": 10}]
    got = par.diff("ticker_splits", "NVDA", a, b)
    assert ("ticker_splits", "NVDA", "legacy-only", a[0]) in got
    assert ("ticker_splits", "NVDA", "adapter-only", b[0]) in got
    assert par.diff("f", "k", a + a, a) == [("f", "k", "legacy-only", a[0])]


def test_parity_tool_imports_api_without_pythonpath(tmp_path):
    import os
    import subprocess
    import sys
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env.pop("MASSIVE_API_KEY", None)
    proc = subprocess.run([sys.executable, str(_REPO / "tools" / "term022_adapter_parity.py"), "--help"],
                          cwd=str(tmp_path), env=env, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert "parity" in proc.stdout.lower()


_MIGRATED = {
    "api/services/reference_corp_actions.py": ("fetch_confirmed_splits", "_ticker_read"),
    "api/services/entity_master_d5_renames.py": ("_fetch_ticker_events",),
}


@pytest.mark.parametrize("rel", sorted(_MIGRATED))
def test_a_migrated_module_reaches_massive_only_through_the_adapter(rel):
    tree = ast.parse((_REPO / rel).read_text(encoding="utf-8"))
    bypass = sorted(
        f"{n.lineno}:{n.attr}" for n in ast.walk(tree)
        if isinstance(n, ast.Attribute) and n.attr in {"_REST_BASE", "_api_key", "_get", "_typed_get", "_http"})
    assert bypass == [], f"{rel} still reaches around the adapter: {bypass}"
    uses = {
        n.func.attr for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
        and isinstance(n.func.value, ast.Name) and n.func.value.id == "massive_adapter"}
    assert uses & {"get", "get_pages"}, f"{rel} does not call the adapter"
    fns = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    assert set(_MIGRATED[rel]) <= fns, f"{rel}: a migrated function disappeared"
