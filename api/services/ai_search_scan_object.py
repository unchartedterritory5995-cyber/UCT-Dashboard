"""TERM-087 (item 14 WF-C12) -- an AI Search answer returns the product's own
editable object, not only prose about one.

THE DOOR. AI Search (`POST /api/ai-search`, `/api/ai-search/stream`) answers a
screening question ("find stocks above their 50 day with rs_rank over 80") in
PROSE. The product already owns the object that question describes: a SCAN, a
formula tree the builder edits condition by condition and saves as a user
definition. So when the flag is on and the ask reads as a screen, the answer
carries `scan_object` beside the prose -- the formula a member can open in the
builder and disagree with ONE CONDITION AT A TIME, which is the posture the
ledger names ("the generator must emit the product's own editable object
rather than prose about one").

THE ONE GENERATOR, THE ONE VALIDATOR. The object is produced by
`definition_concierge.propose(kind="scan")` -- the SAME pipeline behind the
builder's own English box (`POST /api/user-definitions/propose`). Its
`_validate` is the one server validator for a machine-written formula: the
closed-table schema, `user_definitions.assert_canonical`, the budget,
`scan_definition.is_boolean_tree`, the repaint linter and the interpreter. This
module adds NO schema of its own. A second validator here would be a second set
of gates to keep in step, which is the shape the concierge was written to
retire.

A REFUSAL IS AN HONEST REFUSAL, NEVER A HALF-OBJECT. `shape()` is the only
function that builds what the client sees, and it builds exactly one of two
things:

    {"ok": True,  "kind": "scan", "source", "ast", ...}  every field present
    {"ok": False, "kind": "scan", "gate", "reason"}      and NOTHING else

A refusal carries no `ast` and no `source`: a formula beside a refusal is a
formula somebody opens. An `ok` answer missing its source or its tree is
refused under `object:incomplete` rather than passed on.

PROSE STAYS BESIDE THE OBJECT, NEVER INSTEAD OF IT. The router attaches
`scan_object` to every final answer of a screen-shaped ask while the flag is on
-- the object, or the refusal that says why there is none. The client re-checks
the object with the builder's own `evaluateFormula` before it offers "Open in
builder" (`app/src/pages/charts/widgets/scanObject.js`).

OBSERVABILITY. The door logs `import_submitted` / `compile_finished` with
`dialect="ai-search"` through the SAME `indicator_telemetry` the builder's
English box uses, and hands the `import_id` to the client, which passes it into
the builder so a Save fires `import_accepted` with the same id. Emitted-object
count = `compile_finished` success rows for this dialect; opened-edited-then-
saved count = `import_accepted` rows for it. Neither logs the prompt.

COST. `propose` is bounded by the concierge's own per-member dollar cap and the
member-lane global gate (`cost_guard.may_member_spend`), and each AI Search ask
already reserves the member's daily AI Search quota before any of this runs.

FLAG. `AI_SEARCH_SCAN_OBJECT_ENABLED` (docs/feature_flags.json), default OFF. Unset,
`wanted()` is False, nothing here runs, no key is added to any response.
"""
from __future__ import annotations

import logging
import os
import re
import uuid
from typing import Any, Dict, Mapping, Optional

log = logging.getLogger(__name__)

#: The flag. Read per request so a Railway var flip needs no code change.
FLAG_ENV = "AI_SEARCH_SCAN_OBJECT_ENABLED"

#: The telemetry dialect this door stamps. The builder's own English box
#: stamps "plain-language"; a different value is what lets the two doors be
#: counted apart.
DIALECT = "ai-search"

KIND = "scan"

#: How long a final answer may wait for its object before it carries a
#: refusal instead. The concierge's own worst case is two 60 s model calls, so
#: this is the bound that keeps the final event from hanging on it.
WAIT_SECONDS = float(os.environ.get("AI_SEARCH_SCAN_OBJECT_WAIT_S", "75") or 75)

#: The refusal sentences this door OWNS. Every other refusal is the
#: concierge's own `{gate, reason}`, passed through unchanged.
REFUSALS: Mapping[str, str] = {
    "object:incomplete": "the scan came back incomplete, so it was not offered",
    "object:timeout": "the scan took too long to build, so it was not offered",
    "object:error": "the scan could not be built",
}


