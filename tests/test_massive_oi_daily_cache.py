"""R61 — the daily chain cache on `api/massive_oi_snapshots`.

⚰️ WHAT IT IS FOR, measured on flow-worker 2026-09-17:

    [massive-oi] SPY: 41 pages, 10000 total results, 7984 indexed with OI>0

**per request.** `_PER_CALL_CACHE` is cleared at the top of every
`_fetch_oi_all_async`, so the whole 41-page walk was paid again for every batch that
mentioned SPY. Owner ruling: *the fix is the daily cache, not the timeout.*

⛔ EVERY TEST HERE DRIVES `_fetch_chain_blocking` WITH A FAKE TRANSPORT AND COUNTS
REQUESTS. A cache test that asserts "the second call returned the same dict" passes on
a cache that was never consulted — the only thing that distinguishes a hit from a
refetch is whether the wire was touched, so the request count is the assertion.
"""
import importlib
import json

import pytest

MOD = "api.massive_oi_snapshots"


@pytest.fixture()
def m(monkeypatch):
    mod = importlib.import_module(MOD)
    mod.clear_chain_cache()
    mod._PER_CALL_CACHE.clear()
    monkeypatch.setattr(mod, "MASSIVE_API_KEY", "test-key", raising=False)
    yield mod
    mod.clear_chain_cache()
    mod._PER_CALL_CACHE.clear()


class _Resp:
    def __init__(self, payload, status=200):
        self._b = json.dumps(payload).encode("utf-8")
        self.status = status

    def read(self):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _contract(strike, oi, ctype="call", exp="2026-10-16"):
    return {"details": {"contract_type": ctype, "strike_price": strike,
                        "expiration_date": exp}, "open_interest": oi}


def _transport(monkeypatch, m, pages, *, fail_on=None, status_on=None):
    """Serve `pages` (a list of payloads) in order and COUNT the requests.

    `fail_on` raises on that 0-based page; `status_on` returns a non-200 there."""
    calls = {"n": 0}

    def _open(req, timeout=None):
        i = calls["n"]
        calls["n"] += 1
        if fail_on is not None and i == fail_on:
            raise OSError("transport blew up on page %d" % i)
        if status_on is not None and i == status_on:
            return _Resp({}, status=502)
        return _Resp(pages[min(i, len(pages) - 1)])

    monkeypatch.setattr(m.urllib.request, "urlopen", _open)
    return calls


# ───────────────────────────────────────────────── the cache actually caches

def test_a_second_walk_on_the_same_day_touches_no_wire(m, monkeypatch):
    """⭐ THE POINT OF R61, stated as a request count. The batch entry point clears
    `_PER_CALL_CACHE` every call, so without the daily cache this is 1 request per
    call forever — which is what SPY's 41 pages were."""
    calls = _transport(monkeypatch, m, [{"results": [_contract(500, 11)]}])
    first = m._fetch_chain_blocking("SPY")
    assert calls["n"] == 1 and first

    m._PER_CALL_CACHE.clear()                 # exactly what _fetch_oi_all_async does
    second = m._fetch_chain_blocking("SPY")
    assert calls["n"] == 1, "the chain was re-walked; the daily cache did not hold"
    assert second == first


def test_a_new_ET_day_refetches(m, monkeypatch):
    """⛔ NON-VACUITY, and the property that makes this a DAILY cache rather than a
    permanent one: OI is recomputed overnight, so the key must roll."""
    calls = _transport(monkeypatch, m, [{"results": [_contract(500, 11)]}])
    monkeypatch.setattr(m, "_et_day", lambda: 20260917)
    m._fetch_chain_blocking("SPY")
    assert calls["n"] == 1

    m._PER_CALL_CACHE.clear()
    monkeypatch.setattr(m, "_et_day", lambda: 20260918)
    m._fetch_chain_blocking("SPY")
    assert calls["n"] == 2, "yesterday's open interest was served under today's date"


# ────────────────────────────────── the two refusals — the safety argument

def test_an_ERRORED_walk_is_never_kept_for_the_day(m, monkeypatch):
    """⚰⚰ THE ONE THAT MATTERS MOST. A timeout on page 2 yields a PARTIAL index
    that is indistinguishable from a complete one by inspection. Cached, it would pin
    SPY's open interest to whatever the first page held until midnight — and every
    later request would agree with it. A wrong number that is stable is the hardest
    kind to notice, and this cache would have manufactured one."""
    pages = [{"results": [_contract(500, 11)], "next_url": "/next"},
             {"results": [_contract(505, 22)]}]
    calls = _transport(monkeypatch, m, pages, fail_on=1)
    first = m._fetch_chain_blocking("SPY")
    assert first == {("C", 500.0, "10/16/2026"): 11}, "fixture did not produce a PARTIAL index"
    assert "SPY" not in m._CHAIN_CACHE, "a partial index was kept for the day"

    m._PER_CALL_CACHE.clear()
    m._fetch_chain_blocking("SPY")
    assert calls["n"] > 2, "the errored walk was not retried — it was cached"


