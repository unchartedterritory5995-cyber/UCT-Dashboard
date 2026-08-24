"""Historical expected-move reconstruction.

The stakes here are unusual: these rows land in the SAME table as live
nightly captures and are compared against them to produce the RICH/CHEAP
verdict. A backfill that used a slightly different method would not look
broken — it would look like an edge. So the tests below are mostly about
sameness: same expiry rule, same ATM pick, same mid math, same shape.
"""
import datetime as _dt
import logging
import time

import pytest

from api.services import implied_backfill as ib
from api.services import polygon_options
from api.services.implied_move import straddle_from_rows

REPORT = "2025-11-19"
PRIOR = "2025-11-18"
PRIOR_MS = int(_dt.datetime(2025, 11, 18, tzinfo=_dt.timezone.utc).timestamp() * 1000)

# Real shapes, trimmed: NVDA's Nov-2025 report, verified live 2026-08-06
# (reconstructed implied move +/-7.72% at strike 182.5 against spot 181.36).
SPOT = 181.36
STRIKES = [175.0, 180.0, 182.5, 185.0]
QUOTES = {  # option ticker -> (bid, ask)
    "O:NVDA251121C00182500": (6.95, 7.05),
    "O:NVDA251121P00182500": (6.95, 7.05),
    "O:NVDA251121C00180000": (8.10, 8.20),
    "O:NVDA251121P00180000": (5.60, 5.70),
    "O:NVDA251121C00175000": (11.0, 11.2),
    "O:NVDA251121P00175000": (3.6, 3.7),
    "O:NVDA251121C00185000": (5.5, 5.6),
    "O:NVDA251121P00185000": (8.4, 8.5),
}


def _contract_rows(expiry="2025-11-21"):
    out = []
    for s in STRIKES:
        cents = f"{int(s * 1000):08d}"
        out.append({"ticker": f"O:NVDA251121C{cents}", "strike_price": s,
                    "contract_type": "call", "expiration_date": expiry})
        out.append({"ticker": f"O:NVDA251121P{cents}", "strike_price": s,
                    "contract_type": "put", "expiration_date": expiry})
    return out


class FakeApi:
    """Records every URL/params pair so the tests can assert on WHAT was
    asked for, not merely on what came back."""

    def __init__(self, *, expirations=("2025-11-21", "2025-11-28"), quotes=None,
                 agg_results=None):
        self.calls = []
        self.expirations = list(expirations)
        self.quotes = QUOTES if quotes is None else quotes
        self.agg_results = ([{"c": SPOT, "t": PRIOR_MS}]
                            if agg_results is None else agg_results)

    def __call__(self, url, params=None):
        params = params or {}
        self.calls.append((url, params))
        if "/v2/aggs/" in url:
            return {"results": self.agg_results}
        if "/v3/reference/options/contracts" in url:
            if "expiration_date.gte" in params:
                return {"results": [{"expiration_date": e} for e in self.expirations]}
            return {"results": _contract_rows(params.get("expiration_date"))}
        if "/v3/quotes/" in url:
            tick = url.rsplit("/", 1)[-1]
            q = self.quotes.get(tick)
            if not q:
                return {"results": []}
            return {"results": [{"bid_price": q[0], "ask_price": q[1]}]}
        raise AssertionError(f"unexpected URL {url}")


@pytest.fixture
def api(monkeypatch):
    fake = FakeApi()
    monkeypatch.setattr(polygon_options, "_safe_get", fake)
    return fake


class TestFaithfulness:
    def test_matches_the_live_straddle_math_exactly(self, api):
        out = ib.historical_expected_move("NVDA", REPORT)
        assert out is not None
        # Independently compute what the LIVE helper produces from the same
        # rows. If the backfill ever grows its own arithmetic, this diverges.
        calls = [{"strike": 182.5, "bid": 6.95, "ask": 7.05}]
        puts = [{"strike": 182.5, "bid": 6.95, "ask": 7.05}]
        expected = straddle_from_rows(calls, puts, SPOT)
        assert out["pct"] == pytest.approx(expected["pct"])
        assert out["dollar"] == pytest.approx(expected["dollar"])
        assert out["strike"] == 182.5          # nearest strike to 181.36

    def test_prices_off_bid_ask_mids_not_a_single_number(self, api):
        """The whole reason this module uses /v3/quotes rather than daily
        aggregates. mid(6.95, 7.05) = 7.00 per leg, 14.00 for the straddle."""
        out = ib.historical_expected_move("NVDA", REPORT)
        assert out["dollar"] == pytest.approx(14.00)
        assert out["pct"] == pytest.approx(14.00 / SPOT * 100)

    def test_asks_for_contracts_as_of_the_PRIOR_session(self, api):
        """Without `as_of` the strike ladder would be TODAY's, silently
        including strikes listed after the report."""
        ib.historical_expected_move("NVDA", REPORT)
        ref = [p for (u, p) in api.calls if "/v3/reference/options/contracts" in u]
        assert ref, "no contract discovery call was made"
        for p in ref:
            assert p.get("as_of") == PRIOR

    def test_reads_quotes_at_or_before_the_prior_close(self, api):
        ib.historical_expected_move("NVDA", REPORT)
        qs = [p for (u, p) in api.calls if "/v3/quotes/" in u]
        assert qs
        for p in qs:
            assert p["timestamp.lte"].startswith(PRIOR)
            assert p["order"] == "desc"

    def test_picks_the_first_expiry_on_or_after_the_report(self, monkeypatch):
        fake = FakeApi(expirations=("2025-11-28", "2025-11-21", "2025-12-19"))
        monkeypatch.setattr(polygon_options, "_safe_get", fake)
        out = ib.historical_expected_move("NVDA", REPORT)
        assert out["expiry"] == "2025-11-21"

    def test_never_picks_an_expiry_BEFORE_the_report(self, monkeypatch):
        """The request already filters with expiration_date.gte, so this can
        only happen if that param is dropped or the API stops honouring it --
        which is exactly why the local rule (select_report_expiry, the same
        one the live path uses) must stand on its own. An expiry that lands
        before the report captures none of the earnings move, so the number
        would be confidently wrong rather than missing.

        A mutation replacing select_report_expiry with sorted(...)[0] SURVIVED
        until this case existed.
        """
        fake = FakeApi(expirations=("2025-11-14", "2025-11-21"))
        monkeypatch.setattr(polygon_options, "_safe_get", fake)
        out = ib.historical_expected_move("NVDA", REPORT)
        assert out["expiry"] == "2025-11-21"

    def test_all_expiries_before_the_report_yields_nothing(self, monkeypatch):
        fake = FakeApi(expirations=("2025-11-07", "2025-11-14"))
        monkeypatch.setattr(polygon_options, "_safe_get", fake)
        assert ib.historical_expected_move("NVDA", REPORT) is None

    def test_rows_are_marked_as_backfill(self, api):
        out = ib.historical_expected_move("NVDA", REPORT)
        assert out["source"] == "massive-backfill"
        assert out["source"] != "massive-chain"     # never confusable with live
        assert out["as_of"] == PRIOR

    def test_dual_class_symbol_is_mapped_at_the_massive_boundary(self, monkeypatch):
        fake = FakeApi()
        monkeypatch.setattr(polygon_options, "_safe_get", fake)
        ib.historical_expected_move("BRK-B", REPORT)
        unders = [p.get("underlying_ticker") for (u, p) in fake.calls
                  if "/v3/reference/options/contracts" in u]
        assert unders and all(u == "BRK.B" for u in unders), unders
        assert any("BRK.B" in u for (u, _) in fake.calls if "/v2/aggs/" in u)


