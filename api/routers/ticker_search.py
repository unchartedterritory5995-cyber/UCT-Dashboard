"""GET /api/ticker-search?q=<prefix>&limit=N — predictive ticker autocomplete.

Loads `api/data/cap_universe.json` (3,685 $300M+ tickers) once at import time
and serves prefix-then-substring matches. Enriches results with company
names from the existing ticker_meta cache (in-process TTL → on-disk). For
matches that don't have a cached name, fires a bounded background fetch so
subsequent requests resolve names — never blocks the autocomplete response.
"""
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

from fastapi import APIRouter, Cookie, Query

from api.middleware.auth_middleware import PAID_PLANS, meets_plan_gate
from api.services.auth_service import get_user_plan, validate_session


def _bars_entitled(uct_session) -> bool:
    """May this (possibly absent) caller see UCT’s own breadth measures?

    ⛔ THE SAME MEMBERSHIP RULE `bars_auth.require_bars_access` ENFORCES, asked
    as a question instead of raised as a refusal. `meets_plan_gate` is the repo’s
    stated predicate and its docstring requires a caller resolving its own user
    to call it rather than re-derive the rule — a second opinion about who is
    paid would drift in the one place nobody would notice.
    """
    # ⛔ A NON-STRING IS "NO COOKIE", AND THIS LINE IS NOT DEFENSIVE PADDING.
    # `ticker_search` is ALSO called in-process (the Discord autocomplete calls it
    # directly), and an in-process call leaves FastAPI parameter defaults as their
    # `Cookie()`/`Query()` OBJECTS. `tests/test_discord_chart.py` records what that
    # costs: a leaked `Query()` object made every autocomplete answer [] for SIX
    # DAYS, 178 logged failures. Treating a non-string as absent makes the
    # in-process path correct by construction rather than by the `except` below.
    if not isinstance(uct_session, str) or not uct_session:
        return False
    try:
        user = validate_session(uct_session)
        if not user:
            return False
        user["plan"] = get_user_plan(user["id"])
        return meets_plan_gate(user, list(PAID_PLANS))
    except Exception:  # noqa: BLE001
        # ⛔ THE COOKIE IS READ HERE RATHER THAN VIA `get_current_user_optional`,
        # AND THE `try` IS THE REASON. That dependency’s docstring says "Never
        # raises", but `validate_session` opens auth.db — measured raising an
        # OperationalError, which would turn a database blip into a 500 on an
        # endpoint FOURTEEN surfaces call, several outside charts entirely.
        # Degrading to "not entitled" hides UCT’s breadth rows and leaves
        # ordinary symbol search working — the only safe failure direction.
        return False

from api.services import cap_universe

_logger = logging.getLogger(__name__)
router = APIRouter()


def _load_universe() -> List[str]:
    """Sorted, de-duplicated and upper-cased -- the order the prefix scan
    relies on. Reading and caching the file itself belongs to
    `services.cap_universe`, which is also what the article converter asks."""
    out = sorted(cap_universe.symbols())
    _logger.info("[ticker-search] loaded %d tickers from cap_universe", len(out))
    return out


_UNIVERSE: List[str] = _load_universe()


def _name_from_cache(ticker: str):
    """Pull a cached company name without triggering a network fetch.

    Resolution order: in-process TTLCache → on-disk JSON cache (populated
    over time as users view charts; the watermark calls /api/ticker-meta
    which writes here). Never raises, never blocks.
    """
    try:
        from api.services import ticker_meta as tm
        hit = tm._mem.get(f"tmeta_{ticker}")
        if hit:
            return hit.get("name")
        disk = tm._disk_get(ticker)
        if disk:
            try:
                tm._mem.set(f"tmeta_{ticker}", disk, ttl=tm._TTL)
            except Exception:
                pass
            return disk.get("name")
    except Exception:
        pass
    return None


# Background name backfill — when autocomplete returns a match with no
# cached name, schedule a fetch so the next request resolves it. Bounded
# pool keeps the worker thread count safe even under autocomplete bursts.
_BACKFILL_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ticker-name-bf")
_BACKFILL_INFLIGHT = set()
_BACKFILL_LOCK = threading.Lock()
_BACKFILL_CAP = 8  # max in-flight at once


def _enqueue_name_backfill(ticker: str) -> None:
    """Fire-and-forget: warm ticker_meta cache so the next autocomplete sees a name."""
    with _BACKFILL_LOCK:
        if ticker in _BACKFILL_INFLIGHT or len(_BACKFILL_INFLIGHT) >= _BACKFILL_CAP:
            return
        _BACKFILL_INFLIGHT.add(ticker)

    def _job():
        try:
            from api.services.ticker_meta import _base_meta
            _base_meta(ticker)  # writes to disk + memory cache; safe + idempotent
        except Exception as e:
            _logger.info("[ticker-search] name backfill %s failed: %s", ticker, e)
        finally:
            with _BACKFILL_LOCK:
                _BACKFILL_INFLIGHT.discard(ticker)

    try:
        _BACKFILL_POOL.submit(_job)
    except Exception:
        with _BACKFILL_LOCK:
            _BACKFILL_INFLIGHT.discard(ticker)


