"""Task 10 — FMP `stable/insider-trading/search` migration for insider.py.

FMP is now the primary provider for both the per-ticker request path
(`get_insider_activity`) and the 10-wide background feed
(`get_recent_insider_buys`); Finnhub `/stock/insider-transactions` stays as
an explicit fallback (kept live — not known-403 on this plan, unlike
`/stock/upgrade-downgrade`).

Covers: field-shape mapping, sign derivation (the highest-risk part — FMP
gives a magnitude + a direction LETTER, never a signed quantity, and an
absent/blank direction must EXCLUDE the row rather than default to "A"
acquire), `_classify_txn`'s new hyphenated `transactionType` vocabulary
(with the Finnhub single-letter-code branch kept intact), and the C18
cache-completeness fix (a total fetch failure gets the short TTL, never the
4h success TTL; a genuinely-empty SUCCESSFUL fetch still gets the full 4h
TTL — the two are not the same thing).

See also `tests/test_insider_cache_policy.py` (pre-existing, feed-level C18
coverage for the Finnhub-budget-denial signal) — this file's
`TestFeedFetchFailSignal` extends that coverage with the new
`fetch_fail_total` signal this migration adds.
"""
import time

import pytest

from api.services import insider
from api.services.cache import cache


def _ttl_remaining(key: str) -> float:
    _, expires_at = cache._store[key]
    return expires_at - time.time()


def _forbid_call(*_a, **_k):
    raise AssertionError("unexpected network call — the other provider should have satisfied this")


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    """Isolate from other tests sharing the process-wide cache singleton and
    the module-level fetch-fail counter (mirrors the isolation pattern in
    test_analyst_actions_fmp.py / test_insider_cache_policy.py)."""
    monkeypatch.setenv("FMP_API_KEY", "test-fmp-key")
    monkeypatch.setenv("FINNHUB_API_KEY", "test-fh-key")
    insider._fetch_fail_total = 0
    yield
    insider._fetch_fail_total = 0


def _fmp_row(**overrides) -> dict:
    row = {
        "symbol": "ZTST",
        "filingDate": "2026-08-01",
        "transactionDate": "2026-07-30",
        "reportingName": "Jane Doe",
        "typeOfOwner": "officer: Chief Financial Officer",
        "transactionType": "S-Sale",
        "securitiesTransacted": 1000,
        "price": 50.0,
        "securitiesOwned": 20000,
        "acquisitionOrDisposition": "D",
    }
    row.update(overrides)
    return row


# ── Field-shape mapping: happy path ─────────────────────────────────────────

class TestFmpFieldMapping:
    def test_fmp_row_maps_to_expected_shape(self, monkeypatch):
        cache.invalidate("insider_ZTST1")
        monkeypatch.setattr(insider, "_fmp_get_insider", lambda tk: [_fmp_row(
            reportingName="Jane Doe", typeOfOwner="officer: Chief Financial Officer",
            transactionType="S-Sale", acquisitionOrDisposition="D",
            securitiesTransacted=1000, price=50.0,
            transactionDate="2026-07-30", filingDate="2026-08-01",
        )])
        monkeypatch.setattr(insider, "fh_get", _forbid_call)

        txns = insider.get_insider_activity("ZTST1")

        assert len(txns) == 1
        t = txns[0]
        assert t["name"] == "Jane Doe"
        assert t["title"] == "officer: Chief Financial Officer"  # typeOfOwner preferred
        assert t["type"] == "sell"
        assert t["shares"] == 1000
        assert t["price"] == 50.0
        assert t["amount"] == 50000.0
        assert t["date"] == "2026-07-30"
        assert t["filing_date"] == "2026-08-01"

    def test_fmp_row_missing_typeOfOwner_falls_back_to_placeholder(self, monkeypatch):
        cache.invalidate("insider_ZTST1B")
        row = _fmp_row(typeOfOwner=None)
        monkeypatch.setattr(insider, "_fmp_get_insider", lambda tk: [row])
        monkeypatch.setattr(insider, "fh_get", _forbid_call)

        txns = insider.get_insider_activity("ZTST1B")
        assert txns[0]["title"] == "Officer/Director"


# ── _classify_txn: FMP hyphenated vocabulary ────────────────────────────────

