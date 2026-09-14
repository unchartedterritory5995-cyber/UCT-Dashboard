"""The ASR / ticker / word alias table and the alias pass (W1 §3.5, §4.3; CONTRACTS §6.2).

apply_aliases(text) -> (text, corrections) rewrites what speech recognition got wrong
before extraction ("light" -> LITE, "Bryan Shannon" -> "Brian Shannon", "300 chairs" ->
"300 shares") and returns every change with its offsets IN THE RAW TEXT, so the raw
transcript is always recoverable and never overwritten (manifest R9).

WHY SOME ALIASES NEED CONTEXT. "light" is an English word before it is a mishearing of
LITE; rewriting "light volume today" would manufacture a ticker. An alias carries a
context rule: 'none' always fires, 'ticker' fires only beside a price or a trading cue and
never before words like "volume", 'quantity' fires only after a number or before "of".

THE TABLE. wisdom_ticker_aliases (scope asr | company_name | slang | crypto_vehicle) and
wisdom_word_aliases (core_002). Only approved rows fire. The seeds below are the owner's
W1 §3.5 rulings (approved) plus a few rows staged for review (not approved). Seeding is
INSERT OR IGNORE, so an owner edit to a seeded row is never overwritten.
"""
from __future__ import annotations

import functools
import logging
import re
import sqlite3
import threading
import time
from typing import Optional

log = logging.getLogger(__name__)

TICKER_SCOPES = ("asr", "company_name", "slang", "crypto_vehicle")
WORD_SCOPES = ("asr", "slang", "speaker")
CONTEXT_RULES = ("none", "ticker", "quantity")

#: (alias, scope, ticker, context_rule, approved, evidence_locator)
TICKER_ALIAS_SEEDS = (
    ("light", "asr", "LITE", "ticker", 1, "W1 §3.5 owner ruling; edu_videos:355 [00:36:06]"),
    ("ethereum", "crypto_vehicle", "ETHA", "ticker", 0, "W1 §4.2 crypto vehicle; staged for review"),
    ("ether", "crypto_vehicle", "ETHA", "ticker", 0, "W1 §4.2 crypto vehicle; staged for review"),
    ("bitcoin", "crypto_vehicle", "IBIT", "ticker", 0, "W1 §4.2 crypto vehicle; staged for review"),
)

#: (alias, replacement, scope, context_rule, approved, evidence_locator)
WORD_ALIAS_SEEDS = (
    ("Bryan Shannon", "Brian Shannon", "asr", "none", 1, "W1 §3.5 owner ruling; edu_videos:355 [00:09:44]"),
    ("Brian Chanan", "Brian Shannon", "asr", "none", 1, "W1 §3.5 owner ruling; edu_videos:355 [00:09:51]"),
    ("Brian Chan special", "Brian Shannon special", "asr", "none", 0,
     "setup-vocabulary-v0 ASR variant; staged for review (Brian Chan is also a real name)"),
    ("chairs", "shares", "asr", "quantity", 1, "W1 §3.5 owner ruling"),
)

#: Crypto name -> the listed vehicles the authors trade (W1 §4.2). Data; read by core/entities.py.
CRYPTO_VEHICLES = {
    "ETH": {"primary": "ETHA", "vehicles": ("ETHA", "ETHU", "ETHE", "FETH")},
    "BTC": {"primary": "IBIT", "vehicles": ("IBIT", "BITX", "BITO", "FBTC", "GBTC")},
}
CRYPTO_NAMES = {"ETH": "ETH", "ETHER": "ETH", "ETHEREUM": "ETH", "BTC": "BTC", "BITCOIN": "BTC"}

