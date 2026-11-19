"""The catalyst metadata reads the company profile first.

Market cap, the instrument type, the 52-week high and the two share counts come
from the company profile and the share-float read. The Yahoo read keeps sector,
industry and the average volume, and fills whatever the first read lacks. Each
of the two vendor reads is made at most once in 24 h per ticker, whoever asks.
"""
import contextlib
import sqlite3
import types

import pytest

from api.services import fmp_client
from api.services.catalyst import ticker_metadata as tm

KEYS = {"sector", "industry", "market_cap", "avg_volume_30d", "fifty_two_week_high",
        "quote_type", "float_shares", "shares_outstanding"}

YAHOO = {"sector": "Technology", "industry": "Semiconductors", "market_cap": 1.0e9,
         "avg_volume_30d": 1_200_000, "fifty_two_week_high": 99.0, "quote_type": "EQUITY",
         "float_shares": 40_000_000, "shares_outstanding": 50_000_000}

# The field names are the ones the profile and share-float endpoints answer with
# (tests/fixtures/term072_fmp_parity_goldens.json; research/ownership.py).
PROFILE_ROW = {"symbol": "FOO", "companyName": "Foo Corp", "sector": "Information Technology",
               "industry": "Chips", "marketCap": 5.0e9, "averageVolume": 9_000_000.0,
               "price": 42.0, "range": "20.5-120.25", "isEtf": False, "isFund": False}
FLOAT_ROW = {"symbol": "FOO", "floatShares": 44_000_000, "outstandingShares": 55_000_000}


class Vendor:
    """Stands in for the two vendor reads and counts every call. A body that is
    an exception is raised; an empty list is the adapter's own "no row"."""

    def __init__(self):
        self.profile = [dict(PROFILE_ROW)]
        self.shares = [dict(FLOAT_ROW)]
        self.profile_calls = []
        self.share_calls = []

    @staticmethod
    def _answer(body):
        if isinstance(body, Exception):
            raise body
        if body == []:
            raise fmp_client._ERR.not_found("no data for this request")
        return body if hasattr(body, "degraded") else types.SimpleNamespace(value=body, degraded=None)

    def get_company_profile(self, ticker, *, timeout=None):
        self.profile_calls.append(ticker)
        return self._answer(self.profile)

    def get_shares_float(self, ticker, *, timeout=None):
        self.share_calls.append(ticker)
        return self._answer(self.shares)


@pytest.fixture(autouse=True)
def _own_store(tmp_path, monkeypatch):
    monkeypatch.setattr(tm, "_DB_PATH", str(tmp_path / "catalyst_metadata.db"))
    monkeypatch.setattr(tm, "_INIT_DONE", False)
    monkeypatch.setattr(tm, "_ASKED", {})
    monkeypatch.setattr(tm, "_ASK_LOCKS", {})


@pytest.fixture
def vendor(monkeypatch):
    v = Vendor()
    monkeypatch.setattr(fmp_client, "get_company_profile", v.get_company_profile)
    monkeypatch.setattr(fmp_client, "get_shares_float", v.get_shares_float)
    return v


@pytest.fixture
def yahoo(monkeypatch):
    state = types.SimpleNamespace(answer=dict(YAHOO), calls=[])

    def _read(ticker):
        state.calls.append(ticker)
        return dict(state.answer)

    monkeypatch.setattr(tm, "_fetch_via_yfinance", _read)
    return state


def _ask_rows():
    with contextlib.closing(sqlite3.connect(tm._DB_PATH)) as c:
        return {(t, k): s for t, k, s in c.execute("SELECT ticker, kind, state FROM vendor_asks")}


def _age_every_ask(seconds):
    """Move every recorded ask back in time, in the store and in this process's copy."""
    with contextlib.closing(sqlite3.connect(tm._DB_PATH)) as c:
        c.execute("UPDATE vendor_asks SET asked_at = asked_at - ?", (seconds,))
        c.commit()
    for key, (at, state, facts) in list(tm._ASKED.items()):
        tm._ASKED[key] = (at - seconds, state, facts)


# ── which read supplies which field ──────────────────────────────────────────

def test_profile_and_share_float_supply_cap_type_high_and_share_counts(vendor, yahoo):
    out = tm.get_metadata("FOO")
    assert out["market_cap"] == 5.0e9
    assert out["quote_type"] == "EQUITY"
    assert out["fifty_two_week_high"] == 120.25
    assert out["float_shares"] == 44_000_000
    assert out["shares_outstanding"] == 55_000_000
    assert set(out) == KEYS, "the payload keys are the ones callers read, no more"


