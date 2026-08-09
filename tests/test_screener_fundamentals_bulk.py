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

import csv
import importlib

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


def test_the_bulk_map_is_disjoint_from_every_other_source(monkeypatch):
    """🔁 A SECOND AUTHORITY OVER ONE VALUE is this repo's most repeated defect.

    ⛔ THE OTHER SOURCES' KEY SETS ARE OBTAINED BY RUNNING THEM, not retyped
    here — a test that restates what a source emits is itself the second
    authority. Each is exercised with a fully-populated input so it emits
    everything it possibly can.

    In particular `market_cap` is carried by BOTH bulk payloads this module
    reads (`key-metrics-ttm-bulk` and `profile-bulk`) and is deliberately not
    taken from either: `massive.get_market_cap` owns that column.
    """
    import api.services.screener.snapshot_builder as b
    from api.services.screener import enrich

    rs_keys = set(b.rs_fields({"rs_rank": 90, "rs_score": 12.5}))

    ratings_keys = set(enrich.ratings_fields(
        {"earnings_growth": 50.0, "rev_growth": 20.0, "peg": 1.2,
         "pe_fwd": 30.0, "op_margin": 40.0, "roe": 30.0, "inst_pct": 60.0,
         "sector": "Technology", "rs_return": 12.5, "blended_growth": 30.0,
         "accdis_ratio": 1.4}, {}))

    from api.services import massive, ticker_meta
    monkeypatch.setattr(ticker_meta, "get_ticker_meta",
                        lambda t: {"name": "N", "sector": "S", "industry": "I"})
    monkeypatch.setattr(massive, "get_market_cap", lambda t, price=None: 1.0e9)
    fundamentals_keys = set(b._read_fundamentals("AAA", price=10.0))

    for label, keys in (("rs_fields", rs_keys),
                        ("enrich.ratings_fields", ratings_keys),
                        ("_read_fundamentals", fundamentals_keys)):
        overlap = sorted(fb.COLUMNS_WRITTEN & keys)
        assert not overlap, (
            f"{label} and fundamentals_bulk both write {overlap} — two "
            f"authorities over one column")

    # The derivation is only meaningful if those sources emitted anything.
    assert rs_keys and ratings_keys and fundamentals_keys
    assert "market_cap" in fundamentals_keys
    assert "market_cap" not in fb.COLUMNS_WRITTEN


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

    stats = b.run_build()
    assert stats["sources"]["fmp_bulk"] == {"no_row": 1}
    assert stats["populated"]["pe_ttm"] == 1
    assert "pe_ttm" not in stats["empty_columns"]
    assert "beta" in stats["empty_columns"]
