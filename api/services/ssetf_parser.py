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
_MINUS_1X_RE = re.compile(r"-1\s*[xX]\b")
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

    minus_1x = bool(_MINUS_1X_RE.search(name))
    m = _FACTOR_RE.search(name)
    if not (m or minus_1x):
        return ParseResult("skip", "no_factor")
    factor = 1.0 if (minus_1x and not m) else float(m.group(1))

    tokens = tokenize(name)

    # Anchor indices: factor tokens + minus-1x tokens (the "cluster" seed).
    anchor_idx = set()
    for i, tok in enumerate(tokens):
        if _FACTOR_RE.search(tok) or _MINUS_1X_RE.search(tok):
            anchor_idx.add(i)

    # Ticker candidates ANYWHERE in the name that resolve to a real symbol in
    # stock_set (collected BEFORE the direction scan so BULL/BEAR-as-ticker
    # tokens can mask themselves out of the keyword scan).
    cand_idx: dict[int, str] = {}
    for i, tok in enumerate(tokens):
        c = _candidate(tok)
        if c and c in stock_set:
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
    if minus_1x:
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
        return ParseResult("quarantine", "no_direction", underlying=underlying, factor=factor)
    if underlying == etf_ticker.upper():
        return ParseResult("quarantine", "self_reference", factor=factor)

    return ParseResult("parsed", None, underlying, "long" if long_hit else "short", factor)


def _company_pass(tokens: list[str], anchor_idx: set, stock_set: dict[str, str]) -> Optional[str]:
    def _norm(s: str) -> str:
        return re.sub(r"[^a-z0-9 ]", "", s.lower())

    companies = {t: _norm(c) for t, c in stock_set.items() if c}
    spans: list[str] = []
    for i, tok in enumerate(tokens):
        if not any(abs(i - a) <= 1 for a in anchor_idx):
            continue
        if not tok[:1].isupper() or _is_stoplisted(tok):
            continue
        for ln in (3, 2, 1):
            span = tokens[i:i + ln]
            if len(span) == ln and all(w[:1].isupper() and not _is_stoplisted(w) for w in span):
                spans.append(" ".join(span))
    matches = set()
    for span in spans:
        ns = _norm(span)
        if len(ns) < 4:          # 'AI', 'Big' — too short to prefix-match safely
            continue
        hits = [t for t, c in companies.items() if c.startswith(ns)]
        if len(hits) == 1:
            matches.add(hits[0])
        elif len(hits) > 1:
            return None          # sector-word ambiguity -> caller skips
    return matches.pop() if len(matches) == 1 else None