class TestRefusals:
    """Every leg absent must yield None, never a fabricated number."""

    def test_no_prior_session_close(self, monkeypatch):
        monkeypatch.setattr(polygon_options, "_safe_get", FakeApi(agg_results=[]))
        assert ib.historical_expected_move("NVDA", REPORT) is None

    def test_report_beyond_every_listed_expiry(self, monkeypatch):
        monkeypatch.setattr(polygon_options, "_safe_get", FakeApi(expirations=()))
        assert ib.historical_expected_move("NVDA", REPORT) is None

    def test_no_historical_quotes(self, monkeypatch):
        monkeypatch.setattr(polygon_options, "_safe_get", FakeApi(quotes={}))
        assert ib.historical_expected_move("NVDA", REPORT) is None

    def test_only_one_side_quoted_is_not_half_a_straddle(self, monkeypatch):
        calls_only = {k: v for k, v in QUOTES.items() if "C00" in k}
        monkeypatch.setattr(polygon_options, "_safe_get", FakeApi(quotes=calls_only))
        assert ib.historical_expected_move("NVDA", REPORT) is None

    def test_a_provider_exception_never_escapes(self, monkeypatch):
        def boom(url, params=None):
            raise RuntimeError("massive is down")
        monkeypatch.setattr(polygon_options, "_safe_get", boom)
        assert ib.historical_expected_move("NVDA", REPORT) is None

    @pytest.mark.parametrize("sym,date", [("", REPORT), ("NVDA", ""), ("NVDA", "not-a-date")])
    def test_junk_input(self, api, sym, date):
        assert ib.historical_expected_move(sym, date) is None

    def test_zero_or_negative_spot_is_refused(self, monkeypatch):
        monkeypatch.setattr(polygon_options, "_safe_get",
                            FakeApi(agg_results=[{"c": 0, "t": PRIOR_MS}]))
        assert ib.historical_expected_move("NVDA", REPORT) is None


class TestStoreCompatibility:
    def test_payload_has_every_field_record_implied_reads(self, api):
        out = ib.historical_expected_move("NVDA", REPORT)
        for key in ("pct", "dollar", "expiry", "strike", "spot", "iv_atm", "source"):
            assert key in out, key

    def test_backfill_never_overwrites_a_live_capture(self, api, tmp_path, monkeypatch):
        """record_implied is INSERT OR IGNORE on (sym, report_date). A live
        row must win over a backfilled one no matter which order they arrive,
        because the live capture is the real observation."""
        from api.services import implied_store as store
        # DB_PATH, not _DB_PATH: patching a name the module does not have
        # (with raising=False) silently creates a dead attribute and the test
        # writes to the REAL data dir. raising defaults to True here ON
        # PURPOSE so a future rename fails loudly instead of leaking again.
        monkeypatch.setattr(store, "DB_PATH", str(tmp_path / "implied.db"))
        monkeypatch.setattr(store, "_INITIALIZED", set())

        live = {"pct": 6.0, "dollar": 11.0, "expiry": "2025-11-21", "strike": 182.5,
                "spot": SPOT, "iv_atm": 0.6, "source": "massive-chain"}
        store.record_implied("NVDA", REPORT, live, "2025-11-18T21:00:00Z")
        back = ib.historical_expected_move("NVDA", REPORT)
        store.record_implied("NVDA", REPORT, back, "2026-08-06T00:00:00Z")

        rows = store.get_implied_history("NVDA", limit=5)
        assert len(rows) == 1
        assert rows[0]["pct"] == pytest.approx(6.0)   # the LIVE number survived


