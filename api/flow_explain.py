"""AI Print Explainer — POST /api/flow-explain (competitive-roadmap T1-3).

Claude explains any options-flow print in plain English at the point of
confusion. The pipeline is deterministic-first: we compute the FACTS
(vol/OI verdict, moneyness, DTE bucket, premium bucket, aggression,
earnings proximity, optional GEX context) BEFORE the LLM, and the model
only narrates them — it can never invent numbers we didn't hand it.

Guarantees:
  - NEVER raises a 500 for LLM problems: any Anthropic failure (timeout,
    overload, parse garbage) degrades to a deterministic explanation built
    from the same context dict (model='deterministic-fallback').
  - Cost-guarded: daily USD cap (env FLOW_EXPLAIN_DAILY_CAP_USD, default
    $5.00) tracked in SQLite; over cap → deterministic fallback, $0 spend.
  - Per-user cap: 50 requests/day (env FLOW_EXPLAIN_USER_DAILY_CAP) → 429.
  - Cached: a same-contract, same-day, same-shape print reuses the stored
    explanation (in-memory dict over SQLite at /data/flow_explain.db, env
    FLOW_EXPLAIN_DB_PATH).

GEX context note (inspected api/gex_service.py 2026-07-06): get_gex_data()
is a LIVE Schwab /chains fetch with NO cache anywhere in the codebase, so
there is no cheap cache-backed GEX read available today. We therefore only
attach GEX context when a cached classification snapshot exists under the
shared TTL cache key ``flow_gex_state_{TICKER}`` (populated by nothing yet
— a future caching layer can write it); otherwise the field is omitted.
We NEVER make the slow uncached Schwab call on this request path.

Blocking work (SQLite, Anthropic) runs in a sync ``def`` route so FastAPI
dispatches it to the anyio threadpool — never on the shared event loop.
"""
from __future__ import annotations

import contextlib
import datetime as _dt
import json
import logging
import os
import sqlite3
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

logger = logging.getLogger("flow_explain")

