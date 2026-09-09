"""Subject-vs-mention and ticker relevance — Stage 3.

THE FINDING THIS MODULE EXISTS FOR
    Source validation showed the dominant failure mode of every news provider
    is not spam. It is a real article about a real company tagged to a
    DIFFERENT one:

        tagged ONTO  ->  "Can Amtech's Booking Momentum Unlock Growth?"
        tagged RMBS  ->  "Netlist Soars 667% Year to Date"
        tagged HON   ->  "Strength in Transportation & Electronics Drives 3M"
        tagged AAPL  ->  "Is Adobe's Stock Heading for $300?"

    No headline regex catches that. Only an explicit subject test does, and it
    has to run on EVERY source -- provider tags are a signal, never a verdict.

THE COLLISION TRAP
    ON, ALL, CAT, IT, AI, BEAM, PLUG, WING, KEY, GO are ordinary English words.
    A bare symbol match is therefore only accepted in `$SYM` or `(SYM)` form.
    Identity otherwise comes from the company NAME and its aliases. This
    deliberately under-detects rather than over-detects: a missed SUBJECT costs
    one absent story, a false SUBJECT puts someone else's news in the feed.
"""

from __future__ import annotations

import functools
import re
import threading

SUBJECT = "subject"      # the company is what the story is about
RELATED = "related"      # materially involved: supplier, customer, counterparty
MENTION = "mention"      # named, but the story is about someone else
UNKNOWN = "unknown"      # tagged by a provider with no textual support

# Relevance levels used by the feed (§10/§11).
REL_DIRECT = "direct"
REL_RELATED = "related"
REL_MENTION = "mention"
REL_UNKNOWN = "unknown"

# Only these enter the default company feed.
FEED_RELEVANCE = frozenset({REL_DIRECT})

_LOCK = threading.Lock()

# Symbols that are also ordinary English or too short to match loosely.
_AMBIGUOUS = frozenset({
    "ON", "ALL", "CAT", "IT", "AI", "BEAM", "PLUG", "WING", "KEY", "GO", "SO",
    "OR", "BY", "AT", "BE", "AN", "AS", "IF", "NOW", "NEW", "ONE", "OUT", "UP",
    "RUN", "SEE", "TRUE", "OPEN", "WELL", "FAST", "REAL", "GOOD", "LOVE",
    "CARS", "FUN", "HOPE", "LIFE", "MAIN", "MASS", "PLAY", "SAFE", "SNOW",
    "STAR", "TEAM", "WORK", "EAT", "JOB", "PAY", "BIG", "OLD", "RIDE", "EDIT",
})

# Corporate suffixes stripped before matching a company name.
_SUFFIX_RE = re.compile(
    r"\b(?:inc|incorporated|corp|corporation|co|company|ltd|limited|plc|"
    r"holdings?|group|technologies|technology|systems|solutions|industries|"
    r"international|enterprises|partners|trust|nv|sa|ag|se|llc|lp|adr|"
    r"class\s+[abc]|the)\b\.?", re.I)
_PUNCT_RE = re.compile(r"[^\w\s&]+")
_WS_RE = re.compile(r"\s+")


def _core_name(name: str) -> str:
    """'Micron Technology, Inc.' -> 'micron'."""
    s = _PUNCT_RE.sub(" ", (name or "").lower())
    s = _SUFFIX_RE.sub(" ", s)
    return _WS_RE.sub(" ", s).strip()


_CAMEL_1 = re.compile(r"(?<=[a-z])(?=[A-Z])")        # ExxonMobil -> Exxon|Mobil
_CAMEL_2 = re.compile(r"(?<=[A-Z])(?=[A-Z][a-z])")   # JPMorgan   -> JP|Morgan


def _decamel(name: str) -> str:
    """Split run-together registered names into their editorial spelling.

    SEC registers "ExxonMobil Holdings Corp" and "JPMorgan Chase & Co" as one
    word where every headline writes "Exxon Mobil" and "JP Morgan". Splitting
    on the case boundary is precise — it adds a spelling, not a looser match,
    so it introduces no false-positive surface.
    """
    return _CAMEL_2.sub(" ", _CAMEL_1.sub(" ", name or ""))


@functools.lru_cache(maxsize=4096)
def _aliases(symbol: str, company_name: str) -> tuple[str, ...]:
    """Lowercased name forms that identify this company in prose."""
    out: set[str] = set()
    split = _decamel(company_name)
    if split != company_name:
        alt = _core_name(split)
        if alt and len(alt) >= 3:
            out.add(alt)
    core = _core_name(company_name)
    if core and len(core) >= 3:
        out.add(core)
        # First token, when it is a distinctive word ("micron", "caterpillar").
        first = core.split(" ")[0]
        if len(first) >= 5 and first not in ("first", "great", "united",
                                             "american", "national", "global",
                                             "general", "advanced", "pacific"):
            out.add(first)
    full = _WS_RE.sub(" ", _PUNCT_RE.sub(" ", (company_name or "").lower())).strip()
    if full and len(full) >= 4:
        out.add(full)
    return tuple(sorted(out, key=len, reverse=True))