class TestFiscalJoin:
    """`past_reports` joins FMP announcement dates to Finnhub fiscal labels.

    A wrong label here does NOT fail loudly — it pairs an implied snapshot
    against a real but incorrect quarter's realized move, producing a
    confident RICH/CHEAP verdict about the wrong event. Fixtures below are
    live responses captured 2026-08-06.
    """

    # Finnhub `period` is the calendar quarter-end CONTAINING the fiscal
    # period end, so it falls on EITHER side of the announcement depending on
    # the company's fiscal calendar. That is what defeats both single-sided
    # join rules.
    FINNHUB = {
        # NVDA: fiscal year ends January. Q3 FY2026 ended Oct 26 2025,
        # announced Nov 19 2025 -> its period bucket (2025-12-31) is AFTER it.
        "NVDA": [("2026-06-30", 2027, 1), ("2026-03-31", 2026, 4),
                 ("2025-12-31", 2026, 3), ("2025-09-30", 2026, 2)],
        # AAPL: fiscal year ends September. Q4 FY2025 ended Sep 27 2025,
        # announced Oct 30 2025 -> its bucket (2025-09-30) is BEFORE it.
        "AAPL": [("2026-03-31", 2026, 2), ("2025-12-31", 2026, 1),
                 ("2025-09-30", 2025, 4), ("2025-06-30", 2025, 3)],
    }
    FMP = {
        "NVDA": ["2026-08-26", "2026-05-20", "2026-02-25", "2025-11-19"],
        "AAPL": ["2026-04-30", "2026-01-29", "2025-10-30", "2025-07-31"],
    }

    @pytest.fixture(autouse=True)
    def _fallback_leg_only(self, monkeypatch):
        """Every test in this class is about the Finnhub FALLBACK, so make the
        FMP primary shrug DELIBERATELY. Left implicit, these tests pass only
        because the test environment happens to have no FMP_API_KEY."""
        monkeypatch.setattr(ib, "fmp_beat_history", lambda s, limit=8: None)

    @pytest.fixture
    def providers(self, monkeypatch):
        import tools.implied_backfill_run as run
        from api.services import earnings_estimates as ee_mod

        def fake_fmp(path, params):
            return [{"date": d} for d in self.FMP[params["symbol"]]]

        def fake_fh(path, params):
            return [{"period": p, "year": y, "quarter": q}
                    for (p, y, q) in self.FINNHUB[params["symbol"]]]

        monkeypatch.setattr(ee_mod, "_fmp_get", fake_fmp)
        monkeypatch.setattr(ee_mod, "_fh_get", fake_fh)
        monkeypatch.setattr(ib, "_FH_PACE_SECONDS", 0.0)   # no real sleeping in tests
        # This class tests the FALLBACK leg, so silence the FMP primary
        # EXPLICITLY. Without this the tests still pass — but only because the
        # test environment has no FMP_API_KEY, so the primary shrugs by
        # accident. On a machine that has one they would make live HTTP calls
        # and assert against whatever the market did that day.
        monkeypatch.setattr(ib, "fmp_beat_history", lambda s, limit=8: None)
        return run

    def test_off_calendar_filer_gets_the_right_quarter(self, providers):
        """NVDA is the case a 'most recent period before the announcement'
        rule mislabels — every quarter, by exactly one, silently."""
        got = {r["report_date"]: (r["fiscal_year"], r["fiscal_quarter"])
               for r in ib.past_reports("NVDA", 4)}
        assert got["2025-11-19"] == (2026, 3)
        assert got["2026-02-25"] == (2026, 4)
        assert got["2026-05-20"] == (2027, 1)

    def test_september_filer_gets_the_right_quarter(self, providers):
        """AAPL is the mirror case, which an 'on or after' rule mislabels."""
        got = {r["report_date"]: (r["fiscal_year"], r["fiscal_quarter"])
               for r in ib.past_reports("AAPL", 4)}
        assert got["2025-10-30"] == (2025, 4)
        assert got["2026-01-29"] == (2026, 1)
        assert got["2026-04-30"] == (2026, 2)

    def test_future_announcements_are_excluded(self, providers):
        """NVDA's 2026-08-26 row has not reported — there is no implied move
        to reconstruct and no realized move to pair it against."""
        dates = [r["report_date"] for r in ib.past_reports("NVDA", 8)]
        assert "2026-08-26" not in dates

    def test_one_quarter_is_never_claimed_twice(self, monkeypatch):
        """Two announcements can land in one fiscal bucket — a restatement, a
        duplicated provider row, or a preliminary followed by a final. Only
        one may be kept: the store is keyed on (sym, report_date), so a second
        row would quietly add a SECOND implied move for one quarter and skew
        whatever the verdict averages.

        The fixture must actually collide; an earlier version of this test
        asserted uniqueness over data that was already unique and passed
        vacuously (a mutation removing the dedupe survived it).
        """
        import tools.implied_backfill_run as run
        from api.services import earnings_estimates as ee_mod
        # Both announcements sit inside the same quarter bucket.
        monkeypatch.setattr(ee_mod, "_fmp_get", lambda p, q: [
            {"date": "2025-11-19"}, {"date": "2025-11-25"},
        ])
        monkeypatch.setattr(ee_mod, "_fh_get", lambda p, q: [
            {"period": "2025-12-31", "year": 2026, "quarter": 3},
        ])
        rows = ib.past_reports("NVDA", 8)
        assert len(rows) == 1, rows
        assert (rows[0]["fiscal_year"], rows[0]["fiscal_quarter"]) == (2026, 3)
        # Newest wins — announcements are walked newest-first.
        assert rows[0]["report_date"] == "2025-11-25"

    def test_distinct_quarters_all_survive(self, providers):
        rows = ib.past_reports("NVDA", 8)
        keys = [(r["fiscal_year"], r["fiscal_quarter"]) for r in rows]
        assert len(keys) == len(set(keys))
        assert len(keys) >= 3

    def test_a_far_away_period_is_refused_not_least_wrong(self, monkeypatch):
        """With no plausible bucket, "nearest" degenerates into "least far
        wrong" — which is the silent mispairing this whole rule exists to
        prevent. Refuse instead."""
        import tools.implied_backfill_run as run
        from api.services import earnings_estimates as ee_mod
        monkeypatch.setattr(ee_mod, "_fmp_get", lambda p, q: [{"date": "2025-11-19"}])
        monkeypatch.setattr(ee_mod, "_fh_get",
                            lambda p, q: [{"period": "2023-03-31", "year": 2023, "quarter": 1}])
        assert ib.past_reports("NVDA", 4) == []


