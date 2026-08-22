"""The bulk fundamentals pass — units, and the two ways it could ship a lie.

🔴 THE DEFECT CLASS. Ten declared scalars plus `exchange` had no collector and
were NULL on all 3,708 rows. Filling them is easy; filling them WRONGLY is
easier, and a wrong number that passes every consistency check is worse than
the gap it replaced. Two specific ways, both measured against the live provider
on 2026-08-09 and both rail-ed here:

  1. **FMP's literal 0 is an UNDEFINED sentinel as often as it is a value.**
     `currentRatioTTM` reads 0 for 163 of our names — every one a bank, insurer
     or BDC with no current/non-current balance-sheet split. Writing it makes
     `current_ratio < 1` return every financial in America. Meanwhile
     `dividendYieldTTM` reads 0 for 1,712 genuine non-payers, where 0 is the
     TRUE answer and refusing it would blank 47% of the column.

  2. **FMP returns fractions; this table stores percents.** AAPL's gross margin
     is `0.4865` on the wire and must land as `48.65`. Writing the fraction
     renders "0%" and makes every margin filter a silent zero-hit — the same
     shape as writing a MIC into `exchange` and having `== "NASDAQ"` never
     match.

⭐ Nothing below mocks the provider to prove the provider works — that is the
green-test-over-a-NULL-column trap `test_scalar_population_rail.py` exists for.
These prove the MAPPING and the REFUSALS, over rows shaped like the real ones.
The population proof against a real rebuild lives in
`.superpowers/sdd/phase-e/fix_group_a_measure.py`.
"""
from __future__ import annotations

import contextlib
import csv
import importlib
import time

import pytest

from api.services.screener import fundamentals_bulk as fb
from api.services.screener import snapshot_db


# ───────────────────────── the zero rule ────────────────────────────────────

def test_an_uncorroborated_zero_is_refused_because_it_means_undefined():
    """🔴 THE CENTRAL REFUSAL. A bank's `currentRatioTTM` of 0 is FMP saying it
    has no current-liabilities line, not that the ratio is zero."""
    bank = {"symbol": "ABCB", "currentRatioTTM": "0"}
    assert fb.value_for(fb.RATIO_SPECS["current_ratio"], bank) is None

    # ...and the same shape for every other uncorroborated column.
    assert fb.value_for(fb.RATIO_SPECS["pe_ttm"],
                        {"priceToEarningsRatioTTM": "0"}) is None
    assert fb.value_for(fb.RATIO_SPECS["ps"],
                        {"priceToSalesRatioTTM": "0"}) is None
    assert fb.value_for(fb.RATIO_SPECS["pb"],
                        {"priceToBookRatioTTM": "0",
                         "bookValuePerShareTTM": "10.02"}) is None
    assert fb.value_for(fb.KEY_METRIC_SPECS["roa"],
                        {"returnOnAssetsTTM": "0"}) is None
    assert fb.value_for(fb.PROFILE_SPECS["beta"], {"beta": "0"}) is None


def test_a_corroborated_zero_IS_written_because_it_is_the_true_answer():
    """⭐ THE OTHER DIRECTION, and the one a blanket "drop all zeros" rule gets
    wrong. Refusing these would blank 1,712 non-payers and 238 debt-free
    balance sheets — a gap invented to avoid a gap."""
    # A company that pays no dividend HAS a yield, and it is 0.
    payer_none = {"dividendYieldTTM": "0", "dividendPerShareTTM": "0"}
    assert fb.value_for(fb.RATIO_SPECS["dividend_yield"], payer_none) == 0.0

    # ANET/AFL: three debt quotients over three different denominators all
    # reading zero is a debt-free balance sheet, not a missing one.
    debt_free = {"debtToEquityRatioTTM": "0", "debtToAssetsRatioTTM": "0",
                 "debtToCapitalRatioTTM": "0"}
    assert fb.value_for(fb.RATIO_SPECS["debt_to_equity"], debt_free) == 0.0


def test_a_zero_whose_corroborators_disagree_is_still_refused():
    """MARA and AHRT: D/E reads 0 while the other debt ratios do not. That is
    provider noise, and the corroboration rule is what tells it from ANET."""
    noisy = {"debtToEquityRatioTTM": "0", "debtToAssetsRatioTTM": "0.31",
             "debtToCapitalRatioTTM": "0.24"}
    assert fb.value_for(fb.RATIO_SPECS["debt_to_equity"], noisy) is None
    # One dissenting corroborator is enough to refuse.
    half = {"debtToEquityRatioTTM": "0", "debtToAssetsRatioTTM": "0",
            "debtToCapitalRatioTTM": "0.24"}
    assert fb.value_for(fb.RATIO_SPECS["debt_to_equity"], half) is None
    # A corroborator that is absent entirely is not agreement either.
    assert fb.value_for(fb.RATIO_SPECS["dividend_yield"],
                        {"dividendYieldTTM": "0"}) is None


def test_op_margins_zeros_are_refused_because_the_REVENUE_is_what_is_missing():
    """🔴 THE SHAPE THAT LOOKS CORROBORATED AND IS NOT. Measured 2026-08-09:
    `operatingProfitMarginTTM` reads 0 on 228 of our names, and every single one
    of them ALSO reads 0 for gross, EBIT, pretax and net margin — which is not
    four witnesses, it is one dead denominator seen four times. All 228 have
    `revenuePerShareTTM == 0`, and 225 carry a NON-ZERO `netIncomePerShareTTM`
    (SPACs on trust interest, pre-revenue biotech: ABVX, ALLO, AMLX, AURA).

    ⭐ SO THE NUMERATOR IS ALIVE AND THE RATIO IS UNDEFINED — exactly the bank
    `current_ratio` case, and `op_margin` refuses for the same reason its
    siblings `gross_margin`/`net_margin` do.
    """
    prerevenue = {"symbol": "ABVX", "operatingProfitMarginTTM": "0",
                  "grossProfitMarginTTM": "0", "netProfitMarginTTM": "0",
                  "pretaxProfitMarginTTM": "0", "ebitMarginTTM": "0",
                  "revenuePerShareTTM": "0",
                  "netIncomePerShareTTM": "-1.83"}
    assert fb.value_for(fb.RATIO_SPECS["op_margin"], prerevenue) is None
    # ...and a real operating margin is untouched (JPM, measured).
    assert fb.value_for(fb.RATIO_SPECS["op_margin"],
                        {"operatingProfitMarginTTM": "0.2818840652750199"}
                        ) == pytest.approx(28.19, abs=0.01)


