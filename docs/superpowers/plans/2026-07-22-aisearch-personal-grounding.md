# AI Search Personal-Data Grounding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AI Search position-aware, privacy-safe personal answers grounded in the member's own J2 positions/heat/edge/watchlists (never leaking that data to Perplexity), plus grounding observability and a general answer-quality pass.

**Architecture:** An additive async personal branch in the AI Search router. Personal queries send Perplexity only the current query (no history); a new `ai_search_personal` service assembles a compact PERSONAL CONTEXT block from existing Compass services (read-only) and synthesizes the final answer via `AsyncAnthropic` streaming on the event loop. Personal answers are never logged, cached, or shared. Context-only (no authored GO/HOLD/SKIP verdict in v1).

**Tech Stack:** FastAPI (async SSE), `anthropic.AsyncAnthropic` (SDK 0.83.0), SQLite (J2 + auth.db via existing services), React/Vite widget, pytest + vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-22-aisearch-personal-grounding-design.md` (authoritative).
- **Flag-gated, default OFF:** `AI_SEARCH_PERSONAL_ENABLED` (`"1"/"true"/"yes"` = on). Branch never entered when off.
- **Privacy invariants (each has a test):** (1) no personal data — incl. history — in any Perplexity payload; (2) personal answers never logged/brain-indexed, keyed on the BRANCH decision not the `first_person` regex; (3) never cached under a shared/query key; (4) never published to community; (5) authorization: only the request user's own data, server-resolved paid gate; (6) skip persisting raw query text when `first_person_flag(query)==1`.
- **Event loop:** all LLM calls async on the loop (`AsyncAnthropic`, async `stream_search`) — NO `run_in_executor` for LLM calls, NO blocking `requests`-based `web_search` on the async path.
- **Anthropic call config:** `thinking={"type":"disabled"}`, **no `temperature`**, explicit `timeout`, `max_tokens` from `AI_SEARCH_SYNTH_MAX_TOKENS` (~800). Model id from `AI_SEARCH_SYNTH_MODEL`.
- **Context-only:** synthesis must NOT author a GO/HOLD/SKIP call; present facts + fresh read, state the decision is the member's.
- **No temperature on Sonnet tier** (400s). **Never invent** a fill/stop/P&L/level not in the block; placeholder stop → "no stop set — risk undefined".
- **UCT worktree flow:** isolated worktree `feat/aisearch-personal` from origin/master; ship `git push origin feat/aisearch-personal:master`; explicit `-- <path>` commits; never `git add -A`. `grep -c broker_sync api/main.py` ≥ 7 before any push.
- Base dir: `C:\Users\Patrick\uct-worktrees\aisearch-personal`.

---

### Task 1: Fix `portfolio_heat` / `voice_position_sizing` camelCase position keys (live prod bug)

`portfolio_heat` reads `entry_price`/`stop_price` but `list_open_positions` returns
`entryPrice`/`stopPrice` → every position skipped → 0% heat for everyone. Independent,
safety-critical; do first.

**Files:**
- Modify: `api/services/portfolio_heat.py` (the `p.get("entry_price")`/`p.get("stop_price")`/`p.get("shares")`/`p.get("symbol")`/`p.get("side")` reads ~L100-131)
- Modify: `api/services/voice_position_sizing.py` (`_current_portfolio_risk` ~L148-150, same snake_case reads)
- Test: `tests/test_portfolio_heat_camelcase.py` (new)

**Interfaces:**
- Produces: `portfolio_heat.portfolio_heat(user_id, account_id)` correctly reading real `list_open_positions` output (camelCase). Return shape unchanged.

- [ ] **Step 1: Write the failing test — feed REAL camelCase position shape**

```python
# tests/test_portfolio_heat_camelcase.py
from api.services import portfolio_heat as ph

def _camel_pos(sym, entry, stop, shares, side="long"):
    # The exact shape journal_two.positions._row_to_position returns.
    return {"symbol": sym, "side": side, "entryPrice": entry, "stopPrice": stop,
            "shares": shares, "entryEstimated": False, "brokerPrice": None}

def test_heat_reads_camelcase_positions():
    positions = [_camel_pos("NVDA", 100.0, 90.0, 100.0),   # risk = 100*10 = 1000
                 _camel_pos("AMD", 50.0, 45.0, 200.0)]      # risk = 200*5  = 1000
    out = ph.portfolio_heat("u1", "acct1", account_size=100_000.0,
                            positions_fn=lambda uid, aid: positions,
                            regime_fn=lambda: {"regime": "bull_trend", "exposure_rating": 100})
    # 2000 risk / 100k = 2.0% — NOT 0 (the bug returned 0 because every row was dropped)
    assert out["risk_heat_pct"] == 2.0
    assert len(out["per_position"]) == 2

