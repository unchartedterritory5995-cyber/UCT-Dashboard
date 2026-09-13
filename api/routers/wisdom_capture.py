"""Wisdom Loop capture admin routes (stream S-A). Skeleton: no routes yet; every route added must Depends(require_admin)."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin/wisdom/capture", tags=["wisdom"])