def test_roes_zeros_are_refused_because_four_ratios_share_one_balance_sheet():
    """🔴 THE NEAR-MISS THIS PASS ALMOST SHIPPED. `returnOnEquityTTM` is 0 on 6
    names, and `returnOnAssetsTTM`, `returnOnInvestedCapitalTTM` and
    `returnOnCapitalEmployedTTM` are 0 on all 6 too. That is structurally
    identical to `debt_to_equity`'s three-quotient corroboration — and it is
    WRONG, because the per-symbol endpoint shows ARCI, HACQ and SAAQ with a
    NON-ZERO `netIncomePerShareTTM` and `bookValuePerShareTTM == 0`.

    ⭐ AGREEMENT AMONG QUOTIENTS IS ONLY CORROBORATION WHEN THE DENOMINATORS ARE
    INDEPENDENT. Assets / equity / invested capital / capital employed are four
    views of ONE balance sheet, so they collapse together; debt-to-equity,
    debt-to-assets and debt-to-capital are three views of one DEBT figure, which
    is why those three CAN witness a debt-free company and these four cannot
    witness a zero return.
    """
    shell = {"symbol": "ARCI", "returnOnEquityTTM": "0",
             "returnOnAssetsTTM": "0", "returnOnInvestedCapitalTTM": "0",
             "returnOnCapitalEmployedTTM": "0"}
    assert fb.value_for(fb.KEY_METRIC_SPECS["roe"], shell) is None
    # AAPL's ROE really is 137% — the refusal must not reach a live number.
    assert fb.value_for(fb.KEY_METRIC_SPECS["roe"],
                        {"returnOnEquityTTM": "1.3718365457766524"}
                        ) == pytest.approx(137.18, abs=0.01)


def test_a_peg_of_zero_is_refused_because_it_needs_a_pe_of_zero():
    """PEG = P/E ÷ growth, so a PEG of exactly 0 requires a P/E of exactly 0 —
    the dead numerator `pe_ttm` already refuses. Measured: 3 zeros (AGCC, MGRT,
    NPCT), each with `priceToEarningsRatioTTM == 0` AND
    `netIncomePerShareTTM == 0`. ⛔ Corroborating with the P/E would only
    launder one column's refusal into another."""
    dead = {"symbol": "AGCC", "priceToEarningsGrowthRatioTTM": "0",
            "priceToEarningsRatioTTM": "0", "netIncomePerShareTTM": "0",
            "revenuePerShareTTM": "0"}
    assert fb.value_for(fb.RATIO_SPECS["peg"], dead) is None
    # ⭐ A NEGATIVE PEG IS A REAL ANSWER and must survive — shrinking earnings
    # against a positive P/E. ABCB reads -6.01, RIVN -0.27. A blanket
    # "refuse anything odd" rule would blank both.
    assert fb.value_for(fb.RATIO_SPECS["peg"],
                        {"priceToEarningsGrowthRatioTTM": "-6.007024067388682"}
                        ) == pytest.approx(-6.007, abs=0.001)


def test_a_nonzero_value_never_consults_the_corroborators():
    """The rule is about zeros only. A real ratio must not be second-guessed by
    a field that has nothing to do with it."""
    row = {"debtToEquityRatioTTM": "1.47", "debtToAssetsRatioTTM": "0",
           "debtToCapitalRatioTTM": "0"}
    assert fb.value_for(fb.RATIO_SPECS["debt_to_equity"], row) == 1.47


# ───────────────────────── units ────────────────────────────────────────────

def test_fractions_become_percent_and_ratios_are_left_alone():
    """⚠️ THE UNIT CONTRACT, stated in `app/src/pages/screener/columnDefs.js`:
    margins / roa / dividend_yield are stored as PERCENT (25.0 == 25%), and
    `pe_ttm`/`ps`/`pb`/`debt_to_equity`/`current_ratio`/`beta` are plain ratios.
    """
    got = fb._row_from(fb.RATIO_SPECS, {
        "symbol": "AAPL",
        "grossProfitMarginTTM": "0.4865291555900202",
        "netProfitMarginTTM": "0.27618604910212224",
        "dividendYieldTTM": "0.0033511", "dividendPerShareTTM": "1.05",
        "priceToEarningsRatioTTM": "35.768264840182646",
        "priceToSalesRatioTTM": "9.858103082924362",
        "priceToBookRatioTTM": "42.81627348353795",
        "debtToEquityRatioTTM": "0.7841052827380952",
        "currentRatioTTM": "1.0032948046555858",
    })
    assert got["gross_margin"] == pytest.approx(48.65, abs=0.01)
    assert got["net_margin"] == pytest.approx(27.62, abs=0.01)
    assert got["dividend_yield"] == pytest.approx(0.335, abs=0.001)
    # Plain ratios pass through untouched — a ×100 here is the silent-zero-hit.
    assert got["pe_ttm"] == pytest.approx(35.77, abs=0.01)
    assert got["ps"] == pytest.approx(9.86, abs=0.01)
    assert got["pb"] == pytest.approx(42.82, abs=0.01)
    assert got["debt_to_equity"] == pytest.approx(0.784, abs=0.001)
    assert got["current_ratio"] == pytest.approx(1.003, abs=0.001)
    assert fb._row_from(fb.KEY_METRIC_SPECS,
                        {"returnOnAssetsTTM": "0.3363982195133406"}
                        )["roa"] == pytest.approx(33.64, abs=0.01)