def test_heat_surfaces_placeholder_stop_camelcase():
    positions = [_camel_pos("TSLA", 200.0, 200.0, 10.0)]   # stop==entry → placeholder
    out = ph.portfolio_heat("u1", "acct1", account_size=100_000.0,
                            positions_fn=lambda uid, aid: positions,
                            regime_fn=lambda: {"regime": "bull_trend", "exposure_rating": 100})
    assert out["placeholder_stops"] == ["TSLA"]
    assert out["risk_heat_pct"] == 0.0   # placeholder contributes no confident risk
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_portfolio_heat_camelcase.py -v`
Expected: FAIL — `risk_heat_pct == 0.0` (positions dropped) / `per_position == []`.

- [ ] **Step 3: Fix the key reads in `portfolio_heat.py`**

Replace the snake_case reads in the position loop:
```python
        try:
            entry = float(p.get("entryPrice"))
            shares = float(p.get("shares"))
        except (TypeError, ValueError):
            continue
        try:
            stop = float(p.get("stopPrice"))
            is_placeholder = (stop == entry) or stop <= 0
        except (TypeError, ValueError):
            stop, is_placeholder = entry, True
```
And the `rec` side field: `"side": p.get("side") or "long"` (already camelCase-safe — `side` key is the same). Update `sym = (p.get("symbol") or "").upper()` — `symbol` is already correct.

- [ ] **Step 4: Fix `voice_position_sizing._current_portfolio_risk`** the same way (read `entryPrice`/`stopPrice`/`shares`).

- [ ] **Step 5: Run tests to verify they pass** (plus the existing suite is unaffected)

Run: `python -m pytest tests/test_portfolio_heat_camelcase.py tests/test_portfolio_heat.py -v`
Expected: PASS. (Note: existing `test_portfolio_heat.py` injects snake_case dicts — if it now fails, its fixtures must be updated to camelCase since that's the real shape; update `_pos()` to emit `entryPrice`/`stopPrice`.)

- [ ] **Step 6: Commit**

```bash
git add api/services/portfolio_heat.py api/services/voice_position_sizing.py tests/test_portfolio_heat_camelcase.py tests/test_portfolio_heat.py
git commit -m "fix: portfolio_heat/voice_position_sizing read camelCase position keys (was dropping every position → 0% heat)"
```

---

### Task 2: `ai_search_personal.assemble()` — the PERSONAL CONTEXT block

**Files:**
- Create: `api/services/ai_search_personal.py`
- Test: `tests/test_ai_search_personal_assemble.py` (new)

**Interfaces:**
- Consumes: `journal_two.positions.list_open_positions(user_id, account_id=...)`, `portfolio_heat.portfolio_heat(user_id, account_id)`, `personal_edge.edge_for_setups(user_id, account_id)`, `watchlist_service.list_user_watchlists/get_or_create_flagged_list`, `accounts.list_accounts(user_id)`, `live_prices` cache.
- Produces:
  - `resolve_account(user_id, query_tickers) -> str | None` (read-only; None ⇒ decline personal).
  - `has_data(user_id) -> bool` (memoized ~120s).
  - `assemble(user_id, account_id, query, tickers) -> str` (char-capped PERSONAL CONTEXT block; "" if nothing).

- [ ] **Step 1: Write failing tests** (`tests/test_ai_search_personal_assemble.py`)

```python
from api.services import ai_search_personal as p

def test_resolve_account_prefers_holder(monkeypatch):
    monkeypatch.setattr(p, "_list_accounts", lambda uid: [{"id": "A"}, {"id": "B"}])
    monkeypatch.setattr(p, "_positions_for", lambda uid, aid: (
        [{"symbol": "NVDA"}] if aid == "B" else []))
    assert p.resolve_account("u1", ["NVDA"]) == "B"      # the account that holds it
    assert p.resolve_account("u1", []) == "A"            # else first
    monkeypatch.setattr(p, "_list_accounts", lambda uid: [])
    assert p.resolve_account("u1", ["NVDA"]) is None     # zero accounts → decline

def test_assemble_positions_uses_keyword_account_id(monkeypatch):
    called = {}
    def fake_list(user_id, account_id=None):
        called["kw"] = account_id
        return [{"symbol": "NVDA", "side": "long", "entryPrice": 100.0, "stopPrice": 90.0,
                 "shares": 10.0, "entryEstimated": False, "brokerPrice": None, "entryDate": "2026-07-01"}]
    monkeypatch.setattr(p, "_positions_for", lambda uid, aid: fake_list(uid, account_id=aid))
    monkeypatch.setattr(p, "_heat_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_edge_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_watch_syms", lambda uid: [])
    monkeypatch.setattr(p, "_live_price", lambda sym: 110.0)
    block = p.assemble("u1", "acctB", "should i add to my nvda", ["NVDA"])
    assert "NVDA" in block and "entry" in block.lower()
    assert called["kw"] == "acctB"                       # account_id passed as keyword

