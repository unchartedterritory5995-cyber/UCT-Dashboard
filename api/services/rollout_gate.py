"""S12 RUNG ZERO — the request-time GATE over a rollout cohort. TERM-068 / RM-N11.

`api/services/rollout.py` is the STORE: who is in a cohort, and how they got
there. This module is the only other half a dark surface needs — the per-request
question *"may THIS member, on THIS request, see it?"* — and it is deliberately
small, because rung zero's whole value is that nothing else has to exist yet.

⛔⛔ THIS IS NOT A SECOND COHORT STORE. `rollout.py` already ships `tag_for`,
`cohort_user_ids`, `includes`, `cohorts_for`, `assign_cohort`,
`remove_from_cohort`, `seed_cohort_from_role`, `seed_cohort_all_members` and
`role_user_ids`, and `tools/rollout_cohort.py` is the owner-approved operator
door over them (read-only unless `--apply`). ⛔ There is no admin web UI for
cohort membership and this module is not the start of one: a second authority
over who is in a cohort is this repo's recurring defect.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ THE ORDER IS THE LOAD-BEARING PART, AND IT IS COPIED, NOT INVENTED
──────────────────────────────────────────────────────────────────────────────

The shape is `api/services/wisdom/publish/adapters/askai.py:47 enabled_for` —
kill switch first and per call, then the id check, then `rollout.includes`, then
a bare-except fail-closed — the same shape `alert_routing.routing_enabled_for`
already copied. `rollout.py`'s own boundary states why:

    "Not a kill switch. The env flags stay, and the ORDERING is load-bearing:
     the kill switch is evaluated FIRST, so `FLAG=false` beats any membership.
     Without that, turning a feature off would mean emptying a table."

So with the flag off this module consults nothing else — it does not open
`auth.db`, it does not look at a tag. That is what makes the rollback *"flip one
variable and the surface stops being reachable"* true rather than merely stated,
and it is why the rail on the ordering uses a SPY: a fail-closed bare except
returns False whichever way round the two checks run, so the ANSWER proves
nothing about the ORDER. What a false flag has to buy is that nothing
downstream of it runs.

⛔ **NEVER `user_preferences`.** `POST /api/auth/preferences` accepts any
`{key, value}` from any authenticated member, so an entitlement stored there is
self-grantable. A cohort is an admin-written `user_tags` row and nothing else.

⛔ **NOT `entitlements.py`**, although three research documents propose it as
*"the natural seat"*. `rollout.py:50-55` rules the other way and the code wins:
*"Not an entitlement. `entitlements.py` answers 'what has this member paid
for'. Folding rollout in makes an experiment look like a purchase."* The
dependency below therefore sits BESIDE the `require_paid` family and never
inside it — one 402 keeps meaning one thing.

──────────────────────────────────────────────────────────────────────────────
⛔ THE DEFAULT IS OFF, AND THAT IS AN ARGUMENT, NOT AN INHERITANCE
──────────────────────────────────────────────────────────────────────────────

`api/routers/auth.py:126-137` states this estate's doctrine in one table: *a
kill switch defaults ON, an enablement gate defaults OFF*, and the justification
is about AMBIGUITY in both directions — for a kill switch *"a forgotten variable
must never be indistinguishable from a deliberate shutdown"*; for a gate
*"unset means 'not turned on yet'."*

`TERMINAL_NEXT_ENABLED` is called a kill switch throughout the rollout
documents, and `ALERT_ROUTING_ENABLED` — declared `dark` with `default: "1"` in
the same week, in the sibling lane — is the precedent for a dark kill switch
that defaults ON. It does not transfer, for one measurable reason: the two
flags' WRONG directions cost different amounts.

  * `ALERT_ROUTING_ENABLED` off means an internal alert takes the pre-split
    webhook it takes today. Nobody outside the firm can tell.
  * `TERMINAL_NEXT_ENABLED` on means an UNRELEASED member-facing surface is
    reachable. `_breadth_dc_flags`' docstring names that direction as *"the ONLY
    direction of this flag that can cost anything: `admin` leaking to everyone
    is an unreleased surface shipped to the whole roster by a value that was
    supposed to be the cautious one."*

The kill-switch-defaults-ON argument earns its keep only once there is something
to kill. At rung zero there is no consumer, so a forgotten variable reading
"off" costs nothing and a forgotten variable reading "on" costs the whole
roster. The ambiguity the doctrine protects against is therefore real in exactly
one direction here, and unset must mean OFF.

⭐ AND THE POLARITY IS SEQUENCED, NOT CONTRADICTED. The flag is an ENABLEMENT
gate while the feature is unreleased and becomes a KILL SWITCH at graduation —
which is already legislated: `rollout-rollback.md` RB-4 requires that at the S4
commit the entry is rewritten BY HAND to `status: armed` with a note saying it
is now a kill switch outside `needs_declaration()`'s scope. The ledger records
the handover; it is not a drift.

⛔ `docs/feature_flags.json`'s `default` field and `TERMINAL_NEXT_FLAG_DEFAULT`
below must AGREE, and `tests/test_terminal_next_flag.py` pins them to each other
— `feature_flag_index._default_of` reads only a literal second argument, so the
AST index sees this gate's default as `None` and the ledger is the only written
record of the polarity.
"""
from __future__ import annotations

