"""
One-off Bullflow MCP probe router.

Lets you call Bullflow's MCP server from the browser by routing the request
through the backend (avoids CORS). Used to discover the inputSchema for
bullflow_create_alert and other tools — i.e. what fields you can actually
configure when defining a custom alert.

Endpoints (all under /api/admin/bullflow):
  GET /tools       — list every MCP tool with its full inputSchema
  GET /docs        — fetch the full bullflow://api-docs YAML resource
  GET /custom      — list custom alerts you've already saved
  GET /raw?method=... — generic JSON-RPC passthrough for ad-hoc exploration

DELETE THIS FILE AND ITS REGISTRATION ONCE EXPLORATION IS COMPLETE — it's
not meant for production. No auth gating beyond the existing AuthGuard on
/admin routes (which doesn't apply at the API layer). Don't push this URL
to subscribers.
"""
import os
import httpx
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/admin/bullflow", tags=["bullflow-mcp-probe"])

BULLFLOW_API_KEY = os.getenv("BULLFLOW_API_KEY", "").strip()
MCP_URL = "https://api.bullflow.io/mcp"


async def _mcp_call(method: str, params: dict | None = None) -> dict:
    """JSON-RPC 2.0 call to Bullflow MCP. Returns parsed JSON or error dict."""
    if not BULLFLOW_API_KEY:
        return {"error": "BULLFLOW_API_KEY env var not set"}
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params or {},
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                MCP_URL,
                params={"key": BULLFLOW_API_KEY},
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                },
            )
            # MCP may return JSON directly OR an SSE-style "data: {...}" line.
            text = r.text.strip()
            if text.startswith("data: "):
                import json
                return {"http": r.status_code, "result": json.loads(text[6:])}
            try:
                return {"http": r.status_code, "result": r.json()}
            except Exception:
                # 500k cap (was 50k) — 26 UCT alerts blew past 50k and broke
                # JSON parsing in /delete-all-uct-alerts on 2026-06-17. 500k
                # safely handles ~150 alerts before risk of truncation returns.
                return {"http": r.status_code, "raw_text": text[:500000]}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:300]}"}


@router.get("/tools")
async def list_tools():
    """List every MCP tool with its full inputSchema — primary discovery endpoint."""
    return await _mcp_call("tools/list")


@router.get("/docs")
async def fetch_docs():
    """Fetch the full bullflow://api-docs YAML resource."""
    return await _mcp_call("resources/read", {"uri": "bullflow://api-docs"})


@router.get("/custom")
async def list_custom_alerts():
    """List custom alerts already saved against this API key."""
    return await _mcp_call("tools/call", {
        "name": "bullflow_get_custom_alerts",
        "arguments": {},
    })


@router.get("/raw")
async def raw_passthrough(
    method: str = Query(..., description="JSON-RPC method, e.g. tools/list or tools/call"),
    tool_name: str = Query(None, description="Tool name when method is tools/call"),
):
    """Generic passthrough for ad-hoc exploration. Use sparingly."""
    if method == "tools/call" and tool_name:
        return await _mcp_call(method, {"name": tool_name, "arguments": {}})
    return await _mcp_call(method)


# ─── REAL delete via Bullflow REST API (DELETE /v1/alerts/custom-alerts/{id}) ─
@router.get("/delete-alert")
async def delete_alert(alert_id: str = Query(..., description="Alert ID to delete")):
    """
    BROKEN: Bullflow's REST API does NOT expose DELETE on custom-alerts.
    This endpoint returns 404 for any valid alert ID. Confirmed 2026-06-16.
    Kept here for reference only. Delete alerts via Bullflow's web UI:
    Alerts panel → pencil icon → trash icon per row.
    """
    if not BULLFLOW_API_KEY:
        return {"error": "BULLFLOW_API_KEY env var not set"}
    url = f"https://api.bullflow.io/v1/alerts/custom-alerts/{alert_id}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.delete(
                url,
                headers={"X-API-Key": BULLFLOW_API_KEY},
            )
            text = r.text[:2000]
            return {"http": r.status_code, "body": text, "url": url}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:300]}"}