def test_assemble_broker_estimated_labels_return(monkeypatch):
    monkeypatch.setattr(p, "_positions_for", lambda uid, aid: [
        {"symbol": "AMD", "side": "long", "entryPrice": 50.0, "stopPrice": 50.0, "shares": 5.0,
         "entryEstimated": True, "brokerPrice": 60.0, "entryDate": "2026-07-22"}])
    monkeypatch.setattr(p, "_heat_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_edge_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_watch_syms", lambda uid: [])
    monkeypatch.setattr(p, "_live_price", lambda sym: None)   # cold cache
    block = p.assemble("u1", "acctB", "how's my book", [])
    assert "est." in block.lower()          # estimated basis labeled
    assert "no stop" in block.lower()       # placeholder stop surfaced, not a number

def test_assemble_default_account_size_omits_pct(monkeypatch):
    monkeypatch.setattr(p, "_positions_for", lambda uid, aid: [])
    monkeypatch.setattr(p, "_heat_for", lambda uid, aid: {"risk_heat_pct": 8.0, "account_size_is_default": True})
    monkeypatch.setattr(p, "_edge_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_watch_syms", lambda uid: [])
    block = p.assemble("u1", "acctB", "am i overexposed", [])
    assert "8.0%" not in block               # % omitted when denominator is the $50k default
    assert "account size not set" in block.lower()

def test_assemble_is_char_capped(monkeypatch):
    many = [{"symbol": f"T{i}", "side": "long", "entryPrice": 10.0, "stopPrice": 9.0,
             "shares": 1.0, "entryEstimated": False, "brokerPrice": None, "entryDate": "2026-01-01"}
            for i in range(200)]
    monkeypatch.setattr(p, "_positions_for", lambda uid, aid: many)
    monkeypatch.setattr(p, "_heat_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_edge_for", lambda uid, aid: {})
    monkeypatch.setattr(p, "_watch_syms", lambda uid: [f"W{i}" for i in range(500)])
    block = p.assemble("u1", "acctB", "how's my book", [])
    assert len(block) <= p._BLOCK_CAP
```

- [ ] **Step 2: Run to verify fail** — `python -m pytest tests/test_ai_search_personal_assemble.py -v` → FAIL (module missing).

- [ ] **Step 3: Implement `ai_search_personal.py`** (assembly half; synthesize added in Task 3)

```python
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
```

- [ ] **Step 4: Run tests to verify pass** — `python -m pytest tests/test_ai_search_personal_assemble.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/ai_search_personal.py tests/test_ai_search_personal_assemble.py
git commit -m "feat: ai_search_personal.assemble — read-only PERSONAL CONTEXT block from Compass services"
```

> **Implementer note:** `portfolio_heat` must expose `account_size_is_default` + `aggregate_cap_pct` in its return dict — add them in this task if absent (a one-line addition where it computes `account`/the cap). `personal_edge.edge_for_setups` return-shape: confirm the `by_setup` key via a quick read; adapt `_fmt_edge` to the real key. `list_user_watchlists` item shape: confirm `items[].sym`.

---

### Task 3: `ai_search_personal.synthesize()` — AsyncAnthropic streaming + safety + caps

**Files:**
- Modify: `api/services/ai_search_personal.py` (add synthesize + shared safety constant + cost reserve)
- Modify: `api/routers/ai_search.py` (export the shared safety-block constant `_SAFETY_BLOCKS` so both prompts share it)
- Test: `tests/test_ai_search_personal_synth.py` (new)

**Interfaces:**
- Consumes: `AsyncAnthropic`, `_SAFETY_BLOCKS` (SCOPE/ILLEGAL/DATA-LIMITS text extracted from `_WIDGET_SYSTEM`).
- Produces: `async def synthesize(query, draft, personal_block, live_desk, history) -> AsyncIterator[str]` (yields token deltas). `reserve_synth(user_id) -> bool` (atomic per-user+global cost gate). `SYNTH_SYSTEM(personal_block, live_desk) -> str`.

- [ ] **Step 1: Extract `_SAFETY_BLOCKS` in `ai_search.py`** — pull the SCOPE / DATA-LIMITS / ILLEGAL-MANIPULATION paragraphs (currently inline in `_WIDGET_SYSTEM`, ai_search.py:43-66) into a module constant `_SAFETY_BLOCKS`, and build `_WIDGET_SYSTEM` from it so behavior is byte-identical. (Verify with the existing AI-search tests still green.)

- [ ] **Step 2: Write failing tests** (`tests/test_ai_search_personal_synth.py`)

```python
import asyncio
from api.services import ai_search_personal as p
from api.routers import ai_search as router

def test_synth_system_carries_safety_blocks():
    sysmsg = p.SYNTH_SYSTEM("YOUR POSITIONS: NVDA", "regime bull")
    assert router._SAFETY_BLOCKS in sysmsg                 # illegal/scope/data-limits present
    assert "may be dated" in sysmsg.lower()                # freshness firewall
    assert "do not" in sysmsg.lower() and "go/hold/skip" in sysmsg.lower()  # no authored verdict
    assert "risk undefined" in sysmsg.lower()              # placeholder-stop rule

