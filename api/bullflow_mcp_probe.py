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

def _normalize_backtest_alert(raw: dict) -> dict:
    """
    Map a raw Bullflow backtest alert payload to the shape LiveFlow.jsx expects.

    Bullflow streaming alerts carry only ~7 fields (symbol, alertName,
    alertPremium, averageFillPrice, timestamp, alertType, latency etc.).
    Contract details (cp, strike, exp, dte) are not in the streaming payload
    per our 2026-06-16 session findings — they'd require a separate
    contract-detail call. For now, we surface what we have and let the
    frontend render "—" for missing fields.
    """
    # Map symbol -> ticker (frontend uses 'ticker')
    ticker = raw.get("ticker") or raw.get("symbol")
    return {
        "id": raw.get("id") or raw.get("alertId") or f"{ticker}:{raw.get('timestamp', '')}",
        "ticker": ticker,
        "timestamp": raw.get("timestamp") or raw.get("receivedAt"),
        "alertName": raw.get("alertName"),
        "alertType": raw.get("alertType"),
        "alertPremium": raw.get("alertPremium"),
        "averageFillPrice": raw.get("averageFillPrice"),
        # Contract details — pass through if Bullflow includes them, else null
        "cp": raw.get("cp") or raw.get("type"),
        "strike": raw.get("strike"),
        "exp": raw.get("exp") or raw.get("expiry"),
        "dte": raw.get("dte"),
        # Backend-added fields not present in backtest data
        "convictionScore": None,
        "forwardedToDiscord": False,
        # Preserve raw for debugging if normalization fails
        "_raw": raw,
    }


@router.get("/backtest")
async def backtest_replay(
    date: str = Query(..., description="Replay date in YYYY-MM-DD format"),
    max_alerts: int = Query(100, ge=1, le=100,
        description="Max alerts to return (Bullflow MCP hard cap = 100)"),
    speed: float = Query(300, gt=0, le=1000,
        description="Replay speed multiplier (higher = faster sample)"),
    timeout_seconds: int = Query(120, ge=5, le=120,
        description="Max seconds to wait for the sample"),
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
    # Sort newest-first so the LiveFlow UI's "most recent at top" expectation holds.
    normalized = [_normalize_backtest_alert(a) for a in unwrapped]
    normalized.sort(key=lambda a: str(a.get("timestamp") or ""), reverse=True)

    # Build a status block matching /api/live/alerts/recent's shape so the
    # frontend StatusPill/counter code doesn't need to branch.
    status = {
        "connected": True,  # backtest is inherently "connected" for the duration of the sample
        "last_event_at": normalized[0]["timestamp"] if normalized else None,
        "total_alerts_received": len(real_alerts),  # only count real alert events, not init/heartbeat
        "total_alerts_shown": len(normalized),
        "total_alerts_dropped": len(raw_alerts) - len(real_alerts),  # init + heartbeat counted as dropped
        "total_alerts_forwarded": 0,  # dry-run — backtest never posts to Discord
        "last_error": None,
        "reconnect_count": 0,
        "started_at": None,
        "mode": "backtest",
        "backtest_date": date,
        "backtest_capped": len(normalized) >= max_alerts,
    }

    return {
        "mode": "backtest",
        "date": date,
        "alerts": normalized,
        "status": status,
        "max_alerts": max_alerts,
        "speed": speed,
        "capped": len(normalized) >= max_alerts,
    }