TICKER_CUES = frozenset({
    "shares", "chairs", "calls", "puts", "long", "short", "bought", "buy", "buying", "sold", "sell",
    "selling", "trim", "trimmed", "trimming", "add", "added", "adding", "position", "stock", "ticker",
    "entry", "stop", "undercut", "breakout", "gap", "gapped", "holding", "earnings", "chart",
})
TICKER_BLOCKERS = frozenset({
    "volume", "day", "days", "week", "weeks", "trading", "bar", "bars", "candle", "candles", "year",
    "years", "green", "red", "blue", "switch", "touch", "side", "weight", "speed", "sweet", "blocks",
})

_TOKEN_RE = re.compile(r"\$?\d[\d,]*(?:\.\d+)?|[A-Za-z][A-Za-z'’]*")
_NUMBER_RE = re.compile(r"^\$?\d[\d,]*(?:\.\d+)?$")
_CONTEXT_WINDOW_CHARS = 80
_CONTEXT_WINDOW_TOKENS = 4

_CACHE: dict = {}
_SEEDED: set = set()
_CACHE_LOCK = threading.Lock()
_CACHE_TTL_S = 60.0


@functools.lru_cache(maxsize=512)
def _pattern(alias: str) -> re.Pattern:
    body = r"\s+".join(re.escape(part) for part in alias.split())
    return re.compile(r"(?<![A-Za-z0-9])" + body + r"(?![A-Za-z0-9])", re.IGNORECASE)


def _context_ok(rule: str, text: str, start: int, end: int) -> bool:
    if rule == "none":
        return True
    before = _TOKEN_RE.findall(text[max(0, start - _CONTEXT_WINDOW_CHARS):start])[-_CONTEXT_WINDOW_TOKENS:]
    after = _TOKEN_RE.findall(text[end:end + _CONTEXT_WINDOW_CHARS])[:_CONTEXT_WINDOW_TOKENS]
    if rule == "quantity":
        return bool(before and _NUMBER_RE.match(before[-1])) or bool(after and after[0].lower() == "of")
    if rule == "ticker":
        if after and after[0].lower() in TICKER_BLOCKERS:
            return False
        window = before + after
        return any(_NUMBER_RE.match(t) for t in window) or any(t.lower() in TICKER_CUES for t in window)
    return False


def builtin_aliases() -> dict:
    """The approved seed rows, in load_aliases' shape. The fallback when wisdom.db cannot be read."""
    return {
        "ticker": [{"alias": a, "scope": s, "ticker": t, "context_rule": c}
                   for a, s, t, c, approved, _ in TICKER_ALIAS_SEEDS if approved],
        "word": [{"alias": a, "replacement": r, "scope": s, "context_rule": c}
                 for a, r, s, c, approved, _ in WORD_ALIAS_SEEDS if approved],
        "source": "built-in seeds",
    }


def seed(db_path: Optional[str] = None) -> dict:
    """Insert the seed rows that are missing. Never overwrites an existing row."""
    from api.services.wisdom.core import store

    with store.write(db_path) as conn:
        before = conn.total_changes
        conn.executemany(
            "INSERT OR IGNORE INTO wisdom_ticker_aliases(alias, scope, ticker, entity_id, approved, "
            "evidence_locator, context_rule) VALUES (?, ?, ?, NULL, ?, ?, ?)",
            [(a, s, t, approved, ev, c) for a, s, t, c, approved, ev in TICKER_ALIAS_SEEDS],
        )
        ticker_added = conn.total_changes - before
        before = conn.total_changes
        conn.executemany(
            "INSERT OR IGNORE INTO wisdom_word_aliases(alias, replacement, scope, context_rule, approved, "
            "evidence_locator) VALUES (?, ?, ?, ?, ?, ?)",
            [(a, r, s, c, approved, ev) for a, r, s, c, approved, ev in WORD_ALIAS_SEEDS],
        )
        word_added = conn.total_changes - before
    return {"ticker_aliases_inserted": ticker_added, "word_aliases_inserted": word_added}


def clear_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()
        _SEEDED.clear()


