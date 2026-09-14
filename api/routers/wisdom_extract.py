"""Wisdom Loop extraction routes (stream S-D, CONTRACTS §6.4).

Admin (GET only, Depends(require_admin) on every route — /api/admin/wisdom is not
covered by AdminGuardMiddleware, so the dependency IS the gate):
    GET /api/admin/wisdom/extract/batches   batches, request status counts, error types
    GET /api/admin/wisdom/extract/gate      golden-gate reading, recent evaluations, seam report
    GET /api/admin/wisdom/extract/budget    cap, actual, pending estimate, remaining

Machine (Depends(require_push_secret), the PUSH_SECRET bearer, copied from
api/routers/scan_live.py):
    POST /api/internal/wisdom/extract/eval-runs   record a PC-side golden-gate receipt.
        The receipt carries counts only (no quote); precision, recall and the gate
        decision are recomputed here against this store's own history.

Nothing here returns record text, a quote or a private value.
"""
from __future__ import annotations

import hmac
import json
import os
import sqlite3

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

from api.middleware.auth_middleware import require_admin
from api.services.wisdom.core import flags, store

router = APIRouter(prefix="/api/admin/wisdom/extract", tags=["wisdom"])
internal_router = APIRouter(prefix="/api/internal/wisdom/extract", tags=["wisdom"])


def require_push_secret(request: Request) -> None:
    """The worker credential: the PUSH_SECRET bearer (api/routers/scan_live.py:65-89).
    An unset or blank PUSH_SECRET refuses everybody; the comparison is constant-time
    over bytes, so a non-ASCII header is a 401, never a 500."""
    expected = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    if not expected or not hmac.compare_digest(
            auth.encode("utf-8"), f"Bearer {expected}".encode("utf-8")):
        raise HTTPException(status_code=401, detail="worker credential required")


def _unavailable(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=f"wisdom.db unavailable: {exc}")


@router.get("/batches")
def extract_batches(limit: int = Query(50, ge=1, le=500), _admin: dict = Depends(require_admin)) -> dict:
    try:
        with store.read(for_request=True) as conn:
            batches = [dict(r) for r in conn.execute(
                "SELECT batch_id, kind, extractor_version, model, submitted_at, status, request_count, "
                "cost_usd_estimate, cost_usd_actual, budget_cap_usd, checkpoint_json FROM wisdom_batches "
                "ORDER BY submitted_at DESC LIMIT ?", (limit,))]
            requests = [dict(r) for r in conn.execute(
                "SELECT extractor_version, purpose, status, COUNT(*) AS n, ROUND(SUM(est_cost_usd), 6) AS est_usd, "
                "ROUND(SUM(actual_cost_usd), 6) AS actual_usd FROM wisdom_extract_requests "
                "GROUP BY extractor_version, purpose, status ORDER BY extractor_version, purpose, status")]
            errors = [dict(r) for r in conn.execute(
                "SELECT error_type, COUNT(*) AS n FROM wisdom_extract_requests WHERE error_type IS NOT NULL "
                "GROUP BY error_type ORDER BY n DESC")]
    except sqlite3.Error as exc:
        raise _unavailable(exc)
    for b in batches:
        try:
            b["checkpoint"] = json.loads(b.pop("checkpoint_json") or "{}")
        except ValueError:
            b["checkpoint"] = {}
    return {"batches": batches, "requests": requests, "error_types": errors, "flag_on": flags.extract_enabled()}


@router.get("/gate")
def extract_gate(_admin: dict = Depends(require_admin)) -> dict:
    from api.services.wisdom.extract import config, golden, prompt, seams

    version = prompt.extractor_version()
    model = config.configured_model()
    try:
        with store.read(for_request=True) as conn:
            status = golden.gate_status(conn, extractor_version=version, model=model)
            recent = []
            for row in conn.execute(
                    "SELECT run_id, kind, extractor_version, n, metrics_json, created_at FROM wisdom_eval_runs "
                    "WHERE kind LIKE 'extractor_%' ORDER BY created_at DESC LIMIT 20"):
                try:
                    m = json.loads(row["metrics_json"] or "{}")
                except ValueError:
                    m = {}
                recent.append({"run_id": row["run_id"], "kind": row["kind"], "extractor_version": row["extractor_version"],
                               "n": row["n"], "created_at": row["created_at"], "model": m.get("model"),
                               "golden_version": m.get("golden_version"), "decision": (m.get("gate") or {}).get("decision")})
    except sqlite3.Error as exc:
        raise _unavailable(exc)
    return {"extractor_version": version, "model": model, "effort": config.configured_effort(),
            "flag_on": flags.extract_enabled(), "gate": status, "recent_evaluations": recent,
            "vocabulary_source": prompt.vocabulary_source(), "seams": seams.seam_report()}


@router.get("/budget")
def extract_budget(_admin: dict = Depends(require_admin)) -> dict:
    from api.services.wisdom.extract import budget, prompt

    try:
        with store.read(for_request=True) as conn:
            return budget.snapshot(conn, prompt.extractor_version())
    except sqlite3.Error as exc:
        raise _unavailable(exc)


@internal_router.post("/eval-runs")
def import_eval_run(receipt: dict = Body(...), _worker: None = Depends(require_push_secret)) -> dict:
    from api.services.wisdom.extract import golden

    try:
        with store.write() as conn:
            return golden.import_receipt(conn, receipt)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except sqlite3.Error as exc:
        raise _unavailable(exc)