@router.get("/delete-all-tests")
async def delete_all_test_alerts():
    """
    BROKEN: Depends on delete_alert which hits a non-existent REST DELETE
    endpoint (Bullflow returns 404). Will list matching alerts but every
    delete attempt fails. Use Bullflow UI for cleanup instead.

    Original intent: fetch all alerts, delete any whose name starts with "UCT Test".
    """
    listed = await _mcp_call("tools/call", {"name": "bullflow_get_custom_alerts", "arguments": {}})
    # Drill into the nested structuredContent → data → alerts
    try:
        import json
        raw_text = listed.get("raw_text", "")
        if raw_text.startswith("event: message"):
            payload = json.loads(raw_text[raw_text.index("data: ") + 6:])
        else:
            payload = listed.get("result", {})
        alerts = payload.get("result", {}).get("structuredContent", {}).get("data", {}).get("alerts", [])
    except Exception as e:
        return {"error": f"failed to parse alert list: {e}", "raw": listed}

    results = []
    for a in alerts:
        if a.get("alertName", "").startswith("UCT Test"):
            del_result = await delete_alert(alert_id=a["id"])
            results.append({"id": a["id"], "name": a["alertName"], "result": del_result})
    return {"deleted_count": len(results), "results": results}


async def _list_existing_alert_names() -> set[str]:
    """
    Return set of alertName strings currently saved on Bullflow.
    Used by create_production_alerts as an idempotency guard.
    Raises on parse failure — caller treats that as "unsafe to create".
    """
    import json
    listed = await _mcp_call("tools/call", {
        "name": "bullflow_get_custom_alerts",
        "arguments": {},
    })
    raw_text = listed.get("raw_text", "")
    if raw_text.startswith("event: message"):
        payload = json.loads(raw_text[raw_text.index("data: ") + 6:])
    else:
        payload = listed.get("result", {})
    alerts = (
        payload.get("result", {})
        .get("structuredContent", {})
        .get("data", {})
        .get("alerts", [])
    )
    return {a.get("alertName", "") for a in alerts if a.get("alertName")}


# ─── PRODUCTION ALERT LADDER ─────────────────────────────────────────────────
# Run /api/admin/bullflow/create-production-alerts ONCE to create all 13.
# Each alert mirrors a tier from your OptionsFlow Watchlist autoScore logic.
#
# Common defensive defaults (because Bullflow defaults to OPEN for omitted flags):
#   - All Side/Type/Direction flags explicitly set
#   - Sweeps only (matches your buildFallback rule: "block-only = skip")
#   - Ask side only (excludes Bid+Mid)
#   - SPY/QQQ/IWM blocklisted everywhere
#   - SigScore >= 0.5 baseline (Bullflow's 0-1 scale; 0.8+ = "High Sig")
#   - Ex-dividend trades excluded
#   - DTE max 365 except LEAPS tier (allows LEAPS to flow through too)
#
# Cap bands from OptionsFlow (optionsflow_admin.jsx line 508-520):
#   Mega:      >= $500B
#   Large:     $10B - $500B
#   Mid-Small: < $10B

UNIVERSAL_BLOCKLIST = ["SPY", "QQQ", "IWM"]

def _bull_alert(name, **overrides):
    """Bull-direction template — calls, ask, sweep, bullish-inferred."""
    base = {
        "name": name,
        "tickerBlocklist": UNIVERSAL_BLOCKLIST,
        "quickFilters": ["sw", "a", "c"],
        # Direction (calls only, bullish-inferred only)
        "includeCalls": True,
        "includePuts": False,
        "includeBullish": True,
        "includeBearish": False,
        "includeNeutral": False,
        # Side (ask side only)
        "includeAskSide": True,
        "includeBidSide": False,
        "includeMid": False,
        # Type (sweep only — your buildFallback rule)
        "includeSweeps": True,
        "includeSingles": False,
        "includeSplits": False,
        "includeBlocks": False,
        "includeMultiLeg": False,
        # Misc
        "includeExDividend": False,
        # Quality floor
        "scoreMin": 0.5,
        "dteMin": 0,
        "dteMax": 365,
    }
    base.update(overrides)
    return base


def _bear_alert(name, **overrides):
    """Bear-direction template — puts, ask, sweep, bearish-inferred."""
    base = _bull_alert(name)
    base.update({
        "includeCalls": False,
        "includePuts": True,
        "includeBullish": False,
        "includeBearish": True,
        "quickFilters": ["sw", "a", "pu"],
    })
    base.update(overrides)
    return base


