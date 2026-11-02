"""MD-1 kind `instrument.resolve` (owner: agent-md) — contract MD-1 v1.5 §4.7.

Which security does a member's word name? Answered from UCT's CANONICAL symbol index,
`services/ticker_search_index.py`: the index behind /charts Symbol Search, built from Massive's
/v3/reference/tickers (every US symbol with its name and asset type) plus cap_universe, held in memory with a disk
snapshot. Only its public, in-memory read API is used (`ready`, `search`), so a resolve makes NO provider call and
writes nothing. No word list carries this logic: the class comes from the index's own rows and the way the member
typed the word.

Params: {"symbols": [{"text": "nvda", "form": "cashtag" | "upper" | "lower"}, ...]} (1–5 entries; `form` is how the
member typed it — the client's parser records it, the server never guesses it). One result per entry, in order, with
exactly ONE class:

  symbol                  an exact US stock/ETF symbol, typed `$X` or UPPERCASE           → may be priced
                          — or typed lowercase and confirmed unambiguous by §4.7.5 ("nvda")
  symbol_typed_lowercase  an exact US stock/ETF symbol typed lowercase that §4.7.5 does NOT
                          confirm ("gold", "btc", "spy"); `basis` names the failed checks  → the neutral ask
  name_match              not a symbol; ONE stock/ETF whose name is exactly the word        → ask, with that candidate
                          ("apple" → AAPL, Apple Inc.)
  non_equity              an exact symbol the index types as an index, theme or breadth     → say the limit, no substitute
                          series (SPX, a UCT theme) — not a tradable stock or ETF
  unknown                 none of the above (a misspelling, a word, several name matches)  → say the limit; no guess

A cold or unloaded index answers `unavailable` for the whole read: never a class, never a price.
freshness `periodic`, as_of = the index's build time; stale after INDEX_STALE_S (the index rebuilds daily).
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

SOURCE = "uct-symbol-index"
MAX_TOKENS = 5
INDEX_STALE_S = 3 * 24 * 3600
FORMS = ("cashtag", "upper", "lower")
CLASSES = ("symbol", "symbol_typed_lowercase", "name_match", "non_equity", "unknown")
EQUITY_TYPES = ("stock", "etf")
NON_EQUITY_TYPES = ("index", "theme", "breadth")
_TOKEN_RE = re.compile(r"^[A-Za-z][A-Za-z0-9.\-]{0,11}$")

NOTE_INDEX_NOT_READY = "the symbol index is not loaded yet, so no word can be checked"
NOTE_FROM_INDEX = "classified from UCT's symbol index (US stocks and ETFs, with indexes and UCT series typed apart)"

# Corporate-form words dropped before a NAME comparison ("Apple Inc." ~ "apple"). Normalisation of how company names
# are written, applied identically to every row; it decides nothing about which word is a security.
_NAME_SUFFIX = re.compile(r"\b(incorporated|inc|corporation|corp|company|co|ltd|limited|plc|holdings?|group|sa|nv|ag|"
                          r"se|lp|llc|trust|the|class [a-z]|common stock|ordinary shares|ads|adr)\b")


def _norm_name(s: str) -> str:
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = _NAME_SUFFIX.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def _entries(params: dict) -> list:
    raw = params.get("symbols")
    return raw if isinstance(raw, list) else []


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate): a malformed request is refused and spends no budget."""
    items = _entries(params)
    if not items:
        return "`symbols` must be a list of {text, form} entries"
    if len(items) > MAX_TOKENS:
        return f"at most {MAX_TOKENS} words per resolve"
    for it in items:
        if not isinstance(it, dict) or set(it) != {"text", "form"}:
            return "each entry is {text, form}"
        if not isinstance(it["text"], str) or not _TOKEN_RE.match(it["text"].lstrip("$")):
            return "an entry's text is not a word that could be a symbol"
        if it["form"] not in FORMS:
            return f"an entry's form must be one of {', '.join(FORMS)}"
    return None


