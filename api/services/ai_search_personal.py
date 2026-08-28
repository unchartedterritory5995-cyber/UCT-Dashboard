"""AI Search personal-data grounding — assembles the member's own positions/heat/
edge/watchlists into a compact PERSONAL CONTEXT block, then synthesizes a
position-aware answer. Read-only. Every sub-read is best-effort — a failure drops
that slice, never the answer. Personal data NEVER reaches Perplexity or the log."""
from __future__ import annotations
import logging, os, threading, time
_log = logging.getLogger(__name__)

_BLOCK_CAP = 3600            # mirror the router's _CTX_BUDGET (2600→3600, 2026-08-28)
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

def _read_flagged_items(user_id):
    # Read-only mirror of watchlist_service.get_or_create_flagged_list — SELECT only,
    # NEVER creates the shadow row. Returns [] on miss (no flagged list yet).
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id FROM watchlists WHERE user_id = ? AND is_flagged_list = 1", (user_id,)
        ).fetchone()
        if not row:
            return []
        items = conn.execute(
            "SELECT * FROM watchlist_items WHERE watchlist_id = ? ORDER BY sort_order ASC, added_at DESC",
            (row["id"],),
        ).fetchall()
        return [dict(i) for i in items]
    finally:
        conn.close()

def _watch_syms(user_id):
    from api.services import watchlist_service as ws
    syms = []
    try:
        for wl in (ws.list_user_watchlists(user_id) or []):
            syms += [i.get("sym") for i in (wl.get("items") or []) if i.get("sym")]
        # NOTE: list_user_watchlists excludes the flagged list (is_flagged_list filter),
        # so it's read separately here — via a read-only SELECT, never get_or_create_flagged_list
        # (which INSERTs a shadow row on miss and would violate the read-only invariant).
        for i in _read_flagged_items(user_id):
            if i.get("sym"):
                syms.append(i["sym"])
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
    if not account_id:
        # No resolved account ⇒ decline the personal branch. Guards against None
        # reaching portfolio_heat/list_open_positions/edge_for_setups, whose internal
        # fallback (get_or_migrate_default_account) is a WRITE.
        return ""
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


# ── Synthesis — position-aware streaming answer over AsyncAnthropic ─────────
# Blends the fresh web draft (Perplexity) with the member's PERSONAL CONTEXT
# (from assemble() above) into one prose answer. Personal data goes into this
# prompt ONLY — never to Perplexity, never to the capture log.

_SYNTH_MODEL = os.environ.get("AI_SEARCH_SYNTH_MODEL", "claude-sonnet-5")
_SYNTH_MAX_TOKENS = int(os.environ.get("AI_SEARCH_SYNTH_MAX_TOKENS", "800"))
_SYNTH_TIMEOUT = float(os.environ.get("AI_SEARCH_SYNTH_TIMEOUT", "45"))
_SYNTH_PERUSER_CAP = int(os.environ.get("AI_SEARCH_SYNTH_PERUSER_CAP", "20"))
_SYNTH_GLOBAL_HARD = float(os.environ.get("AI_SEARCH_SYNTH_COST_HARD", "25"))
_APPROX_COST = 0.02   # rough per-call USD estimate used ONLY for the cost gate

_synth_lock = threading.Lock()
_synth_day = ""
_synth_by_user: dict = {}
_synth_spend = 0.0


def _et_day():
    # Lazy import — avoids a module-load cycle with api.routers.ai_search.
    from api.routers.ai_search import _et_day as d
    return d()


def _reset_synth_counters():
    global _synth_day, _synth_by_user, _synth_spend
    _synth_day, _synth_by_user, _synth_spend = "", {}, 0.0


