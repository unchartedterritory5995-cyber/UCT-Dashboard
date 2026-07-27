"""Dead-ticker backoff for the ticker-names prewarmer.

WHY: `_base_meta` only writes a disk entry `if any(data.values())`, so a ticker
that resolves to nothing at BOTH yfinance and Finnhub leaves no trace and is
re-attempted on EVERY boot, forever. Production 2026-07-26:

    [ticker-names-prewarm] done in 46.6s — warmed=0 skipped=3722 failed=20

~20 permanently-dead symbols (ASGN, ATGE, CCCS, MPW, NWAX-U, EXPI, PSTG, XWIN…)
burned 47s of every single cold start, and there were 40 cold starts that day.

DESIGN CONSTRAINT: this must NOT become a permanent blacklist. That is exactly
what made tools/detect_dead_tickers.py unsafe -- self-induced load made it
false-flag LIVE megacaps as delisted. So this is exponential BACKOFF, never a
tombstone: every ticker is always retried eventually, and a single success wipes
the record.
"""
import json
import os

import pytest

from api.services import ticker_names_prewarm as tnp


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    # path is resolved per-call so the env override takes effect
    return tmp_path / "ticker_names_prewarm_backoff.json"


def test_a_failure_backs_the_ticker_off_so_the_next_boot_skips_it(store):
    assert tnp._should_attempt("DEADCO", now=1000.0) is True
    tnp._record_failure("DEADCO", now=1000.0)
    assert tnp._should_attempt("DEADCO", now=1000.0) is False, (
        "a just-failed ticker must not be retried on the very next boot"
    )


def test_backoff_grows_with_consecutive_failures(store):
    tnp._record_failure("DEADCO", now=0.0)
    first = tnp._load_backoff()["DEADCO"]["next_attempt"]
    tnp._record_failure("DEADCO", now=first + 1)
    second = tnp._load_backoff()["DEADCO"]["next_attempt"]
    assert (second - (first + 1)) > (first - 0.0), "second wait must exceed the first"


def test_backoff_is_capped_so_it_is_never_a_permanent_blacklist(store):
    now = 0.0
    for _ in range(40):
        tnp._record_failure("DEADCO", now=now)
        now = tnp._load_backoff()["DEADCO"]["next_attempt"]  # retry at the boundary
    # After 40 consecutive failures, the NEXT one must still schedule a finite,
    # capped wait — i.e. this can never become a permanent blacklist.
    tnp._record_failure("DEADCO", now=now)
    wait = tnp._load_backoff()["DEADCO"]["next_attempt"] - now
    assert 0 < wait <= tnp._MAX_BACKOFF_SECONDS
    assert wait == tnp._MAX_BACKOFF_SECONDS, "should have saturated at the cap"


def test_cap_keeps_every_ticker_retried_at_least_daily():
    """Production showed the failing set includes LIVE names (BK, MMC, PSTG…),
    not just delisted ones — a flaky provider looks identical to a dead symbol
    here. So the cap must guarantee a retry within a day, not a month."""
    assert tnp._MAX_BACKOFF_SECONDS <= 24 * 3600


def test_expired_backoff_is_retried(store):
    tnp._record_failure("DEADCO", now=1000.0)
    nxt = tnp._load_backoff()["DEADCO"]["next_attempt"]
    assert tnp._should_attempt("DEADCO", now=nxt - 1) is False
    assert tnp._should_attempt("DEADCO", now=nxt + 1) is True


def test_success_clears_the_backoff_so_a_relisted_ticker_recovers(store):
    tnp._record_failure("RENAMED", now=0.0)
    assert tnp._should_attempt("RENAMED", now=1.0) is False
    tnp._record_success("RENAMED")
    assert tnp._should_attempt("RENAMED", now=1.0) is True
    assert "RENAMED" not in tnp._load_backoff()


def test_unknown_ticker_is_always_attempted(store):
    assert tnp._should_attempt("BRANDNEW", now=0.0) is True


def test_corrupt_store_never_raises_and_degrades_to_attempting(store):
    store.parent.mkdir(parents=True, exist_ok=True)
    store.write_text("{ this is not json", encoding="utf-8")
    assert tnp._load_backoff() == {}
    assert tnp._should_attempt("ANY", now=0.0) is True


def test_record_failure_survives_an_unwritable_store(tmp_path, monkeypatch):
    """Best-effort: a broken volume must not break the prewarmer."""
    blocker = tmp_path / "blocker"
    blocker.write_text("i am a file, not a directory", encoding="utf-8")
    # DATA_DIR under a regular file -> makedirs/open must fail internally
    monkeypatch.setenv("DATA_DIR", str(blocker / "sub"))
    tnp._record_failure("DEADCO", now=0.0)  # must not raise
    assert tnp._should_attempt("DEADCO", now=0.0) is True, (
        "unpersisted backoff must degrade to attempting, never to suppressing"
    )


def test_run_pass_skips_backed_off_tickers_and_does_not_fetch_them(store, monkeypatch):
    """THE POINT: the 47s saving. A backed-off ticker must not be fetched."""
    monkeypatch.setattr(tnp, "_load_universe", lambda: ["LIVE", "DEADCO"])
    monkeypatch.setattr(tnp, "_has_fresh_disk_entry", lambda t: False)
    monkeypatch.setattr(tnp, "_sleep_between_calls", lambda: None)

    attempted = []

    def fake_warm(ticker):
        attempted.append(ticker)
        return ticker == "LIVE"

    monkeypatch.setattr(tnp, "_warm_one", fake_warm)

    tnp._run_pass()
    assert attempted == ["LIVE", "DEADCO"], "first pass tries both"

    attempted.clear()
    tnp._run_pass()
    assert attempted == ["LIVE"], "second pass must NOT re-fetch the dead ticker"


def test_run_pass_clears_backoff_when_a_ticker_starts_working(store, monkeypatch):
    monkeypatch.setattr(tnp, "_load_universe", lambda: ["FLAKY"])
    monkeypatch.setattr(tnp, "_has_fresh_disk_entry", lambda t: False)
    monkeypatch.setattr(tnp, "_sleep_between_calls", lambda: None)

    monkeypatch.setattr(tnp, "_warm_one", lambda t: False)
    tnp._run_pass()
    assert "FLAKY" in tnp._load_backoff()

    # far future so the backoff has lapsed, and now it resolves
    monkeypatch.setattr(tnp, "_warm_one", lambda t: True)
    monkeypatch.setattr(tnp, "_should_attempt", lambda t, now=None: True)
    tnp._run_pass()
    assert "FLAKY" not in tnp._load_backoff()
