"""TERM-062 / FB-S7-02 -- publish the cooldowns.

`published_cooldowns()` -- the re-arm rule each MEMBER-FACING trigger type
applies, built at call time from the constants the alert code itself consumes
(`document_arrival.SWEEP_EVERY_MINUTES` schedules the sweep in api/main.py,
`FIRE_KEY_GRAIN` builds the fire key, `MAX_FIRES_PER_SWEEP` is what
`_evaluate_one` does, `sweep_enabled()` gates the job). Nothing here is a typed
copy of a number; the sentence is composed from the same values.

⛔ SCOPE: types a member can author today -- DERIVED from the router's
`POST /api/alerts/taxonomy/<type>` routes (`member_create_type_ids`), and a rail
requires this register to equal that set. The seven other registered types run
DARK (comparison spans, no member delivery through the taxonomy), so publishing
their grains to members would describe a path nobody is on. The day one of them
gets a member create route, the rail reds by name until its cooldown is
published here.

⚰️ FB-S7-02's other half -- a pre-save "how often did this fire" count over
`alert_fires` -- was BUILT and then DROPPED by owner ruling 2026-09-29 (privacy):
the count spanned every member's watches, so "watched" versus "never watched"
told a member whether ANYONE on UCT watched that ticker. Do not rebuild it over
the cross-member record; a count over the member's own fires, or over a public
source such as the SEC filing index, answers without that leak.
"""
from __future__ import annotations

from typing import Any, Iterable, Optional

from api.services.alert_taxonomy import document_arrival as _doc

#: The member create-route shape `member_create_type_ids` derives types from.
_CREATE_PREFIX = "/api/alerts/taxonomy/"

#: How a fire-key grain reads to a member. A grain with no entry is published
#: under its own field name -- awkward, but true, and never a stale noun.
_GRAIN_NOUN = {"accession": "filing"}


def _document_arrival() -> dict[str, Any]:
    grain = _doc.FIRE_KEY_GRAIN
    noun = _GRAIN_NOUN.get(grain, grain)
    checking = _doc.sweep_enabled()
    minutes = _doc.SWEEP_EVERY_MINUTES if checking else None
    per_check = _doc.MAX_FIRES_PER_SWEEP
    once = f"Each new {noun} alerts you once, and never again."
    if checking:
        sentence = (f"Checked every {minutes} minutes. {once} If several land between "
                    f"checks, you get {per_check} alert{'' if per_check == 1 else 's'}, "
                    f"for the newest.")
    else:
        sentence = (f"Checks are paused right now; your watches are kept and resume "
                    f"when checks restart. {once}")
    return {
        "type_id": _doc.TYPE_ID,
        "label": "Filing watch",
        "checking": checking,
        "check_every_minutes": minutes,
        "rearm_grain": grain,
        "max_alerts_per_check": per_check,
        "time_cooldown_seconds": None,   # no clock-based cooldown: re-arm is per grain
        "sentence": sentence,
    }


#: type_id -> builder. One entry per member-facing trigger type.
_PUBLISHERS = {
    _doc.TYPE_ID: _document_arrival,
}


def published_cooldowns() -> list[dict[str, Any]]:
    """Every member-facing trigger type's re-arm rule, derived at call time."""
    return [_PUBLISHERS[t]() for t in sorted(_PUBLISHERS)]


def published_cooldown(type_id: str) -> Optional[dict[str, Any]]:
    fn = _PUBLISHERS.get(type_id)
    return fn() if fn else None


def member_create_type_ids(routes: Iterable[Any]) -> set[str]:
    """The trigger types a member can author: every `POST /api/alerts/taxonomy/<type>`
    route (one path segment after the prefix). Admin routes live under
    `/api/admin/...` and never match."""
    out: set[str] = set()
    for r in routes:
        path = getattr(r, "path", "")
        methods = getattr(r, "methods", None) or set()
        if "POST" not in methods or not path.startswith(_CREATE_PREFIX):
            continue
        rest = path[len(_CREATE_PREFIX):]
        if rest and "/" not in rest and "{" not in rest:
            out.add(rest)
    return out