def test_sector_industry_and_average_volume_stay_on_the_yahoo_read(vendor, yahoo):
    """The catalyst engine groups and matches on the sector and industry strings,
    and the volume multiple divides by the average volume: the profile's own
    sector, industry and average volume must not reach the payload."""
    out = tm.get_metadata("FOO")
    assert out["sector"] == "Technology"
    assert out["industry"] == "Semiconductors"
    assert out["avg_volume_30d"] == 1_200_000


def test_no_vendor_row_leaves_every_field_on_the_yahoo_read(vendor, yahoo):
    vendor.profile, vendor.shares = [], []
    assert tm.get_metadata("FOO") == YAHOO


def test_a_failed_vendor_read_leaves_every_field_on_the_yahoo_read(vendor, yahoo):
    vendor.profile = fmp_client._ERR.transient("timed out")
    vendor.shares = fmp_client._ERR.transient("timed out")
    assert tm.get_metadata("FOO") == YAHOO


def test_a_field_the_profile_lacks_is_filled_from_the_yahoo_read(vendor, yahoo):
    vendor.profile[0]["marketCap"] = None
    vendor.profile[0]["range"] = ""
    out = tm.get_metadata("FOO")
    assert out["market_cap"] == 1.0e9, "Yahoo's market cap"
    assert out["fifty_two_week_high"] == 99.0, "Yahoo's 52-week high"
    assert out["float_shares"] == 44_000_000, "the share-float read still supplies its own"


def test_no_value_anywhere_is_none_never_zero(vendor, yahoo):
    vendor.profile[0].update(marketCap=0, range="0-0")
    vendor.shares[0].update(floatShares=0, outstandingShares=0)
    yahoo.answer = dict.fromkeys(KEYS)
    out = tm.get_metadata("FOO")
    assert out["market_cap"] is None and out["fifty_two_week_high"] is None
    assert out["float_shares"] is None and out["shares_outstanding"] is None


@pytest.mark.parametrize("flags, expected", [
    ({"isEtf": True, "isFund": False}, "ETF"),
    ({"isEtf": False, "isFund": True}, "MUTUALFUND"),
])
def test_a_profile_that_says_fund_settles_the_instrument_type(vendor, yahoo, flags, expected):
    vendor.profile[0].update(flags)
    yahoo.answer["quote_type"] = "EQUITY"   # must not win over a profile that says fund
    assert tm.get_metadata("FOO")["quote_type"] == expected


@pytest.mark.parametrize("yahoo_says", ["ETF", "MUTUALFUND", "CRYPTOCURRENCY"])
def test_a_profile_that_says_company_does_not_overrule_the_yahoo_read(vendor, yahoo, yahoo_says):
    """The quality gate drops what is not a stock: it is never looser than either read."""
    vendor.profile[0].update({"isEtf": False, "isFund": False})
    yahoo.answer["quote_type"] = yahoo_says
    assert tm.get_metadata("FOO")["quote_type"] == yahoo_says


def test_a_profile_that_says_company_fills_in_when_the_yahoo_read_has_no_type(vendor, yahoo):
    vendor.profile[0].update({"isEtf": False, "isFund": False})
    yahoo.answer["quote_type"] = None
    assert tm.get_metadata("FOO")["quote_type"] == "EQUITY"


def test_instrument_type_falls_back_when_the_profile_does_not_say(vendor, yahoo):
    del vendor.profile[0]["isEtf"], vendor.profile[0]["isFund"]
    yahoo.answer["quote_type"] = "ETF"
    assert tm.get_metadata("FOO")["quote_type"] == "ETF"


def test_a_zero_share_count_is_not_a_measurement(vendor, yahoo):
    """The share-float read writes 0 for funds: that is "nothing held", not a count."""
    vendor.shares[0].update(floatShares=0, outstandingShares=0)
    out = tm.get_metadata("FOO")
    assert (out["float_shares"], out["shares_outstanding"]) == (40_000_000, 50_000_000)


def test_a_float_above_shares_outstanding_uses_neither(vendor, yahoo):
    vendor.shares[0].update(floatShares=60_000_000, outstandingShares=55_000_000)
    out = tm.get_metadata("FOO")
    assert (out["float_shares"], out["shares_outstanding"]) == (40_000_000, 50_000_000)


def test_the_24h_cache_still_answers_the_second_call(vendor, yahoo):
    first = tm.get_metadata("FOO")
    assert tm.get_metadata("foo") == first
    assert yahoo.calls == ["FOO"]
    assert vendor.profile_calls == ["FOO"] and vendor.share_calls == ["FOO"]


# ── profile_facts / share_counts: what a caller is handed ────────────────────

def test_profile_facts_shape(vendor):
    assert tm.profile_facts("foo") == {
        "name": "Foo Corp", "is_etf": False, "is_fund": False, "market_cap": 5.0e9,
        "price": 42.0, "avg_volume": 9_000_000.0, "year_high": 120.25,
    }


