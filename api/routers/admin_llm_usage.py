"""Admin AI-spend page: where the Claude tokens go, by feature, model and day.

Reads the one ledger `api/services/llm_usage.py` writes (every Anthropic call,
hooked at the SDK), joined to `ai_doors.DOORS` so every row carries the feature
it belongs to. Two doors:

  * GET  /api/admin/llm-usage/summary?days=N        (admin)  -- the page
  * GET  /api/admin/llm-usage/door?door=..&days=N    (admin)  -- one feature drilled
  * POST /api/internal/llm-usage/ingest              (PUSH_SECRET) -- rows from the
         other Railway services and the sibling repos (morning-wire, the Discord
         bot, the engine), so "everywhere" means everywhere. Fails CLOSED.
"""
from __future__ import annotations

import contextlib
import hmac
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import require_admin
from api.services import llm_budget, llm_usage

router = APIRouter(prefix="/api/admin/llm-usage", tags=["admin-llm-usage"])
internal_router = APIRouter(prefix="/api/internal/llm-usage", tags=["admin-llm-usage"])

_ET = ZoneInfo("America/New_York")
_SUMS = ("COUNT(*) AS calls, COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(input_tokens),0) AS input, "
         "COALESCE(SUM(cache_read_tokens),0) AS cache_read, COALESCE(SUM(cache_write_tokens),0) AS cache_write, "
         "COALESCE(SUM(output_tokens),0) AS output, COALESCE(SUM(web_searches),0) AS web_searches, "
         "COALESCE(SUM(1 - ok),0) AS failed")


def _since(days: int) -> str:
    return (datetime.now(_ET).date() - timedelta(days=max(1, days) - 1)).isoformat()


def _rows(c, sql: str, args: tuple) -> list[dict]:
    cur = c.execute(sql, args)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _cache_ratio(r: dict) -> float:
    denom = (r.get("input") or 0) + (r.get("cache_read") or 0) + (r.get("cache_write") or 0)
    return round((r.get("cache_read") or 0) / denom, 4) if denom else 0.0


def _doors() -> dict:
    try:
        from api.services import ai_doors
        return ai_doors.DOORS
    except Exception:  # noqa: BLE001
        return {}


def _door_info(path: str, doors: dict) -> dict:
    d = doors.get(path)
    if d is None:
        return {"kind": "unlisted", "surface": "", "budget": "", "meter": None}
    return {"kind": d.kind, "surface": d.surface, "budget": d.budget, "meter": d.meter}


