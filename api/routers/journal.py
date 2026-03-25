"""Journal API — per-user trade journal CRUD. All routes require authentication."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from api.middleware.auth_middleware import get_current_user
from api.services import journal_service

router = APIRouter()


class JournalEntry(BaseModel):
    sym: str
    direction: Optional[str] = "long"
    setup: Optional[str] = ""
    entry_price: Optional[float] = None
    exit_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    size_pct: Optional[float] = None
    status: Optional[str] = "open"
    entry_date: Optional[str] = ""
    exit_date: Optional[str] = None
    notes: Optional[str] = ""
    rating: Optional[int] = None


class JournalUpdate(BaseModel):
    sym: Optional[str] = None
    direction: Optional[str] = None
    setup: Optional[str] = None
    entry_price: Optional[float] = None
    exit_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    size_pct: Optional[float] = None
    status: Optional[str] = None
    entry_date: Optional[str] = None
    exit_date: Optional[str] = None
    notes: Optional[str] = None
    rating: Optional[int] = None
    pnl_pct: Optional[float] = None
    pnl_dollar: Optional[float] = None


@router.get("/api/journal")
def list_journal(status: Optional[str] = None, limit: int = 200, user: dict = Depends(get_current_user)):
    return journal_service.list_entries(user["id"], status=status, limit=limit)


@router.get("/api/journal/stats")
def journal_stats(user: dict = Depends(get_current_user)):
    return journal_service.get_stats(user["id"])


@router.post("/api/journal")
def create_journal_entry(entry: JournalEntry, user: dict = Depends(get_current_user)):
    return journal_service.create_entry(user["id"], entry.model_dump())


@router.put("/api/journal/{entry_id}")
def update_journal_entry(entry_id: str, update: JournalUpdate, user: dict = Depends(get_current_user)):
    data = {k: v for k, v in update.model_dump().items() if v is not None}
    result = journal_service.update_entry(user["id"], entry_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result


@router.delete("/api/journal/{entry_id}")
def delete_journal_entry(entry_id: str, user: dict = Depends(get_current_user)):
    if not journal_service.delete_entry(user["id"], entry_id):
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"ok": True}
