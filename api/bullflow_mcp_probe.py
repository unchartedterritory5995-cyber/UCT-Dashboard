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
from fastapi import APIRouter, Query, UploadFile, File
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
    #
    # Critical: this also mirrors the live worker's DEDUP behavior. When the
    # same trade gets caught by 2-3 overlapping UCT alert tiers (e.g. Alpha
    # Gold + Leaps + Bearish Leaps all matching the same INTC LEAPS put),
    # Bullflow sends N webhook events for ONE trade. Without dedup, the
    # simulator would count that trade N times — inflating premium, fire
    # count, and conviction grade.
    #
    # Dedup logic: alerts with identical (ticker, cp, strike, exp, premium)
    # within DEDUP_WINDOW_SEC are the same trade. The first occurrence is
    # counted; subsequent duplicates still register their alert tier (so
    # multi-alert confluence credit is preserved) but don't re-add premium
    # or increment fire count.
    DEDUP_WINDOW_SEC = 60
    _trade_seen: dict = {}  # (ticker,cp,strike,exp,premium) → first_seen_unix_ts
    aggregates: dict = {}
    posted_contracts = set()  # contracts with a simulated Discord post

    would_post = []
    would_edit = []
    gated = []
    dedup_skipped = 0    # phantom duplicates dropped — for transparency in stats
    grade_dist = {"A+": 0, "A": 0, "B": 0, "C": 0, "D": 0}

    def _parse_ts(ts_str):
        """Parse ISO timestamp to UNIX seconds. Returns 0 on failure."""
        if not ts_str:
            return 0
        try:
            from datetime import datetime as _dt
            return _dt.fromisoformat(str(ts_str).replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0

    for a in sorted_alerts:
        ticker = a.get("ticker") or ""
        cp = a.get("cp") or ""
        strike = a.get("strike")
        exp = a.get("exp") or ""
        key = (ticker, cp, strike, exp)

        premium = float(a.get("alertPremium") or 0)
        size = a.get("tradeSize") or 0
        name = a.get("alertName") or ""
        priority = _alert_priority(a)

        # DEDUP CHECK: same trade caught by multiple alert tiers within 60s
        # window. Only the first occurrence contributes premium/size/fire_count.
        # Subsequent duplicates still credit their alert_names_seen so multi-
        # alert confluence ("3 tiers caught this") shows up in conviction.
        trade_key = (ticker, cp, strike, exp, round(premium, 2))
        this_ts = _parse_ts(a.get("timestamp"))
        first_seen = _trade_seen.get(trade_key)
        is_duplicate = (
            first_seen is not None
            and this_ts > 0
            and (this_ts - first_seen) <= DEDUP_WINDOW_SEC
        )

        if is_duplicate:
            # Duplicate: don't add premium/size/fires. But credit the alert
            # tier and promote best_alert if higher priority — these signals
            # are still meaningful (multi-tier match = stronger confluence).
            dedup_skipped += 1
            if key in aggregates:
                agg = aggregates[key]
                if name:
                    agg["alert_names_seen"].add(name)
                if priority < agg["best_alert_priority"]:
                    agg["best_alert_name"] = name
                    agg["best_alert_priority"] = priority
            # Skip categorization — duplicates don't generate post/edit/gate
            # events. The contract's already in one of those buckets from
            # its first occurrence.
            continue

        # First occurrence of this trade: record in dedup cache and proceed
        _trade_seen[trade_key] = this_ts

        # Update / create aggregate in local dict
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
            "dedup_skipped": dedup_skipped,  # phantom duplicates filtered
            "min_grade": min_grade,
        },
    }


# ─── JSON-sourced backtest (Discord export → simulator) ────────────────────────
#
# Bullflow's MCP replay API has been silently returning empty results for recent
# dates (no error, just zero alerts) — a reliability problem we don't control.
# Fortunately, every alert that posted to Discord is captured in DiscordChatExporter
# JSON exports, with full embed structure intact. This endpoint accepts that JSON
# directly and runs it through the same simulation pipeline.
#
# Workflow for the user:
#   1. Export the #uct-live-flow channel via DiscordChatExporter (JSON format)
#   2. Upload the file via /api/admin/bullflow/backtest-from-json
#   3. Get the same simulation block as the MCP backtest endpoint
#
# This is reliable because Discord stores embeds durably — neither Bullflow gaps
# nor worker restarts can affect what's already been posted.
#
# Caveat: only contains alerts that PASSED the live gate. To get a complete
# historical picture, run with MIN_DISCORD_GRADE=D in production for a few days
# (everything posts), export, then experiment with tighter thresholds offline.

