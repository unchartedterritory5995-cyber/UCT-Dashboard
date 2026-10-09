"""Wave-2 audit 2026-10-08: the TRAN panel's cold open measured ~17 s.

The transcript read (and the call-recap / sentiment reads that look a transcript up
first) ran a provider CHAIN on the request thread with no overall bound. Each is now
bounded by api/services/bounded_flight: past the budget the request answers at once
(503 + Retry-After for the transcript, "generating" for the recap) while the fetch
keeps running and caches -- and a second ask JOINS that fetch, never starts another.
"""
import threading
import time

import pytest
from unittest.mock import MagicMock


def _app(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routers import earnings_intel as ei
    app = FastAPI()
    app.include_router(ei.router)
    app.dependency_overrides[ei.require_paid] = lambda: {"id": "u1", "role": "member"}
    monkeypatch.setattr(ei, "resolve_entity", lambda s, **k: (None, s))
    return TestClient(app), ei


def test_a_slow_transcript_chain_answers_503_within_budget_and_is_fetched_once(monkeypatch):
    client, ei = _app(monkeypatch)
    monkeypatch.setattr(ei, "_TRANSCRIPT_BUDGET", 0.2)
    calls, release = [], threading.Event()

    def slow_fmp(sym, quarter=None):
        calls.append(sym)
        release.wait(5)
        return {"symbol": sym, "quarter": "2026Q2", "segments": [{"speaker": "CEO", "content": "hi"}]}

    monkeypatch.setattr(ei, "get_fmp_transcript", slow_fmp)
    monkeypatch.setattr(ei, "get_transcript", lambda s, quarter=None: None)

    t0 = time.monotonic()
    r = client.get("/api/earnings/transcript/SLOWTX")
    elapsed = time.monotonic() - t0
    assert r.status_code == 503, r.text
    assert r.headers.get("retry-after")
    assert "still being fetched" in r.json()["detail"]
    assert elapsed < 2.0, f"the request was held {elapsed:.2f}s for a 0.2s budget"

    # A second ask while the first fetch is still running JOINS it.
    r2 = client.get("/api/earnings/transcript/SLOWTX")
    assert r2.status_code == 503
    assert calls == ["SLOWTX"], "a re-ask started a second provider chain"

    release.set()
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        r3 = client.get("/api/earnings/transcript/SLOWTX")
        if r3.status_code == 200:
            break
        time.sleep(0.05)
    assert r3.status_code == 200 and r3.json()["source"] == "fmp"


def test_a_fast_transcript_is_served_in_the_same_request(monkeypatch):
    client, ei = _app(monkeypatch)
    monkeypatch.setattr(ei, "get_fmp_transcript",
                        lambda s, quarter=None: {"symbol": s, "segments": [{"speaker": "A", "content": "x"}]})
    r = client.get("/api/earnings/transcript/FASTTX")
    assert r.status_code == 200 and r.json()["source"] == "fmp"


def test_a_cold_recap_does_not_wait_on_the_whole_transcript_chain(monkeypatch):
    import api.services.call_recap as cr

    class _Cache:
        def __init__(self): self.d = {}
        def get(self, k): return self.d.get(k)
        def set(self, k, v, ttl=None): self.d[k] = v

    release = threading.Event()
    monkeypatch.setattr(cr, "_RECAP_TX_BUDGET", 0.2)
    monkeypatch.setattr(cr, "_cache", lambda: _Cache())
    monkeypatch.setattr(cr, "_store", lambda: MagicMock(get=MagicMock(return_value=None)))
    monkeypatch.setattr(cr, "_cost_guard",
                        lambda: MagicMock(may_synthesize=MagicMock(return_value=True)))
    monkeypatch.setattr(cr, "_transcript_for", lambda s: release.wait(5) and None)
    monkeypatch.setattr(cr, "_trigger_web_fallback", lambda s, ck: None)
    try:
        t0 = time.monotonic()
        recap, status = cr.get_call_recap_with_status("SLOWRC")
        elapsed = time.monotonic() - t0
    finally:
        release.set()
    assert (recap, status) == (None, "generating")
    assert elapsed < 2.0, f"the recap read was held {elapsed:.2f}s for a 0.2s budget"


def test_bounded_flight_reraises_the_jobs_own_error():
    from api.services import bounded_flight

    def boom():
        raise ValueError("provider said no")
    with pytest.raises(ValueError):
        bounded_flight.run("t::boom", boom, 2.0)
    assert not bounded_flight.inflight("t::boom")
