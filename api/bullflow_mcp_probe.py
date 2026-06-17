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