PRODUCTION_ALERTS = [
    # ─── Tier 1: Whale — single trade ≥ $5M (non-mega) ──────────────────────
    _bull_alert("UCT Whale Bull",
        premiumMin=5_000_000, marketCapMax=500_000_000_000),
    _bear_alert("UCT Whale Bear",
        premiumMin=5_000_000, marketCapMax=500_000_000_000),

    # ─── Tier 2: Mega Whale — single trade ≥ $10M (mega cap) ────────────────
    _bull_alert("UCT Mega Whale Bull",
        premiumMin=10_000_000, marketCapMin=500_000_000_000),
    _bear_alert("UCT Mega Whale Bear",
        premiumMin=10_000_000, marketCapMin=500_000_000_000),

    # ─── Tier 3: A — $500K-$10M (cap-agnostic) ─────────────────────────────
    # 2026-06-17: Collapsed from 3 cap-bracketed sub-tiers (Mid/Large/Mega)
    # into one cap-agnostic A-tier. Reason: diagnostic confirmed Bullflow's
    # streaming payload contains NO marketCap field (verified against a live
    # JPM alert — 18 fields, none cap-related). The min/max MarketCap params
    # we set on those alerts were silently no-ops, so every Mid/Large/Mega
    # trio fired simultaneously for the same trade (e.g. NVDA $2.10M matched
    # all three A-tier rules at 09:27:52 EDT). Frontend dedup masks the
    # symptom but the right fix is to drop the unused brackets.
    #
    # Cap-aware sub-tiering can return via Schwab enrichment on the backend
    # (Phase D), at which point we'd reinstate Mid/Large/Mega with real cap
    # filtering. Until then, premium alone defines this tier.
    _bull_alert("UCT A Bull",
        premiumMin=500_000, premiumMax=10_000_000),
    _bear_alert("UCT A Bear",
        premiumMin=500_000, premiumMax=10_000_000),

    # ─── Tier 4: Unusual — Vol > OI + repeat trades (your UOA flag) ─────────
    # Direction-agnostic (catches both calls and puts) — Vol>OI is a structural
    # signal, not directional. Premium floor $250K so it overlaps with A tiers.
    {
        "name": "UCT Unusual Activity",
        "tickerBlocklist": UNIVERSAL_BLOCKLIST,
        "quickFilters": ["sw", "a", "u", "re"],
        "includeCalls": True,
        "includePuts": True,
        "includeBullish": True,
        "includeBearish": True,
        "includeNeutral": False,
        "includeAskSide": True,
        "includeBidSide": False,
        "includeMid": False,
        "includeSweeps": True,
        "includeSingles": False,
        "includeSplits": False,
        "includeBlocks": False,
        "includeMultiLeg": False,
        "includeExDividend": False,
        "premiumMin": 250_000,
        "volumeExceedsOpenInterestByMin": 1.5,   # vol >= 1.5x OI
        "repeatTradesLast3mMin": 3,              # at least 3 repeat trades
        "scoreMin": 0.6,                          # tighter sig requirement
        "dteMin": 0,
        "dteMax": 365,
    },

    # ─── Tier 5: LEAPS — DTE > 180, lower premium floor ─────────────────────
    # LEAPS = long-dated conviction. Your autoScore gives +0.5 for DTE>180.
    # Premium floor lower ($500K) since LEAPS are inherently large per contract.
    _bull_alert("UCT LEAPS Bull",
        dteMin=181, dteMax=1095,
        premiumMin=500_000),
    _bear_alert("UCT LEAPS Bear",
        dteMin=181, dteMax=1095,
        premiumMin=500_000),
]


@router.get("/create-production-alerts")
async def create_production_alerts():
    """
    Create all 13 UCT production custom alerts on Bullflow.

    IDEMPOTENT: lists existing alerts first, skips any whose name already
    exists. Safe to hit repeatedly — re-running after a partial create
    just fills in what's missing. Safe to hit twice in a row — second
    call returns skipped_count=13, created_count=0.

    The 2026-06-17 incident (count=26, every alert duplicated) happened
    because this endpoint was hit twice without the guard. Don't remove
    the guard. If the guard somehow fails (list call errors), the function
    refuses to create rather than risk doubling.
    """
    # Idempotency guard: never create an alert whose name already exists.
    try:
        existing_names = await _list_existing_alert_names()
    except Exception as e:
        return {
            "error": (
                "Could not verify existing alerts; refusing to create to "
                "avoid duplicates. Check /custom manually before retrying."
            ),
            "detail": f"{type(e).__name__}: {str(e)[:300]}",
        }

    import json
    created, skipped, failed = [], [], []

    for alert_def in PRODUCTION_ALERTS:
        name = alert_def["name"]
        if name in existing_names:
            skipped.append(name)
            continue

        result = await _mcp_call("tools/call", {
            "name": "bullflow_create_alert",
            "arguments": alert_def,
        })

        # Extract status + new id from the noisy MCP envelope
        status = "?"
        new_id = "?"
        raw = result.get("raw_text", "")
        try:
            if raw.startswith("event: message"):
                payload = json.loads(raw[raw.index("data: ") + 6:])
                data = (
                    payload.get("result", {})
                    .get("structuredContent", {})
                    .get("data", {})
                )
                status = data.get("status", "?")
                new_id = data.get("id", "?")
        except Exception as e:
            failed.append({"name": name, "error": f"parse: {e}"})
            continue

        if new_id == "?":
            failed.append({"name": name, "raw_status": status, "raw": result})
        else:
            created.append({"name": name, "id": new_id, "status": status})
            existing_names.add(name)  # protect against dupes WITHIN this run too

    return {
        "created_count": len(created),
        "skipped_count": len(skipped),
        "failed_count": len(failed),
        "created": created,
        "skipped": skipped,
        "failed": failed,
    }


