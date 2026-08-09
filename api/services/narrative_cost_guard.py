"""Durable, ET-anchored daily spend cap for LLM routes a stranger can reach.

WHY THIS EXISTS. `GET /api/schwab/market-narrative` made a Claude call — with
the server-side `web_search` tool attached, which is billed per search on top of
tokens — behind **no credential at all**. The 2026-08-09 auth sweep classed it as
"uncapped anonymous LLM spend": nothing in the request path knew how much the
firm had already spent today, so the only bound on the bill was the 30-minute
response cache, and a cache miss storm (a redeploy, a cache-key change, a bug)
removed even that.

THE PATTERN, not a new one. This is the theme engine's `$5/day` guard
(`theme_engine/store.day_cost_usd`) narrowed to one route:

  * **Durable.** The ledger is a table in `auth.db`, not a module dict, so a
    redeploy — the single most likely way to blow a daily cap — does not reset
    the day's spend to zero. `compass_cost_guard` deliberately keeps its
    counter in memory because it sits behind a per-user message cap; this route
    has no per-caller bound behind it, so memory alone would be a cap that
    forgets.
  * **ET-anchored.** `at` is stored UTC and the cutoff is the UTC instant of ET
    midnight, computed in Python. A UTC day boundary would refresh the cap in
    the ET evening and permit ~2× the intended spend inside one trading day —
    the house convention, copied verbatim from the theme engine.
  * **Unknown model ⇒ the priciest known rate, never $0.** Pricing $0 for an
    unrecognised model is how a cap becomes silently un-enforceable the day
    somebody changes the model string (`catalyst/cost_guard.py` carries the same
    decision, for the same reason).

FAIL DIRECTIONS, chosen deliberately:

  * A blank / typo'd / zero / negative `…_COST_CAP_DAILY` falls back to the
    coded default. **A cap of `0` must never read as "unlimited"** — that is the
    same trap `llm_timeouts.seconds()` refuses, where `0` is the SDK's spelling
    of *no timeout*.
  * `record()` never raises into the request, but it always accrues into an
    in-process accumulator as well as the table, and `spend_today_usd()` returns
    `max(durable, in-process)`. So a failed INSERT under-reports the ledger but
    still trips the cap for this pod, instead of silently uncapping it.
"""
from __future__ import annotations

import contextlib
import logging
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from api.services.auth_db import get_connection

logger = logging.getLogger(__name__)

# Mirrors the theme engine's daily ceiling. Generous for a route whose answer is
# cached 30 minutes (≤48 uncached calls/day at ~$0.02 each); the cap is not there
# to shape normal use, it is there to bound a cache bypass.
DEFAULT_CAP_USD = 5.0

# $ per million tokens.
_PRICES = {
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-4-7": (5.0, 25.0),
    "claude-sonnet-5": (3.0, 15.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
}

# Server-side `web_search` tool: $10 per 1,000 searches. The result tokens are
# billed as ordinary input tokens and already flow through the token maths.
_WEB_SEARCH_USD_EACH = 0.01

_ENV_CAP = "SCHWAB_NARRATIVE_COST_CAP_DAILY"

# Per-process fallback accumulator: {surface: (et_day, usd)}. See the module
# docstring — this exists so a failed ledger write cannot uncap the route.
_memory: dict[str, tuple[str, float]] = {}


def _conn():
    return contextlib.closing(get_connection())


def _et_now() -> datetime:
    return datetime.now(ZoneInfo("America/New_York"))


def _et_day() -> str:
    return _et_now().date().isoformat()


def _et_midnight_utc_text() -> str:
    """The UTC instant of today's ET midnight, in the ledger's text format."""
    et_midnight = _et_now().replace(hour=0, minute=0, second=0, microsecond=0)
    return et_midnight.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _init() -> None:
    with _conn() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS llm_route_cost_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              surface TEXT NOT NULL,
              model TEXT,
              input_tokens INTEGER DEFAULT 0,
              output_tokens INTEGER DEFAULT 0,
              web_searches INTEGER DEFAULT 0,
              cost_usd REAL DEFAULT 0,
              at TEXT DEFAULT (datetime('now')));
            CREATE INDEX IF NOT EXISTS idx_lrcl_surface_at
              ON llm_route_cost_log(surface, at);
            """
        )
        c.commit()


def cap_usd(env_name: str = _ENV_CAP, default: float = DEFAULT_CAP_USD) -> float:
    """`default`, overridable by `env_name`. Non-positive and unparseable values
    fall back to the default — a `0` here would otherwise read as "no cap"."""
    raw = os.environ.get(env_name)
    if raw is None or not str(raw).strip():
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def estimate_cost(model: str, input_tokens: int, output_tokens: int,
                  web_searches: int = 0) -> float:
    """USD for one call. An unknown model prices at the priciest known rate."""
    rates = _PRICES.get(model)
    if rates is None:
        # Tolerate a dated alias like claude-sonnet-4-6-20260101.
        for known, known_rates in _PRICES.items():
            if str(model or "").startswith(known):
                rates = known_rates
                break
    if rates is None:
        rates = max(_PRICES.values(), key=lambda r: r[1])
        logger.warning(
            "[narrative_cost_guard] unknown model pricing: %s — charging the "
            "priciest known rate ($%.0f/$%.0f per MTok) so the daily cap stays "
            "enforceable", model, rates[0], rates[1])
    pin, pout = rates
    return (float(input_tokens or 0) * pin / 1e6
            + float(output_tokens or 0) * pout / 1e6
            + float(web_searches or 0) * _WEB_SEARCH_USD_EACH)


def _memory_usd(surface: str) -> float:
    day, usd = _memory.get(surface, ("", 0.0))
    return usd if day == _et_day() else 0.0


def _accrue_memory(surface: str, usd: float) -> None:
    today = _et_day()
    day, prev = _memory.get(surface, ("", 0.0))
    _memory[surface] = (today, (prev if day == today else 0.0) + float(usd or 0.0))


def spend_today_usd(surface: str) -> float:
    """Today's (ET) spend for `surface` — the larger of the durable ledger and
    this process's accumulator, so a failed write can only over-report."""
    durable = 0.0
    try:
        _init()
        with _conn() as c:
            row = c.execute(
                "SELECT COALESCE(SUM(cost_usd), 0) FROM llm_route_cost_log "
                "WHERE surface = ? AND at >= ?",
                (surface, _et_midnight_utc_text())).fetchone()
        durable = float(row[0] or 0.0)
    except Exception as exc:  # noqa: BLE001 — a broken ledger must not 500 a read
        logger.error("[narrative_cost_guard] ledger read failed for %s: %s — "
                     "falling back to this process's accumulator", surface, exc)
    return max(durable, _memory_usd(surface))


