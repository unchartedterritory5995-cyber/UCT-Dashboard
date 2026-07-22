# tests/test_ssetf_parser.py
"""Parser spec: docs/superpowers/specs/2026-07-21-single-stock-etf-switcher-design.md §3.2."""
import pytest
from api.services.ssetf_parser import parse_etf_name

STOCK_SET = {
    "NBIS": "Nebius Group NV", "NVDA": "NVIDIA Corp", "TSLA": "Tesla, Inc.",
    "SMCI": "Super Micro Computer Inc", "FANG": "Diamondback Energy Inc",
    "AI": "C3.ai Inc", "S": "SentinelOne Inc", "T": "AT&T Inc",
    "BULL": "Webull Corp", "BRK-B": "Berkshire Hathaway Inc",
}

def _p(name, etf="XXXX"):
    return parse_etf_name(name, etf, STOCK_SET)

# ── Happy paths: every corpus name parses exactly ──
@pytest.mark.parametrize("name,und,direc,factor", [
    ("GraniteShares 2x Long NBIS Daily ETF", "NBIS", "long", 2.0),
    ("GraniteShares 2x Short NVDA Daily ETF", "NVDA", "short", 2.0),
    ("Direxion Daily TSLA Bull 2X Shares", "TSLA", "long", 2.0),
    ("Direxion Daily TSLA Bear 1X Shares", "TSLA", "short", 1.0),
    ("Tradr 2X Long NBIS Daily ETF", "NBIS", "long", 2.0),
    ("Tradr 2X Short NBIS Daily ETF", "NBIS", "short", 2.0),
    ("Leverage Shares 2X Long NBIS Daily ETF", "NBIS", "long", 2.0),
    ("Defiance Daily Target 2X Long SMCI ETF", "SMCI", "long", 2.0),
    ("Defiance Daily Target 1.5X Short SMCI ETF", "SMCI", "short", 1.5),
])
def test_ticker_pass_corpus(name, und, direc, factor):
    r = _p(name)
    assert (r.status, r.underlying, r.direction, r.factor) == ("parsed", und, direc, factor)

# ── Company-name pass (T-REX convention) ──
@pytest.mark.parametrize("name,und,direc", [
    ("T-REX 2X Long Tesla Daily Target ETF", "TSLA", "long"),
    ("T-REX 2X Inverse NVIDIA Daily Target ETF", "NVDA", "short"),
])
def test_company_pass(name, und, direc):
    r = _p(name)
    assert (r.status, r.underlying, r.direction) == ("parsed", und, direc)

# ── Adversarial: live basket funds naming real tickers must NEVER map ──
def test_berz_fang_basket_never_maps():
    r = _p("MicroSectors FANG & Innovation -3X Inverse Leveraged ETN", "BERZ")
    assert r.status in ("skip", "quarantine") and r.underlying != "FANG"

def test_aibd_ai_basket_never_maps():
    r = _p("Direxion Daily AI and Big Data Bear 2X Shares", "AIBD")
    assert r.status in ("skip", "quarantine") and r.underlying != "AI"

# ── Leveraged index/sector funds: SILENT SKIP, not quarantine ──
@pytest.mark.parametrize("name", [
    "Direxion Daily Semiconductor Bull 3X Shares",
    "Direxion Daily Small Cap Bull 3X Shares",
    "Volatility Shares 2x Bitcoin Strategy ETF",
])
def test_index_sector_funds_skip(name):
    r = _p(name)
    assert r.status == "skip"

# ── Direction rules ──
def test_short_bull_webull_masks_candidate_before_direction_scan():
    r = _p("Tradr 2X Short BULL Daily ETF")
    assert (r.status, r.underlying, r.direction) == ("parsed", "BULL", "short")

def test_bullion_never_matches_bull_keyword():
    r = _p("Something 2X Gold Bullion Daily ETF")
    assert r.status == "skip"  # no direction keyword + no candidate -> not quarantine noise

def test_missing_direction_quarantines():
    r = _p("Corgi NBIS 2x Daily ETF")
    assert (r.status, r.reason) == ("quarantine", "no_direction")

def test_minus_1x_implies_short():
    r = _p("Issuer -1x NBIS Daily ETF")
    assert (r.status, r.direction, r.factor) == ("parsed", "short", 1.0)

# ── Exclusions ──
@pytest.mark.parametrize("name", [
    "YieldMax NVDA Option Income Strategy ETF",
    "Kurv Yield Premium Strategy NVDA ETF",
    "Innovator NVDA Buffer ETF",
    "MicroSectors FANG Index -2X Inverse Leveraged ETN",
])
def test_income_and_etn_index_excluded(name):
    assert _p(name).status == "skip"

# ── Structure rules ──
def test_two_adjacent_candidates_quarantine_ambiguous():
    r = _p("Weird 2X Long NVDA TSLA Daily ETF")
    assert (r.status, r.reason) == ("quarantine", "ambiguous")

def test_non_adjacent_ticker_not_accepted():
    # NVDA is 4 tokens from the factor/direction cluster -> zero candidates -> skip
    r = _p("NVDA Growth And Income Leaders 2X Long Basket ETF")
    assert r.status == "skip"

def test_non_adjacent_ticker_zero_candidates_no_exclusion():
    # Regression: the fixture above trips the "Income" exclusion gate before
    # ever reaching the adjacency logic, so it doesn't actually exercise the
    # non-adjacent-candidate -> zero_candidates path. This fixture has NO
    # excluded words: NVDA (idx 0) sits 4 tokens from the factor/direction
    # cluster ("2X" idx 4, "Long" idx 5) -> not within +/-1 -> falls through
    # to the company-name pass (which also finds nothing) -> zero_candidates.
    r = _p("NVDA Growth Leaders Fund 2X Long Basket Daily ETF")
    assert (r.status, r.reason) == ("skip", "zero_candidates")

def test_two_candidates_second_not_adjacent_still_ambiguous():
    # The >=2-candidates-anywhere rule fires regardless of adjacency: TSLA
    # (idx 0) is 2+ tokens from the "2X Long" cluster (idx 2-3) while NVDA
    # (idx 4) IS adjacent -- both still count, so this must quarantine as
    # ambiguous rather than silently accepting the lone adjacent one.
    r = _p("TSLA Weird 2X Long NVDA Daily ETF")
    assert (r.status, r.reason) == ("quarantine", "ambiguous")

def test_both_directions_quarantines():
    r = _p("Issuer 2X Long Short NVDA Daily ETF")
    assert (r.status, r.reason) == ("quarantine", "both_directions")

def test_no_factor_is_skip():
    assert _p("Vanguard Total Stock Market ETF").status == "skip"

def test_dotted_class_share_normalizes_to_hyphen():
    r = _p("Issuer 2X Long BRK.B Daily ETF")
    assert (r.status, r.underlying) == ("parsed", "BRK-B")

def test_self_reference_rejected():
    r = parse_etf_name("Tradr 2X Long NBIS Daily ETF", "NBIS", STOCK_SET)
    assert r.status == "quarantine" and r.reason == "self_reference"

def test_fractional_factor():
    r = _p("Issuer 1.25x Long NVDA Daily ETF")
    assert r.factor == 1.25
