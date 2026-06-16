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
                return {"http": r.status_code, "raw_text": text[:5000]}
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
