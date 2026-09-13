"""Wisdom Loop review/publish admin routes (stream S-F). Skeleton: no routes yet; every route added must Depends(require_admin) or require_owner."""
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin/wisdom/publish", tags=["wisdom"])
