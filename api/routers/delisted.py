"""Delisted-ticker metadata endpoints. Read-only; the bars themselves come from the
existing /api/bars path (Massive for ~2003+, bars.db for imported pre-2003)."""
from fastapi import APIRouter

from api.services import delisted_registry

router = APIRouter()


@router.get("/api/delisted/list")
def delisted_list():
    """Every delisted ticker we carry, with metadata. Powers a future 'Delisted' browser."""
    entries = delisted_registry.all_entries()
    return {"count": len(entries), "results": entries}


@router.get("/api/delisted/{sym}")
def delisted_one(sym: str):
    """Metadata for one delisted ticker, or {delisted: false} if it isn't one. The
    frontend calls this to decide whether to FREEZE the live paths (no streaming, no live
    price, 'Delisted YYYY' badge, curated watermark)."""
    # resolve() matches an exact key OR a dead bare provider symbol (bare "BSC" → the
    # "BSC-OLD" Bear Stearns entity), so the badge/watermark are correct even when a user
    # charts the bare reused symbol. A live ticker resolves to None (never mislabeled).
    rec = delisted_registry.resolve(sym)
    if not rec:
        return {"ticker": (sym or "").upper(), "delisted": False}
    return {**rec, "delisted": True}