def test_reserve_synth_per_user_atomic(monkeypatch):
    monkeypatch.setattr(p, "_SYNTH_PERUSER_CAP", 2)
    monkeypatch.setattr(p, "_SYNTH_GLOBAL_HARD", 999.0)
    p._reset_synth_counters()
    assert p.reserve_synth("u1") is True
    assert p.reserve_synth("u1") is True
    assert p.reserve_synth("u1") is False                  # 3rd exceeds per-user cap
    assert p.reserve_synth("u2") is True                   # other user unaffected

def test_synth_streams_via_async_anthropic(monkeypatch):
    # Fake AsyncAnthropic streaming context manager yielding two deltas.
    class _Stream:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        @property
        async def text_stream(self):
            for t in ("Your ", "NVDA…"):
                yield t
    class _Msgs:
        def stream(self, **kw): return _Stream()
    class _Client:
        messages = _Msgs()
    monkeypatch.setattr(p, "_async_client", lambda: _Client())
    async def go():
        return [t async for t in p.synthesize("q", "draft", "YOUR POSITIONS", "regime", None)]
    out = asyncio.get_event_loop().run_until_complete(go())
    assert "".join(out) == "Your NVDA…"
```

- [ ] **Step 3: Run to verify fail** — `python -m pytest tests/test_ai_search_personal_synth.py -v` → FAIL.

- [ ] **Step 4: Implement synthesize + reserve in `ai_search_personal.py`**

```python
import threading

_SYNTH_MODEL = os.environ.get("AI_SEARCH_SYNTH_MODEL", "claude-sonnet-5")
_SYNTH_MAX_TOKENS = int(os.environ.get("AI_SEARCH_SYNTH_MAX_TOKENS", "800"))
_SYNTH_TIMEOUT = float(os.environ.get("AI_SEARCH_SYNTH_TIMEOUT", "45"))
_SYNTH_PERUSER_CAP = int(os.environ.get("AI_SEARCH_SYNTH_PERUSER_CAP", "20"))
_SYNTH_GLOBAL_HARD = float(os.environ.get("AI_SEARCH_SYNTH_COST_HARD", "25"))
_APPROX_COST = 0.02
_synth_lock = threading.Lock()
_synth_day = ""; _synth_by_user: dict = {}; _synth_spend = 0.0

def _et_day():
    from api.routers.ai_search import _et_day as d
    return d()

def _reset_synth_counters():
    global _synth_day, _synth_by_user, _synth_spend
    _synth_day, _synth_by_user, _synth_spend = "", {}, 0.0

def reserve_synth(user_id):
    """Atomic check-AND-increment (mirror router._reserve). False ⇒ over cap ⇒ caller emits the public draft."""
    global _synth_day, _synth_spend
    with _synth_lock:
        d = _et_day()
        if d != _synth_day:
            _synth_day, _synth_by_user.clear() if _synth_by_user else None, 0.0
            _synth_day = d; _synth_by_user.clear(); _synth_spend = 0.0
        if _synth_spend + _APPROX_COST > _SYNTH_GLOBAL_HARD:
            return False
        if _synth_by_user.get(user_id, 0) + 1 > _SYNTH_PERUSER_CAP:
            return False
        _synth_by_user[user_id] = _synth_by_user.get(user_id, 0) + 1
        _synth_spend += _APPROX_COST
        return True

def _async_client():
    import anthropic
    return anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

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
```

- [ ] **Step 5: Run tests to verify pass** — `python -m pytest tests/test_ai_search_personal_synth.py -v` → PASS. (Fix the `reserve_synth` day-roll line to the clean form: reset `_synth_by_user`/`_synth_spend` when `d != _synth_day`.)

- [ ] **Step 6: Commit**

```bash
git add api/services/ai_search_personal.py api/routers/ai_search.py tests/test_ai_search_personal_synth.py
git commit -m "feat: ai_search_personal.synthesize — AsyncAnthropic stream, shared safety blocks, per-user atomic cost cap"
```

---

### Task 4: Purpose-built `is_personal` detection

**Files:**
- Modify: `api/routers/ai_search.py` (add `_PERSONAL_INTENT_RE`, `is_personal(query, user)`)
- Test: `tests/test_ai_search_detection.py` (new)

**Interfaces:**
- Consumes: `ai_search_personal.has_data`, the paid gate (Task 5 adds `_is_paid_server`), `_extract_tickers`.
- Produces: `is_personal(query, user) -> bool`.

- [ ] **Step 1: Write failing tests**

```python
from api.routers import ai_search as r

class _U(dict): pass
PAID = {"user_id": "u1", "plan": "pro"}

def _wire(monkeypatch, paid=True, has_data=True):
    monkeypatch.setattr(r, "_is_paid_server", lambda u: paid)
    monkeypatch.setattr(r.ai_search_personal, "has_data", lambda uid: has_data)

def test_personal_positive_cases(monkeypatch):
    _wire(monkeypatch)
    for q in ["am i overexposed", "should i add to my nvda", "how's my week",
              "should I trim my NVDA", "room to add here?", "which of my positions is near its stop"]:
        assert r.is_personal(q, PAID) is True, q

