# api/services/ssetf_parser.py
"""Single-stock ETF name parser — pure functions, no I/O.

Spec: docs/superpowers/specs/2026-07-21-single-stock-etf-switcher-design.md §3.2.
Extracts (underlying, direction, factor) from leveraged/inverse fund names.
Never guesses: ambiguity -> quarantine; no single-stock signal -> silent skip.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

# Hard-skip (income products, buffers, index/ETN baskets) — case-insensitive.
_EXCLUDE_RE = re.compile(
    r"covered\s+call|option\s+income|\bincome\b|yieldmax|\bbuffer\b|\bpremium\b"
    r"|\bdividend\b|\bindex\b|\betns?\b",
    re.I,
)
_FACTOR_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[xX]\b")
# Any negative multiplier (-1x, -2x, -3x, -1.5x) is a bearish/inverse marker.
# DIRECTION ONLY — the factor MAGNITUDE still comes from _FACTOR_RE (which
# matches the "Nx" inside "-Nx"), so "-2x" => short at factor 2.0. This is the
# other half of the _DIRECTIONLESS_LONG_ISSUERS guardrail: industry convention
# (corgi-research.md) is that a leveraged LONG may drop its direction word, but
# a bearish fund ALWAYS carries an explicit token — short|inverse|bear or a
# negative multiplier — so no direction-less name can hide an inverse fund.
_MINUS_NX_RE = re.compile(r"-\d+(?:\.\d+)?\s*[xX]\b")
_LONG_RE = re.compile(r"\b(long|bull)\b", re.I)
_SHORT_RE = re.compile(r"\b(short|bear|inverse)\b", re.I)
_CAND_RE = re.compile(r"^[A-Z]{1,5}$")

# Issuer words + generic tokens that must never become an underlying candidate.
# Compared case-robustly (uppercased) against uppercased tokens. Deliberately
# does NOT include direction words (LONG/SHORT/BULL/BEAR/INVERSE) — "BULL" is
# a real ticker (Webull) and must remain eligible as a candidate so it can be
# masked out of the direction-keyword scan (see test_short_bull_webull_*).
_STOPLIST = {
    "ETF", "ETN", "ETFS", "US", "T-REX", "TREX", "TRADR", "CORGI",
    "DAILY", "TARGET", "SHARES",
}

# Crypto/commodity asset words that must never seed the COMPANY-NAME pass.
# Live-data finding (2026-07-22 probe): the crypto-treasury-company era means
# each of these uniquely prefix-matches a listed company ("Bitcoin" -> Bitcoin
# Infrastructure Acquisition Corp, "Solana" -> Solana Co, "Avalanche" ->
# Avalanche Treasury Corp, "Stellar" -> Stellar V Capital Corp), so "T-Rex 2X
# Inverse Bitcoin Daily Target ETF" was mis-mapped to a SPAC. These funds
# track the ASSET, not a stock -> must fall through to zero-candidate skip
# (spec §7: commodity/crypto funds are out of scope). Company-pass only; the
# ticker pass is unaffected. Side effect: a company legitimately named with
# one of these words ("Stellar Bancorp") can never be company-pass-matched —
# a safe silent skip; the §3.5 remap override is the escape hatch.
_CRYPTO_ASSETS = {
    "BITCOIN", "ETHER", "ETHEREUM", "SOLANA", "AVALANCHE", "STELLAR",
    "XRP", "RIPPLE", "DOGECOIN", "LITECOIN", "CARDANO", "CHAINLINK", "SUI",
}

# Issuers that register direction-less LONG names — a leverage factor with the
# direction word ("Long") dropped from the exchange name. Verified against SEC
# EDGAR (2026-07-22, corgi-research.md): Corgi ETF Trust I (CIK 0002078265) has
# ZERO inverse/short funds; all 144+ funds are single-stock 2x LONG registered
# as "Corgi <NAME> 2x Daily ETF". Because the entire industry ALWAYS labels a
# bearish/inverse fund explicitly (short|inverse|bear|-1x), a direction-less
# name from one of these issuers is safely LONG — and the guardrail is that this
# rule fires ONLY when NO bearish token is present (see parse_etf_name). Keep
# this list conservative: a future issuer with the same naming convention is a
# one-word add here. Watch: re-audit if EDGAR ever shows a fund-level Corgi
# "Short"/"Inverse" hit (currently 0).
_DIRECTIONLESS_LONG_ISSUERS = frozenset({"CORGI"})

# Direction keywords must never SEED a company-name span. They are inert
# today only by luck — each happens to multi-hit ("Long" -> Longeveron +
# Long Table Growth; "Bull" -> Bullish + Bullfrog AI) — but if one of those
# companies leaves the export, "Long" would uniquely prefix-match the
# survivor and "T-Rex 2X Long Bitcoin Daily Target ETF" would mis-map to a
# 2x-long Longeveron fund (the catastrophic mode). Company-pass only: the
# BULL/Webull ticker-pass carve-out (_candidate/_STOPLIST) is untouched.
_DIRECTION_WORDS = {"LONG", "SHORT", "BULL", "BEAR", "INVERSE"}

# Index-provider + geographic/region + broad-market-structure words that must
# never SEED a company-name span (and bar a ticker candidate adjacent to one).
# Live-data finding (2026-07-22 probe): leveraged GEOGRAPHIC/BROAD-MARKET INDEX
# funds (out of scope, spec §3.2 rule 4 — index funds skip) coincidentally
# prefix-match single-company closed-end funds via the company pass — "Europe" ->
# European Equity Fund Inc (EPV), "Japan" -> Japan Smaller Capitalization Fund Inc
# (EWV), "Mid-Cap" -> MidCap Financial Investment Corp (the XVO bug: "Corgi U.S.
# Mid-Cap 2x Daily ETF" mis-mapped to MFIC as a bogus single-stock long) — turning
# an index fund into a bogus single-stock pick. These words name a REGION, an INDEX
# FAMILY, or a MARKET-CAP SEGMENT, never a single-stock underlying's company name
# (a real single-stock fund names an actual company, e.g. Tesla/NVIDIA). Barring
# them as span seeds makes the whole class resolve ZERO company candidates ->
# silent skip. Company-pass + the adjacent-ticker guard; a legitimately-tickered
# single-stock fund is unaffected, and an index-provider that is ALSO a real ticker
# (e.g. MSCI) still resolves via the ticker pass when it is the genuine adjacent
# underlying. §3.5 remap override is the escape hatch if a real company ever
# legitimately leads with one of these.
_INDEX_REGION_TERMS = {
    "MSCI", "FTSE", "RUSSELL", "STOXX", "EAFE", "EMERGING", "MARKETS",
    "EUROPE", "EUROZONE", "JAPAN", "CHINA", "BRAZIL", "MEXICO", "GERMANY",
    "INDIA", "KOREA", "TAIWAN", "PACIFIC", "WORLD", "GLOBAL", "DEVELOPED",
    # Broad-market / market-cap-segment terms (index funds, not single stocks).
    "MID-CAP", "MIDCAP", "SMALL-CAP", "SMALLCAP", "LARGE-CAP", "LARGECAP",
    "MEGA-CAP", "MEGACAP", "MICRO-CAP", "MICROCAP", "EQUITIES",
}

# Sector / theme / index-family words that must never SEED a company-name span.
# Live-data finding (2026-07-22 probe): leveraged SECTOR/THEME/INDEX funds (out of
# scope, spec §3.2 rule 4 — index/sector funds skip) coincidentally prefix-match a
# small single-company name via the company pass — e.g. "Financial" (Direxion
# Financial Bull 3X, FAS/FAZ) -> Financial Institutions Inc; "Biotech" (S&P Biotech,
# LABU/LABD; Corgi U.S. Biotech, XBIX) -> Bio-Techne Corp; "Medical" (Pharmaceutical
# & Medical, PILL) -> Medical Properties Trust; "Innovation" (Tradr Innovation,
# TARK/SARK) -> Innovation Beverage Group; "Regional" (Regional Banks, SKRE) ->
# Regional Management; "Prod" (S&P Oil & Gas Exp. & Prod., DRIP/GUSH) -> Pro-Dex;
# "FANG+" (NYSE FANG+, FNGG) -> Fangdd Network — each a bogus single-stock pick.
# These name a SECTOR, THEME, or INDEX FAMILY, never a single-stock underlying's
# company name (no marquee single-stock ETF underlying — Tesla/NVIDIA/Microsoft/
# Apple/Coinbase/... — is named with a sector word). Compared in stripped-alpha
# form (so "FANG+" -> "FANG", "Mid-Cap" -> "MIDCAP") against the seed word; company
# pass ONLY (the ticker pass is untouched, so a real ticker like ENPH/ET still
# resolves). §3.5 remap override is the escape hatch for any real exception.
_NONSTOCK_SPAN_TERMS = frozenset({
    # region + index-provider + market-cap (stripped forms of _INDEX_REGION_TERMS)
    "MSCI", "FTSE", "RUSSELL", "STOXX", "EAFE", "EMERGING", "MARKETS", "EUROPE",
    "EUROZONE", "JAPAN", "CHINA", "BRAZIL", "MEXICO", "GERMANY", "INDIA", "KOREA",
    "TAIWAN", "PACIFIC", "WORLD", "GLOBAL", "DEVELOPED", "MIDCAP", "SMALLCAP",
    "LARGECAP", "MEGACAP", "MICROCAP", "EQUITIES",
    # sector / industry
    "FINANCIAL", "FINANCIALS", "BANK", "BANKS", "BIOTECH", "BIOTECHNOLOGY",
    "PHARMACEUTICAL", "PHARMACEUTICALS", "PHARMA", "MEDICAL", "HEALTHCARE",
    "REGIONAL", "OIL", "GAS", "EXPLORATION", "PRODUCTION", "PROD", "ENERGY",
    "TECHNOLOGY", "SEMICONDUCTOR", "SEMICONDUCTORS", "RETAIL", "UTILITIES",
    "UTILITY", "INDUSTRIALS", "MATERIALS", "CONSUMER", "STAPLES", "DISCRETIONARY",
    "MINERS", "MINING", "AEROSPACE", "DEFENSE", "HOMEBUILDERS", "TRANSPORTATION",
    "TELECOM", "TELECOMMUNICATIONS", "INSURANCE", "REIT", "REITS",
    # theme / index family
    "INNOVATION", "FANG", "NYSE", "NASDAQ", "INTERNET", "CLOUD", "ROBOTICS",
    "CANNABIS", "URANIUM", "LITHIUM", "SOLAR", "AIRLINES", "INFRASTRUCTURE",
    "MOMENTUM", "CRYPTOCURRENCY",
})

# No-separator class-share aliases. Finviz fund names sometimes write a class
# share without the hyphen the universe stores ("Corgi BRKB 2x Daily ETF",
# "Direxion Daily BRKB Bull 2X ETF" — the underlying is Berkshire's BRK-B).
# Applied only when the alias IS a real symbol and the literal token is NOT, so
# a future genuine "BRKB" listing would still win via the direct match.
_TICKER_ALIASES = {"BRKB": "BRK-B", "BRKA": "BRK-A"}


@dataclass
class ParseResult:
    status: str                      # 'parsed' | 'skip' | 'quarantine'
    reason: Optional[str] = None
    underlying: Optional[str] = None
    direction: Optional[str] = None  # 'long' | 'short'
    factor: Optional[float] = None


def tokenize(name: str) -> list[str]:
    """Whitespace-only split; strip leading/trailing punctuation per token.
    Interior punctuation survives (S&P, T-Rex stay single tokens)."""
    out = []
    for raw in name.split():
        t = raw.strip(".,;:()[]{}'\"!?")
        if t:
            out.append(t)
    return out


def _is_stoplisted(tok: str) -> bool:
    return tok.upper() in _STOPLIST


def _candidate(tok: str) -> Optional[str]:
    """Ticker-candidate normalization: dotted class share ('BRK.B') -> hyphen
    ('BRK-B'), then require the (possibly hyphenated) result look like a
    plausible ticker. The stoplist check is case-robust (issuer words like
    'Shares'/'SHARES' both excluded); the base regex ^[A-Z]{1,5}$ already
    rejects mixed-case tokens as candidates before we even get here."""
    if _is_stoplisted(tok):
        return None

    t = tok
    if re.fullmatch(r"[A-Z]{1,4}\.[A-Z]", tok):
        t = tok.replace(".", "-")

    # Plain all-caps ticker (1-5 letters).
    if _CAND_RE.fullmatch(t):
        return t

    # Class-share form (e.g. BRK-B): letters-hyphen-letter, base must fit
    # the ticker shape once the hyphen is removed.
    if re.fullmatch(r"[A-Z]{1,4}-[A-Z]", t):
        base = t.replace("-", "")
        if _CAND_RE.fullmatch(base):
            return t

    return None


def parse_etf_name(name: str, etf_ticker: str, stock_set: dict[str, str]) -> ParseResult:
    if _EXCLUDE_RE.search(name):
        return ParseResult("skip", "excluded")

    minus_nx = bool(_MINUS_NX_RE.search(name))
    m = _FACTOR_RE.search(name)
    if not (m or minus_nx):
        return ParseResult("skip", "no_factor")
    # Factor MAGNITUDE always from _FACTOR_RE; the negative marker only flips
    # DIRECTION (below). The 1.0 fallback covers a bare "-1x"-style token with
    # no other _FACTOR_RE match (defensive — "-Nx" contains "Nx" so m normally
    # matches and the parsed magnitude wins, e.g. "-2x" => factor 2.0).
    factor = 1.0 if (minus_nx and not m) else float(m.group(1))

    tokens = tokenize(name)

    # Anchor indices: factor tokens + negative-multiplier tokens (cluster seed).
    anchor_idx = set()
    for i, tok in enumerate(tokens):
        if _FACTOR_RE.search(tok) or _MINUS_NX_RE.search(tok):
            anchor_idx.add(i)

    # Ticker candidates ANYWHERE in the name that resolve to a real symbol in
    # stock_set (collected BEFORE the direction scan so BULL/BEAR-as-ticker
    # tokens can mask themselves out of the keyword scan).
    cand_idx: dict[int, str] = {}
    for i, tok in enumerate(tokens):
        c = _candidate(tok)
        # No-separator class-share alias (BRKB -> BRK-B) only when the alias is a
        # real symbol and the literal candidate is not (direct match always wins).
        if c and c not in stock_set and c in _TICKER_ALIASES and _TICKER_ALIASES[c] in stock_set:
            c = _TICKER_ALIASES[c]
        if c and c in stock_set:
            # Reject an index-provider ticker embedded in an index name: "MSCI"
            # in "ProShares Short MSCI EAFE" / "MSCI Japan" is the index family,
            # not MSCI Inc — it is a real ticker sitting next to a region/index
            # term (spec §3.2 rule 4: index funds skip). A genuine single-stock
            # ticker is NEVER adjacent to a region/index word ("2x Long NBIS
            # Daily" — NBIS is flanked by leverage grammar), so this can't drop a
            # real single-stock fund; MSCI as a bona-fide single-stock underlying
            # ("2x Long MSCI Daily") is untouched (no adjacent index term). This
            # is the ticker-pass half of the _INDEX_REGION_TERMS guard.
            if any(0 <= i + d < len(tokens)
                   and tokens[i + d].upper() in _INDEX_REGION_TERMS
                   for d in (-1, 1)):
                continue
            cand_idx[i] = c

    # Direction scan over tokens, with candidate tokens MASKED — e.g. "BULL"
    # as a ticker candidate must not also fire the long-keyword regex.
    long_hit = short_hit = False
    for i, tok in enumerate(tokens):
        if i in cand_idx:
            continue
        if _LONG_RE.fullmatch(tok):
            long_hit = True
            anchor_idx.add(i)
        elif _SHORT_RE.fullmatch(tok):
            short_hit = True
            anchor_idx.add(i)
    if minus_nx:
        short_hit = True

    if long_hit and short_hit:
        return ParseResult("quarantine", "both_directions", factor=factor)

    def _adjacent(i: int) -> bool:
        return any(abs(i - a) <= 1 for a in anchor_idx)

    # Rule: if TWO OR MORE in-universe ticker candidates appear ANYWHERE in
    # the name (regardless of adjacency), the name is ambiguous. If exactly
    # one exists, it's accepted only when adjacent (±1 token) to the
    # factor/direction cluster; a lone non-adjacent candidate falls through
    # to the company-name pass rather than being accepted directly.
    underlying = None
    if len(cand_idx) >= 2:
        return ParseResult("quarantine", "ambiguous", factor=factor)
    elif len(cand_idx) == 1:
        only_i, only_c = next(iter(cand_idx.items()))
        if _adjacent(only_i):
            underlying = only_c

    if underlying is None:
        # Company-name pass (T-REX convention): capitalized spans (1-3 words)
        # adjacent to the cluster, PREFIX-matched against company names.
        underlying = _company_pass(tokens, anchor_idx, stock_set)
        if underlying is None:
            return ParseResult("skip", "zero_candidates", factor=factor)

    if not (long_hit or short_hit):
        # Issuer rule (spec §3.2 rule 2 exception): a direction-less leveraged
        # name from a _DIRECTIONLESS_LONG_ISSUERS sponsor is LONG. Reaching this
        # branch already guarantees NO bearish token matched (short/bear/inverse
        # via _SHORT_RE, any negative multiplier -Nx via minus_nx) — so the "no
        # bearish word present" guardrail is structural, not a second keyword
        # list, and it now catches a hypothetical direction-less -2x/-3x. The
        # underlying is
        # already resolved above (ticker or company pass); this rule ONLY
        # supplies the missing direction, it never widens underlying acceptance
        # (an unresolved underlying skipped as zero_candidates before here).
        if any(t.upper() in _DIRECTIONLESS_LONG_ISSUERS for t in tokens):
            long_hit = True
        else:
            return ParseResult("quarantine", "no_direction", underlying=underlying, factor=factor)
    if underlying == etf_ticker.upper():
        return ParseResult("quarantine", "self_reference", factor=factor)

    return ParseResult("parsed", None, underlying, "long" if long_hit else "short", factor)


def _company_pass(tokens: list[str], anchor_idx: set, stock_set: dict[str, str]) -> Optional[str]:
    def _norm(s: str) -> str:
        return re.sub(r"[^a-z0-9 ]", "", s.lower())

    def _span_word_ok(w: str) -> bool:
        wa = re.sub(r"[^A-Z]", "", w.upper())   # "FANG+" -> "FANG", "Mid-Cap" -> "MIDCAP"
        return (w[:1].isupper() and not _is_stoplisted(w)
                and w.upper() not in _CRYPTO_ASSETS
                and w.upper() not in _DIRECTION_WORDS
                and w.upper() not in _INDEX_REGION_TERMS
                and wa not in _NONSTOCK_SPAN_TERMS)

    companies = {t: _norm(c) for t, c in stock_set.items() if c}
    spans: list[str] = []
    for i, tok in enumerate(tokens):
        if not any(abs(i - a) <= 1 for a in anchor_idx):
            continue
        if not _span_word_ok(tok):
            continue
        for ln in (3, 2, 1):
            span = tokens[i:i + ln]
            if len(span) == ln and all(_span_word_ok(w) for w in span):
                spans.append(" ".join(span))
    matches = set()
    for span in spans:
        ns = _norm(span)
        if len(ns) < 4:          # 'AI', 'Big' — too short to prefix-match safely
            continue
        hits = [t for t, c in companies.items() if c.startswith(ns)]
        if len(hits) == 1:
            matches.add(hits[0])
        # >1 hits: the SPAN is ambiguous ('Long' -> Longeveron + Long Table
        # Growth; 'Semiconductor' -> many), so it identifies nothing — but it
        # must not veto OTHER spans. Live-data bug (2026-07-22 probe): an
        # early `return None` here killed every "T-REX 2X Long <Company>"
        # name (the 'Long' span multi-hits real Long*-prefixed companies)
        # before the company span was ever evaluated — spec §8 pins TSLT ->
        # TSLA. Fund-level ambiguity is still caught below: two spans
        # uniquely matching DIFFERENT companies -> len(matches) != 1 -> None.
    return matches.pop() if len(matches) == 1 else None
