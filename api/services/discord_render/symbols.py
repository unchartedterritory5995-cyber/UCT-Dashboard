"""Symbol resolution for the Discord render path (03-architecture §3.8; D-04, OI-01, C-14).

One place that answers "is this something we can chart?" for the bot, by asking the authorities
the app already has — never a list of its own: breadth pseudo-tickers · index tickers · the
delisted registry · the $300M+ universe and the liquid-ETF list · the ticker search index
(Massive's reference tickers — what `/api/bars` itself treats as carried) · Entity Master aliases ·
bars already in the store.

⛔ It refuses only on a DEFINITE miss. When the search index has not loaded yet (the seconds after a
boot), or any authority errors, it cannot say "no" and answers UNANSWERABLE, and the request goes
through: a false refusal tells a member that a real ticker does not exist; a false pass costs one
honest "no bars" reply. A refusal also starts a background fetch, so a real ticker no authority had
seen yet works when the member runs it again (OI-01).
"""
from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass

KNOWN, UNKNOWN, UNANSWERABLE = "known", "unknown", "unanswerable"
MAX_SUGGESTIONS = 3
WARM_TTL_S = 300.0
_WARM_MAX = 2000

_warmed: dict[str, float] = {}
_warm_lock = threading.Lock()


@dataclass(frozen=True)
class Resolution:
    symbol: str
    status: str
    authority: str | None = None
    suggestions: tuple[str, ...] = ()


def _norm(sym: str) -> str:
    return (sym or "").strip().upper().lstrip("$")


# ── the authorities ─────────────────────────────────────────────────────────

def _entity_known(sym: str) -> bool:
    from api.services.entity_master import api as em, schema
    if not os.path.exists(schema.DB_PATH):        # never create the database from the Discord path
        return False
    return em.resolve(sym).status in ("resolved", "ambiguous")


def _in_bars_store(sym: str) -> bool:
    from api.services import bars_sqlite
    return bool(bars_sqlite.get_bars(sym, "D", 1))


def _checks() -> tuple:
    """(name, predicate) in cost order: in-memory first, the SQLite reads last."""
    from api import index_bars
    from api.services import breadth_symbols, cap_universe, delisted_registry, ticker_search_index
    return (
        ("breadth", breadth_symbols.is_breadth_symbol),
        ("index", index_bars.is_index),
        ("universe", lambda s: s in cap_universe.symbols() or s in cap_universe.etf_symbols()),
        ("search_index", ticker_search_index.contains),
        ("delisted", lambda s: delisted_registry.resolve(s) is not None),
        ("entity_master", _entity_known),
        ("bars_store", _in_bars_store),
    )


def _index_ready() -> bool:
    from api.services import cap_universe, ticker_search_index
    return bool(ticker_search_index.ready()) and bool(cap_universe.symbols())


def _share_class_alias(s: str) -> str | None:
    """BRK.B → BRK-B: the universe's spelling, via the search index's own helper (one copy of the rule)."""
    try:
        from api.services.ticker_search_index import _share_class_alias as alias
        return alias(s)
    except Exception:  # noqa: BLE001
        return None


def bars_verdict(sym: str, *, serve=None) -> str:
    """What /api/bars itself says about `sym`, asked in-process through the serve core `fetch_bars`
    calls: `bars` when it serves a series, `no_data` ONLY for its explicit "symbol not carried"
    answer, `undetermined` for anything else (a 503 while warming, a fault).

    Measured on production 2026-09-13: BTC-USD, ^GSPC and FNMA are in none of the static
    authorities and all three chart — so a static miss alone must never refuse."""
    if serve is None:
        from api.routers import bars as bars_router
        serve = bars_router.serve_bars
    resp = serve(sym, "D", 5, "", "", 0)
    if getattr(resp, "status_code", 200) != 200:
        return "undetermined"
    try:
        body = json.loads(getattr(resp, "body", b"") or b"{}")
    except (TypeError, ValueError):
        return "undetermined"
    if body.get("bars"):
        return "bars"
    return "no_data" if body.get("no_data") else "undetermined"


def resolve(sym: str, *, checks=None, index_ready=None, confirm=None, suggest: bool = True) -> Resolution:
    """KNOWN when a static authority knows `sym` (a dot share class is also tried in the hyphen
    spelling the universe uses). After a static miss with the search index loaded, /api/bars
    decides: UNKNOWN only on its "not carried" answer, KNOWN when it serves bars, UNANSWERABLE on
    anything short of that."""
    s = _norm(sym)
    alias = _share_class_alias(s)
    errors = 0
    for name, predicate in (checks if checks is not None else _checks()):
        try:
            if predicate(s) or (alias and alias != s and predicate(alias)):
                return Resolution(s, KNOWN, authority=name)
        except Exception:  # noqa: BLE001 — an authority that cannot answer is not a "no"
            errors += 1
    try:
        ready = index_ready() if index_ready is not None else _index_ready()
    except Exception:  # noqa: BLE001
        ready = False
    if errors or not ready:
        return Resolution(s, UNANSWERABLE)
    try:
        verdict = (confirm or bars_verdict)(s)
    except Exception:  # noqa: BLE001 — a confirmation that cannot answer is not a "no" either
        verdict = "undetermined"
    if verdict == "bars":
        return Resolution(s, KNOWN, authority="bars_serve")
    if verdict != "no_data":
        return Resolution(s, UNANSWERABLE)
    return Resolution(s, UNKNOWN, suggestions=suggestions(s) if suggest else ())