@router.get("/delete-all-uct-alerts")
async def delete_all_uct_alerts():
    """
    BROKEN: Depends on delete_alert which hits a non-existent REST DELETE
    endpoint (Bullflow returns 404). Will list matching alerts but every
    delete attempt fails. Use Bullflow UI to wipe alerts instead, then
    re-run /create-production-alerts (which is now idempotent).

    Original intent: fetch all alerts, delete any whose name starts with "UCT ".
    """
    listed = await _mcp_call("tools/call", {"name": "bullflow_get_custom_alerts", "arguments": {}})
    try:
        import json
        raw_text = listed.get("raw_text", "")
        if raw_text.startswith("event: message"):
            payload = json.loads(raw_text[raw_text.index("data: ") + 6:])
        else:
            payload = listed.get("result", {})
        alerts = payload.get("result", {}).get("structuredContent", {}).get("data", {}).get("alerts", [])
    except Exception as e:
        return {"error": f"failed to parse alert list: {e}", "raw": listed}

    results = []
    for a in alerts:
        if a.get("alertName", "").startswith("UCT "):
            del_result = await delete_alert(alert_id=a["id"])
            results.append({"id": a["id"], "name": a["alertName"], "result": del_result})
    return {"deleted_count": len(results), "results": results}


# ─── BACKTEST ─────────────────────────────────────────────────────────────────
# Replay a historical trading day using saved custom alerts. Returns alerts
# normalized into approximately /api/live/alerts/recent shape so the existing
# LiveFlow UI can render them.
#
# Caveats:
#   - Bullflow MCP `bullflow_backtesting_replay_sample` caps at 100 alerts.
#     Active days may have more. Surface this in the UI as a banner.
#   - Conviction scoring is NOT applied here — that's Phase C. Frontend will
#     show "—" for missing convictionScore.
#   - Discord forwarding does NOT fire (backtest is dry-run by definition).

import re
from datetime import datetime, timezone

# OCC symbol parser — duplicated from liveflow_worker.py to keep the probe
# self-contained. Bullflow's backtest replay returns the OCC symbol verbatim
# (e.g. "O:AAPL260618C00297500") and the frontend needs it split into
# ticker/cp/strike/exp/dte to route into the right tier section.
_OCC_RE = re.compile(r"^O:([A-Z0-9]+?)(\d{6})([CP])(\d{8})$")


def _parse_occ(symbol: str) -> dict:
    empty = {"ticker": None, "exp": None, "cp": None, "strike": None, "dte": None}
    if not symbol or not symbol.startswith("O:"):
        return empty
    m = _OCC_RE.match(symbol)
    if not m:
        return empty
    ticker, yymmdd, cp, strike_str = m.groups()
    try:
        year = 2000 + int(yymmdd[:2])
        exp_date = datetime(year, int(yymmdd[2:4]), int(yymmdd[4:6])).date()
    except ValueError:
        return {**empty, "ticker": ticker, "cp": cp}
    strike = int(strike_str) / 1000.0
    today = datetime.now(timezone.utc).date()
    dte = (exp_date - today).days
    return {
        "ticker": ticker,
        "exp": exp_date.strftime("%Y-%m-%d"),
        "cp": cp,
        "strike": strike,
        "dte": dte,
    }


