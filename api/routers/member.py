"""S6 CHECKPOINT 4 — `GET /api/member/interest`, the resolver's own seam.

SPEC-S6-PERSONALIZATION §3.2: *"The seam is therefore its own read, cached
per member, invalidated on write... with the same discipline `/api/live-
prices` learned: a shared per-member cache key, not a per-caller one, so ten
surfaces asking do not fragment into ten entries."*

⛔ Deliberately NOT `_access_payload` (the universal auth path every
authenticated request shares) -- SPEC §3.2's own comparison table names why:
an entity set is a member's whole watchlist + tags + positions, not "a few
short strings," and putting that on the path every request takes is the
`/api/live-prices` mistake in a new costume (the 2026-07-01 outage's own
keystone rule: never do unthrottled per-request work on the universal auth
path). This is its OWN read, on its OWN route.

⛔ CACHED, NOT "INVALIDATED ON WRITE": the spec names invalidate-on-write as
ONE way to satisfy its own freshness requirement ("must reflect the flag
they set ten seconds ago") -- this checkpoint satisfies the SAME requirement
with a short TTL instead (15s, matching `/api/live-prices`' own precedent in
this exact codebase), because wiring invalidation into every existing
watchlist/tag/position mutation endpoint is a cross-cutting change to many
OTHER routers' files, well beyond this checkpoint's own ~40-line sizing
(SPEC §5's table). A member's flag change is visible here within one TTL
window, the same bound `/api/live-prices` already gives every member for a
live quote.

⛔ PAID-GATED (SPEC §5.1 item 4, decided this turn): the sibling endpoint
already serving this same underlying data, `GET /api/calendar/my-sets`
(`api/routers/calendar.py`), is `require_paid`. This endpoint matches it --
the SAME data, in a richer shape, does not get a second, looser gate.
`require_paid` is DEFINED HERE, not imported from calendar.py, per this
codebase's own tested pattern (`tests/test_user_definitions_auth.py`): each
router owns its own 402 sentence so "which surface refused me" is readable
off the message.

⛔ READ-ONLY: this route calls `member_interest.interest_for`, which itself
only reads (SPEC §3.4: "Not a write path. The resolver READS. Every source
keeps its own writer.").
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.cache import cache
from api.services.member_interest import interest_for

router = APIRouter()

_CACHE_TTL = 15  # seconds -- matches /api/live-prices' own precedent for
                 # "reflect a change the member just made, without a
                 # per-request recompute for every one of the surfaces asking"


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the member-interest resolver.

    ⛔ Defined HERE, never imported from a sibling -- each router owns its
    own 402 sentence so "which surface refused me" is readable off the
    message. Rail: `tests/test_user_definitions_auth.py::
    test_require_paid_is_defined_PER_ROUTER_and_this_task_invented_no_shared_one`.
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="Member interest requires a paid plan")
    return user


def _cache_key(user_id: str) -> str:
    return f"member_interest:{user_id}"


@router.get("/api/member/interest")
def get_member_interest(user: dict = Depends(require_paid)) -> dict:
    """The member's entities, each carrying its weight and why it is there
    (SPEC §3.3: *"a resolver that returns a ranked list with no provenance
    is unfalsifiable to the person it is about"*).

    Shared per-member cache key (SPEC §3.2) -- ten surfaces asking within
    the same 15s window share one computation, never ten.
    """
    key = _cache_key(user["id"])
    cached = cache.get(key)
    if cached is not None:
        return cached

    result = interest_for(user["id"])
    payload = {"entities": result["entities"]}
    cache.set(key, payload, ttl=_CACHE_TTL)
    return payload