def test_a_NON_200_walk_is_never_kept_for_the_day(m, monkeypatch):
    """The same refusal through the other failure door: a 502 mid-pagination."""
    pages = [{"results": [_contract(500, 11)], "next_url": "/next"},
             {"results": [_contract(505, 22)]}]
    _transport(monkeypatch, m, pages, status_on=1)
    m._fetch_chain_blocking("SPY")
    assert "SPY" not in m._CHAIN_CACHE


def test_an_EMPTY_index_is_never_kept_for_the_day(m, monkeypatch):
    """⛔ `{}` is what EVERY failure path in this module returns. Caching it would zero
    open interest for a whole session on one bad minute, and the log line would read
    `0 indexed with OI>0` exactly as it does for a genuinely empty chain."""
    _transport(monkeypatch, m, [{"results": []}])
    assert m._fetch_chain_blocking("WEIRD") == {}
    assert "WEIRD" not in m._CHAIN_CACHE


# ───────────────────────────────────────── truncation is a finding, not a success

def test_hitting_the_page_cap_is_reported_as_TRUNCATED(m, monkeypatch, caplog):
    """⚰ SPY's live line read `41 pages, 10000 total results` — exactly MAX_PAGES x
    MASSIVE_OI_PAGE_LIMIT — at INFO level, which reads as success. A chain cut off at
    the cap is a SHORT ANSWER: every strike past the cut resolves as 'no open
    interest' rather than as 'not measured'."""
    monkeypatch.setattr(m, "MAX_PAGES", 2)
    pages = [{"results": [_contract(500, 11)], "next_url": "/n1"},
             {"results": [_contract(505, 22)], "next_url": "/n2"}]
    _transport(monkeypatch, m, pages)
    with caplog.at_level("WARNING"):
        out = m._fetch_chain_blocking("SPY")
    assert len(out) == 2
    # ⛔ `getMessage()`, never `record.message` — the latter is only populated once a
    # formatter has run, so a raw-attribute assertion here passes or explodes depending
    # on who else configured logging. This one exploded, which is the good direction.
    warns = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    assert any("TRUNCATED" in w for w in warns), \
        "truncation was not reported at WARNING: %r" % warns
    assert any("UNMEASURED, not zero" in w for w in warns), \
        "the warning does not say what the cut costs a reader"


def test_a_truncated_walk_IS_kept_for_the_day(m, monkeypatch):
    """⚠️ The deliberate, narrower call. Truncation is not caused by this call and is
    not fixed by repeating it — the uncached code already served the same truncated
    index, 41 pages at a time. Caching changes the cost, not the answer; the WARNING
    above is what makes the truncation visible as its own problem."""
    monkeypatch.setattr(m, "MAX_PAGES", 2)
    pages = [{"results": [_contract(500, 11)], "next_url": "/n1"},
             {"results": [_contract(505, 22)], "next_url": "/n2"}]
    calls = _transport(monkeypatch, m, pages)
    m._fetch_chain_blocking("SPY")
    n_after_first = calls["n"]
    m._PER_CALL_CACHE.clear()
    m._fetch_chain_blocking("SPY")
    assert calls["n"] == n_after_first, "a truncated walk was re-paid; R61 misses SPY"


# ─────────────────────────────────────────────────────────── bounds and shape

def test_the_cache_is_LRU_bounded(m, monkeypatch):
    """⛔ `_PER_CALL_CACHE.clear()` existed to keep memory bounded, and R61 removes that
    bound for the day. Something has to replace it or a long-lived worker accumulates
    every underlying it has ever been asked about."""
    monkeypatch.setattr(m, "CHAIN_CACHE_MAX_TICKERS", 3)
    _transport(monkeypatch, m, [{"results": [_contract(1, 5)]}])
    for t in ("AAA", "BBB", "CCC", "DDD"):
        m._PER_CALL_CACHE.clear()
        m._fetch_chain_blocking(t)
    assert len(m._CHAIN_CACHE) == 3
    assert "AAA" not in m._CHAIN_CACHE, "the bound evicted the wrong end"
    assert "DDD" in m._CHAIN_CACHE


def test_stats_report_only_todays_entries(m, monkeypatch):
    monkeypatch.setattr(m, "_et_day", lambda: 20260917)
    _transport(monkeypatch, m, [{"results": [_contract(1, 5)]}])
    m._fetch_chain_blocking("AAA")
    assert m.chain_cache_stats()["entries"] == {"AAA": 1}
    monkeypatch.setattr(m, "_et_day", lambda: 20260918)
    assert m.chain_cache_stats()["entries"] == {}, "a stale day was reported as held"


def test_the_et_day_helper_returns_a_plausible_yyyymmdd(m):
    d = m._et_day()
    assert 20200101 <= d <= 21001231
    assert 1 <= d % 100 <= 31 and 1 <= (d // 100) % 100 <= 12