def _index():
    from api.services import ticker_search_index
    return ticker_search_index


def _exact_row(idx, sym: str) -> Optional[dict]:
    """The index's own row for exactly `sym` (share-class dot or hyphen), via its public search."""
    for r in idx.search(sym, limit=3):
        if (r.get("ticker") or "").upper() in (sym, sym.replace(".", "-")):
            return r
    return None


# ---- §4.7.5: when a LOWERCASE word may be priced ------------------------------------------------------------------
# Computed from the index's own rows (symbol, name, type) and nothing else. Every check fails closed; the failures are
# recorded in `basis` (tests / audit only, never shown to a member). Adding rows can only add collisions, so a larger
# index turns a resolve into an ask, never the reverse.
SCAN_LIMIT = 400                                        # a search that fills this is incomplete (L5)
BASIS_CONFIRMED = "lowercase_confirmed"
BASIS_CHECKS = ("fund", "not_an_abbreviation", "name_word", "symbol_root", "scan_incomplete")
_WORD_RE = re.compile(r"[A-Za-z0-9]+")


def _alnum(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _abbreviates(token: str, name: str) -> bool:
    """L2: the token's letters appear, in order, in the name ("nvda" in NVIDIA, "sol" NOT in Emeren Group Ltd). A
    doubled letter counts once, since tickers double letters a name holds once ("aapl" → Apple)."""
    t, it = re.sub(r"(.)\1+", r"\1", _alnum(token)), iter(_alnum(name))
    return bool(t) and all(ch in it for ch in t)


def _ticker_ref(word: str, name: str, ticker: str) -> bool:
    """`word` is the exact upper-case ticker inside a MIXED-case name ("2x Long NVDA Daily ETF"). In an all-caps name
    capitals are not evidence, so this is never true there."""
    return word == _alnum(ticker).upper() and any(c.islower() for c in name)


def _consistent(row: dict, own: dict) -> bool:
    """A row in `own`'s family by ticker: its mixed-case name names own's ticker ("2x Long NVDA Daily ETF").
    (A share-class sibling needs no rule: its name repeats own's words, which L3 already reads on own's row, and for
    L4 `_names_own_company` covers it.)"""
    name = row.get("name") or ""
    return any(_ticker_ref(w, name, own["ticker"]) for w in _WORD_RE.findall(name))


def _names_own_company(row: dict, own: dict) -> bool:
    """For L4 only: the row's name carries own's leading company word ("Cboe NVIDIA Call Writing Index" for Nvidia
    Corp, "Super Micro Computer … Depositary Shares" for Super Micro Computer). A derivative of the same company, not
    a different instrument sharing the root. Not used for L3: a word-like ticker ("dow") must still collide with the
    "Dow Jones" rows that carry its company word."""
    words = _norm_name(own.get("name") or "").split()
    lead = words[0] if words else ""
    return len(lead) >= 4 and lead in _norm_name(row.get("name") or "").split()


def lowercase_checks(token: str, own: dict, idx) -> list:
    """The §4.7.5 checks that FAIL for a lowercase `token` whose exact index row is `own` ([] = confirmed)."""
    failed = []
    if own.get("type") != "stock":
        failed.append("fund")                                                      # L1
    own_name = own.get("name") or ""
    if not _abbreviates(token, own_name):
        failed.append("not_an_abbreviation")                                       # L2
    t = _alnum(token)
    try:
        rows = idx.search(token, limit=SCAN_LIMIT)
    except Exception:  # noqa: BLE001 — an unreadable scan is an incomplete one
        rows = None
    if rows is None or len(rows) >= SCAN_LIMIT:
        failed.append("scan_incomplete")                                           # L5
        return failed
    own_t = (own.get("ticker") or "").upper()
    name_word = symbol_root = False
    for r in rows:
        sym = (r.get("ticker") or "").upper()
        name = r.get("name") or ""
        is_own = sym == own_t
        if not is_own and _consistent(r, own):
            continue
        for w in _WORD_RE.findall(name):                                            # L3
            if _ticker_ref(w, name, own_t):
                continue
            wl = w.lower()
            # a whole word anywhere; inside its OWN name, also a fragment of a longer word ("coin" in Coinbase, "link"
            # in Interlink, "hood" in Robinhood): the ticker spells a word, so lowercase is ambiguous
            if wl == t or (is_own and len(wl) > len(t) and t in wl):
                name_word = True
        # L4: another symbol that STARTS with the token (a shared root: BTCO, ETHA, SOLZ, ESGU). A token buried inside
        # a symbol (BAMD, DJINTCUN) is a coincidence of letters, not a root.
        if (not is_own and t and _alnum(sym).upper().startswith(t.upper())
                and not _names_own_company(r, own)):
            symbol_root = True
    if name_word:
        failed.append("name_word")
    if symbol_root:
        failed.append("symbol_root")
    return failed


def classify(text: str, form: str, idx) -> dict:
    """One entry → {input, form, class, symbol, name, type, candidate, basis}. Pure over the index's read API."""
    word = text.lstrip("$")
    sym = word.upper()
    out = {"input": text, "form": form, "class": "unknown", "symbol": None, "name": None, "type": None,
           "candidate": None, "basis": None}
    row = _exact_row(idx, sym)
    if row is not None:
        t = row.get("type")
        if t in EQUITY_TYPES:
            info = {"symbol": row["ticker"], "name": row.get("name"), "type": t}
            # explicit = typed in capitals: UPPERCASE, or a cashtag whose letters are all capitals ($BTC). A lowercase
            # or mixed-case cashtag ($sol, $Nvda) goes through the same §4.7.5 checks as the bare word.
            if form == "upper" or (form == "cashtag" and not any(c.islower() for c in word)):
                out.update({"class": "symbol", **info})
                return out
            failed = lowercase_checks(word, row, idx)                           # §4.7.5
            if failed:
                out.update({"class": "symbol_typed_lowercase", "candidate": info, "basis": failed})
            else:
                out.update({"class": "symbol", **info, "basis": [BASIS_CONFIRMED]})
            return out
        if t in NON_EQUITY_TYPES:
            out.update({"class": "non_equity", "type": t, "name": row.get("name")})
            return out
        return out                                    # a type the index adds later: unknown, never priced
    if form == "cashtag":
        return out                                    # "$NVDIA": the member named a symbol that does not exist
    target = _norm_name(word)
    if target:
        hits = [r for r in idx.search(word, limit=25, types=set(EQUITY_TYPES)) if _norm_name(r.get("name")) == target]
        if len(hits) == 1:
            r = hits[0]
            out.update({"class": "name_match",
                        "candidate": {"symbol": r["ticker"], "name": r.get("name"), "type": r.get("type")}})
    return out


def read_instruments(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    kind = "instrument.resolve"
    why = validate(params)
    if why:
        return env.unavailable(kind, params, SOURCE, why)
    idx = _index()
    try:
        ready = bool(idx.ready())
    except Exception:  # noqa: BLE001 — an unreadable index is not a ready one
        ready = False
    if not ready:
        return env.unavailable(kind, params, SOURCE, NOTE_INDEX_NOT_READY)
    results = [classify(it["text"], it["form"], idx) for it in _entries(params)]
    try:
        built = float(idx.status().get("built_at") or 0.0)
    except Exception:  # noqa: BLE001
        built = 0.0
    as_of = env.utc_iso(datetime.fromtimestamp(built, timezone.utc)) if built > 0 else None
    notes = [NOTE_FROM_INDEX]
    if as_of is None:
        notes.append("the symbol index does not say when it was built")
    stale = built <= 0 or (time.time() - built) > INDEX_STALE_S
    return env.make_envelope(kind, params, status="ok", freshness="periodic", as_of=as_of, source=SOURCE,
                             data={"results": results, "all_symbols": all(r["class"] == "symbol" for r in results)},
                             stale=stale, notes=notes, provider_calls=0)