import logging
import os
from typing import Callable, Optional

from fastapi import Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan

log = logging.getLogger(__name__)

#: ⭐ THE ONE AUTHORITY over this gate's name. Declared as a module constant so a
#: rename cannot leave a second spelling behind — and `feature_flag_index`
#: resolves this form (`_module_str_consts`), so the gate stays visible to the
#: AST index and to `tests/test_feature_flag_ledger.py`.
#:
#: ⛔ THE `_ENABLED` SUFFIX IS LOAD-BEARING. `is_gate()` is a NAME test
#: (ENABLED / DISABLE / a trailing `_ON`); `TERMINAL_NEXT_MODE` would be
#: invisible to the only inventory that has a rail — the `DESK_PUBLIC_SHOWS`
#: shape, which ran 25 days with the live value and the doc disagreeing and
#: nothing able to tell.
TERMINAL_NEXT_FLAG_ENV = "TERMINAL_NEXT_ENABLED"

#: ⭐ THE ONE AUTHORITY over this gate's default, and `docs/feature_flags.json`'s
#: `default` field for it is pinned against THIS constant by
#: `tests/test_terminal_next_flag.py::test_the_ledger_default_matches_the_readers_literal_default`.
#: ⚠️ `feature_flag_index._default_of` reads only a literal second argument, so
#: the AST index sees this gate's default as `None` and `needs_declaration`
#: returns True — the deliberate path its own docstring describes, which is why
#: the ledger entry is REQUIRED rather than surplus.
TERMINAL_NEXT_FLAG_DEFAULT = "0"

#: The BARE cohort name. ⛔ `rollout.tag_for` is the one place a bare name and its
#: stored tag are joined, and it REFUSES an already-prefixed name — so the prefix
#: literal must never appear in this module. ⛔ An empty cohort is NOBODY, never a
#: fallback to admins (`rollout.py`'s header ruling).
TERMINAL_NEXT_COHORT = "terminal-next"

#: ⛔ ENABLEMENT POLARITY: only an explicit on-spelling enables. Anything else —
#: unset, blank, `banana`, a typo'd `treu` — takes the DEFAULT, never the
#: opposite of it. Copied from `_breadth_dc_flags` / the Technical-tab gate
#: rather than reimplemented, so the two cannot drift.
_ON_VALUES = frozenset({"1", "true", "yes", "on"})

#: Byte-identical to FastAPI's unknown-route body, so a dark surface is
#: indistinguishable from no route at all (`api/routers/notebook_writing_help.py:49`).
NOT_FOUND = "Not Found"


def terminal_next_enabled() -> bool:
    """`TERMINAL_NEXT_ENABLED` as it stands RIGHT NOW. ⛔ Never cached.

    Read at CALL time, deliberately and for the reason
    `tests/test_hub_preview_flag.py` states: *"a module-level capture passes
    every other test and makes the no-redeploy rollback a fiction."*
    `railway variables --set` STAGES a value against a running pod — an operator
    reads the variable back changed, sees `--kv` agree, and an import-time
    capture keeps behaving as before.

    ⛔ Unset means NOT RELEASED YET. See this module's header for why this flag
    takes the enablement polarity although the rollout documents call it a kill
    switch.
    """
    raw = os.environ.get(TERMINAL_NEXT_FLAG_ENV, TERMINAL_NEXT_FLAG_DEFAULT)
    return (raw or "").strip().lower() in _ON_VALUES