def _normalize_backtest_alert(raw: dict) -> dict:
    """
    Map a raw Bullflow backtest alert payload to the shape LiveFlow.jsx expects.

    Bullflow's backtest replay returns the same payload shape as the live
    SSE stream: the OCC symbol is in the `symbol` (or sometimes `ticker`)
    field as the full identifier (e.g. "O:AAPL260618C00297500"). We parse
    that into ticker/cp/strike/exp/dte so the frontend's tier router can
    route by cp and the table can render the contract details.

    2026-06-17 fix: previous version put the raw OCC symbol directly into
    the `ticker` field, leaving cp/strike/exp/dte as null. That broke
    tier routing entirely — every backtest row landed in the Algo fallback.
    """
    # Bullflow uses `symbol` in the live stream but `ticker` carries the OCC
    # symbol in the backtest replay (confirmed via diagnostic on 2026-06-17:
    # `ticker: "O:AAPL260618C00297500"`).
    raw_symbol = raw.get("symbol") or raw.get("ticker") or ""
    occ = _parse_occ(raw_symbol)

    return {
        "id": raw.get("id") or raw.get("alertId") or f"{occ['ticker']}:{raw.get('timestamp', '')}",
        "symbol": raw_symbol,  # preserve full OCC for the frontend's _matchedNames keying
        "ticker": occ["ticker"],
        "timestamp": raw.get("timestamp") or raw.get("receivedAt"),
        "alertName": (raw.get("alertName") or "").strip() or None,  # strip trailing whitespace seen in Bullflow data
        "alertType": raw.get("alertType"),
        "alertPremium": raw.get("alertPremium"),
        "averageFillPrice": raw.get("averageFillPrice"),
        # Contract details from OCC parse (Bullflow's payload doesn't carry
        # these as discrete fields — they're all encoded in the symbol).
        "cp": occ["cp"],
        "strike": occ["strike"],
        "exp": occ["exp"],
        "dte": occ["dte"],
        # Backend-added fields not present in backtest data
        "convictionScore": None,
        "forwardedToDiscord": False,
        # Preserve raw for debugging if normalization fails
        "_raw": raw,
    }


