"""`voice_regime_held.held_regime()`: the READ ONLY reader of the regime classification the classifier holds.

No network: the breadth read and the vendor snapshot are replaced by counters that fail the test when reached. Every
number is invented. Pinned: nothing held is None, a held classification comes back untouched with the time the
classifier stored it, an entry that is not a classification is None, and the reader never computes, never reads
breadth and never asks a vendor, while the classifier's own `get_current_regime()` does exactly that on the same
cold cache (so the rail can fail).
"""
from __future__ import annotations

import contextlib
import time

import pytest

from api.services import engine, massive
from api.services import voice_regime_classifier as vrc
from api.services import voice_regime_held as held
from api.services.cache import cache

HELD = {"regime": "bull_correction", "confidence": 0.42, "reasons": ["55% above 50MA (decent)"],
        "signals": {"pct_above_50ma": 55.0, "vix": 17.5}, "narration": "x", "label": vrc.label_of("bull_correction"),
        "vocabulary_version": vrc.REGIME_VOCABULARY_VERSION}


@pytest.fixture(autouse=True)
def clean():
    cache.invalidate(vrc._CACHE_KEY)
    yield
    cache.invalidate(vrc._CACHE_KEY)


@pytest.fixture
def work(monkeypatch):
    """Counts the work the held reader must never cause."""
    hits = []

    def boom(name):
        def f(*a, **kw):
            hits.append(name)
            raise AssertionError(f"{name} was reached by a held read")
        return f
    monkeypatch.setattr(vrc, "_fetch_signals", boom("_fetch_signals"))
    monkeypatch.setattr(vrc, "_classify", boom("_classify"))
    monkeypatch.setattr(vrc, "get_current_regime", boom("get_current_regime"))
    monkeypatch.setattr(engine, "get_breadth", boom("get_breadth"))
    monkeypatch.setattr(massive, "get_ticker_snapshot", boom("get_ticker_snapshot"))
    return hits


def test_nothing_held_is_none_and_nothing_is_computed(work):
    assert held.held_regime() is None
    assert work == []
    assert cache.get(vrc._CACHE_KEY) is None                            # and nothing was stored by the read


def test_a_held_classification_comes_back_untouched_with_the_time_the_classifier_stored_it(work):
    before = time.time()
    cache.set(vrc._CACHE_KEY, HELD, ttl=vrc._TTL_SECONDS)               # as get_current_regime() stores it
    after = time.time()
    got = held.held_regime()
    assert got is not None and work == []
    value, computed_at = got
    assert value is HELD and value == HELD
    assert before - 1 <= computed_at <= after + 1                       # expiry less the classifier's own lifetime
    expires = [e for k, _v, e in cache.items_with_expiry() if k == vrc._CACHE_KEY][0]
    assert computed_at == pytest.approx(expires - vrc._TTL_SECONDS)


def test_an_expired_entry_and_an_entry_that_is_not_a_classification_are_none(work):
    cache.set(vrc._CACHE_KEY, HELD, ttl=-1)                             # already past its expiry
    assert held.held_regime() is None
    for junk in ({}, "bull_trend", ["bull_trend"], 3):
        cache.set(vrc._CACHE_KEY, junk, ttl=vrc._TTL_SECONDS)
        assert held.held_regime() is None, junk
    assert work == []


def test_the_reader_says_read_only_and_the_classifiers_own_reader_computes_on_the_same_cold_cache(monkeypatch):
    assert held.held_regime.__doc__.startswith("READ ONLY")
    asked = []
    monkeypatch.setattr(engine, "get_breadth", lambda *a, **kw: asked.append("breadth") or {})
    monkeypatch.setattr(massive, "get_ticker_snapshot", lambda *a, **kw: asked.append("vendor") or {})
    assert held.held_regime() is None and asked == []                   # the held read: no work
    with contextlib.suppress(Exception):
        vrc.get_current_regime()                                        # the classifier's reader: both
    assert asked == ["breadth", "vendor"]
    assert held.held_regime() is not None                               # and it stored what it computed