def cohort_enabled_for(user_id: Optional[str], cohort: str, *,
                       kill_switch: Callable[[], bool]) -> bool:
    """May this member see this cohort's surface on this request?

    ⛔⛔ THE ORDER, and it is the whole safety property:

      1. the kill switch, read FIRST and per call. Off means this function
         touches neither `auth.db` nor a tag — *"turning a feature off"* is
         never *"emptying a table"*;
      2. an id. No id (an unauthenticated caller, a harness) means off;
      3. `rollout.includes(user_id, cohort)` — one per-user read;
      4. any exception at all: FAIL CLOSED.

    ⛔ THE CALLER SUPPLIES THE KILL SWITCH so that this function is reusable
    without ever becoming a registry of flags it does not own. One cohort, one
    flag, named together at the composition site below.
    """
    if not kill_switch():                       # kill switch first
        return False
    if not user_id:
        return False
    try:
        from api.services import rollout

        return bool(rollout.includes(str(user_id), cohort))
    except Exception:
        log.exception(
            "[rollout_gate] cohort lookup failed for %r; the surface stays off "
            "for this request", cohort)
        return False


def terminal_next_enabled_for(user_id: Optional[str]) -> bool:
    """Terminal-Next's composition of the two: the flag and the cohort, named
    together in the one place they are joined."""
    return cohort_enabled_for(user_id, TERMINAL_NEXT_COHORT,
                              kill_switch=terminal_next_enabled)


#: ⛔ THE COHORTS A CLIENT MAY BE TOLD ABOUT, each beside the kill switch that
#: can stop it. A cohort absent from this map is NEVER surfaced to a browser,
#: and that is fail-closed on purpose: a cohort the client can see but nobody
#: can switch off is a rollout with no lever. `s7-dark` and `wisdom-askai` are
#: server-side decisions with their own flags and no client half — surfacing
#: them here would be a new exposure nobody decided on.
COHORT_KILL_SWITCHES: dict[str, Callable[[], bool]] = {
    TERMINAL_NEXT_COHORT: terminal_next_enabled,
}


def client_cohorts(user_id: Optional[str]) -> list[str]:
    """The `cohorts` field on `_access_payload`. ⛔ NEVER RAISES.

    ⭐ THE EFFECTIVE LIST, not the raw tags — every member goes through
    `cohort_enabled_for`, so the kill switch is evaluated FIRST here too. With
    `TERMINAL_NEXT_ENABLED` unset or false this returns `[]` for a member who
    IS tagged, and not one tag has been touched. That is the whole point of the
    ordering, observable on the member's own payload.

    ⛔ `_access_payload` is the UNIVERSAL auth path — signup, login and
    `/api/auth/me` all build it — so an exception here is a LOGIN OUTAGE, not a
    dark surface. `cohort_enabled_for` swallows its own failures; this adds
    nothing that can raise.

    ⭐ It rides that payload rather than a new `GET /api/flags`: this app records
    the absence of a config endpoint as deliberate (`kill-switch-spec.md`
    specified one and struck it the day it was written), and a second mechanism
    would be a second authority AND would reach members later, since a boot-read
    needs a reload while this arrives on the next authenticated request.
    """
    return [cohort for cohort, kill_switch in sorted(COHORT_KILL_SWITCHES.items())
            if cohort_enabled_for(user_id, cohort, kill_switch=kill_switch)]


def require_cohort(cohort: str, *, kill_switch: Callable[[], bool]):
    """A FastAPI dependency: this route is reachable only inside `cohort`.

    ⛔ BESIDE `require_paid`, NEVER INSTEAD OF IT. A dark Terminal-Next route
    carries BOTH: `require_paid` answers *"may you be here at all"* with a 402,
    this answers *"has this surface been released to you"* with a 404. One
    dependency answering both would make a single 402 mean two different
    things — the rule `entitlements.limits_dependency` already states for the
    other axis.

    ⛔ 404, NOT 403, and the body is byte-identical to FastAPI's own unknown
    route: a dark surface must be indistinguishable from a surface that does not
    exist, or the refusal itself announces the feature.

    ⚠️ STATED RATHER THAN HIDDEN: FastAPI resolves `get_current_user_with_plan`
    before this body runs, so a cohort gate necessarily reads the credential
    before the flag. That is unavoidable — the question needs an identity. A
    router that also wants `notebook_writing_help.py`'s stronger *"an off gate
    reads no credential"* property mounts a router-level
    `dependencies=[Depends(...)]` calling `terminal_next_enabled()` — the same
    one authority over the flag, one level earlier.
    """
    def _require_cohort(user: dict = Depends(get_current_user_with_plan)) -> dict:
        if not cohort_enabled_for(user.get("id"), cohort, kill_switch=kill_switch):
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        return user

    return _require_cohort


#: Terminal-Next's door, composed once. ⭐ Building the closure at import time
#: captures nothing: the env read happens inside `terminal_next_enabled`, on
#: every request.
require_terminal_next = require_cohort(TERMINAL_NEXT_COHORT,
                                       kill_switch=terminal_next_enabled)