_BOT_NAMES = {"UCTOptionsAlert", "UCT Options Alert"}


def _parse_discord_embed_alert(embed: dict, message_ts: str) -> dict | None:
    """
    Reconstruct an alert payload from a Discord embed posted by the live worker.
    Returns None if the embed doesn't match the expected UCT alert shape (e.g.
    Watchlist summaries, test posts, malformed embeds).

    The output shape matches what _simulate_pipeline expects: ticker, cp, strike,
    exp, alertPremium, alertName, alertType, averageFillPrice, timestamp.
    """
    title = (embed.get("title") or "").strip()
    if not title or "TEST" in title:
        return None

    # Strip legacy "🚨 LIVE · " prefix; current format omits it.
    title = title.replace("\U0001f6a8 LIVE · ", "").replace("\U0001f6a8 LIVE ", "").strip()

    # Current format: "TICKER $STRIKE CALL/PUT EXP: MM-DD-YYYY (X% LABEL)"
    # Older format:   "TICKER C/P $STRIKE YYYY-MM-DD ..."
    parsed = None
    m = re.match(r"^([A-Z0-9$.]+)\s+\$([\d.]+)\s+(CALL|PUT)\s+EXP:\s+(\S+)", title)
    if m:
        parsed = {
            "ticker": m.group(1),
            "strike": float(m.group(2)),
            "cp": m.group(3)[0],   # CALL/PUT → C/P (matches worker internal repr)
            "exp": m.group(4),
        }
    else:
        m = re.match(r"^([A-Z0-9$.]+)\s+([CP])\s+\$([\d.]+)\s+(\S+)", title)
        if m:
            parsed = {
                "ticker": m.group(1),
                "strike": float(m.group(3)),
                "cp": m.group(2),
                "exp": m.group(4),
            }
    if not parsed:
        return None

    # Extract embed fields by name. DiscordChatExporter uses "isInline" not
    # "inline", but the field structure is otherwise identical to Discord's.
    fields = {(f.get("name") or "").strip(): (f.get("value") or "").strip()
              for f in embed.get("fields", [])}

    def parse_premium(s):
        """'$1.27M', '$917K' → float dollars."""
        if not s:
            return 0.0
        s = s.replace("$", "").replace(",", "").strip().strip("*")
        try:
            if s.endswith("M"): return float(s[:-1]) * 1e6
            if s.endswith("K"): return float(s[:-1]) * 1e3
            if s.endswith("B"): return float(s[:-1]) * 1e9
            return float(s)
        except (ValueError, IndexError):
            return 0.0

    def parse_int(s):
        if not s or s == "—":
            return None
        try:
            return int(s.replace(",", ""))
        except (ValueError, IndexError):
            return None

    def parse_fill(s):
        """'$13.50' → 13.50"""
        if not s:
            return None
        try:
            return float(s.replace("$", "").replace(",", "").strip())
        except ValueError:
            return None

    premium = parse_premium(fields.get("Total Premium") or fields.get("Premium"))
    alert_name = fields.get("Alert", "")
    # Strip "+N more" suffix; some embeds show multiple alert tiers caught the
    # same trade. We just want the primary one for re-running the pipeline.
    alert_name = re.sub(r"\s+\+\d+ more", "", alert_name).strip()
    fill = parse_fill(fields.get("Avg Fill") or fields.get("Latest Fill"))

    return {
        "id": embed.get("_id"),  # may be None
        "alertName": alert_name,
        "alertType": "custom",   # Discord embeds don't carry the original type
        "alertPremium": premium,
        "averageFillPrice": fill,
        "ticker": parsed["ticker"],
        "cp": parsed["cp"],
        "strike": parsed["strike"],
        "exp": parsed["exp"],
        "dte": None,
        "timestamp": message_ts,
        # Keep a few enrichment hints if present in the embed — these are not
        # used by the simulator (which re-derives them) but useful for debug.
        "_embed_volume": parse_int(fields.get("Volume")),
        "_embed_oi": parse_int(fields.get("OI")),
        "_embed_grade": fields.get("Conviction"),
    }