def test_every_scale_is_either_a_ratio_or_a_percent_and_nothing_else():
    """A third scale would be a unit nobody declared. Derived from the maps."""
    for name, specs in (("ratio", fb.RATIO_SPECS), ("key", fb.KEY_METRIC_SPECS),
                        ("profile", fb.PROFILE_SPECS)):
        for column, spec in specs.items():
            assert spec.scale in (1.0, 100.0), (name, column, spec.scale)


def test_the_percent_scaled_columns_are_exactly_the_ones_the_ui_declares():
    """⛔ DERIVED FROM `columnDefs.js`, NOT RETYPED. The frontend formats a
    stored percent directly (`pctPlain`) and a ratio with `num()`; if the
    builder and the formatter disagree about a column, the member reads a
    number that is wrong by 100×. Reading the formatter is what makes this a
    contract test rather than two copies of one opinion."""
    import pathlib
    import re
    src = (pathlib.Path(__file__).resolve().parents[1] / "app" / "src" /
           "pages" / "screener" / "columnDefs.js").read_text(encoding="utf-8")
    percent_cols, ratio_cols = set(), set()
    for column, body in re.findall(r"^\s*(\w+):\s*\{([^}]*)\}", src, re.M):
        if "pctPlain" in body:
            percent_cols.add(column)
        elif re.search(r"fmt:\s*num\(", body):
            ratio_cols.add(column)

    ours = {c: s.scale for specs in (fb.RATIO_SPECS, fb.KEY_METRIC_SPECS,
                                     fb.PROFILE_SPECS)
            for c, s in specs.items()}
    for column, scale in ours.items():
        if column in percent_cols:
            assert scale == 100.0, (
                f"{column} is rendered as a stored percent by columnDefs.js but "
                f"this module writes it with scale {scale}")
        if column in ratio_cols:
            assert scale == 1.0, (
                f"{column} is rendered as a plain number by columnDefs.js but "
                f"this module scales it by {scale}")
    # The derivation must actually have found both kinds, or it proves nothing.
    assert percent_cols & set(ours), "no percent column matched — regex is stale"
    assert ratio_cols & set(ours), "no ratio column matched — regex is stale"


# ───────────────────────── never invent, never mistake failure for success ──

def test_blank_junk_and_non_finite_values_become_none():
    for raw in ({}, {"beta": ""}, {"beta": "n/a"}, {"beta": "NaN"},
                {"beta": "inf"}, {"beta": None}):
        assert fb.value_for(fb.PROFILE_SPECS["beta"], raw) is None


def test_a_missing_api_key_is_counted_not_swallowed(monkeypatch):
    """🔴 THE HALF THAT PRODUCED THE ORIGINAL DEFECT. `built=3708 skipped=0
    errors=0` was printed over a column that was NULL 3,708 times, because a
    dead provider returned a polite empty answer. An empty result here must
    always arrive with a reason attached."""
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    fb._CACHE.clear()
    failures: dict = {}
    assert fb.fetch_bulk(["AAPL", "NVDA"], failures=failures) == {}
    assert failures == {"fmp_bulk": {"no_api_key": 1}}


def test_a_dead_endpoint_is_named_by_status_not_reported_as_an_empty_market(monkeypatch):
    """A 403 (this plan's answer for the legacy v3 family) must be
    distinguishable from "the market has no fundamentals"."""
    import contextlib

    @contextlib.contextmanager
    def _dead(path, params, timeout=None):
        yield None, 403, "Legacy Endpoint"

    monkeypatch.setenv("FMP_API_KEY", "x")
    monkeypatch.setattr(fb, "_open_bulk_csv", _dead)
    fb._CACHE.clear()
    failures: dict = {}
    assert fb.fetch_bulk(["AAPL"], failures=failures) == {}
    assert failures["fmp_ratios_bulk"] == {"HTTP 403": 1}
    assert failures["fmp_key_metrics_bulk"] == {"HTTP 403": 1}
    assert failures["fmp_profile_bulk"] == {"HTTP 403": 1}


def test_the_profile_walk_ends_on_400_and_retries_a_429(monkeypatch):
    """⛔ THE END OF THE WALK IS DERIVED — a part past the end answers 400. A
    429 must NOT end it: treating a rate limit as the end of the database
    silently halves `beta`/`exchange` coverage and looks identical to a shorter
    provider."""
    import contextlib
    calls = []

    @contextlib.contextmanager
    def _parts(path, params, timeout=None):
        part = int(params["part"])
        calls.append(part)
        if part == 0:
            yield [{"symbol": "AAPL", "beta": "1.1", "exchange": "NASDAQ"}], 200, ""
        elif part == 1 and calls.count(1) == 1:
            yield None, 429, "rate limited"
        elif part == 1:
            yield [{"symbol": "NVDA", "beta": "2.2", "exchange": "NASDAQ"}], 200, ""
        else:
            yield None, 400, "Invalid or missing query parameter - part"

    monkeypatch.setattr(fb, "_open_bulk_csv", _parts)
    monkeypatch.setattr(fb.time, "sleep", lambda *_: None)
    out, failures = {}, {}
    fb._walk_profile_parts({"AAPL", "NVDA"}, out, failures)

    assert out["AAPL"]["beta"] == 1.1 and out["AAPL"]["exchange"] == "NASDAQ"
    # The retried part is the proof a 429 did not end the walk.
    assert out["NVDA"]["beta"] == 2.2
    assert failures["fmp_profile_bulk"] == {"HTTP 429 retried": 1}
    assert calls.count(1) == 2 and 2 in calls


def _reader(*chunks):
    import io as _io
    return csv.DictReader(_io.TextIOWrapper(
        _io.BufferedReader(fb._ChunkReader(iter(chunks))),
        encoding="utf-8", errors="replace", newline=""))