@router.get("/summary")
def summary(days: int = Query(7, ge=1, le=120), _admin=Depends(require_admin)):
    since = _since(days)
    today = datetime.now(_ET).date().isoformat()
    doors = _doors()
    with contextlib.closing(llm_usage.connect()) as c:
        totals = _rows(c, f"SELECT {_SUMS} FROM llm_usage_calls WHERE day >= ?", (since,))[0]
        today_row = _rows(c, f"SELECT {_SUMS} FROM llm_usage_calls WHERE day = ?", (today,))[0]
        by_door = _rows(c, f"SELECT door, {_SUMS}, GROUP_CONCAT(DISTINCT model) AS models, MAX(at) AS last_at, "
                           "GROUP_CONCAT(DISTINCT service) AS services "
                           "FROM llm_usage_calls WHERE day >= ? GROUP BY door ORDER BY cost DESC", (since,))
        by_model = _rows(c, f"SELECT model, {_SUMS} FROM llm_usage_calls WHERE day >= ? "
                            "GROUP BY model ORDER BY cost DESC", (since,))
        by_kind = _rows(c, f"SELECT kind, {_SUMS} FROM llm_usage_calls WHERE day >= ? GROUP BY kind "
                           "ORDER BY cost DESC", (since,))
        by_service = _rows(c, f"SELECT service, {_SUMS} FROM llm_usage_calls WHERE day >= ? "
                              "GROUP BY service ORDER BY cost DESC", (since,))
        by_day = _rows(c, "SELECT day, COUNT(*) AS calls, COALESCE(SUM(cost_usd),0) AS cost "
                          "FROM llm_usage_calls WHERE day >= ? GROUP BY day ORDER BY day", (since,))
        top = [r["door"] for r in by_door[:8]]
        day_door = _rows(c, "SELECT day, door, COALESCE(SUM(cost_usd),0) AS cost FROM llm_usage_calls "
                            "WHERE day >= ? GROUP BY day, door", (since,))
        first = _rows(c, "SELECT MIN(day) AS first_day FROM llm_usage_calls", ())[0]["first_day"]

    total_cost = totals["cost"] or 0.0
    for r in by_door:
        r.update(_door_info(r["door"], doors))
        r["share"] = round(r["cost"] / total_cost, 4) if total_cost else 0.0
        r["cache_ratio"] = _cache_ratio(r)
        r["cost_per_call"] = round(r["cost"] / r["calls"], 5) if r["calls"] else 0.0
        r["models"] = sorted(filter(None, (r.get("models") or "").split(",")))
        r["services"] = sorted(filter(None, (r.get("services") or "").split(",")))
    for group in (by_model, by_kind, by_service):
        for r in group:
            r["share"] = round(r["cost"] / total_cost, 4) if total_cost else 0.0
            r["cache_ratio"] = _cache_ratio(r)
    stacked: dict[str, dict] = {d["day"]: {"day": d["day"], "total": d["cost"], "calls": d["calls"],
                                           "doors": {}} for d in by_day}
    for r in day_door:
        key = r["door"] if r["door"] in top else "other"
        bucket = stacked.setdefault(r["day"], {"day": r["day"], "total": 0.0, "calls": 0, "doors": {}})
        bucket["doors"][key] = bucket["doors"].get(key, 0.0) + r["cost"]

    try:
        budget_rows = llm_budget.status(today)
    except Exception:  # noqa: BLE001 -- the page still renders without budgets
        budget_rows = []
    by_key = {b["door"]: b for b in budget_rows}
    for r in by_door:
        b = by_key.get(r["door"])
        r["budget"] = {"daily_usd": b["daily_usd"], "mode": b["mode"], "level": b["level"]} if b else None
    recorded = {r["door"] for r in by_door}
    anthropic_doors = {p for p, d in doors.items() if d.kind != "shared-client"}
    days_covered = len(by_day) or 1
    return {
        "days": days, "since": since, "today": today, "ledger_first_day": first,
        "totals": {**totals, "cache_ratio": _cache_ratio(totals),
                   "avg_per_day": round(total_cost / days_covered, 4), "days_with_data": len(by_day)},
        "today_totals": {**today_row, "cache_ratio": _cache_ratio(today_row)},
        "by_door": by_door, "by_model": by_model, "by_kind": by_kind, "by_service": by_service,
        "by_day": [stacked[k] for k in sorted(stacked)], "top_doors": top,
        "unlisted_doors": sorted(d for d in recorded if d not in doors),
        "silent_doors": sorted(anthropic_doors - recorded),
        "ledger": llm_usage.stats(), "budgets": budget_rows,
    }


@router.get("/door")
def door_detail(door: str = Query(..., min_length=1, max_length=300), days: int = Query(7, ge=1, le=120),
                _admin=Depends(require_admin)):
    since = _since(days)
    with contextlib.closing(llm_usage.connect()) as c:
        totals = _rows(c, f"SELECT {_SUMS} FROM llm_usage_calls WHERE door = ? AND day >= ?", (door, since))[0]
        by_func = _rows(c, f"SELECT func, {_SUMS} FROM llm_usage_calls WHERE door = ? AND day >= ? "
                           "GROUP BY func ORDER BY cost DESC", (door, since))
        by_model = _rows(c, f"SELECT model, {_SUMS} FROM llm_usage_calls WHERE door = ? AND day >= ? "
                            "GROUP BY model ORDER BY cost DESC", (door, since))
        by_day = _rows(c, "SELECT day, COUNT(*) AS calls, COALESCE(SUM(cost_usd),0) AS cost FROM llm_usage_calls "
                          "WHERE door = ? AND day >= ? GROUP BY day ORDER BY day", (door, since))
        by_hour = _rows(c, "SELECT CAST(substr(at, 12, 2) AS INTEGER) AS hour_utc, COUNT(*) AS calls, "
                           "COALESCE(SUM(cost_usd),0) AS cost FROM llm_usage_calls WHERE door = ? AND day >= ? "
                           "GROUP BY hour_utc ORDER BY hour_utc", (door, since))
        recent = _rows(c, "SELECT at, service, func, model, kind, input_tokens, cache_read_tokens, "
                          "cache_write_tokens, output_tokens, web_searches, cost_usd, ok FROM llm_usage_calls "
                          "WHERE door = ? ORDER BY id DESC LIMIT 50", (door,))
    for group in (by_func, by_model):
        for r in group:
            r["cache_ratio"] = _cache_ratio(r)
    return {"door": door, "days": days, "since": since, **_door_info(door, _doors()),
            "totals": {**totals, "cache_ratio": _cache_ratio(totals)},
            "by_func": by_func, "by_model": by_model, "by_day": by_day, "by_hour_utc": by_hour,
            "recent": recent}


