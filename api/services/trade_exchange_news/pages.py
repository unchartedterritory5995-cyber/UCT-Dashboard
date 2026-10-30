"""Historical pages of the retained archive, filtered ON THE SERVER.

The widget's filters (search, categories, linked symbol, watchlist, graphic-only
placeholders) read fields the server DERIVES from each headline at event build
(tickers, category, placeholder -- see ``pipeline.headline_event``); none of them
is a stored column. So a page is computed here, over the whole retained archive,
never from whatever a browser happens to hold.

⭐ BOUNDED. The archive is itself bounded (``TXN_HISTORY_MAX_AGE_HOURS`` 168 /
``TXN_HISTORY_MAX_ITEMS`` 5,000), and the scan reads it once per request by its
primary key -- no OFFSET. The derived fields are a pure function of
``(source, content)``, cached (LRU, ``DERIVED_CACHE_MAX``), so a warm request is
one key-ordered read plus set lookups (measured in
tests/test_trade_exchange_news_pages.py). The page's own events reuse the same
cached derivation (``pipeline.derived_for``), so a warm page derives nothing.
⛔ MEASURED IN PRODUCTION (2026-10-30, 930 headlines): re-deriving per request
cost 2-3.5 s a page -- the production company-name index is far larger than a
dev machine's.

⭐ STABLE BOUNDARIES. Every page is cut from the snapshot ``seq <= top``. The
browser fixes ``top`` when it leaves page 1, so headlines arriving while it reads
history never shift a boundary, duplicate a row or skip one; page N is always the
N-th run of ``size`` matches counted from ``top`` down. Pruning removes the OLDEST
rows only, so it can only shorten the last page.

⭐ HONEST TOTALS. ``total`` is the exact count of matches in the snapshot -- the
whole retained archive is scanned -- and ``oldest_ms`` says how far back it
reaches. Nothing older than the archive is ever promised.

Runs on a worker thread (``asyncio.to_thread``), never on the single writer:
a reader connection of its own (WAL), so it cannot delay ingestion; the router
admits at most ``CONCURRENT`` page builds at a time, so a burst of widgets or
keystrokes cannot crowd the event loop.
"""
from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Any, Iterable


DEFAULT_SIZE = 25
MAX_SIZE = 100
MAX_PAGE = 10_000
MAX_SYMBOLS = 3000
MAX_QUERY = 80
#: Rows read per scan: the archive's own bound with headroom (an env override of
#: the count bound above this would see its oldest rows unpaged, never a crash).
SCAN_MAX = 20_000
DERIVED_CACHE_MAX = 12_000
CONCURRENT = 2
#: categories.CATEGORIES, restated so this module imports nothing heavy (the pages
#: tests assert the two never drift).
CATEGORIES = ("News", "Macro", "Options", "Press Release", "Earnings", "Price", "Filing", "Other")

_lock = threading.Lock()
_derived: OrderedDict[tuple[str, str], tuple] = OrderedDict()
#: Derivations made since start (cache misses): reported per page as `derived`.
stats = {"misses": 0}


def _derive(source: str, content: str) -> tuple:
    """(category, tickers, graphic placeholder?, lower-cased text, event fields): the
    filter fields read from EXACTLY what ``headline_event`` puts on the event
    (``pipeline.derived_for``, never-raise), plus those event fields."""
    key = (source, content)
    with _lock:
        hit = _derived.get(key)
        if hit is not None:
            _derived.move_to_end(key)
            return hit
    from api.services.trade_exchange_news import pipeline
    fields = pipeline.derived_for(source, content)
    val = (fields.get("category") or "Other", frozenset(fields.get("tickers") or ()),
           fields.get("placeholder") == "graphic", content.lower(), fields)
    with _lock:
        stats["misses"] += 1
        _derived[key] = val
        while len(_derived) > DERIVED_CACHE_MAX:
            _derived.popitem(last=False)
    return val


def event_fields(source: str, content: str) -> dict[str, Any]:
    """The cached derivation for one row's event (``headline_event(derived=...)``)."""
    return _derive(source, content)[4]


def clear_cache() -> None:
    with _lock:
        _derived.clear()
        stats["misses"] = 0


def _clean_syms(raw: Iterable[Any] | None) -> frozenset[str] | None:
    if raw is None:
        return None
    out = set()
    for s in raw:
        if isinstance(s, str) and 0 < len(s) <= 16:
            out.add(s.strip().upper())
        if len(out) >= MAX_SYMBOLS:
            break
    return frozenset(out)


def _matches(d: tuple, *, q: str, q_sym: str, cats: frozenset[str] | None,
             symbol: str | None, symbols: frozenset[str] | None, hide_placeholders: bool) -> bool:
    """Mirrors the widget's ``visibleItems`` + ``matchesQuery`` (tradeExchangeNewsModel.js)."""
    cat, tickers, graphic, lc = d[:4]
    if hide_placeholders and graphic:
        return False
    if cats is not None and cat not in cats:
        return False
    if symbol and symbol not in tickers:
        return False
    if symbols is not None and tickers.isdisjoint(symbols):
        return False
    if q and q not in lc and q_sym not in tickers:
        return False
    return True


def page(store, *, page_no: int = 1, size: int = DEFAULT_SIZE, top: int | None = None,
         query: str = "", categories: Iterable[str] | None = None, symbol: str | None = None,
         symbols: Iterable[Any] | None = None, hide_placeholders: bool = True) -> dict[str, Any]:
    """One page of matches, newest first, cut from the snapshot ``seq <= top``.

    Returns ``{top, page, size, total, pages, archive_total, hidden_placeholders,
    seqs}`` (``archive_total``: every retained headline in the snapshot); the
    router turns ``seqs`` into events. A page past the end is clamped to the last
    one (``page`` says which was served); an empty result is page 1 of 1.
    """
    size = max(1, min(MAX_SIZE, int(size)))
    page_no = max(1, min(MAX_PAGE, int(page_no)))
    last = store.last_seq()
    top = last if top is None or top <= 0 or top > last else int(top)
    q = str(query or "").strip().lower()[:MAX_QUERY]
    q_sym = q[1:].upper() if q.startswith("$") else q.upper()
    cats = None
    if categories:
        picked = frozenset(c for c in categories if isinstance(c, str) and c in CATEGORIES)
        cats = picked if picked and len(picked) < len(CATEGORIES) else None
    sym = str(symbol).strip().upper() if symbol else None
    syms = _clean_syms(symbols)
    match: list[int] = []
    hidden = scanned = 0
    for seq, source, content in store.index_desc(top, SCAN_MAX):
        scanned += 1
        d = _derive(source, content)
        if d[2]:
            hidden += 1
        if _matches(d, q=q, q_sym=q_sym, cats=cats, symbol=sym, symbols=syms, hide_placeholders=hide_placeholders):
            match.append(seq)
    total = len(match)
    pages = max(1, -(-total // size))
    page_no = min(page_no, pages)
    start = (page_no - 1) * size
    return {"top": top, "page": page_no, "size": size, "total": total, "pages": pages, "archive_total": scanned,
            "hidden_placeholders": hidden if hide_placeholders else 0,
            "seqs": match[start:start + size]}
