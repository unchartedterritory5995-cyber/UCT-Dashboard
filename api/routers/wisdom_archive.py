"""Wisdom archive routes — the TSDR trader archive.

MEMBER (`/api/wisdom/archive`, every route Depends(require_paid) — owner ruling 2026-10-15:
the archive is for PAID MEMBERS and every in-app tool, never the anonymous internet):
  GET /ticker/{sym}      records + calls for one ticker, oldest first, with outcomes + summary
  GET /setup/{setup}     calls of one setup, best/worst by outcome r20, with the record note
  GET /search?q=         FTS5-ranked records
  GET /stats             counts by author / type / setup
  GET /trader/{author}   one trader's records and calls, newest first, with a scored summary
  GET /playbooks         one row per setup playbook (most-called first)
  GET /playbook/{setup}  a setup's playbook: definition, measured stats, context cuts,
                         teaching record ids, best and worst calls
  GET /pattern/{id}?ticker=  the playbook of the setup a chart detector belongs to (through
                         the vocabulary's trader_archive map), today's market cut and the
                         ticker's team record; no price levels (the pattern side panel)
  GET /ticker/{sym}/daily team posts and calls per day on one ticker (Terminal ATTN)

ADMIN (`/api/admin/wisdom/archive`, every route Depends(require_admin) — the admin guard
middleware does not cover /api/admin/wisdom, so the dependency IS the gate):
  GET /ticker/{sym}      records + calls for one ticker, oldest first, with outcomes
  GET /setup/{setup}     calls of one setup, best/worst by outcome r20, with the record note
  GET /search?q=         FTS5-ranked records
  GET /stats             counts by author / type / setup

MACHINE (`/api/internal/wisdom/archive`, Depends(require_push_secret)):
  POST /batch            {kind: "records"|"calls"|"setups", items: [...]} idempotent upsert

Every half is ALSO gated by WISDOM_ARCHIVE_ENABLED (default off -> 404), checked after the
credential so an unauthenticated or unpaid caller learns nothing about the flag.

⛔ Reads and writes ONLY wisdom_archive_* (api/services/wisdom/archive/service.py). Nothing
here reaches wisdom_records / wisdom_segments.
"""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user, require_admin
from api.routers.wisdom_sources import require_push_secret
from api.services.wisdom.archive import service, setup_map
from api.services.wisdom.core import flags, store