def test_personal_negative_cases(monkeypatch):
    _wire(monkeypatch)
    for q in ["is TSLA extended here?", "thoughts on NVDA", "should I worry about the Fed",
              "what is a VCP", "why is NOW up today"]:
        assert r.is_personal(q, PAID) is False, q

def test_personal_requires_paid_and_data(monkeypatch):
    _wire(monkeypatch, paid=False); assert r.is_personal("am i overexposed", PAID) is False
    _wire(monkeypatch, has_data=False); assert r.is_personal("am i overexposed", PAID) is False
    assert r.is_personal("am i overexposed", None) is False
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** in `ai_search.py`:

```python
import re as _re
_PERSONAL_INTENT_RE = _re.compile(
    r"\b(am i (over ?exposed|too (concentrated|heavy)|too much in)"
    r"|should i (add|trim|hold|sell|buy)\b"
    r"|room to add|how('?s| is| am i) my|how am i doing"
    r"|my (position|positions|book|portfolio|stop|risk|heat|shares)"
    r"|(closest|near(est)?) (to )?(its )?stop"
    r"|how('?s| is) my (day|week|book))\b", _re.I)

def is_personal(query, user):
    if not user or not (query or "").strip():
        return False
    if not _PERSONAL_INTENT_RE.search(query):
        return False
    if not _is_paid_server(user):          # cheap gate before any DB read
        return False
    try:
        uid = user.get("user_id")
        return bool(uid) and ai_search_personal.has_data(uid)
    except Exception:
        return False
```
Add `from api.services import ai_search_personal` at the top.

- [ ] **Step 4: Run tests to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add api/routers/ai_search.py tests/test_ai_search_detection.py
git commit -m "feat: purpose-built is_personal detection (portfolio-intent, paid+has_data gated)"
```

---

### Task 5: Router personal branch — wiring, privacy invariants, streaming, fallback

**Files:**
- Modify: `api/routers/ai_search.py` (both endpoints; add `_is_paid_server`, personal branch, `personal` flag, branch-keyed log-skip, per-user synth reserve, meta/final flag, in-band fallback)
- Test: `tests/test_ai_search_personal_branch.py` (new)

**Interfaces:**
- Consumes: `is_personal`, `ai_search_personal.assemble/synthesize/resolve_account/reserve_synth`, `_uct_context`, `stream_search`.
- Produces: personal-branch behavior on `POST /api/ai-search/stream` and `/api/ai-search`.

- [ ] **Step 1: Write failing privacy/behavior tests** (the load-bearing ones)

```python
import asyncio, types
from api.routers import ai_search as r

def _paid(monkeypatch):
    monkeypatch.setattr(r, "_is_paid_server", lambda u: True)
    monkeypatch.setattr(r.ai_search_personal, "has_data", lambda uid: True)
    monkeypatch.setattr(r.ai_search_personal, "resolve_account", lambda uid, tks: "acctA")
    monkeypatch.setattr(r.ai_search_personal, "assemble",
                        lambda uid, aid, q, tks: "YOUR POSITIONS: NVDA entry $100, +12%, stop $90")
    monkeypatch.setattr(r.ai_search_personal, "reserve_synth", lambda uid: True)

def test_invariant1_no_personal_history_to_perplexity(monkeypatch):
    """A prior PERSONAL answer in history must never reach the Perplexity payload."""
    _paid(monkeypatch)
    captured = {}
    async def fake_stream_search(query, system=None, history=None, **kw):
        captured["history"] = history; captured["system"] = system
        yield {"type": "final", "answer": "public draft", "citations": []}
    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)
    async def fake_synth(q, draft, pb, live, hist):
        yield "personalized answer"
    monkeypatch.setattr(r.ai_search_personal, "synthesize", fake_synth)
    hist = [{"q": "how's my nvda", "a": "Your NVDA entry $100, +12%, stop $90 — up nicely"}]
    events = _run_personal_stream(r, "should i add given the news", history=hist)
    # Perplexity got NO history at all on the personal branch
    assert captured.get("history") in (None, [])
    # and nothing from the personal prior answer is in the system prompt
    assert "entry $100" not in (captured.get("system") or "")

def test_invariant2_personal_answer_never_logged(monkeypatch):
    _paid(monkeypatch)
    logged = []
    monkeypatch.setattr(r.ai_search_log, "log", lambda **kw: logged.append(kw))
    async def fake_stream_search(query, system=None, history=None, **kw):
        yield {"type": "final", "answer": "draft", "citations": []}
    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)
    async def fake_synth(q, draft, pb, live, hist): yield "personal"
    monkeypatch.setattr(r.ai_search_personal, "synthesize", fake_synth)
    _run_personal_stream(r, "am i overexposed", history=None)   # first_person regex does NOT match this
    assert logged == []                                          # branch-keyed skip, not regex

def test_pure_portfolio_skips_perplexity(monkeypatch):
    _paid(monkeypatch)
    called = {"perp": 0}
    async def fake_stream_search(*a, **k):
        called["perp"] += 1
        yield {"type": "final", "answer": "draft", "citations": []}
    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)
    async def fake_synth(q, draft, pb, live, hist): yield "personal"
    monkeypatch.setattr(r.ai_search_personal, "synthesize", fake_synth)
    _run_personal_stream(r, "am i overexposed", history=None)
    assert called["perp"] == 0                                   # no web hop for pure self-state

