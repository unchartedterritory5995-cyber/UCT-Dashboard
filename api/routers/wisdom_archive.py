"""Wisdom archive routes — ADMIN-ONLY browse of the TSDR Ledger backfill.

ADMIN (`/api/admin/wisdom/archive`, every route Depends(require_admin) — the admin guard
middleware does not cover /api/admin/wisdom, so the dependency IS the gate):
  GET /ticker/{sym}      records + calls for one ticker, oldest first, with outcomes
  GET /setup/{setup}     calls of one setup, best/worst by outcome r20, with the record note
  GET /search?q=         FTS5-ranked records
  GET /stats             counts by author / type / setup

MACHINE (`/api/internal/wisdom/archive`, Depends(require_push_secret)):
  POST /batch            {kind: "records"|"calls", items: [...]} idempotent upsert

Both halves are ALSO gated by WISDOM_ARCHIVE_ADMIN_ENABLED (default off -> 404), checked
after the credential so an unauthenticated caller learns nothing about the flag.

⛔ Reads and writes ONLY wisdom_archive_* (api/services/wisdom/archive/service.py). Nothing
here reaches wisdom_records / wisdom_segments or any member-facing lane.
"""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import require_admin
from api.routers.wisdom_sources import require_push_secret
from api.services.wisdom.archive import service
from api.services.wisdom.core import flags, store

router = APIRouter(prefix="/api/admin/wisdom/archive", tags=["wisdom"])
internal_router = APIRouter(prefix="/api/internal/wisdom/archive", tags=["wisdom"])


def _require_enabled() -> None:
    if not flags.archive_admin_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


class BatchIn(BaseModel):
    kind: str
    items: list = Field(default_factory=list, max_length=service.MAX_BATCH)


@internal_router.post("/batch")
def archive_batch(body: BatchIn, _worker: None = Depends(require_push_secret)) -> dict:
    _require_enabled()
    if body.kind not in ("records", "calls"):
        raise HTTPException(status_code=422, detail="kind must be 'records' or 'calls'")
    try:
        with store.write() as conn:
            return service.upsert_batch(conn, body.kind, body.items)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail=f"wisdom.db unavailable: {exc}")


def _read(fn, *args, **kwargs):
    try:
        with store.read(for_request=True) as conn:
            return fn(conn, *args, **kwargs)
    except service.ItemError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail=f"wisdom.db unavailable: {exc}")


@router.get("/ticker/{sym}")
def archive_ticker(sym: str, limit: int = Query(1000, ge=1, le=2000),
                   _admin: dict = Depends(require_admin)) -> dict:
    _require_enabled()
    return _read(service.by_ticker, sym, limit=limit)


@router.get("/setup/{setup}")
def archive_setup(setup: str, limit: int = Query(25, ge=1, le=200),
                  _admin: dict = Depends(require_admin)) -> dict:
    _require_enabled()
    return _read(service.by_setup, setup, limit=limit)


@router.get("/search")
def archive_search(q: str = Query("", max_length=200), limit: int = Query(50, ge=1, le=200),
                   _admin: dict = Depends(require_admin)) -> dict:
    _require_enabled()
    return _read(service.search, q, limit=limit)


@router.get("/stats")
def archive_stats(_admin: dict = Depends(require_admin)) -> dict:
    _require_enabled()
    return _read(service.stats)