@router.get("/backtest")
async def backtest_replay(
    date: str = Query(..., description="Replay date in YYYY-MM-DD format"),
    max_alerts: int = Query(300, ge=1, le=500,
        description="Max alerts to request from Bullflow before filtering. "
                    "Default 300 so that after worker-side filtering (mega-caps, "
                    "user blocklist, premium floor) the visible list stays ~100+. "
                    "Bullflow's MCP may enforce its own server-side cap regardless."),
    speed: float = Query(300, gt=0, le=1000,
        description="Replay speed multiplier (higher = faster sample)"),
    timeout_seconds: int = Query(120, ge=5, le=120,
        description="Max seconds to wait for the sample"),
    simulate: str = Query("off",
        description="Simulation mode. 'off' = raw filtered alerts only (default, "
                    "backward compat). 'full' = also run alerts through the live "
                    "worker's pipeline (OI lookup, Schwab spot moneyness, "
                    "aggregation, conviction grading) and return what would have "
                    "posted to Discord vs been gated. Use this to test threshold "
                    "tuning against historical data."),
    min_grade: str = Query("B",
        description="Conviction threshold for the simulation gate when "
                    "simulate=full. One of: A+, A, B, C, D. D effectively "
                    "disables the gate (everything posts). Default B matches "
                    "the live worker's default."),
    exclude_etf_flow: bool = Query(False,
        description="When simulate=full, exclude UCT ETF Flow alerts from the "
                    "simulation. Useful for evaluating single-name flow in "
                    "isolation since ETF Flow tends to dominate volume but "
                    "lives better in its own Discord channel."),
):
    """
    Run Bullflow's backtest replay for `date` against saved custom alerts.

    Returns alerts in the same shape LiveFlow.jsx renders. Backtest is dry-run:
    no Discord forwarding, no buffer mutation, no side effects.
    """
    result = await _mcp_call("tools/call", {
        "name": "bullflow_backtesting_replay_sample",
        "arguments": {
            "date": date,
            "max_alerts": max_alerts,
            "speed": speed,
            "timeout_seconds": timeout_seconds,
        },
    })

    # Parse the MCP SSE envelope
    import json
    raw_text = result.get("raw_text", "")
    try:
        if raw_text.startswith("event: message"):
            payload = json.loads(raw_text[raw_text.index("data: ") + 6:])
        elif result.get("result"):
            payload = {"result": result["result"]}
        else:
            return {
                "error": "Empty/unexpected MCP response",
                "raw": result,
                "date": date,
            }

        # Bullflow MCP wraps the actual data in result.structuredContent.data
        structured = (
            payload.get("result", {})
            .get("structuredContent", {})
        )
        # The exact key isn't documented — try common shapes
        data = structured.get("data") or structured
        raw_alerts = (
            data.get("alerts")
            or data.get("samples")
            or data.get("events")
            or []
        )
    except Exception as e:
        return {
            "error": f"failed to parse backtest response: {type(e).__name__}: {e}",
            "raw_excerpt": raw_text[:1500],
            "date": date,
        }

    # Filter to actual alert events. Bullflow's backtesting replay (same as
    # live SSE) emits init + heartbeat events alongside the real alerts.
    # Those have `event: "init"` or `event: "heartbeat"` and no useful data.
    # 2026-06-17: discovered when backtest UI showed a phantom "Algo 1" row
    # with all fields null — that was the init event being normalized.
    real_alerts = [
        a for a in raw_alerts
        if isinstance(a, dict) and a.get("event") == "alert"
    ]

    # Bullflow nests the actual alert payload inside `data` (matching live SSE
    # shape: {event: "alert", id: ..., data: {...real fields...}}). Unwrap if
    # present so the normalizer sees the inner fields directly.
    unwrapped = []
    for a in real_alerts:
        inner = a.get("data") if isinstance(a.get("data"), dict) else None
        if inner:
            merged = {**inner, "id": a.get("id"), "_envelope": True}
            unwrapped.append(merged)
        else:
            unwrapped.append(a)

    # Normalize each alert into the shape the frontend expects.
    normalized_all = [_normalize_backtest_alert(a) for a in unwrapped]

    # Apply the SAME table filter used in live mode so backtest mirrors live
    # exactly. Import here (not at module top) to avoid circular import: the
    # liveflow_worker imports nothing from this probe, but defensive locality
    # keeps the dependency direction obvious.
    # 2026-06-17: added so backtest excludes mega-caps on Unusual/Vol>OI, drops
    # sub-$250K trades, blocks SPY/QQQ/IWM globally — same conviction lens the
    # subscriber sees on live flow.
    from api.liveflow_worker import _passes_table_filter

    normalized = []
    dropped_by_filter = 0
    for a in normalized_all:
        passes, _reason = _passes_table_filter(
            a.get("alertName"), a.get("alertPremium"), a.get("ticker"),
        )
        if passes:
            normalized.append(a)
        else:
            dropped_by_filter += 1

    # Sort newest-first so the LiveFlow UI's "most recent at top" expectation holds.
    normalized.sort(key=lambda a: str(a.get("timestamp") or ""), reverse=True)

    # If the caller asked for full pipeline simulation, run it against the
    # filtered alerts. This applies enrichment (OI + moneyness) and the same
    # conviction gate that the live worker uses, returning what would have
    # posted to Discord vs been silenced. Computed pre-status so we can echo
    # post counts into the status block for the frontend to display.
    simulation_result = None
    if simulate.lower() == "full":
        # Optionally exclude ETF Flow before simulating (single-name lens)
        if exclude_etf_flow:
            sim_input = [a for a in normalized
                         if "ETF Flow" not in (a.get("alertName") or "")]
        else:
            sim_input = normalized
        try:
            simulation_result = await _simulate_pipeline(sim_input, min_grade=min_grade)
        except Exception as e:
            # Don't let a simulator bug break the regular backtest response —
            # surface the error in the response but keep the raw alerts visible.
            simulation_result = {
                "error": f"{type(e).__name__}: {str(e)[:300]}",
            }

    # Build a status block matching /api/live/alerts/recent's shape so the
    # frontend StatusPill/counter code doesn't need to branch.
    status = {
        "connected": True,  # backtest is inherently "connected" for the duration of the sample
        "last_event_at": normalized[0]["timestamp"] if normalized else None,
        "total_alerts_received": len(real_alerts),  # only count real alert events, not init/heartbeat
        "total_alerts_shown": len(normalized),
        # Combined drop count: init/heartbeat sentinels + alerts that failed
        # table filter (premium floor, ticker blocklist, per-alert mega-cap
        # exclusion). Frontend treats this as a single "dropped" stat.
        "total_alerts_dropped": (len(raw_alerts) - len(real_alerts)) + dropped_by_filter,
        "total_alerts_forwarded": 0,  # dry-run — backtest never posts to Discord
        "last_error": None,
        "reconnect_count": 0,
        "started_at": None,
        "mode": "backtest",
        "backtest_date": date,
        # Capping check uses pre-filter count: if Bullflow returned 100 alerts
        # but our filter trimmed to 60, the day still had MORE than 100 raw
        # alerts. Marker stays accurate to the source-side cap.
        "backtest_capped": len(real_alerts) >= max_alerts,
    }

    return {
        "mode": "backtest",
        "date": date,
        "alerts": normalized,
        "status": status,
        "max_alerts": max_alerts,
        "speed": speed,
        "capped": len(real_alerts) >= max_alerts,
        "simulation": simulation_result,
    }


