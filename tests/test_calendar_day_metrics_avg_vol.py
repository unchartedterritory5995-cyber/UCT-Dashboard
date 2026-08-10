"""Regression tests for the `avg_vol` hole the provider-coverage monitor found.

2026-08-09, ~22:07 CT: the monitor alerted `avg_vol=0%(floor 70%, blank)` while
`market_cap` read 1.0 over the SAME 68-symbol sample. That pairing is the
fingerprint, not a coincidence — `mc_b` is SEEDED from the wire's chip data
before either provider is called, so it survives a total provider miss;
`price`/`avg_vol` have no seed and go to None.

Three independent defects, all confirmed against the live Finviz Elite export:

1. **The column was never requested.** The URL sent `v=152` with no `c=`, so the
   column set was whatever the Finviz Elite ACCOUNT's saved custom view held —
   account state deciding a data contract. Live probe: 11 columns, `Avg Volume`
   not among them. Adding `c=1,6,63,65,67` returns it (63 = Average Volume).
2. **The header name never matched.** Finviz emits `Average Volume`; the code
   asked `_gcol(row, "Avg Volume")`, which resolves to None for every row of
   every date forever.
3. **A Finviz response with no usable columns SUPPRESSED the fallback.**
   `fv_ok = True` is set on any 200 with a body, so the Massive leg — which
   fills avg_vol from `snap["vol"]` — could never run, and `have_data = fv_ok`
   then cached the hole at the FULL 24h past-date TTL.

Units: Finviz exports Average Volume in THOUSANDS (AAPL `56908.91` = ~56.9M
shares) while `Volume` is raw. Reading it unscaled is a silent 1000x
under-count that would have shipped the moment the column name was fixed —
which is why the scaling is asserted here and not left to the caller.
"""
from unittest import mock

from api.routers import calendar as cal


# The live shape when the columns ARE requested (probe, 2026-08-09).
_CSV_WITH_AVG_VOL = (
    '"Ticker","Market Cap","Average Volume","Price","Volume"\r\n'
    '"AAPL","4572794.13","56908.91","313.33","34437191"\r\n'
    '"MSFT","3700000.00","18108.34","592.10","11250258"\r\n'
)

# The live shape production actually received: a 200 with real rows and NO
# average-volume column at all.
_CSV_WITHOUT_AVG_VOL = (
    '"No.","Ticker","Company","Sector","Industry","Country","Market Cap","P/E","Volume","Price","Change"\r\n'
    '1,"AAPL","Apple Inc","Technology","Consumer Electronics","USA","4572794.13","38.1","34437191","313.33","1.2%"\r\n'
    '2,"MSFT","Microsoft","Technology","Software","USA","3700000.00","31.0","11250258","592.10","0.4%"\r\n'
)


class _Resp:
    def __init__(self, text, ok=True):
        self.text = text
        self.ok = ok


def _stub_day(monkeypatch, syms=("AAPL", "MSFT")):
    monkeypatch.setattr(cal, "_days_for_date", lambda d: {"fake": "day"})
    monkeypatch.setattr(cal, "_day_entries", lambda day: [{"sym": s} for s in syms])


def _ttl_remaining(key):
    import time
    _, expires_at = cal.cache._store[key]
    return expires_at - time.time()


class _NoMassive:
    """Massive must not be consulted at all when Finviz answered completely."""

    def __init__(self):
        self.called = False

    def get_batch_rich_snapshots(self, syms):
        self.called = True
        return {}