def test_the_stream_ends_cleanly_at_eof_instead_of_raising():
    """🔴 THE BUG THAT SHIPPED AND WAS CAUGHT BY THE CENSUS, not by a count.

    Wrapping `resp.raw` directly, urllib3 closes the response once
    content-length bytes are read, so the last `read()` raised
    `ValueError: I/O operation on closed file` AT THE NATURAL END OF THE BODY.
    The rows already parsed survived, so the pull LOOKED complete — but
    `_walk_profile_parts` treats an exception as "stop walking" and never
    fetched parts 1-3, so `beta` and `exchange` were silently absent for every
    symbol outside part 0 (measured: T and XOM).
    """
    rows = list(_reader(b"symbol,beta\n", b"AAPL,1.1\nNVDA,", b"2.2\n"))
    assert [r["symbol"] for r in rows] == ["AAPL", "NVDA"]
    assert rows[1]["beta"] == "2.2"


def test_a_quoted_field_containing_a_newline_does_not_corrupt_the_stream():
    """⚠️ WHY THIS IS NOT `iter_lines()`. profile-bulk carries free-text
    `description` fields with embedded newlines; a line-oriented split
    desynchronises every row after the first one — and the wreckage looks like
    missing data, not like a parse error."""
    rows = list(_reader(b'symbol,description,beta\n',
                        b'AAPL,"line one\nline two",1.1\n',
                        b'NVDA,"plain",2.2\n'))
    assert [r["symbol"] for r in rows] == ["AAPL", "NVDA"]
    assert rows[0]["beta"] == "1.1" and rows[1]["beta"] == "2.2"


def test_only_wanted_symbols_are_materialised():
    """The ratios file holds 71,370 rows and we keep ~3,679. Nothing outside the
    universe may enter the map."""
    out = {}
    n = fb._absorb([{"symbol": "aapl", "beta": "1.1"},
                    {"symbol": "0700.HK", "beta": "0.9"},
                    {"symbol": "", "beta": "1.0"}],
                   fb.PROFILE_SPECS, {"AAPL"}, out)
    assert set(out) == {"AAPL"} and n == 1


# ───────────────────────── one authority per column ─────────────────────────

def test_every_column_written_is_a_real_snapshot_column():
    unknown = sorted(fb.COLUMNS_WRITTEN - set(snapshot_db.COLUMNS))
    assert not unknown, f"writes columns the schema does not have: {unknown}"


#: ⏳ THE ONE OVERLAP THAT EXISTS TODAY, named with the date it was accepted and
#: WHOSE it is — exactly the shape `test_scalar_population_rail.py` uses for its
#: allow-lists, and for the same reason: an exemption with no sentence attached
#: is indistinguishable in six months from a design decision.
#:
#: ⛔ THIS IS NOT MINE AND IT IS NOT NEW. `enrich.ratings_fields` passes
#: `metrics["sector"]` (yfinance/FMP, via the ratings gather) straight through,
#: and `_read_fundamentals` writes `sector` from the `ticker_meta` cache. Both
#: run; `build_row` merges ratings AFTER fundamentals, so the ratings copy wins
#: wherever `research_ratings.db` has a row and the cache's copy wins elsewhere
#: — one column, two taxonomies, decided row by row. It is reported rather than
#: fixed here because `sector` is the `sector` FILTER's option list, so changing
#: its owner is member-visible and belongs to whoever owns that taxonomy.
SHARED_BY_DESIGN = {
    ("enrich.ratings_fields", "_read_fundamentals"): {
        "sector": "2026-08-09 PRE-EXISTING: ratings passthrough vs ticker_meta "
                  "cache. Owner call — `sector` drives the filter's options.",
    },
}


