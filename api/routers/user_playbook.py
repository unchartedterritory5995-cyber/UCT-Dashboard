"""api/routers/user_playbook.py — My Playbook API (prefix /api/upb).

Every member's own playbook builder inside Model Book: self-created
sections → rich TipTap entries → date-framed annotated charts + links
into their Journal 2.0 Notebook. Private in v1 — every endpoint is
gated by get_current_user and every service call is user-scoped.

Routes:
    GET    /api/upb/overview                      → sections + counts + totals
    POST   /api/upb/sections                       → create section
    PUT    /api/upb/sections/{section_id}          → edit section (partial)
    DELETE /api/upb/sections/{section_id}          → delete section (cascades)
    GET    /api/upb/sections/{section_id}/entries  → lean entry rows
    POST   /api/upb/sections/{section_id}/entries  → create entry
    GET    /api/upb/entries/{entry_id}             → entry + charts[] + note_links[]
    PUT    /api/upb/entries/{entry_id}             → edit entry (partial)
    DELETE /api/upb/entries/{entry_id}             → delete entry (cascades)
    POST   /api/upb/entries/{entry_id}/charts      → add chart
    PUT    /api/upb/charts/{chart_id}              → edit chart (partial — the
                                                     annotate save PUTs only a
                                                     drawings field)
    DELETE /api/upb/charts/{chart_id}              → delete chart
    PUT    /api/upb/entries/{entry_id}/note-links  → replace Notebook link set
    POST   /api/upb/clone-setup                    → "Add to my playbook"

Spec: docs/superpowers/specs/2026-07-12-my-playbook-builder-design.md
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user
from api.services.user_playbook import service as upb
from api.services.user_playbook.service import UpbValidationError

router = APIRouter(prefix="/api/upb", tags=["user-playbook"])


# ── Pydantic payloads ─────────────────────────────────────────────────────────
# PUT models are dumped with model_dump(exclude_unset=True) — load-bearing:
# the annotate save PUTs only the drawings field; without exclude_unset every
# other column would be nulled.

class SectionIn(BaseModel):
    title: str
    blurb: Optional[str] = ""
    accent: Optional[str] = "gold"
    sort_order: Optional[int] = 0


class SectionPatch(BaseModel):
    title: Optional[str] = None
    blurb: Optional[str] = None
    accent: Optional[str] = None
    sort_order: Optional[int] = None


class EntryIn(BaseModel):
    title: Optional[str] = ""
    body_json: Optional[Any] = None
    sort_order: Optional[int] = 0


class EntryPatch(BaseModel):
    title: Optional[str] = None
    body_json: Optional[Any] = None
    sort_order: Optional[int] = None


class ChartIn(BaseModel):
    symbol: str
    timeframe: Optional[str] = "D"
    year: Optional[int] = None
    label_date: Optional[str] = None
    frame_start_date: Optional[str] = None
    result_start_date: Optional[str] = None
    result_end_date: Optional[str] = None
    entry_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    grade: Optional[str] = None
    notes: Optional[str] = None
    scale_mode: Optional[str] = "arith"
    drawings_json: Optional[str] = None
    result_drawings_json: Optional[str] = None
    sort_order: Optional[int] = 0


class ChartPatch(BaseModel):
    symbol: Optional[str] = None
    timeframe: Optional[str] = None
    year: Optional[int] = None
    label_date: Optional[str] = None
    frame_start_date: Optional[str] = None
    result_start_date: Optional[str] = None
    result_end_date: Optional[str] = None
    entry_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    grade: Optional[str] = None
    notes: Optional[str] = None
    scale_mode: Optional[str] = None
    drawings_json: Optional[str] = None
    result_drawings_json: Optional[str] = None
    sort_order: Optional[int] = None


class NoteLinksIn(BaseModel):
    note_ids: list[str]


class CloneSetupIn(BaseModel):
    setup_name: str


# ── Overview ─────────────────────────────────────────────────────────────────

@router.get("/overview")
def get_overview(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    return upb.overview(user["id"])


# ── Sections ─────────────────────────────────────────────────────────────────

@router.post("/sections")
def create_section_endpoint(
    payload: SectionIn,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        section = upb.create_section(user["id"], payload.model_dump())
    except UpbValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"section": section}


@router.put("/sections/{section_id}")
def update_section_endpoint(
    section_id: str,
    payload: SectionPatch,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        section = upb.update_section(
            user["id"], section_id, payload.model_dump(exclude_unset=True)
        )
    except UpbValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if section is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"section": section}


@router.delete("/sections/{section_id}")
def delete_section_endpoint(
    section_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    if not upb.delete_section(user["id"], section_id):
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ── Entries ──────────────────────────────────────────────────────────────────

@router.get("/sections/{section_id}/entries")
def list_entries_endpoint(
    section_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    entries = upb.list_entries(user["id"], section_id)
    if entries is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"entries": entries}


@router.post("/sections/{section_id}/entries")
def create_entry_endpoint(
    section_id: str,
    payload: EntryIn,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        entry = upb.create_entry(user["id"], section_id, payload.model_dump())
    except UpbValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if entry is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"entry": entry}


@router.get("/entries/{entry_id}")
def get_entry_endpoint(
    entry_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    entry = upb.get_entry_detail(user["id"], entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"entry": entry}


@router.put("/entries/{entry_id}")
def update_entry_endpoint(
    entry_id: str,
    payload: EntryPatch,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        entry = upb.update_entry(
            user["id"], entry_id, payload.model_dump(exclude_unset=True)
        )
    except UpbValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if entry is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"entry": entry}


@router.delete("/entries/{entry_id}")
def delete_entry_endpoint(
    entry_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    if not upb.delete_entry(user["id"], entry_id):
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ── Charts ───────────────────────────────────────────────────────────────────

@router.post("/entries/{entry_id}/charts")
def create_chart_endpoint(
    entry_id: str,
    payload: ChartIn,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        chart = upb.create_chart(user["id"], entry_id, payload.model_dump())
    except UpbValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if chart is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"chart": chart}


@router.put("/charts/{chart_id}")
def update_chart_endpoint(
    chart_id: str,
    payload: ChartPatch,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        chart = upb.update_chart(
            user["id"], chart_id, payload.model_dump(exclude_unset=True)
        )
    except UpbValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if chart is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"chart": chart}


@router.delete("/charts/{chart_id}")
def delete_chart_endpoint(
    chart_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    if not upb.delete_chart(user["id"], chart_id):
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ── Note links ───────────────────────────────────────────────────────────────

@router.put("/entries/{entry_id}/note-links")
def replace_note_links_endpoint(
    entry_id: str,
    payload: NoteLinksIn,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        links = upb.replace_note_links(user["id"], entry_id, payload.note_ids)
    except UpbValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if links is None:
        raise HTTPException(status_code=404, detail="Not found")
    return {"note_links": links}


# ── Clone setup ("Add to my playbook") ───────────────────────────────────────

@router.post("/clone-setup")
def clone_setup_endpoint(
    payload: CloneSetupIn,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        result = upb.clone_setup(user["id"], payload.setup_name)
    except UpbValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result