class TestFinvizAvgVolumeColumn:
    DATE = "2026-07-20"

    def setup_method(self):
        cal.cache.invalidate(f"calendar_metrics_{self.DATE}")

    def test_the_export_url_requests_the_average_volume_column_explicitly(self, monkeypatch):
        """Without `c=`, the returned columns are whatever the Finviz Elite
        account's saved custom view holds — so the data contract lives in
        someone's browser settings, not in this repo. Column 63 is Average
        Volume; asking for it by id is what makes the response deterministic."""
        monkeypatch.setenv("FINVIZ_API_KEY", "test-token")
        _stub_day(monkeypatch)
        seen = {}

        def _fake_get(url, **kw):
            seen["url"] = url
            return _Resp(_CSV_WITH_AVG_VOL)

        monkeypatch.setattr("requests.get", _fake_get)
        monkeypatch.setattr("api.services.massive._get_client", lambda: _NoMassive())

        cal.get_day_metrics(date_str=self.DATE)

        assert "c=" in seen["url"], f"no explicit column list in {seen['url']!r}"
        cols = seen["url"].split("c=", 1)[1].split("&")[0].split(",")
        assert "63" in cols, f"Average Volume (63) not requested; got c={cols}"

    def test_average_volume_header_is_read_and_scaled_from_thousands(self, monkeypatch):
        """Finviz emits the header `Average Volume` (not `Avg Volume`) and the
        value in THOUSANDS. AAPL's 56908.91 is ~56.9M shares — the scale is
        part of reading the field correctly, not a caller's problem."""
        monkeypatch.setenv("FINVIZ_API_KEY", "test-token")
        _stub_day(monkeypatch)
        monkeypatch.setattr("requests.get", lambda url, **kw: _Resp(_CSV_WITH_AVG_VOL))
        monkeypatch.setattr("api.services.massive._get_client", lambda: _NoMassive())

        out = cal.get_day_metrics(date_str=self.DATE)

        assert out["AAPL"]["avg_vol"] == 56_908_910
        assert out["MSFT"]["avg_vol"] == 18_108_340
        assert out["AAPL"]["price"] == 313.33

    def test_finviz_without_the_column_falls_back_to_massive_for_avg_vol(self, monkeypatch):
        """THE WIRE TEST. Finviz answers 200 with real rows and real prices but
        no average-volume column — exactly what production received. `fv_ok`
        alone would call that a success and skip the fallback, leaving avg_vol
        None for every symbol. The Massive leg must still run and fill it,
        WITHOUT clobbering the good Finviz price."""
        monkeypatch.setenv("FINVIZ_API_KEY", "test-token")
        _stub_day(monkeypatch)
        monkeypatch.setattr("requests.get", lambda url, **kw: _Resp(_CSV_WITHOUT_AVG_VOL))

        class _Client:
            def get_batch_rich_snapshots(self, syms):
                return {"AAPL": {"price": 999.0, "vol": 44_000_000},
                        "MSFT": {"price": 888.0, "vol": 22_000_000}}

        monkeypatch.setattr("api.services.massive._get_client", lambda: _Client())

        out = cal.get_day_metrics(date_str=self.DATE)

        assert out["AAPL"]["avg_vol"] == 44_000_000
        assert out["MSFT"]["avg_vol"] == 22_000_000
        # Finviz's price was real — the fallback fills gaps, it does not overwrite.
        assert out["AAPL"]["price"] == 313.33

    def test_a_day_with_no_avg_vol_at_all_is_not_cached_for_24h(self, monkeypatch):
        """A past date normally pins for 24h. A day where BOTH legs failed to
        produce a single avg_vol is a provider hole, and pinning it means the
        volume filter silently excludes everything until tomorrow."""
        monkeypatch.setenv("FINVIZ_API_KEY", "test-token")
        _stub_day(monkeypatch)
        monkeypatch.setattr("requests.get", lambda url, **kw: _Resp(_CSV_WITHOUT_AVG_VOL))

        class _NoVol:
            def get_batch_rich_snapshots(self, syms):
                return {"AAPL": {"price": 1.0, "vol": None}}

        monkeypatch.setattr("api.services.massive._get_client", lambda: _NoVol())

        cal.get_day_metrics(date_str=self.DATE)

        key = f"calendar_metrics_{self.DATE}"
        assert _ttl_remaining(key) <= cal._METRICS_FAIL_TTL + 5
        assert _ttl_remaining(key) < 24 * 3600

    def test_control_a_complete_finviz_day_keeps_the_long_ttl_and_skips_massive(self, monkeypatch):
        """Control for the two tests above: a healthy Finviz response must
        still get the full past-date TTL and must NOT spend a Massive call.
        Without this, 'always short TTL / always call Massive' would pass."""
        monkeypatch.setenv("FINVIZ_API_KEY", "test-token")
        _stub_day(monkeypatch)
        monkeypatch.setattr("requests.get", lambda url, **kw: _Resp(_CSV_WITH_AVG_VOL))
        client = _NoMassive()
        monkeypatch.setattr("api.services.massive._get_client", lambda: client)

        cal.get_day_metrics(date_str=self.DATE)

        assert client.called is False
        assert _ttl_remaining(f"calendar_metrics_{self.DATE}") > cal._METRICS_FAIL_TTL