def _company_name_for(symbol: str) -> str:
    """Company name for the subject test. Never raises, never blocks ingest.

    ⚠️ THE NAME IS LOAD-BEARING, not a nicety. Without it, matching falls back
    to the bare symbol — and a symbol only counts in `$MU` / `(NASDAQ:MU)`
    form, which appears in article BODIES far more often than in headlines. The
    first live FMP pull classified every genuine Micron press release
    ("Micron and Anthropic Announce Strategic Agreement", "Micron Reports
    Record Results") as `related` rather than `subject`, and the default feed
    showed none of them. `catalyst.ticker_metadata` was the wrong source: it
    returns sector / industry / market cap and no name at all.

    SEC's `company_tickers.json` carries a registered name for every
    US-listed issuer, is free, needs no key, and is already cached for the
    filings lane.
    """
    try:
        from api.services import sec_filings
        name = (sec_filings.company_name(symbol) or "").strip()
        if name:
            return name
    except Exception:
        pass
    try:
        from api.services.catalyst import ticker_metadata
        meta = ticker_metadata.get_metadata(symbol) or {}
        return (meta.get("name") or meta.get("company_name")
                or meta.get("longName") or "")
    except Exception:
        return ""


_NAME_CACHE: dict[str, str] = {}


def company_name(symbol: str) -> str:
    sym = (symbol or "").upper().strip()
    if not sym:
        return ""
    if sym in _NAME_CACHE:
        return _NAME_CACHE[sym]
    name = _company_name_for(sym)
    with _LOCK:
        _NAME_CACHE[sym] = name
    return name


def set_company_name(symbol: str, name: str) -> None:
    """Test/ingest hook: seed the name cache without a metadata lookup."""
    with _LOCK:
        _NAME_CACHE[(symbol or "").upper().strip()] = name or ""


def _symbol_hit(sym: str, text: str) -> bool:
    """A bare symbol counts only in cashtag or parenthesised form."""
    if not sym or not text:
        return False
    s = sym.upper()
    t = text.upper()
    if f"${s}" in t:
        return True
    if re.search(rf"[(\[]\s*(?:NASDAQ|NYSE|NYSEAMERICAN|AMEX|OTC|CBOE)?\s*:?\s*{re.escape(s)}\s*[)\]]", t):
        return True
    # An unambiguous symbol may match as a standalone token.
    if s not in _AMBIGUOUS and len(s) >= 3:
        return re.search(rf"(?<![A-Z0-9$.]){re.escape(s)}(?![A-Z0-9.])", t) is not None
    return False


def _norm_text(s: str) -> str:
    """Fold prose the same way company names are folded.

    Both sides must be normalized or punctuation silently breaks the match:
    SEC registers Coca-Cola as "COCA COLA CO" (no hyphen) while every headline
    writes "Coca-Cola", so an un-normalized haystack missed the single most
    obvious match in the test set.
    """
    return _WS_RE.sub(" ", _PUNCT_RE.sub(" ", (s or "").lower())).strip()


def _name_hit(names: tuple[str, ...], text: str) -> bool:
    if not text:
        return False
    t = _norm_text(text)
    if any(re.search(rf"(?<![a-z0-9]){re.escape(n)}(?![a-z0-9])", t) for n in names):
        return True
    # Space-insensitive fallback for registered spellings that differ from
    # editorial ones in whitespace alone: SEC has "JPMORGAN CHASE & CO" (no
    # case boundary to split on) while a headline may write "JP Morgan".
    # Gated at 8+ characters — long enough that a run-together match cannot
    # plausibly be an accident of two adjacent words.
    squashed = t.replace(" ", "")
    return any(len(n) >= 8 and n.replace(" ", "") in squashed for n in names)


def classify_subject(
    symbol: str,
    title: str,
    body: str = "",
    *,
    name: str | None = None,
    provider_tags: list[str] | None = None,
    provider: str = "",
    cik_match: bool = False,
) -> str:
    """SUBJECT | RELATED | MENTION | UNKNOWN for one (symbol, article) pair.

    Precedence:
      1. A CIK match on a filing is identity -- nothing beats it.
      2. Named in the HEADLINE -> subject.
      3. Named only in the body, and the provider tagged it -> mention.
      4. Provider tagged it but the text never names it -> unknown.
    """
    sym = (symbol or "").upper().strip()
    if not sym:
        return UNKNOWN
    if cik_match or provider == "sec":
        return SUBJECT

    nm = name if name is not None else company_name(sym)
    names = _aliases(sym, nm) if nm else ()

    if _name_hit(names, title) or _symbol_hit(sym, title):
        return SUBJECT

    tags = [t.upper() for t in (provider_tags or [])]
    tagged = sym in tags

    if _name_hit(names, body) or _symbol_hit(sym, body):
        # In the body only. If this is the ONLY ticker the provider tagged and
        # the story carries no other company in its headline, treat it as
        # related rather than a bare mention -- single-tag stories are usually
        # about that company even when the headline is oblique.
        if tagged and len(tags) == 1:
            return RELATED
        return MENTION

    return UNKNOWN if tagged else UNKNOWN


def relevance_for(subject_class: str, *, source_class: str = "",
                  tag_count: int = 1) -> str:
    """Map a subject class to the feed's relevance level.

    A story tagged to a large basket of tickers is downgraded even when the
    company appears in the headline: 'Nvidia, AMD, Micron and 20 others rise'
    is index commentary, not company news.
    """
    if subject_class == SUBJECT:
        if tag_count > 12:
            return REL_RELATED
        return REL_DIRECT
    if subject_class == RELATED:
        return REL_RELATED
    if subject_class == MENTION:
        return REL_MENTION
    return REL_UNKNOWN


def in_default_feed(relevance: str) -> bool:
    return relevance in FEED_RELEVANCE