def load_aliases(db_path: Optional[str] = None, *, refresh: bool = False) -> dict:
    """Approved alias rows, cached per wisdom.db path for a minute. Seeds once per path."""
    from api.services.wisdom.core import store

    path = db_path or store.db_path()
    now = time.monotonic()
    with _CACHE_LOCK:
        hit = _CACHE.get(path)
        if hit is not None and not refresh and now - hit[0] < _CACHE_TTL_S:
            return hit[1]
    try:
        if path not in _SEEDED:
            seed(path)
            with _CACHE_LOCK:
                _SEEDED.add(path)
        with store.read(path) as conn:
            ticker = [dict(r) for r in conn.execute(
                "SELECT alias, scope, ticker, context_rule FROM wisdom_ticker_aliases WHERE approved = 1")]
            word = [dict(r) for r in conn.execute(
                "SELECT alias, replacement, scope, context_rule FROM wisdom_word_aliases WHERE approved = 1")]
        table = {"ticker": ticker, "word": word, "source": "wisdom.db"}
    except sqlite3.Error as exc:
        log.warning("[wisdom-aliases] wisdom.db alias tables unreadable (%s); using the built-in seeds",
                    type(exc).__name__)
        table = builtin_aliases()
    with _CACHE_LOCK:
        _CACHE[path] = (now, table)
    return table


def ticker_for_alias(alias: str, db_path: Optional[str] = None) -> Optional[str]:
    """The approved ticker an alias names, matched case-insensitively and exactly."""
    key = " ".join(str(alias or "").split()).casefold()
    if not key:
        return None
    for row in load_aliases(db_path).get("ticker", ()):
        if " ".join(str(row["alias"]).split()).casefold() == key:
            return str(row["ticker"]).upper()
    return None


def apply_aliases(text: str, *, segment_id: Optional[str] = None, record_id: Optional[str] = None,
                  db_path: Optional[str] = None, table: Optional[dict] = None) -> tuple[str, list[dict]]:
    """Rewrite approved aliases. Returns (corrected text, corrections in raw-text order).

    Each correction: kind (ticker_alias | word_alias), raw_value, normalized_value, rule
    ("<scope>:<alias>"), context_rule, start, end (offsets into the RAW text). With a
    segment_id, every correction is also logged to wisdom_stt_corrections (idempotently)."""
    if not text:
        return text or "", []
    table = table if table is not None else load_aliases(db_path)
    rules = [("ticker_alias", r["alias"], str(r["ticker"]).upper(), r.get("scope") or "asr",
              r.get("context_rule") or "none") for r in table.get("ticker", ())]
    rules += [("word_alias", r["alias"], r["replacement"], r.get("scope") or "asr",
               r.get("context_rule") or "none") for r in table.get("word", ())]
    rules.sort(key=lambda rule: (-len(rule[1]), rule[1].casefold()))
    taken: list[tuple[int, int]] = []
    corrections: list[dict] = []
    for kind, alias, replacement, scope, context_rule in rules:
        for match in _pattern(alias).finditer(text):
            start, end = match.span()
            if any(start < t_end and t_start < end for t_start, t_end in taken):
                continue
            if text[start:end] == replacement or not _context_ok(context_rule, text, start, end):
                continue
            taken.append((start, end))
            corrections.append({
                "kind": kind,
                "raw_value": text[start:end],
                "normalized_value": replacement,
                "rule": f"{scope}:{alias.casefold()}",
                "context_rule": context_rule,
                "start": start,
                "end": end,
            })
    corrections.sort(key=lambda c: c["start"])
    pieces, cursor = [], 0
    for correction in corrections:
        pieces.append(text[cursor:correction["start"]])
        pieces.append(correction["normalized_value"])
        cursor = correction["end"]
    pieces.append(text[cursor:])
    if segment_id and corrections:
        from api.services.wisdom.core import stt

        stt.log_corrections(segment_id, corrections, record_id=record_id, db_path=db_path)
    return "".join(pieces), corrections
