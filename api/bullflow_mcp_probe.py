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


# ── Test-create endpoint (one-off Side semantics verification) ───────────────
# Creates a single throwaway custom alert with explicit Ask-side flag, so we
# can read it back via /custom and confirm:
#   (1) Does includeAskSide=true cover both ASK and AA, or only plain ASK?
#   (2) What does Bullflow store the config as after save? (raw JSON form)
#   (3) Does it appear in /v1/streaming/alerts within seconds?
# Delete the test alert after verification via /test-delete?alert_id=...
@router.get("/test-create")
async def test_create_alert():
    """
    Create a minimal test alert: NVDA calls, $500K+, ask side, sweep only.
    Specific enough that it's unlikely to fire by accident — but loose enough
    to fire if NVDA gets real action during market hours.
    """
    test_payload = {
        "name": "UCT Test Alert — DELETE ME",
        "tickerAllowlist": ["NVDA"],
        "includeCalls": True,
        "includePuts": False,
        "includeAskSide": True,
        "includeBidSide": False,
        "includeMid": False,
        "includeSweeps": True,
        "includeBlocks": False,
        "includeSingles": False,
        "includeSplits": False,
        "includeMultiLeg": False,
        "premiumMin": 500000,
        "quickFilters": ["sw", "a", "c"],   # Sweeps + Ask + Calls labels
    }
    return await _mcp_call("tools/call", {
        "name": "bullflow_create_alert",
        "arguments": test_payload,
    })


@router.get("/test-delete")
async def test_delete_alert(alert_id: str = Query(..., description="Alert ID returned by test-create")):
    """
    Delete the test alert. The MCP server doesn't expose a delete tool by
    name in tools/list output — so this tries the most likely method names
    and reports what works. If both fail, delete via Bullflow's web UI.
    """
    for method_name in ["bullflow_delete_alert", "bullflow_remove_alert", "delete_alert"]:
        result = await _mcp_call("tools/call", {
            "name": method_name,
            "arguments": {"id": alert_id},
        })
        # If the method exists, we'll get either success or a domain error.
        # If the method doesn't exist, MCP returns a "Method not found" style error.
        text = str(result).lower()
        if "not found" not in text and "unknown tool" not in text:
            return {"tried_method": method_name, "result": result}
    return {"error": "no working delete method — remove via Bullflow UI", "tried": ["bullflow_delete_alert", "bullflow_remove_alert", "delete_alert"]}


@router.get("/test-create-2")
async def test_create_alert_2():
    """
    Second test: rely ONLY on `quickFilters` to set Ask side, omit the
    boolean side flags entirely. Read it back via /custom to see what
    Bullflow stores. This determines whether quickFilters or checkboxes
    are the canonical source of truth for Side filtering.
    """
    test_payload = {
        "name": "UCT Test 2 — quickFilters only",
        "tickerAllowlist": ["AMD"],
        "includeCalls": True,
        "includePuts": False,
        # Note: NO includeAskSide / includeBidSide / includeMid passed
        "includeSweeps": True,
        "premiumMin": 500000,
        "quickFilters": ["sw", "a", "c"],
    }
    return await _mcp_call("tools/call", {
        "name": "bullflow_create_alert",
        "arguments": test_payload,
    })


@router.get("/test-create-3")
async def test_create_alert_3():
    """
    Third test: try the apparent internal field names directly to see if
    they're accepted (i.e. can we set plain ASK via `aCheckBox` or similar).
    """
    test_payload = {
        "name": "UCT Test 3 — internal field probe",
        "tickerAllowlist": ["MU"],
        "includeCalls": True,
        "includePuts": False,
        # Probe undocumented field names that might map to plain ASK:
        "includeAsk": True,           # singular
        "aCheckBox": True,            # internal-style name
        "askCheckBox": True,          # another variant
        "includeSweeps": True,
        "premiumMin": 500000,
        "quickFilters": ["sw", "a", "c"],
    }
    return await _mcp_call("tools/call", {
        "name": "bullflow_create_alert",
        "arguments": test_payload,
    })
