"""Historical expected-move reconstruction.

The stakes here are unusual: these rows land in the SAME table as live
nightly captures and are compared against them to produce the RICH/CHEAP
verdict. A backfill that used a slightly different method would not look
broken — it would look like an edge. So the tests below are mostly about
sameness: same expiry rule, same ATM pick, same mid math, same shape.
"""
import datetime as _dt

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
    """Finnhub is the only fiscal-identity source and its budget is a
    process-wide bucket SHARED WITH LIVE MEMBER TRAFFIC. Unpaced, the 739-symbol
    sweep 429'd on its FIRST call, engaged a 20s shared cooldown, then raced
    through every remaining symbol getting empty responses — and reported
    success having written almost nothing. Measured on production 2026-08-06:
    25 symbols, 25 empty, 1.5 seconds.
    """

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
        """Ordering is load-bearing: all three share ONE Finnhub budget, and
        the capture has a deadline while this does not."""
        from api.services import implied_store, setup_grade
        assert ib.SWEEP_HOUR_ET == 17
        assert (ib.SWEEP_HOUR_ET, ib.SWEEP_MINUTE_ET) > \
               (implied_store.CAPTURE_HOUR_ET, implied_store.CAPTURE_MINUTE_ET)
        assert (ib.SWEEP_HOUR_ET, ib.SWEEP_MINUTE_ET) > \
               (setup_grade.GRADE_SNAPSHOT_HOUR_ET, setup_grade.GRADE_SNAPSHOT_MINUTE_ET)
