"""THE SERVER LANE SERVES NATIVE TIMEFRAMES ONLY (2026-11-26).

A custom code ('240', '45', '2D') used to fall through `registry_defs.store_tf`'s 'Unknown => D' and be answered with
DAILY rows under its own code: an envelope keyed '240' holding daily data, whose times match no 4h bar (the UCT RS line
had no value on any custom-timeframe bar but the forming one). The chart now asks a custom timeframe's native base and
folds it (app `serverCompute.serverAskOf` / `foldToCustomTf`); the lane refuses any code it does not store, BEFORE a
provider runs, so nothing is computed or cached under it.

  T1 every custom code the chart offers, and nonsense, is refused (InputRejected, the route's 422) and no provider runs
  T2 every native code (`STORE_TF_FOR`) still reaches its provider, unchanged
  T3 the route answers a custom code 422 with the sentence
"""
from __future__ import annotations

import pytest

from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user_with_plan
from api.services.signature import registry_defs as rd
from tests.test_signature_router import client, _paid_user  # noqa: F401  (the router's app and paid-user fixtures)

CUSTOM = ("240", "120", "180", "45", "65", "195", "2", "3", "2D", "3D", "2W", "3M", "1H", "nonsense", "d")


def _spy(monkeypatch, def_id="rsLine"):
    calls = []

    def provider(sym, tf, inputs):
        calls.append(tf)
        return {"columns": {}, "times": []}

    monkeypatch.setitem(rd._PROVIDERS, def_id, provider)
    return calls


def test_T1_a_custom_code_is_refused_before_any_provider_runs(monkeypatch):
    calls = _spy(monkeypatch)
    for tf in CUSTOM:
        with pytest.raises(rd.InputRejected, match="not served by this lane"):
            rd.serve("rsLine", "SPY", tf, {})
    assert calls == []


def test_T2_every_native_code_still_reaches_its_provider(monkeypatch):
    calls = _spy(monkeypatch)
    for tf in rd.STORE_TF_FOR:
        try:
            rd.serve("rsLine", "SPY", tf, {})
        except rd.ColumnContractViolation:
            pass   # the stub answers no columns; what matters here is that the provider ran
    assert calls == list(rd.STORE_TF_FOR)


def test_T3_the_route_answers_a_custom_code_422(client, monkeypatch):  # noqa: F811
    calls = _spy(monkeypatch)
    client.dependency_overrides[get_current_user_with_plan] = _paid_user
    r = TestClient(client).get("/api/signature/columns", params={"defId": "rsLine", "sym": "SPY", "tf": "240"})
    assert r.status_code == 422
    assert "not served by this lane" in r.text
    assert calls == []