class TestFmpIsThePrimaryFiscalSource:
    """FMP resolves BOTH halves, so Finnhub is a fallback rather than a leg.

    This is a throughput change as much as a correctness one. The Finnhub leg
    is paced 3s/symbol against a bucket shared with live members; across 739
    symbols that is ~37 minutes of pure sleeping in a nightly job that has
    repeatedly failed to reach the end of the alphabet. Every assertion below
    about "no Finnhub call" is really an assertion about that time.
    """

    ROWS = [  # the shape `fmp_beat_history` returns, newest first
        {"report_date": "2026-08-03", "year": 2026, "quarter": 2},
        {"report_date": "2026-05-05", "year": 2026, "quarter": 1},
        {"report_date": "2026-02-24", "year": 2025, "quarter": 4},
        {"report_date": "2025-11-05", "year": 2025, "quarter": 3},
    ]

    @pytest.fixture
    def fh_spy(self, monkeypatch):
        """Counts Finnhub calls and makes any real sleep fail loudly."""
        from api.services import earnings_estimates as ee_mod
        calls = {"n": 0}

        def spy(path, params):
            calls["n"] += 1
            return []

        monkeypatch.setattr(ee_mod, "_fh_get", spy)
        monkeypatch.setattr(ib, "_FH_PACE_SECONDS", 0.0)
        return calls

    def test_fmp_identity_is_used_and_finnhub_is_never_called(self, monkeypatch, fh_spy):
        monkeypatch.setattr(ib, "fmp_beat_history", lambda s, limit=8: list(self.ROWS))
        got = {r["report_date"]: (r["fiscal_year"], r["fiscal_quarter"])
               for r in ib.past_reports("JAZZ", 4)}
        assert got["2026-08-03"] == (2026, 2)
        assert got["2026-02-24"] == (2025, 4)
        assert fh_spy["n"] == 0, "the shared Finnhub budget was spent anyway"

    def test_a_report_not_yet_announced_is_excluded(self, monkeypatch, fh_spy):
        """There is no prior-session straddle to reconstruct for a report that
        has not happened, and today's belongs to the live capture."""
        today = _dt.date.today().isoformat()
        future = (_dt.date.today() + _dt.timedelta(days=30)).isoformat()
        rows = [{"report_date": future, "year": 2027, "quarter": 1},
                {"report_date": today, "year": 2026, "quarter": 4}] + self.ROWS
        monkeypatch.setattr(ib, "fmp_beat_history", lambda s, limit=8: rows)
        dates = [r["report_date"] for r in ib.past_reports("JAZZ", 8)]
        assert future not in dates and today not in dates
        assert "2026-08-03" in dates

    def test_limit_is_respected(self, monkeypatch, fh_spy):
        monkeypatch.setattr(ib, "fmp_beat_history", lambda s, limit=8: list(self.ROWS))
        assert len(ib.past_reports("JAZZ", 2)) == 2

    @pytest.mark.parametrize("fmp_result, why", [
        (None, "a shrug — the provider never answered"),
        ([], "answered, but with no history"),
        ([{"report_date": "2026-08-03", "year": None, "quarter": None}],
         "answered, but the income statement carried no fiscal identity"),
    ])
    def test_falls_back_to_finnhub_rather_than_dropping_the_symbol(
            self, monkeypatch, fmp_result, why):
        """A bad FMP response must not be indistinguishable from 'this company
        has never reported' — that would skip the symbol for good."""
        from api.services import earnings_estimates as ee_mod
        monkeypatch.setattr(ib, "fmp_beat_history", lambda s, limit=8: fmp_result)
        monkeypatch.setattr(ib, "_FH_PACE_SECONDS", 0.0)
        monkeypatch.setattr(ee_mod, "_fmp_get", lambda p, q: [{"date": "2025-11-19"}])
        monkeypatch.setattr(
            ee_mod, "_fh_get",
            lambda p, q: [{"period": "2025-12-31", "year": 2026, "quarter": 3}])
        got = ib.past_reports("NVDA", 4)
        assert got == [{"report_date": "2025-11-19",
                        "fiscal_year": 2026, "fiscal_quarter": 3}], why

    def test_an_exception_from_fmp_falls_back_instead_of_escaping(self, monkeypatch):
        """`past_reports` runs inside the sweep's per-symbol try, but raising
        here would still cost the symbol its Finnhub fallback."""
        from api.services import earnings_estimates as ee_mod

        def boom(sym, limit=8):
            raise RuntimeError("provider exploded")

        monkeypatch.setattr(ib, "fmp_beat_history", boom)
        monkeypatch.setattr(ib, "_FH_PACE_SECONDS", 0.0)
        monkeypatch.setattr(ee_mod, "_fmp_get", lambda p, q: [{"date": "2025-11-19"}])
        monkeypatch.setattr(
            ee_mod, "_fh_get",
            lambda p, q: [{"period": "2025-12-31", "year": 2026, "quarter": 3}])
        assert ib.past_reports("NVDA", 4)[0]["fiscal_quarter"] == 3

    def test_the_real_fmp_leg_is_wired_up_end_to_end(self, monkeypatch, fh_spy):
        """The tests above stub `fmp_beat_history`. This one drives the actual
        function through faked HTTP so a broken import or a renamed key can't
        pass silently."""
        from api.services import earnings_estimates as ee_mod

        def fake_fmp(path, params):
            if "income-statement" in path:
                return [{"date": "2026-06-30", "period": "Q2",
                         "fiscalYear": "2026", "acceptedDate": "2026-08-03 16:05:00"}]
            return [{"date": "2026-08-03", "epsActual": 5.71, "epsEstimated": 6.18}]

        # Patching the OWNING module is the whole point: `earnings_history_fmp`
        # resolves `_fmp_get` through `earnings_estimates` at call time rather
        # than binding its own copy, so it cannot escape the guards (or the
        # stubs) that every other caller goes through.
        monkeypatch.setattr(ee_mod, "_fmp_get", fake_fmp)
        got = ib.past_reports("JAZZ", 4)
        assert got == [{"report_date": "2026-08-03",
                        "fiscal_year": 2026, "fiscal_quarter": 2}]
        assert fh_spy["n"] == 0


