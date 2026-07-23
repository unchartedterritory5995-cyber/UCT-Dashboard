"""AI Search personal-data grounding — assembles the member's own positions/heat/
edge/watchlists into a compact PERSONAL CONTEXT block, then synthesizes a
position-aware answer. Read-only. Every sub-read is best-effort — a failure drops
that slice, never the answer. Personal data NEVER reaches Perplexity or the log."""
from __future__ import annotations
import logging, os, time
_log = logging.getLogger(__name__)

_BLOCK_CAP = 2600            # mirror the router's _CTX_BUDGET
_WATCH_CAP = 40             # symbol count
_HAS_DATA_TTL = 120.0
_has_data_cache: dict = {}   # user_id -> (bool, expires_at)

# --- thin, individually-patchable readers (keep I/O isolated for tests) ---
def _list_accounts(user_id):
    from api.services.journal_two.accounts import list_accounts
    return list_accounts(user_id) or []

def _positions_for(user_id, account_id):
    from api.services.journal_two.positions import list_open_positions
    return list_open_positions(user_id, account_id=account_id) or []   # account_id is KEYWORD-only

def _heat_for(user_id, account_id):
    from api.services.portfolio_heat import portfolio_heat
    return portfolio_heat(user_id, account_id) or {}

def _edge_for(user_id, account_id):
    from api.services.personal_edge import edge_for_setups
    return edge_for_setups(user_id, account_id) or {}

def _watch_syms(user_id):
    from api.services import watchlist_service as ws
    syms = []
    try:
        for wl in (ws.list_user_watchlists(user_id) or []):
            syms += [i.get("sym") for i in (wl.get("items") or []) if i.get("sym")]
        fl = ws.get_or_create_flagged_list(user_id) or {}
        syms += [i.get("sym") for i in (fl.get("items") or []) if i.get("sym")]
    except Exception as e:
        _log.debug("watch syms failed: %s", e)
    seen, out = set(), []
    for s in syms:
        u = s.upper()
        if u not in seen:
            seen.add(u); out.append(u)
    return out[:_WATCH_CAP]

def _live_price(sym):
    # Best-effort read of the SHARED live-price cache — NEVER a per-symbol fetch.
    try:
        from api.routers.live_prices import cache as _lp_cache
        hit = _lp_cache.get(f"live_px1_{sym.upper()}")
        return float(hit.get("price")) if hit and hit.get("price") else None
    except Exception:
        return None

def resolve_account(user_id, query_tickers):
    """Read-only single-account resolution. Prefer the account holding a named
    ticker; else the first (created_at ASC). None ⇒ decline the personal branch."""
    try:
        accts = _list_accounts(user_id)
    except Exception as e:
        _log.debug("list_accounts failed: %s", e); return None
    if not accts:
        return None
    if query_tickers:
        want = {t.upper() for t in query_tickers}
        for a in accts:
            try:
                held = {(p.get("symbol") or "").upper() for p in _positions_for(user_id, a["id"])}
            except Exception:
                held = set()
            if want & held:
                return a["id"]
    return accts[0]["id"]

def has_data(user_id):
    now = time.time()
    hit = _has_data_cache.get(user_id)
    if hit and hit[1] > now:
        return hit[0]
    val = False
    try:
        aid = resolve_account(user_id, [])
        if aid:
            val = bool(_positions_for(user_id, aid)) or bool(_watch_syms(user_id))
    except Exception:
        val = False
    _has_data_cache[user_id] = (val, now + _HAS_DATA_TTL)
    return val

def _fmt_positions(user_id, account_id, query_tickers):
    rows = []
    try:
        positions = _positions_for(user_id, account_id)
    except Exception as e:
        _log.debug("positions failed: %s", e); return ""
    want = {t.upper() for t in (query_tickers or [])}
    # query-named positions first (truncation priority)
    positions.sort(key=lambda p: 0 if (p.get("symbol") or "").upper() in want else 1)
    for p in positions:
        sym = (p.get("symbol") or "").upper()
        if not sym: continue
        entry = p.get("entryPrice"); shares = p.get("shares"); stop = p.get("stopPrice")
        side = (p.get("side") or "long").lower()
        placeholder = (stop is None) or (stop == entry)
        est = bool(p.get("entryEstimated"))
        parts = [f"{sym} {side}", f"entry ${entry}" + (" (est.)" if est else "")]
        # live P&L: broker mark first, else shared live cache; blank on miss
        px = p.get("brokerPrice") or _live_price(sym)
        if px and entry:
            r = (px - entry) / entry * (1 if side == "long" else -1) * 100
            parts.append(("est. " if est else "") + f"{r:+.1f}%")
        parts.append("no stop set — risk undefined" if placeholder else f"stop ${stop}")
        rows.append("  - " + ", ".join(parts))
    return ("YOUR OPEN POSITIONS:\n" + "\n".join(rows)) if rows else ""

def _fmt_heat(user_id, account_id):
    try:
        h = _heat_for(user_id, account_id)
    except Exception:
        return ""
    if not h: return ""
    if h.get("account_size_is_default"):
        return "EXPOSURE: account size not set — percentage exposure omitted."
    bits = []
    if h.get("risk_heat_pct") is not None:
        bits.append(f"risk heat {h['risk_heat_pct']}% of your {h.get('aggregate_cap_pct', 10)}% cap")
    if h.get("placeholder_stops"):
        bits.append("no-stop positions (excluded from heat): " + ", ".join(h["placeholder_stops"]))
    return ("EXPOSURE: " + "; ".join(bits)) if bits else ""

def _fmt_edge(user_id, account_id):
    # edge_for_setups returns {setup_name: {n, avg_r, total_r, win_rate, verdict, muted, note}}
    try:
        e = _edge_for(user_id, account_id)
    except Exception:
        return ""
    if not isinstance(e, dict) or not e:
        return ""
    out = []
    for setup, d in list(e.items())[:6]:
        if d.get("avg_r") is not None:
            out.append(f"{setup} {d['avg_r']:+.2f}R" + (f"/{d.get('n')}t" if d.get("n") else ""))
        elif d.get("note"):
            out.append(f"{setup} ({d['note']})")
    return ("YOUR EDGE BY SETUP: " + "; ".join(out)) if out else ""

def assemble(user_id, account_id, query, tickers):
    sections = [
        _fmt_positions(user_id, account_id, tickers),
        _fmt_heat(user_id, account_id),
        _fmt_edge(user_id, account_id),
    ]
    syms = _watch_syms(user_id)
    if syms:
        sections.append("YOUR WATCHLIST: " + ", ".join(syms))
    block = "\n".join(s for s in sections if s)
    return block[:_BLOCK_CAP]
