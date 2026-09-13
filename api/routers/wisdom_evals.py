"""Wisdom Loop evals admin routes (stream S-E). Skeleton: no routes yet; every route added must Depends(require_admin)."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin/wisdom/evals", tags=["wisdom"])