def _source_key_sets(monkeypatch, tmp_path) -> dict:
    """``{label: {columns it can emit}}`` for every source `build_row` merges.

    ⛔ EVERY SET IS OBTAINED BY RUNNING THE SOURCE, never retyped — a test that
    restates what a source emits is itself the second authority this rail
    exists to forbid. Each is handed a fully-populated input so it emits
    everything it possibly can.

    ⛔ AND THE RATINGS INPUT IS DERIVED FROM `ratings_db.METRIC_COLUMNS`, the
    list the store itself is keyed by. A hand-typed metrics dict would silently
    stop covering a metric the day a new one is persisted, and the rail would
    go quiet on precisely the new column most likely to collide.

    ⭐ Task 10 adds the SIX Wave 2 readers, 14 sources total. Finviz/edates are
    exercised through their own artifact env overrides (the idiom those two
    modules use — a flat JSON file, not a SQLite store); the other four
    monkeypatch their own store-connection seam, the `single_stock_etfs`
    idiom already used below. `get_sector_distributions` is stubbed with a
    >= SECTOR_MIN_SAMPLE (15) Technology/`rs_return` pool so
    `enrich.ratings_fields`'s Wave 2 `sector_rs_pct` (gated on `if sdists:`)
    is exercised too — without it that column never appears and the rail
    would never see it collide.

    ⭐ Task A6 adds the THREE Wave 5 readers, 17 sources total.
    `pattern_join`/`darkpool_agg` monkeypatch their own store-connection seams
    (`PATTERN_DB_PATH` env override for pattern_db — it re-reads the env var
    per call, so `monkeypatch.setenv` alone suffices, mirroring
    `test_screener_wave5_patterns.py`; `darkpool_db.DB_DIR`/`DB_PATH`
    attribute-patched directly, mirroring `test_screener_wave5_darkpool.py`'s
    `dp_db` fixture, since that module freezes its path at IMPORT and may
    already be imported under a different `RAILWAY_VOLUME_MOUNT_PATH` by an
    earlier test module in this session). `opt_flow` uses the same flat-JSON
    artifact idiom as finviz/edates above (`SCREENER_OPTFLOW_ARTIFACT`),
    padded to >= `opt_flow._MIN_TICKERS` rows. `pattern_join`'s seeded
    detection carries non-null entry/stop (K5) AND a matching `pattern_stats`
    row so its full column set — INCLUDING the two non-column CARRIER keys
    `pattern_entry_px`/`pattern_stop_px` (see `test_screener_wave5_wiring.py`
    and this file's `test_pattern_join_carrier_keys_are_named_and_never_columns`)
    — is exercised, never a subset.
    """
    import api.services.screener.snapshot_builder as b
    from api.services.screener import enrich, context_joins as cj
    from api.services.screener import (finviz_universe, earnings_dates,
                                       earnings_context, analyst_pass,
                                       insider_capture)
    from api.services.research import ratings_db
    from api.services import massive, ticker_meta
    from api.services import breadth_monitor, engine, watchlist_prebuilt, \
        industry_map, single_stock_etfs

    metrics = {c: 1.2 for c in ratings_db.METRIC_COLUMNS}
    metrics["sector"] = "Technology"
    sdists = {"Technology": {"rs_return":
              {"values": [float(i) for i in range(20)], "n": 20}}}

    monkeypatch.setattr(ticker_meta, "get_ticker_meta",
                        lambda t: {"name": "N", "sector": "S", "industry": "I",
                                   "theme": "AI"})
    monkeypatch.setattr(massive, "get_market_cap", lambda t, price=None: 1.0e9)

    # ⛔ ALL FOUR lists present — read_index_flags now emits PER-COLUMN GUARDED
    # rows (a column's key is absent when its source list didn't resolve), so
    # a thin fixture here would silently shrink the registered key set.
    monkeypatch.setattr(breadth_monitor, "get_universe_stocks", lambda: {
        "stocks": [{"ticker": "AAA", "tags": ["s2", "s4", "hvc"]}]})
    monkeypatch.setattr(engine, "get_leadership", lambda: [{"ticker": "AAA"}])
    monkeypatch.setattr(watchlist_prebuilt, "_load_lists", lambda: [
        {"name": n, "tickers": ["AAA"]}
        for n in ("S&P 500", "Nasdaq 100", "Dow 30", "Russell 2000")])
    monkeypatch.setattr(industry_map, "tickers_in_industry", lambda i: ["AAA"])

    # In-memory sqlite standing in for the ssetf leg — read_etf_flags wraps
    # the connection in contextlib.closing, so this stub must survive .close().
    import sqlite3
    ssetf_conn = sqlite3.connect(":memory:")
    ssetf_conn.execute("CREATE TABLE etfs (etf_ticker TEXT)")
    ssetf_conn.execute("INSERT INTO etfs (etf_ticker) VALUES ('AAA')")
    ssetf_conn.commit()
    monkeypatch.setattr(single_stock_etfs, "_connect", lambda: ssetf_conn)

    # ── finviz_universe: whole-market artifact via its env override. Needs
    # >= _MIN_ROWS (1000) total rows or the read degrades to "missing". ──
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(tmp_path / "finviz.json"))
    finviz_rows = {f"PAD{i}": {} for i in range(finviz_universe._MIN_ROWS)}
    finviz_rows["AAA"] = {col: 1.0 for col in finviz_universe._HEADERS}
    finviz_universe._atomic_write_json(finviz_universe._artifact_path(), {
        "as_of": finviz_universe._now_iso(), "missing_headers": [],
        "rows": finviz_rows})

    # ── earnings_dates: same artifact idiom, no row-count floor. ──
    import datetime as _dt
    monkeypatch.setenv("SCREENER_EDATES_ARTIFACT", str(tmp_path / "edates.json"))
    earnings_dates._atomic_write({
        "as_of": _dt.date.today().isoformat(),
        "rows": {"AAA": {"date": "2026-09-01", "session": "bmo"}}})

    # ── earnings_context.read_last_report_move: monkeypatch wire.store's own
    # connection seam with a live wire_prints row for AAA. ──
    from api.services.wire import store as wire_store
    wire_conn = sqlite3.connect(":memory:")
    wire_conn.row_factory = sqlite3.Row
    wire_conn.execute(
        "CREATE TABLE wire_prints (market_date TEXT, sym TEXT, peak_move_pct REAL)")
    wire_conn.execute(
        "INSERT INTO wire_prints (market_date, sym, peak_move_pct) "
        "VALUES ('2026-08-20', 'AAA', 12.3)")
    wire_conn.commit()
    monkeypatch.setattr(wire_store, "_connect", lambda: wire_conn)

    # ── earnings_context.read_implied_context: the reporter list + per-date
    # implied lookup stubbed directly (both already-public store accessors);
    # `_latest_grades`'s own connection seam holds a live grade_snapshots row.
    from api.services import implied_store, setup_grade
    monkeypatch.setattr(implied_store, "upcoming_reporters",
                        lambda days=14: [{"sym": "AAA", "report_date": "2026-09-01"}])
    monkeypatch.setattr(implied_store, "get_implied_for_date",
                        lambda rd: {"AAA": 5.5})
    grade_conn = sqlite3.connect(":memory:")
    grade_conn.row_factory = sqlite3.Row
    grade_conn.execute(
        "CREATE TABLE grade_snapshots (sym TEXT, date TEXT, surface TEXT, grade TEXT)")
    grade_conn.execute(
        "INSERT INTO grade_snapshots (sym, date, surface, grade) "
        "VALUES ('AAA', '2026-08-20', ?, 'B')", (setup_grade.SURFACE,))
    grade_conn.commit()
    monkeypatch.setattr(implied_store, "_connect", lambda: grade_conn)

    # ── analyst_pass.read_analyst_fields: its own SQLite store, seeded via
    # its own public init_db()/upsert() against a real scratch file. ──
    monkeypatch.setenv("SCREENER_ANALYST_DB_PATH", str(tmp_path / "analyst.db"))
    analyst_pass.init_db()
    analyst_pass.upsert("AAA", {
        "consensus": "Buy", "pt_target": 100.0, "upgrades_30d": 1,
        "downgrades_30d": 0, "eps_next_y_growth": 5.0,
    }, now=time.time())

    # ── insider_capture.read_insider_fields: its own SQLite store, seeded by
    # a direct insert into its own schema (its only writer otherwise scrapes
    # OpenInsider over the network). ──
    monkeypatch.setenv("SCREENER_INSIDER_DB_PATH", str(tmp_path / "insider.db"))
    insider_capture._init_db()
    with contextlib.closing(insider_capture._connect()) as iconn:
        iconn.execute(
            "INSERT INTO cluster_latest (ticker, last_trade_date, insiders, "
            "value_usd, captured_at) VALUES (?, ?, ?, ?, ?)",
            ("AAA", _dt.date.today().isoformat(), 3, 1_000_000.0,
             int(time.time())))
        iconn.commit()

    # ── pattern_join: one active detection with non-null entry+stop (K5) +
    # a matching pattern_stats row, so pattern_expectancy_r AND the two
    # carrier keys are all exercised (never a subset of what the reader can
    # emit). `PATTERN_DB_PATH` is re-read per call by `pattern_db._db_path()`
    # — `monkeypatch.setenv` alone isolates it, mirroring
    # `test_screener_wave5_patterns.py`. ──
    monkeypatch.setenv("PATTERN_DB_PATH", str(tmp_path / "srckeys_patterns.db"))
    from api.services.pattern_engine import memory as pattern_memory
    from api.services.pattern_engine.pattern_db import get_connection as _pattern_conn
    from api.services.screener import pattern_join
    _now = int(time.time())
    pattern_memory.store_detection({
        "id": "srckeys-det-1", "sym": "AAA", "tf": "D",
        "pattern_id": "bull_flag", "category": "classical", "direction": "bullish",
        "start_t": 1, "end_t": 2,
        "geometry": {"shape": "trendline_pair", "anchors": [], "extras": {}},
        "levels": {"entry": 100.0, "entry_condition": "", "stop": 95.0,
                   "stop_basis": "", "target_primary": 110.0,
                   "target_secondary": None, "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up",
                    "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "unknown",
                    "nearest_resistance": 110.0, "nearest_support": 95.0,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": 75.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 75.0,
                                "context_score": 70.0, "historical_score": 50.0},
        "narrative": {"headline": "t", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready", "detected_at": _now, "last_seen_at": _now,
    })
    _pconn = _pattern_conn()
    try:
        _pconn.execute(
            """INSERT INTO pattern_stats
                 (pattern_id, tf, regime_bucket, n_total, n_resolved,
                  n_entry_hit, n_target_hit, n_stop_hit, avg_mfe_pct,
                  avg_mae_pct, median_bars, hit_rate, expectancy_R,
                  last_updated)
               VALUES ('bull_flag', 'D', 'unknown', 10, 10, 10, 6, 4, 5.0,
                       3.0, 8, 0.6, 0.42, ?)""",
            (_now,))
        _pconn.commit()
    finally:
        _pconn.close()

    # ── darkpool_agg: one qualifying block print for AAA (K7: direct INSERT,
    # never the ingest helpers — Windows-unsafe strftime) + a stubbed
    # signature-DPL level so dp_level_dist_pct is exercised too. Attribute-
    # patched (never env-var-timed) — `api.darkpool_db` freezes DB_DIR/DB_PATH
    # at IMPORT, and another test module in this session may already have
    # imported it under a different RAILWAY_VOLUME_MOUNT_PATH; mirrors
    # `test_screener_wave5_darkpool.py`'s `dp_db` fixture (K9: read-only
    # afterward — this only ever SELECTs through the reader). ──
    from api import darkpool_db
    from api.services.signature import darkpool_levels
    from api.services.screener import darkpool_agg
    monkeypatch.setattr(darkpool_db, "DB_DIR", str(tmp_path))
    monkeypatch.setattr(darkpool_db, "DB_PATH", str(tmp_path / "srckeys_darkpool.db"))
    darkpool_db.init_db()
    _dconn = darkpool_db.get_conn()
    try:
        _dconn.execute(
            "INSERT INTO darkpool_trades "
            "(date, timestamp, ticker, volume, price, notional, type) "
            "VALUES (?,?,?,?,?,?,?)",
            ("8/21/2026", "10:00:00 AM", "AAA", 1000, 105.0, 5_000_000.0, "Block"))
        _dconn.commit()
    finally:
        _dconn.close()
    monkeypatch.setattr(darkpool_levels, "fetch_dp_levels", lambda sym: {
        "levels": [{"price": 100.0}], "datesCovered": 20})

    # ── opt_flow: the finviz/edates flat-JSON-artifact idiom, padded to
    # >= _MIN_TICKERS rows. ──
    from api.services.screener import opt_flow
    monkeypatch.setenv("SCREENER_OPTFLOW_ARTIFACT", str(tmp_path / "srckeys_opt_flow.json"))
    optflow_rows = {f"PAD{i}": {"opt_net_premium_1d": 1.0, "opt_bull_pct_1d": 50.0,
                                 "opt_net_premium_5d": 2.0}
                     for i in range(opt_flow._MIN_TICKERS)}
    optflow_rows["AAA"] = {"opt_net_premium_1d": 1_000_000.0,
                            "opt_bull_pct_1d": 62.5,
                            "opt_net_premium_5d": 4_200_000.0}
    opt_flow._atomic_write_json(opt_flow._artifact_path(), {
        "as_of": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "days": [], "rows": optflow_rows, "census": {}})

    return {
        "fundamentals_bulk": set(fb.COLUMNS_WRITTEN),
        "rs_fields": set(b.rs_fields({"rs_rank": 90, "rs_score": 12.5})),
        "enrich.ratings_fields": set(enrich.ratings_fields(metrics, {}, sdists)),
        "_read_fundamentals": set(b._read_fundamentals("AAA", price=10.0)),
        "context.breadth": set(cj.read_breadth_flags(["AAA"])["AAA"]),
        "context.uct20": set(cj.read_uct20(["AAA"])["AAA"]),
        "context.index": set(cj.read_index_flags(["AAA"])["AAA"]),
        "context.etf": set(cj.read_etf_flags(["AAA"])["AAA"]),
        "finviz_universe": set(finviz_universe.read_finviz_fields(["AAA"])["AAA"]),
        "earnings_dates": set(earnings_dates.read_earnings_dates(["AAA"])["AAA"]),
        "earnings_context.last_move":
            set(earnings_context.read_last_report_move(["AAA"])["AAA"]),
        "earnings_context.implied":
            set(earnings_context.read_implied_context(["AAA"])["AAA"]),
        "analyst_pass": set(analyst_pass.read_analyst_fields(["AAA"])["AAA"]),
        "insider_capture": set(insider_capture.read_insider_fields(["AAA"])["AAA"]),
        "pattern_join": set(pattern_join.read_pattern_fields(["AAA"])["AAA"]),
        "darkpool_agg": set(
            darkpool_agg.read_darkpool_fields(["AAA"], closes={"AAA": 105.0})["AAA"]),
        "opt_flow": set(opt_flow.read_opt_flow_fields(["AAA"])["AAA"]),
    }


def test_no_two_screener_sources_write_the_same_column(monkeypatch, tmp_path):
    """🔁 A SECOND AUTHORITY OVER ONE VALUE is this repo's most repeated defect,
    and in `build_row` it does not even announce itself: the four sources are
    merged in order and the LAST one with a non-None value wins. A collision is
    therefore not a crash, not a duplicate, not a log line — it is one column
    quietly sourced from two providers, row by row, according to which of them
    happened to have data.

    🔴 THIS IS THE RAIL FOR THE 2026-08-09 HANDOVER. `op_margin`, `roe` and
    `peg` were claimed by BOTH `enrich.ratings_fields` and (now)
    `fundamentals_bulk`, and `RATINGS_PERCENTILE_ENABLED=1` on Railway means
    both writers RUN. `enrich` gave the three up (see its docstring); if anyone
    puts them back, this goes red by name.

    ⭐ IT IS PAIRWISE OVER ALL FOUR SOURCES, not "bulk against the others" —
    a collision between two sources that are not this module is the same defect
    and used to be invisible. It found one on arrival: see `SHARED_BY_DESIGN`.
    """
    sets = _source_key_sets(monkeypatch, tmp_path)
    # ⚠️ FIX ROUND 1 (2026-08-22 review, Minor 4): PINNED, mirroring the
    # closedTable `==138`-manifest-pin idiom. Without this, deleting an entry
    # from `_source_key_sets` shrinks the pairwise comparisons below and the
    # rail stays green — "13 sources, zero overlaps" reads identically to
    # "14 sources, zero overlaps" unless the count itself is asserted.
    # Growing (or shrinking) the source list means bumping this number
    # DELIBERATELY, in the same commit, never by accident.
    # 14 -> 17 (2026-08-22, Task A6): pattern_join / darkpool_agg / opt_flow.
    assert len(sets) == 17, (
        f"_source_key_sets returned {len(sets)} sources, expected 17 — a "
        f"source was added or removed from the fixture; bump this pin "
        f"deliberately")
    # The derivation proves nothing if a source emitted nothing.
    for label, keys in sets.items():
        assert keys, f"{label} emitted no columns — the derivation is broken"

    labels = sorted(sets)
    for i, a in enumerate(labels):
        for bb in labels[i + 1:]:
            allowed = set(SHARED_BY_DESIGN.get((a, bb), {})) | \
                      set(SHARED_BY_DESIGN.get((bb, a), {}))
            overlap = sorted((sets[a] & sets[bb]) - allowed)
            assert not overlap, (
                f"{a} and {bb} both write {overlap} — two authorities over one "
                f"column, resolved by nothing but build_row's merge order. "
                f"Decide an owner and remove the other writer.")

    # `market_cap` is carried by BOTH bulk payloads this module reads and is
    # deliberately taken from neither: `massive.get_market_cap` owns it.
    assert "market_cap" in sets["_read_fundamentals"]
    assert "market_cap" not in sets["fundamentals_bulk"]


def test_no_shared_column_allowance_outlives_its_overlap(monkeypatch, tmp_path):
    """⭐ THE SHRINK DIRECTION. An exemption list that only ever grows is a list
    nobody will look at again; the moment `sector` gets a single owner this
    fails and demands the entry be struck."""
    sets = _source_key_sets(monkeypatch, tmp_path)
    for (a, bb), columns in SHARED_BY_DESIGN.items():
        assert a in sets and bb in sets, f"unknown source in SHARED_BY_DESIGN: {(a, bb)}"
        for column, reason in columns.items():
            assert reason[:4].isdigit() and reason[4] == "-" and len(reason) > 20, \
                f"SHARED_BY_DESIGN[{a},{bb}][{column}] needs a dated reason, got {reason!r}"
            assert column in (sets[a] & sets[bb]), (
                f"{a} and {bb} no longer both write {column} — delete its "
                f"allowance rather than leaving a dead exemption behind")


def test_pattern_join_carrier_keys_are_named_and_never_columns(monkeypatch, tmp_path):
    """🔑 CONTROLLER RULING (Task A6 pre-flight): this file has NO general
    "every source key ⊆ snapshot_db.COLUMNS" assertion to extend — the only
    schema-membership check in the file is `test_every_column_written_is_a_
    real_snapshot_column`, and it is scoped to `fundamentals_bulk.
    COLUMNS_WRITTEN` alone. So `pattern_join`'s two CARRIER keys
    (`pattern_entry_px`/`pattern_stop_px` — the best active detection's raw
    entry/stop, which `build_row` reads off the `market_row` PARAMETER to
    derive `pattern_entry_dist_pct`/`pattern_stop_dist_pct`, then discards —
    `build_row`'s `row = {c: None for c in snapshot_db.COLUMNS}` + `if k in
    row` merge already drops any key that is not a real column, by
    construction) need an EXPLICIT, NAMED allowance here rather than living
    only as a comment in `pattern_join.py`: this is that allowance, scoped to
    exactly the two keys it exists for, in both directions.
    """
    sets = _source_key_sets(monkeypatch, tmp_path)
    carriers = {"pattern_entry_px", "pattern_stop_px"}

    # Direction 1: pattern_join really does emit both (the derivation proves
    # nothing if the fixture forgot to give it a best detection with levels).
    assert carriers <= sets["pattern_join"], (
        f"pattern_join did not emit its carrier keys: "
        f"{carriers - sets['pattern_join']} missing")

    # Direction 2: neither carrier is a real snapshot column — they must
    # never reach `screener_rows` under their own name.
    assert not (carriers & set(snapshot_db.COLUMNS)), (
        "a pattern_join carrier key is declared as a snapshot column — "
        "carriers must ride market_row only, never persist")

    # Direction 3: no OTHER source may emit either name — a carrier key is
    # pattern_join's alone by construction, never a second authority.
    for label, keys in sets.items():
        if label == "pattern_join":
            continue
        collision = carriers & keys
        assert not collision, (
            f"{label} also emits pattern_join's carrier key(s) {collision} — "
            f"carriers must be pattern_join-exclusive")


def test_the_three_handed_over_columns_are_written_here_and_nowhere_else(monkeypatch, tmp_path):
    """🔴 THE DECISION, ASSERTED IN BOTH DIRECTIONS. Absence from `enrich` alone
    would also be satisfied by nobody writing them at all — which is the state
    the whole phase started from. Presence here alone would be satisfied by two
    writers agreeing today and drifting tomorrow."""
    sets = _source_key_sets(monkeypatch, tmp_path)
    for column in ("op_margin", "roe", "peg"):
        owners = sorted(label for label, keys in sets.items() if column in keys)
        assert owners == ["fundamentals_bulk"], (
            f"{column} should be written by fundamentals_bulk and nothing else; "
            f"writers are {owners}")


def test_the_bulk_map_covers_every_scalar_that_had_no_collector():
    """⛔ DERIVED FROM THE MANIFEST + THE SCHEMA, never a list of ten typed here.

    A declared scalar whose column no OTHER screener source writes must be one
    this module writes, or it has no collector at all — which is exactly the
    state the whole task started from.
    """
    from api.services import ast_table
    declared = {n: (ast_table.scalar_source(n) or {}).get("column") or n
                for n in ast_table.scalar_names()}
    covered = fb.COLUMNS_WRITTEN
    for name, column in sorted(declared.items()):
        if column in covered:
            continue
        # Anything not ours must be written by the builder/enrich/technicals —
        # asserted by `test_scalar_population_rail.py` §1. Here we only assert
        # that OUR ten are in fact ours.
    for expected in ("dividend_yield", "pe_ttm", "ps", "pb", "gross_margin",
                     "net_margin", "roa", "debt_to_equity", "current_ratio",
                     "beta"):
        assert expected in covered
        assert declared.get(expected) == expected


def test_exchange_is_a_plain_name_not_a_mic():
    """⛔ THE `exchange == "NASDAQ"` SILENT ZERO-HIT. Polygon's
    `primary_exchange` is a MIC (`XNAS`) and writing it raw would make every
    exchange criterion match nothing while looking populated. FMP's field is
    already the plain short name, which is why this column rides the pass that
    was happening anyway instead of a second Massive round-trip plus a MIC map
    to own."""
    out = {}
    fb._absorb([{"symbol": "AAPL", "beta": "1.1", "exchange": "NASDAQ",
                 "exchangeFullName": "NASDAQ Global Select"}],
               fb.PROFILE_SPECS, {"AAPL"}, out, fb.PROFILE_TEXT)
    assert out["AAPL"]["exchange"] == "NASDAQ"
    assert not any(v.startswith("X") and v.isupper() and len(v) == 4
                   for v in [out["AAPL"]["exchange"]])


# ───────────────────────── the builder wire ─────────────────────────────────

def test_build_row_merges_the_bulk_slice(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    row = b.build_row("aapl", [], {}, {"company": "Apple"}, None,
                      {"pe_ttm": 35.8, "gross_margin": 48.7, "beta": 1.1,
                       "exchange": "NASDAQ"})
    assert row["pe_ttm"] == 35.8
    assert row["gross_margin"] == 48.7
    assert row["exchange"] == "NASDAQ"
    # ...and a ticker the provider had no row for keeps NULL rather than 0.
    bare = b.build_row("zzz", [], {}, {}, None, None)
    assert bare["pe_ttm"] is None and bare["beta"] is None
    assert bare["exchange"] is None


def test_run_build_counts_a_ticker_the_bulk_pass_had_no_row_for(tmp_path, monkeypatch):
    """A provider miss is COUNTED, so 3,700/3,700 (a dead endpoint) and 60/3,700
    (sixty odd symbols) can be told apart. Only the ratio distinguishes them."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    bars = [{"t": 20260100 + i, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1000}
            for i in range(60)]
    monkeypatch.setattr(b, "_load_universe", lambda: ["AAA", "BBB"])
    monkeypatch.setattr(b, "_read_daily_bars", lambda t: bars)
    monkeypatch.setattr(b, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_fundamentals",
                        lambda t, price=None, failures=None: {})
    monkeypatch.setattr(b, "_read_rs_map", lambda: {})
    monkeypatch.setattr(b, "_read_bulk_fundamentals",
                        lambda targets, failures=None: {"AAA": {"pe_ttm": 12.0}})
    from api.services.screener import context_joins as cj
    # context readers stubbed: run_build unit tests predate context joins; real reads trip the shared-data-root guard on the dev box
    monkeypatch.setattr(cj, "read_breadth_flags", lambda targets, failures=None: {})
    monkeypatch.setattr(cj, "read_uct20", lambda targets, failures=None: {})
    monkeypatch.setattr(cj, "read_index_flags", lambda targets, failures=None: {})
    monkeypatch.setattr(cj, "read_etf_flags", lambda targets, failures=None: {})

    stats = b.run_build()
    assert stats["sources"]["fmp_bulk"] == {"no_row": 1}
    assert stats["populated"]["pe_ttm"] == 1
    assert "pe_ttm" not in stats["empty_columns"]
    assert "beta" in stats["empty_columns"]
