# tests/test_ssetf_fixture.py
"""Live-export fixture regression for the single-stock ETF parser (Task 10).

tests/fixtures/finviz_etf_sample.csv was captured from the REAL Finviz Elite
whole-market export on 2026-07-22 by `tools/ssetf_probe.py --save-fixture`.
It is self-contained: it carries the stock rows the parser needs to resolve
the families below (NBIS/TSLA/NVDA + the prefix-collision companies —
Longeveron/Long Table Growth, Bitcoin Infrastructure Acquisition, Apple
Hospitality, both Alphabet classes). Regenerate ONLY via the probe, then
re-run this suite: these assertions pin real-world parser behavior.
"""
import collections
import csv
import os

import pytest

from api.services.single_stock_etfs import EXPECTED_HEADERS, _num
from api.services.ssetf_parser import parse_etf_name

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "finviz_etf_sample.csv")


@pytest.fixture(scope="module")
def export():
    with open(FIXTURE, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    etf_rows = [r for r in rows if (r.get("Industry") or "").strip() == "Exchange Traded Fund"]
    stock_set = {(r.get("Ticker") or "").strip().upper(): (r.get("Company") or "").strip()
                 for r in rows if (r.get("Industry") or "").strip() != "Exchange Traded Fund"
                 and (r.get("Ticker") or "").strip()}
    return rows, etf_rows, stock_set


@pytest.fixture(scope="module")
def parsed(export):
    _, etf_rows, stock_set = export
    results = {}
    for r in etf_rows:
        t = (r.get("Ticker") or "").strip().upper()
        results[t] = parse_etf_name((r.get("Company") or ""), t, stock_set)
    return results


def test_fixture_headers_match_expected(export):
    rows, _, _ = export
    headers = list(rows[0].keys())
    assert headers == EXPECTED_HEADERS  # exact order pinned from the live export


def test_fixture_numeric_format_is_plain_thousands(export):
    # Probe-pinned (2026-07-22): Average Volume is a plain decimal in
    # THOUSANDS of shares — no comma grouping. SPY=52138.11 in the live
    # export; the fixture keeps NVDA-class rows whose avg volume must be
    # a big plain float, never a comma string and never a raw share count.
    rows, _, _ = export
    nvda = next(r for r in rows if r["Ticker"] == "NVDA")
    assert "," not in nvda["Average Volume"]
    v = _num(nvda["Average Volume"])
    assert v is not None and 10_000 < v < 10_000_000  # thousands-of-shares scale


def test_no_ambiguous_quarantine_on_real_export_names(parsed):
    ambiguous = [t for t, r in parsed.items()
                 if r.status == "quarantine" and r.reason == "ambiguous"]
    assert ambiguous == []


def test_quarantine_is_only_no_direction(parsed):
    # no_direction is the ONLY quarantine reason allowed on real export names —
    # both_directions / self_reference / ambiguous must never fire. In THIS
    # fixture the entire direction-less population is Corgi, which the issuer
    # rule (spec §3.2 rule 2 exception, EDGAR-verified) now resolves to long, so
    # the quarantine set is empty; the subset invariant still holds and the
    # spurious-reason guard below stays meaningful.
    reasons = collections.Counter(r.reason for r in parsed.values()
                                  if r.status == "quarantine")
    assert set(reasons) <= {"no_direction"}
    assert reasons.get("ambiguous", 0) == 0
    assert reasons.get("both_directions", 0) == 0
    assert reasons.get("self_reference", 0) == 0


def test_nbis_family_parses_complete(parsed):
    fam = {t: (r.direction, r.factor) for t, r in parsed.items()
           if r.status == "parsed" and r.underlying == "NBIS"}
    # Live family as of 2026-07-22. NBIC ("Corgi NBIS 2x Daily ETF") is
    # direction-less; the Corgi issuer rule (spec §3.2 rule 2 exception,
    # EDGAR-verified: zero Corgi inverse funds) classifies it LONG, so it now
    # JOINS the parsed family instead of quarantining.
    assert fam == {"NBIL": ("long", 2.0), "NEBX": ("long", 2.0),
                   "NBIG": ("long", 2.0), "NBIC": ("long", 2.0),
                   "NBIZ": ("short", 2.0)}
    assert (parsed["NBIC"].status, parsed["NBIC"].underlying,
            parsed["NBIC"].direction, parsed["NBIC"].factor) == ("parsed", "NBIS", "long", 2.0)


def test_corgi_directionless_funds_parse_long(parsed, export):
    # Corgi issuer rule (spec §3.2 rule 2 exception, EDGAR-verified) on REAL
    # export rows: every direction-less "Corgi <NAME> 2x Daily ETF" whose
    # underlying resolves is LONG — un-quarantining the owner's NBIC screenshot
    # case and its single-stock siblings. Corgi thematic/sector funds whose
    # underlying does NOT resolve stay plain skips (the rule never forces a bad
    # underlying), never a spurious long or quarantine.
    _, etf_rows, _ = export
    name_by_t = {(r.get("Ticker") or "").strip().upper(): (r.get("Company") or "")
                 for r in etf_rows}
    corgi = {t: r for t, r in parsed.items() if "corgi" in name_by_t.get(t, "").lower()}
    assert corgi, "fixture must contain Corgi rows"

    # No Corgi row is left quarantined no_direction — the whole point of the fix.
    still_nd = {t for t, r in corgi.items()
                if r.status == "quarantine" and r.reason == "no_direction"}
    assert still_nd == set()
    # Every resolvable Corgi single-stock fund parses LONG at its factor.
    resolved = {t: (r.underlying, r.direction, r.factor)
                for t, r in corgi.items() if r.status == "parsed"}
    assert resolved == {
        "NBIC": ("NBIS", "long", 2.0), "NVC": ("NVDA", "long", 2.0),
        "IOSX": ("AAPL", "long", 2.0), "MSFC": ("MSFT", "long", 2.0),
        "GOGL": ("GOOGL", "long", 2.0), "SMCC": ("SMCI", "long", 2.0),
        "TESC": ("TSLA", "long", 2.0),
    }
    # The issuer rule never yields SHORT, and the unresolved remainder are plain
    # skips (not quarantines) — underlying acceptance was never widened.
    assert all(r.direction == "long" for r in corgi.values() if r.status == "parsed")
    assert all(r.status in ("parsed", "skip") for r in corgi.values())


def test_trex_company_name_funds_resolve(parsed):
    # The company-name pass on REAL data — incl. the live-data regression:
    # the 'Long' span prefix-matches Longeveron + Long Table Growth (both in
    # the fixture) and must not veto the company span (TSLT bug).
    assert (parsed["TSLT"].underlying, parsed["TSLT"].direction) == ("TSLA", "long")
    assert (parsed["TSLZ"].underlying, parsed["TSLZ"].direction) == ("TSLA", "short")
    assert (parsed["NVDX"].underlying, parsed["NVDX"].direction) == ("NVDA", "long")
    assert (parsed["NVDQ"].underlying, parsed["NVDQ"].direction) == ("NVDA", "short")
    for t in ("TSLT", "TSLZ", "NVDX", "NVDQ"):
        assert parsed[t].status == "parsed"


def test_crypto_funds_never_map_to_treasury_companies(parsed):
    # BIXI ("Bitcoin Infrastructure Acquisition Corp") is in the fixture's
    # stock rows; the T-Rex Bitcoin pair must SKIP, not map to it.
    for t in ("BTCZ", "BTCL"):
        assert parsed[t].status == "skip", f"{t} should skip, got {parsed[t]}"


def test_ticker_pass_families_from_real_rows(parsed):
    # Spot-pin a few real ticker-pass rows across issuers.
    assert (parsed["NBIL"].underlying, parsed["NBIL"].direction) == ("NBIS", "long")
    assert (parsed["TSDD"].underlying, parsed["TSDD"].direction) == ("TSLA", "short")
    assert parsed["TSLS"].factor == 1.0   # Direxion Bear 1X
