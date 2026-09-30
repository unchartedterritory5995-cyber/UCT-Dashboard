"""adapters/base.py + adapters/__init__.py registry + adapters/fake.py."""
from __future__ import annotations

import pytest

from api.services.econ import adapters
from api.services.econ.adapters import base
from api.services.econ.adapters.base import Adapter, BaseAdapter, SeriesSpec, register, unregister
from api.services.econ.adapters.fake import FakeAdapter, register_fake
from api.services.econ.model import FetchResult, MalformedPayload, RawObs, SourceUnavailable

ENTRY = {
    "symbol": "USCPI", "frequency": "M", "week_anchor": "",
    "source": {"agency": "BLS", "dataset": "CPI", "provider_series_id": "CUSR0000SA0",
               "adapter": "bls", "params": {"seriesid": "CUSR0000SA0"}},
    "units": {"raw": "index", "display": "Index", "fmt": "num1", "scale": 1},
    "revision": {"type": "seasonal_factor_revision"},
    "release": {"calendar_key": "bls_cpi"},
}


def test_series_spec_view():
    s = SeriesSpec(ENTRY)
    assert (s.symbol, s.adapter, s.provider_series_id, s.frequency) == ("USCPI", "bls", "CUSR0000SA0", "M")
    assert s.params == {"seriesid": "CUSR0000SA0"}
    assert s.units["fmt"] == "num1" and s.revision["type"] == "seasonal_factor_revision"
    assert s.week_anchor == "" and s.derivation is None and s.raw is ENTRY
    assert SeriesSpec(s) == s and hash(s) == hash(SeriesSpec(dict(ENTRY)))
    with pytest.raises(AttributeError):
        s.symbol = "X"
    with pytest.raises(ValueError):
        SeriesSpec({"name": "no symbol"})


class _Demo(BaseAdapter):
    name = "demo_test"
    key_env = "BLS_API_KEY"
    max_series_per_request = 2

    def fetch(self, specs, *, mode, start, end, http):
        return []


def test_base_helpers(monkeypatch):
    a = _Demo()
    assert isinstance(a, Adapter)
    specs = [dict(ENTRY, symbol=f"USX{i}") for i in range(5)]
    chunks = list(a.chunk(specs))
    assert [len(c) for c in chunks] == [2, 2, 1] and isinstance(chunks[0][0], SeriesSpec)
    assert a.sha256(b"abc") == a.sha256("abc")
    assert len(a.sha256(b"")) == 64


def test_key_via_secrets(monkeypatch):
    class Bls(BaseAdapter):
        name = "bls"
        key_env = "BLS_API_KEY"
    monkeypatch.setenv("BLS_API_KEY", " k123456789 ")
    assert Bls().key() == "k123456789"
    monkeypatch.delenv("BLS_API_KEY")
    assert Bls().key() is None


def test_make_result_and_secret_request_key_refused(monkeypatch):
    a = _Demo()
    obs = [RawObs("USCPI", "2026-08-01", "2026-08-31", 321.5, "p")]
    r = a.make_result("demo:v2:CUSR0000SA0:2016-2026", obs, payload=b"{}", http_status=200)
    assert r.payload_sha256 == a.sha256(b"{}") and r.payload_bytes == 2 and r.adapter == "demo_test"
    monkeypatch.setenv("BEA_API_KEY", "beaSECRET12345")
    with pytest.raises(ValueError):
        a.make_result("bea:beaSECRET12345:NIPA", [])
    with pytest.raises(ValueError):
        a.make_result("bea:x?UserID=abcdefgh", [])


def test_register_get_available():
    try:
        register(_Demo)
        register(_Demo)                                  # idempotent
        assert adapters.get_adapter("demo_test") is adapters.get_adapter("demo_test")
        assert "demo_test" in adapters.available()

        class Other(BaseAdapter):
            name = "demo_test"
        with pytest.raises(ValueError):
            register(Other)
    finally:
        unregister("demo_test")
    with pytest.raises(KeyError):
        adapters.get_adapter("demo_test")


def test_lazy_loader_tolerates_missing_modules():
    adapters.load_all(force=True)                         # must not raise
    assert isinstance(adapters.available(), list)
    assert "fake" not in adapters.available()             # fake is never auto-registered
    for mod, err in adapters.import_errors().items():     # anything present but broken is reported
        assert mod in adapters.KNOWN_ADAPTER_MODULES and err


# --------------------------------------------------------------------------- FakeAdapter

def test_fake_adapter_list_script():
    fr = FetchResult(adapter="fake", request_key="fake:A")
    fa = FakeAdapter([
        fr,
        {"observations": [("USCPI", "2026-08-01", "2026-08-31", 321.5, "p"),
                          ("USCPI", "2026-07-01", "2026-07-31", None)]},
        SourceUnavailable("503 x5"),
        {"raise": "malformed", "message": "bad json"},
        {"not_modified": True},
    ])
    specs = [ENTRY]
    assert fa.fetch(specs, mode="latest", start=None, end=None, http=None) == [fr]
    [r] = fa.fetch(specs, mode="history", start=None, end=None, http=None)
    assert r.observations[1].value is None and r.request_key == "fake:USCPI" and r.http_status == 200
    with pytest.raises(SourceUnavailable):
        fa.fetch(specs, mode="latest", start=None, end=None, http=None)
    with pytest.raises(MalformedPayload):
        fa.fetch(specs, mode="latest", start=None, end=None, http=None)
    [nm] = fa.fetch(specs, mode="latest", start=None, end=None, http=None)
    assert nm.not_modified and nm.observations == []
    with pytest.raises(AssertionError):
        fa.fetch(specs, mode="latest", start=None, end=None, http=None)
    assert fa.calls[1] == (("USCPI",), "history", None, None)


def test_fake_adapter_per_symbol_and_repeat():
    fa = FakeAdapter({"USA1": [{"observations": [("USA1", "2026-01-01", "2026-01-31", 1.0)]}],
                      "USB2": [lambda specs, mode, start, end, http: []]},
                     on_exhausted="repeat")
    specs = [dict(ENTRY, symbol="USA1"), dict(ENTRY, symbol="USB2")]
    out = fa.fetch(specs, mode="latest", start=None, end=None, http=None)
    assert len(out) == 1 and out[0].observations[0].series_id == "USA1"
    out2 = fa.fetch(specs, mode="latest", start=None, end=None, http=None)   # repeats
    assert len(out2) == 1
    assert base.ADAPTERS.get("fake") is None


def test_register_fake_roundtrip():
    try:
        register_fake()
        assert isinstance(adapters.get_adapter("fake"), FakeAdapter)
    finally:
        unregister("fake")