def _parse_discord_export(data: dict) -> list[dict]:
    """
    Walk a DiscordChatExporter JSON dump and extract alert-shaped dicts from
    every UCTOptionsAlert bot post that has a parseable embed. Watchlist
    summaries and other non-alert embeds are silently skipped.
    """
    alerts: list[dict] = []
    messages = data.get("messages") or []
    for msg in messages:
        author = (msg.get("author") or {}).get("name", "")
        if author not in _BOT_NAMES:
            continue
        ts = msg.get("timestamp") or ""
        for embed in (msg.get("embeds") or []):
            a = _parse_discord_embed_alert(embed, ts)
            if a:
                alerts.append(a)
    return alerts


@router.post("/backtest-from-json")
async def backtest_from_json(
    file: UploadFile = File(..., description="DiscordChatExporter JSON export"),
    min_grade: str = Query("B", description="Conviction gate threshold"),
    exclude_etf_flow: bool = Query(False, description="Strip UCT ETF Flow"),
):
    """
    Run the simulation pipeline against alerts reconstructed from a Discord
    channel export. Independent of Bullflow MCP — purely file-driven, which
    makes it reliable even when upstream APIs misbehave.

    Returns the same response shape as the MCP backtest endpoint so the
    frontend can reuse all its existing rendering code without branching.
    """
    import json as _json
    try:
        raw = await file.read()
        data = _json.loads(raw)
    except _json.JSONDecodeError as e:
        return JSONResponse(
            status_code=400,
            content={"error": f"Invalid JSON: {e}"},
        )
    except Exception as e:
        return JSONResponse(
            status_code=400,
            content={"error": f"File read failed: {type(e).__name__}: {e}"},
        )

    alerts = _parse_discord_export(data)
    if not alerts:
        return JSONResponse(
            status_code=400,
            content={
                "error": "No alerts parsed from JSON. Expected DiscordChatExporter "
                         "format with UCTOptionsAlert bot embeds.",
                "messages_in_file": len(data.get("messages", [])),
            },
        )

    # Apply ETF filter pre-simulation so the gate doesn't see those alerts.
    if exclude_etf_flow:
        alerts = [a for a in alerts if "ETF Flow" not in (a.get("alertName") or "")]

    # Run the same simulator the MCP endpoint uses. This applies enrichment
    # (OI lookup + Schwab spot for moneyness), aggregation, conviction grading,
    # and the gate. Output shape identical to the MCP backtest endpoint.
    try:
        simulation = await _simulate_pipeline(alerts, min_grade=min_grade)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"Simulator failed: {type(e).__name__}: {str(e)[:300]}"},
        )

    # Extract date range from the file for the response header
    date_range = data.get("dateRange") or {}
    date_from = (date_range.get("after") or "")[:10]
    date_to = (date_range.get("before") or "")[:10]

    return {
        "mode": "backtest_json",
        "source": "discord_export",
        "filename": file.filename,
        "date_from": date_from,
        "date_to": date_to,
        "alerts": alerts,
        "status": {
            "connected": True,
            "last_event_at": alerts[-1]["timestamp"] if alerts else None,
            "total_alerts_received": len(alerts),
            "total_alerts_shown": len(alerts),
            "total_alerts_dropped": 0,
            "total_alerts_forwarded": 0,
            "last_error": None,
            "reconnect_count": 0,
            "started_at": None,
            "mode": "backtest_json",
            "backtest_date": date_to or date_from,
            "backtest_capped": False,
        },
        "simulation": simulation,
    }


# ─── BACKFILL ─────────────────────────────────────────────────────────────────
# Pull historical alerts from Bullflow MCP and persist them to the live_alerts
# SQLite table. Used to seed history for dates before live persistence shipped,
# or to fill gaps when the worker was down.
#
# Source tag: rows inserted here are tagged source="bullflow_replay" so the
# frontend can flag them as incomplete samples. Bullflow's
# bullflow_backtesting_replay_sample tool caps at ~100 alerts per day server-
# side — a busy day with 500+ alerts will be drastically under-represented
# after backfill. INSERT OR IGNORE in the DB layer handles dedup against any
# rows already captured live.

from datetime import date as _date, timedelta as _timedelta
import asyncio as _asyncio