def test_all_symbols_returns_distinct_syms(tmp_path, monkeypatch):
    """--from-store depends on this; an earlier version of the tool guarded it
    with hasattr and would have silently exited 2 instead of backfilling."""
    from api.services import implied_store as store
    monkeypatch.setattr(store, "DB_PATH", str(tmp_path / "i.db"))
    monkeypatch.setattr(store, "_INITIALIZED", set())
    assert store.all_symbols() == []
    p = {"pct": 5.0, "dollar": 9.0, "expiry": "2025-11-21", "strike": 1.0,
         "spot": 1.0, "iv_atm": None, "source": "massive-backfill"}
    store.record_implied("NVDA", "2025-11-19", p, "2025-11-18T21:00:00Z")
    store.record_implied("NVDA", "2025-08-27", p, "2025-08-26T21:00:00Z")
    store.record_implied("AAPL", "2025-10-30", p, "2025-10-29T21:00:00Z")
    assert store.all_symbols() == ["AAPL", "NVDA"]


class TestScaleMismatch:
    """A split between the report and now puts spot and strikes on different
    scales. `straddle_from_rows` picks the NEAREST strike, so it cannot detect
    this — it returns a well-formed straddle on a deep-OTM pair and the implied
    move comes out enormous but confident. That is the exact failure mode this
    whole module is written to avoid, so it gets an explicit backstop.
    """

    def test_spot_is_requested_UNADJUSTED(self, api):
        """Split-adjusted closes are restated into today's share terms;
        `as_of` strikes are the ones listed then. They must match."""
        ib.historical_expected_move("NVDA", REPORT)
        aggs = [p for (u, p) in api.calls if "/v2/aggs/" in u]
        assert aggs, "no spot fetch"
        for p in aggs:
            assert p["adjusted"] == "false", p

    def test_far_from_the_money_atm_is_refused(self, monkeypatch):
        # Spot restated 10:1 lower than the strikes that existed then: the
        # nearest strike (175) is ~10x spot.
        fake = FakeApi(agg_results=[{"c": 18.14, "t": PRIOR_MS}])
        monkeypatch.setattr(polygon_options, "_safe_get", fake)
        assert ib.historical_expected_move("NVDA", REPORT) is None

    def test_a_normal_atm_pick_still_passes(self, api):
        out = ib.historical_expected_move("NVDA", REPORT)
        assert out is not None
        assert abs(out["strike"] - out["spot"]) / out["spot"] <= 0.20


class TestFinnhubPacing:
    """Finnhub's budget is a process-wide bucket SHARED WITH LIVE MEMBER
    TRAFFIC. Unpaced, the 739-symbol sweep 429'd on its FIRST call, engaged a
    20s shared cooldown, then raced through every remaining symbol getting
    empty responses — and reported success having written almost nothing.
    Measured on production 2026-08-06: 25 symbols, 25 empty, 1.5 seconds.

    Finnhub is now the FALLBACK leg (FMP resolves both halves), so this pacing
    is rarely paid — but it still has to be right when it is.
    """

    @pytest.fixture(autouse=True)
    def _fallback_leg_only(self, monkeypatch):
        """Reach the Finnhub leg deliberately rather than by accident of an
        unset FMP_API_KEY — see the note on TestFiscalJoin."""
        monkeypatch.setattr(ib, "fmp_beat_history", lambda s, limit=8: None)

    def test_an_empty_finnhub_response_is_retried_not_accepted(self, monkeypatch):
        """The bug: a cooldown-induced empty read was indistinguishable from
        'this company has no earnings history', so the symbol was dropped."""
        import tools.implied_backfill_run as run
        from api.services import earnings_estimates as ee_mod
        monkeypatch.setattr(ib, "_FH_PACE_SECONDS", 0.0)
        monkeypatch.setattr(ib, "_FH_COOLDOWN_WAIT", 0.0)
        monkeypatch.setattr(ee_mod, "_fmp_get", lambda p, q: [{"date": "2025-11-19"}])
        calls = {"n": 0}

        def flaky(path, params):
            calls["n"] += 1
            if calls["n"] == 1:
                return []                     # the 429 cooldown window
            return [{"period": "2025-12-31", "year": 2026, "quarter": 3}]

        monkeypatch.setattr(ee_mod, "_fh_get", flaky)
        rows = ib.past_reports("NVDA", 4)
        assert calls["n"] == 2, "should have retried through the cooldown"
        assert rows and (rows[0]["fiscal_year"], rows[0]["fiscal_quarter"]) == (2026, 3)

    def test_gives_up_after_the_attempt_budget(self, monkeypatch):
        """A ticker Finnhub genuinely does not cover must not retry forever."""
        import tools.implied_backfill_run as run
        from api.services import earnings_estimates as ee_mod
        monkeypatch.setattr(ib, "_FH_PACE_SECONDS", 0.0)
        monkeypatch.setattr(ib, "_FH_COOLDOWN_WAIT", 0.0)
        monkeypatch.setattr(ee_mod, "_fmp_get", lambda p, q: [{"date": "2025-11-19"}])
        calls = {"n": 0}

        def always_empty(path, params):
            calls["n"] += 1
            return []

        monkeypatch.setattr(ee_mod, "_fh_get", always_empty)
        assert ib.past_reports("NVDA", 4) == []
        assert calls["n"] == ib._FH_ATTEMPTS

    def test_no_finnhub_call_at_all_when_fmp_has_nothing(self, monkeypatch):
        """Don't spend the shared budget on a symbol we already know we cannot
        place — FMP supplies the announcement dates the labels attach to."""
        import tools.implied_backfill_run as run
        from api.services import earnings_estimates as ee_mod
        monkeypatch.setattr(run, "_FH_PACE_SECONDS", 0.0)
        monkeypatch.setattr(ee_mod, "_fmp_get", lambda p, q: [])
        called = {"n": 0}

        def spy(path, params):
            called["n"] += 1
            return []

        monkeypatch.setattr(ee_mod, "_fh_get", spy)
        assert ib.past_reports("NVDA", 4) == []
        assert called["n"] == 0

    def test_every_finnhub_call_is_actually_paced(self, monkeypatch):
        """Pacing is the whole reason this job stops starving live traffic, so
        assert the sleep really happens at the configured interval rather than
        trusting that the line is present. (Other tests set the pace to 0, so a
        mutation deleting the sleep is invisible to them.)"""
        import tools.implied_backfill_run as run
        from api.services import earnings_estimates as ee_mod
        monkeypatch.setattr(ib, "_FH_PACE_SECONDS", 2.5)
        slept = []
        monkeypatch.setattr(ib.time, "sleep", lambda s: slept.append(s))
        monkeypatch.setattr(ee_mod, "_fmp_get", lambda p, q: [{"date": "2025-11-19"}])
        monkeypatch.setattr(ee_mod, "_fh_get",
                            lambda p, q: [{"period": "2025-12-31", "year": 2026, "quarter": 3}])
        ib.past_reports("NVDA", 4)
        assert 2.5 in slept, f"no pacing sleep observed: {slept}"