class TestClassifyTxnFmpVocabulary:
    @pytest.mark.parametrize("code,direction,expected", [
        ("S-Sale", "D", "sell"),
        ("P-Purchase", "A", "buy"),
    ])
    def test_open_market_codes_use_derived_direction(self, code, direction, expected):
        row = _fmp_row(transactionType=code, acquisitionOrDisposition=direction)
        assert insider._classify_txn(row) == expected

    @pytest.mark.parametrize("code", [
        "M-Exempt", "F-InKind", "G-Gift", "A-Award", "C-Conversion", "J-Other", "D-Return", "",
    ])
    def test_non_open_market_codes_are_skipped(self, code):
        # Informational codes (grants/exercises/gifts/conversions) must never
        # surface as a buy/sell signal, even paired with a valid direction
        # letter -- mirrors the Finnhub branch's existing P/S-only scope.
        assert insider._classify_txn(_fmp_row(transactionType=code, acquisitionOrDisposition="A")) is None
        assert insider._classify_txn(_fmp_row(transactionType=code, acquisitionOrDisposition="D")) is None

    def test_dispatches_to_fmp_branch_on_transactionType_key(self):
        row = _fmp_row(transactionType="S-Sale", acquisitionOrDisposition="D")
        assert "transactionCode" not in row
        assert insider._classify_txn(row) == "sell"


class TestClassifyTxnFinnhubUnchanged:
    """The pre-migration Finnhub single-letter-code branch, kept intact as
    the fallback-path classifier — must be byte-for-byte behaviorally
    unchanged."""

    def test_purchase_code_is_buy(self):
        assert insider._classify_txn({"transactionCode": "P"}) == "buy"

    def test_sale_code_is_sell(self):
        assert insider._classify_txn({"transactionCode": "S"}) == "sell"

    @pytest.mark.parametrize("code", ["A", "G", "M", "F", ""])
    def test_other_codes_are_skipped(self, code):
        assert insider._classify_txn({"transactionCode": code}) is None


# ── Sign derivation — the highest-risk part of Task 10 ──────────────────────

class TestSignDerivation:
    """FMP gives a magnitude (`securitiesTransacted`) + a direction LETTER
    (`acquisitionOrDisposition`) -- the sign must be DERIVED from that
    letter, never assumed from the transactionType label, and an
    absent/blank direction must EXCLUDE the row rather than default to "A"
    (acquire) -- the `Number(null) === 0` bug family in a different shape."""

    def test_acquisition_A_is_buy(self):
        row = _fmp_row(transactionType="P-Purchase", acquisitionOrDisposition="A")
        assert insider._classify_txn_fmp(row) == "buy"

    def test_disposition_D_is_sell(self):
        row = _fmp_row(transactionType="S-Sale", acquisitionOrDisposition="D")
        assert insider._classify_txn_fmp(row) == "sell"

    def test_missing_direction_key_is_excluded_not_defaulted_to_buy(self):
        row = _fmp_row(transactionType="P-Purchase")
        row.pop("acquisitionOrDisposition")
        assert insider._classify_txn_fmp(row) is None

    def test_none_direction_is_excluded(self):
        row = _fmp_row(transactionType="S-Sale", acquisitionOrDisposition=None)
        assert insider._classify_txn_fmp(row) is None

    def test_blank_string_direction_is_excluded(self):
        # Observed live (2026-08-05 probe): ~3% of FMP rows carry an empty
        # string for both transactionType and acquisitionOrDisposition.
        row = _fmp_row(transactionType="S-Sale", acquisitionOrDisposition="")
        assert insider._classify_txn_fmp(row) is None

    def test_unrecognized_direction_is_excluded(self):
        row = _fmp_row(transactionType="S-Sale", acquisitionOrDisposition="X")
        assert insider._classify_txn_fmp(row) is None

    def test_end_to_end_row_with_missing_direction_never_appears(self, monkeypatch):
        """Full-pipeline check: a row with a valid P/S code but no
        acquisitionOrDisposition must not appear in get_insider_activity's
        output at all -- not as a buy, not as a sell, not with a fabricated
        direction."""
        cache.invalidate("insider_ZTST2")
        bad = _fmp_row(transactionType="P-Purchase", transactionDate="2026-07-31")
        bad.pop("acquisitionOrDisposition")
        good = _fmp_row(transactionType="S-Sale", acquisitionOrDisposition="D",
                         transactionDate="2026-07-29")
        monkeypatch.setattr(insider, "_fmp_get_insider", lambda tk: [bad, good])
        monkeypatch.setattr(insider, "fh_get", _forbid_call)

        txns = insider.get_insider_activity("ZTST2")

        assert len(txns) == 1
        assert txns[0]["type"] == "sell"


# ── C18 cache-completeness fix ───────────────────────────────────────────────