# ── budgets ──────────────────────────────────────────────────────────────────

class BudgetBody(BaseModel):
    door: str = Field(..., min_length=1, max_length=300)
    daily_usd: float = Field(..., gt=0, le=100000)
    mode: str = Field("alert", pattern="^(alert|block)$")
    note: str = Field("", max_length=300)


@router.get("/budgets")
def list_budgets(_admin=Depends(require_admin)):
    return {"budgets": llm_budget.status(), "modes": list(llm_budget.MODES),
            "special_keys": {llm_budget.GLOBAL: "whole site",
                             llm_budget.BACKGROUND: "all non-member features"}}


@router.put("/budgets")
def put_budget(body: BudgetBody, admin=Depends(require_admin)):
    who = (admin or {}).get("email", "") if isinstance(admin, dict) else ""
    try:
        row = llm_budget.set_budget(body.door, body.daily_usd, body.mode, body.note, by=who)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"budget": row}


@router.delete("/budgets")
def remove_budget(door: str = Query(..., min_length=1, max_length=300), _admin=Depends(require_admin)):
    return {"deleted": llm_budget.delete_budget(door)}


# ── ingest from other services / sibling repos ───────────────────────────────

def require_push_secret(request: Request) -> None:
    """PUSH_SECRET bearer, fails CLOSED (unset secret refuses everybody); the idiom
    of api/routers/indicator_support.py. The secret is never logged or echoed."""
    expected = (os.environ.get("PUSH_SECRET") or "").strip()
    auth = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(auth.encode("utf-8"), f"Bearer {expected}".encode("utf-8")):
        raise HTTPException(status_code=401, detail="worker credential required")


class IngestRow(BaseModel):
    door: str = Field(..., min_length=1, max_length=300)
    func: str = Field("", max_length=200)
    model: str = Field("", max_length=100)
    kind: str = Field("sync", max_length=20)
    service: str = Field("external", max_length=60)
    at: str | None = Field(None, max_length=40)
    input_tokens: int = Field(0, ge=0)
    cache_read_tokens: int = Field(0, ge=0)
    cache_write_tokens: int = Field(0, ge=0)
    output_tokens: int = Field(0, ge=0)
    web_searches: int = Field(0, ge=0)
    ok: bool = True
    request_id: str = Field("", max_length=120)
    cost_usd: float | None = Field(None, ge=0)


class IngestBody(BaseModel):
    rows: list[IngestRow] = Field(..., max_length=5000)


@internal_router.post("/ingest")
def ingest(body: IngestBody, _auth=Depends(require_push_secret)):
    out = []
    for r in body.rows:
        now = datetime.now(_ET)
        at = r.at
        try:
            when = datetime.fromisoformat(at.replace("Z", "+00:00")) if at else now
        except ValueError:
            when = now
        cost = r.cost_usd
        if cost is None:
            cost = llm_usage.price(r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens,
                                   r.cache_write_tokens, r.web_searches, batch=(r.kind == "batch")) if r.model else 0.0
        out.append({"at": when.astimezone(ZoneInfo("UTC")).isoformat(timespec="seconds"),
                    "day": when.astimezone(_ET).date().isoformat(), "service": r.service, "door": r.door,
                    "func": r.func, "model": r.model, "kind": r.kind, "input_tokens": r.input_tokens,
                    "cache_read_tokens": r.cache_read_tokens, "cache_write_tokens": r.cache_write_tokens,
                    "output_tokens": r.output_tokens, "web_searches": r.web_searches, "cost_usd": float(cost),
                    "ok": 1 if r.ok else 0, "request_id": r.request_id})
    return {"written": llm_usage.write_rows(out)}
