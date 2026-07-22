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

# Real-data stock set slice (live Finviz export, 2026-07-22 probe): the
# collisions below actually exist and broke the company pass in production
# data. Keep these companies verbatim — they are the regression fixtures.
REAL_STOCK_SET = {
    **STOCK_SET,
    "LGVN": "Longeveron Inc",                              # 'Long' span multi-hit …
    "LTGRU": "Long Table Growth Corp",                     # … (2 companies)
    "BIXI": "Bitcoin Infrastructure Acquisition Corp Ltd", # 'Bitcoin' unique prefix
    "HSDT": "Solana Co",
    "AVAT": "Avalanche Treasury Corp",
    "MSFT": "Microsoft Corp",
}

def test_company_pass_survives_long_prefixed_companies():
    # Live bug: the 'Long' span prefix-matches Longeveron + Long Table Growth;
    # an early return killed the pass before 'Tesla' was evaluated, dropping
    # EVERY "T-REX 2X Long <Company>" fund (TSLT, NVDX, MSFX...). Spec §8
    # pins TSLT -> TSLA.
    r = parse_etf_name("T-REX 2X Long Tesla Daily Target ETF", "TSLT", REAL_STOCK_SET)
    assert (r.status, r.underlying, r.direction) == ("parsed", "TSLA", "long")
    r = parse_etf_name("T-Rex 2X Long Microsoft Daily Target ETF", "MSFX", REAL_STOCK_SET)
    assert (r.status, r.underlying, r.direction) == ("parsed", "MSFT", "long")

@pytest.mark.parametrize("name,etf", [
    ("T-Rex 2X Inverse Bitcoin Daily Target ETF", "BTCZ"),
    ("T-Rex 2X Long Bitcoin Daily Target ETF", "BTCL"),
    ("2x Solana ETF", "SOLT"),
])
def test_crypto_asset_funds_never_map_to_treasury_companies(name, etf):
    # Live bug: 'Bitcoin' uniquely prefix-matched Bitcoin Infrastructure
    # Acquisition Corp (BIXI) -> a crypto fund mapped to a SPAC. Crypto asset
    # words must never seed the company pass (spec §7: out of scope).
    r = parse_etf_name(name, etf, REAL_STOCK_SET)
    assert r.status != "parsed" and r.underlying not in ("BIXI", "HSDT", "AVAT")

def test_direction_words_never_seed_company_spans():
    # Structural guard (review finding): with a SINGLE Long*-prefixed company
    # in the universe, the 'Long' span would uniquely prefix-match it — so
    # "T-Rex 2X Long Bitcoin Daily Target ETF" would mis-map to a 2x-long
    # Longeveron fund (the catastrophic mode; today it is prevented only by
    # the lucky Longeveron+Long Table Growth multi-hit). Direction keywords
    # are barred from company-span seeding — company pass ONLY, the
    # BULL/Webull ticker-pass carve-out is untouched.
    stock = {"LGVN": "Longeveron Inc", "TSLA": "Tesla, Inc."}
    r = parse_etf_name("T-REX 2X Long Bitcoin Daily Target ETF", "BTCL", stock)
    assert r.status == "skip" and r.underlying != "LGVN"
    # ...and the exclusion must not break the legitimate company path:
    r = parse_etf_name("T-REX 2X Long Tesla Daily Target ETF", "TSLT", stock)
    assert (r.status, r.underlying, r.direction) == ("parsed", "TSLA", "long")


def test_fundlevel_ambiguity_still_none_when_two_spans_match_differently():
    # Two spans (both adjacent to the cluster) uniquely matching DIFFERENT
    # companies must still refuse: matches = {TSLA, MSFT} -> len != 1 ->
    # zero_candidates skip.
    r = parse_etf_name("Issuer Tesla 2X Long Microsoft Daily ETF", "XXXX", REAL_STOCK_SET)
    assert (r.status, r.reason) == ("skip", "zero_candidates")

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

# ── Corgi issuer rule (spec §3.2 rule 2 exception; EDGAR-verified) ──
# Corgi registers every fund as "Corgi <NAME> 2x Daily ETF" — 2x LONG but with
# "Long" dropped from the exchange name. SEC EDGAR shows ZERO Corgi inverse
# funds, and industry-wide a bearish fund ALWAYS carries an explicit token
# (short|inverse|bear or any negative multiplier -Nx), so a direction-less
# Corgi 2x name is safely LONG.
def test_corgi_directionless_is_long_nbis():
    # The owner's screenshot case (NBIC): was quarantined no_direction, now long.
    r = _p("Corgi NBIS 2x Daily ETF")
    assert (r.status, r.underlying, r.direction, r.factor) == ("parsed", "NBIS", "long", 2.0)

def test_corgi_directionless_is_long_nvda():
    r = _p("Corgi NVDA 2x Daily ETF")
    assert (r.status, r.underlying, r.direction, r.factor) == ("parsed", "NVDA", "long", 2.0)

def test_corgi_explicit_bearish_still_wins():
    # GUARDRAIL: a hypothetical FUTURE Corgi inverse name carries an explicit
    # bearish token — existing SHORT logic fires first, the issuer rule never
    # runs. It must resolve SHORT, never be forced long.
    r = _p("Corgi NBIS 2x Short Daily ETF")
    assert (r.status, r.underlying, r.direction, r.factor) == ("parsed", "NBIS", "short", 2.0)