def test_profile_facts_is_none_without_a_row_or_a_ticker(vendor):
    vendor.profile = []
    assert tm.profile_facts("FOO") is None
    assert tm.profile_facts("") is None
    assert vendor.profile_calls == ["FOO"]


# ── at most one ask per ticker per day ───────────────────────────────────────

def test_a_ticker_is_asked_for_once_a_day_across_callers(vendor):
    for _ in range(3):
        assert tm.profile_facts("FOO")["market_cap"] == 5.0e9
        assert tm.share_counts("FOO")["float_shares"] == 44_000_000
    assert vendor.profile_calls == ["FOO"] and vendor.share_calls == ["FOO"]
    assert _ask_rows() == {("FOO", "profile"): "ok", ("FOO", "share_counts"): "ok"}


def test_the_record_survives_a_restart(vendor, monkeypatch):
    tm.profile_facts("FOO")
    monkeypatch.setattr(tm, "_ASKED", {})          # a new process has no copy of its own
    assert tm.profile_facts("FOO")["name"] == "Foo Corp"
    assert vendor.profile_calls == ["FOO"]


def test_a_day_later_the_ticker_is_asked_for_again(vendor):
    tm.profile_facts("FOO")
    _age_every_ask(tm._ASK_TTL_SECONDS - 60)
    tm.profile_facts("FOO")
    assert vendor.profile_calls == ["FOO"], "23 h 59 min: still the same day's ask"
    _age_every_ask(120)
    tm.profile_facts("FOO")
    assert vendor.profile_calls == ["FOO", "FOO"]


def test_no_row_is_remembered_for_the_day(vendor):
    vendor.profile = []
    assert tm.profile_facts("FOO") is None
    assert tm.profile_facts("FOO") is None
    assert vendor.profile_calls == ["FOO"]
    assert _ask_rows() == {("FOO", "profile"): "none"}


@pytest.mark.parametrize("make_error", [
    lambda: fmp_client._ERR.transient("server error", status=502),
    lambda: fmp_client._ERR.rate_limited("rate-limited", status=429),
    lambda: fmp_client._ERR.auth_error("rejected", status=403),
    lambda: RuntimeError("anything else"),
])
def test_a_failed_read_counts_as_the_days_ask_and_is_never_an_answer(vendor, make_error):
    vendor.profile = make_error()
    assert tm.profile_facts("FOO") is None
    vendor.profile = [dict(PROFILE_ROW)]            # the vendor is back
    assert tm.profile_facts("FOO") is None, "a failed read is not an answer"
    assert vendor.profile_calls == ["FOO"], "and it is not asked for again today"
    assert _ask_rows() == {("FOO", "profile"): "failed"}


@pytest.mark.parametrize("make_refusal", [
    lambda: fmp_client._ERR.not_configured("no key"),
    lambda: fmp_client._ERR.rate_limited("local budget exhausted"),
    lambda: types.SimpleNamespace(value=None, degraded="cached_forbidden"),
])
def test_a_read_that_never_went_out_is_not_recorded_as_an_ask(vendor, make_refusal):
    vendor.profile = make_refusal()
    assert tm.profile_facts("FOO") is None
    assert _ask_rows() == {}
    vendor.profile = [dict(PROFILE_ROW)]
    assert tm.profile_facts("FOO")["name"] == "Foo Corp"


def test_below_the_member_reserve_nothing_is_asked_and_nothing_is_recorded(vendor, monkeypatch):
    """The request budget is shared with the panels a member is looking at."""
    monkeypatch.setattr(fmp_client, "tokens_available", lambda: tm._MEMBER_RESERVE_TOKENS - 1)
    assert tm.profile_facts("FOO") is None
    assert tm.share_counts("FOO") is None
    assert vendor.profile_calls == [] and vendor.share_calls == []
    assert _ask_rows() == {}
    monkeypatch.setattr(fmp_client, "tokens_available", lambda: tm._MEMBER_RESERVE_TOKENS)
    assert tm.profile_facts("FOO")["name"] == "Foo Corp"
    assert vendor.profile_calls == ["FOO"]


def test_an_unreadable_budget_does_not_stop_the_read(vendor, monkeypatch):
    def _broken():
        raise RuntimeError("no bucket")
    monkeypatch.setattr(fmp_client, "tokens_available", _broken)
    assert tm.profile_facts("FOO")["name"] == "Foo Corp"


def test_an_unreadable_record_means_no_ask_at_all(vendor, monkeypatch):
    """With no way to count the ask, none is made: the caller uses its other source."""
    def _broken(ticker, kind):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(tm, "_recorded_ask", _broken)
    assert tm.profile_facts("FOO") is None
    assert vendor.profile_calls == []