def reserve_synth(user_id):
    """Atomic check-AND-increment under one lock hold (mirrors
    api.routers.ai_search._reserve) — verify AND increment together so
    concurrent requests can't all pass a separate gate and blow the cap.
    False ⇒ over cap ⇒ caller falls back to the public (non-personal) draft."""
    global _synth_day, _synth_spend
    with _synth_lock:
        d = _et_day()
        if d != _synth_day:
            _synth_day = d
            _synth_by_user.clear()
            _synth_spend = 0.0
        if _synth_spend + _APPROX_COST > _SYNTH_GLOBAL_HARD:
            return False
        if _synth_by_user.get(user_id, 0) + 1 > _SYNTH_PERUSER_CAP:
            return False
        _synth_by_user[user_id] = _synth_by_user.get(user_id, 0) + 1
        _synth_spend += _APPROX_COST
        return True


def refund_synth(user_id):
    """Inverse of reserve_synth — give back a reservation when synthesis fails
    (error/timeout) or produces nothing AFTER a successful reserve_synth, so a
    failed personal query doesn't permanently consume the member's synth budget.
    Atomic under the same lock; never underflows below zero."""
    global _synth_spend
    with _synth_lock:
        if _synth_by_user.get(user_id):
            _synth_by_user[user_id] = max(0, _synth_by_user[user_id] - 1)
        _synth_spend = max(0.0, _synth_spend - _APPROX_COST)


def _async_client():
    """BOUNDED. Async, so a hang parks the coroutine rather than an anyio worker
    — but it still holds an open upstream connection and a member's request for
    the SDK's 600s default. Streaming synthesis, hence the LONG budget."""
    import anthropic
    from api.services import llm_timeouts
    return anthropic.AsyncAnthropic(
        api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        timeout=llm_timeouts.seconds("AI_SEARCH_LLM_TIMEOUT_SECS",
                                     llm_timeouts.REQUEST_PATH_LONG),
    )


def SYNTH_SYSTEM(personal_block, live_desk):
    from api.routers.ai_search import _SAFETY_BLOCKS
    return (
        "You are the UCT Intelligence research desk answering for THIS member, with their own "
        "positions and risk in front of you.\n\n" + _SAFETY_BLOCKS + "\n\n"
        "FRESHNESS FIREWALL: the PERSONAL CONTEXT and any prior research may be dated. The LIVE "
        "DESK figures and the fresh web draft are authoritative — never override a live number "
        "with a stale personal one.\n\n"
        "CONTEXT DIRECTIVE: present the position-aware facts (entry, size, heat, edge, earnings "
        "exposure) alongside the fresh read. DO NOT author a GO/HOLD/SKIP call — state plainly "
        "that the decision is the member's. Never invent a fill, stop, P&L, or level not in the "
        "PERSONAL CONTEXT. For any position marked 'no stop set — risk undefined', say the risk "
        "is undefined and do NOT propose a numeric stop or risk.\n\n"
        f"=== LIVE DESK ===\n{live_desk}\n\n=== PERSONAL CONTEXT (private; may be dated) ===\n{personal_block}"
    )


async def synthesize(query, draft, personal_block, live_desk, history):
    """Streams token deltas from a personal-context-aware Anthropic call that
    folds the fresh web draft together with the member's own positions/heat/
    edge. LOCKED config: no `temperature` kwarg (Sonnet tier 400s on it),
    thinking disabled, explicit timeout."""
    system = SYNTH_SYSTEM(personal_block, live_desk)
    msgs = []
    for h in (history or [])[-3:]:
        if isinstance(h, dict) and h.get("q") and h.get("a"):
            msgs.append({"role": "user", "content": str(h["q"])[:300]})
            msgs.append({"role": "assistant", "content": str(h["a"])[:1200]})
    user = query if not draft else f"{query}\n\n[fresh web research draft to fold in]\n{draft}"
    msgs.append({"role": "user", "content": user})
    client = _async_client()
    async with client.messages.stream(
        model=_SYNTH_MODEL, max_tokens=_SYNTH_MAX_TOKENS, system=system,
        messages=msgs, thinking={"type": "disabled"},
        timeout=_SYNTH_TIMEOUT,     # NO temperature (Sonnet tier 400s)
    ) as stream:
        async for delta in stream.text_stream:
            yield delta