def enabled() -> bool:
    """Dark by default -- set AI_SEARCH_SCAN_OBJECT_ENABLED=1 to arm."""
    return os.environ.get(FLAG_ENV, "").strip().lower() in ("1", "true", "yes", "on")


# An ask reads as a screen when it asks to FIND a set of names AND states a
# condition, or when it says "screen/scan for" outright. Conservative on
# purpose: every match spends a concierge call, and "show me stocks moving
# today" is a movers question, not a formula.
_ASK_RE = re.compile(
    r"\b(?:find|show|list|screen|scan|give|get|pull|build)\b(?:\s+me)?"
    r".{0,40}?\b(?:stocks?|names|tickers|equities|companies|setups)\b", re.I)
_CONDITION_RE = re.compile(
    r"\b(?:with|where|whose|that|which|above|below|over|under|greater|less|"
    r"crossing|crossed|closing|breaking|within|between)\b", re.I)
_SCREEN_FOR_RE = re.compile(r"\b(?:screen|scan)\s+(?:me\s+)?for\b", re.I)


def looks_like_scan_ask(query: Any) -> bool:
    q = query if isinstance(query, str) else ""
    if not q.strip():
        return False
    if _SCREEN_FOR_RE.search(q):
        return True
    m = _ASK_RE.search(q)
    return bool(m and _CONDITION_RE.search(q[m.end():]))


def wanted(query: Any) -> bool:
    """The one question the router asks before spending anything."""
    return enabled() and looks_like_scan_ask(query)


def refusal(gate: str, reason: Optional[str] = None) -> Dict[str, Any]:
    """The refusal shape. ⛔ Nothing but these four keys, ever."""
    return {"ok": False, "kind": KIND, "gate": str(gate),
            "reason": str(reason or REFUSALS.get(gate) or REFUSALS["object:error"])}


def shape(result: Any, import_id: Optional[str] = None) -> Dict[str, Any]:
    """The concierge's answer -> the object the client sees, or a refusal.

    ⛔ AN `ok` ANSWER IS PASSED ON ONLY WHOLE. A scan the member can open needs
    its source (what goes in the builder's box) AND its tree (what the source
    must parse back to); either missing is `object:incomplete`, never an
    object with a hole in it.
    """
    if not isinstance(result, Mapping):
        return refusal("object:error")
    if not result.get("ok"):
        return refusal(result.get("gate") or "object:error", result.get("reason"))
    source = result.get("source")
    ast = result.get("ast")
    if (result.get("kind") != KIND or not isinstance(source, str) or not source.strip()
            or not isinstance(ast, Mapping)):
        return refusal("object:incomplete")
    return {
        "ok": True,
        "kind": KIND,
        "source": source,
        "ast": ast,
        "repaint": result.get("repaint"),
        "freshness": result.get("freshness"),
        "cadence": result.get("cadence"),
        # ⭐ PARTIAL UNDERSTANDING IS SHOWN, NOT SWALLOWED -- the same two
        # panels the builder's English box renders beside a proposal.
        "not_understood": list(result.get("not_understood") or []),
        "unavailable": list(result.get("unavailable") or []),
        "import_id": import_id,
    }


def emit(query: str, user_id: Any) -> Dict[str, Any]:
    """English in, the scan object or its refusal out. NEVER raises."""
    import_id = str(uuid.uuid4())
    try:
        from api.services import indicator_telemetry as telemetry
    except Exception:                                  # noqa: BLE001
        telemetry = None
    if telemetry is not None:
        telemetry.log_event(user_id, "import_submitted", import_id=import_id,
                            dialect=DIALECT)
    try:
        from api.services import definition_concierge
        result = definition_concierge.propose(query, user_id=user_id, bars=None,
                                              kind=KIND)
        obj = shape(result, import_id)
    except Exception as exc:                           # noqa: BLE001
        log.warning("[ai-search scan object] failed: %s", exc)
        obj = refusal("object:error")
    if telemetry is not None:
        telemetry.log_event(user_id, "compile_finished", import_id=import_id,
                            dialect=DIALECT, success=bool(obj.get("ok")),
                            stage="compile", gate=obj.get("gate"))
    return obj
