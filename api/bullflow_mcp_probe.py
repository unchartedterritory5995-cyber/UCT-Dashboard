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
                return {"http": r.status_code, "raw_text": text[:50000]}
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
    Delete a custom alert directly via REST. MCP didn't expose a delete tool,
    but the REST API likely supports DELETE on the same path as GET.
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
    Convenience: fetch all alerts, delete any whose name starts with "UCT Test".
    Use to clean up after probe experiments.
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

    # ─── Tier 3: A Mid-Small — $500K-$5M non-mega ───────────────────────────
    _bull_alert("UCT A Bull Mid",
        premiumMin=500_000, premiumMax=5_000_000,
        marketCapMax=10_000_000_000),
    _bear_alert("UCT A Bear Mid",
        premiumMin=500_000, premiumMax=5_000_000,
        marketCapMax=10_000_000_000),

    # ─── Tier 4: A Large — $750K-$5M ($10B-$500B mktcap) ────────────────────
    _bull_alert("UCT A Bull Large",
        premiumMin=750_000, premiumMax=5_000_000,
        marketCapMin=10_000_000_000, marketCapMax=500_000_000_000),
    _bear_alert("UCT A Bear Large",
        premiumMin=750_000, premiumMax=5_000_000,
        marketCapMin=10_000_000_000, marketCapMax=500_000_000_000),

    # ─── Tier 5: A Mega — $1M-$10M (mega cap) ───────────────────────────────
    _bull_alert("UCT A Bull Mega",
        premiumMin=1_000_000, premiumMax=10_000_000,
        marketCapMin=500_000_000_000),
    _bear_alert("UCT A Bear Mega",
        premiumMin=1_000_000, premiumMax=10_000_000,
        marketCapMin=500_000_000_000),

    # ─── Tier 6: Unusual — Vol > OI + repeat trades (your UOA flag) ─────────
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

    # ─── Tier 7: LEAPS — DTE > 180, lower premium floor ─────────────────────
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
    Creates all 13 UCT production custom alerts on Bullflow. Idempotent
    by name — does NOT delete existing UCT alerts before creating, so
    running twice will create duplicates. Run /delete-all-uct-alerts
    first if you want a clean slate.
    """
    results = []
    for alert_def in PRODUCTION_ALERTS:
        result = await _mcp_call("tools/call", {
            "name": "bullflow_create_alert",
            "arguments": alert_def,
        })
        # Try to extract just the success fact from the noisy MCP response
        import json
        raw = result.get("raw_text", "")
        status = "?"
        new_id = "?"
        try:
            if raw.startswith("event: message"):
                payload = json.loads(raw[raw.index("data: ") + 6:])
                data = payload.get("result", {}).get("structuredContent", {}).get("data", {})
                status = data.get("status", "?")
                new_id = data.get("id", "?")
        except Exception:
            pass
        results.append({"name": alert_def["name"], "status": status, "id": new_id})
    return {"created_count": len(results), "results": results}


@router.get("/delete-all-uct-alerts")
async def delete_all_uct_alerts():
    """
    Convenience: fetch all alerts, delete any whose name starts with "UCT ".
    Use to wipe and recreate the ladder.
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
