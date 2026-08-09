"""Delisted-ticker metadata endpoints. Read-only; the bars themselves come from the
existing /api/bars path (Massive for ~2003+, bars.db for imported pre-2003).

🔴 `GET /api/delisted/list` answered an anonymous caller with **1.68 MB — the
WHOLE registry** (auth/paywall sweep, 2026-08-09). That registry is not a public
list: it is the firm's own reconstruction of which symbols died, when, and what
they became, assembled to keep decades-old charts honest. One request copied it.

Both routes are PAID now. `/{sym}` is the cheap per-symbol lookup the chart uses
to decide whether to freeze the live paths — it is on the same paid chart surface
as `/list`, and leaving the singular open would just make the bulk route a loop.
"""
from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import delisted_registry

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the delisted-ticker registry.

    ⛔ Defined HERE, not imported from a sibling. Every router that gates on
    `require_paid` defines its own with its OWN 402 sentence, so "which surface
    locked me out" is answerable from the message alone. The rail is
    `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`,
    which walks `api/routers/` by AST and fails on a shared import.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The delisted registry requires a paid plan")
    return user


@router.get("/api/delisted/list")
def delisted_list(_user: dict = Depends(require_paid)):
    """Every delisted ticker we carry, with metadata. Powers a future 'Delisted' browser."""
    entries = delisted_registry.all_entries()
    return {"count": len(entries), "results": entries}


@router.get("/api/delisted/{sym}")
def delisted_one(sym: str, _user: dict = Depends(require_paid)):
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