# ─── Full-pipeline simulator ─────────────────────────────────────────────────
#
# The endpoint above shows raw filtered alerts — useful but misses what the
# LIVE worker actually does: enrichment, aggregation, conviction grading, and
# the conviction gate that decides what reaches Discord. This simulator runs
# alerts through the SAME logic the live worker uses, so we can ask "what would
# Discord have looked like on date X if we applied threshold Y today?"
#
# Three enrichment phases mirror the worker exactly:
#   1) OI snapshot lookup (sync SQLite) — for the OI BREAK signal.
#   2) Schwab spot price (async, batched, cached per-ticker) — for moneyness.
#   3) Aggregate replay — same _update_aggregate logic used in live, but with
#      a private aggregates dict so we don't touch the real worker state.
#
# Then the gate is applied: for each alert in time order, decide whether it
# would have POSTED (first fire above threshold), EDITED (subsequent fire of
# an already-posted contract), or been GATED (below threshold, no existing
# post). The categorized output lets the admin UI show side-by-side what
# would and would not have made it through.

async def _simulate_pipeline(alerts: list, min_grade: str = "B") -> dict:
    """
    Replay a list of normalized alerts through the live worker's pipeline:
    enrichment → aggregation → conviction → gate.

    Returns a dict with:
      would_post:  alerts that would have triggered a fresh Discord post
      would_edit:  alerts that would have updated an existing Discord post
      gated:       alerts silenced by the conviction gate
      grade_distribution: counts by letter grade
      stats:       summary numbers (totals, reduction vs raw)

    Pure simulation — does NOT post anything, does NOT mutate live aggregates.
    Safe to call repeatedly with different thresholds.
    """
    # Import inside function so this module doesn't fail to load if the
    # worker has a transient issue (defensive — the probe is also used to
    # create production alerts and shouldn't be coupled to worker health).
    from api.liveflow_worker import (
        _lookup_prior_oi,
        _get_cached_spot,
        _calc_moneyness,
        _alert_priority,
        _compute_conviction,
        _grade_level,
    )

    if not alerts:
        return {
            "would_post": [], "would_edit": [], "gated": [],
            "grade_distribution": {},
            "stats": {
                "total_alerts": 0, "posts": 0, "edits": 0, "gated_count": 0,
                "discord_actions": 0, "reduction_vs_raw_pct": 0,
                "min_grade": min_grade,
            },
        }

    min_level = _grade_level(min_grade)

    # Sort by timestamp ascending so aggregation replays in correct order.
    # Some timestamps may be None (init/heartbeat sentinels already filtered
    # out, but defensive sort handles edge cases gracefully).
    sorted_alerts = sorted(alerts, key=lambda a: str(a.get("timestamp") or ""))

    # Phase 1: OI snapshot enrichment (sync, fast). Add priorOI, volumeOIRatio,
    # oiExceeded fields to each alert in place so aggregation sees them.
    for a in sorted_alerts:
        premium = float(a.get("alertPremium") or 0)
        fill = float(a.get("averageFillPrice") or 0)
        trade_size = round(premium / (fill * 100)) if fill > 0 else None
        a["tradeSize"] = trade_size
        snap = _lookup_prior_oi(
            a.get("ticker"), a.get("cp"),
            a.get("strike"), a.get("exp"),
        )
        if snap and trade_size and snap[0] > 0:
            oi, snap_date = snap
            ratio = round(trade_size / oi, 2)
            a["priorOI"] = oi
            a["oiSnapshotDate"] = snap_date
            a["volumeOIRatio"] = ratio
            a["oiExceeded"] = ratio > 1.0
        else:
            a["priorOI"] = snap[0] if snap else None
            a["volumeOIRatio"] = None
            a["oiExceeded"] = False

    # Phase 2: Moneyness enrichment (async, expensive but cached per-ticker).
    # Use existing _get_cached_spot which already has 2-min TTL. Concurrent
    # lookups via asyncio.gather over UNIQUE tickers minimize Schwab API hits.
    import asyncio
    unique_tickers = list({
        a.get("ticker") for a in sorted_alerts
        if a.get("ticker") and not a["ticker"].startswith("$") and "." not in a["ticker"]
    })
    spot_results = await asyncio.gather(
        *(_get_cached_spot(t) for t in unique_tickers),
        return_exceptions=True,
    )
    spot_map = {}
    for ticker, result in zip(unique_tickers, spot_results):
        if isinstance(result, (int, float)) and result:
            spot_map[ticker] = float(result)

    for a in sorted_alerts:
        spot = spot_map.get(a.get("ticker"))
        if spot:
            a["spot"] = round(spot, 2)
            pct, label = _calc_moneyness(spot, a.get("strike"), a.get("cp"))
            a["moneynessPct"] = round(pct, 1) if pct is not None else None
            a["moneynessLabel"] = label
        else:
            a["spot"] = None
            a["moneynessPct"] = None
            a["moneynessLabel"] = None

    # Phase 3: Aggregate replay + gate. Mirrors _update_aggregate in worker
    # but uses a LOCAL aggregates dict so we don't touch live state.
    aggregates: dict = {}
    posted_contracts = set()  # contracts with a simulated Discord post

    would_post = []
    would_edit = []
    gated = []
    grade_dist = {"A+": 0, "A": 0, "B": 0, "C": 0, "D": 0}

    for a in sorted_alerts:
        ticker = a.get("ticker") or ""
        cp = a.get("cp") or ""
        strike = a.get("strike")
        exp = a.get("exp") or ""
        key = (ticker, cp, strike, exp)

        # Update / create aggregate in local dict
        premium = float(a.get("alertPremium") or 0)
        size = a.get("tradeSize") or 0
        name = a.get("alertName") or ""
        priority = _alert_priority(a)
        if key not in aggregates:
            aggregates[key] = {
                "ticker": ticker, "cp": cp, "strike": strike, "exp": exp,
                "total_premium": premium,
                "max_premium": premium,
                "total_size": size,
                "max_size": size,
                "fire_count": 1,
                "best_alert_name": name,
                "best_alert_priority": priority,
                "alert_names_seen": {name} if name else set(),
                "first_fire_ts": a.get("timestamp"),
                "last_fire_ts": a.get("timestamp"),
                "prior_oi": a.get("priorOI"),
                "spot": a.get("spot"),
                "moneyness_pct": a.get("moneynessPct"),
                "moneyness_label": a.get("moneynessLabel"),
            }
        else:
            agg = aggregates[key]
            agg["total_premium"] += premium
            agg["max_premium"] = max(agg["max_premium"], premium)
            agg["total_size"] = (agg["total_size"] or 0) + size
            agg["max_size"] = max(agg["max_size"] or 0, size)
            agg["fire_count"] += 1
            agg["last_fire_ts"] = a.get("timestamp")
            if name:
                agg["alert_names_seen"].add(name)
            if priority < agg["best_alert_priority"]:
                agg["best_alert_name"] = name
                agg["best_alert_priority"] = priority
            if agg["prior_oi"] is None and a.get("priorOI") is not None:
                agg["prior_oi"] = a.get("priorOI")
            if a.get("spot") is not None:
                agg["spot"] = a.get("spot")
                agg["moneyness_pct"] = a.get("moneynessPct")
                agg["moneyness_label"] = a.get("moneynessLabel")

        agg = aggregates[key]
        score, grade = _compute_conviction(agg)

        # Categorize: post (new + above threshold), edit (already posted),
        # gate (new + below threshold).
        snapshot = {
            **{k: a.get(k) for k in (
                "id", "alertName", "alertType", "alertPremium", "ticker",
                "cp", "strike", "exp", "dte", "timestamp",
            )},
            "agg_total_premium": agg["total_premium"],
            "agg_fire_count": agg["fire_count"],
            "agg_total_size": agg["total_size"],
            "conviction_score": score,
            "conviction_grade": grade,
            "spot": agg.get("spot"),
            "moneynessLabel": agg.get("moneyness_label"),
            "priorOI": agg.get("prior_oi"),
            "oiExceeded": a.get("oiExceeded"),
        }

        if key in posted_contracts:
            would_edit.append(snapshot)
        elif _grade_level(grade) >= min_level:
            posted_contracts.add(key)
            would_post.append(snapshot)
            grade_dist[grade] = grade_dist.get(grade, 0) + 1
        else:
            gated.append(snapshot)
            # Count gated grades too so user sees the full distribution
            grade_dist[grade] = grade_dist.get(grade, 0) + 1

    total = len(sorted_alerts)
    posts = len(would_post)
    edits = len(would_edit)
    gated_count = len(gated)
    discord_actions = posts + edits
    reduction = (1 - discord_actions / total) * 100 if total > 0 else 0

    return {
        "would_post": would_post,
        "would_edit": would_edit,
        "gated": gated,
        "grade_distribution": grade_dist,
        "stats": {
            "total_alerts": total,
            "posts": posts,
            "edits": edits,
            "gated_count": gated_count,
            "discord_actions": discord_actions,
            "reduction_vs_raw_pct": round(reduction, 1),
            "unique_contracts_posted": len(posted_contracts),
            "min_grade": min_grade,
        },
    }