router = APIRouter(prefix="/api/admin/wisdom/archive", tags=["wisdom"])
internal_router = APIRouter(prefix="/api/internal/wisdom/archive", tags=["wisdom"])
member_router = APIRouter(prefix="/api/wisdom/archive", tags=["wisdom"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the trader archive. Defined here, per router, with its own 402 sentence
    (tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The trader archive requires a paid plan")
    return user


def _require_enabled() -> None:
    if not flags.archive_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


class BatchIn(BaseModel):
    kind: str
    items: list = Field(default_factory=list, max_length=service.MAX_BATCH)


@internal_router.post("/batch")
def archive_batch(body: BatchIn, _worker: None = Depends(require_push_secret)) -> dict:
    _require_enabled()
    if body.kind not in service.KINDS:
        raise HTTPException(status_code=422, detail="kind must be 'records', 'calls' or 'setups'")
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


# ── member reads (require_paid) ──────────────────────────────────────────────

def _trader_name(author_id) -> str:
    from api.services.wisdom.archive.askai import _speaker
    return _speaker(author_id)


def _named(payload: dict) -> dict:
    """Adds a display `trader` beside every author_id the member payload carries, so the
    client never restates the author roster (docs/wisdom/authors.json is the one authority)."""
    for key in ("records", "calls", "hits", "best", "worst", "teachings", "winners", "failures"):
        for row in payload.get(key) or []:
            if isinstance(row, dict) and "author_id" in row:
                row["trader"] = _trader_name(row["author_id"])
    if "author" in payload:
        payload["trader"] = _trader_name(payload["author"])
    return payload


@member_router.get("/ticker/{sym}")
def member_ticker(sym: str, limit: int = Query(500, ge=1, le=2000),
                  _user: dict = Depends(require_paid)) -> dict:
    _require_enabled()
    out = _read(service.by_ticker, sym, limit=limit)
    summary = _read(service.ticker_summary, sym)
    return _named({**out, **{k: summary[k] for k in ("n_calls", "n_scored", "mean_r20")}})


@member_router.get("/setup/{setup}")
def member_setup(setup: str, limit: int = Query(25, ge=1, le=200),
                 _user: dict = Depends(require_paid)) -> dict:
    _require_enabled()
    return _named(_read(service.by_setup, setup, limit=limit))


@member_router.get("/search")
def member_search(q: str = Query("", max_length=200), limit: int = Query(50, ge=1, le=200),
                  _user: dict = Depends(require_paid)) -> dict:
    _require_enabled()
    return _named(_read(service.search, q, limit=limit))


@member_router.get("/stats")
def member_stats(_user: dict = Depends(require_paid)) -> dict:
    _require_enabled()
    out = _read(service.stats)
    authors = set(out.get("records_by_author") or {}) | set(out.get("calls_by_author") or {})
    out["traders"] = {a: _trader_name(a) for a in sorted(authors) if a != "(none)"}
    return out


@member_router.get("/trader/{author}")
def member_trader(author: str, limit: int = Query(100, ge=1, le=500),
                  _user: dict = Depends(require_paid)) -> dict:
    _require_enabled()
    return _named(_read(service.by_author, author, limit=limit))


@member_router.get("/playbooks")
def member_playbooks(_user: dict = Depends(require_paid)) -> dict:
    _require_enabled()
    return _read(service.playbooks)


#: Examples shown beside a live detection: the strongest and weakest few, never the whole list.
PATTERN_EXAMPLES = 3


@member_router.get("/pattern/{pattern_id}")
def member_pattern(pattern_id: str, ticker: str = Query("", max_length=16),
                   _user: dict = Depends(require_paid)) -> dict:
    """The archive's record for the setup a chart detection belongs to (the pattern side panel).
    404 when the detector maps to no archive setup or the setup has no playbook, so the panel
    keeps its own placeholder. Display only: nothing here feeds what fires or its score."""
    _require_enabled()
    setup = setup_map.setup_for_pattern(pattern_id)
    if setup is None:
        raise HTTPException(status_code=404, detail="No archive setup for that pattern")
    pb = _read(service.playbook, setup)
    if pb is None:
        raise HTTPException(status_code=404, detail="No playbook for that setup")
    state = setup_map.market_state()
    market_cut = ((pb.get("context") or {}).get("market") or {}).get(state) if state else None
    out = {
        "pattern_id": pattern_id, "setup_id": pb["setup_id"], "name": pb.get("name"),
        "used_by": [{"author": a, "trader": _trader_name(a)} for a in pb.get("used_by") or []],
        "stats": pb.get("stats") or {},
        "market": {"state": state, "cut": market_cut},
        "best": (pb.get("winners") or [])[:PATTERN_EXAMPLES],
        "worst": (pb.get("failures") or [])[:PATTERN_EXAMPLES],
        "ticker": None,
    }
    sym = (ticker or "").strip()
    if sym:
        try:
            summary = _read(service.ticker_summary, sym)
            last = _read(service.last_call, sym)
        except HTTPException:
            summary, last = None, None
        if summary is not None:
            if last is not None:
                last = {"posted": last.get("posted"), "setup": last.get("setup"), "author_id": last.get("author_id"),
                        "trader": _trader_name(last.get("author_id")), "direction": last.get("direction"),
                        "r20": (last.get("outcome") or {}).get("r20")}
            out["ticker"] = {**summary, "last_call": last}
    return _named(out)


@member_router.get("/playbook/{setup}")
def member_playbook(setup: str, _user: dict = Depends(require_paid)) -> dict:
    _require_enabled()
    out = _read(service.playbook, setup)
    if out is None:
        raise HTTPException(status_code=404, detail="No playbook for that setup")
    out["used_by"] = [{"author": a, "trader": _trader_name(a)} for a in out.get("used_by") or []]
    return _named(out)


@member_router.get("/ticker/{sym}/daily")
def member_ticker_daily(sym: str, days: int = Query(365, ge=1, le=service.MAX_DAILY_DAYS),
                        _user: dict = Depends(require_paid)) -> dict:
    """Team posts and calls per day on one ticker (the Terminal ATTN overlay)."""
    _require_enabled()
    return _read(service.ticker_daily, sym, days=days)