class TestC18PerTickerCacheCompleteness:
    def test_both_providers_fail_gets_short_ttl_and_still_serves_empty(self, monkeypatch):
        cache.invalidate("insider_ZTST3")
        monkeypatch.setattr(insider, "_fmp_get_insider", lambda tk: None)
        monkeypatch.setattr(insider, "fh_get", lambda *a, **k: None)

        txns = insider.get_insider_activity("ZTST3")

        assert txns == []  # a partial is still SERVED
        remaining = _ttl_remaining("insider_ZTST3")
        assert remaining <= insider._PER_TICKER_FAIL_TTL + 5
        assert remaining < insider._PER_TICKER_TTL

    def test_fmp_success_with_genuinely_zero_rows_gets_full_ttl(self, monkeypatch):
        """Control: FMP succeeds but the ticker just has no recent filings --
        this is NOT the same as a failure and must get the full success TTL
        (cache_policy.py's documented distinction: a legitimately-empty
        COMPLETE value is not a failed fetch)."""
        cache.invalidate("insider_ZTST4")
        monkeypatch.setattr(insider, "_fmp_get_insider", lambda tk: [])
        monkeypatch.setattr(insider, "fh_get", _forbid_call)

        txns = insider.get_insider_activity("ZTST4")

        assert txns == []
        remaining = _ttl_remaining("insider_ZTST4")
        assert remaining > insider._PER_TICKER_TTL - 5

    def test_fmp_fails_finnhub_fallback_succeeds_gets_full_ttl(self, monkeypatch):
        cache.invalidate("insider_ZTST5")
        monkeypatch.setattr(insider, "_fmp_get_insider", lambda tk: None)
        monkeypatch.setattr(insider, "fh_get", lambda *a, **k: {"data": [
            {"name": "John Fallback", "share": 500, "transactionPrice": 10.0,
             "transactionCode": "P", "transactionDate": "2026-07-20",
             "filingDate": "2026-07-21", "change": 500},
        ]})

        txns = insider.get_insider_activity("ZTST5")

        assert len(txns) == 1
        assert txns[0]["type"] == "buy"
        assert txns[0]["name"] == "John Fallback"
        remaining = _ttl_remaining("insider_ZTST5")
        assert remaining > insider._PER_TICKER_TTL - 5

    def test_partial_never_reaches_success_ttl_even_when_returned_txns_is_empty(self, monkeypatch):
        """Same fetch-failure scenario as above but re-asserts property (2)
        of the cache_policy contract explicitly by name: ttl_partial, not
        ttl_ok, on ANY total-failure path -- distinct from the "genuinely
        empty" control above."""
        cache.invalidate("insider_ZTST6")
        monkeypatch.setattr(insider, "_fmp_get_insider", lambda tk: None)
        monkeypatch.setattr(insider, "fh_get", lambda *a, **k: None)

        insider.get_insider_activity("ZTST6")

        _, expires_at = cache._store["insider_ZTST6"]
        # A success-TTL write would put expiry ~4h out; a partial-TTL write
        # puts it ~5min out. Assert the SHORT one landed.
        assert expires_at - time.time() < insider._PER_TICKER_TTL / 2


# ── Feed-level: extends test_insider_cache_policy.py with the new signal ────

class TestFeedFetchFailSignal:
    """test_insider_cache_policy.py already covers the Finnhub-budget-denial
    signal in `get_recent_insider_buys`. That signal alone went blind to a
    genuine dual-provider miss the moment FMP became primary (an FMP outage
    never touches Finnhub's budget-denial counter) -- this class covers the
    `fetch_fail_total` signal added to close that gap."""

    def setup_method(self):
        cache.invalidate("insider_feed")
        insider._fetch_fail_total = 0

    def teardown_method(self):
        insider._fetch_fail_total = 0

    def test_dual_provider_failure_mid_fanout_gets_short_ttl(self, monkeypatch):
        monkeypatch.setattr(insider, "_get_feed_tickers", lambda: ["ZFAIL1", "ZFAIL2"])
        monkeypatch.setattr(insider, "fh_budget_denied_total", lambda: 0)
        cache.invalidate("insider_ZFAIL1")
        cache.invalidate("insider_ZFAIL2")

        def fake_fetch_insider_raw(tk):
            if tk == "ZFAIL1":
                insider._note_fetch_fail()
                return [], False
            return [], True

        monkeypatch.setattr(insider, "_fetch_insider_raw", fake_fetch_insider_raw)

        result = insider.get_recent_insider_buys()

        assert result == []
        remaining = _ttl_remaining("insider_feed")
        assert remaining <= insider._FEED_FAIL_TTL + 5
        assert remaining < insider._FEED_TTL

    def test_no_failure_gets_full_ttl(self, monkeypatch):
        """Control: a clean fan-out (no failures at all) keeps the normal
        TTL, even for a genuinely-empty result."""
        monkeypatch.setattr(insider, "_get_feed_tickers", lambda: ["ZFAIL3"])
        monkeypatch.setattr(insider, "fh_budget_denied_total", lambda: 0)
        cache.invalidate("insider_ZFAIL3")
        monkeypatch.setattr(insider, "_fetch_insider_raw", lambda tk: ([], True))

        result = insider.get_recent_insider_buys()

        assert result == []
        remaining = _ttl_remaining("insider_feed")
        assert remaining > insider._FEED_TTL - 5