def test_cost_cap_falls_back_to_public_draft(monkeypatch):
    _paid(monkeypatch)
    monkeypatch.setattr(r.ai_search_personal, "reserve_synth", lambda uid: False)   # over cap
    async def fake_stream_search(*a, **k):
        yield {"type": "final", "answer": "PUBLIC DRAFT", "citations": []}
    monkeypatch.setattr(r.perplexity_search, "stream_search", fake_stream_search)
    ev = _run_personal_stream(r, "should i add to my nvda given the news", history=None)
    final = [e for e in ev if e.get("type") == "final"][-1]
    assert "PUBLIC DRAFT" in final["answer"]
```
(`_run_personal_stream` is a small helper in the test that drives the async SSE generator to completion collecting parsed events — include it in the test file.)

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement `_is_paid_server` + the personal branch.**

`_is_paid_server(user)`: resolve plan server-side (never trust client) —
```python
def _is_paid_server(user):
    try:
        from api.middleware.auth_middleware import is_paid_user
        from api.services.auth_service import get_user_plan
        uid = (user or {}).get("user_id")
        if not uid: return False
        return is_paid_user({**user, "plan": get_user_plan(uid)})
    except Exception:
        return False
```

Personal branch inside the stream endpoint (after `body` is parsed, before the normal path):
```python
    personal = bool(_personal_enabled()) and is_personal(body.query, user)
    if personal:
        return StreamingResponse(_personal_gen(body, user), media_type="text/event-stream", headers=...)
