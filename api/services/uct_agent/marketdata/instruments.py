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
  symbol_typed_lowercase  an exact US stock/ETF symbol typed lowercase ("nvda", "gold")    → ask, with the index name
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


def classify(text: str, form: str, idx) -> dict:
    """One entry → {input, form, class, symbol, name, type, candidate}. Pure over the index's read API."""
    word = text.lstrip("$")
    sym = word.upper()
    out = {"input": text, "form": form, "class": "unknown", "symbol": None, "name": None, "type": None,
           "candidate": None}
    row = _exact_row(idx, sym)
    if row is not None:
        t = row.get("type")
        if t in EQUITY_TYPES:
            info = {"symbol": row["ticker"], "name": row.get("name"), "type": t}
            if form in ("cashtag", "upper"):
                out.update({"class": "symbol", **info})
            else:
                out.update({"class": "symbol_typed_lowercase", "candidate": info})
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