def test_corgi_rule_never_forces_a_bad_underlying():
    # When the underlying does NOT resolve (thematic/sector Corgi fund, no single
    # ticker), the row still skips as zero_candidates — the issuer rule only
    # supplies the missing LONG direction, it never widens underlying acceptance.
    r = _p("Corgi Quantum Computing 2x Daily ETF")
    assert (r.status, r.reason, r.underlying) == ("skip", "zero_candidates", None)

def test_corgi_rule_is_issuer_scoped_and_does_not_leak():
    # A direction-less name from a NON-Corgi issuer must STILL quarantine
    # no_direction — the exception is scoped to the issuer allowlist only.
    r = _p("Acme NBIS 2x Daily ETF")
    assert (r.status, r.reason) == ("quarantine", "no_direction")

def test_minus_1x_implies_short():
    r = _p("Issuer -1x NBIS Daily ETF")
    assert (r.status, r.direction, r.factor) == ("parsed", "short", 1.0)

# ── Negative multiplier = bearish DIRECTION only; magnitude from _FACTOR_RE ──
def test_minus_2x_implies_short_factor_preserved():
    # -2x is bearish (direction), but the factor magnitude is still 2.0 — the
    # negative marker never overwrites the parsed factor.
    r = _p("Issuer -2x NBIS Daily ETF")
    assert (r.status, r.underlying, r.direction, r.factor) == ("parsed", "NBIS", "short", 2.0)

def test_corgi_directionless_negative_multiplier_is_short_not_long():
    # GUARDRAIL COMPLETION: a hypothetical direction-less Corgi -2x carries a
    # bearish token (the negative multiplier) → SHORT wins, the issuer LONG rule
    # never fires. This is the -Nx half of the _DIRECTIONLESS_LONG_ISSUERS guard.
    r = _p("Corgi NBIS -2x Daily ETF")
    assert (r.status, r.underlying, r.direction, r.factor) == ("parsed", "NBIS", "short", 2.0)

def test_negative_multiplier_plus_long_word_is_both_directions():
    # Contradictory name: an explicit LONG word AND a negative (bearish)
    # multiplier → both_directions quarantine (no guessing; existing logic wins).
    r = _p("Issuer -3x Long NVDA Daily ETF")
    assert (r.status, r.reason) == ("quarantine", "both_directions")

# ── Index/region stoplist: geographic INDEX funds skip, never mis-map ──
# Live-data finding (2026-07-22 probe): leveraged geographic index funds (out of
# scope, spec §3.2 rule 4) mis-mapped to single companies TWO ways — "Europe"/
# "Japan" prefix-matched closed-end funds (COMPANY pass), and the real MSCI
# ticker sat next to "Short" (TICKER pass). Both halves of the _INDEX_REGION_TERMS
# guard make them resolve ZERO candidates → skip. INDEX_STOCK_SET carries the REAL
# colliding companies so these are non-vacuous: WITHOUT the guard EFZ/EUM → MSCI
# and EPV/EWV → the closed-end funds.
INDEX_STOCK_SET = {
    **STOCK_SET,
    "MSCI": "MSCI Inc",                              # index provider, ALSO a real ticker
    "EEA": "European Equity Fund Inc",              # 'Europe' company-pass collision
    "JOF": "Japan Smaller Capitalization Fund Inc",  # 'Japan' company-pass collision
}

@pytest.mark.parametrize("name,etf", [
    ("ProShares UltraShort MSCI Japan -2x Shares", "EWV"),     # company pass (Japan→JOF)
    ("ProShares Short MSCI EAFE -1X Shares", "EFZ"),           # ticker pass (MSCI adj Short)
    ("ProShares UltraShort FTSE Europe -2X Shares", "EPV"),    # company pass (Europe→EEA)
    ("ProShares Short MSCI Emerging Markets -1x Shares", "EUM"),  # ticker pass (MSCI adj)
])
def test_geographic_index_funds_skip_not_mismap(name, etf):
    r = parse_etf_name(name, etf, INDEX_STOCK_SET)
    assert (r.status, r.underlying) == ("skip", None)
    assert r.underlying not in ("MSCI", "EEA", "JOF")

def test_index_stoplist_does_not_break_company_pass():
    # POSITIVE GUARD: the index/region stoplist must NOT block a legitimate
    # single-stock company-name match (Tesla / NVIDIA).
    r = parse_etf_name("T-REX 2X Long Tesla Daily Target ETF", "TSLT", INDEX_STOCK_SET)
    assert (r.status, r.underlying, r.direction) == ("parsed", "TSLA", "long")
    r = parse_etf_name("T-REX 2X Inverse NVIDIA Daily Target ETF", "NVDQ", INDEX_STOCK_SET)
    assert (r.status, r.underlying, r.direction) == ("parsed", "NVDA", "short")

def test_index_provider_ticker_still_resolves_as_genuine_single_stock():
    # MSCI as a BONA-FIDE single-stock underlying (not embedded in an index name)
    # STILL resolves via the ticker pass — the guard fires only when an index/
    # region term is ADJACENT, so a real "2x Long MSCI" fund is untouched.
    r = parse_etf_name("Issuer 2X Long MSCI Daily ETF", "MSCX", INDEX_STOCK_SET)
    assert (r.status, r.underlying, r.direction) == ("parsed", "MSCI", "long")

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
