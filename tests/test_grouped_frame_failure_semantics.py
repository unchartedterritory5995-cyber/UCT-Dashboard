"""A provider failure is not a holiday.

⚰️ `get_grouped_daily_ohlcv` wraps everything in `except Exception: return {}` — the
right contract for a chart (do not 500 because a vendor blinked) and the wrong one for
a historical sweep, which cannot then tell a market closure from a 429 from a timeout.
The bounded provider control saw zero 429s in 704 requests; the US grind is 9,185.

`get_grouped_daily_frame` is the tri-state the sweep uses:
    rows present          the session traded
    rows empty, no error  the provider answered with nothing — a CLOSURE
    GroupedFrameError     we do not know, and the caller must not guess
"""
import os

import pytest

from api.services import massive
from api.services import breadth_pit_frame as bpf


@pytest.fixture(autouse=True)
def frames_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(massive, "_GROUPED_OHLCV_DIR", str(tmp_path))
    massive.cache.clear() if hasattr(massive.cache, "clear") else None
    yield


class _Resp:
    def __init__(self, payload):
        self.payload = payload


def stub_typed(monkeypatch, side_effect):
    """Replace the TYPED transport — the layer that already classifies vendor errors."""
    calls = {"n": 0}

    def _typed(self, path, timeout=None):
        calls["n"] += 1
        out = side_effect(calls["n"], path)
        if isinstance(out, Exception):
            raise out
        return out
    monkeypatch.setattr(massive._MassiveRestClient, "_typed_get", _typed, raising=False)
    monkeypatch.setattr(massive, "_get_client",
                        lambda: type("C", (), {"_api_key": "x",
                                               "_typed_get": _typed.__get__(object())})())
    return calls