```
`_personal_gen(body, user)` (async):
1. `_reserve(user_id, 1)` (existing daily cap).
2. `yield` a `meta` SSE event `{"type":"meta","personal":True}` immediately.
3. Resolve `tickers = meta.query_tickers` via `_uct_context`; `account_id = resolve_account(uid, tickers)`; if None → set `personal=False` and fall through to the normal path.
4. `needs_web = _needs_web(body.query, question_type)` — heuristic: personal-only intents (`am i overexposed`, `how's my book/week`, pure heat/edge) → False; anything naming an external/research/news/"given the news" → True.
5. `draft = ""`; if `needs_web`: collect `stream_search(PUBLIC system from _grounded_system, body.query, history=None)` to its `final.answer` (**history=None** — invariant #1). PUBLIC system contains NO personal data.
6. `personal_block = assemble(uid, account_id, body.query, tickers)`; `live_desk = ctx` from `_uct_context`.
7. If `reserve_synth(uid)`: `async for delta in synthesize(body.query, draft, personal_block, live_desk, body.history): yield delta SSE`. Else: `yield` the `draft` as the answer (degrade indicator `personalization_paused:true`).
8. On synthesis exception after partial: emit `draft` (or the collected partial) as `final` in-band — never raise so the widget doesn't re-run single-shot.
9. **Never call `_log_answer`** anywhere in `_personal_gen` (branch-keyed skip).

Single-shot `/api/ai-search`: same branch, non-streamed (collect synthesize to a string); same no-log rule; on over-cap/fail return the public draft with `personal:true`.

Add `_personal_enabled()` reading `AI_SEARCH_PERSONAL_ENABLED`.

- [ ] **Step 4: Run tests to verify pass.**

- [ ] **Step 5: Add invariant-3 (no shared cache) + invariant-6 (query-text skip) guards.** Ensure `_personal_gen` never writes the synthesized answer to `cache`/Perplexity cache (it doesn't call them — assert via a test that `cache.set` is not called with the personal answer). In the NON-personal log path, when `ai_search_log.first_person_flag(query)` is true, pass a redaction flag so the raw query text isn't persisted (implement in Task 6).

- [ ] **Step 6: Commit**

```bash
git add api/routers/ai_search.py tests/test_ai_search_personal_branch.py
git commit -m "feat: AI Search personal branch — privacy-safe wiring, async synthesis stream, in-band fallback"
```

---

### Task 6: `ai_search_log` — tiered signal, content-free personal counter, coverage insights, query-text skip

**Files:**
- Modify: `api/services/ai_search_log.py`
- Test: `tests/test_ai_search_log_coverage.py` (new)

**Interfaces:**
- Produces: `record_personal_invocation(degraded: bool)`, `insights()` gains `grounding_coverage` (tiered, ambient-excluded) + `personal` lane (from the counter, explicit denominator). `log(..., skip_query_text: bool=False)`.

- [ ] **Step 1: Write failing tests**

```python
from api.services import ai_search_log as L

def test_tier_excludes_ambient_regime():
    assert L._grounding_tier({"regime"}) == "web-only"          # regime is ambient
    assert L._grounding_tier({"regime", "recency"}) == "web-only"
    assert L._grounding_tier({"regime", "quote"}) == "desk-grounded"   # real proprietary source
    assert L._grounding_tier(set()) == "web-only"

def test_personal_counter_is_content_free(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path/"l.db"))
    L._reset_for_test()
    L.record_personal_invocation(degraded=False)
    L.record_personal_invocation(degraded=True)
    ins = L.insights(days=7)
    assert ins["personal"]["invocations"] == 2
    assert ins["personal"]["degraded"] == 1
    # no query/answer columns exist on the counter table
    assert "query" not in ins["personal"]

def test_log_skips_query_text_when_flagged(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path/"l.db"))
    L._reset_for_test()
    L.log(query="should i sell my 500 NVDA at 200", answer="a", skip_query_text=True)
    rows = L._all_rows_for_test()
    assert rows and rows[0]["query"] in ("", None)             # raw text not persisted
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement:**
  - `_AMBIENT = {"regime", "recency"}`; `_grounding_tier(sources)`: `"desk-grounded"` if `set(sources) - _AMBIENT` non-empty else `"web-only"`.
  - New table `ai_search_personal_counter(day TEXT, invocations INT, degraded INT)` (content-free); `record_personal_invocation(degraded)` upserts today's row.
  - `insights()`: add `grounding_coverage` = per-tier counts over logged (non-personal) rows, and `personal` = `{invocations, degraded, rate: invocations/(logged+invocations)}`.
  - `log(..., skip_query_text=False)`: store `""` for query when set.

- [ ] **Step 4: Run tests to verify pass.**

- [ ] **Step 5: Wire the counter** — in `_personal_gen`/single-shot personal path (Task 5) call `record_personal_invocation(degraded=<synth skipped>)`. Add one line + a test that a personal request bumps the counter.

- [ ] **Step 6: Commit**

```bash
git add api/services/ai_search_log.py api/routers/ai_search.py tests/test_ai_search_log_coverage.py
git commit -m "feat: grounding coverage (ambient-excluded tiers) + content-free personal counter + query-text skip"
```

---

### Task 7: `ai_search_memory` ingest excludes the explicit personal flag

**Files:**
- Modify: `api/services/ai_search_memory.py` (`_eligible_rows`/`reindex` WHERE clause)
- Test: `tests/test_ai_search_memory_personal_exclude.py` (new)

- [ ] **Step 1: Failing test** — seed the log with a row carrying `personal=1` (even if `first_person=0`), assert `_eligible_rows()` excludes it.

```python
from api.services import ai_search_memory as M, ai_search_log as L
def test_personal_rows_never_ingested(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_SEARCH_LOG_DB_PATH", str(tmp_path/"l.db"))
    L._reset_for_test()
    L.log(query="thoughts on nvda", answer="evergreen-ish", first_person=0, personal=1, freshness="evergreen", answer_kind="ok")
    assert all(r.get("personal") != 1 for r in M._eligible_rows())
```

- [ ] **Step 2: Run to verify fail** (requires `log()` to accept+store a `personal` column — add the ADD-COLUMN migration in `ai_search_log` `_COLUMNS`).

- [ ] **Step 3: Implement** — add `personal INTEGER DEFAULT 0` to the log schema/`_COLUMNS`; `log()` accepts `personal`; `_eligible_rows`/`reindex` add `AND personal=0` (belt-and-suspenders behind invariant #2's "never logged at all").

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add api/services/ai_search_memory.py api/services/ai_search_log.py tests/test_ai_search_memory_personal_exclude.py
git commit -m "feat: brain ingest excludes explicit personal flag (independent backstop)"
```

---

### Task 8: `community_cards` server-side refusal of personal AI content

**Files:**
- Modify: `api/services/community_cards.py` (`kind:'ai'` branch ~L159-166)
- Test: `tests/test_community_cards_personal.py` (new)

- [ ] **Step 1: Failing test** — a `kind:'ai'` card carrying `personal:true` (or matching the personal signature) is rejected/stripped by `build_card`.

```python
from api.services import community_cards as C
def test_ai_card_rejects_personal():
    card = C.build_card({"kind": "ai", "q": "am i overexposed", "a": "Your NVDA...", "personal": True})
    assert card is None or card.get("blocked")     # never publishes personal content
```

- [ ] **Step 2–4:** implement the `personal` guard in the `ai` branch (return None/blocked when `card.get("personal")`), run, verify.

- [ ] **Step 5: Commit**

```bash
git add api/services/community_cards.py tests/test_community_cards_personal.py
git commit -m "feat: community AI card refuses personal-flagged content server-side"
```

---

### Task 9: Widget — personal flag threading, waiting state, share suppression, disclaimer gate

**Files:**
- Modify: `app/src/pages/charts/widgets/AiSearchWidget.jsx` (or the widget's actual path — confirm via grep)
- Test: `app/src/.../AiSearchWidget.test.jsx` (extend)

- [ ] **Step 1: Failing vitest** — mock a stream whose `meta` event has `personal:true` and `final` has `personal:true`; assert (a) a personal waiting line renders during load, (b) `ShareToFloor` is absent on the personal entry, (c) the retention disclaimer is hidden/altered on the personal entry.

```jsx
it('personal answer: waiting state, no ShareToFloor, no retention disclaimer', async () => {
  mockStream([{type:'meta', personal:true}, {type:'delta', text:'Your NVDA…'}, {type:'final', personal:true, answer:'Your NVDA…', citations:[]}])
  render(<AiSearchWidget/>)
  fireEvent.change(screen.getByRole('textbox'), {target:{value:'am i overexposed'}})
  fireEvent.keyDown(screen.getByRole('textbox'), {key:'Enter'})
  expect(await screen.findByText(/your positions|your book/i)).toBeInTheDocument()  // waiting line
  await screen.findByText(/Your NVDA/)
  expect(screen.queryByText(/share to floor/i)).toBeNull()
  expect(screen.queryByText(/retained de-identified/i)).toBeNull()
})
```

- [ ] **Step 2–4:** thread `personal` from the `meta`/`final` events into the thread entry (`applyFinal`); add a `personal` waiting state analogous to the `deep` state; guard `ShareToFloor` with `!entry.personal`; gate the disclaimer on `!entry.personal`. Run vitest (`--pool=threads`), verify.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/widgets/AiSearchWidget.jsx app/src/pages/charts/widgets/AiSearchWidget.test.jsx
git commit -m "feat: widget personal-answer waiting state + share/disclaimer suppression"
```

---

### Task 10: Admin panel — redesigned grounding-coverage lane

**Files:**
- Modify: `app/src/components/admin/AiSearchInsightsPanel.jsx`
- Test: `app/src/components/admin/AiSearchInsightsPanel.test.jsx` (add if absent)

- [ ] **Step 1: Failing vitest** — mock `insights()` payload with `grounding_coverage` tiers + `personal` lane; assert the lane renders the tier rates and the personal invocation rate with its denominator label, and does NOT render regime as a "proprietary" hit.

- [ ] **Step 2–4:** render the coverage lane from the new shape; run vitest; verify.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/admin/AiSearchInsightsPanel.jsx app/src/pages/admin/AiSearchInsightsPanel.test.jsx
git commit -m "feat: admin grounding-coverage lane (differentiation tiers + personal rate)"
```

---

### Task 11: Full-suite verification + build + ship

- [ ] **Step 1: Backend suite** — `python -m pytest tests/ -k "ai_search or portfolio_heat or personal" -q` → all green.
- [ ] **Step 2: Frontend** — `cd app && npx vitest run src/pages/charts/widgets/AiSearchWidget.test.jsx <admin panel test> --pool=threads` → green.
- [ ] **Step 3: Build** — `cd app && npm run build` → clean.
- [ ] **Step 4: Boot smoke** — `WORKER_ENABLED=0 ... python -m uvicorn api.main:app --port 8081` boots; `grep -c broker_sync api/main.py` ≥ 7.
- [ ] **Step 5: Ship** (flag stays OFF in prod — `AI_SEARCH_PERSONAL_ENABLED` unset) — `git fetch origin && git rebase origin/master && git push origin feat/aisearch-personal:master`.
- [ ] **Step 6: Prod verify** — deploy lands; existing AI Search unaffected (flag off = normal path). Then set `AI_SEARCH_PERSONAL_ENABLED=1` on Railway web to activate; verify a personal query streams a position-aware answer and `/admin` shows the coverage lane; confirm via a personal follow-up that no personal text appears in any Perplexity request (network) — the invariant tests already lock this, this is the live confirmation.

## Self-Review

- **Spec coverage:** privacy invariants 1-6 → Tasks 5,6,7,8; detection → Task 4; account resolution (read-only) → Task 2; assembly slices incl. earnings/realized-P&L → Task 2 (earnings/realized-P&L are best-effort slices — implementer adds `_fmt_earnings_on_held` + `_fmt_realized` following the `_fmt_*` pattern; **add explicit steps if time-boxed**); synthesis (safety blocks, firewall, no-verdict, no-temperature, caps, streaming) → Task 3; camelCase bug → Task 1; Feature B metric → Task 6/10; Feature C1 prompt → folded into Task 3's `_SAFETY_BLOCKS` extraction + a `_WIDGET_SYSTEM` polish step (**add a small step in Task 3 for the house-voice refinement**); frontend → Tasks 9,10.
- **Gaps to close during execution:** (a) Task 2 — add earnings-on-held + day/week realized-P&L `_fmt_*` slices with their own tests; (b) Task 3 — add the C1 `_WIDGET_SYSTEM` house-voice/decision-shape refinement step; (c) confirm exact widget + admin-panel file paths via grep before Tasks 9/10.
- **Placeholder scan:** helper `_run_personal_stream` is defined in its test file; all code steps carry real code. Confirm real return-shape keys for `personal_edge`/`watchlist_service` (Task 2 note) and `portfolio_heat` new fields before relying on them.
- **Type consistency:** `assemble/synthesize/resolve_account/reserve_synth/has_data/is_personal/_is_paid_server/record_personal_invocation` names match across tasks.