class TestNightlySweep:
    """The sweep is what makes this durable. A one-shot script has to be
    babysat and dies with its shell; a bounded, incremental cron re-registers
    on every boot and simply continues tomorrow.
    """

    @pytest.fixture
    def sweep_env(self, monkeypatch, tmp_path):
        from api.services import implied_store as store
        monkeypatch.setattr(store, "DB_PATH", str(tmp_path / "s.db"))
        monkeypatch.setattr(store, "_INITIALIZED", set())
        monkeypatch.setattr(ib, "_FH_PACE_SECONDS", 0.0)
        return store

    def test_writes_what_is_missing_and_skips_what_it_has(self, sweep_env, monkeypatch, api):
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: ["NVDA"])
        monkeypatch.setattr(ib, "past_reports", lambda s, q: [
            {"report_date": REPORT, "fiscal_year": 2026, "fiscal_quarter": 3},
        ])
        out = ib.run_backfill_sweep()
        assert "wrote 1" in out, out
        assert len(store.get_implied_history("NVDA")) == 1

        # Second night: nothing new to do, and crucially it does NOT refetch.
        out2 = ib.run_backfill_sweep()
        assert "wrote 0" in out2 and "already had 1" in out2, out2

    def test_the_time_ceiling_stops_it_and_says_so(self, sweep_env, monkeypatch, api):
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: [f"SYM{i}" for i in range(50)])
        monkeypatch.setattr(ib, "past_reports", lambda s, q: [
            {"report_date": REPORT, "fiscal_year": 2026, "fiscal_quarter": 3},
        ])
        out = ib.run_backfill_sweep(max_seconds=0)
        assert "time ceiling" in out and "continues tomorrow" in out, out

    def test_one_bad_symbol_never_ends_the_night(self, sweep_env, monkeypatch, api):
        """A scheduler job that throws takes its own next fire with it."""
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: ["BOOM", "NVDA"])

        def flaky(sym, q):
            if sym == "BOOM":
                raise RuntimeError("provider exploded")
            return [{"report_date": REPORT, "fiscal_year": 2026, "fiscal_quarter": 3}]

        monkeypatch.setattr(ib, "past_reports", flaky)
        out = ib.run_backfill_sweep()
        assert "wrote 1" in out, out          # NVDA still got done

    def test_a_broken_symbol_list_returns_a_message_not_an_exception(self, monkeypatch):
        from api.services import implied_store as store

        def boom():
            raise RuntimeError("db gone")

        monkeypatch.setattr(store, "all_symbols", boom)
        out = ib.run_backfill_sweep()
        assert "could not read" in out

    def test_it_runs_after_the_close_and_after_the_nightly_capture(self):
        """Ordering is load-bearing: the capture has a deadline and this does
        not, so this must never run first."""
        from api.services import implied_store, setup_grade
        assert (ib.SWEEP_HOUR_ET, ib.SWEEP_MINUTE_ET) > \
               (implied_store.CAPTURE_HOUR_ET, implied_store.CAPTURE_MINUTE_ET)
        assert (ib.SWEEP_HOUR_ET, ib.SWEEP_MINUTE_ET) > \
               (setup_grade.GRADE_SNAPSHOT_HOUR_ET, setup_grade.GRADE_SNAPSHOT_MINUTE_ET)

    def test_it_runs_clear_of_the_post_close_deploy_rush(self):
        """The reason it never finished for four nights. The `.git/hooks/pre-push`
        freeze then in force opened the deploy window at 16:20 ET, so shipping
        piled into the hour after the close; on 08-06 eight deploys landed
        between 16:53 and 19:48 and the second killed the 17:00 run 13 minutes
        in. A fired cron does not re-fire when the process restarts, so each one
        cost the night. The freeze was removed 2026-08-24 and deploys no longer
        cluster there, but 21:00 is still correct on its own terms: after the
        16:35 capture, clear of any post-close rush, done before 23:00."""
        assert (ib.SWEEP_HOUR_ET, ib.SWEEP_MINUTE_ET) >= (21, 0), \
            "back inside the post-close deploy window"
        # ...and still finished before the 23:00 ET theme-engine job.
        end_hour = ib.SWEEP_HOUR_ET + (ib._SWEEP_MAX_SECONDS / 3600.0)
        assert end_hour <= 23, f"the ceiling runs past 23:00 ET (to {end_hour:.1f})"