def over_budget(surface: str, env_name: str = _ENV_CAP,
                default: float = DEFAULT_CAP_USD) -> bool:
    """True once today's ET spend for `surface` has reached its cap."""
    return spend_today_usd(surface) >= cap_usd(env_name, default)


def record(surface: str, model: str, input_tokens: int = 0,
           output_tokens: int = 0, web_searches: int = 0) -> float:
    """Accrue one call. Never raises; always accrues in-process."""
    cost = estimate_cost(model, input_tokens, output_tokens, web_searches)
    _accrue_memory(surface, cost)
    try:
        _init()
        with _conn() as c:
            c.execute(
                "INSERT INTO llm_route_cost_log "
                "(surface, model, input_tokens, output_tokens, web_searches, cost_usd) "
                "VALUES (?,?,?,?,?,?)",
                (surface, model, int(input_tokens or 0), int(output_tokens or 0),
                 int(web_searches or 0), cost))
            c.commit()
    except Exception as exc:  # noqa: BLE001
        logger.error("[narrative_cost_guard] ledger write failed for %s: %s — "
                     "the in-process accumulator still holds $%.4f",
                     surface, exc, cost)
    return cost


def record_from_response(surface: str, model: str, response) -> float:
    """Accrue from an Anthropic message. Reads `usage.input_tokens` /
    `usage.output_tokens` and `usage.server_tool_use.web_search_requests`
    defensively — a shape change must not raise into a request handler."""
    usage = getattr(response, "usage", None)
    searches = 0
    tool_use = getattr(usage, "server_tool_use", None)
    if tool_use is not None:
        searches = getattr(tool_use, "web_search_requests", 0) or 0
    return record(
        surface, model,
        getattr(usage, "input_tokens", 0) or 0,
        getattr(usage, "output_tokens", 0) or 0,
        searches)


def snapshot(surface: str, env_name: str = _ENV_CAP,
             default: float = DEFAULT_CAP_USD) -> dict:
    spent = spend_today_usd(surface)
    cap = cap_usd(env_name, default)
    return {
        "surface": surface,
        "et_day": _et_day(),
        "spent_usd": round(spent, 4),
        "cap_usd": cap,
        "over_budget": spent >= cap,
    }


def _reset_for_test(surface: str | None = None, durable: bool = True) -> None:
    """Test hook. `durable=False` forgets only this process's accumulator, which
    is how a rail simulates a redeploy without erasing the ledger the redeploy
    is supposed to survive."""
    if surface is None:
        _memory.clear()
    else:
        _memory.pop(surface, None)
    if not durable:
        return
    try:
        _init()
        with _conn() as c:
            if surface is None:
                c.execute("DELETE FROM llm_route_cost_log")
            else:
                c.execute("DELETE FROM llm_route_cost_log WHERE surface = ?",
                          (surface,))
            c.commit()
    except Exception:  # noqa: BLE001
        pass
