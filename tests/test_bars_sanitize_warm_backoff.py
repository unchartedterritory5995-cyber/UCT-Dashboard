"""The meta warmer had no brake, so a fast sweep turned into a 429 burst.

🔴 2026-08-19. A worker boot pass logged ~470 `bars_sanitize meta fetch failed`
warnings inside two minutes. FMP answered normally seconds later (0.03s, real
data) — it was a rate-limit burst, not an outage and not a missing key.

⭐ THE WARMER KEPT ASKING AFTER THE PROVIDER SAID NO. `_warm_meta` submitted every
cold ticker to the pool regardless of whether the previous hundred had just been
refused. Two pool threads at ~0.04s/call is ~50 calls/sec — far over FMP's
per-minute allowance — so once the sweep got ahead of the limit it stayed there.

This is the failure `_fetch_meta`'s own docstring measured on 2026-08-09 ("72
requests 429'd across 38 tickers, each silently marked clean"). Raising
`MetaUnavailable` made it VISIBLE; this makes it STOP. When the provider refuses,
back off — a burst of identical refusals carries no more information than the
first one.

⛔ Backing off is not the same as hiding it: the warning still fires, there are
just a handful per pause instead of hundreds.
"""
import importlib

import pytest

bs = importlib.import_module("api.services.bars_sanitize")


@pytest.fixture(autouse=True)
def _clean_gate(monkeypatch):
    """Module globals; without a reset the first failing test poisons the rest."""
    bs._reset_warm_gate()
    with bs._warm_lock:
        bs._warm_inflight.clear()
    monkeypatch.setenv("BARS_SANITIZE_WARM_BACKOFF_SECONDS", "30")
    yield
    bs._reset_warm_gate()
    with bs._warm_lock:
        bs._warm_inflight.clear()


class _FakePool:
    def __init__(self):
        self.submitted = []

    def submit(self, fn):
        self.submitted.append(fn)
        return None


@pytest.fixture
def pool(monkeypatch):
    p = _FakePool()
    monkeypatch.setattr(bs, "_warm_pool", p)
    return p


def _at(monkeypatch, t):
    monkeypatch.setattr(bs, "_now", lambda: t)


# --------------------------------------------------------------------------- #

def test_THE_CONTROL_a_healthy_warmer_submits(pool, monkeypatch):
    """⛔ Without this, a `_warm_meta` that never submits would satisfy every
    assertion below while warming nothing at all (`lesson_gate_that_cannot_fail`)."""
    _at(monkeypatch, 1000.0)
    bs._warm_meta("AAPL")
    assert len(pool.submitted) == 1


def test_a_refusal_CLOSES_the_gate_so_the_burst_stops(pool, monkeypatch):
    """🔴 THE REGRESSION. Before this, ticker 2..470 were submitted after ticker 1
    had already been refused."""
    _at(monkeypatch, 1000.0)
    bs._warm_note_failure()

    for sym in ("AAPL", "MSFT", "NVDA"):
        bs._warm_meta(sym)
    assert pool.submitted == [], "the warmer kept asking after the provider refused"


def test_the_gate_REOPENS_after_the_backoff(pool, monkeypatch):
    """⛔ A brake that never releases is an outage of our own making."""
    _at(monkeypatch, 1000.0)
    bs._warm_note_failure()          # 30s pause
    _at(monkeypatch, 1029.0)
    bs._warm_meta("AAPL")
    assert pool.submitted == [], "reopened early"

    _at(monkeypatch, 1031.0)
    bs._warm_meta("AAPL")
    assert len(pool.submitted) == 1, "never reopened"


def test_consecutive_refusals_back_off_further_but_are_CAPPED():
    """Exponential so a sustained provider outage costs a handful of calls an
    hour, capped so recovery is never further away than the cap."""
    at = [1000.0]
    import contextlib
    with contextlib.ExitStack() as stack:
        mp = pytest.MonkeyPatch()
        stack.callback(mp.undo)
        mp.setattr(bs, "_now", lambda: at[0])
        mp.setenv("BARS_SANITIZE_WARM_BACKOFF_SECONDS", "30")

        delays = []
        for _ in range(8):
            delays.append(bs._warm_note_failure() - at[0])

        assert delays[0] == 30
        assert delays[1] == 60
        assert delays[2] == 120
        assert delays == sorted(delays), "backoff must not shrink while failing"
        assert max(delays) <= bs._WARM_BACKOFF_MAX
        assert delays[-1] == bs._WARM_BACKOFF_MAX, "never reached the cap"


def test_a_SUCCESS_resets_the_backoff(pool, monkeypatch):
    """⛔ Otherwise one bad minute keeps the warmer half-asleep for the rest of
    the day, and split repair silently lags behind it."""
    _at(monkeypatch, 1000.0)
    bs._warm_note_failure()
    bs._warm_note_failure()          # would be 60s
    bs._warm_note_success()

    bs._warm_meta("AAPL")
    assert len(pool.submitted) == 1, "a success did not reopen the gate"

    # and the NEXT failure starts from the base delay again, not from 120s
    assert bs._warm_note_failure() - 1000.0 == 30


def test_the_brake_has_a_kill_switch(pool, monkeypatch):
    """0 disables it — the pre-2026-08-19 behaviour, reachable without a deploy."""
    monkeypatch.setenv("BARS_SANITIZE_WARM_BACKOFF_SECONDS", "0")
    _at(monkeypatch, 1000.0)
    bs._warm_note_failure()
    bs._warm_meta("AAPL")
    assert len(pool.submitted) == 1


def test_the_worker_reports_success_and_failure_to_the_gate():
    """⭐ THE WIRE. `_warm_note_*` can be perfect and the gate still never move if
    the pool worker does not call them — the shape this repo keeps rediscovering
    (built, tested, green, connected to nothing)."""
    import inspect
    src = inspect.getsource(bs._warm_meta)
    assert "_warm_note_failure()" in src, "a refusal no longer closes the gate"
    assert "_warm_note_success()" in src, "a success no longer reopens the gate"
    assert "_warm_gate_open()" in src, "the gate is no longer consulted"