class TestTheSweepIsAudible:
    """A sweep that writes nothing must SAY so at WARNING.

    Uses the same isolation as the sweep tests above -- patching `DB_PATH`,
    the real constant. An earlier version of this file patched `_DB_PATH`,
    which does not exist; with `raising=False` that silently created a dead
    attribute and the tests wrote to the real C:\\data database.

    Lived failure (2026-08-06): the nightly cron wrote 0 rows on three
    consecutive weeknights and produced no log line at all, because the only
    report of its outcome was a RETURN VALUE and APScheduler discards those.
    The store sat at 65 backfilled rows while the job "ran" nightly. Silence
    was indistinguishable from success, so it read as success.
    """

    @pytest.fixture
    def sweep_env(self, monkeypatch, tmp_path):
        from api.services import implied_store as store
        monkeypatch.setattr(store, "DB_PATH", str(tmp_path / "s.db"))
        monkeypatch.setattr(store, "_INITIALIZED", set())
        monkeypatch.setattr(ib, "_FH_PACE_SECONDS", 0.0)
        return store

    def test_a_pass_that_writes_nothing_logs_a_warning(self, sweep_env, monkeypatch, api, caplog):
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: ["NVDA", "AAPL"])
        # Both symbols resolve to no usable quarter -> wrote 0, skipped 0.
        monkeypatch.setattr(ib, "past_reports", lambda s, q: [])

        with caplog.at_level(logging.WARNING, logger=ib._log.name):
            out = ib.run_backfill_sweep()

        assert "wrote 0" in out, out
        warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
        assert warnings, "a sweep that wrote nothing logged no warning -- it is silent again"
        assert "NOTHING WRITTEN" in warnings[-1].getMessage()

    def test_a_productive_pass_does_not_cry_wolf(self, sweep_env, monkeypatch, api, caplog):
        """The warning must mean something, so a night that works stays INFO."""
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: ["NVDA"])
        monkeypatch.setattr(ib, "past_reports", lambda s, q: [
            {"report_date": REPORT, "fiscal_year": 2026, "fiscal_quarter": 3},
        ])

        with caplog.at_level(logging.INFO, logger=ib._log.name):
            out = ib.run_backfill_sweep()

        assert "wrote 1" in out, out
        assert not [r for r in caplog.records if r.levelno >= logging.WARNING], \
            "a successful sweep raised a warning -- the signal is now noise"

    def test_a_genuinely_complete_store_is_not_an_alarm(self, sweep_env, monkeypatch, api, caplog):
        """wrote 0 because everything is ALREADY captured is the good end state."""
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: ["NVDA"])
        monkeypatch.setattr(ib, "past_reports", lambda s, q: [
            {"report_date": REPORT, "fiscal_year": 2026, "fiscal_quarter": 3},
        ])
        ib.run_backfill_sweep()          # first night captures it

        caplog.clear()
        with caplog.at_level(logging.INFO, logger=ib._log.name):
            out = ib.run_backfill_sweep()   # second night has nothing left to do

        assert "wrote 0" in out and "already had 1" in out, out
        assert not [r for r in caplog.records if r.levelno >= logging.WARNING], \
            "a complete store was reported as a failure"


class TestAHangCannotEatTheNight:
    """A call that never returns must cost ONE symbol, not the whole sweep.

    Lived twice in four days: hung at AIG on 2026-08-03 and at ASLE on
    2026-08-06, each far short of the `max_seconds` ceiling (which is only
    checked BETWEEN symbols, so it cannot see a call that never returns) and
    each with no end-of-run line. With `max_instances=1` the hung execution
    then held the only slot and blocked every following night until the
    process restarted -- that is what emptied 08-04 and 08-05.
    """

    @pytest.fixture
    def sweep_env(self, monkeypatch, tmp_path):
        from api.services import implied_store as store
        monkeypatch.setattr(store, "DB_PATH", str(tmp_path / "s.db"))
        monkeypatch.setattr(store, "_INITIALIZED", set())
        monkeypatch.setattr(ib, "_FH_PACE_SECONDS", 0.0)
        monkeypatch.setattr(ib, "_CALL_TIMEOUT", 1)   # keep the suite fast
        return store

    def test_a_hung_symbol_is_skipped_and_the_rest_still_run(self, sweep_env, monkeypatch, api):
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: ["HANG", "NVDA"])

        def maybe_hang(sym, q):
            if sym == "HANG":
                time.sleep(30)          # never returns within the bound
            return [{"report_date": REPORT, "fiscal_year": 2026, "fiscal_quarter": 3}]

        monkeypatch.setattr(ib, "past_reports", maybe_hang)
        out = ib.run_backfill_sweep()

        assert "timed out 1" in out, out
        assert "wrote 1" in out, out          # NVDA still got done
        assert len(store.get_implied_history("NVDA")) == 1

    def test_a_hung_move_lookup_does_not_end_the_symbol_list(self, sweep_env, monkeypatch, api):
        """The second unbounded call site — the option-chain reconstruction."""
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: ["SLOW"])
        monkeypatch.setattr(ib, "past_reports", lambda s, q: [
            {"report_date": REPORT, "fiscal_year": 2026, "fiscal_quarter": 3},
        ])
        monkeypatch.setattr(ib, "historical_expected_move",
                            lambda s, d: time.sleep(30))
        out = ib.run_backfill_sweep()
        assert "timed out 1" in out and "wrote 0" in out, out

    def test_the_bound_does_not_penalise_a_healthy_call(self, sweep_env, monkeypatch, api):
        """The guard must be invisible when nothing hangs."""
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: ["NVDA"])
        monkeypatch.setattr(ib, "past_reports", lambda s, q: [
            {"report_date": REPORT, "fiscal_year": 2026, "fiscal_quarter": 3},
        ])
        out = ib.run_backfill_sweep()
        assert "wrote 1" in out and "timed out 0" in out, out

    def test_bounded_propagates_a_real_error_rather_than_swallowing_it(self):
        """A provider RAISING is a different fact from a provider hanging;
        collapsing them would hide real breakage behind a timeout count."""
        def boom():
            raise RuntimeError("provider exploded")
        with pytest.raises(RuntimeError, match="exploded"):
            ib._bounded(boom, timeout=5)

    def test_bounded_returns_the_value_when_it_finishes(self):
        assert ib._bounded(lambda: 42, timeout=5) == 42