def rows_payload(n=3):
    return {"results": [{"T": f"T{i}", "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 10}
                        for i in range(n)]}


# ── the three states ─────────────────────────────────────────────────────────

def test_rows_present_is_a_session(monkeypatch):
    stub_typed(monkeypatch, lambda n, p: rows_payload())
    out = massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert out["empty"] is False and len(out["rows"]) == 3


def test_a_successful_empty_answer_is_a_CLOSURE(monkeypatch):
    stub_typed(monkeypatch, lambda n, p: {"results": []})
    out = massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert out["empty"] is True and out.get("closed") is True
    assert "rows" in out               # a closure is a RESULT, not an error


def test_a_404_is_a_closure_not_a_failure(monkeypatch):
    stub_typed(monkeypatch, lambda n, p: massive._ERR.not_found("no such session"))
    out = massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert out["empty"] is True and out["rows"] == {}


@pytest.mark.parametrize("err,label", [
    (lambda: massive._ERR.rate_limited("429", status=429), "429"),
    (lambda: massive._ERR.transient("500"), "5xx / network"),
])
def test_a_transient_failure_RAISES_after_bounded_retries(monkeypatch, err, label):
    monkeypatch.setattr(massive.time, "sleep", lambda *_a: None)   # no real backoff wait
    calls = stub_typed(monkeypatch, lambda n, p: err())
    with pytest.raises(massive.GroupedFrameError) as ei:
        massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert calls["n"] == massive._GROUPED_RETRIES, label
    assert ei.value.attempts == massive._GROUPED_RETRIES
    assert "exhausted" in ei.value.reason


def test_a_transient_failure_that_RECOVERS_returns_the_frame(monkeypatch):
    monkeypatch.setattr(massive.time, "sleep", lambda *_a: None)
    calls = stub_typed(monkeypatch,
                       lambda n, p: massive._ERR.transient("blip") if n == 1
                       else rows_payload(2))
    out = massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert len(out["rows"]) == 2 and calls["n"] == 2


@pytest.mark.parametrize("make,why", [
    (lambda: massive._ERR.auth_error("401", status=401), "a rejected credential"),
    (lambda: massive._ERR.not_configured("no key"), "an unset key"),
])
def test_permanent_failures_are_NOT_retried(monkeypatch, make, why):
    calls = stub_typed(monkeypatch, lambda n, p: make())
    with pytest.raises(massive.GroupedFrameError):
        massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert calls["n"] == 1, why


def test_a_malformed_body_is_a_failure_not_an_empty_market(monkeypatch):
    stub_typed(monkeypatch, lambda n, p: massive._ERR.transient("non-JSON body"))
    monkeypatch.setattr(massive.time, "sleep", lambda *_a: None)
    with pytest.raises(massive.GroupedFrameError):
        massive.get_grouped_daily_frame("2015-03-10", adjusted=False)


# ── the cache must never learn a lie ────────────────────────────────────────

def test_a_failure_NEVER_becomes_a_durable_empty(monkeypatch, tmp_path):
    """⛔ THE POISONING CASE. The durable tier's TTL is seven days; a 429 cached as
    'this date has zero securities' would outlive the incident by a week."""
    monkeypatch.setattr(massive.time, "sleep", lambda *_a: None)
    stub_typed(monkeypatch, lambda n, p: massive._ERR.rate_limited("429", status=429))
    with pytest.raises(massive.GroupedFrameError):
        massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert not list(tmp_path.iterdir()), "a failure wrote something to the durable tier"

    # …and the very next call, once the provider recovers, gets the real frame
    stub_typed(monkeypatch, lambda n, p: rows_payload(4))
    out = massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert len(out["rows"]) == 4


def test_a_confirmed_closure_IS_durable(monkeypatch, tmp_path):
    """⭐ §13's other half: re-asking the provider about Thanksgiving 2013 on every
    replay is waste, and makes an offline replay impossible."""
    calls = stub_typed(monkeypatch, lambda n, p: {"results": []})
    massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    markers = [p for p in tmp_path.iterdir() if p.suffix == ".closed"]
    assert len(markers) == 1
    massive.cache.clear() if hasattr(massive.cache, "clear") else None
    before = calls["n"]
    out = massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert out["empty"] is True and out["closed"] is True
    assert calls["n"] == before, "a known closure re-asked the provider"


# ── the frame walker ────────────────────────────────────────────────────────

def test_the_session_walker_REFUSES_on_a_failure_rather_than_skipping(monkeypatch):
    """⛔⛔ THE GRIND-SAFETY CASE. `_sessions` used to walk straight past a date whose
    fetch failed, silently shortening the matrix — and `max_gap` only noticed after
    twelve in a row."""
    def _frame(day_iso, adjusted=False):
        if day_iso == "2015-03-10":
            raise massive.GroupedFrameError(day_iso, adjusted, "429 exhausted", 3)
        return {"rows": {"AAA": {"c": 10.0, "v": 1e6}}, "empty": False}
    monkeypatch.setattr(massive, "get_grouped_daily_frame", _frame)

    with pytest.raises(bpf.FrameFetchFailed) as ei:
        bpf._sessions("2015-03-09", "2015-03-11", adjusted=True)
    assert [d for d, _r in ei.value.failures] == ["2015-03-10"]
    assert "429 exhausted" in str(ei.value)


def test_build_frame_refuses_when_the_ADJUSTED_half_fails(monkeypatch):
    """⛔ Only the RAW half was ever guarded. A dropped adjusted frame removed the
    session from `dates` and the sweep simply never computed it."""
    def _frame(day_iso, adjusted=False):
        if adjusted and day_iso == "2015-03-10":
            raise massive.GroupedFrameError(day_iso, True, "timeout", 3)
        return {"rows": {"AAA": {"c": 10.0, "v": 1e6}}, "empty": False}
    monkeypatch.setattr(massive, "get_grouped_daily_frame", _frame)
    monkeypatch.setattr(bpf, "reference_map", lambda force=False: {})

    out = bpf.build_frame("us", "2015-03-09", "2015-03-11", warmup_days=3)
    assert out["ok"] is False
    assert out["failed_frames"] == ["2015-03-10"]
    assert "FAILED to fetch" in out["reason"]


def test_a_raw_FAILURE_and_a_raw_CLOSURE_read_differently_in_the_refusal(monkeypatch):
    """⚠️ Both refuse. They are not the same incident, and the reason says which."""
    sessions = ["2015-03-09", "2015-03-10", "2015-03-11"]
    adj = {"AAA": {"o": 1.0, "h": 2.0, "l": 0.5, "c": 10.0, "v": 5e6}}

    def _frame(day_iso, adjusted=False):
        if day_iso not in sessions:
            return {"rows": {}, "empty": True}
        if adjusted:
            return {"rows": adj, "empty": False}
        if day_iso == "2015-03-10":
            raise massive.GroupedFrameError(day_iso, False, "429 exhausted", 3)
        return {"rows": adj, "empty": False}
    monkeypatch.setattr(massive, "get_grouped_daily_frame", _frame)
    monkeypatch.setattr(bpf, "reference_map", lambda force=False: {})

    out = bpf.build_frame("us", "2015-03-09", "2015-03-11", warmup_days=3)
    assert out["ok"] is False
    assert out["missing_raw"] == ["2015-03-10"]
    assert out["failed_frames"] == ["2015-03-10"]
    assert "FAILED to fetch" in out["reason"] and "429 exhausted" in out["reason"]


# ── the LOCAL token budget is not the vendor's 429 ──────────────────────────
#
# ⚰️ MEASURED ON A REAL GRIND. `_typed_get` raises `RateLimited` for TWO different
# refusals: the vendor's 429 (`status=429`) and our own `_take_token` bucket
# (`status=None`, 300/min). Answering both with the vendor's 1/4/10s backoff threw the
# US grind off a cliff — the first 300 requests of a minute ran at ~1.6/s and everything
# after slept a full second for a token that regenerates in 0.2. The OLD fetcher never
# met the budget at all (it called `_get`, not `_typed_get`), so respecting it was right
# and sleeping the wrong interval for it was not.

def test_a_LOCAL_shed_waits_a_token_not_a_vendor_backoff(monkeypatch):
    slept = []
    monkeypatch.setattr(massive.time, "sleep", lambda s: slept.append(s))
    n = {"i": 0}

    def _side(i, p):
        n["i"] = i
        # shed locally five times, then answer
        return massive._ERR.rate_limited("local Massive budget exhausted") if i <= 5 \
            else rows_payload(2)
    stub_typed(monkeypatch, _side)
    out = massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert len(out["rows"]) == 2
    assert slept == [massive._GROUPED_TOKEN_WAIT] * 5, slept
    assert massive._GROUPED_TOKEN_WAIT < min(massive._GROUPED_BACKOFF)


def test_a_LOCAL_shed_does_NOT_consume_a_vendor_retry(monkeypatch):
    """⛔ It never reached the vendor. Counting it would 'exhaust' a request that was
    never sent — so a busy minute would look like a provider outage."""
    monkeypatch.setattr(massive.time, "sleep", lambda *_a: None)
    stub_typed(monkeypatch,
               lambda i, p: massive._ERR.rate_limited("local Massive budget exhausted")
               if i <= massive._GROUPED_RETRIES + 4 else rows_payload(1))
    out = massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert len(out["rows"]) == 1        # it survived more sheds than there are retries


def test_a_VENDOR_429_still_gets_the_real_backoff(monkeypatch):
    slept = []
    monkeypatch.setattr(massive.time, "sleep", lambda s: slept.append(s))
    stub_typed(monkeypatch,
               lambda i, p: massive._ERR.rate_limited("Massive rate-limited", status=429))
    with pytest.raises(massive.GroupedFrameError):
        massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert slept == list(massive._GROUPED_BACKOFF[:massive._GROUPED_RETRIES - 1]), slept


def test_an_endless_local_shed_is_still_bounded(monkeypatch):
    """⛔ Politeness must not become an infinite loop if the bucket never refills."""
    monkeypatch.setattr(massive.time, "sleep", lambda *_a: None)
    stub_typed(monkeypatch,
               lambda i, p: massive._ERR.rate_limited("local Massive budget exhausted"))
    with pytest.raises(massive.GroupedFrameError) as ei:
        massive.get_grouped_daily_frame("2015-03-10", adjusted=False)
    assert "not refilling" in ei.value.reason
    assert ei.value.attempts == massive._GROUPED_LOCAL_SHED_MAX + 1