# ── suggestions ─────────────────────────────────────────────────────────────

def edit1(a: str, b: str) -> bool:
    """True when `b` is one edit from `a`: an insertion, a deletion, a substitution, or two
    adjacent letters swapped (NDVA → NVDA)."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        diff = [i for i in range(len(a)) if a[i] != b[i]]
        if len(diff) == 1:
            return True
        return len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]]
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    i = 0
    while i < len(short) and short[i] == long_[i]:
        i += 1
    return short[i:] == long_[i + 1:]


def _search(sym: str) -> list:
    from api.services import ticker_search_index
    return ticker_search_index.search(sym, limit=8) or []


def _universe() -> frozenset:
    from api.services import cap_universe
    return cap_universe.symbols() | cap_universe.etf_symbols()


def suggestions(sym: str, *, limit: int = MAX_SUGGESTIONS, search=None, universe=None) -> tuple[str, ...]:
    """At most `limit`, in this order: symbols the search index matches by prefix, symbols one edit
    away in the universe, symbols merely containing the input, then whatever the index matched by
    name. (Production 2026-09-13, before the order was split: APPL offered MAPPLNCT ahead of AAPL.)"""
    s = _norm(sym)
    out: list[str] = []

    def add(t):
        t = str(t or "").upper()
        if t and t != s and t not in out and len(out) < limit:
            out.append(t)
    try:
        tickers = [str(r.get("ticker") or "") for r in (search or _search)(s)]
    except Exception:  # noqa: BLE001
        tickers = []
    for t in tickers:
        if t.startswith(s):
            add(t)
    try:
        pool = (universe or _universe)()
    except Exception:  # noqa: BLE001
        pool = ()
    for t in sorted(pool):
        if edit1(s, t):
            add(t)
    for t in tickers:
        if s in t:
            add(t)
    for t in tickers:
        add(t)
    return tuple(out)


def _either(items) -> str:
    items = list(items)
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " or " + items[-1]


def refusal_text(unknown: list, cid: str) -> str:
    parts = [f"**{r.symbol}** (did you mean {_either(r.suggestions)}?)" if r.suggestions else f"**{r.symbol}**"
             for r in unknown]
    # "No chart data for", not "couldn't find": /api/bars says not-carried for real symbols too
    # (BTC-USD and FNMA on production, 2026-09-13), and the member deserves the true sentence.
    return (f"No chart data for {', '.join(parts)}. If it's a real ticker, run it again in a few seconds — "
            f"I've started looking it up. · id {cid}")[:1900]


# ── the /flow partition (C-14) ──────────────────────────────────────────────

def flow_source(sym: str) -> str:
    """`etfs` for an ETF or index underlying, else `stocks`. Flow is stored under source 'indexes'
    for those, so asking `stocks` for SPY answered "no significant options flow" — 0 contracts
    against 182 under `etfs` on 2026-09-13. The answer comes from flow ingestion's own classifier
    (`massive_processor.is_index_source`), then the maintained liquid-ETF list."""
    s = _norm(sym)
    try:
        from api.massive_processor import is_index_source
        if is_index_source(s):
            return "etfs"
    except Exception:  # noqa: BLE001
        pass
    try:
        from api.services import cap_universe
        if s in cap_universe.etf_symbols():
            return "etfs"
    except Exception:  # noqa: BLE001
        pass
    return "stocks"


# ── the background warm after a refusal ─────────────────────────────────────

def _fetch_daily(sym: str) -> None:
    from api.routers import discord_interactions as router
    router.fetch_bars(sym, "D", 260)


def warm(sym: str, *, fetch=None, now=time.monotonic) -> bool:
    """Fetch the symbol's daily bars once per WARM_TTL_S, so a real ticker the authorities had not
    seen is in the bars store when the member runs it again. True when a fetch was started."""
    s = _norm(sym)
    with _warm_lock:
        last = _warmed.get(s)
        if last is not None and now() - last < WARM_TTL_S:
            return False
        _warmed[s] = now()
        if len(_warmed) > _WARM_MAX:
            for k, _ in sorted(_warmed.items(), key=lambda kv: kv[1])[: len(_warmed) - _WARM_MAX]:
                _warmed.pop(k, None)
    try:
        (fetch or _fetch_daily)(s)
    except Exception:  # noqa: BLE001 — a failed warm just means the re-run is refused again
        pass
    return True


def clear_for_tests() -> None:
    with _warm_lock:
        _warmed.clear()
