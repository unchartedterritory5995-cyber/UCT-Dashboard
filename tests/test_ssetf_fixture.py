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
    _, _, _ = export
    with open(FIXTURE, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    nvda = next(r for r in rows if r["Ticker"] == "NVDA")
    assert "," not in nvda["Average Volume"]
    v = _num(nvda["Average Volume"])
    assert v is not None and 10_000 < v < 10_000_000  # thousands-of-shares scale


def test_no_ambiguous_quarantine_on_real_export_names(parsed):
    ambiguous = [t for t, r in parsed.items()
                 if r.status == "quarantine" and r.reason == "ambiguous"]
    assert ambiguous == []


def test_quarantine_is_only_no_direction(parsed):
    # Real-export quarantine population = direction-less names (the Corgi
    # suite + ProShares "Ultra/UltraShort ... 2x Shares"). both_directions
    # and self_reference must not fire on real names.
    reasons = collections.Counter(r.reason for r in parsed.values()
                                  if r.status == "quarantine")
    assert set(reasons) == {"no_direction"}


def test_nbis_family_parses_complete(parsed):
    fam = {t: (r.direction, r.factor) for t, r in parsed.items()
           if r.status == "parsed" and r.underlying == "NBIS"}
    # Live family as of 2026-07-22. NBIC ("Corgi NBIS 2x Daily ETF") is
    # direction-less -> quarantined by design (spec §3.2 rule 2), NOT parsed.
    assert fam == {"NBIL": ("long", 2.0), "NEBX": ("long", 2.0),
                   "NBIG": ("long", 2.0), "NBIZ": ("short", 2.0)}
    assert (parsed["NBIC"].status, parsed["NBIC"].reason) == ("quarantine", "no_direction")


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