router = APIRouter(prefix="/api/flow-explain", tags=["flow-explain"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for flow explanations.

    🔴 PAID since 2026-08-09. Both routes (`POST ""` and `POST "/"`) were
    `get_current_user` only — a session, never a plan — and signup is open and
    free. Each accepted print runs an **Anthropic** call on the firm's key, so a
    free registration spent our tokens.

    ⛔ The two caps already in the handler are NOT this gate and never were.
    `_user_daily_cap()` bounds one account's request count and `_daily_cap_usd()`
    bounds the firm's total day; neither ever asked whether the account had paid
    for any of it. A per-user cap on a free account is a budget for giving the
    product away — and the global USD cap makes it worse, because free traffic
    exhausts the same dollar ceiling that then refuses PAYING members.

    Its consumer is the Live Flow / Options Flow surface, which `AuthGuard`
    already routes as paid (`/live-massive` and `/live-flow` bounce a non-paid
    user to `/morning-wire`), so nothing on the free tier reaches this.

    ⛔ Defined HERE, never imported from a sibling — each surface owns its own
    402 sentence so "which surface refused me" is readable off the message.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="Flow explanations require a paid plan")
    return user

# ── Config (read at call time so tests/env can override) ────────────────────

_FALLBACK_MODEL_NAME = "deterministic-fallback"

# $/1M tokens. Opus 4.8 list price is $5 in / $25 out (claude-api skill,
# cached 2026-06). Unknown model ids fall back to a deliberately conservative
# $15/$75 so the daily cap trips EARLY rather than late.
_PRICING = {
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-4-7": (5.0, 25.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
}
_FALLBACK_PRICING = (15.0, 75.0)

_MAX_TOKENS = 400
_LLM_TIMEOUT_SECS = 30.0
_MEM_CACHE_MAX = 2048


def _db_path() -> str:
    return os.environ.get("FLOW_EXPLAIN_DB_PATH", "/data/flow_explain.db")


def _model_name() -> str:
    return os.environ.get("FLOW_EXPLAIN_MODEL", "claude-opus-4-8")


def _daily_cap_usd() -> float:
    try:
        return float(os.environ.get("FLOW_EXPLAIN_DAILY_CAP_USD", "5.0"))
    except (TypeError, ValueError):
        return 5.0


def _user_daily_cap() -> int:
    try:
        return int(os.environ.get("FLOW_EXPLAIN_USER_DAILY_CAP", "50"))
    except (TypeError, ValueError):
        return 50


def _today_et() -> str:
    """Trading-day stamp in ET (cache keys + caps roll at ET midnight)."""
    try:
        from zoneinfo import ZoneInfo
        return _dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:
        # tzdata unavailable — fixed-offset approximation is fine for a cache key
        return (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(hours=5)).date().isoformat()


# ── SQLite store (WAL, contextlib.closing, in-memory fallback) ──────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS flow_explanations (
  key           TEXT PRIMARY KEY,
  explanation   TEXT NOT NULL,
  signals_json  TEXT NOT NULL,
  model         TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS flow_explain_costs (
  date  TEXT PRIMARY KEY,
  usd   REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS flow_explain_user_requests (
  user_id  TEXT NOT NULL,
  date     TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
"""

_WRITE_LOCK = threading.Lock()
_MEM_LOCK = threading.Lock()
_MEM_CACHE: dict[str, dict] = {}          # key → {explanation, signals, model}
_MEM_COSTS: dict[str, float] = {}         # date → usd (fallback when DB unavailable)
_MEM_USER_COUNTS: dict[tuple, int] = {}   # (user_id, date) → count (fallback)
_init_paths: set[str] = set()


def _connect() -> sqlite3.Connection:
    path = _db_path()
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5)
    conn.execute("PRAGMA busy_timeout=2000")
    if path not in _init_paths:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(_SCHEMA)
        conn.commit()
        _init_paths.add(path)
    return conn


def _cache_get_db(key: str) -> Optional[dict]:
    try:
        with contextlib.closing(_connect()) as conn:
            row = conn.execute(
                "SELECT explanation, signals_json, model FROM flow_explanations WHERE key = ?",
                (key,),
            ).fetchone()
        if not row:
            return None
        try:
            signals = json.loads(row[1])
        except Exception:
            signals = []
        return {"explanation": row[0], "signals": signals, "model": row[2]}
    except Exception:
        return None


def _cache_put_db(key: str, explanation: str, signals: list, model: str) -> None:
    try:
        with _WRITE_LOCK, contextlib.closing(_connect()) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO flow_explanations "
                "(key, explanation, signals_json, model, created_at) VALUES (?,?,?,?,?)",
                (key, explanation, json.dumps(signals), model, int(_dt.datetime.now(_dt.timezone.utc).timestamp())),
            )
            conn.commit()
    except Exception:
        pass  # cache is best-effort — never break the request


def _cache_get(key: str) -> Optional[dict]:
    with _MEM_LOCK:
        hit = _MEM_CACHE.get(key)
    if hit is not None:
        return hit
    hit = _cache_get_db(key)
    if hit is not None:
        with _MEM_LOCK:
            _MEM_CACHE[key] = hit
    return hit


def _cache_put(key: str, explanation: str, signals: list, model: str) -> None:
    entry = {"explanation": explanation, "signals": signals, "model": model}
    with _MEM_LOCK:
        if len(_MEM_CACHE) >= _MEM_CACHE_MAX:
            _MEM_CACHE.clear()  # crude but bounded; sqlite still holds everything
        _MEM_CACHE[key] = entry
    _cache_put_db(key, explanation, signals, model)


def _spend_today(date: str) -> float:
    try:
        with contextlib.closing(_connect()) as conn:
            row = conn.execute(
                "SELECT usd FROM flow_explain_costs WHERE date = ?", (date,)
            ).fetchone()
        return float(row[0]) if row else 0.0
    except Exception:
        return _MEM_COSTS.get(date, 0.0)


def _add_cost(date: str, usd: float) -> None:
    if usd <= 0:
        return
    try:
        with _WRITE_LOCK, contextlib.closing(_connect()) as conn:
            conn.execute(
                "INSERT INTO flow_explain_costs(date, usd) VALUES (?, ?) "
                "ON CONFLICT(date) DO UPDATE SET usd = usd + excluded.usd",
                (date, usd),
            )
            conn.commit()
    except Exception:
        with _MEM_LOCK:
            _MEM_COSTS[date] = _MEM_COSTS.get(date, 0.0) + usd


def _bump_user_count(user_id: str, date: str) -> int:
    """Increment and return the user's request count for `date`."""
    try:
        with _WRITE_LOCK, contextlib.closing(_connect()) as conn:
            conn.execute(
                "INSERT INTO flow_explain_user_requests(user_id, date, count) VALUES (?, ?, 1) "
                "ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1",
                (user_id, date),
            )
            conn.commit()
            row = conn.execute(
                "SELECT count FROM flow_explain_user_requests WHERE user_id = ? AND date = ?",
                (user_id, date),
            ).fetchone()
        return int(row[0]) if row else 1
    except Exception:
        with _MEM_LOCK:
            k = (user_id, date)
            _MEM_USER_COUNTS[k] = _MEM_USER_COUNTS.get(k, 0) + 1
            return _MEM_USER_COUNTS[k]


# ── Request / response models ────────────────────────────────────────────────

class FlowPrint(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=10)
    cp: str                      # 'C' | 'P'
    strike: float = Field(..., gt=0)
    exp: str                     # expiration as displayed (e.g. '2026-08-21')
    dte: int = Field(..., ge=0)
    premium: float = Field(..., ge=0)
    volume: int = Field(..., ge=0)
    oi: int = Field(..., ge=0)
    side: str = ""               # 'ASK' | 'BID' | 'ABOVE ASK' | 'BELOW BID' | ''
    spot: float = Field(..., gt=0)
    order_type: str = ""         # 'SWEEP' | 'BLOCK' | ...
    color: str = ""
    grade: Optional[str] = None
    tier: Optional[str] = None

    @field_validator("ticker")
    @classmethod
    def _upper_ticker(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("cp")
    @classmethod
    def _valid_cp(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in ("C", "P"):
            raise ValueError("cp must be 'C' or 'P'")
        return v


class FlowExplainResponse(BaseModel):
    explanation: str
    signals: list[str]
    cached: bool
    model: str


# ── Deterministic context builder (the facts; the model only narrates) ──────

def _vol_vs_oi(volume: int, oi: int) -> dict:
    ratio = round(volume / oi, 2) if oi > 0 else None
    if volume > oi:
        verdict = "likely OPENING position — volume exceeds existing OI"
        bucket = "opening"
    else:
        verdict = "could be opening or closing"
        bucket = "ambiguous"
    return {"ratio": ratio, "verdict": verdict, "bucket": bucket}


def _moneyness(cp: str, strike: float, spot: float) -> dict:
    # signed by cp: positive = in the money
    signed = (spot - strike) / spot if cp == "C" else (strike - spot) / spot
    distance_pct = round(abs(spot - strike) / spot * 100, 2)
    if distance_pct <= 1.0:
        label = "ATM"
    elif signed > 0:
        label = "ITM"
    else:
        label = "OTM"
    kind = "call" if cp == "C" else "put"
    if label == "ATM":
        desc = f"at-the-money {kind} (strike within 1% of spot)"
    else:
        rel = "below" if strike < spot else "above"
        desc = f"{label} {kind} — strike {distance_pct:g}% {rel} spot"
    return {"label": label, "signed_pct": round(signed * 100, 2),
            "distance_pct": distance_pct, "description": desc}


def _dte_bucket(dte: int) -> str:
    if dte <= 0:
        return "0DTE"
    if dte <= 7:
        return "weekly (<=7 DTE)"
    if dte <= 30:
        return "near-term (<=30 DTE)"
    if dte >= 180:
        return "LEAPS (>=180 DTE)"
    return "medium-term (1-6 months)"


def _premium_bucket(premium: float) -> str:
    if premium >= 1_000_000:
        return "whale-sized ($1M+ premium)"
    if premium >= 250_000:
        return "institutional-sized ($250K+ premium)"
    if premium >= 50_000:
        return "retail-plus ($50K+ premium)"
    return "small (<$50K premium)"


def _aggression(side: str) -> dict:
    s = (side or "").strip().upper()
    if s == "ABOVE ASK":
        return {"side": s, "read": "paid ABOVE the ask — extreme urgency to get filled"}
    if s == "ASK":
        return {"side": s, "read": "paid the ask — buyer-initiated, paying up with urgency"}
    if s == "BELOW BID":
        return {"side": s, "read": "hit BELOW the bid — aggressive selling, likely closing or a credit trade"}
    if s == "BID":
        return {"side": s, "read": "sold at the bid — likely sold-to-close or a credit/premium-selling trade"}
    return {"side": s or "UNKNOWN", "read": "executed mid/unknown — direction of initiation unclear"}


def _earnings_proximity(ticker: str) -> str:
    """Search the engine's earnings buckets for the ticker.

    get_earnings() is cached (30 min TTL) and warmed by several surfaces; on
    any failure we return 'unknown' — this must never block or break the
    request. (A trivial extra FMP-free path was evaluated and skipped: the
    FMP earnings helpers in this repo are year-oriented + quota'd.)
    """
    try:
        from api.services import engine as _engine
        data = _engine.get_earnings() or {}
        labels = {
            "bmo": "reports today before the open",
            "amc": "reported yesterday after the close",
            "amc_tonight": "reports tonight after the close",
        }
        for bucket, label in labels.items():
            for entry in data.get(bucket) or []:
                if not isinstance(entry, dict):
                    continue
                sym = (entry.get("sym") or entry.get("symbol") or "").upper()
                if sym == ticker:
                    return label
        return "no earnings today/yesterday detected"
    except Exception:
        return "unknown"


def get_cached_gex(ticker: str) -> Optional[dict]:
    """Cheap, cache-backed GEX read ONLY. gex_service.get_gex_data() is a
    live uncached Schwab fetch (verified 2026-07-06) — never call it here.
    A future GEX caching layer can populate ``flow_gex_state_{TICKER}`` in
    the shared TTL cache with get_gex_data()'s classification block."""
    try:
        from api.services.cache import cache as _shared_cache
        snap = _shared_cache.get(f"flow_gex_state_{ticker.upper()}")
        return snap if isinstance(snap, dict) else None
    except Exception:
        return None


def _gex_context(ticker: str) -> Optional[dict]:
    try:
        snap = get_cached_gex(ticker)
        if not snap:
            return None
        out: dict = {}
        regime = snap.get("regime")
        if regime:
            out["regime"] = regime
        levels = snap.get("levels") or {}
        for name in ("call_wall", "put_wall", "zero_gamma"):
            lvl = levels.get(name)
            if isinstance(lvl, dict) and lvl.get("strike") is not None:
                out[name] = {"strike": lvl.get("strike"), "label": lvl.get("label")}
        return out or None
    except Exception:
        return None


def build_context(p: FlowPrint) -> dict:
    """Deterministic facts about the print. Computed BEFORE the LLM."""
    ctx = {
        "contract": f"{p.ticker} {p.exp} ${p.strike:g} {'CALL' if p.cp == 'C' else 'PUT'}",
        "vol_vs_oi": _vol_vs_oi(p.volume, p.oi),
        "moneyness": _moneyness(p.cp, p.strike, p.spot),
        "dte_bucket": _dte_bucket(p.dte),
        "premium_bucket": _premium_bucket(p.premium),
        "aggression": _aggression(p.side),
        "earnings_proximity": _earnings_proximity(p.ticker),
    }
    gex = _gex_context(p.ticker)
    if gex:
        ctx["gex"] = gex
    return ctx


def _cache_key(p: FlowPrint, ctx: dict, date_et: str) -> str:
    return "|".join([
        p.ticker, p.cp, f"{p.strike:g}", p.exp,
        ctx["vol_vs_oi"]["bucket"],
        (p.side or "").strip().upper(),
        date_et,
    ])


# ── Deterministic fallback (still useful without the LLM) ───────────────────

def _signals_from_context(p: FlowPrint, ctx: dict) -> list[str]:
    voi = ctx["vol_vs_oi"]
    ratio_txt = f"{voi['ratio']:g}x OI" if voi["ratio"] is not None else "no existing OI"
    signals = [
        f"Vol/OI: {p.volume:,} vs {p.oi:,} ({ratio_txt}) — "
        + ("likely opening" if voi["bucket"] == "opening" else "opening or closing"),
        f"{ctx['moneyness']['description']}",
        f"{ctx['dte_bucket']} · {ctx['premium_bucket']}",
        f"Execution: {ctx['aggression']['read']}",
    ]
    earn = ctx.get("earnings_proximity")
    if earn and earn not in ("unknown", "no earnings today/yesterday detected"):
        signals.append(f"Earnings: {earn}")
    return signals[:4]


def _deterministic_explanation(p: FlowPrint, ctx: dict) -> str:
    kind = "calls" if p.cp == "C" else "puts"
    voi = ctx["vol_vs_oi"]
    size = ctx["premium_bucket"].split(" (")[0]
    article = "an" if size[:1].lower() in "aeiou" else "a"
    dte_short = ctx["dte_bucket"].split(" (")[0]
    sentences = [
        f"This is {article} {size} "
        f"{(p.order_type or 'print').lower()} in {p.ticker}: {p.volume:,} of the "
        f"{p.exp} ${p.strike:g} {kind} ({dte_short}) for roughly "
        f"${p.premium:,.0f} in premium.",
        f"Volume of {p.volume:,} against open interest of {p.oi:,} means it is "
        f"{voi['verdict']}.",
        f"The contract is {ctx['moneyness']['description']}, and the trade "
        f"{ctx['aggression']['read']}.",
    ]
    earn = ctx.get("earnings_proximity")
    if earn and earn not in ("unknown", "no earnings today/yesterday detected"):
        sentences.append(f"Note that {p.ticker} {earn}, which often drives short-dated positioning like this.")
    sentences.append(
        f"To confirm the read, watch tomorrow's open interest at the ${p.strike:g} strike — "
        "a jump would confirm a new position was opened; flat or lower OI suggests it was closing."
    )
    return " ".join(sentences)


# ── LLM call ─────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = (
    "You are a senior options-flow analyst at a trading desk. Your job is to "
    "explain to an intermediate retail trader, in plain English, why a specific "
    "options print matters.\n"
    "Hard rules:\n"
    "- Use ONLY the facts provided in the message. Never invent price targets, "
    "catalysts, dates, or numbers that were not given to you.\n"
    "- Never predict where the stock is going. Never say 'buy' or 'sell' or give "
    "trade advice.\n"
    "- The explanation must be 3-5 sentences, concrete and plain-spoken.\n"
    "- End the explanation with what would confirm or invalidate the read "
    "(e.g. 'watch tomorrow's open interest at this strike').\n"
    "Output format: STRICT JSON only, no prose outside it:\n"
    '{"explanation": "3-5 sentences", "signals": ["short bullet", "short bullet", "short bullet"]}\n'
    "signals must contain 3-4 short strings, each under 12 words."
)


def _anthropic():
    """Shared Anthropic client, per-request timeout override (30s bounds the
    call so it can't pin an anyio worker — the 2026-07-01 outage class)."""
    from api.services.engine import _get_anthropic_client
    return _get_anthropic_client().with_options(timeout=_LLM_TIMEOUT_SECS)


def _user_prompt(p: FlowPrint, ctx: dict) -> str:
    print_facts = {
        "ticker": p.ticker,
        "contract": ctx["contract"],
        "dte": p.dte,
        "premium_usd": p.premium,
        "volume": p.volume,
        "open_interest": p.oi,
        "side": p.side or "unknown",
        "spot": p.spot,
        "order_type": p.order_type or "unknown",
    }
    if p.grade:
        print_facts["grade"] = p.grade
    if p.tier:
        print_facts["tier"] = p.tier
    if p.color:
        print_facts["color"] = p.color
    return (
        "Explain this options-flow print.\n\n"
        f"PRINT:\n{json.dumps(print_facts, indent=2, sort_keys=True)}\n\n"
        f"COMPUTED FACTS (authoritative — narrate these):\n{json.dumps(ctx, indent=2, sort_keys=True)}"
    )


def _parse_llm_output(text: str, p: FlowPrint, ctx: dict) -> tuple[str, list[str]]:
    """Parse strict-JSON model output defensively.

    json.loads first; then a brace-substring extraction; on total failure the
    raw text becomes the explanation and signals derive from the context."""
    candidates = [text]
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start:end + 1])
    for cand in candidates:
        try:
            data = json.loads(cand)
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        explanation = str(data.get("explanation") or "").strip()
        raw_signals = data.get("signals")
        signals = [str(s).strip() for s in raw_signals if str(s).strip()] if isinstance(raw_signals, list) else []
        if explanation:
            if not signals:
                signals = _signals_from_context(p, ctx)
            return explanation, signals[:4]
    # Parse failure → raw text as explanation, deterministic signals
    return text.strip(), _signals_from_context(p, ctx)


def _call_llm(p: FlowPrint, ctx: dict) -> tuple[str, list[str], str, float]:
    """Returns (explanation, signals, model, cost_usd). May raise — caller
    catches everything and falls back deterministically."""
    model = _model_name()
    client = _anthropic()
    resp = client.messages.create(
        model=model,
        max_tokens=_MAX_TOKENS,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": _user_prompt(p, ctx)}],
    )
    text = "".join(
        getattr(block, "text", "") for block in resp.content
        if getattr(block, "type", "") == "text"
    )
    if not text.strip():
        raise ValueError("empty LLM response")
    usage = getattr(resp, "usage", None)
    in_tok = getattr(usage, "input_tokens", 0) or 0
    out_tok = getattr(usage, "output_tokens", 0) or 0
    cost = _estimate_cost_usd(model, in_tok, out_tok)
    explanation, signals = _parse_llm_output(text, p, ctx)
    return explanation, signals, model, cost


def _estimate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    price_in, price_out = _PRICING.get(model, _FALLBACK_PRICING)
    return (input_tokens / 1_000_000) * price_in + (output_tokens / 1_000_000) * price_out


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.post("", include_in_schema=False)
@router.post("/", response_model=FlowExplainResponse)
def explain_print(body: FlowPrint, user: dict = Depends(require_paid)) -> FlowExplainResponse:
    """Explain one options-flow print in plain English (paid members).

    Sync def on purpose: SQLite + the Anthropic call run on the anyio
    threadpool, never on the shared event loop."""
    date_et = _today_et()

    # 1. Per-user daily cap (counts every request, cached or not)
    count = _bump_user_count(str(user.get("id") or user.get("email") or "anon"), date_et)
    if count > _user_daily_cap():
        raise HTTPException(
            status_code=429,
            detail=f"Daily explain limit reached ({_user_daily_cap()}/day). Resets at midnight ET.",
        )

    # 2. Deterministic facts + cache lookup
    ctx = build_context(body)
    key = _cache_key(body, ctx, date_et)
    hit = _cache_get(key)
    if hit is not None:
        return FlowExplainResponse(
            explanation=hit["explanation"], signals=hit["signals"],
            cached=True, model=hit["model"],
        )

    # 3. Cost guard — over the daily cap: deterministic fallback (still useful)
    if _spend_today(date_et) >= _daily_cap_usd():
        explanation = _deterministic_explanation(body, ctx)
        signals = _signals_from_context(body, ctx)
        # Cap stays tripped for the rest of the ET day → safe to cache
        _cache_put(key, explanation, signals, _FALLBACK_MODEL_NAME)
        return FlowExplainResponse(
            explanation=explanation, signals=signals,
            cached=False, model=_FALLBACK_MODEL_NAME,
        )

    # 4. LLM — ANY failure degrades to the deterministic fallback (never 500)
    try:
        explanation, signals, model, cost = _call_llm(body, ctx)
        _add_cost(date_et, cost)
        _cache_put(key, explanation, signals, model)
        return FlowExplainResponse(
            explanation=explanation, signals=signals, cached=False, model=model,
        )
    except Exception:
        logger.warning("flow-explain LLM failed; serving deterministic fallback", exc_info=True)
        explanation = _deterministic_explanation(body, ctx)
        signals = _signals_from_context(body, ctx)
        # Deliberately NOT cached: a transient LLM error shouldn't pin the
        # fallback for the whole day — the next identical print retries.
        return FlowExplainResponse(
            explanation=explanation, signals=signals,
            cached=False, model=_FALLBACK_MODEL_NAME,
        )
