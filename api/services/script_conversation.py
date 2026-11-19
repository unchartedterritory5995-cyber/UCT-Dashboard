# -*- coding: utf-8 -*-
"""THE SCRIPT TURN: Create Indicator's assistant writes Pine (S1 and the server half of S3, 2026-11-18).

A formula cannot hold a table, a drawn line, a label with text or a list of levels. The engine
already runs all of those for a pasted script, so for a request a formula cannot meet the
assistant writes a SCRIPT, from the generated document of exactly what the engine serves
(`pine_authoring.document`).

⛔ THE ENGINE JUDGES. This module never says a script runs. It returns the text; the browser puts it
through the same door a pasted script goes through and shows the member THAT door's verdict. When
the engine refuses it, the browser sends the refusal back (`script_refusal`) and the assistant
repairs it: a bounded number of rounds, counted in the same ledger as every other call.

WHO GETS ONE (all of these, or the turn is the formula turn it always was):
  * the lane is switched on (`CONVERSE_SCRIPT_ENABLED=admin`) and the account is an ADMIN: no
    member sees a script turn until its cost has been measured and a ceiling set;
  * the browser said it accepts a script (`accepts: ["script"]`), so a tab on an older build never
    meets an answer it cannot show;
  * the document can be built (`pine_authoring.available`).

SPEND. Every call is checked against the global budget and the account's daily allowance BEFORE
it is made, charged to the same ledger (`cost_guard.record`, `definition_concierge._record_spend`)
and appended to the turn's `calls`, exactly as a formula call is. A turn makes at most
`MAX_SCRIPT_CALLS` calls.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Mapping, Optional

from api.services.catalyst import cost_guard
from api.services import definition_concierge as dc
from api.services import pine_authoring

logger = logging.getLogger(__name__)

ACCEPTS_SCRIPT = "script"
#: The lane's switch. "admin": admin accounts only. "all": every account the Create Indicator door
#: admits. Anything else, or unset: off.
SCRIPT_ENABLED_ENV = "CONVERSE_SCRIPT_ENABLED"
SCRIPT_MODE_ADMIN, SCRIPT_MODE_ALL = "admin", "all"
TOOL_NAME = "emit_script"
#: One answer, and one more call when the answer's SHAPE is wrong (`pine_authoring.script_problem`).
MAX_SCRIPT_CALLS = 2
#: The most repair rounds a browser may ask for on one request (the engine's refusal sent back).
MAX_REPAIR_ROUNDS = 2
REFUSAL_MAX_ERRORS, REFUSAL_MAX_CHARS = 6, 300
DECLINED_GATE = "script:unsupported"
SHAPE_GATE = "script:shape"
ROUNDS_GATE = "script:rounds"
REFUSED_TOOL_USE_ID = "toolu_engine_refusal"

REASONS = {
    DECLINED_GATE: "The assistant could not build that as a script this chart can run.",
    SHAPE_GATE: "The assistant's script was not in a form this chart can check, so nothing was offered.",
    ROUNDS_GATE: "The script was sent back for repair as many times as allowed and the chart still refuses it.",
}

#: ⭐ WORDS THAT ASK FOR SOMETHING ONLY A SCRIPT CAN HOLD. A request with one of these goes to the
#: script turn first; any other request takes the formula turn it always took, and reaches a script
#: only if the formula turn declines it. Deliberately short: a word here costs a formula request
#: its cheaper path, so each is something a formula cannot draw at all.
_SCRIPT_WORDS = re.compile(
    r"\b(?:tables?|dashboards?|labels?|text|trend ?lines?|draw(?:s|n|ing)?|box(?:es)?|rectangles?|zones?|"
    r"fib(?:s|onacci)?|zig ?zags?|pivot points?|pine|scripts?)\b", re.I)

TOOL = {
    "name": TOOL_NAME,
    "description": ("Return the ONE Pine script that meets the member's request, or say that it cannot be built with "
                    "what this engine serves."),
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["disposition", "reply"],
        "properties": {
            "disposition": {"type": "string", "enum": ["script", "unsupported"]},
            "name": {"type": "string", "maxLength": pine_authoring.NAME_MAX_CHARS,
                     "description": "A short name for the indicator, in the member's words."},
            "pine": {"type": "string", "maxLength": pine_authoring.SCRIPT_MAX_CHARS,
                     "description": "The complete script. Required when disposition is script."},
            "reply": {"type": "string", "maxLength": pine_authoring.REPLY_MAX_CHARS,
                      "description": ("One or two plain sentences: what the script draws and what a member can change; or, "
                                      "when unsupported, what cannot be built and the closest thing that can.")},
        },
    },
}


def lane_open(accepts: Any, admin: Any) -> bool:
    """May this request be answered with a script at all? (Module docstring: who gets one.)"""
    mode = os.environ.get(SCRIPT_ENABLED_ENV, "").strip().lower()
    # ⭐ `all` (coordinator's ruling 2026-11-19, after the admin measurement): every account the Create
    # Indicator door itself admits. A script turn spends that account's own daily allowance and the same
    # ledger as a formula turn, so there is no second ceiling. `admin`: admin accounts only.
    if not (mode == SCRIPT_MODE_ALL or (mode == SCRIPT_MODE_ADMIN and admin is True)):
        return False
    if not (isinstance(accepts, list) and ACCEPTS_SCRIPT in accepts):
        return False
    return pine_authoring.available()


def wants_script(message: Any) -> bool:
    """Does the request name something only a script can hold?"""
    return isinstance(message, str) and bool(_SCRIPT_WORDS.search(message))


def script_refusal(raw: Any) -> Optional[Dict[str, Any]]:
    """The browser engine's refusal of a script this door offered for this same request:
    ``{pine, errors, round}`` bounded, or None when it is not usable (then the turn is ordinary).
    Untrusted input: the script must itself pass the server's first look, the errors are short
    strings, and the round is a small whole number."""
    if not isinstance(raw, Mapping):
        return None
    pine = raw.get("pine")
    if pine_authoring.script_problem(pine) is not None:
        return None
    errors = [re.sub(r"\s+", " ", e).strip()[:REFUSAL_MAX_CHARS] for e in (raw.get("errors") or [])
              if isinstance(e, str) and e.strip()] if isinstance(raw.get("errors"), list) else []
    errors = errors[:REFUSAL_MAX_ERRORS]
    if not errors:
        return None
    rnd = raw.get("round")
    rnd = rnd if isinstance(rnd, int) and not isinstance(rnd, bool) and rnd >= 1 else 1
    return {"pine": pine, "errors": errors, "round": rnd}


def system_blocks() -> List[Dict[str, Any]]:
    """The document, as ONE cached block (a constant for a given reference)."""
    return [{"type": "text", "text": pine_authoring.document(), "cache_control": {"type": "ephemeral"}}]


def _request_text(message: str, chart: Any) -> str:
    sym = chart.get("sym") if isinstance(chart, Mapping) else None
    tf = chart.get("tf") if isinstance(chart, Mapping) else None
    on = f" The member's chart shows {sym}" + (f" on the {tf} timeframe." if tf else ".") if sym else ""
    # ⭐ the recipes this request NAMES (`pine_authoring.recipes_for`): whole scripts the engine is known
    # to run, as data beside the request. Our own text, never the member's.
    found = pine_authoring.recipes_text(pine_authoring.recipes_for(message))
    return (f"<member_request>{dc.escape_json(message)}</member_request>{on} "
            "Write the script with the emit_script tool." + (f"\n\n{found}" if found else ""))


def _messages(message: str, chart: Any, refused: Optional[Mapping[str, Any]]) -> List[dict]:
    out: List[dict] = [{"role": "user", "content": _request_text(message, chart)}]
    if refused:
        words = " ".join(f"({i + 1}) {e}" for i, e in enumerate(refused["errors"]))
        out += [
            {"role": "assistant", "content": [
                {"type": "tool_use", "id": REFUSED_TOOL_USE_ID, "name": TOOL_NAME,
                 "input": {"disposition": "script", "pine": refused["pine"], "reply": ""}}]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": REFUSED_TOOL_USE_ID, "is_error": True,
                 "content": (f"[engine:refused] UCT's engine checked this script and does not run it as written: {words} "
                             "Fix exactly what the engine names and return the WHOLE corrected script. If the engine "
                             "cannot do what was asked, say so (disposition unsupported).")}]},
        ]
    return out


def _call_model(messages: List[dict]):
    from api.services.engine import _get_anthropic_client
    client = _get_anthropic_client().with_options(max_retries=dc.MAX_HTTP_RETRIES)
    msg = client.messages.create(
        model=dc.MODEL, max_tokens=dc.MAX_TOKENS, system=system_blocks(), tools=[TOOL],
        tool_choice={"type": "tool", "name": TOOL_NAME}, messages=messages)
    usage = getattr(msg, "usage", None)
    return msg, int(getattr(usage, "input_tokens", 0) or 0), int(getattr(usage, "output_tokens", 0) or 0)


def _tool_use(msg: Any):
    for block in getattr(msg, "content", None) or []:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == TOOL_NAME:
            value = getattr(block, "input", None)
            if isinstance(value, dict):
                return getattr(block, "id", None), value
    return None, None


def _refused(gate: str, reason: Optional[str] = None, **extra: Any) -> Dict[str, Any]:
    return {"ok": False, "gate": gate, "reason": reason or REASONS.get(gate) or dc.REFUSALS.get(gate) or gate, **extra}


def script_turn(message: str, *, user_id: Any, chart: Any, cap_usd: float, calls: List[Dict[str, Any]],
                revision: int, contract: str, trace: Optional[Dict[str, Any]] = None,
                refused: Optional[Mapping[str, Any]] = None, cancelled: Any = None) -> Dict[str, Any]:
    """One script turn. NEVER raises. Returns the door's result dict: on success
    ``{ok, disposition: "answer", turn: "script", reply, script: {name, pine, round}, envelope, ...}``;
    the envelope is an answer that changes nothing (the script is not a patch: the browser's engine
    decides what becomes of it)."""
    trace = trace if trace is not None else {}
    rnd = int(refused["round"]) if refused else 0
    trace["script"] = {"round": rnd}
    if refused and rnd > MAX_REPAIR_ROUNDS:
        return _refused(ROUNDS_GATE)
    market_date = dc._market_date()
    messages = _messages(message, chart, refused)
    tokens = {"input": 0, "output": 0}
    cost_usd, attempts = 0.0, 0
    extra = lambda: {"tokens": dict(tokens), "cost_usd": round(cost_usd, 6), "attempts": attempts, "model": dc.MODEL}  # noqa: E731
    while attempts < MAX_SCRIPT_CALLS:
        if cancelled is not None and cancelled.is_set():
            return _refused("internal:timeout", **extra())
        # ⭐ THE CAPS ARE CONSULTED BEFORE EVERY SPEND, the shape repair included.
        if not cost_guard.may_member_spend(market_date):
            return _refused("cost:global", **extra())
        if dc.spend_for(user_id, market_date) >= cap_usd:
            return _refused("cost:user", **extra())
        attempts += 1
        request = {"system": system_blocks(), "tools": [TOOL], "messages": messages}
        try:
            msg, in_tokens, out_tokens = _call_model(messages)
        except Exception as exc:                   # noqa: BLE001 -- never raises out
            gate = dc.model_failure_gate(exc)
            logger.warning("[converse:script] model call failed: %s", type(exc).__name__)
            dc.charge_unreported(exc, user_id, market_date, dc.MODEL, dc.MAX_TOKENS, request)
            return _refused(gate, **extra())
        usage = getattr(msg, "usage", None)
        cache_read = int(getattr(usage, "cache_read_input_tokens", 0) or 0)
        cache_write = int(getattr(usage, "cache_creation_input_tokens", 0) or 0)
        tokens["input"] += in_tokens
        tokens["output"] += out_tokens
        if not (in_tokens or out_tokens or cache_read or cache_write):
            spent = dc.charge_unreported(None, user_id, market_date, dc.MODEL, dc.MAX_TOKENS, request)
        else:
            spent = cost_guard.record(market_date, f"concierge:{user_id}", dc.MODEL, in_tokens, out_tokens,
                                      cache_read_tokens=cache_read, cache_creation_tokens=cache_write)
            dc._record_spend(user_id, market_date, spent)
        cost_usd += spent
        calls.append({"input_tokens": in_tokens, "output_tokens": out_tokens, "cache_read_tokens": cache_read,
                      "cache_creation_tokens": cache_write, "usd": round(spent, 6), "script": True})

        tool_use_id, answer = _tool_use(msg)
        reply = answer.get("reply") if isinstance(answer, dict) else None
        reply = reply.strip()[:pine_authoring.REPLY_MAX_CHARS] if isinstance(reply, str) else ""
        if isinstance(answer, dict) and answer.get("disposition") == "unsupported":
            trace["script"]["declined"] = True
            return _refused(DECLINED_GATE, reply or None, disposition="unsupported", **extra())
        pine = answer.get("pine") if isinstance(answer, dict) and answer.get("disposition") == "script" else None
        problem = pine_authoring.script_problem(pine)
        if problem is None:
            name = answer.get("name")
            name = re.sub(r"\s+", " ", name).strip()[:pine_authoring.NAME_MAX_CHARS] if isinstance(name, str) else ""
            said = reply or "Here is a script for that. The chart's own check decides whether it runs."
            # ⭐ THE DISCLOSURE (ruling 2026-11-19): a script with no value-checked recipe behind it says
            # so, in UCT's own words, whatever the assistant wrote. Decided by counting
            # (`pine_authoring.backed_by`), on THIS script: a repair is judged again.
            reference = pine_authoring.backed_by(message, pine)
            said = pine_authoring.said_with_disclosure(said, reference)
            trace["script"]["chars"] = len(pine)
            trace["script"]["reference"] = reference
            logger.info("[converse:script] a script of %d characters (round %d, %d call(s), reference %s)",
                        len(pine), rnd, attempts, reference or "none")
            return {"ok": True, "disposition": "answer", "turn": "script", "reply": said,
                    "script": {"name": name, "pine": pine, "round": rnd, "reference": reference},
                    "envelope": {"contract": contract, "baseRevision": revision, "ops": [], "disposition": "answer",
                                 "reply": said},
                    "answered_by": "assistant", "not_understood": [], "unavailable": [], **extra()}
        trace["script"]["shape"] = problem
        if tool_use_id:
            messages = messages + [
                {"role": "assistant", "content": [{"type": "tool_use", "id": tool_use_id, "name": TOOL_NAME,
                                                   "input": answer or {}}]},
                {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tool_use_id, "is_error": True,
                                              "content": f"[script:shape] {problem}. Return the whole corrected script."}]},
            ]
        else:
            messages = messages + [{"role": "user", "content": f"[script:shape] {problem}. Use the emit_script tool."}]
    return _refused(SHAPE_GATE, **extra())
