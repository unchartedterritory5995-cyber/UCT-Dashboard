"""GET /api/compare/groups + /api/compare/group-members — theme/sector/industry
membership for the /charts Compare Symbols group picker. See services/compare_groups.
Open (no auth), like /api/ticker-search which the same panel relies on — /charts is a
free page and these expose only public taxonomy membership."""
from fastapi import APIRouter, Query

from api.services import compare_groups

router = APIRouter()


@router.get("/api/compare/groups")
def compare_groups_list(type: str = Query(..., description="theme | sector | industry")):
    return {"type": type, "groups": compare_groups.list_groups(type)}


@router.get("/api/compare/group-members")
def compare_group_members(
    type: str = Query(..., description="theme | sector | industry"),
    name: str = Query(..., description="exact group name from /api/compare/groups"),
):
    return compare_groups.group_members(type, name)