def _iso_to_date(s: str) -> _date | None:
    """Parse YYYY-MM-DD; return None on malformed input."""
    if not s or not isinstance(s, str):
        return None
    try:
        return _date.fromisoformat(s)
    except ValueError:
        return None


@router.get("/backfill")
async def backfill_from_bullflow(
    date_from: str = Query(..., description="Start date YYYY-MM-DD (inclusive)"),
    date_to:   str = Query(None,
        description="End date YYYY-MM-DD (inclusive). Defaults to date_from for a single-day backfill. Max range: 7 days."),
    max_alerts_per_day: int = Query(100, ge=1, le=100,
        description="Max alerts to request from Bullflow per day. Bullflow's MCP "
                    "bullflow_backtesting_replay_sample tool enforces a hard "
                    "maximum of 100 server-side — exceeding it returns empty."),
    speed: float = Query(300, gt=0, le=1000,
        description="Replay speed multiplier passed to Bullflow MCP."),
    delay_seconds: float = Query(1.0, ge=0, le=10,
        description="Pause between days to avoid Bullflow rate limits."),
):
    """
    Backfill historical alerts from Bullflow's replay tool into the
    live_alerts SQLite table. Rows tagged source='bullflow_replay'.

    Designed to be fired from the browser address bar by an admin:
      /api/admin/bullflow/backfill?date_from=2026-06-13&date_to=2026-06-19

    Returns per-day counts and an overall summary. Re-running over the same
    range is safe — INSERT OR IGNORE drops collisions, so partial gaps fill
    in cleanly without duplicating already-captured rows.

    Caveats:
      - bullflow_backtesting_replay_sample is a SAMPLE; server-side cap ~100/day
      - Backfilled rows have NULL for grade, gate_passed, OI/spot enrichment,
        and discord_message_id since the live pipeline wasn't running at the time
      - source='bullflow_replay' on every inserted row so the frontend can
        warn about incomplete coverage
    """
    from api import live_alerts_db

    d_from = _iso_to_date(date_from)
    d_to   = _iso_to_date(date_to) if date_to else d_from
    if d_from is None or d_to is None:
        return JSONResponse(
            status_code=400,
            content={"error": "date_from / date_to must be YYYY-MM-DD"},
        )
    if d_from > d_to:
        d_from, d_to = d_to, d_from
    span = (d_to - d_from).days + 1
    if span > 7:
        return JSONResponse(
            status_code=400,
            content={
                "error": f"Range too large ({span} days). Max 7 per call — "
                         "split into multiple requests to stay under Bullflow "
                         "rate limits and timeouts.",
                "hint": "Each day's MCP replay can take up to 2 minutes; "
                        "longer ranges should be paginated.",
            },
        )

    # Ensure the table exists before we start inserting. The worker calls this
    # at boot too, but admin-initiated backfill might run on a service where
    # the worker isn't active (e.g. web service if /data is shared).
    live_alerts_db.init_db()

    per_day = []
    totals = {
        "dates_requested":     span,
        "dates_completed":     0,
        "dates_with_errors":   0,
        "alerts_returned":     0,  # raw count from Bullflow (post table-filter)
        "alerts_inserted":     0,  # rows actually written (new)
        "alerts_skipped":      0,  # collided with existing id (INSERT OR IGNORE)
        "alerts_no_id":        0,  # dropped because alert had no id field
    }
    errors = []

    d = d_from
    while d <= d_to:
        d_iso = d.isoformat()
        day_summary = {
            "date":      d_iso,
            "returned":  0,
            "inserted":  0,
            "skipped":   0,
            "no_id":     0,
            "capped":    False,
            "error":     None,
        }

        try:
            # Reuse the existing backtest_replay handler — it already does
            # MCP call + SSE envelope parsing + init/heartbeat filtering +
            # OCC normalization + table-filter application. Call it directly
            # as a Python coroutine with simulate="off" so we get raw alerts.
            #
            # HARD CLAMP at 100 — Bullflow MCP's bullflow_backtesting_replay_sample
            # enforces this server-side. Exceeding it silently returns empty
            # (no error, just no alerts), which previously caused this entire
            # endpoint to look broken.
            day_max = min(int(max_alerts_per_day), 100)
            replay = await backtest_replay(
                date=d_iso,
                max_alerts=day_max,
                speed=speed,
                timeout_seconds=120,
                simulate="off",
                min_grade="B",          # ignored when simulate="off"
                exclude_etf_flow=False, # ignored when simulate="off"
            )
        except Exception as e:
            day_summary["error"] = f"{type(e).__name__}: {str(e)[:300]}"
            errors.append({"date": d_iso, "error": day_summary["error"]})
            totals["dates_with_errors"] += 1
            per_day.append(day_summary)
            d += _timedelta(days=1)
            if d <= d_to and delay_seconds > 0:
                await _asyncio.sleep(delay_seconds)
            continue

        # The handler may return an error dict (e.g. MCP timeout) rather
        # than raise. Surface it the same way.
        if isinstance(replay, dict) and replay.get("error"):
            day_summary["error"] = replay["error"]
            errors.append({"date": d_iso, "error": day_summary["error"]})
            totals["dates_with_errors"] += 1
            per_day.append(day_summary)
            d += _timedelta(days=1)
            if d <= d_to and delay_seconds > 0:
                await _asyncio.sleep(delay_seconds)
            continue

        alerts_for_day = replay.get("alerts") or []
        day_summary["returned"] = len(alerts_for_day)
        day_summary["capped"]   = bool(replay.get("capped"))
        totals["alerts_returned"] += len(alerts_for_day)

        # Insert with source='bullflow_replay'. Need to set ingestedAt to
        # the historical date so the date_iso column reflects when the
        # alert actually fired, not when it was backfilled. Use the alert's
        # own timestamp if present; fall back to the date's market-open ET.
        for alert in alerts_for_day:
            if not alert.get("id"):
                day_summary["no_id"] += 1
                totals["alerts_no_id"] += 1
                continue

            # If the alert has a unix timestamp from Bullflow, render it as
            # an ISO string so _alert_to_row's date_iso derivation picks the
            # historical date. Otherwise stamp 09:30 ET of the backfill date
            # so the row still lands in the right day bucket.
            ts = alert.get("timestamp")
            if ts is not None:
                try:
                    ingested = datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
                except (TypeError, ValueError, OSError):
                    ingested = f"{d_iso}T13:30:00+00:00"  # 9:30 ET ≈ 13:30 UTC (EST)
            else:
                ingested = f"{d_iso}T13:30:00+00:00"
            alert["ingestedAt"] = ingested

            # Pre-insert id check so we can count skips vs new inserts
            # accurately (INSERT OR IGNORE is silent on collision). One SELECT
            # per row is fine at this volume; backfill is admin-initiated and
            # rate-limited to ≤7 days × ~100 rows = ~700 SELECTs per call.
            existed = False
            try:
                with live_alerts_db._conn() as c:
                    existed = c.execute(
                        "SELECT 1 FROM live_alerts WHERE id = ? LIMIT 1",
                        (alert["id"],),
                    ).fetchone() is not None
            except Exception:
                existed = False

            try:
                live_alerts_db.insert_alert(alert, source="bullflow_replay")
                if existed:
                    day_summary["skipped"]  += 1
                    totals["alerts_skipped"] += 1
                else:
                    day_summary["inserted"] += 1
                    totals["alerts_inserted"] += 1
            except Exception as e:
                # Don't abort the whole backfill on a single bad row —
                # log and continue.
                day_summary.setdefault("row_errors", []).append({
                    "id": alert.get("id"),
                    "error": f"{type(e).__name__}: {str(e)[:200]}",
                })

        totals["dates_completed"] += 1
        per_day.append(day_summary)

        d += _timedelta(days=1)
        if d <= d_to and delay_seconds > 0:
            await _asyncio.sleep(delay_seconds)

    return {
        "mode": "backfill",
        "date_from": date_from,
        "date_to":   d_to.isoformat(),
        "max_alerts_per_day": max_alerts_per_day,
        "summary": totals,
        "errors":  errors,
        "per_day": per_day,
        "notes": [
            "Rows inserted with source='bullflow_replay'.",
            "Bullflow replay returns a SAMPLE; capped=True days have more alerts than were captured.",
            "Backfilled rows have NULL grade/gate_passed/OI/spot/discord_message_id — the live pipeline wasn't running historically.",
            "Re-run is safe: INSERT OR IGNORE drops collisions cleanly.",
        ],
    }
