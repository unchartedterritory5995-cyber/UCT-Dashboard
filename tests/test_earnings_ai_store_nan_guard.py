"""earnings_ai_store.put — never persist a NaN/Inf-poisoned payload.

Regression (found live via a paid-member browser walkthrough of the
redesigned earnings modal): a NaN anywhere in the result dict (e.g.
earnings_enrichment.get_pre_earnings_context's pre-fix yfinance-gap bug,
live-verified for UBER) used to write successfully, because `json.dump`
defaults to `allow_nan=True` -- valid-per-Python, invalid-per-spec JSON that
only broke LATER, when Starlette's strict `allow_nan=False` JSONResponse
encoder re-serialized it for the HTTP response. That poisoned the on-disk
cache for up to `_MAX_AGE_SECS["analysis"]` (7 days), 500ing
`/api/earnings-analysis/{sym}` on EVERY request until the file finally aged
out — restarting the server does NOT clear it, since the whole point of this
store is to survive redeploys.
"""
from __future__ import annotations

import api.services.earnings_ai_store as store


def test_a_nan_payload_is_never_persisted(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_DIR", str(tmp_path))

    poisoned = {"analysis": "text", "pre_earnings": {"ret_5d_pct": float("nan")}}
    store.put("analysis", "NANSYM", poisoned)

    assert store.get("analysis", "NANSYM") is None
    assert store.read("analysis", "NANSYM") is None
    assert list(tmp_path.iterdir()) == []   # no stray .tmp file left behind either


def test_an_inf_payload_is_never_persisted(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_DIR", str(tmp_path))

    poisoned = {"analysis": "text", "pre_earnings": {"ret_5d_pct": float("inf")}}
    store.put("analysis", "INFSYM", poisoned)

    assert store.get("analysis", "INFSYM") is None


def test_a_clean_payload_still_persists_normally(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_DIR", str(tmp_path))

    clean = {"analysis": "text", "pre_earnings": {"ret_5d_pct": 4.2}}
    store.put("analysis", "CLEANSYM", clean)

    assert store.get("analysis", "CLEANSYM") == clean