class TestTheRunLedgerTellsAHangFromAFinish:
    """A hang, a mid-run redeploy, and a clean finish left IDENTICAL evidence.

    That ambiguity is what made this job so hard to fix. It failed four
    separate nights and each time the only artifact was an unchanged row
    count -- which a monitor read as "finished" on 2026-08-06 while the sweep
    was actually stalled at ASLE. APScheduler discards the return value, and
    `railway logs` retains ~500 lines (under 3 minutes of this service's
    output), so the end-of-run line is gone long before anyone looks.

    `sweep_runs` makes the three states distinguishable, permanently.
    """

    @pytest.fixture
    def sweep_env(self, monkeypatch, tmp_path):
        from api.services import implied_store as store
        monkeypatch.setattr(store, "DB_PATH", str(tmp_path / "s.db"))
        monkeypatch.setattr(store, "_INITIALIZED", set())
        monkeypatch.setattr(ib, "_FH_PACE_SECONDS", 0.0)
        return store

    def _one_report(self, monkeypatch):
        monkeypatch.setattr(ib, "past_reports", lambda s, q: [
            {"report_date": REPORT, "fiscal_year": 2026, "fiscal_quarter": 3},
        ])

    def test_a_finished_run_is_recorded_as_finished(self, sweep_env, monkeypatch, api):
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: ["NVDA"])
        self._one_report(monkeypatch)
        ib.run_backfill_sweep()

        run = store.recent_sweep_runs(1)[0]
        assert run["finished_at"], "a completed run left no completion mark"
        assert run["outcome"] == "complete"
        assert run["wrote"] == 1
        assert run["symbols_total"] == 1

    def test_a_run_stopped_by_the_ceiling_says_so_rather_than_looking_complete(
            self, sweep_env, monkeypatch, api):
        """'ran out of clock, will continue tomorrow' is a DIFFERENT state from
        'finished the whole universe' — conflating them hides a growing
        backlog behind a green-looking row."""
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: [f"S{i}" for i in range(20)])
        self._one_report(monkeypatch)
        ib.run_backfill_sweep(max_seconds=0)

        run = store.recent_sweep_runs(1)[0]
        assert run["finished_at"]
        assert run["outcome"] == "ceiling"

    def test_a_killed_run_leaves_an_OPEN_row_naming_where_it_stopped(
            self, sweep_env, monkeypatch, api):
        """THE test. A redeploy mid-sweep is indistinguishable from a hang and
        from success unless the run is opened BEFORE the work and closed only
        on the way out. Simulated by killing the process the only way a test
        can: an exception that escapes the loop entirely."""
        store = sweep_env
        syms = [f"S{i}" for i in range(200)]
        monkeypatch.setattr(store, "all_symbols", lambda: syms)
        monkeypatch.setattr(ib, "_PROGRESS_EVERY", 10)

        def die_at_S55(sym, q):
            if sym == "S55":
                raise KeyboardInterrupt("redeploy")     # not caught per-symbol
            return []

        monkeypatch.setattr(ib, "past_reports", die_at_S55)
        with pytest.raises(KeyboardInterrupt):
            ib.run_backfill_sweep()

        run = store.recent_sweep_runs(1)[0]
        assert run["finished_at"] is None, \
            "a run that never reached the end was marked finished"
        assert run["outcome"] is None
        assert run["symbols_total"] == 200
        # ...and it says WHERE, which is the part row counts can never give.
        assert run["last_symbol"] == "S50", run
        assert run["symbols_done"] == 50

    def test_the_row_is_opened_before_any_provider_work(self, sweep_env, monkeypatch):
        """A run that dies on its very first symbol must still leave a trace —
        otherwise the worst failure is the most invisible one."""
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: ["FIRST", "SECOND"])

        def die_immediately(sym, q):
            raise KeyboardInterrupt("killed on symbol one")

        monkeypatch.setattr(ib, "past_reports", die_immediately)
        with pytest.raises(KeyboardInterrupt):
            ib.run_backfill_sweep()

        runs = store.recent_sweep_runs(1)
        assert runs, "no ledger row at all for a run that had already started"
        assert runs[0]["finished_at"] is None
        assert runs[0]["symbols_total"] == 2

    def test_a_broken_ledger_never_costs_the_night(self, sweep_env, monkeypatch, api):
        """The ledger diagnoses this job; it must not become able to break it.
        A locked DB should cost visibility, not the sweep."""
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: ["NVDA"])
        self._one_report(monkeypatch)

        def boom(*a, **k):
            raise RuntimeError("database is locked")

        monkeypatch.setattr(store, "start_sweep_run", boom)
        monkeypatch.setattr(store, "finish_sweep_run", boom)
        monkeypatch.setattr(store, "heartbeat_sweep_run", boom)

        out = ib.run_backfill_sweep()
        assert "wrote 1" in out, out
        assert len(store.get_implied_history("NVDA")) == 1

    def test_runs_come_back_newest_first(self, sweep_env, monkeypatch, api):
        store = sweep_env
        monkeypatch.setattr(store, "all_symbols", lambda: ["NVDA"])
        self._one_report(monkeypatch)
        store.start_sweep_run("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 1)
        ib.run_backfill_sweep()
        runs = store.recent_sweep_runs(5)
        assert len(runs) == 2
        assert runs[0]["started_at"] > runs[1]["started_at"]