# Category chip → the index asset-types it selects. 'breadth' is served from the
# breadth registry (not the index); '' / 'all' means no filter.
_CHIP_TYPES = {"stock": {"stock"}, "etf": {"etf"}, "index": {"index"}}


def _fallback_symbol_scan(qq: str, limit: int):
    """Symbol-only scan over cap_universe — used only until the rich index has built
    (best-effort startup window). Names come from the ticker_meta cache.

    Seam 16: cap_universe is already canonically hyphen-spelled end to end,
    so the only gap here is the SAME query-side one `ticker_search_index.
    search()` closes -- a member typing the literal dot spelling ('BRK.B')
    during this narrow startup window should still find the hyphen-spelled
    row. Reuses that module's own narrowly-scoped alias helper rather than
    a second, possibly-drifting copy of the regex."""
    from api.services.ticker_search_index import _share_class_alias
    qa = _share_class_alias(qq)
    exact, prefix, substring = [], [], []
    for t in _UNIVERSE:
        if t == qq or (qa and t == qa):
            exact.append(t)
        elif t.startswith(qq) or (qa and t.startswith(qa)):
            prefix.append(t)
        elif qq in t or (qa and qa in t):
            substring.append(t)
    out = []
    for t in (exact + prefix + substring)[:limit]:
        out.append({"ticker": t, "name": _name_from_cache(t), "type": "stock",
                    "exchange": None, "entity_id": None})
    return out


@router.get("/api/ticker-search")
def ticker_search(
    q: str = Query("", max_length=48),
    limit: int = Query(20, ge=1, le=50),
    type: str = Query("", max_length=16),
    uct_session: Optional[str] = Cookie(None),
):
    """Predictive symbol search ranked across ticker AND name: exact symbol > symbol
    prefix > symbol contains > name contains. So "AAPL" returns AAPL then AAPU/AAPD/…
    (leveraged/inverse products whose NAME references it), and "bull 2x" or "uranium"
    find products by description.

    `type` filters by category chip: stock | etf | index | breadth | '' (all).

    Row shape: {"ticker","name"|None,"type","exchange"|None,"entity_id"|None,[breadth|delisted flags]}

    `entity_id` (Checkpoint 6, entity-master-spec.md §2.2): populated for live
    index rows once Entity Master has resolved that symbol; `null` for breadth
    pseudo-tickers and delisted rows (out of this checkpoint's authorized
    scope) and while the rich index is still building. Purely additive — a
    client that ignores this field behaves exactly as before.
    """
    qq = (q or "").strip().upper()
    if not qq:
        return {"results": []}

    chip = (type or "").strip().lower()
    want_breadth = chip in ("", "all", "breadth")
    want_delisted = chip in ("", "all")
    index_types = _CHIP_TYPES.get(chip)  # None for all/breadth
    from api.services import ticker_search_index as _tsi

    results = []
    live_syms = set()
    if chip != "breadth":
        if _tsi.ready():
            for row in _tsi.search(q, limit, types=index_types):
                if row.get("name") is None:
                    _enqueue_name_backfill(row["ticker"])
                results.append(row)
                live_syms.add(row["ticker"])
        elif index_types is None or "stock" in (index_types or set()):
            # Index still building — degrade to the bare symbol scan.
            for row in _fallback_symbol_scan(qq, limit):
                if row.get("name") is None:
                    _enqueue_name_backfill(row["ticker"])
                results.append(row)
                live_syms.add(row["ticker"])

    # UCT BREADTH pseudo-tickers (UCTA50 = % above 50-day MA, UCTNH = new highs…):
    # symbol-level matches jump to the FRONT; name matches sit after live tickers.
    # 🔴 THE BREADTH ROWS ARE PAID; THE REST OF THIS ENDPOINT IS NOT — and that
    # asymmetry is the finding, not a compromise. `/api/ticker-search` has fourteen
    # frontend consumers (CommandPalette, TickerPopup, calendar, community ticker
    # mentions, journal, ModelBook, charts) plus an in-process Discord caller;
    # paywalling the endpoint would break ordinary symbol lookup on surfaces
    # entitled to it. What leaked is the proprietary half: 44 UCT breadth measures,
    # enumerable by anyone, step one of "enumerate, then fetch the history".
    if want_breadth and _bars_entitled(uct_session):
        try:
            from api.services import breadth_symbols as _breadth_syms
            b_front, b_back = [], []
            for rec in _breadth_syms.search(qq, limit):
                row = {"ticker": rec["ticker"], "name": rec["name"], "type": "breadth",
                       "exchange": "UCT", "entity_id": None,
                       "breadth": True, "group_label": rec.get("group_label")}
                (b_front if rec.get("symbol_hit") else b_back).append(row)
            results = b_front + results + b_back
        except Exception:
            pass

    # DELISTED tickers (Yahoo, Twitter, Lehman…) — a live ticker sharing a symbol wins.
    if want_delisted:
        try:
            from api.services import delisted_registry
            for rec in delisted_registry.search(qq, limit):
                if rec["ticker"] in live_syms:
                    continue
                results.append({
                    "ticker": rec["ticker"], "name": rec.get("name"),
                    "type": "delisted", "exchange": None, "entity_id": None,
                    "delisted": True, "delisted_date": rec.get("delisted_date"),
                })
        except Exception:
            pass
    return {"results": results[:limit]}
